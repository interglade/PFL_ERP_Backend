import moment from 'moment-timezone';
import { AppDataSource } from '../../utils/data-source';
import { IST, previousPeriod } from '../engine/params';
import { ChartSpec, ColumnType, ReportParams } from '../reportCenter.types';

export const query = (sql: string, values: any[]): Promise<any[]> => AppDataSource.query(sql, values);

export const num = (v: any): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
export const round = (x: number, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;
export const ratio = (a: number, b: number, scale = 1) => (b ? round((a / b) * scale, 2) : 0);

export const dayLabel = (d: string) => (d ? moment.tz(d, 'YYYY-MM-DD', IST).format('DD MMM YYYY') : '');
export const monthLabel = (m: string) => (m ? moment.tz(m + '-01', 'YYYY-MM-DD', IST).format('MMM YYYY') : '');

/** Planning week of a day: 1-7, 8-14, 15-21, 22-end (spec §2.6). Key sorts chronologically. */
export function planningWeek(day: string): { key: string; label: string } {
  const m = moment.tz(day, 'YYYY-MM-DD', IST);
  const w = Math.min(Math.floor((m.date() - 1) / 7) + 1, 4);
  const startDay = (w - 1) * 7 + 1;
  const endDay = w === 4 ? m.daysInMonth() : w * 7;
  return { key: `${m.format('YYYY-MM')}-W${w}`, label: `${m.format('MMM YYYY')} W${w} (${startDay}-${endDay})` };
}

/** Day buckets for short ranges, months for long ones. */
export function chartBucket(p: ReportParams): 'day' | 'month' {
  const days = moment.tz(p.to, IST).diff(moment.tz(p.from, IST), 'days') + 1;
  return days <= 62 ? 'day' : 'month';
}

/** Sums `value(row)` per day or month across the whole selected period (empty buckets included). */
export function periodChart(
  p: ReportParams,
  rows: Record<string, any>[],
  title: string,
  series: { name: string; type: ColumnType; value: (r: Record<string, any>) => number }[],
): ChartSpec {
  const bucket = chartBucket(p);
  const cursor = moment.tz(p.from, IST).startOf(bucket);
  const end = moment.tz(p.to, IST);
  const keys: string[] = [];
  const labels: string[] = [];
  while (cursor.isSameOrBefore(end)) {
    keys.push(cursor.format(bucket === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM'));
    labels.push(cursor.format(bucket === 'day' ? 'DD MMM' : 'MMM YY'));
    cursor.add(1, bucket);
  }
  const index = new Map(keys.map((k, i) => [k, i]));
  const values = series.map(() => keys.map(() => 0));
  for (const r of rows) {
    const i = index.get(bucket === 'day' ? r.day : r.month);
    if (i === undefined) continue;
    series.forEach((s, si) => (values[si][i] += s.value(r)));
  }
  return {
    type: 'bar',
    title: `${title} by ${bucket}`,
    categories: labels,
    series: series.map((s, si) => ({ name: s.name, type: s.type, values: values[si].map((v) => round(v)) })),
  };
}

/** Top-N categories of a measure, for "by supplier / by product" bar charts. */
export function topChart(
  rows: Record<string, any>[],
  title: string,
  key: (r: Record<string, any>) => string,
  series: { name: string; type: ColumnType; value: (r: Record<string, any>) => number },
  limit = 10,
): ChartSpec {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(key(r), (totals.get(key(r)) ?? 0) + series.value(r));
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  return {
    type: 'bar',
    title,
    categories: top.map(([k]) => k),
    series: [{ name: series.name, type: series.type, values: top.map(([, v]) => round(v)) }],
  };
}

/** The same params moved to the previous period of equal length. */
export function previousParams(p: ReportParams): ReportParams {
  return { ...p, ...previousPeriod(p.from, p.to) };
}

export const distinct = (rows: Record<string, any>[], key: string) => new Set(rows.map((r) => r[key])).size;
