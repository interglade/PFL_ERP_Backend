import { inject } from 'inversify';
import { controller, httpGet, next, request, response } from 'inversify-express-utils';
import { NextFunction, Request, Response } from 'express';
import { ParsedQs } from 'qs';
import { DataSource, In } from 'typeorm';
import { TYPES } from '../../types';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import AppError from '../../utils/appError';
import { ControllerLogger } from '../../utils/controllerLogger';
import { PaginationOptions } from '../../utils/pagination';
import { Documentb, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { DocumentExportService } from '../../excel/export/documentExport.service';
import { EXPORT_ALL_ROWS } from '../../excel/export/exportRequest';
import { applyDocumentListFilters } from '../../global/filters/documentListOptions';
import { COMMON_FILTERS, supportedFilterParams } from '../../global/filters/documentFilter.parser';
import { MultiCashVoucherService } from '../multiCashV/service/multiCashVoucher.service';
import { LabourPaymentVoucherService } from '../labourPaymentV/service/labourPaymentVoucher.service';
import { TPVoucherService } from '../tranportPaymentV/service/transportPaymentV.service';
import { PMPVoucherService } from '../paymentMaterialV/service/pmpvoucher.service';
import { ALL_VOUCHERS_EXPORT } from '../excel/allVouchers.export';
import { VOUCHER_KINDS, VOUCHER_TYPE_LABELS } from '../excel/voucherCommon.export';
import { isAdminUser } from '../../utils/isAdminUser';

/** A voucher list row (each type's own DTO) tagged with its voucher type. */
type VoucherRow = Record<string, unknown> & { id?: string | null; documentId?: string | null; voucherType: string; voucherTypeLabel: string };
type VoucherSource = {
  kind: string;
  documentType: string;
  fetch: (options: PaginationOptions, userId: string, isAdmin: boolean) => Promise<{ data: object[] } | null | undefined>;
};

/**
 * All voucher types together. Each type's rows come from that type's own list
 * service, with the same common filters, for the logged-in user - so visibility and
 * filtering match the four voucher list pages exactly.
 *
 * Extra parameter: `voucherType` = multi-cash-voucher, labour-payment-voucher,
 * transport-payment-voucher, packing-material-voucher (comma separated).
 * A filter that only some voucher types have (e.g. `vehicleNo`) excludes the types
 * without it rather than being ignored for them.
 */
@controller('/vouchers', deserializeUser, requireUser)
export class VouchersController {
  constructor(
    @inject(TYPES.MultiCashVoucherService) private readonly multiCashVoucherService: MultiCashVoucherService,
    @inject(TYPES.LabourPaymentVoucherService) private readonly labourPaymentVoucherService: LabourPaymentVoucherService,
    @inject(TYPES.TPVoucherService) private readonly tpVoucherService: TPVoucherService,
    @inject(TYPES.PMPVoucherService) private readonly pmpVoucherService: PMPVoucherService,
    @inject(TYPES.DocumentExportService) private readonly documentExportService: DocumentExportService,
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
  ) {}

  private sources(): VoucherSource[] {
    return [
      { kind: VOUCHER_KINDS.MULTI_CASH, documentType: DocumentTypeEnum.MULTI_CASH_VOUCHER, fetch: (o, u, a) => this.multiCashVoucherService.getAllVouchers(o, u, a) },
      { kind: VOUCHER_KINDS.LABOUR_PAYMENT, documentType: DocumentTypeEnum.LABOR_PAYMENT_VOUCHER, fetch: (o, u, a) => this.labourPaymentVoucherService.getLPVouchers(o, u, a) },
      { kind: VOUCHER_KINDS.TRANSPORT_PAYMENT, documentType: DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER, fetch: (o, u, a) => this.tpVoucherService.getAllTPVouchers(o, u, a) },
      { kind: VOUCHER_KINDS.PACKING_MATERIAL, documentType: DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER, fetch: (o, u, a) => this.pmpVoucherService.getAllVouchers(o, u, a) },
    ];
  }

  /** Voucher types the request can match: `voucherType`, minus types lacking a requested filter. */
  private selectSources(query: ParsedQs): VoucherSource[] {
    const all = this.sources();
    const raw = typeof query.voucherType === 'string' ? query.voucherType.trim() : '';
    let selected = all;
    if (raw) {
      const allowed = Object.values(VOUCHER_KINDS) as string[];
      const wanted = raw.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
      const bad = wanted.find((v) => !allowed.includes(v));
      if (bad) throw new AppError(400, `Invalid voucherType '${bad}'. Allowed values: ${allowed.join(', ')}`);
      selected = all.filter((s) => wanted.includes(s.kind));
    }

    const common = new Set([...COMMON_FILTERS.map((f) => f.param), 'sortBy', 'sortOrder', 'dateFrom', 'dateTo', 'page', 'limit', 'voucherType']);
    const supported = new Map(all.map((s) => [s.kind, supportedFilterParams(s.documentType)]));
    const anyVoucherParam = new Set(all.flatMap((s) => [...supported.get(s.kind)!]));
    const requested = Object.keys(query).filter((k) => !common.has(k) && anyVoucherParam.has(k) && String(query[k] ?? '').trim() !== '');
    return selected.filter((s) => requested.every((param) => supported.get(s.kind)!.has(param)));
  }

  /** Every matching row across the selected voucher types, tagged with its type, in list order. */
  private async loadRows(query: ParsedQs, userId: string, isAdmin: boolean): Promise<VoucherRow[]> {
    const sources = this.selectSources(query);
    const parts = await Promise.all(
      sources.map(async (source) => {
        const options: PaginationOptions = {
          page: 1,
          limit: EXPORT_ALL_ROWS,
          filters: {},
          searchFields: ['"voucher.voucherNo",'],
          search: typeof query.search === 'string' ? query.search : '',
          sort: typeof query.sort === 'string' ? query.sort : undefined,
        };
        applyDocumentListFilters(options, query, source.documentType);
        const result = await source.fetch(options, userId, isAdmin);
        return (result?.data ?? []).map((row): VoucherRow => ({ ...row, voucherType: source.kind, voucherTypeLabel: VOUCHER_TYPE_LABELS[source.kind] }));
      }),
    );
    const rows = parts.flat();

    // Each type is already filtered and authorised in SQL; merging four lists into one
    // order has to happen here. Newest documents first unless `sort` names a row field.
    const sortRaw = typeof query.sort === 'string' ? query.sort : typeof query.sortBy === 'string' ? `${query.sortBy}:${query.sortOrder ?? ''}` : '';
    const sortKey = sortRaw.split(',')[0].split(':')[0].trim();
    const sortDir = /:desc$/i.test(sortRaw.split(',')[0].trim()) ? -1 : 1;
    if (sortKey && rows.some((r) => r[sortKey] !== undefined)) {
      rows.sort((a, b) => {
        const va = a[sortKey];
        const vb = b[sortKey];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const na = Number(va);
        const nb = Number(vb);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * sortDir;
        return String(va).localeCompare(String(vb)) * sortDir;
      });
    } else {
      const ids = rows.map((r) => r.documentId).filter((id): id is string => Boolean(id));
      const docs = ids.length
        ? await this.dataSource.getRepository(Documentb).find({ select: ['id', 'createdAt'], where: { id: In(ids) } })
        : [];
      const createdAt = new Map(docs.map((d) => [d.id, new Date(d.createdAt).getTime()]));
      rows.sort((a, b) => (createdAt.get(String(b.documentId)) ?? 0) - (createdAt.get(String(a.documentId)) ?? 0));
    }
    return rows;
  }

  /**
   * GET /vouchers
   * The four voucher lists merged. Query: the common document filters, voucher
   * filters, `voucherType`, `sort`, `page`, `limit`.
   */
  @httpGet('/')
  public async getAllVouchers(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const userId = res.locals.user?.id;
      if (!userId) throw new AppError(401, 'User not authenticated');

      const rows = await this.loadRows(req.query, userId, isAdminUser(res));

      const page = Number(req.query.page) || 0;
      const limit = Number(req.query.limit) || 0;
      const total = rows.length;
      const data = page > 0 && limit > 0 ? rows.slice((page - 1) * limit, page * limit) : rows;

      ControllerLogger.logGetAllRecords('All Vouchers', req, res);
      return res.status(200).json({
        status: 'success',
        data,
        allRecords: total,
        totalPages: page > 0 && limit > 0 ? Math.ceil(total / limit) : 1,
        page: page || 1,
      });
    } catch (error) {
      ControllerLogger.logError('All Vouchers list retrieval', error, req, res);
      next(error);
    }
  }

  /**
   * GET /vouchers/export/excel
   * Same query parameters and rows as GET /vouchers, without pagination.
   */
  @httpGet('/export/excel')
  public async exportToExcel(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    return this.documentExportService.export(req, res, next, {
      entityName: 'All Vouchers',
      definition: ALL_VOUCHERS_EXPORT,
      fetchList: async (_options, userId) => {
        const rows = await this.loadRows(req.query, userId, isAdminUser(res));
        return { data: rows.map((row) => ({ id: row.id, documentId: row.documentId, kind: row.voucherType })) };
      },
      // TEMP: testing only, revert after
//fetchList: async () => ({ data: [{ id: '00000000-0000-0000-0000-000000000000', documentId: null, kind: 'multi-cash-voucher' }] }),

    });
  }
}
