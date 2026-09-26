/**
 * Streams an `ExportDefinition` into an .xlsx written straight to a writable
 * stream (the HTTP response), keeping memory bounded regardless of export size.
 *
 * Why sheets are written one after another: ExcelJS' streaming writer appends
 * each worksheet to the zip as a queued entry, so rows added to sheet 2 while
 * sheet 1 is still open are buffered in memory until sheet 1 is committed.
 * Writing each sheet completely (all chunks) before starting the next keeps only
 * one chunk of rows in memory at a time. Each sheet runs its own lean query per
 * chunk, which also avoids a header x line-item cartesian join.
 */

import { once } from 'events';
import { Writable } from 'stream';
import ExcelJS from 'exceljs';
import { EntityManager } from 'typeorm';
import { ExportDefinition, ExportLoadContext, ExportRef, ExportSheet } from './exportTypes';
import { chunk } from './exportQuery';
import { defaultWidthFor, numFmtFor, toCellValue } from './exportValue';

/** Documents loaded per query. Keeps `IN (...)` lists and per-chunk memory small. */
export const EXPORT_CHUNK_SIZE = 500;

/** Excel's row limit is 1,048,576; one row is the header. */
export const MAX_DATA_ROWS_PER_SHEET = 1_048_575;

/** Same header look as the master-data exports in `../excelFile.service.ts`. */
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };

/** Thrown when the client disconnects mid-export, so the caller stops querying. */
export class ExportAbortedError extends Error {
  constructor() {
    super('Export aborted: the client closed the connection');
    Object.setPrototypeOf(this, ExportAbortedError.prototype);
  }
}

export interface StreamExportOptions {
  manager: EntityManager;
  refs: ExportRef[];
  output: Writable;
  chunkSize?: number;
  /** Test hook: a lower per-sheet row limit to exercise sheet rollover. */
  maxDataRowsPerSheet?: number;
  /** Returns true once the client has gone away. */
  isAborted?: () => boolean;
}

export interface StreamExportResult {
  /** Data rows written per sheet name (including rollover sheets). */
  rowsPerSheet: Record<string, number>;
}

/** Excel forbids `\ / ? * [ ] :` in sheet names and caps them at 31 characters. */
export function safeSheetName(name: string, taken: Set<string>): string {
  const base = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

async function waitForDrain(output: Writable): Promise<void> {
  if ((output as any).writableNeedDrain) {
    await Promise.race([once(output, 'drain'), once(output, 'close')]);
  }
}

function openWorksheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  sheet: ExportSheet,
  name: string,
): ExcelJS.Worksheet {
  const worksheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Column-level formats are inherited by every data cell in the column.
  worksheet.columns = sheet.columns.map((column, index) => {
    const numFmt = numFmtFor(column.type);
    return {
      key: `c${index}`,
      width: column.width ?? defaultWidthFor(column.type, column.header),
      style: numFmt ? { numFmt } : {},
    };
  });

  const header = worksheet.addRow(sheet.columns.map((column) => column.header));
  header.height = 28;
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    // Header cells must not inherit a date/number format from their column.
    cell.numFmt = 'General';
  });
  header.commit();
  return worksheet;
}

function closeWorksheet(worksheet: ExcelJS.Worksheet, columnCount: number, dataRows: number): void {
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: dataRows + 1, column: Math.max(columnCount, 1) },
  };
  worksheet.commit();
}

function orderByRefs<T>(sheet: ExportSheet<T>, refs: ExportRef[], rows: T[]): T[] {
  const byRef = new Map<string, T[]>();
  for (const row of rows) {
    const id = sheet.refId(row);
    if (!id) continue;
    const bucket = byRef.get(id);
    if (bucket) bucket.push(row);
    else byRef.set(id, [row]);
  }
  const ordered: T[] = [];
  for (const ref of refs) {
    const bucket = byRef.get(ref.id);
    if (bucket) ordered.push(...bucket);
  }
  return ordered;
}

export async function streamExportWorkbook(
  definition: ExportDefinition,
  options: StreamExportOptions,
): Promise<StreamExportResult> {
  const chunkSize = options.chunkSize ?? EXPORT_CHUNK_SIZE;
  const maxRows = options.maxDataRowsPerSheet ?? MAX_DATA_ROWS_PER_SHEET;
  const isAborted = options.isAborted ?? (() => false);
  const refChunks = chunk(options.refs, chunkSize);

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: options.output,
    useStyles: true,
    // Shared strings would hold every distinct string in memory until commit.
    useSharedStrings: false,
  });
  workbook.creator = 'Prime Fresh ERP';
  workbook.created = new Date();

  const rowsPerSheet: Record<string, number> = {};
  const takenNames = new Set<string>();

  for (const sheet of definition.sheets) {
    let name = safeSheetName(sheet.name, takenNames);
    let worksheet = openWorksheet(workbook, sheet, name);
    let dataRows = 0;
    rowsPerSheet[name] = 0;

    for (const refs of refChunks) {
      if (isAborted()) throw new ExportAbortedError();

      const ctx: ExportLoadContext = {
        manager: options.manager,
        refs,
        ids: refs.map((ref) => ref.id),
        documentIds: refs.map((ref) => ref.documentId).filter((id): id is string => Boolean(id)),
      };
      const rows = orderByRefs(sheet, refs, await sheet.load(ctx));

      for (const row of rows) {
        if (dataRows >= maxRows) {
          // Past Excel's row limit: finish this sheet and continue on "<name> (2)".
          closeWorksheet(worksheet, sheet.columns.length, dataRows);
          name = safeSheetName(sheet.name, takenNames);
          worksheet = openWorksheet(workbook, sheet, name);
          dataRows = 0;
          rowsPerSheet[name] = 0;
        }
        worksheet
          .addRow(sheet.columns.map((column) => toCellValue(column.type, column.get(row))))
          .commit();
        dataRows++;
        rowsPerSheet[name]++;
      }

      await waitForDrain(options.output);
    }

    closeWorksheet(worksheet, sheet.columns.length, dataRows);
  }

  await workbook.commit();
  return { rowsPerSheet };
}
