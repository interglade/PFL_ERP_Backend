import moment, { Moment } from 'moment-timezone';
import { CacheService } from '../../global/cache.service';
import AppError from '../../utils/appError';

/**
 * Shared helpers for the Admin Control Center dashboard.
 *
 * Timestamps: every `timestamp` column in this database holds IST wall-clock
 * time (Postgres runs with TimeZone = Asia/Kolkata). Range bounds are therefore
 * passed to SQL as plain 'YYYY-MM-DD HH:mm:ss' IST strings, and timestamps are
 * read back with to_char(), so neither the Node process timezone nor the pg
 * driver's Date parsing can shift a document into the wrong day.
 */

export const IST = 'Asia/Kolkata';

export type Period = 'this-month' | 'last-month' | 'this-quarter' | 'this-year';
export const PERIODS: Period[] = ['this-month', 'last-month', 'this-quarter', 'this-year'];

export const PERIOD_OPTIONS = [
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'this-quarter', label: 'This Quarter' },
  { value: 'this-year', label: 'This Financial Year' },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Query parameters ────────────────────────────────────────────────────────

export interface TabFilters {
  period: Period;
  location: string | null; // null = all
  company: string | null; // null = all
}

export function parseFilters(query: any): TabFilters {
  const period = (query?.period || 'this-month') as Period;
  if (!PERIODS.includes(period)) {
    throw new AppError(400, `Invalid period. Use one of: ${PERIODS.join(', ')}`);
  }
  return {
    period,
    location: parseIdParam(query?.location, 'location'),
    company: parseIdParam(query?.company, 'company'),
  };
}

function parseIdParam(value: any, name: string): string | null {
  if (value === undefined || value === null || value === '' || value === 'all') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new AppError(400, `Invalid ${name}. Send "all" or a ${name} id`);
  }
  return value;
}

export function isRefresh(query: any): boolean {
  return query?.refresh === 'true' || query?.refresh === '1' || query?.refresh === true;
}

// ─── Dates ───────────────────────────────────────────────────────────────────

export function nowIst(): Moment {
  return moment.tz(IST);
}

/** IST wall-clock string for SQL comparisons against `timestamp` columns. */
export function sqlTs(m: Moment): string {
  return m.clone().tz(IST).format('YYYY-MM-DD HH:mm:ss');
}

/** ISO 8601 with offset, e.g. 2026-09-28T11:05:00+05:30 */
export function isoIst(m: Moment = nowIst()): string {
  return m.clone().tz(IST).format('YYYY-MM-DDTHH:mm:ssZ');
}

/** Parses a 'YYYY-MM-DD"T"HH24:MI:SS' IST text produced by SQL to_char(). */
export function fromSqlText(text: string): Moment {
  return moment.tz(text, 'YYYY-MM-DDTHH:mm:ss', IST);
}

/** SQL expression turning a timestamp column into sortable IST text. */
export function tsText(col: string): string {
  return `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS')`;
}

export function timeLabel(m: Moment): string {
  return m.format('hh:mm A');
}

export function dateTimeLabel(m: Moment): string {
  return m.format('DD MMM YYYY, hh:mm A');
}

/** Start of the financial year (1 April) that contains `m`. */
export function fyStart(m: Moment): Moment {
  const year = m.month() >= 3 ? m.year() : m.year() - 1;
  return moment.tz({ year, month: 3, day: 1 }, IST).startOf('day');
}

export interface PeriodRange {
  start: Moment; // inclusive
  end: Moment; // exclusive
  bucket: 'day' | 'month';
  /** Whole range the chart covers, including days/months still to come. */
  chartStart: Moment;
  chartEnd: Moment; // exclusive
}

/**
 * Data range and chart range for a period.
 *  - this-month  : 1st → now, chart shows every day of the month
 *  - last-month  : the whole previous month
 *  - this-quarter: calendar quarter start → now, chart shows its 3 months
 *  - this-year   : 1 April → now, chart shows all 12 FY months
 */
