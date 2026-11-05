import { GroupingOption, ReportColumn, RowLink, TableRow } from '../reportCenter.types';

const n = (v: any): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const tidy = (x: number) => Math.round(x * 1000) / 1000;

/** Subtotal / total value of one column over a set of detail rows. */
export function aggregate(col: ReportColumn, rows: Record<string, any>[]): number | null {
  const agg = col.aggregate ?? { kind: 'none' };
  switch (agg.kind) {
    case 'sum':
      return tidy(rows.reduce((s, r) => s + n(r[col.key]), 0));
    case 'count':
      return rows.length;
    case 'min': {
      const vals = rows.map((r) => r[col.key]).filter((v) => v !== null && v !== undefined && v !== '').map(n);
      return vals.length ? Math.min(...vals) : null;
    }
    case 'max': {
      const vals = rows.map((r) => r[col.key]).filter((v) => v !== null && v !== undefined && v !== '').map(n);
      return vals.length ? Math.max(...vals) : null;
    }
    case 'ratio': {
      const den = rows.reduce((s, r) => s + n(r[agg.den]), 0);
      if (!den) return null;
      return tidy((rows.reduce((s, r) => s + n(r[agg.num]), 0) / den) * (agg.scale ?? 1));
    }
    default:
      return null;
  }
}

function totalsCells(columns: ReportColumn[], rows: Record<string, any>[], grand = false) {
  const cells: Record<string, string | number | null> = {};
  for (const c of columns) cells[c.key] = grand && c.groupOnly ? null : aggregate(c, rows);
  return cells;
}

function detailCells(columns: ReportColumn[], row: Record<string, any>) {
  const cells: Record<string, string | number | null> = {};
  for (const c of columns) {
    const v = row[c.key];
    cells[c.key] = v === undefined ? null : v;
  }
  return cells;
}

/**
 * Turns sorted detail rows into the table body: for each grouping level a heading row,
 * the rows inside, and a subtotal row; then a grand total. With `summaryOnly` the last
 * grouping level becomes one row per group (its totals) and detail rows are left out.
 * Groups are ordered by their key; rows inside a group keep the order they came in.
 */
export function buildTable(opts: {
  rows: Record<string, any>[];
  columns: ReportColumn[];
  groups: GroupingOption[];
  summaryOnly: boolean;
  grandTotal: boolean;
  link?: (row: Record<string, any>) => RowLink | undefined;
  /** Link for a group row (e.g. supplier -> supplier statement), by grouping key. */
  groupLink?: (groupingKey: string, sample: Record<string, any>) => RowLink | undefined;
}): TableRow[] {
  const { rows, columns, groups, summaryOnly, grandTotal, link, groupLink } = opts;
  const out: TableRow[] = [];

  const walk = (set: Record<string, any>[], level: number) => {
    if (level === groups.length) {
      for (const r of set) out.push({ kind: 'detail', level, cells: detailCells(columns, r), link: link?.(r) });
      return;
    }
    const g = groups[level];
    const buckets = new Map<string, Record<string, any>[]>();
    for (const r of set) {
      const k = String(r[g.key] ?? '');
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(r);
    }
    // Date-like keys (2026-10-05, 2026-10, 2026-10-W1) sort by key = chronologically; anything else by its label.
    const labelOf = (k: string) => String(buckets.get(k)![0][g.labelField ?? g.key] ?? '');
    const sortKey = (k: string) => (/^\d{4}-\d{2}/.test(k) ? k : labelOf(k).toLowerCase());
    const keys = [...buckets.keys()].sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'en', { numeric: true }));
    const lastLevel = level === groups.length - 1;
    for (const k of keys) {
      const members = buckets.get(k)!;
      const label = String(members[0][g.labelField ?? g.key] ?? '') || '(blank)';
      const gLink = groupLink?.(g.key, members[0]);
      if (summaryOnly && lastLevel) {
        out.push({ kind: 'subtotal', level, label, cells: totalsCells(columns, members), link: gLink });
        continue;
      }
      out.push({ kind: 'group', level, label: `${g.label}: ${label}`, cells: {}, link: gLink });
      walk(members, level + 1);
      out.push({ kind: 'subtotal', level, label: `Total ${label}`, cells: totalsCells(columns, members) });
    }
  };

  walk(rows, 0);
  if (grandTotal && rows.length) {
    out.push({ kind: 'total', level: 0, label: 'Grand Total', cells: totalsCells(columns, rows, true) });
  }
  return out;
}
