/**
 * Receiving links — SQL fragments shared by the status service and the three
 * source pickers (GRN numbers, DC numbers, RBC numbers).
 *
 * Every table and column name here comes from a constant map keyed by the
 * validated enum values; nothing from a request is ever interpolated. User
 * input (ids, search terms) always travels as a bound parameter.
 */

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
  const complete = quote(DocumentStatus.COMPLETE);
  return `EXISTS (SELECT 1 FROM documents rl_d WHERE rl_d.document_type_id = (${sourceIdExpr})::text AND rl_d.type::text = ${type} AND rl_d.status::text = ${complete} AND rl_d."deletedAt" IS NULL)`;
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

export function isProcessingDocType(value: unknown): value is ProcessingDocType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROCESSING_TABLE, value);
}

export function isReceivingSourceType(value: unknown): value is ReceivingSourceType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_DOCUMENT_TYPE, value);
}
