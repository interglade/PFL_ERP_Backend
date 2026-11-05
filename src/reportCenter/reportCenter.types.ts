/**
 * Report Center (docs/reports-plan.md): every report is a ReportDefinition. The engine runs it
 * once and the same ReportResult feeds all four outputs - table view, template view, PDF, Excel.
 */

/** The five report types in the employee permission config. */
export type ReportPermKey =
  | 'purchase-report'
  | 'sales-report'
  | 'operation-report'
  | 'user-performance-report'
  | 'business-report';

export type ColumnType = 'text' | 'date' | 'kg' | 'qty' | 'inr' | 'rate' | 'pct' | 'count' | 'days';

/**
 * How a column is totalled in group subtotals and the grand total.
 *  - sum / count / min / max: the usual
 *  - ratio: sum(num) / sum(den) x scale, e.g. Rs/kg = amount / kg, never an average of averages
 *  - none: left blank
 */
export type Aggregate =
  | { kind: 'sum' }
  | { kind: 'count' }
  | { kind: 'min' }
  | { kind: 'max' }
  | { kind: 'ratio'; num: string; den: string; scale?: number }
  | { kind: 'none' };

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  aggregate?: Aggregate;
  /** Relative width hint for the template/PDF and Excel (characters). */
  width?: number;
  /** Hidden from the table/template/PDF but still exported to Excel (e.g. ids, extra detail). */
  excelOnly?: boolean;
  /** Totalled in group subtotals only, blank in the grand total (e.g. a customer's credit limit). */
  groupOnly?: boolean;
}

export type ParamKind =
  | 'dateRange'
  | 'date'
  | 'companies'
  | 'locations'
  | 'suppliers'
  | 'supplier'
  | 'customers'
  | 'customer'
  | 'products'
  | 'employees'
  | 'select';

export interface ParamSpec {
  key: string;
  label: string;
  kind: ParamKind;
  required?: boolean;
  /** For kind 'select'. */
  options?: { value: string; label: string }[];
  default?: string;
  help?: string;
}

/** Parsed request parameters. Lists are always arrays (possibly empty = all). */
export interface ReportParams {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  asOn: string; // YYYY-MM-DD
  companyIds: string[];
  locationIds: string[];
  vendorIds: string[];
  farmerIds: string[];
  /** Registered customers (customers table). */
  customerIds: string[];
  productIds: string[];
  employeeIds: string[];
  /** Chosen grouping levels, in order, from the definition's `groupings`. */
  groupBy: string[];
  /** Show only group totals (no detail rows). */
  summaryOnly: boolean;
  /** Any other 'select' parameter, by key. */
  extra: Record<string, string>;
}

/** Who the viewer is and which creators' documents they may see. */
export interface ReportScope {
  userId: string;
  userName: string;
  isAdmin: boolean;
  /** null = everything; otherwise only documents created by these employees. */
  creatorIds: string[] | null;
}

export interface GroupingOption {
  key: string;
  label: string;
  /** Row field holding the group's display label (defaults to `key`). */
  labelField?: string;
}

export interface Kpi {
  label: string;
  value: number;
  type: ColumnType;
  /** Same measure for the comparison period, when the report compares. */
  previous?: number | null;
  /** Higher is better (green ▲) unless false. */
  higherIsBetter?: boolean;
  hint?: string;
}

export interface ChartSpec {
  type: 'bar' | 'line';
  title: string;
  categories: string[];
  series: { name: string; type: ColumnType; values: number[] }[];
}

/** A link from a row to a document page or to another report with filters set. */
export type RowLink =
  | {
      kind: 'document';
      docType: 'grn' | 'rfpa' | 'deal-slip' | 'final-invoice' | 'dc-customer' | 'dc-other' | 'rbc' | 'second-sale';
      documentId: string;
    }
  /** `type` (the target report's permission key, used in its URL) is filled in by the service. */
  | { kind: 'report'; report: string; params: Record<string, string>; label?: string; type?: ReportPermKey };

export type RowKind = 'group' | 'detail' | 'subtotal' | 'total' | 'opening' | 'closing';

export interface TableRow {
  kind: RowKind;
  /** Nesting depth: 0 = outermost group. Detail rows sit one level below the last group. */
  level: number;
  label?: string;
  cells: Record<string, string | number | null>;
  link?: RowLink;
}

/** Name/address block shown above a statement (e.g. supplier statement of account). */
export interface PartyBlock {
  title: string;
  name: string;
  lines: string[];
}

export interface ReportLayout {
  orientation: 'portrait' | 'landscape';
  /** Statement templates open in the template view by default. */
  defaultView: 'table' | 'template';
}

export interface ReportResult {
  key: string;
  code: string;
  title: string;
  typeLabel: string;
  description: string;
  generatedAt: string; // "03 Nov 2026, 10:42 AM" IST
  generatedBy: string;
  company: { name: string; address: string; gstNo: string; logo: string } | null;
  paramsSummary: { label: string; value: string }[];
  kpis: Kpi[];
  chart: ChartSpec | null;
  party: PartyBlock | null;
  columns: ReportColumn[];
  rows: TableRow[];
  detailCount: number;
  truncated: boolean;
  notes: string[];
  layout: ReportLayout;
}

/** What a definition's `run` returns; the engine adds grouping, totals and the header. */
export interface ReportData {
  /** Detail rows, already sorted for display. */
  rows: Record<string, any>[];
  /** Optional per-row link builder. */
  link?: (row: Record<string, any>) => RowLink | undefined;
  /** Optional link for group rows, by grouping key (e.g. 'supplierKey' -> supplier statement). */
  groupLink?: (groupingKey: string, sample: Record<string, any>) => RowLink | undefined;
  kpis?: Kpi[];
  chart?: ChartSpec | null;
  party?: PartyBlock | null;
  /** Rows placed before / after the table body (statement opening / closing balance). */
  opening?: TableRow | null;
  closing?: TableRow | null;
  notes?: string[];
  /** Set when the definition cut the rows itself. */
  truncated?: boolean;
  /** Overrides the definition's columns for this run (e.g. dynamic period columns). */
  columns?: ReportColumn[];
  /** Turns grand-total row off (statements carry their own closing row). */
  noGrandTotal?: boolean;
}

export interface ReportDefinition {
  key: string;
  /** Catalogue code, e.g. "P1". */
  code: string;
  title: string;
  description: string;
  permKey: ReportPermKey;
  params: ParamSpec[];
  groupings: GroupingOption[];
  defaultGroupBy: string[];
  /** Whether the "Summary only" switch applies (needs at least one grouping). */
  allowSummaryOnly?: boolean;
  columns: ReportColumn[];
  layout: ReportLayout;
  run(params: ReportParams, scope: ReportScope): Promise<ReportData>;
}

export const REPORT_TYPE_LABELS: Record<ReportPermKey, string> = {
  'purchase-report': 'Purchase Reports',
  'sales-report': 'Sales Reports',
  'operation-report': 'Operation Reports',
  'user-performance-report': 'User Performance Report',
  'business-report': 'Business Reports',
};

/** Detail rows above this are cut (with a notice) so the screen and PDF stay usable. */
export const MAX_DETAIL_ROWS = 20000;
/** PDF is refused above this many detail rows: Excel or a summary grouping is offered instead. */
export const MAX_PDF_ROWS = 5000;
