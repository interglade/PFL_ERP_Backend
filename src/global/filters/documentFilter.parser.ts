/**
 * Validates a query string into a `DocumentFilterInput`.
 *
 * Invalid values are rejected with 400 (`AppError`), never silently ignored.
 * Absent and empty parameters apply no filter. Parameters a module does not
 * support are ignored, exactly as unknown query parameters always have been.
 */

import moment from 'moment-timezone';
import { ParsedQs } from 'qs';
import AppError from '../../utils/appError';
import { DocumentStatus } from '../../approvalFlow/entity/docuemnt.entity';
import { getModuleFilterDefinition } from './documentFilter.definitions';
import { DocumentFilterInput, FieldFilter, FilterValue, ModuleFilterDefinition } from './documentFilter.types';

/** The app shows every date in India Standard Time; day filters use IST days. */
export const FILTER_TIMEZONE = 'Asia/Kolkata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filters every module supports, with the same meaning everywhere. */
export const COMMON_FILTERS: readonly { param: string; description: string }[] = [
  { param: 'startDate', description: 'Business date >= this day (YYYY-MM-DD, inclusive). Alias: dateFrom' },
  { param: 'endDate', description: 'Business date <= this day (YYYY-MM-DD, inclusive). Alias: dateTo' },
  { param: 'status', description: 'Document workflow status, comma separated (documents.status)' },
  { param: 'search', description: 'Partial, case-insensitive match on the document number, creator and the module search fields' },
  { param: 'documentNo', description: "The module's own document number (partial)" },
  { param: 'createdById', description: 'Document creator user id(s)' },
  { param: 'createdBy', description: 'Document creator name (partial)' },
  { param: 'approvedById', description: 'User id(s) who approved or verified at any stage' },
  { param: 'approvedBy', description: 'Name of a user who approved or verified at any stage (partial)' },
  { param: 'approvalStartDate', description: 'An approval/verification action on or after this day (YYYY-MM-DD)' },
  { param: 'approvalEndDate', description: 'An approval/verification action on or before this day (YYYY-MM-DD)' },
  { param: 'sort', description: 'field:ASC|DESC (existing convention). Aliases: sortBy + sortOrder' },
];

/** Product filters, for modules with line items or a product on the record. */
export const PRODUCT_FILTERS: readonly { param: string; kind: 'id' | 'text'; description: string }[] = [
  { param: 'productId', kind: 'id', description: 'Product id(s) on any line' },
  { param: 'productCode', kind: 'text', description: 'Product code on any line (partial)' },
  { param: 'productName', kind: 'text', description: 'Product name on any line (partial)' },
  { param: 'variantId', kind: 'id', description: 'Variant id(s) on any line' },
  { param: 'variant', kind: 'text', description: 'Variant name on any line (partial)' },
  { param: 'categoryId', kind: 'id', description: 'Product category id(s) on any line' },
  { param: 'category', kind: 'text', description: 'Product category name on any line (partial)' },
];

/** Accepted spellings that map onto a canonical parameter. */
const ALIASES: Record<string, string> = {
  dateFrom: 'startDate',
  dateTo: 'endDate',
  warehouseId: 'locationId',
  warehouse: 'location',
};

function firstString(value: ParsedQs[string]): string | undefined {
  if (Array.isArray(value)) return firstString(value[0] as ParsedQs[string]);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readParam(query: ParsedQs, param: string): string | undefined {
  const direct = firstString(query[param]);
  if (direct !== undefined) return direct;
  const alias = Object.entries(ALIASES).find(([, canonical]) => canonical === param)?.[0];
  return alias ? firstString(query[alias]) : undefined;
}

function list(value: string): string[] {
  return Array.from(new Set(value.split(',').map((v) => v.trim()).filter(Boolean)));
}

function parseDay(value: string, param: string): string {
  const day = moment.tz(value, 'YYYY-MM-DD', true, FILTER_TIMEZONE);
  if (!day.isValid()) {
    throw new AppError(400, `Invalid ${param} '${value}'. Expected a date in YYYY-MM-DD format`);
  }
  return day.format('YYYY-MM-DD');
}

function parseIds(value: string, param: string): string[] {
  const ids = list(value);
  const bad = ids.find((v) => !UUID.test(v));
  if (bad !== undefined) throw new AppError(400, `Invalid ${param} '${bad}'. Expected a UUID`);
  return ids;
}

function parseNumber(value: string, param: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) throw new AppError(400, `Invalid ${param} '${value}'. Expected a number`);
  return num;
}

function parseBoolean(value: string, param: string): boolean {
  const v = value.toLowerCase();
  if (['true', '1', 'yes'].includes(v)) return true;
  if (['false', '0', 'no'].includes(v)) return false;
  throw new AppError(400, `Invalid ${param} '${value}'. Expected true or false`);
}

