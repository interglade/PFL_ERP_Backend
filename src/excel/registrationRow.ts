/**
 * Shared by the Vendor, Customer and Farmer importers
 * (docs/registration-import-plan.md, decisions agreed 2026-11-04):
 *
 *  - `RegistrationRowReader` reads a cell through the column map and applies the
 *    form's rule. A cell that breaks it - a bad mobile, GSTIN, date, dropdown
 *    value - or a mobile / email another record already holds, is left empty and
 *    noted in the row's `DraftLinks` (D4, D5). Every imported record is a draft
 *    anyway (D2), so nothing is rejected for a typo.
 *  - `ContactPool` holds the mobiles and emails already in use.
 *  - `mergeFilled` copies only the filled values of a re-imported row onto the
 *    draft it names, so an empty cell keeps what is saved (D3).
 */

import { ExcelColumn, ExcelSheetDefinition } from './excelColumn';
import { ExcelRow } from './excelImport.service';
import { toText } from './excelValue';
import { DraftLinks, EMPTY_LINK } from './draftLinks';
import { contactKind, FORMAT_RULES } from './formatRules';

// ─── Contacts ───────────────────────────────────────────────────────────────

export type ContactKind = 'phone' | 'email';

export interface ContactOwnerRef {
  /** Record id, or a stand-in for a row not saved yet. */
  key: string;
  /** How a clash names the record, e.g. "VENDOR20260003 Fresh Farms". */
  label: string;
}

/** Mobiles compare by their last 10 digits, emails without case. */
export function contactValueKey(kind: ContactKind, value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (kind === 'phone') {
    const digits = text.replace(/\D/g, '');
    return digits ? `phone|${digits.slice(-10)}` : null;
  }
  return `email|${text.toLowerCase()}`;
}

/** Every mobile and email in use in one registration list, and who holds it. */
export class ContactPool {
  private readonly holders = new Map<string, ContactOwnerRef[]>();

  add(kind: ContactKind, value: string | null | undefined, owner: ContactOwnerRef): void {
    const key = value ? contactValueKey(kind, value) : null;
    if (!key) return;
    const owners = this.holders.get(key) ?? [];
    if (!owners.some((existing) => existing.key === owner.key)) owners.push(owner);
    this.holders.set(key, owners);
  }

  /**
   * Who else holds the value, or null. A record that already holds it itself is
   * not stopped, so an old clash already in the database does not block it.
   */
  holder(kind: ContactKind, value: string, ownerKey: string): string | null {
    const key = contactValueKey(kind, value);
    if (!key) return null;
    const owners = this.holders.get(key) ?? [];
    if (owners.some((owner) => owner.key === ownerKey)) return null;
    return owners[0]?.label ?? null;
  }
}

// ─── Row reader ─────────────────────────────────────────────────────────────

const normalise = (header: string) => header.toLowerCase().replace(/\s+/g, ' ').trim();

const columnIndexes = new WeakMap<ExcelSheetDefinition<any>, Map<string, ExcelColumn>>();

/** A sheet's columns by header and by every alias. */
function columnsOf(sheet: ExcelSheetDefinition<any>): Map<string, ExcelColumn> {
  let index = columnIndexes.get(sheet);
  if (!index) {
    index = new Map();
    for (const column of sheet.columns) {
      for (const name of [column.header, ...(column.aliases ?? [])]) index.set(normalise(name), column);
    }
    columnIndexes.set(sheet, index);
  }
  return index;
}

const TYPE_MESSAGES: Partial<Record<NonNullable<ExcelColumn['type']>, string>> = {
  date: 'is not a date (use DD-MM-YYYY)',
  number: 'is not a number',
  integer: 'is not a whole number',
  boolean: 'must be Yes or No',
};

export class RegistrationRowReader {
  private readonly results = new Map<string, unknown>();
  /** Mobiles and emails this row sets, to add to the pool once it is saved. */
  readonly contacts: { kind: ContactKind; value: string }[] = [];

  constructor(
    private readonly sheet: ExcelSheetDefinition<any>,
    readonly row: ExcelRow,
    readonly draft: DraftLinks,
    private readonly options: { contacts?: ContactPool; ownerKey: string },
  ) {}

  column(header: string): ExcelColumn {
    const column = columnsOf(this.sheet).get(normalise(header));
    if (!column) throw new Error(`Unknown column "${header}" in the ${this.sheet.sheetName} sheet`);
    return column;
  }

