import { inject } from 'inversify';
import { controller, httpGet, httpPost, next, request, requestParam, response } from 'inversify-express-utils';
import { NextFunction, Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { TYPES } from '../../types';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { StockAdjustmentService } from '../adjustment/stockAdjustment.service';
import { availableBatches, documentAllocations, inTransit, LedgerFilter, listBatches, listLedger, StockFilter, stockSummary, traceBatch } from '../batch/stockBatch.queries';

const str = (value: unknown): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

const stockFilter = (q: Request['query']): StockFilter => ({
  companyId: str(q.companyId),
  locationId: str(q.locationId),
  productId: str(q.productId),
  variantId: str(q.variantId),
  uomId: str(q.uomId),
  stockType: str(q.stockType),
  search: str(q.search),
  inStock: str(q.inStock) === 'false' ? false : true,
  page: Number(str(q.page)) || undefined,
  limit: Number(str(q.limit)) || undefined,
});

/** Batch stock read endpoints (Phase C11 screens, C3 batch picker, C7 in transit). */
@controller('/stock', deserializeUser, requireUser)
export class StockBatchController {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.StockAdjustmentService) private readonly adjustments: StockAdjustmentService,
  ) {}

  /** Batches that can still be allocated, oldest first: `?companyId&locationId&productId&variantId&uomId&stockType`. */
  @httpGet('/batches/available')
  public async available(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const filter = stockFilter(req.query);
      if (!filter.companyId || !filter.locationId || !filter.productId) {
        return res.status(400).json({ status: 'error', message: 'companyId, locationId and productId are required' });
      }
      const data = await availableBatches(this.dataSource.manager, { ...filter, stockType: filter.stockType ?? 'FRESH' });
      res.status(200).json({ status: 'success', data });
    } catch (error) {
      nextFn(error);
    }
  }

  /** Batch Stock: one row per batch (filters: company, location, product, stockType, search, inStock, page, limit). */
  @httpGet('/batches')
  public async batches(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      res.status(200).json({ status: 'success', ...(await listBatches(this.dataSource.manager, stockFilter(req.query))) });
    } catch (error) {
      nextFn(error);
    }
  }

  /** Stock Summary: totals per company, location, product, variant, unit and stock type. */
  @httpGet('/summary')
  public async summary(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      res.status(200).json({ status: 'success', ...(await stockSummary(this.dataSource.manager, stockFilter(req.query))) });
    } catch (error) {
      nextFn(error);
    }
  }

  /** Stock Ledger (filters: stockBatchId, batchNo, company, location, product, docType, from, to, page, limit). */
  @httpGet('/ledger')
  public async ledger(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const q = req.query;
      const filter: LedgerFilter = {
        stockBatchId: str(q.stockBatchId),
        batchNo: str(q.batchNo),
        companyId: str(q.companyId),
        locationId: str(q.locationId),
        productId: str(q.productId),
        docType: str(q.docType),
        from: str(q.from),
        to: str(q.to),
        page: Number(str(q.page)) || undefined,
        limit: Number(str(q.limit)) || undefined,
      };
      res.status(200).json({ status: 'success', ...(await listLedger(this.dataSource.manager, filter)) });
    } catch (error) {
      nextFn(error);
    }
  }

  /** Batches a document's lines hold or took: `?docType=DC_TYPE_CUSTOMER&docId=…` (DC edit / view). */
  @httpGet('/allocations')
  public async allocations(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const docType = str(req.query.docType);
      const docId = str(req.query.docId);
      if (!docType || !docId) return res.status(400).json({ status: 'error', message: 'docType and docId are required' });
      res.status(200).json({ status: 'success', data: await documentAllocations(this.dataSource.manager, docType, docId) });
    } catch (error) {
      nextFn(error);
    }
  }

  /** Batch Trace: where the batch is, how it moved, what pending documents hold. */
  @httpGet('/trace/:batchNo')
  public async trace(@requestParam('batchNo') batchNo: string, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      res.status(200).json({ status: 'success', data: await traceBatch(this.dataSource.manager, batchNo) });
    } catch (error) {
      nextFn(error);
    }
  }

  /** In Transit: approved Stock Transfer DC quantity not yet received / dumped at the destination, per batch. */
  @httpGet('/in-transit')
  public async inTransitList(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const q = req.query;
      const data = await inTransit(this.dataSource.manager, {
        companyId: str(q.companyId),
        locationId: str(q.locationId),
        toLocationId: str(q.toLocationId),
      });
      res.status(200).json({ status: 'success', data });
    } catch (error) {
      nextFn(error);
    }
  }

  // ─── C10 Stock Adjustment / C9 Repack ────────────────────────────────────
  // Approval goes through the standard document approval (like the Dump
  // Register): PATCH /documents/updatesecondlevel/:documentId.

  /** Raise an adjustment: `{ stockBatchId?, companyId?, locationId?, productId?, variantId?, uomId?, batchNo?, stockType?, qtyDelta, kgDelta?, unitCost?, reason, remark? }`. */
  @httpPost('/adjustments')
  public async createAdjustment(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const data = await this.adjustments.createAdjustment(req.body ?? {}, res.locals.user.id);
      res.status(201).json({ status: 'success', data });
    } catch (error) {
      nextFn(error);
    }
  }

  @httpGet('/adjustments')
  public async listAdjustments(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const q = req.query;
      res.status(200).json({ status: 'success', ...(await this.adjustments.list('adjustment', {
        status: str(q.status), locationId: str(q.locationId), page: Number(str(q.page)) || undefined, limit: Number(str(q.limit)) || undefined,
      })) });
    } catch (error) {
      nextFn(error);
    }
  }

  // ─── C9 Repack ───────────────────────────────────────────────────────────

  /** Raise a repack: `{ stockBatchId, fromQty, fromKg?, toUomId, toQty, toKg?, remark? }`. */
  @httpPost('/repacks')
  public async createRepack(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const data = await this.adjustments.createRepack(req.body ?? {}, res.locals.user.id);
      res.status(201).json({ status: 'success', data });
    } catch (error) {
      nextFn(error);
    }
  }

  @httpGet('/repacks')
  public async listRepacks(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const q = req.query;
      res.status(200).json({ status: 'success', ...(await this.adjustments.list('repack', {
        status: str(q.status), locationId: str(q.locationId), page: Number(str(q.page)) || undefined, limit: Number(str(q.limit)) || undefined,
      })) });
    } catch (error) {
      nextFn(error);
    }
  }

}
