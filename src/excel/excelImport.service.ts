/**
 * Reads an uploaded spreadsheet into header-keyed rows using the same column
 * map the exporter writes, so a file exported from the app imports back cleanly.
 *
 * Headers are matched case-insensitively and whitespace-insensitively, because
 * Excel silently introduces trailing spaces and users retype headers by hand.
 */

import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import {
  ExcelColumn,
  ExcelColumnGroup,
  ExcelSheetDefinition,
  groupHeader,
} from './excelColumn';
import { coerceCell, toText } from './excelValue';
import { downloadFromSpaces } from './excelFile.service';

/**
 * Sheets an export/template carries alongside the data: the documentation sheet
 * and the hidden sheet backing the dropdowns. Neither ever holds records.
 */
const NON_DATA_SHEETS = new Set(['instructions', 'lists']);

function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** One spreadsheet row, addressed by the human-readable headers. */
export class ExcelRow {
  constructor(
    /** 1-based row number as shown in Excel, used in error messages. */
    readonly rowNumber: number,
    private readonly values: Map<string, unknown>,
  ) {}

  /** Raw cell for a header, before any type coercion. */
  raw(header: string): unknown {
    return this.values.get(normaliseHeader(header));
  }

  /** Trimmed text for a header, or null when blank. */
  text(header: string): string | null {
    return toText(this.raw(header));
  }

  /**
   * Raw cell for a column, falling back to the column's accepted aliases so a
   * sheet written against an older header spelling still imports.
   */
  private rawFor(column: ExcelColumn, header: string): unknown {
    const direct = this.raw(header);
    if (toText(direct) !== null) return direct;

    for (const alias of column.aliases ?? []) {
      // Rebuild the alias in the same shape as `header`, so an alias also works
      // inside a repeating block (`Crop2.Middl Name` for `Crop2.Middle Name`).
      const aliasHeader = header.endsWith(column.header)
        ? header.slice(0, header.length - column.header.length) + alias
        : alias;
      const value = this.raw(aliasHeader);
      if (toText(value) !== null) return value;
    }

    return direct;
  }

  /** Cell coerced to the type the column declares. */
  cell<T = unknown>(column: ExcelColumn): T {
    return coerceCell(column, this.rawFor(column, column.header)) as T;
  }

  /** Cell for one column inside a repeating block, e.g. `Variant2.Size`. */
  groupCell<T = unknown>(
    group: Pick<ExcelColumnGroup, 'prefix'>,
    index: number,
    column: ExcelColumn,
  ): T {
    const header = groupHeader(group, index, column.header);
    return coerceCell(column, this.rawFor(column, header)) as T;
  }

  /** True when every column in the row is blank. */
  isEmpty(): boolean {
    for (const value of this.values.values()) {
      if (toText(value) !== null) return false;
    }
    return true;
  }

  /**
   * Walks the repeating blocks of a group (`Crop1.`, `Crop2.`, ...), calling
   * `read` for each block that has any value in it.
   *
   * Presence is decided on *any* column being filled rather than only the key
   * column, so a variant entered with a size but no count is still imported.
   * Scanning stops after `stopAfterGaps` consecutive empty blocks, so a hole in
   * the middle of a hand-edited sheet does not truncate the rest of the blocks.
   */
  eachGroupBlock<T>(
    group: ExcelColumnGroup,
    read: (index: number) => T | null,
    stopAfterGaps = 3,
  ): T[] {
    const results: T[] = [];
    let gaps = 0;

    for (let index = 1; gaps < stopAfterGaps; index++) {
      const hasAnyValue = group.columns.some((column) =>
        [column.header, ...(column.aliases ?? [])].some(
          (name) => this.text(groupHeader(group, index, name)) !== null,
        ),
      );

      if (!hasAnyValue) {
        gaps++;
        continue;
      }

      gaps = 0;
      const parsed = read(index);
      if (parsed !== null) results.push(parsed);
    }

    return results;
  }
}

export interface ImportIssue {
  /** Excel row number, so the user can jump straight to it. */
  row: number;
  reason: string;
}

export interface ImportSummary {
  totalRows: number;
  created: number;
  skipped: ImportIssue[];
  failed: ImportIssue[];
  /** Headers in the file the importer does not recognise - usually typos. */
  unknownColumns: string[];
  /** Required headers the file is missing entirely. */
  missingColumns: string[];
}

export function emptySummary(): ImportSummary {
  return {
    totalRows: 0,
    created: 0,
    skipped: [],
    failed: [],
    unknownColumns: [],
    missingColumns: [],
  };
}

export interface ParsedSheet {
  rows: ExcelRow[];
  unknownColumns: string[];
  missingColumns: string[];
}

/** Every header the definition can produce, used to flag typos in the upload. */
function knownHeaders(def: ExcelSheetDefinition): Set<string> {
  const headers = new Set<string>();

  for (const column of def.columns) {
    headers.add(normaliseHeader(column.header));
    for (const alias of column.aliases ?? []) headers.add(normaliseHeader(alias));
  }

  for (const group of def.groups ?? []) {
    // Allow more blocks than an export writes - a user may add Crop9 by hand.
    const limit = Math.max(group.maxOnExport, 20);
    for (let index = 1; index <= limit; index++) {
      for (const column of group.columns) {
        headers.add(normaliseHeader(groupHeader(group, index, column.header)));
        for (const alias of column.aliases ?? []) {
          headers.add(normaliseHeader(groupHeader(group, index, alias)));
        }
      }
    }
  }

  return headers;
}

