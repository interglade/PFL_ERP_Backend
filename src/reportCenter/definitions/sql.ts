import { AppDataSource } from '../../utils/data-source';

/** Collects positional parameters so no value is ever interpolated into SQL. */
export class Sql {
  readonly values: any[] = [];
  add(v: any): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/** Payment mode for display: stored lower case ('neft', 'cash'); NEFT / RTGS / UPI in capitals, others capitalised. */
export const paymentModeSql = (col: string) =>
  `CASE WHEN LOWER(${col}) IN ('neft', 'rtgs', 'upi') THEN UPPER(${col}) ELSE INITCAP(NULLIF(${col}, '')) END`;

/**
 * The newest approval-companion row of a business row (documents.document_type_id is not
 * unique, so a LATERAL picks one). Exposes `<as>.id` (the documentId the detail pages use)
 * and `<as>.status`.
 */
export const docLateral = (alias: string, docType: string, as = 'd') =>
  `LEFT JOIN LATERAL (SELECT dd.id, dd.status::text AS status FROM documents dd
                       WHERE dd.document_type_id = ${alias}.id::text AND dd.type = '${docType}' AND dd."isDeleted" = false
                       ORDER BY dd."createdAt" DESC LIMIT 1) ${as} ON true`;

/**
 * Status condition for a "documents counted" mode:
 *  - complete: approval finished
 *  - all: complete + still in approval (never rejected or draft)
 *  - any: no condition
 */
export const statusCondition = (as: string, mode: string) => {
  if (mode === 'any') return 'TRUE';
  return mode === 'all' ? `${as}.status IN ('Hold', 'Verified', 'Approved', 'Finalizing', 'Complete')` : `${as}.status = 'Complete'`;
};

export const productLabel = (p: string, pv: string) =>
  `(COALESCE(${p}.product_name, '') || COALESCE(' - ' || NULLIF(${pv}."variantName", ''), ''))`;

export const employeeName = (e: string) => `NULLIF(trim(concat_ws(' ', ${e}."firstName", ${e}."lastName")), '')`;

/** IST calendar day of a timestamp column (the old tables store IST wall-clock time). */
export const dayOf = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`;

let dcColumns: Promise<Set<string>> | null = null;

/**
 * The DC child tables share one table (single-table inheritance) and have stored their
 * from-location in different physical columns over time; only some exist in a given DB.
 * Returns COALESCE over the ones that exist (see inventoryStock/batch/batchDocuments.ts).
 */
export async function dcFromLocationSql(dc: string): Promise<string> {
  dcColumns ??= AppDataSource.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'delivery_challan_purchase'`,
    [],
  ).then((rows: any[]) => new Set(rows.map((r) => r.column_name)));
  const cols = await dcColumns;
  const present = ['other_from_location_id_for_other', 'from_location_id', 'branch_id'].filter((c) => cols.has(c));
  return present.length ? `COALESCE(${present.map((c) => `${dc}.${c}`).join(', ')})` : 'NULL::uuid';
}