export function periodRange(period: Period, now: Moment = nowIst()): PeriodRange {
  const end = now.clone();
  switch (period) {
    case 'this-month': {
      const start = now.clone().startOf('month');
      return { start, end, bucket: 'day', chartStart: start, chartEnd: start.clone().add(1, 'month') };
    }
    case 'last-month': {
      const start = now.clone().subtract(1, 'month').startOf('month');
      const e = now.clone().startOf('month');
      return { start, end: e, bucket: 'day', chartStart: start, chartEnd: e };
    }
    case 'this-quarter': {
      const start = now.clone().startOf('quarter');
      return { start, end, bucket: 'month', chartStart: start, chartEnd: start.clone().add(3, 'months') };
    }
    case 'this-year': {
      const start = fyStart(now);
      return { start, end, bucket: 'month', chartStart: start, chartEnd: start.clone().add(12, 'months') };
    }
  }
}

export interface Bucket {
  key: string; // 'YYYY-MM-DD' or 'YYYY-MM'
  label: string; // '01 Sep' or 'Apr'
  future: boolean;
}

/** One bucket per day or month of the chart range; buckets after `now` are marked future. */
export function buckets(range: PeriodRange, now: Moment = nowIst()): Bucket[] {
  const out: Bucket[] = [];
  const cursor = range.chartStart.clone();
  while (cursor.isBefore(range.chartEnd)) {
    if (range.bucket === 'day') {
      out.push({
        key: cursor.format('YYYY-MM-DD'),
        label: cursor.format('DD MMM'),
        future: cursor.isAfter(now, 'day'),
      });
      cursor.add(1, 'day');
    } else {
      out.push({
        key: cursor.format('YYYY-MM'),
        label: cursor.format('MMM'),
        future: cursor.isAfter(now, 'month'),
      });
      cursor.add(1, 'month');
    }
  }
  return out;
}

export interface DailyRow {
  day: string; // 'YYYY-MM-DD'
  [metric: string]: any;
}

/**
 * Builds a trend series: labels plus one array per metric, all the same
 * length. Future buckets are null, past buckets with no activity are 0.
 */
export function buildSeries<M extends string>(
  period: Period,
  rows: DailyRow[],
  metrics: readonly M[],
  now: Moment = nowIst(),
): { labels: string[] } & Record<M, (number | null)[]> {
  const range = periodRange(period, now);
  const bs = buckets(range, now);
  const index = new Map(bs.map((b, i) => [b.key, i]));
  const series: any = { labels: bs.map((b) => b.label) };
  for (const metric of metrics) {
    series[metric] = bs.map((b) => (b.future ? null : 0));
  }
  for (const row of rows) {
    const key = range.bucket === 'day' ? row.day : row.day.slice(0, 7);
    const i = index.get(key);
    if (i === undefined || bs[i].future) continue;
    for (const metric of metrics) {
      series[metric][i] = round2((series[metric][i] as number) + num(row[metric]));
    }
  }
  return series;
}

/** Earliest start among the given periods, so one daily query can feed every chart. */
export function earliestStart(periods: Period[], now: Moment = nowIst()): Moment {
  return periods
    .map((p) => periodRange(p, now).start)
    .reduce((min, m) => (m.isBefore(min) ? m : min));
}

// ─── SQL fragments ───────────────────────────────────────────────────────────

/**
 * True when the module row `alias` has finished its approval flow. Status
 * lives in the central documents table, linked by document_type_id. This is
 * the single definition of "counts" for purchase, sales, wastage, vouchers.
 */
export function completeDoc(alias: string, docType: string): string {
  return `EXISTS (SELECT 1 FROM documents cd
                   WHERE cd.document_type_id = ${alias}.id::text
                     AND cd.type = '${docType}'
                     AND cd.status = 'COMPLETE'
                     AND cd."isDeleted" = false)`;
}

/** Unpaid, treating a missing payment status as unpaid (the column default). */
export function unpaid(alias: string): string {
  return `COALESCE(${alias}."ammountStatus"::text, 'unpaid') = 'unpaid'`;
}

/**
 * Accepted / returned / rejected kilograms of a customer DC line. The line's
 * returnedQty and rejectedQty are in its own sale unit, so they are converted
 * to kg as a share of the line's netWeight. Accepted is the remainder, which
 * keeps accepted + returned + rejected = dispatched exactly.
 */
