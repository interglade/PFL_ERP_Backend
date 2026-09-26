/**
 * The streaming export engine, exercised end to end without a database: a
 * definition is streamed into memory, the bytes are re-opened with ExcelJS and
 * the resulting workbook is inspected the way Excel would read it.
 */

import 'reflect-metadata';
import { PassThrough } from 'stream';
import ExcelJS from 'exceljs';
import { EntityManager } from 'typeorm';

import { streamExportWorkbook, safeSheetName } from '../../excel/export/excelStreamWriter';
import { ExportDefinition, ExportRef } from '../../excel/export/exportTypes';
import {
  MAX_CELL_TEXT,
  addressText,
  exportFileName,
  personName,
  toCalendarDate,
  toCellValue,
  toIstDateTime,
  toNumberOrNull,
} from '../../excel/export/exportValue';

async function run(definition: ExportDefinition, refs: ExportRef[], extra: Partial<Parameters<typeof streamExportWorkbook>[1]> = {}) {
  const output = new PassThrough();
  const parts: Buffer[] = [];
  output.on('data', (part) => parts.push(part));
  const done = new Promise((resolve) => output.on('end', resolve));

  const result = await streamExportWorkbook(definition, {
    manager: {} as EntityManager,
    refs,
    output,
    ...extra,
  });
  await done;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.concat(parts) as any);
  return { workbook, result };
}

type Header = { id: string; no: string; amount: string; createdAt: Date; day: string; ok: boolean; note: string | null };
type Line = { parentId: string; product: string; qty: number };

const HEADERS: Header[] = [
  { id: 'a', no: 'DOC-1', amount: '1234.5', createdAt: new Date('2026-09-15T18:45:00Z'), day: '2026-09-15', ok: true, note: null },
  { id: 'b', no: 'DOC-2', amount: '10', createdAt: new Date('2026-09-14T00:00:00Z'), day: '2026-01-02', ok: false, note: 'badchar' },
];
const LINES: Line[] = [
  { parentId: 'b', product: 'Onion', qty: 3 },
  { parentId: 'a', product: 'Tomato', qty: 1.25 },
  { parentId: 'a', product: 'Potato', qty: 2 },
];

function definition(loadCalls: string[][] = []): ExportDefinition {
  return {
    fileStem: 'Test',
    sheets: [
      {
        name: 'Docs',
        refId: (r: Header) => r.id,
        columns: [
          { header: 'Doc No', maps: 't.no', get: (r: Header) => r.no },
          { header: 'Amount', maps: 't.amount', type: 'amount', get: (r: Header) => r.amount },
          { header: 'Created Date', maps: 't.createdAt', type: 'datetime', get: (r: Header) => r.createdAt },
          { header: 'Day', maps: 't.day', type: 'date', get: (r: Header) => r.day },
          { header: 'OK', maps: 't.ok', type: 'boolean', get: (r: Header) => r.ok },
          { header: 'Note', maps: 't.note', get: (r: Header) => r.note },
        ],
        load: async (ctx) => {
          loadCalls.push(ctx.ids);
          // Deliberately returned in a different order from the refs.
          return HEADERS.filter((h) => ctx.ids.includes(h.id)).reverse();
        },
      },
      {
        name: 'Doc Items',
        refId: (r: Line) => r.parentId,
        columns: [
          { header: 'Product', maps: 'l.product', get: (r: Line) => r.product },
          { header: 'Quantity', maps: 'l.qty', type: 'quantity', get: (r: Line) => r.qty },
        ],
        load: async (ctx) => LINES.filter((l) => ctx.ids.includes(l.parentId)),
      },
    ],
  };
}

const REFS: ExportRef[] = [
  { id: 'a', documentId: 'doc-a' },
  { id: 'b', documentId: 'doc-b' },
];

