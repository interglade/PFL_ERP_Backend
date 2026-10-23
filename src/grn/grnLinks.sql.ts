/**
 * SQL fragments shared by the Deal Slip -> GRN and GRN -> voucher link rules
 * (D-6). Table / column names and document types come from constants; request
 * values (ids) always travel as bound parameters.
 *
 * Definitions used throughout:
 * - live row:      `isDeleted = false AND deletedAt IS NULL` (same as the receiving links);
 * - document status: the status of the row's newest non-deleted `documents` row;
 * - rejected:      that status is REJECT (a row with no `documents` row counts as not rejected).
 */

import { DocumentStatus } from '../approvalFlow/entity/docuemnt.entity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/** Id of a relation value sent as `"<uuid>"` or `{ id }`; null for blank / anything else. */
export function relationIdOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return ((value as { id: string }).id).trim() || null;
  }
  return null;
}

export function sqlLiteral(literal: string): string {
  return `'${literal.replace(/'/g, "''")}'`;
}

/** `alias."isDeleted" = false AND alias."deletedAt" IS NULL` */
export function liveRowSql(alias: string): string {
  return `${alias}."isDeleted" = false AND ${alias}."deletedAt" IS NULL`;
}

/** Scalar subquery: status (text) of the newest non-deleted `documents` row of `idExpr` with `documents.type = docType`. */
export function latestDocumentStatusSql(idExpr: string, docType: string, alias = 'ld'): string {
  return (
    `(SELECT ${alias}.status::text FROM documents ${alias} ` +
    `WHERE ${alias}.document_type_id = (${idExpr})::text AND ${alias}.type::text = ${sqlLiteral(docType)} AND ${alias}."deletedAt" IS NULL ` +
    `ORDER BY ${alias}."createdAt" DESC LIMIT 1)`
  );
}

/** The row's latest document is not REJECT (no document at all counts as not rejected). */
export function notRejectedSql(idExpr: string, docType: string, alias = 'ld'): string {
  return `COALESCE(${latestDocumentStatusSql(idExpr, docType, alias)}, '') <> ${sqlLiteral(DocumentStatus.REJECT)}`;
}
