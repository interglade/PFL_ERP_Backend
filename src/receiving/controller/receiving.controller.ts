import { inject } from 'inversify';
import { controller, httpGet, next, request, requestParam, response } from 'inversify-express-utils';
import { NextFunction, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { format } from 'date-fns';

import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import logger from '../../utils/logger';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { ReceivingStatusService } from '../service/receivingStatus.service';
import { ArrivalRow, ArrivalsFilter, RECEIVING_STATES, ReceivingSourceType, ReceivingState } from '../receiving.types';
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
  { header: 'AQR', width: 11, get: (r) => r.slots.aqr },
  { header: 'Inward', width: 11, get: (r) => r.slots.inward },
  { header: 'Dump', width: 11, get: (r) => r.slots.dump },
  { header: 'RTV', width: 11, get: (r) => r.slots.rtv ?? 'n/a' },
  { header: 'State', width: 13, get: (r) => r.state },
];

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

function parseArrivalsFilter(query: Request['query']): ArrivalsFilter {
  const filter: ArrivalsFilter = {};

  const locationId = firstString(query.locationId);
  if (locationId) filter.locationId = locationId;

  const state = firstString(query.state);
  if (state) {
    if (!RECEIVING_STATES.includes(state as ReceivingState)) {
      throw new AppError(400, `state must be one of ${RECEIVING_STATES.join(', ')}`);
    }
    filter.state = state as ReceivingState;
  }

  const rawTypes = Array.isArray(query.sourceType) ? query.sourceType : query.sourceType ? [query.sourceType] : [];
  const types = rawTypes
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
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

  /** Arrivals worklist as .xlsx (same filters and columns as the list, no pagination). */
  @httpGet('/arrivals/excel')
  public async exportArrivals(
    @request() req: Request,
    @response() res: Response,
    @next() nextFn: NextFunction,
  ) {
    try {
      const filter = parseArrivalsFilter(req.query);
      const rows = await this.receivingStatusService.listArrivalsForExport(filter);

      const fileName = `arrivals-${format(new Date(), 'yyyyMMdd')}.xlsx`;
      res.status(200);
      res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Record-Count');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Export-Record-Count', String(rows.length));

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

      for (const row of rows) {
        sheet.addRow(ARRIVAL_COLUMNS.map((column) => column.get(row) ?? null)).commit();
      }
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: ARRIVAL_COLUMNS.length } };
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
