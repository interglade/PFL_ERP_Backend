/**
 * Process notifications between documents (Phase D-9, client decision
 * 2026-10-15): each message goes to the document's creator and every user of
 * its approval flow (verifiers, approvers, finalizers), without location
 * scoping.
 *
 *   GRN fully approved              → GRN people + its pending purchase dispatch's people
 *   Transfer / Customer DC approved → its pending dispatch's people
 *   Dispatch approved               → purchase / transfer: the source's people (goods on the way, receive in Arrivals)
 *                                     sales: the Customer DC's people (confirm delivery once delivered)
 *   Delivery confirmed / undone     → the Customer DC's people (invoice can / can no longer be created)
 *   Daily reminder                  → people of sources ready to receive for more than a day
 */

import { DataSource, EntityManager } from 'typeorm';
import { Documentb, DocumentStatus, DocumentTypeEnum } from '../approvalFlow/entity/docuemnt.entity';
import { isGrnReceivableStatus } from '../grn/grnApproval';
import logger from '../utils/logger';

export interface Notifier {
  createBatchNoti(message: string, userIds: string[]): Promise<void>;
}

type Users = Array<{ id: string }> | null | undefined;
const ids = (users: Users) => (users ?? []).map((u) => u.id).filter(Boolean);

/** Creator + approval-flow users of the newest approval document of a record. */
export async function documentPeople(manager: EntityManager, type: string, recordId: string): Promise<string[]> {
  const document = await manager.getRepository(Documentb).findOne({
    where: { document_type_id: recordId, type: type as DocumentTypeEnum },
    order: { createdAt: 'DESC' },
    relations: [
      'lastActionBy',
      'approvalFlow', 'approvalFlow.creator', 'approvalFlow.verifiers',
      'approvalFlow.approvers',
      'approvalFlow.approvers.firstApprover', 'approvalFlow.approvers.firstApprover.users',
      'approvalFlow.approvers.secondApprover', 'approvalFlow.approvers.secondApprover.users',
      'approvalFlow.approvers.thirdApprover', 'approvalFlow.approvers.thirdApprover.users',
      'approvalFlow.finalizers', 'approvalFlow.finalizers.firstFinalizers', 'approvalFlow.finalizers.secondFinalizers',
    ],
  });
  if (!document) return [];
  const flow = (document as unknown as {
    approvalFlow?: {
      creator?: { id: string } | null;
      verifiers?: Users;
      approvers?: Record<string, { users?: Users } | null> | null;
      finalizers?: { firstFinalizers?: Users; secondFinalizers?: Users } | null;
    } | null;
  }).approvalFlow;
  const people = new Set<string>();
  if (flow?.creator?.id) people.add(flow.creator.id);
  if (document.lastActionBy?.id && !flow?.creator?.id) people.add(document.lastActionBy.id);
  ids(flow?.verifiers).forEach((id) => people.add(id));
  for (const level of ['firstApprover', 'secondApprover', 'thirdApprover']) ids(flow?.approvers?.[level]?.users).forEach((id) => people.add(id));
  ids(flow?.finalizers?.firstFinalizers).forEach((id) => people.add(id));
  ids(flow?.finalizers?.secondFinalizers).forEach((id) => people.add(id));
  return Array.from(people);
}

export async function notifyDocumentPeople(
  manager: EntityManager,
  notifier: Notifier,
  type: string,
  recordId: string,
  message: string,
  exclude?: string | null,
): Promise<void> {
  try {
    const people = (await documentPeople(manager, type, recordId)).filter((id) => id !== exclude);
    if (people.length) await notifier.createBatchNoti(message, people);
  } catch (error) {
    // A notification must never break the action that caused it.
    logger.error('Flow notification failed', { type, recordId, error });
  }
}

const DISPATCH_DOC = DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER;

/** The live (not rejected / deleted) dispatch of a source. */
async function liveDispatchOf(manager: EntityManager, column: 'grn_id' | 'delivery_challan_id', sourceId: string) {
  const rows: Array<{ id: string; no: string | null; status: string | null }> = await manager.query(
    `SELECT d.id::text AS id, d."vehicleDispatchNo" AS no,
            (SELECT doc.status::text FROM documents doc WHERE doc.document_type_id = d.id::text AND doc.type::text = $2
              ORDER BY doc."createdAt" DESC LIMIT 1) AS status
       FROM dispatch d WHERE d.${column} = $1 AND d."deletedAt" IS NULL AND COALESCE(d."isDeleted", false) = false
      ORDER BY d."createdAt" DESC`,
    [sourceId, DISPATCH_DOC],
  );
  return rows.find((r) => r.status !== DocumentStatus.REJECT) ?? null;
}

async function recordNo(manager: EntityManager, sql: string, id: string): Promise<string> {
  const rows: Array<{ no: string | null }> = await manager.query(sql, [id]);
  return rows[0]?.no ?? '';
}

/**
 * Called after an approval action with the document's status before it.
 * Sends the messages for the transition that happened, if any.
 */