describe('streamExportWorkbook', () => {
  it('writes one worksheet per sheet with a styled, frozen, filterable header', async () => {
    const { workbook } = await run(definition(), REFS);

    expect(workbook.worksheets.map((w) => w.name)).toEqual(['Docs', 'Doc Items']);

    const docs = workbook.getWorksheet('Docs')!;
    const header = docs.getRow(1);
    expect(header.getCell(1).value).toBe('Doc No');
    expect(header.getCell(1).font?.bold).toBe(true);
    expect(docs.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(docs.autoFilter).toBeTruthy();
  });

  it('keeps the list order of documents, and line order within a document', async () => {
    const { workbook } = await run(definition(), REFS);

    const docs = workbook.getWorksheet('Docs')!;
    expect(docs.getRow(2).getCell(1).value).toBe('DOC-1');
    expect(docs.getRow(3).getCell(1).value).toBe('DOC-2');

    const items = workbook.getWorksheet('Doc Items')!;
    expect([2, 3, 4].map((r) => items.getRow(r).getCell(1).value)).toEqual(['Tomato', 'Potato', 'Onion']);
  });

  it('writes typed cells: numbers from decimal strings, IST datetimes, calendar dates, Yes/No', async () => {
    const { workbook } = await run(definition(), REFS);
    const row = workbook.getWorksheet('Docs')!.getRow(2);

    expect(row.getCell(2).value).toBe(1234.5);
    expect(row.getCell(2).numFmt).toBe('#,##0.00');

    // 18:45 UTC is 00:15 the next day in IST.
    const created = row.getCell(3).value as Date;
    expect(created).toBeInstanceOf(Date);
    expect(created.toISOString()).toBe('2026-09-16T00:15:00.000Z');
    expect(row.getCell(3).numFmt).toBe('dd-mm-yyyy hh:mm AM/PM');

    expect((row.getCell(4).value as Date).toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(row.getCell(5).value).toBe('Yes');
    expect(row.getCell(6).value).toBeNull();
  });

  it('strips characters that would corrupt the file', async () => {
    const { workbook } = await run(definition(), REFS);
    expect(workbook.getWorksheet('Docs')!.getRow(3).getCell(6).value).toBe('badchar');
  });

  it('loads documents in chunks', async () => {
    const calls: string[][] = [];
    await run(definition(calls), REFS, { chunkSize: 1 });
    expect(calls).toEqual([['a'], ['b']]);
  });

  it('writes header-only sheets when there are no rows', async () => {
    const { workbook, result } = await run(definition(), []);
    expect(result.rowsPerSheet).toEqual({ Docs: 0, 'Doc Items': 0 });
    expect(workbook.getWorksheet('Doc Items')!.getRow(1).getCell(1).value).toBe('Product');
  });

  it('rolls over to a new sheet past the per-sheet row limit', async () => {
    const { workbook, result } = await run(definition(), REFS, { maxDataRowsPerSheet: 2 });
    expect(result.rowsPerSheet).toEqual({ Docs: 2, 'Doc Items': 2, 'Doc Items (2)': 1 });
    expect(workbook.getWorksheet('Doc Items (2)')!.getRow(2).getCell(1).value).toBe('Onion');
  });

  it('stops when the client disconnects', async () => {
    await expect(run(definition(), REFS, { isAborted: () => true })).rejects.toThrow('aborted');
  });
});

describe('export value helpers', () => {
  it('parses numbers defensively', () => {
    expect(toNumberOrNull('1,250.75')).toBe(1250.75);
    expect(toNumberOrNull('')).toBeNull();
    expect(toNumberOrNull('abc')).toBeNull();
    expect(toNumberOrNull(null)).toBeNull();
  });

  it('never shifts a calendar date', () => {
    expect(toCalendarDate('2026-03-01')!.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(toCalendarDate(null)).toBeNull();
    expect(toCalendarDate('not a date')).toBeNull();
  });

  it('shows timestamps as IST wall-clock time', () => {
    expect(toIstDateTime(new Date('2026-09-15T06:30:00Z'))!.toISOString()).toBe('2026-09-15T12:00:00.000Z');
  });

  it('caps text at the Excel cell limit', () => {
    expect((toCellValue('text', 'x'.repeat(MAX_CELL_TEXT + 10)) as string).length).toBe(MAX_CELL_TEXT);
  });

  it('formats people, addresses and file names', () => {
    expect(personName({ firstName: 'Asha', middleName: null, lastName: 'Patil' })).toBe('Asha Patil');
    expect(personName(null)).toBeNull();
    expect(addressText({ address1: 'Plot 4', city: 'Pune', pincode: '411001' })).toBe('Plot 4, Pune, 411001');
    expect(exportFileName('Final Invoice', new Date('2026-09-15T20:00:00Z'))).toBe('Final_Invoice_2026-09-16.xlsx');
  });

  it('makes sheet names Excel-safe and unique', () => {
    const taken = new Set<string>();
    expect(safeSheetName('Items: A/B', taken)).toBe('Items  A B');
    expect(safeSheetName('Items: A/B', taken)).toBe('Items  A B (2)');
    expect(safeSheetName('x'.repeat(40), taken)).toHaveLength(31);
  });
});
