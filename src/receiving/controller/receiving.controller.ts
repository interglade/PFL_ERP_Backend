import { inject } from 'inversify';
import { controller, httpDelete, httpGet, httpPost, next, request, requestParam, response } from 'inversify-express-utils';
import { NextFunction, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { format } from 'date-fns';

import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import logger from '../../utils/logger';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { ARRIVALS_EXPORT_BATCH_SIZE, ARRIVALS_EXPORT_MAX_ROWS, ReceivingStatusService } from '../service/receivingStatus.service';
import {
  ARRIVAL_READINESS,
  ArrivalReadiness,
  ArrivalRow,
  ArrivalsFilter,
  DISPATCH_STATES,
  DispatchState,
  RECEIVING_STATES,
  ReceivingSourceType,
  ReceivingState,
  SKIPPABLE_DOC_TYPES,
  SkippableDocType,
} from '../receiving.types';
import { isReceivingSourceType } from '../receiving.sql';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const SOURCE_TYPE_TITLE: Record<ReceivingSourceType, string> = {
  grn: 'GRN',
  'stock-transfer-dc': 'Transfer DC',
  rbc: 'RBC',
};

interface ArrivalColumn {
  header: string;
  width: number;
  get: (row: ArrivalRow) => string | number | Date | null;
  numFmt?: string;
}

/** Same columns as the Arrivals list. */
const ARRIVAL_COLUMNS: ArrivalColumn[] = [
  { header: 'Source No', width: 20, get: (r) => r.sourceNo },
  { header: 'Type', width: 14, get: (r) => SOURCE_TYPE_TITLE[r.sourceType] },
  { header: 'Party', width: 28, get: (r) => r.partyName },
  { header: 'Company', width: 24, get: (r) => r.companyName },
  { header: 'Location', width: 22, get: (r) => r.locationName },
  { header: 'Date', width: 20, get: (r) => (r.date ? new Date(r.date) : null), numFmt: 'dd-mm-yyyy hh:mm' },
  { header: 'Products', width: 10, get: (r) => r.productCount, numFmt: '0' },
  { header: 'Received kg', width: 14, get: (r) => r.receivedKg, numFmt: '#,##0.000' },
  { header: 'Difference kg', width: 14, get: (r) => r.differenceKg, numFmt: '#,##0.000' },
  { header: 'Transit Loss kg', width: 15, get: (r) => r.transitLossKg, numFmt: '#,##0.000' },
  { header: 'Transit Loss Rs', width: 15, get: (r) => r.transitLossValue, numFmt: '#,##0.00' },
  { header: 'AQR', width: 11, get: (r) => r.slots.aqr },
  { header: 'Inward', width: 11, get: (r) => r.slots.inward },
  { header: 'Dump', width: 11, get: (r) => r.slots.dump },
  { header: 'RTV', width: 11, get: (r) => r.slots.rtv ?? 'n/a' },
  { header: 'State', width: 13, get: (r) => r.state },
  { header: 'Dispatch', width: 12, get: (r) => r.dispatchState },
  { header: 'Can Receive', width: 12, get: (r) => (r.canReceive ? 'Yes' : 'No') },
  { header: 'Blocked By', width: 40, get: (r) => r.blockers.join('; ') || null },
  { header: 'Dispatch No', width: 18, get: (r) => r.dispatch?.dispatchNo ?? null },
  { header: 'Vehicle No', width: 14, get: (r) => r.dispatch?.vehicleNo ?? null },
  { header: 'Driver', width: 20, get: (r) => r.dispatch?.driverName ?? null },
  { header: 'Driver Mobile', width: 14, get: (r) => r.dispatch?.driverMobNo ?? null },
  { header: 'Transporter', width: 22, get: (r) => r.dispatch?.transporterName ?? null },
  { header: 'Out Time', width: 10, get: (r) => r.dispatch?.outTime ?? null },
  { header: 'Reaching Time', width: 12, get: (r) => r.dispatch?.reachingTime ?? null },
  { header: 'Arrived At', width: 20, get: (r) => (r.dispatch?.arrivedAt ? new Date(r.dispatch.arrivedAt) : null), numFmt: 'dd-mm-yyyy hh:mm' },
];

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

/** Comma-separated and / or repeated query values. */
function manyStrings(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value !== undefined && value !== null ? [value] : [];
  return raw
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseSkipBody(body: unknown): { sourceType: ReceivingSourceType; sourceId: string; docType: SkippableDocType } {
  const input = (body ?? {}) as Record<string, unknown>;
  const sourceType = input.sourceType;
  const sourceId = typeof input.sourceId === 'string' ? input.sourceId.trim() : '';
  const docType = input.docType;
  if (!isReceivingSourceType(sourceType)) throw new AppError(400, 'sourceType must be one of grn, stock-transfer-dc, rbc');
  if (!UUID.test(sourceId)) throw new AppError(400, 'sourceId must be a uuid');
  if (!SKIPPABLE_DOC_TYPES.includes(docType as SkippableDocType)) {
    throw new AppError(400, `docType must be one of ${SKIPPABLE_DOC_TYPES.join(', ')}`);
  }
  return { sourceType, sourceId, docType: docType as SkippableDocType };
}

function parseArrivalsFilter(query: Request['query']): ArrivalsFilter {
  const filter: ArrivalsFilter = {};

  const locationId = firstString(query.locationId);
  if (locationId) filter.locationId = locationId;

  // One or more states: `state=open`, `state=not-started,open` or `state=open&state=legacy`.
  const states = manyStrings(query.state);
  if (states.length) {
    const invalid = states.find((s) => !RECEIVING_STATES.includes(s as ReceivingState));
    if (invalid) throw new AppError(400, `state must be one or more of ${RECEIVING_STATES.join(', ')}`);
    filter.state = Array.from(new Set(states)) as ReceivingState[];
  }

  const dispatchState = firstString(query.dispatchState);
  if (dispatchState) {
    if (!DISPATCH_STATES.includes(dispatchState as DispatchState)) {
      throw new AppError(400, `dispatchState must be one of ${DISPATCH_STATES.join(', ')}`);
    }
    filter.dispatchState = dispatchState as DispatchState;
  }

  const readiness = firstString(query.readiness);
  if (readiness) {
    if (!ARRIVAL_READINESS.includes(readiness as ArrivalReadiness)) {
      throw new AppError(400, `readiness must be one of ${ARRIVAL_READINESS.join(', ')}`);
    }
    filter.readiness = readiness as ArrivalReadiness;
  }

  const types = manyStrings(query.sourceType);
  if (types.length) {
    const invalid = types.find((t) => !isReceivingSourceType(t));
    if (invalid) throw new AppError(400, 'sourceType must be one of grn, stock-transfer-dc, rbc');
    filter.sourceType = types as ReceivingSourceType[];
  }

  const startDate = firstString(query.startDate);
  const endDate = firstString(query.endDate);
  if (startDate) filter.startDate = startDate;
  if (endDate) filter.endDate = endDate;

  const search = firstString(query.search);
  if (search) filter.search = search;

  const sort = firstString(query.sort);
  if (sort) filter.sort = sort;

  const page = Number(firstString(query.page));
  const limit = Number(firstString(query.limit));
  if (Number.isFinite(page) && page > 0) filter.page = Math.floor(page);
  if (Number.isFinite(limit) && limit > 0) filter.limit = Math.floor(limit);

  return filter;
}

@controller('/receiving', deserializeUser, requireUser)
export class ReceivingController {
  constructor(
    @inject(TYPES.ReceivingStatusService)
    private readonly receivingStatusService: ReceivingStatusService,
  ) {}

  /** Live receiving status of one source: slots, per-product kg, state. */
  @httpGet('/source/:type/:id')
  public async getSourceStatus(
    @requestParam('type') type: string,
    @requestParam('id') id: string,
    @request() _req: Request,
    @response() res: Response,
    @next() nextFn: NextFunction,
  ) {
    try {
      if (!isReceivingSourceType(type)) {
        return nextFn(new AppError(400, 'Source type must be one of grn, stock-transfer-dc, rbc'));
      }
      const data = await this.receivingStatusService.getSourceStatus(type, id);
      res.status(200).json({ status: 'success', data });
    } catch (error) {
      nextFn(error);
    }
  }

  /**
   * Arrivals worklist as .xlsx (same filters and columns as the list, no
   * pagination, at most ARRIVALS_EXPORT_MAX_ROWS rows). The matching keys are
   * resolved first (cheap), then rows are built and streamed in batches, so
   * the statuses are never all held in memory. `X-Export-Truncated: true`
   * when the cap cut the result.
   */
  @httpGet('/arrivals/excel')
  public async exportArrivals(
    @request() req: Request,
    @response() res: Response,
    @next() nextFn: NextFunction,
  ) {
    try {
      const filter = parseArrivalsFilter(req.query);
      const plan = await this.receivingStatusService.planArrivalsExport(filter);

      const fileName = `arrivals-${format(new Date(), 'yyyyMMdd')}.xlsx`;
      res.status(200);
      res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Record-Count, X-Export-Total-Count, X-Export-Truncated');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Export-Record-Count', String(plan.keys.length));
      res.setHeader('X-Export-Total-Count', String(plan.total));
      if (plan.truncated) res.setHeader('X-Export-Truncated', 'true');

      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: res,
        useStyles: true,
        useSharedStrings: false,
      });
      workbook.creator = 'Prime Fresh ERP';
      workbook.created = new Date();

      const sheet = workbook.addWorksheet('Arrivals', { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.columns = ARRIVAL_COLUMNS.map((column, index) => ({
        key: `c${index}`,
        width: column.width,
        style: column.numFmt ? { numFmt: column.numFmt } : {},
      }));

      const header = sheet.addRow(ARRIVAL_COLUMNS.map((column) => column.header));
      header.height = 28;
      header.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        cell.numFmt = 'General';
      });
      header.commit();

      let written = 0;
      for (let start = 0; start < plan.keys.length; start += ARRIVALS_EXPORT_BATCH_SIZE) {
        const rows = await this.receivingStatusService.arrivalRowsFor(plan.keys.slice(start, start + ARRIVALS_EXPORT_BATCH_SIZE));
        for (const row of rows) {
          sheet.addRow(ARRIVAL_COLUMNS.map((column) => column.get(row) ?? null)).commit();
          written += 1;
        }
      }
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: written + 1, column: ARRIVAL_COLUMNS.length } };
      if (plan.truncated) {
        sheet.addRow([]).commit();
        sheet
          .addRow([`Only the first ${ARRIVALS_EXPORT_MAX_ROWS} of ${plan.total} rows were exported. Narrow the filters to export the rest.`])
          .commit();
      }
      sheet.commit();
      await workbook.commit();
    } catch (error) {
      if (res.headersSent) {
        logger.error('Arrivals export failed after the response started', { error });
        res.end();
        return;
      }
      nextFn(error);
    }
  }

  /** Number of Arrivals matching the filters (sidebar badge: `?readiness=ready&state=not-started`). */
  @httpGet('/arrivals/count')
  public async countArrivals(
    @request() req: Request,
    @response() res: Response,
    @next() nextFn: NextFunction,
  ) {
    try {
      const filter = parseArrivalsFilter(req.query);
      const count = await this.receivingStatusService.countArrivals(filter);
      res.status(200).json({ status: 'success', data: { count } });
    } catch (error) {
      nextFn(error);
    }
  }

  /** Marks the Dump / RTV step of a source as not needed. Body: `{ sourceType, sourceId, docType }`. */
  @httpPost('/skip')
  public async skipStep(
    @request() req: Request,
    @response() res: Response,
    @next() nextFn: NextFunction,
  ) {
    try {
      const input = parseSkipBody({ ...req.query, ...(req.body ?? {}) });
      const skipped = await this.receivingStatusService.setSkip(input, true, res.locals.user?.id ?? null);
      res.status(200).json({ status: 'success', data: { skipped } });
    } catch (error) {
      nextFn(error);
    }
  }

  /** Removes the "not needed" mark. Body or query: `{ sourceType, sourceId, docType }` (query works where proxies drop DELETE bodies). */
  @httpDelete('/skip')
  public async unskipStep(
    @request() req: Request,
    @response() res: Response,
    @next() nextFn: NextFunction,
  ) {
    try {
      const input = parseSkipBody({ ...req.query, ...(req.body ?? {}) });
      const skipped = await this.receivingStatusService.setSkip(input, false, res.locals.user?.id ?? null);
      res.status(200).json({ status: 'success', data: { skipped } });
    } catch (error) {
      nextFn(error);
    }
  }

  /** Arrivals worklist: COMPLETE sources (GRN only cc-dc) with their receiving state. */
  @httpGet('/arrivals')
  public async listArrivals(
    @request() req: Request,
    @response() res: Response,
    @next() nextFn: NextFunction,
  ) {
    try {
      const filter = parseArrivalsFilter(req.query);
      const result = await this.receivingStatusService.listArrivals(filter);
      res.status(200).json({
        status: 'success',
        data: result.data,
        allRecords: result.total,
        totalPages: result.totalPages,
        page: result.page,
      });
    } catch (error) {
      nextFn(error);
    }
  }
}
