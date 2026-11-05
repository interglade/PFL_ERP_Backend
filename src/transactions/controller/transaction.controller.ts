/**
 * Transactions (docs/transaction-tracking-plan.md §9.5). Read only; every
 * route needs a login and the `transactions` permission (view / export).
 */

import { inject } from 'inversify';
import { controller, httpGet, next, request, requestParam, response } from 'inversify-express-utils';
import { NextFunction, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { format } from 'date-fns';

import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { checkPermission } from '../../middleware/checkPermission';
import { TransactionService, TXN_EXPORT_MAX_ROWS } from '../service/transaction.service';
import { TXN_TYPE_LABEL, TxnDetail, TxnLedgerRow, TxnListRow } from '../transaction.types';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const STATUS_TITLE: Record<string, string> = { open: 'Open', closed: 'Closed', cancelled: 'Cancelled' };

type Cell = string | number | Date | null;

/** Header row style used by the other exports. */
function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Array<{ header: string; width: number; numFmt?: string }>, rows: Cell[][]): void {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((c, i) => ({ key: `c${i}`, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  const header = sheet.addRow(columns.map((c) => c.header));
  header.height = 24;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.numFmt = 'General';
  });
  for (const row of rows) sheet.addRow(row);
  if (rows.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };
}

const dateCell = (value: string | null): Date | null => (value ? new Date(value) : null);
const KG = '#,##0.000';
const RS = '#,##0.00';
const DATE = 'dd-mm-yyyy hh:mm';

const LIST_COLUMNS: Array<{ header: string; width: number; numFmt?: string; get: (r: TxnListRow) => Cell }> = [
  { header: 'Transaction No', width: 16, get: (r) => r.txnNo },
  { header: 'Type', width: 14, get: (r) => TXN_TYPE_LABEL[r.type] },
  { header: 'Status', width: 11, get: (r) => STATUS_TITLE[r.status] ?? r.status },
  { header: 'Current step', width: 30, get: (r) => r.stageLabel },
  { header: 'Started on', width: 17, numFmt: DATE, get: (r) => dateCell(r.openedAt) },
  { header: 'Closed on', width: 17, numFmt: DATE, get: (r) => dateCell(r.closedAt) },
  { header: 'Days open', width: 10, get: (r) => r.daysOpen },
  { header: 'Origin document', width: 20, get: (r) => r.origin.docNo },
  { header: 'Party', width: 28, get: (r) => r.partyName },
  { header: 'Company', width: 24, get: (r) => r.companyName },
  { header: 'Location', width: 22, get: (r) => r.locationName },
  { header: 'To location', width: 22, get: (r) => r.toLocationName },
  { header: 'Products', width: 10, get: (r) => r.productCount },
  { header: 'Quantity', width: 12, numFmt: KG, get: (r) => r.totalQty },
  { header: 'Net kg', width: 12, numFmt: KG, get: (r) => r.totalKg },
  { header: 'Value (Rs)', width: 14, numFmt: RS, get: (r) => r.totalValue },
];

function sendWorkbook(res: Response, workbook: ExcelJS.Workbook, fileName: string): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Record-Count, X-Export-Total-Count, X-Export-Truncated');
  res.setHeader('Cache-Control', 'no-store');
  return workbook.xlsx.write(res).then(() => {
    res.end();
  });
}

function newWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Prime Fresh ERP';
  workbook.created = new Date();
  return workbook;
}