/**
 * A worksheet reduced to a header row plus numbered data rows, so the same
 * matching logic serves both the .xlsx reader and the legacy .xls reader.
 */
interface RawSheet {
  headers: string[];
  rows: { rowNumber: number; cells: unknown[] }[];
}

/** Applies the column map to an already-flattened sheet. */
function parseRawSheet(sheet: RawSheet, def: ExcelSheetDefinition): ParsedSheet {
  const { headers } = sheet;

  if (!headers.some(Boolean)) {
    throw new Error('The first row of the uploaded file must contain column names');
  }

  const known = knownHeaders(def);
  const present = new Set(headers.filter(Boolean).map(normaliseHeader));

  const unknownColumns = headers
    .filter(Boolean)
    .filter((header) => !known.has(normaliseHeader(header)));

  const missingColumns = def.columns
    .filter(
      (column) =>
        column.required &&
        !present.has(normaliseHeader(column.header)) &&
        !(column.aliases ?? []).some((alias) => present.has(normaliseHeader(alias))),
    )
    .map((column) => column.header);

  const rows: ExcelRow[] = [];

  for (const row of sheet.rows) {
    const values = new Map<string, unknown>();
    headers.forEach((header, index) => {
      if (!header) return;
      values.set(normaliseHeader(header), row.cells[index]);
    });

    const parsed = new ExcelRow(row.rowNumber, values);
    if (!parsed.isEmpty()) rows.push(parsed);
  }

  return { rows, unknownColumns, missingColumns };
}

/** Flattens the first data worksheet of an ExcelJS (.xlsx) workbook. */
function flattenExcelJsWorkbook(workbook: ExcelJS.Workbook): RawSheet {
  const sheet =
    workbook.worksheets.find(
      (candidate) => !NON_DATA_SHEETS.has(normaliseHeader(candidate.name)),
    ) ?? workbook.worksheets[0];

  if (!sheet) {
    throw new Error('The uploaded file has no worksheets');
  }

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber - 1] = toText(cell.value) ?? '';
  });

  const rows: { rowNumber: number; cells: unknown[] }[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const cells = headers.map((_header, index) => {
      const cell = row.getCell(index + 1);
      // `cell.value` is a formula object for computed cells; prefer the result.
      return cell.value && typeof cell.value === 'object' && 'result' in cell.value
        ? (cell.value as ExcelJS.CellFormulaValue).result
        : cell.value;
    });

    rows.push({ rowNumber, cells });
  });

  return { headers, rows };
}

/**
 * Parses the first data worksheet of an .xlsx workbook.
 *
 * The `Instructions` sheet an export carries is skipped, so a user can upload
 * the exact file they downloaded without stripping anything out first.
 */
export function parseWorkbook(
  workbook: ExcelJS.Workbook,
  def: ExcelSheetDefinition,
): ParsedSheet {
  return parseRawSheet(flattenExcelJsWorkbook(workbook), def);
}

/**
 * Flattens a legacy .xls (BIFF) workbook via SheetJS.
 *
 * ExcelJS only reads .xlsx, but staff still circulate .xls files and the
 * previous importers accepted them, so that support is kept here rather than
 * silently rejecting those uploads.
 */
function flattenLegacyWorkbook(buffer: Buffer): RawSheet {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  const sheetName =
    workbook.SheetNames.find(
      (name) => !NON_DATA_SHEETS.has(normaliseHeader(name)),
    ) ?? workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('The uploaded file has no worksheets');
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });

  const [headerRow = [], ...dataRows] = matrix;
  const headers = (headerRow as unknown[]).map((cell) => toText(cell) ?? '');

  return {
    headers,
    // +2 converts a zero-based data index back to the Excel row number the
    // user sees, so reported row numbers match either reader.
    rows: dataRows.map((cells, index) => ({
      rowNumber: index + 2,
      cells: cells as unknown[],
    })),
  };
}

/** .xlsx is a zip, so it always starts with the "PK" local-file-header magic. */
function isXlsx(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** Parses an uploaded workbook buffer, .xlsx or legacy .xls. */
export function parseUploadedBuffer(
  buffer: Buffer,
  def: ExcelSheetDefinition,
): Promise<ParsedSheet> | ParsedSheet {
  if (!isXlsx(buffer)) {
    return parseRawSheet(flattenLegacyWorkbook(buffer), def);
  }

  const workbook = new ExcelJS.Workbook();
  return workbook.xlsx
    .load(buffer as unknown as ArrayBuffer)
    .then(() => parseWorkbook(workbook, def));
}

/**
 * Downloads the uploaded workbook from Spaces and parses it.
 *
 * The caller deletes the file afterwards (see `deleteFromSpaces`) - deletion is
 * deliberately not done here so a parse failure still leaves the file around
 * long enough for the caller to decide.
 */
export async function readUploadedSheet(
  fileUrlOrKey: string,
  def: ExcelSheetDefinition,
): Promise<ParsedSheet> {
  const buffer = await downloadFromSpaces(fileUrlOrKey);
  return parseUploadedBuffer(buffer, def);
}
