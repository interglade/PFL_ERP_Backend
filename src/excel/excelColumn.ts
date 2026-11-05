/**
 * The contract shared by Excel export, template generation and import.
 *
 * One column map per module is the single source of truth for:
 *   - the human-readable header shown to the user
 *   - which database column that header maps to
 *   - how a cell value is read out of an entity (export)
 *   - how a cell value is written back into an entity (import)
 *
 * Because export, template and import all read the same map, a file exported
 * from the app can be edited and imported back without the headers drifting.
 */

import type { FormatRule } from './formatRules';

export type ExcelCellType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'enum';

export interface ExcelColumn<TRow = any> {
  /** Header text written to the sheet. This is the key the importer looks up. */
  header: string;

  /**
   * Where this column lives in the database, as `table.column`.
   *
   * Developer documentation only - it is deliberately not written into the
   * Instructions sheet, since users editing a spreadsheet do not need the
   * schema. Not used to build queries either; it exists so the mapping is
   * visible at the point where a column is defined.
   */
  maps: string;

  /**
   * Older or misspelt header spellings the importer still accepts, so
   * spreadsheets staff already have keep working after a header is renamed.
   * Never written on export - only `header` is.
   */
  aliases?: readonly string[];

  type?: ExcelCellType;

  /** Allowed values, listed in the Instructions sheet and used to coerce input. */
  enumValues?: readonly string[];

  /** Import rejects the row when this is set and the cell is empty. */
  required?: boolean;

  /**
   * The system fills this column in itself - generated codes, approval status,
   * the record owner.
   *
   * It appears on an export so you can see the value, is left out of the blank
   * template entirely, and is never read back on import.
   */
  readOnly?: boolean;

  /**
   * Identifies an existing record - the Record ID on a small master, the Code
   * on a registration.
   *
   * Unlike `readOnly` it is read back on import, so an exported file can be
   * edited and imported again to update those records. Like `readOnly` it is
   * left out of the blank template, since a new record has no identity yet.
   */
  key?: boolean;

  /**
   * Name of a list supplied when the workbook is built (see `WorkbookLists`),
   * used for the dropdown instead of `enumValues`. This is how a "Vendor
   * Category" column offers the categories currently in the database.
   */
  listFrom?: string;

  /**
   * Marks a column whose value is the name of a record in another master. The
   * importer matches it through a `LookupIndex`; the Instructions sheet tells
   * the user which master the name has to exist in.
   */
  link?: ExcelColumnLink;

  /**
   * Value rule the form applies (mobile, email, GSTIN, ...). The registration
   * importers leave a cell that breaks it empty and report it.
   */
  format?: FormatRule;

  /**
   * A mobile or email no other record of the same registration may hold
   * (docs/registration-import-plan.md D4). Needs `format` 'mobile' or 'email'.
   */
  uniqueContact?: boolean;

  width?: number;

  /** Extra guidance for the Instructions sheet. */
  note?: string;

  /** Export: pull the cell value out of the entity. */
  get?: (row: TRow) => unknown;
}

export interface ExcelColumnLink {
  /** Human-readable name of the master the value must exist in, e.g. "Vendor Category". */
  master: string;
  /**
   * Header of the column in the same row that holds the parent, when the name
   * is only unique within that parent (a subcategory within its category).
   */
  scopeHeader?: string;
}

/**
 * Dropdown values supplied when a workbook is built, keyed by `listFrom`.
 * A missing or empty list simply means that column gets no dropdown.
 */
export type WorkbookLists = Record<string, readonly string[]>;

/**
 * A repeating child block — variants on a product, crops on a farmer.
 *
 * Rendered as `${prefix}${n}.${header}` (e.g. `Variant1.Size`, `Crop2.Variety`),
 * which is the convention the existing product/farmer importers already use.
 * `maxOnExport` bounds how many child blocks an export writes; import keeps
 * reading until it finds a block whose `keyHeader` column is empty.
 */
export interface ExcelColumnGroup<TChild = any> {
  prefix: string;
  /** Column within the block that must be present for the block to count. */
  keyHeader: string;
  columns: ExcelColumn<TChild>[];
  maxOnExport: number;
  note?: string;
}

export interface ExcelSheetDefinition<TRow = any, TChild = any> {
  /** Worksheet name, also used as the exported file name stem. */
  sheetName: string;
  columns: ExcelColumn<TRow>[];
  groups?: (ExcelColumnGroup<TChild> & { children: (row: TRow) => any[] })[];
}

/** Expands a group into concrete headers for occurrence `index` (1-based). */
export function groupHeader(
  group: Pick<ExcelColumnGroup, 'prefix'>,
  index: number,
  header: string,
): string {
  return `${group.prefix}${index}.${header}`;
}

/**
 * Full ordered header list for a sheet: flat columns first, then each group
 * expanded `maxOnExport` times. Export and template generation both use this so
 * the two files always have identical headers.
 */
export function expandHeaders(def: ExcelSheetDefinition): string[] {
  const headers = def.columns.map((c) => c.header);

  for (const group of def.groups ?? []) {
    for (let i = 1; i <= group.maxOnExport; i++) {
      for (const col of group.columns) {
        headers.push(groupHeader(group, i, col.header));
      }
    }
  }

  return headers;
}