function detailWorkbook(d: TxnDetail, ledger: TxnLedgerRow[]): ExcelJS.Workbook {
  const workbook = newWorkbook();
  const overview: Cell[][] = [
    ['Transaction No', d.txnNo],
    ['Type', TXN_TYPE_LABEL[d.type]],
    ['Status', STATUS_TITLE[d.status] ?? d.status],
    ['Current step', d.stageLabel],
    ['Started on', dateCell(d.openedAt)],
    ['Closed on', dateCell(d.closedAt)],
    ['Cancelled on', dateCell(d.cancelledAt)],
    ['Days open', d.daysOpen],
    ['Party', d.partyName],
    ['Company', d.companyName],
    ['Location', d.locationName],
    ['To location', d.toLocationName],
    ['Products', d.productCount],
    ['Quantity', d.totalQty],
    ['Net kg', d.totalKg],
    ['Value (Rs)', d.totalValue],
    [],
    ['Steps', null],
    ...d.steps.map((s): Cell[] => [`${s.label}${s.side ? ' (side step)' : ''}`, s.state]),
    [],
    ['Money', null],
    ...d.money.map((m): Cell[] => [m.label, m.amount]),
    [],
    ['Related transactions', null],
    ...d.links.map((l): Cell[] => [`${l.direction === 'from' ? 'From' : 'To'} ${l.txnNo} (${TXN_TYPE_LABEL[l.type]}, ${l.kind})`, `${l.batchNo ?? ''} qty ${l.qty} / ${l.netKg} kg`.trim()]),
  ];
  const sheet = workbook.addWorksheet('Overview');
  sheet.columns = [{ width: 34 }, { width: 40 }];
  for (const row of overview) {
    const added = sheet.addRow(row);
    if (row.length === 2 && row[1] === null && row[0]) added.font = { bold: true };
    if (row[1] instanceof Date) added.getCell(2).numFmt = DATE;
  }

  addSheet(
    workbook,
    'Documents',
    [
      { header: 'Document', width: 20 }, { header: 'Number', width: 22 }, { header: 'Step', width: 18 },
      { header: 'Status', width: 14 }, { header: 'Created on', width: 17, numFmt: DATE }, { header: 'Created by', width: 24 },
    ],
    [
      ...d.documents.map((doc): Cell[] => [doc.docTypeLabel, doc.docNo, doc.step, doc.status, dateCell(doc.createdAt), doc.createdBy]),
      ...d.related.map((r): Cell[] => [r.label, r.no, r.kind, r.status, dateCell(r.date), r.amount === null ? null : `Rs ${r.amount}`]),
    ],
  );

  addSheet(
    workbook,
    'Quantities',
    [{ header: 'Product', width: 26 }, { header: 'Variant', width: 18 }, { header: 'Unit', width: 10 }, ...d.quantityColumns.map((c) => ({ header: c.label, width: 16, numFmt: KG }))],
    d.quantities.map((q): Cell[] => [q.productName, q.variantName, q.uomName, ...d.quantityColumns.map((c) => q.values[c.key] ?? null)]),
  );

  addSheet(
    workbook,
    'Ledger',
    [
      { header: 'Posted at', width: 17, numFmt: DATE }, { header: 'Movement', width: 18 }, { header: 'Document', width: 20 },
      { header: 'Batch', width: 18 }, { header: 'Location', width: 22 }, { header: 'Product', width: 24 }, { header: 'Variant', width: 16 },
      { header: 'Unit', width: 10 }, { header: 'Qty in', width: 12, numFmt: KG }, { header: 'Qty out', width: 12, numFmt: KG },
      { header: 'Kg in', width: 12, numFmt: KG }, { header: 'Kg out', width: 12, numFmt: KG }, { header: 'Value (Rs)', width: 14, numFmt: RS },
    ],
    ledger.map((l): Cell[] => [
      dateCell(l.postedAt), l.movementType, l.docNo, l.batchNo, l.locationName, l.productName, l.variantName, l.uomName,
      l.qtyIn, l.qtyOut, l.netKgIn, l.netKgOut, l.value,
    ]),
  );
  return workbook;
}

@controller('/transactions', deserializeUser, requireUser)
export class TransactionController {
  constructor(@inject(TYPES.TransactionService) private readonly transactionService: TransactionService) {}

  @httpGet('/', checkPermission('transactions', 'view'))
  public async list(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const filter = TransactionService.parseFilter(req.query as Record<string, unknown>);
      const result = await this.transactionService.list(filter);
      res.status(200).json({
        status: 'success',
        data: result.data,
        allRecords: result.total,
        totalPages: Math.ceil(result.total / filter.limit),
        page: filter.page,
      });
    } catch (error) {
      nextFn(error);
    }
  }

  @httpGet('/summary', checkPermission('transactions', 'view'))
  public async summary(@request() _req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      res.status(200).json({ status: 'success', data: await this.transactionService.summary() });
    } catch (error) {
      nextFn(error);
    }
  }

  @httpGet('/search', checkPermission('transactions', 'view'))
  public async search(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      res.status(200).json({ status: 'success', data: await this.transactionService.search(q) });
    } catch (error) {
      nextFn(error);
    }
  }

  @httpGet('/excel', checkPermission('transactions', 'export'))
  public async exportList(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const { page, limit, ...filter } = TransactionService.parseFilter(req.query as Record<string, unknown>);
      const { rows, total } = await this.transactionService.exportRows(filter);
      const workbook = newWorkbook();
      addSheet(workbook, 'Transactions', LIST_COLUMNS, rows.map((r) => LIST_COLUMNS.map((c) => c.get(r))));
      if (total > rows.length) {
        const sheet = workbook.getWorksheet('Transactions');
        sheet?.addRow([]);
        sheet?.addRow([`Only the first ${TXN_EXPORT_MAX_ROWS} of ${total} rows were exported. Narrow the filters to export the rest.`]);
        res.setHeader('X-Export-Truncated', 'true');
      }
      res.setHeader('X-Export-Record-Count', String(rows.length));
      res.setHeader('X-Export-Total-Count', String(total));
      await sendWorkbook(res, workbook, `transactions-${format(new Date(), 'yyyyMMdd')}.xlsx`);
    } catch (error) {
      nextFn(error);
    }
  }

  @httpGet('/:txnNo/ledger', checkPermission('transactions', 'view'))
  public async ledger(@requestParam('txnNo') txnNo: string, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      res.status(200).json({ status: 'success', data: await this.transactionService.ledger(txnNo) });
    } catch (error) {
      nextFn(error);
    }
  }

  @httpGet('/:txnNo/excel', checkPermission('transactions', 'export'))
  public async exportOne(@requestParam('txnNo') txnNo: string, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const detail = await this.transactionService.detail(txnNo);
      const ledger = await this.transactionService.ledger(txnNo);
      await sendWorkbook(res, detailWorkbook(detail, ledger), `transaction-${detail.txnNo}.xlsx`);
    } catch (error) {
      nextFn(error);
    }
  }

  @httpGet('/:txnNo', checkPermission('transactions', 'view'))
  public async detail(@requestParam('txnNo') txnNo: string, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      if (!txnNo) throw new AppError(400, 'Transaction number is required');
      res.status(200).json({ status: 'success', data: await this.transactionService.detail(txnNo) });
    } catch (error) {
      nextFn(error);
    }
  }
}