export function dcLineKg(it: string) {
  const dispatched = `COALESCE(${it}."netWeight", 0)`;
  const share = (col: string) =>
    `(CASE WHEN COALESCE(${it}.quantity, 0) > 0 THEN LEAST(GREATEST(COALESCE(${it}."${col}", 0) / ${it}.quantity, 0), 1) ELSE 0 END)`;
  const returned = `(${dispatched} * ${share('returnedQty')})`;
  const rejected = `(${dispatched} * ${share('rejectedQty')})`;
  const acceptedShare = `GREATEST(1 - ${share('returnedQty')} - ${share('rejectedQty')}, 0)`;
  return {
    dispatched,
    returned,
    rejected,
    accepted: `(${dispatched} - ${returned} - ${rejected})`,
    acceptedAmount: `(COALESCE(${it}.amount, 0) * ${acceptedShare})`,
  };
}

// ─── Numbers ─────────────────────────────────────────────────────────────────

export function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Signed % change, one decimal. 0 when there is nothing to compare against. */
export function pctChange(current: number, previous: number): number {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ─── People ──────────────────────────────────────────────────────────────────

export function fullName(...parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join(' ');
}

const DEPARTMENT_LABELS: Record<string, string> = {
  procurement: 'Procurement',
  purchase: 'Procurement',
  sale: 'Sales',
  sales: 'Sales',
  operations: 'Operation',
  operation: 'Operation',
  quality_checking: 'Quality Checking',
  business_development: 'Business Development',
  'branding_&_marketing': 'Branding & Marketing',
  branding_marketing: 'Branding & Marketing',
  exports: 'Exports',
  farming: 'Farming',
  accounts: 'Accounts',
  finance: 'Finance',
  hr: 'HR',
  it: 'IT',
  admin: 'Admin',
  superadmin: 'Super Admin',
  other: 'Other',
};

export function departmentLabel(dep: string | null | undefined): string {
  const key = (dep || '').trim().toLowerCase();
  if (!key) return '';
  return (
    DEPARTMENT_LABELS[key] ||
    key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** employees.department is a TypeORM simple-array: comma separated text. */
export function parseDepartments(value: string | string[] | null | undefined): string[] {
  const list = Array.isArray(value) ? value : (value || '').split(',');
  const labels = list.map(departmentLabel).filter(Boolean);
  return Array.from(new Set(labels));
}

const ROLE_PRECEDENCE = ['admin', 'finalizer', 'approver', 'verifier', 'employee'];

/** Postgres enum arrays come back as '{a,b}' text unless cast; accept both. */
export function parseRoles(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  return (value || '')
    .replace(/[{}"]/g, '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

export function primaryRole(roles: string[]): string {
  const found = ROLE_PRECEDENCE.find((r) => roles.includes(r)) || roles[0] || 'employee';
  return found.charAt(0).toUpperCase() + found.slice(1);
}

/** "Employee - Procurement", "Approver - Procurement TL" */
export function contactRole(role: string, departments: string[], isLeader = false): string {
  const dep = departments[0];
  if (!dep) return isLeader ? `${role} TL` : role;
  return `${role} - ${dep}${isLeader ? ' TL' : ''}`;
}

export interface Contact {
  name: string;
  role: string;
  phone: string;
}

export const EMPTY_CONTACT: Contact = { name: '', role: '', phone: '' };

// ─── Cache ───────────────────────────────────────────────────────────────────

export const CACHE_TTL_SECONDS = 600;

/**
 * Returns the cached tab if present (with the generatedAt it was built with),
 * otherwise computes it, stamps generatedAt and stores it. `refresh` skips the
 * read so the Refresh button always gets fresh figures.
 */
export async function cachedTab<T extends object>(
  cache: CacheService,
  key: string,
  refresh: boolean,
  compute: () => Promise<T>,
): Promise<T & { generatedAt: string }> {
  if (!refresh) {
    const hit = await cache.get<T & { generatedAt: string }>(key);
    if (hit) return hit;
  }
  const generatedAt = isoIst();
  const payload = { generatedAt, ...(await compute()) };
  await cache.set(key, payload, CACHE_TTL_SECONDS);
  return payload;
}

export function cacheKey(tab: string, ...parts: (string | null)[]): string {
  return ['acc', 'v1', tab, ...parts.map((p) => p ?? 'all')].join(':');
}
