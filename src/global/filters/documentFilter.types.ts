/**
 * Common filtering for the document list APIs, their Excel exports and anything
 * else that lists documents the same way.
 *
 * One `ModuleFilterDefinition` per document type describes which filters exist
 * and where each one lives in the database. The parser turns a query string into
 * a validated `DocumentFilterInput`; the query layer turns that into SQL on the
 * shared document-visibility queries - so Get All and Export filter identically,
 * in the database, before pagination, inside the user's authorised dataset.
 *
 * Expressions are written against three kinds of alias, resolved at query time:
 *   `rec`  - the module's own record (rfpa, grns, ...)
 *   `doc`  - its approval document (documents)
 *   <name> - an entry of `joins`, e.g. `vendor` for `rec.selectedVendor`
 */

import { EntityTarget, ObjectLiteral } from 'typeorm';

export type FieldFilterKind =
  /** One or more UUIDs, comma separated; exact match. */
  | 'id'
  /** Case-insensitive partial match. */
  | 'text'
  /** One or more values of a known set, comma separated; exact match. */
  | 'enum'
  /** One or more free-text values, comma separated; case-insensitive exact match. */
  | 'iexact'
  | 'boolean'
  /** Inclusive lower / upper bound on a number. Paired by name: minX / maxX. */
  | 'min'
  | 'max'
  /** A single calendar day (YYYY-MM-DD). */
  | 'day';

export interface FieldFilter {
  /** Query-string parameter name. */
  param: string;
  kind: FieldFilterKind;
  /** A row matches when ANY of these expressions matches. */
  exprs: string[];
  /** Allowed values for `enum`. */
  values?: readonly string[];
  /**
   * For `id` filters that historically also carried a name: a value that is not a
   * UUID is matched partially against these expressions instead of rejected.
   */
  nameExprs?: string[];
  description: string;
}

/** Line items a document can be filtered by (product, variant, category, ...). */
export interface LineItemSource {
  entity: EntityTarget<ObjectLiteral>;
  /** Relation on the line pointing at its parent; `null` when the line table is the record itself (many-to-many). */
  parentRelation: string | null;
  /** Outer expression the parent id must equal. Defaults to `rec.id`. */
  parentIdExpr?: string;
  /** Relation on the line (or record) pointing at the product. */
  product: string;
  /** Relation on the line pointing at the product variant, when lines have one. */
  variant?: string;
  /** Extra line-level text filters, e.g. a return reason stored per line. */
  textFields?: { param: string; column: string; description: string }[];
}

export interface ModuleFilterDefinition {
  documentType: string;
  /** Human-readable module name, for documentation and errors. */
  module: string;
  entity: EntityTarget<ObjectLiteral>;
  /** The module's own document number column. */
  numberColumn: string;
  /** The date `startDate` / `endDate` filter on. */
  businessDate: { expr: string; kind: 'date' | 'timestamp'; source: string };
  /** Join name -> relation path from `rec` or another join. */
  joins: Record<string, string>;
  fields: FieldFilter[];
  /** Expressions searched by `search` (partial, case-insensitive), besides the number and creator. */
  search: string[];
  /** Products on line items. */
  lineItems?: LineItemSource;
  /** Products stored on the record itself (AQR): join names for product and variant. */
  headerProduct?: { product: string; variant?: string };
  /** `sort` key -> `alias.property` expression. Only these reach SQL ORDER BY. */
  sortable: Record<string, string>;
}

export type FilterValue = string | string[] | number | boolean;

/** Validated, normalised filters for one document type. Plain JSON: it is part of list cache keys. */
export interface DocumentFilterInput {
  documentType: string;
  criteria: Record<string, FilterValue>;
  sort?: { key: string; direction: 'ASC' | 'DESC' };
}