  /** What the user typed, as text, before any rule. */
  typed(header: string): string | null {
    const column = this.column(header);
    return toText(this.row.cell({ ...column, type: 'string', enumValues: undefined }));
  }

  /**
   * The cell coerced to its column's type and checked against its rule. Blank,
   * refused and clashing cells all give null; the last two are noted in `draft`.
   */
  value<T>(header: string): T | null {
    const column = this.column(header);
    if (this.results.has(column.header)) return this.results.get(column.header) as T | null;
    const result = this.read(column);
    this.results.set(column.header, result);
    return result as T | null;
  }

  text(header: string): string | null {
    const value = this.value<unknown>(header);
    return value === null || value === undefined ? null : String(value);
  }

  number(header: string): number | null {
    return this.value<number>(header);
  }

  boolean(header: string): boolean | null {
    return this.value<boolean>(header);
  }

  /** Date columns come back as yyyy-MM-dd; this gives the Date the entities want. */
  date(header: string): Date | null {
    const value = this.value<string>(header);
    return value ? new Date(value) : null;
  }

  /** Required plain columns left blank on a new record (links are checked by `DraftLinks`). */
  noteMissingRequired(except: string[] = []): void {
    const skip = new Set(except.map(normalise));
    for (const column of this.sheet.columns) {
      if (!column.required || column.readOnly || column.key || column.link) continue;
      if (skip.has(normalise(column.header))) continue;
      if (this.typed(column.header) === null) this.draft.note(column.header, EMPTY_LINK, 'Required');
    }
  }

  private read(column: ExcelColumn): unknown {
    const typed = this.typed(column.header);
    if (typed === null) return null;

    const coerced = this.row.cell(column);
    if (coerced === null || coerced === undefined) {
      const why =
        column.type === 'enum' && column.enumValues?.length
          ? `must be one of: ${column.enumValues.join(', ')}`
          : TYPE_MESSAGES[column.type ?? 'string'] ?? 'could not be read';
      this.draft.note(column.header, typed, `Left empty: ${why}`);
      return null;
    }
    if (!column.format) return coerced;

    const rule = FORMAT_RULES[column.format];
    const clean = rule.clean(String(coerced));
    if (clean === null) {
      this.draft.note(column.header, typed, `Left empty: ${rule.message}`);
      return null;
    }

    const kind = contactKind(column.format);
    if (kind && column.uniqueContact) {
      const holder = this.options.contacts?.holder(kind, clean, this.options.ownerKey);
      if (holder) {
        this.draft.note(column.header, typed, `Left empty: already used by ${holder}`);
        return null;
      }
      this.contacts.push({ kind, value: clean });
    }
    return clean;
  }

  /** Adds this row's mobiles and emails to the pool, once the row counts as saved. */
  registerContacts(owner: ContactOwnerRef): void {
    for (const contact of this.contacts) this.options.contacts?.add(contact.kind, contact.value, owner);
  }
}

// ─── Updates ────────────────────────────────────────────────────────────────

const isFilled = (value: unknown): boolean => {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Date || typeof value !== 'object') return true;
  return Object.values(value as object).some(isFilled);
};

/**
 * Copies the filled values of `incoming` onto `target`: empty cells keep what is
 * saved (D3). Nested details (bank, addresses) are merged field by field; a
 * linked record (it has an id) or a non-empty list replaces the saved one.
 */
export function mergeFilled(target: Record<string, any>, incoming: Record<string, any>): void {
  for (const [key, value] of Object.entries(incoming)) {
    if (!isFilled(value)) continue;
    if (Array.isArray(value) || value instanceof Date || typeof value !== 'object' || value.id) {
      target[key] = value;
    } else if (target[key] && typeof target[key] === 'object') {
      mergeFilled(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

// ─── Response ───────────────────────────────────────────────────────────────

/** The line the list page shows after a registration import or file check. */
export function registrationImportMessage(
  plural: string,
  summary: { created: number; updated: number; drafted: number; skipped: unknown[]; failed: unknown[] },
  checkOnly: boolean,
): string {
  const parts = [`${summary.created} new`, `${summary.updated} updated`];
  if (summary.drafted) parts.push(`${summary.drafted} with fields to fix`);
  if (summary.skipped.length) parts.push(`${summary.skipped.length} skipped`);
  if (summary.failed.length) parts.push(`${summary.failed.length} failed`);
  return checkOnly
    ? `${plural} file checked: ${parts.join(', ')}. Nothing has been saved yet.`
    : `${plural} imported as drafts: ${parts.join(', ')}. Open each draft, check it and submit it.`;
}
