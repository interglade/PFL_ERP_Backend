/**
 * Cell coercion shared by every importer.
 *
 * Spreadsheets hand back whatever the user typed: numbers as text, dates as
 * Excel serials or `dd-MM-yyyy`, booleans as "Yes"/"Y"/"TRUE"/1. These helpers
 * turn that into the shapes the entities expect, and return `null` rather than
 * throwing when a cell is simply blank.
 */

import { ExcelCellType, ExcelColumn } from './excelColumn';

/** Trimmed string, or null for blank / whitespace-only / Excel's "-" filler. */
export function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '' || text === '-') return null;
  return text;
}

export function toNumber(value: unknown): number | null {
  const text = toText(value);
  if (text === null) return null;
  // Tolerate thousands separators and stray currency symbols pasted from other sheets.
  const cleaned = text.replace(/[,\s₹]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toInteger(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  return Math.trunc(parsed);
}

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'haan', 'ho']);
const FALSY = new Set(['false', 'no', 'n', '0', 'nahi']);

export function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const text = toText(value);
  if (text === null) return null;
  const lower = text.toLowerCase();
  if (TRUTHY.has(lower)) return true;
  if (FALSY.has(lower)) return false;
  return null;
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Accepts a JS Date (ExcelJS hands these back for date-formatted cells), an
 * Excel serial number, `yyyy-MM-dd`, `dd-MM-yyyy` and `dd/MM/yyyy`.
 *
 * Day-first is tried before `new Date()` because `new Date('03-04-2024')` is
 * parsed month-first by V8, which would silently swap day and month on every
 * Indian-format date in the sheet.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(EXCEL_EPOCH_UTC + value * MS_PER_DAY);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const text = toText(value);
  if (text === null) return null;

  const dayFirst = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dayFirst) {
    const [, day, month, year] = dayFirst;
    const parsed = new Date(Date.UTC(+year, +month - 1, +day));
    // Reject 31-02-2024 and friends rather than letting Date roll them over.
    if (parsed.getUTCMonth() !== +month - 1 || parsed.getUTCDate() !== +day) {
      return null;
    }
    return parsed;
  }

  const isoLike = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoLike) {
    const [, year, month, day] = isoLike;
    const parsed = new Date(Date.UTC(+year, +month - 1, +day));
    if (parsed.getUTCMonth() !== +month - 1 || parsed.getUTCDate() !== +day) {
      return null;
    }
    return parsed;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** `yyyy-MM-dd`, the shape TypeORM `date` columns want. */
export function toDateOnlyString(value: unknown): string | null {
  const parsed = toDate(value);
  if (!parsed) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Case- and spacing-insensitive match against the allowed values, so "Fresh
 * Fruits" in the sheet still finds the `fresh fruits` enum member.
 */
export function toEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  const text = toText(value);
  if (text === null) return null;
  const normalise = (input: string) => input.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const target = normalise(text);
  return allowed.find((candidate) => normalise(candidate) === target) ?? null;
}

/** Coerce a raw cell according to the column's declared type. */
export function coerceCell(column: ExcelColumn, raw: unknown): unknown {
  const type: ExcelCellType = column.type ?? 'string';

  switch (type) {
    case 'number':
      return toNumber(raw);
    case 'integer':
      return toInteger(raw);
    case 'boolean':
      return toBoolean(raw);
    case 'date':
      return toDateOnlyString(raw);
    case 'enum':
      return column.enumValues ? toEnum(raw, column.enumValues) : toText(raw);
    default:
      return toText(raw);
  }
}

/** Splits "Onion, Potato ; Tomato" into a trimmed, de-duplicated list. */
export function toList(value: unknown): string[] {
  const text = toText(value);
  if (text === null) return [];
  const parts = text
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

/** Export counterpart of `toList`. */
export function fromList(values: (string | null | undefined)[] | null | undefined): string {
  if (!values?.length) return '';
  return values.filter(Boolean).join(', ');
}

/** Export helper: `yyyy-MM-dd` for a date column, blank when unset. */
export function formatDateCell(value: unknown): string {
  const parsed = toDate(value);
  if (!parsed) return '';
  return parsed.toISOString().slice(0, 10);
}

/** Export helper: "Yes"/"No" reads better in a sheet than TRUE/FALSE. */
export function formatBooleanCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return value ? 'Yes' : 'No';
}

/** Export helper: joins a person's name parts, skipping the blanks. */
export function formatName(
  ...parts: (string | null | undefined)[]
): string {
  return parts.filter(Boolean).join(' ').trim();
}
