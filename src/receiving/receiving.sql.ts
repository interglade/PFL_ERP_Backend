/**
 * Receiving links — SQL fragments shared by the status service and the three
 * source pickers (GRN numbers, DC numbers, RBC numbers).
 *
 * Every table and column name here comes from a constant map keyed by the
 * validated enum values; nothing from a request is ever interpolated. User
 * input (ids, search terms) always travels as a bound parameter.
 */

import { RECEIVABLE_GRN_STATUSES } from '../grn/grnApproval';
import { DocumentStatus, DocumentTypeEnum } from '../approvalFlow/entity/docuemnt.entity';
import { ProcessingDocType, ReceivingSourceType } from './receiving.types';

/** `documents.type` of each source. */
export const SOURCE_DOCUMENT_TYPE: Record<ReceivingSourceType, DocumentTypeEnum> = {
  grn: DocumentTypeEnum.GRN,
  'stock-transfer-dc': DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER,
  rbc: DocumentTypeEnum.RETURN_BY_CUSTOMER,
};

/** `documents.type` of each processing document. */
export const PROCESSING_DOCUMENT_TYPE: Record<ProcessingDocType, DocumentTypeEnum> = {
  aqr: DocumentTypeEnum.AQR,
  inward: DocumentTypeEnum.INWARD_REGISTER,
  dump: DocumentTypeEnum.DUMP_REGISTER,
  rtv: DocumentTypeEnum.RETURN_TO_VENDOR,
};

interface ProcessingTable {
  table: string;
  /** FK column to each source type; null when the document type cannot reference that source (RTV → GRN only). */
  fk: Record<ReceivingSourceType, string | null>;
  /** Extra "not deleted" predicates beyond `isDeleted` / `deletedAt` (RTV has a second delete-date column). */
  extraLive: string[];
}

export const PROCESSING_TABLE: Record<ProcessingDocType, ProcessingTable> = {
  aqr: {
    table: 'aqr',
    fk: { grn: 'grn_id', 'stock-transfer-dc': 'delivery_challan_id', rbc: 'rbc_id' },
    extraLive: [],
  },
  inward: {
    table: 'inward_register',
    fk: { grn: 'grn_id', 'stock-transfer-dc': 'delivery_challan_id', rbc: 'rbc_id' },
    extraLive: [],
  },
  dump: {
    table: 'dump_register',
    fk: { grn: 'grn_id', 'stock-transfer-dc': 'delivery_challan_id', rbc: 'rbc_id' },
    extraLive: [],
  },
  rtv: {
    table: 'return_to_vendor',
    fk: { grn: 'grn_id', 'stock-transfer-dc': null, rbc: null },
    extraLive: ['deleted_at_new IS NULL'],
  },
};

/** Processing document types that can be raised against a source type. */
export function processingTypesFor(sourceType: ReceivingSourceType): ProcessingDocType[] {
  return (Object.keys(PROCESSING_TABLE) as ProcessingDocType[]).filter(
    (docType) => PROCESSING_TABLE[docType].fk[sourceType] !== null,
  );
}

function quote(literal: string): string {
  // Only ever called with enum constants from this module; escaping is belt and braces.
  return `'${literal.replace(/'/g, "''")}'`;
}

/**
 * `EXISTS (...)`: the source row has a live `documents` row with status COMPLETE.
 * `sourceIdExpr` is a SQL expression yielding the source id (uuid), e.g. `"grn"."id"`.
 */
export function completeDocumentExistsSql(sourceIdExpr: string, sourceType: ReceivingSourceType): string {
  const type = quote(SOURCE_DOCUMENT_TYPE[sourceType]);
  // D-4: a GRN can be received once fully approved, while finance finalisation is pending.
  const statusTest = sourceType === 'grn'
    ? `IN (${RECEIVABLE_GRN_STATUSES.map(quote).join(', ')})`
    : `= ${quote(DocumentStatus.COMPLETE)}`;
  return `EXISTS (SELECT 1 FROM documents rl_d WHERE rl_d.document_type_id = (${sourceIdExpr})::text AND rl_d.type::text = ${type} AND rl_d.status::text ${statusTest} AND rl_d."deletedAt" IS NULL)`;
}

/**
 * `EXISTS (...)`: at least one *counting* processing document of `docType`
 * references the source. Counting = business row not deleted and no
 * `documents` row of it with status REJECT being the only one (a document
 * with no `documents` row at all still counts — it is an orphan that must
 * block duplicates rather than hide).
 */
