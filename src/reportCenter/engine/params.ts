import moment from 'moment-timezone';
import AppError from '../../utils/appError';
import { ReportDefinition, ReportParams } from '../reportCenter.types';

export const IST = 'Asia/Kolkata';
const DAY = 'YYYY-MM-DD';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const todayIst = () => moment.tz(IST).format(DAY);

/** "a,b,c" or ['a','b'] -> unique valid uuids. Anything else is refused, never passed to SQL. */
function uuidList(value: unknown, label: string): string[] {
  if (value === undefined || value === null || value === '') return [];
  const parts = (Array.isArray(value) ? value : String(value).split(','))
    .map((v) => String(v).trim())
    .filter(Boolean);
  for (const p of parts) {
    if (!UUID.test(p)) throw new AppError(400, `${label}: "${p}" is not a valid id`);
  }
  return [...new Set(parts)];
}

function day(value: unknown, label: string, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  const m = moment.tz(String(value), DAY, true, IST);
  if (!m.isValid()) throw new AppError(400, `${label} must be a date like 2026-11-03`);
  return m.format(DAY);
}

/**
 * Suppliers come from one picker holding vendors and farmers, sent as
 * "vendor:<uuid>" / "farmer:<uuid>".
 */
function suppliers(value: unknown): { vendorIds: string[]; farmerIds: string[] } {
  const vendorIds: string[] = [];
  const farmerIds: string[] = [];
  if (value === undefined || value === null || value === '') return { vendorIds, farmerIds };
  const parts = (Array.isArray(value) ? value : String(value).split(',')).map((v) => String(v).trim()).filter(Boolean);
  for (const p of parts) {
    const [kind, id] = p.split(':');
    if (!id || !UUID.test(id) || (kind !== 'vendor' && kind !== 'farmer')) {
      throw new AppError(400, `Supplier "${p}" is not valid`);
    }
    (kind === 'vendor' ? vendorIds : farmerIds).push(id);
  }
  return { vendorIds: [...new Set(vendorIds)], farmerIds: [...new Set(farmerIds)] };
}

/** Reads the query string for one report. Defaults: this month to date, as on today. */
export function parseParams(def: ReportDefinition, query: Record<string, any>): ReportParams {
  const today = todayIst();
  const monthStart = moment.tz(IST).startOf('month').format(DAY);
  const from = day(query.from, 'From date', monthStart);
  const to = day(query.to, 'To date', today);
  if (from > to) throw new AppError(400, 'From date must be on or before To date');

  const supplierParam = def.params.find((p) => p.kind === 'supplier' || p.kind === 'suppliers');
  const { vendorIds, farmerIds } = suppliers(supplierParam ? query[supplierParam.key] : undefined);

  const allowed = new Set(def.groupings.map((g) => g.key));
  const groupBy =
    query.groupBy === undefined
      ? def.defaultGroupBy
      : String(query.groupBy)
          .split(',')
          .map((g) => g.trim())
          .filter((g) => g && g !== 'none');
  for (const g of groupBy) {
    if (!allowed.has(g)) throw new AppError(400, `This report cannot be grouped by "${g}"`);
  }

  const extra: Record<string, string> = {};
  for (const p of def.params.filter((x) => x.kind === 'select')) {
    const v = query[p.key] === undefined || query[p.key] === '' ? p.default ?? '' : String(query[p.key]);
    if (p.options && v && !p.options.some((o) => o.value === v)) {
      throw new AppError(400, `${p.label}: "${v}" is not one of the choices`);
    }
    extra[p.key] = v;
  }

  const params: ReportParams = {
    from,
    to,
    asOn: day(query.asOn, 'As on date', today),
    companyIds: uuidList(query.companies, 'Company'),
    locationIds: uuidList(query.locations, 'Location'),
    vendorIds,
    farmerIds,
    customerIds: uuidList(query.customers ?? query.customer, 'Customer'),
    productIds: uuidList(query.products, 'Product'),
    employeeIds: uuidList(query.employees, 'Employee'),
    groupBy: [...new Set(groupBy)],
    summaryOnly: def.allowSummaryOnly === true && groupBy.length > 0 && String(query.summaryOnly) === 'true',
    extra,
  };

  for (const p of def.params.filter((x) => x.required)) {
    if (p.kind === 'supplier' && vendorIds.length + farmerIds.length !== 1) {
      throw new AppError(400, `Choose one ${p.label.toLowerCase()}`);
    }
    if (p.kind === 'customer' && params.customerIds.length !== 1) {
      throw new AppError(400, `Choose one ${p.label.toLowerCase()}`);
    }
  }
  return params;
}

/** SQL bounds for a timestamp column holding IST wall-clock time: [from 00:00, to+1 00:00). */
export function tsBounds(from: string, to: string): [string, string] {
  return [`${from} 00:00:00`, moment.tz(to, DAY, IST).add(1, 'day').format(DAY) + ' 00:00:00'];
}

/** The same number of days immediately before [from, to], for "vs previous period". */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const f = moment.tz(from, DAY, IST);
  const t = moment.tz(to, DAY, IST);
  const days = t.diff(f, 'days') + 1;
  return {
    from: f.clone().subtract(days, 'days').format(DAY),
    to: f.clone().subtract(1, 'day').format(DAY),
  };
}

export const fmtDay = (d: string | null | undefined) => (d ? moment.tz(d, DAY, IST).format('DD MMM YYYY') : '');
export const nowLabel = () => moment.tz(IST).format('DD MMM YYYY, hh:mm A');