function parseEnum(value: string, param: string, allowed: readonly string[]): string[] {
  return list(value).map((v) => {
    const match = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
    if (!match) throw new AppError(400, `Invalid ${param} '${v}'. Allowed values: ${allowed.join(', ')}`);
    return match;
  });
}

function parseField(field: FieldFilter, raw: string): FilterValue {
  switch (field.kind) {
    case 'id': {
      const ids = list(raw);
      // Historic parameters that also accepted a name: keep a non-UUID value as text.
      if (field.nameExprs && ids.some((v) => !UUID.test(v))) return raw;
      return parseIds(raw, field.param);
    }
    case 'enum':
      return parseEnum(raw, field.param, field.values ?? []);
    case 'iexact':
      return list(raw).map((v) => v.toLowerCase());
    case 'boolean':
      return parseBoolean(raw, field.param);
    case 'min':
    case 'max':
      return parseNumber(raw, field.param);
    case 'day':
      return parseDay(raw, field.param);
    case 'text':
    default:
      return raw;
  }
}

function checkRange(criteria: Record<string, FilterValue>, from: string, to: string) {
  const a = criteria[from];
  const b = criteria[to];
  if (a !== undefined && b !== undefined && a > b) {
    throw new AppError(400, `Invalid range: ${from} (${a}) is greater than ${to} (${b})`);
  }
}

/** Every parameter name (canonical and alias) a module understands. */
export function supportedFilterParams(documentType: string): Set<string> {
  const def = requireDefinition(documentType);
  const params = new Set<string>([...COMMON_FILTERS.map((f) => f.param), 'sortBy', 'sortOrder', ...Object.keys(ALIASES)]);
  def.fields.forEach((f) => params.add(f.param));
  if (def.lineItems || def.headerProduct) PRODUCT_FILTERS.forEach((f) => params.add(f.param));
  def.lineItems?.textFields?.forEach((f) => params.add(f.param));
  return params;
}

function requireDefinition(documentType: string): ModuleFilterDefinition {
  const def = getModuleFilterDefinition(documentType);
  if (!def) throw new Error(`No filter definition for document type '${documentType}'`);
  return def;
}

export function parseDocumentFilters(query: ParsedQs, documentType: string): DocumentFilterInput {
  const def = requireDefinition(documentType);
  const criteria: Record<string, FilterValue> = {};

  // Dates
  for (const param of ['startDate', 'endDate', 'approvalStartDate', 'approvalEndDate']) {
    const raw = readParam(query, param);
    if (raw !== undefined) criteria[param] = parseDay(raw, param);
  }
  checkRange(criteria, 'startDate', 'endDate');
  checkRange(criteria, 'approvalStartDate', 'approvalEndDate');

  // Document-level
  const status = readParam(query, 'status');
  if (status !== undefined) criteria.status = parseEnum(status, 'status', Object.values(DocumentStatus));
  for (const param of ['search', 'documentNo', 'createdBy', 'approvedBy']) {
    const raw = readParam(query, param);
    if (raw !== undefined) criteria[param] = raw;
  }
  for (const param of ['createdById', 'approvedById']) {
    const raw = readParam(query, param);
    if (raw !== undefined) criteria[param] = parseIds(raw, param);
  }

  // Module fields
  for (const field of def.fields) {
    const raw = readParam(query, field.param);
    if (raw !== undefined) criteria[field.param] = parseField(field, raw);
  }
  for (const field of def.fields.filter((f) => f.kind === 'min')) {
    const suffix = field.param.slice(3);
    checkRange(criteria, field.param, `max${suffix}`);
  }

  // Products
  if (def.lineItems || def.headerProduct) {
    for (const field of PRODUCT_FILTERS) {
      const raw = readParam(query, field.param);
      if (raw === undefined) continue;
      criteria[field.param] = field.kind === 'id' ? parseIds(raw, field.param) : raw;
    }
  }
  for (const field of def.lineItems?.textFields ?? []) {
    const raw = readParam(query, field.param);
    if (raw !== undefined) criteria[field.param] = raw;
  }

  // Sorting: the existing `field:DIR` convention, or sortBy + sortOrder.
  const input: DocumentFilterInput = { documentType, criteria };
  const sortRaw = readParam(query, 'sort');
  const sortBy = readParam(query, 'sortBy');
  const [key, dir] = sortRaw ? sortRaw.split(',')[0].split(':') : sortBy ? [sortBy, readParam(query, 'sortOrder')] : [];
  if (key && key.trim()) {
    const direction = (dir || '').trim().toUpperCase();
    if (direction && direction !== 'ASC' && direction !== 'DESC') {
      throw new AppError(400, `Invalid sort order '${dir}'. Expected ASC or DESC`);
    }
    input.sort = { key: key.trim(), direction: direction === 'DESC' ? 'DESC' : 'ASC' };
  }

  return input;
}

export function hasFilterCriteria(input: DocumentFilterInput | undefined): boolean {
  return Boolean(input && Object.keys(input.criteria).length);
}