export function countingDocumentExistsSql(
  sourceIdExpr: string,
  sourceType: ReceivingSourceType,
  docType: ProcessingDocType,
): string | null {
  const spec = PROCESSING_TABLE[docType];
  const fk = spec.fk[sourceType];
  if (!fk) return null;
  const alias = `rl_${docType}`;
  const docAlias = `rl_${docType}_d`;
  const type = quote(PROCESSING_DOCUMENT_TYPE[docType]);
  const reject = quote(DocumentStatus.REJECT);
  const live = [`${alias}."isDeleted" = false`, `${alias}."deletedAt" IS NULL`, ...spec.extraLive.map((p) => `${alias}.${p}`)].join(' AND ');
  return (
    `EXISTS (SELECT 1 FROM ${spec.table} ${alias} ` +
    `LEFT JOIN documents ${docAlias} ON ${docAlias}.document_type_id = ${alias}.id::text AND ${docAlias}.type::text = ${type} AND ${docAlias}."deletedAt" IS NULL ` +
    `WHERE ${alias}.${fk} = (${sourceIdExpr}) AND ${live} AND COALESCE(${docAlias}.status::text, '') <> ${reject})`
  );
}

/** `NOT EXISTS (...)` form of {@link countingDocumentExistsSql}; `TRUE` when the doc type does not apply to the source type. */
export function noCountingDocumentSql(
  sourceIdExpr: string,
  sourceType: ReceivingSourceType,
  docType: ProcessingDocType,
): string {
  const exists = countingDocumentExistsSql(sourceIdExpr, sourceType, docType);
  return exists ? `NOT ${exists}` : 'TRUE';
}

/** `(EXISTS a OR EXISTS b ...)` over every processing type that applies to the source type. */
export function anyCountingDocumentSql(sourceIdExpr: string, sourceType: ReceivingSourceType): string {
  const parts = processingTypesFor(sourceType)
    .map((docType) => countingDocumentExistsSql(sourceIdExpr, sourceType, docType))
    .filter((sql): sql is string => Boolean(sql));
  return `(${parts.join(' OR ')})`;
}

/**
 * Same rule as {@link countingDocumentExistsSql}, evaluated like the status
 * service does it in JS (`isCountingDocument`): the document counts when its
 * *newest* live `documents` row is not REJECT (or it has none). Used by the
 * Arrivals state classification, which must agree with the computed state.
 */
export function countingDocumentLatestSql(
  sourceIdExpr: string,
  sourceType: ReceivingSourceType,
  docType: ProcessingDocType,
  extraWhere = '',
): string | null {
  const spec = PROCESSING_TABLE[docType];
  const fk = spec.fk[sourceType];
  if (!fk) return null;
  const alias = `rs_${docType}`;
  const type = quote(PROCESSING_DOCUMENT_TYPE[docType]);
  const reject = quote(DocumentStatus.REJECT);
  const live = [`${alias}."isDeleted" = false`, `${alias}."deletedAt" IS NULL`, ...spec.extraLive.map((p) => `${alias}.${p}`)].join(' AND ');
  const latest =
    `(SELECT rs_d.status::text FROM documents rs_d WHERE rs_d.document_type_id = ${alias}.id::text AND rs_d.type::text = ${type} ` +
    `AND rs_d."deletedAt" IS NULL ORDER BY rs_d."createdAt" DESC LIMIT 1)`;
  return (
    `EXISTS (SELECT 1 FROM ${spec.table} ${alias} WHERE ${alias}.${fk} = (${sourceIdExpr}) AND ${live} ` +
    `AND COALESCE(${latest}, '') <> ${reject}${extraWhere ? ` AND ${extraWhere.replace(/\$doc/g, alias)}` : ''})`
  );
}

/**
 * Arrivals state as far as SQL can tell it exactly (see `deriveState`):
 * `not-started` without any counting document; without a counting Inward the
 * source cannot be `done`, so it is `legacy` (a counting dump line without net
 * weight) or `open`. NULL when an Inward counts: done / open / legacy then
 * depends on the per-product kg matching, which only the status service computes.
 */
export function sqlStateExpr(sourceIdExpr: string, sourceType: ReceivingSourceType): string {
  const any = processingTypesFor(sourceType)
    .map((docType) => countingDocumentLatestSql(sourceIdExpr, sourceType, docType))
    .filter((sql): sql is string => Boolean(sql))
    .join(' OR ');
  const inward = countingDocumentLatestSql(sourceIdExpr, sourceType, 'inward');
  // Line FK and columns from DumpProduct (dump_product.dump_register_id, product_id, "netWeight").
  const legacyDump = countingDocumentLatestSql(
    sourceIdExpr,
    sourceType,
    'dump',
    `EXISTS (SELECT 1 FROM dump_product rs_dp WHERE rs_dp.dump_register_id = $doc.id AND rs_dp.product_id IS NOT NULL AND rs_dp."netWeight" IS NULL)`,
  );
  return (
    `(CASE WHEN NOT (${any}) THEN 'not-started' ` +
    `WHEN NOT ${inward} THEN (CASE WHEN ${legacyDump} THEN 'legacy' ELSE 'open' END) ` +
    `ELSE NULL END)`
  );
}

export function isProcessingDocType(value: unknown): value is ProcessingDocType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROCESSING_TABLE, value);
}

export function isReceivingSourceType(value: unknown): value is ReceivingSourceType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_DOCUMENT_TYPE, value);
}