export async function notifyApprovalTransition(
  dataSource: DataSource,
  notifier: Notifier,
  documentId: string,
  before: string | null,
  actorId?: string | null,
): Promise<void> {
  try {
    const manager = dataSource.manager;
    const rows: Array<{ type: string; status: string | null; record_id: string | null }> = await manager.query(
      `SELECT type::text AS type, status::text AS status, document_type_id AS record_id FROM documents WHERE id = $1`,
      [documentId],
    );
    const doc = rows[0];
    if (!doc?.record_id || doc.status === before) return;
    const recordId = doc.record_id;

    // GRN: approval complete → goods may move.
    if (doc.type === DocumentTypeEnum.GRN && isGrnReceivableStatus(doc.status) && !isGrnReceivableStatus(before)) {
      const no = await recordNo(manager, `SELECT "grnNo" AS no FROM grns WHERE id = $1`, recordId);
      await notifyDocumentPeople(manager, notifier, DocumentTypeEnum.GRN, recordId,
        `GRN ${no} has completed its approval: its purchase dispatch can be approved and the goods received at the CC/DC`, actorId);
      const dispatch = await liveDispatchOf(manager, 'grn_id', recordId);
      if (dispatch && dispatch.status !== DocumentStatus.COMPLETE) {
        await notifyDocumentPeople(manager, notifier, DISPATCH_DOC, dispatch.id, `GRN ${no} has completed its approval: dispatch ${dispatch.no ?? ''} can now be approved`, actorId);
      }
      return;
    }

    if (doc.status !== DocumentStatus.COMPLETE) return;

    // Transfer / Customer DC approved → its dispatch can be approved.
    if (doc.type === DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER || doc.type === DocumentTypeEnum.DC_TYPE_CUSTOMER) {
      const no = await recordNo(manager, `SELECT "challanNo" AS no FROM delivery_challan_purchase WHERE id = $1`, recordId);
      const dispatch = await liveDispatchOf(manager, 'delivery_challan_id', recordId);
      if (dispatch && dispatch.status !== DocumentStatus.COMPLETE) {
        await notifyDocumentPeople(manager, notifier, DISPATCH_DOC, dispatch.id, `DC ${no} is approved: dispatch ${dispatch.no ?? ''} can now be approved`, actorId);
      }
      return;
    }

    // Dispatch approved → the receiving side / the delivery confirmation.
    if (doc.type === DISPATCH_DOC) {
      const d: Array<{ no: string | null; type: string; grn_id: string | null; dc_id: string | null; to_name: string | null }> = await manager.query(
        `SELECT d."vehicleDispatchNo" AS no, d."dispatchType"::text AS type, d.grn_id::text AS grn_id,
                d.delivery_challan_id::text AS dc_id, b.name AS to_name
           FROM dispatch d LEFT JOIN branches b ON b.id = d.to_location_id WHERE d.id = $1`,
        [recordId],
      );
      const row = d[0];
      if (!row) return;
      const to = row.to_name ? ` to ${row.to_name}` : '';
      if (row.type === 'purchase' && row.grn_id) {
        const no = await recordNo(manager, `SELECT "grnNo" AS no FROM grns WHERE id = $1`, row.grn_id);
        await notifyDocumentPeople(manager, notifier, DocumentTypeEnum.GRN, row.grn_id,
          `Dispatch ${row.no ?? ''} of GRN ${no} is approved and on the way${to}: receive it in Arrivals`, actorId);
      } else if (row.type === 'stock-transfer' && row.dc_id) {
        const no = await recordNo(manager, `SELECT "challanNo" AS no FROM delivery_challan_purchase WHERE id = $1`, row.dc_id);
        await notifyDocumentPeople(manager, notifier, DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER, row.dc_id,
          `Dispatch ${row.no ?? ''} of transfer DC ${no} is approved and on the way${to}: receive it in Arrivals`, actorId);
      } else if (row.dc_id) {
        const no = await recordNo(manager, `SELECT "challanNo" AS no FROM delivery_challan_purchase WHERE id = $1`, row.dc_id);
        await notifyDocumentPeople(manager, notifier, DocumentTypeEnum.DC_TYPE_CUSTOMER, row.dc_id,
          `Sales dispatch ${row.no ?? ''} of DC ${no} is approved: confirm the delivery once the goods reach the customer`, actorId);
      }
    }
  } catch (error) {
    logger.error('Approval transition notification failed', { documentId, error });
  }
}

/** Status of an approval document before an action (for {@link notifyApprovalTransition}). */
export async function documentStatusOf(dataSource: DataSource, documentId: string): Promise<string | null> {
  const rows: Array<{ status: string | null }> = await dataSource.query(`SELECT status::text AS status FROM documents WHERE id = $1`, [documentId]);
  return rows[0]?.status ?? null;
}

/**
 * Daily reminder (D-9): sources whose goods can be received (approved, dispatch
 * approved) but whose receiving has not started or is still open, dated before
 * today. One message per source to its creator and approval-flow users.
 */
export async function remindOpenReceiving(
  dataSource: DataSource,
  notifier: Notifier,
  listArrivals: (filter: {
    state: Array<'not-started' | 'open'>;
    readiness: 'ready';
    endDate: string;
    page: number;
    limit: number;
  }) => Promise<{ data: Array<{ sourceType: string; sourceId: string; sourceNo: string | null; locationName: string | null; state: string }> }>,
): Promise<number> {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const typeOf: Record<string, string> = {
    grn: DocumentTypeEnum.GRN,
    'stock-transfer-dc': DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER,
    rbc: DocumentTypeEnum.RETURN_BY_CUSTOMER,
  };
  let sent = 0;
  for (let page = 1; page <= 10; page += 1) {
    const { data } = await listArrivals({ state: ['not-started', 'open'], readiness: 'ready', endDate: yesterday, page, limit: 100 });
    for (const row of data) {
      const type = typeOf[row.sourceType];
      if (!type) continue;
      const what = row.state === 'open' ? 'is still open' : 'has not started';
      await notifyDocumentPeople(dataSource.manager, notifier, type, row.sourceId,
        `Reminder: receiving of ${row.sourceNo ?? 'a source'}${row.locationName ? ` at ${row.locationName}` : ''} ${what}`);
      sent += 1;
    }
    if (data.length < 100) break;
  }
  return sent;
}
