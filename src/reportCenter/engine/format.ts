import { ColumnType } from '../reportCenter.types';

const DP: Record<ColumnType, number> = {
  text: 0, date: 0, kg: 2, qty: 2, inr: 2, rate: 2, pct: 1, count: 0, days: 0,
};

/** Indian digit grouping (12,34,567.00). Blank for null / non-numbers. */
export function fmtNumber(v: unknown, type: ColumnType): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const dp = DP[type];
  const s = n.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return type === 'pct' ? `${s}%` : s;
}

export function fmtCell(v: unknown, type: ColumnType): string {
  if (type === 'text' || type === 'date') return v === null || v === undefined ? '' : String(v);
  return fmtNumber(v, type);
}

/** KPI value with its unit: "Rs 12,34,567", "1,234.50 kg", "12.5%", "18 days". */
export function fmtKpi(v: number, type: ColumnType): string {
  switch (type) {
    case 'inr':
      return `Rs ${Math.round(v).toLocaleString('en-IN')}`;
    case 'rate':
      return `Rs ${fmtNumber(v, 'rate')}`;
    case 'kg':
      return `${Math.round(v).toLocaleString('en-IN')} kg`;
    case 'pct':
      return fmtNumber(v, 'pct');
    case 'days':
      return `${fmtNumber(v, 'days')} days`;
    default:
      return Math.round(v).toLocaleString('en-IN');
  }
}

/** Short axis label: 1.2K, 3.4L, 5.6Cr. */
export function fmtShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${Math.round(v * 10) / 10}`;
}

export const isNumeric = (type: ColumnType) => type !== 'text' && type !== 'date';

/** % change vs previous; null when there is no base. */
export function changePct(value: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10;
}

export const escapeHtml = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
