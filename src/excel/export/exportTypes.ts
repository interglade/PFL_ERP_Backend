/**
 * Contract for the transaction/document Excel exports (RFPA, GRN, invoices, ...).
 *
 * This is the export-only sibling of the master-data column maps in
 * `../excelColumn.ts`. Those maps are shared with the importer and build a whole
 * workbook in memory; transaction exports are never imported back, span several
 * sheets (header, line items, approvals, history) and can be large, so they are
 * streamed straight to the HTTP response one chunk of documents at a time.
 *
 * A module describes its export once, as an `ExportDefinition`: which sheets
 * exist, which columns each sheet has, and how to load a sheet's rows for a
 * chunk of documents. The engine (`excelStreamWriter.ts`) does everything else.
 */

import { EntityManager } from 'typeorm';

/**
 * How a cell is written and formatted.
 *
 * - `amount`   money, two decimals
 * - `quantity` counts/weights, up to three decimals
 * - `percent`  stored as a percentage number (12.5 means 12.5%), not a fraction
 * - `date`     calendar date, no time part
 * - `datetime` timestamp, shown in India Standard Time like the rest of the app
 * - `time`     wall-clock time column (`HH:mm[:ss]`), kept as text
 */
export type ExportCellType =
  | 'text'
  | 'integer'
  | 'number'
  | 'amount'
  | 'quantity'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'time'
  | 'boolean';

export interface ExportColumn<TRow = any> {
  /** Human-readable header written to row 1. */
  header: string;

  /**
   * Where the value comes from, as `table.column` or a relation path.
   * Developer documentation only, mirroring `ExcelColumn.maps`.
   */
  maps: string;

  type?: ExportCellType;

  /** Column width in characters. Defaults are derived from `type`. */
  width?: number;

  /** Reads the raw value out of a loaded row; the engine normalises it. */
  get: (row: TRow) => unknown;
}

/** One document the logged-in user is allowed to export, as the list returned it. */
export interface ExportRef {
  /** Id of the module's own record (`rfpa.id`, `grns.id`, ...). */
  id: string;
  /** Id of the approval document (`documents.id`) tracking that record. */
  documentId: string | null;
  /**
   * Which record type this is, for workbooks that mix types (the all-vouchers
   * export). Unset for single-module exports.
   */
  kind?: string;
}

export interface ExportLoadContext {
  manager: EntityManager;
  /** The chunk being loaded, in list order. */
  refs: ExportRef[];
  /** `refs.map(r => r.id)` */
  ids: string[];
  /** Non-null `refs.map(r => r.documentId)` */
  documentIds: string[];
}

export interface ExportSheet<TRow = any> {
  /** Worksheet name. Excel allows at most 31 characters and no `\ / ? * [ ] :`. */
  name: string;
  columns: ExportColumn<TRow>[];
  /**
   * Loads every row of this sheet that belongs to the chunk's documents.
   * Order within a document is kept; documents are re-ordered to match the list.
   */
  load: (ctx: ExportLoadContext) => Promise<TRow[]>;
  /** The `ExportRef.id` a row belongs to. */
  refId: (row: TRow) => string | null | undefined;
}

export interface ExportDefinition {
  /** File name stem: `RFPA` becomes `RFPA_2026-09-15.xlsx`. */
  fileStem: string;
  sheets: ExportSheet[];
}
