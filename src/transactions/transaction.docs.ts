/**
 * Transaction documents as they are now: number, deletion, newest approval
 * row (`documents`) and creator, read from each document's header table.
 * Table / column names come from the constant TXN_DOC_TYPES map only.
 */

import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import { DocumentStatus } from '../approvalFlow/entity/docuemnt.entity';
import { TXN_DOC_TYPES, TxnDocType, isTxnDocType } from './transaction.types';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);

/** A document of a transaction with its current state. */
export interface DocFact {
  docType: TxnDocType;
  id: string;
  docNo: string | null;
  /** `documents.id` of the newest approval row, or null. */
  documentId: string | null;
  /** `documents.status` of the newest approval row (hold, COMPLETE, REJECT, …), or null. */
  status: string | null;
  deleted: boolean;
  step: string;
  createdAt: Date | null;
  createdBy: string | null;
}

/** Not deleted and not rejected. */
export const isLiveDoc = (d: DocFact): boolean => !d.deleted && d.status !== DocumentStatus.REJECT;

/** Quoted SQL identifier (constants only). */
export const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/**
 * Physical foreign-key column of a relation, from TypeORM metadata. Needed for
 * relations without an explicit `@JoinColumn` and for the DC child entities,
 * whose shared `fromLocation` property maps to different columns
 * (docs/receiving-links-plan.md §5).
 */
export function fkColumn(manager: EntityManager, entity: EntityTarget<ObjectLiteral>, propertyPath: string): string {
  const relation = manager.connection.getMetadata(entity).findRelationWithPropertyPath(propertyPath);
  const column = relation?.joinColumns[0]?.databaseName;
  if (!column) throw new Error(`Transactions: relation ${String((entity as { name?: string }).name ?? entity)}.${propertyPath} has no join column`);
  return ident(column);
}

interface DocRow {
  id: string;
  no: string | null;
  deleted: boolean;
  created_at: Date | null;
  document_id: string | null;
  status: string | null;
  created_by: string | null;
}

/** Current state of the given documents (any mix of types); unknown ids are skipped. */
export async function loadDocFacts(
  manager: EntityManager,
  refs: Array<{ docType: string; docId: string; step: string; docNo?: string | null }>,
): Promise<DocFact[]> {
  const byType = new Map<TxnDocType, typeof refs>();
  for (const ref of refs) {
    if (!isTxnDocType(ref.docType) || !isUuid(ref.docId)) continue;
    const list = byType.get(ref.docType) ?? [];
    list.push(ref);
    byType.set(ref.docType, list);
  }
  const facts: DocFact[] = [];
  for (const [docType, list] of Array.from(byType.entries())) {
    const info = TXN_DOC_TYPES[docType];
    const rows: DocRow[] = await manager.query(
      `SELECT h.id::text AS id, h.${ident(info.numberColumn)}::text AS no, h."createdAt" AS created_at,
              (COALESCE(h."isDeleted", false) OR h."deletedAt" IS NOT NULL) AS deleted,
              d.id::text AS document_id, d.status::text AS status,
              NULLIF(TRIM(CONCAT(u."firstName", ' ', u."lastName")), '') AS created_by
         FROM ${ident(info.table)} h
         LEFT JOIN LATERAL (
           SELECT dd.id, dd.status, dd.last_action_by FROM documents dd
            WHERE dd.document_type_id = h.id::text AND dd.type::text = $2 AND dd."deletedAt" IS NULL
            ORDER BY dd."createdAt" DESC LIMIT 1) d ON true
         LEFT JOIN employees u ON u.id = d.last_action_by
        WHERE h.id = ANY($1::uuid[])`,
      [list.map((r) => r.docId), info.documentsType],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const ref of list) {
      const row = byId.get(ref.docId);
      facts.push({
        docType,
        id: ref.docId,
        docNo: row ? row.no : ref.docNo ?? null,
        documentId: row?.document_id ?? null,
        status: row ? row.status : null,
        // A header row that no longer exists counts as deleted.
        deleted: row ? Boolean(row.deleted) : true,
        step: ref.step,
        createdAt: row?.created_at ?? null,
        createdBy: row?.created_by ?? null,
      });
    }
  }
  return facts;
}

/** The documents of a transaction (transaction_documents) with their current state, oldest first. */
export async function loadTransactionDocFacts(manager: EntityManager, txnNo: string): Promise<DocFact[]> {
  const refs: Array<{ doc_type: string; doc_id: string; step: string; doc_no: string | null }> = await manager.query(
    `SELECT doc_type, doc_id::text AS doc_id, step, doc_no FROM transaction_documents WHERE txn_no = $1 ORDER BY created_at, id`,
    [txnNo],
  );
  const facts = await loadDocFacts(manager, refs.map((r) => ({ docType: r.doc_type, docId: r.doc_id, step: r.step, docNo: r.doc_no })));
  const order = new Map(refs.map((r, i) => [`${r.doc_type}:${r.doc_id}`, i]));
  return facts.sort((a, b) => (order.get(`${a.docType}:${a.id}`) ?? 0) - (order.get(`${b.docType}:${b.id}`) ?? 0));
}
