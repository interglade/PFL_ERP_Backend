/**
 * Delivery confirmation of a Customer DC (Phase D-1 / D-3, client decisions
 * 2026-10-15):
 *   - returns are recorded at the customer's door, before confirmation, as an
 *     RBC that must be APPROVED before the delivery can be confirmed;
 *   - the app user confirms "Delivered – no return" or, when the DC has an
 *     approved RBC, "Delivered – with return";
 *   - after confirmation no RBC can be raised, edited or deleted, and the
 *     Final Invoice (which bills accepted quantity) is unlocked;
 *   - an undo is possible only while the DC has no live Final Invoice, by a
 *     level-1 / level-2 approver of the DC (or of a rejected / deleted invoice
 *     of it), never by the user who confirmed.
 */

import { EntityManager, IsNull } from 'typeorm';
import AppError from '../../../utils/appError';
import { Documentb, DocumentStatus, DocumentTypeEnum } from '../../../approvalFlow/entity/docuemnt.entity';
import { assertCustomerDcReady } from '../../../vehicleDispatch/service/dispatchRules';
import { DcDeliveryConfirmation, DeliveryOutcome } from '../entity/dcDeliveryConfirmation.entity';

const latestStatusSql = (alias: string, type: string) =>
  `(SELECT d.status::text FROM documents d WHERE d.document_type_id = ${alias}.id::text AND d.type::text = '${type}' ORDER BY d."createdAt" DESC LIMIT 1)`;
const liveSql = (alias: string) => `COALESCE(${alias}."isDeleted", false) = false AND ${alias}."deletedAt" IS NULL`;

interface DcRow {
  id: string;
  no: string | null;
  type: string | null;
  deleted: boolean;
  status: string | null;
}

async function loadDc(manager: EntityManager, dcId: string): Promise<DcRow> {
  const rows: DcRow[] = await manager.query(
    `SELECT dc.id::text AS id, dc."challanNo" AS no, dc.type::text AS type,
            (COALESCE(dc."isDeleted", false) OR dc."deletedAt" IS NOT NULL) AS deleted,
            ${latestStatusSql('dc', DocumentTypeEnum.DC_TYPE_CUSTOMER)} AS status
       FROM delivery_challan_purchase dc WHERE dc.id = $1`,
    [dcId],
  );
  if (!rows[0]) throw new AppError(404, 'Customer delivery challan not found');
  return rows[0];
}

/** The live (not deleted, not rejected) RBC of the DC, with its approval status. */
async function liveRbc(manager: EntityManager, dcId: string): Promise<{ id: string; no: string | null; status: string | null } | null> {
  const rows: Array<{ id: string; no: string | null; status: string | null }> = await manager.query(
    `SELECT rec.id::text AS id, rec."rbcNo" AS no, ${latestStatusSql('rec', DocumentTypeEnum.RETURN_BY_CUSTOMER)} AS status
       FROM return_by_customer rec
      WHERE rec.delivery_challan_id = $1 AND ${liveSql('rec')}
      ORDER BY rec."createdAt" DESC`,
    [dcId],
  );
  return rows.find((r) => r.status !== DocumentStatus.REJECT) ?? null;
}

/** The live (not deleted, not rejected) Final Invoice of the DC. */
async function liveInvoice(manager: EntityManager, dcId: string): Promise<{ id: string; no: string | null } | null> {
  const rows: Array<{ id: string; no: string | null; status: string | null }> = await manager.query(
    `SELECT rec.id::text AS id, rec."invoiceNo" AS no, ${latestStatusSql('rec', DocumentTypeEnum.FINAL_INVOICE)} AS status
       FROM invoices rec WHERE rec.delivery_challan_id = $1 AND ${liveSql('rec')}`,
    [dcId],
  );
  return rows.find((r) => r.status !== DocumentStatus.REJECT) ?? null;
}

export async function activeConfirmation(manager: EntityManager, dcId: string): Promise<DcDeliveryConfirmation | null> {
  return manager.getRepository(DcDeliveryConfirmation).findOne({
    where: { dcId, undoneAt: IsNull() },
    order: { confirmedAt: 'DESC' },
  });
}

/** Level-1 / level-2 approver user ids of the newest approval document of a record. */
async function approverIds(manager: EntityManager, type: DocumentTypeEnum, recordId: string): Promise<Set<string>> {
  const document = await manager.getRepository(Documentb).findOne({
    where: { document_type_id: recordId, type },
    order: { createdAt: 'DESC' },
    withDeleted: true,
    relations: [
      'approvalFlow', 'approvalFlow.approvers',
      'approvalFlow.approvers.firstApprover', 'approvalFlow.approvers.firstApprover.users',
      'approvalFlow.approvers.secondApprover', 'approvalFlow.approvers.secondApprover.users',
    ],
  });
  const approvers = (document as unknown as { approvalFlow?: { approvers?: { firstApprover?: { users?: Array<{ id: string }> }; secondApprover?: { users?: Array<{ id: string }> } } } })
    ?.approvalFlow?.approvers;
  return new Set([...(approvers?.firstApprover?.users ?? []), ...(approvers?.secondApprover?.users ?? [])].map((u) => u.id));
}

export interface DeliveryStatus {
  dcId: string;
  dcNo: string | null;
  confirmation: DcDeliveryConfirmation | null;
  /** Name of the user who confirmed. */
  confirmedByName: string | null;
  /** The RBC's approval document id (for the RBC view link). */
  rbcDocumentId: string | null;
  /** PENDING until confirmed. */
  state: 'PENDING' | DeliveryOutcome;
  rbc: { id: string; no: string | null; status: string | null } | null;
  invoice: { id: string; no: string | null } | null;
  canConfirm: boolean;
  /** Why it cannot be confirmed yet. */
  blockers: string[];
  /** Outcome a confirmation would record now. */
  nextOutcome: DeliveryOutcome | null;
  canUndo: boolean;
  undoBlockedReason: string | null;
}

async function dispatchBlocker(manager: EntityManager, dcId: string): Promise<string | null> {
  try {
    await assertCustomerDcReady(manager, dcId);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.replace(/^Cannot continue yet: /, '') : 'The DC is not ready for delivery yet';
  }
}

/** Delivery state of a Customer DC for the screens, from the point of view of `userId`. */
export async function deliveryStatus(manager: EntityManager, dcId: string, userId?: string | null): Promise<DeliveryStatus> {
  const dc = await loadDc(manager, dcId);
  const [confirmation, rbc, invoice] = await Promise.all([activeConfirmation(manager, dcId), liveRbc(manager, dcId), liveInvoice(manager, dcId)]);

  const blockers: string[] = [];
  if (dc.deleted) blockers.push('The DC was deleted');
  if (confirmation) blockers.push('Delivery is already confirmed');
  if (!confirmation && !dc.deleted) {
    const notReady = await dispatchBlocker(manager, dcId);
    if (notReady) blockers.push(notReady);
    if (rbc && rbc.status !== DocumentStatus.COMPLETE) blockers.push(`Return By Customer ${rbc.no ?? ''} is awaiting approval`.replace('  ', ' '));
  }

  let undoBlockedReason: string | null = null;
  if (!confirmation) undoBlockedReason = 'Delivery is not confirmed';
  else if (invoice) undoBlockedReason = `Final Invoice ${invoice.no ?? ''} exists for this DC`.replace('  ', ' ');
  else if (userId) undoBlockedReason = await undoPermission(manager, dcId, confirmation, userId);

  const names: Array<{ name: string | null }> = confirmation
    ? await manager.query(`SELECT TRIM(CONCAT(u."firstName", ' ', u."lastName")) AS name FROM employees u WHERE u.id = $1`, [confirmation.confirmedBy])
    : [];
  const rbcDocs: Array<{ id: string }> = rbc
    ? await manager.query(
        `SELECT d.id::text AS id FROM documents d WHERE d.document_type_id = $1 AND d.type::text = $2 ORDER BY d."createdAt" DESC LIMIT 1`,
        [rbc.id, DocumentTypeEnum.RETURN_BY_CUSTOMER],
      )
    : [];

  return {
    dcId,
    dcNo: dc.no,
    confirmation,
    confirmedByName: names[0]?.name || null,
    rbcDocumentId: rbcDocs[0]?.id ?? null,
    state: confirmation ? confirmation.outcome : 'PENDING',
    rbc,
    invoice,
    canConfirm: blockers.length === 0,
    blockers,
    nextOutcome: confirmation ? null : rbc ? 'DELIVERED_WITH_RETURN' : 'DELIVERED_NO_RETURN',
    canUndo: !undoBlockedReason,
    undoBlockedReason,
  };
}

/** Why `userId` may not undo this confirmation, or null when allowed. */
async function undoPermission(manager: EntityManager, dcId: string, confirmation: DcDeliveryConfirmation, userId: string): Promise<string | null> {
  if (confirmation.confirmedBy === userId) return 'The user who confirmed the delivery cannot undo it';
  const allowed = await approverIds(manager, DocumentTypeEnum.DC_TYPE_CUSTOMER, dcId);
  // Approvers of a rejected / deleted Final Invoice of this DC may undo too.
  const invoices: Array<{ id: string }> = await manager.query(`SELECT id::text AS id FROM invoices WHERE delivery_challan_id = $1`, [dcId]);
  for (const inv of invoices) (await approverIds(manager, DocumentTypeEnum.FINAL_INVOICE, inv.id)).forEach((id) => allowed.add(id));
  return allowed.has(userId) ? null : 'Only an approver of this DC or of its Final Invoice can undo the delivery confirmation';
}

export async function confirmDelivery(
  manager: EntityManager,
  dcId: string,
  userId: string,
  input: { receiverName?: string | null; remark?: string | null; proofUrl?: string | null },
): Promise<DcDeliveryConfirmation> {
  await manager.query(`SELECT id FROM delivery_challan_purchase WHERE id = $1 FOR UPDATE`, [dcId]);
  const status = await deliveryStatus(manager, dcId);
  if (!status.canConfirm) throw new AppError(409, `Delivery cannot be confirmed: ${status.blockers.join('; ')}`);
  const repo = manager.getRepository(DcDeliveryConfirmation);
  return repo.save(repo.create({
    dcId,
    outcome: status.nextOutcome ?? 'DELIVERED_NO_RETURN',
    rbcId: status.rbc?.id ?? null,
    rbcNo: status.rbc?.no ?? null,
    receiverName: input.receiverName?.trim() || null,
    remark: input.remark?.trim() || null,
    proofUrl: input.proofUrl?.trim() || null,
    confirmedBy: userId,
  }));
}

export async function undoDeliveryConfirmation(manager: EntityManager, dcId: string, userId: string, reason?: string | null): Promise<DcDeliveryConfirmation> {
  await manager.query(`SELECT id FROM delivery_challan_purchase WHERE id = $1 FOR UPDATE`, [dcId]);
  const status = await deliveryStatus(manager, dcId, userId);
  if (!status.confirmation) throw new AppError(409, 'Delivery is not confirmed');
  if (status.undoBlockedReason) throw new AppError(status.undoBlockedReason.startsWith('Only') || status.undoBlockedReason.startsWith('The user') ? 403 : 409, status.undoBlockedReason);
  if (!reason || !reason.trim()) throw new AppError(400, 'Give the reason for undoing the delivery confirmation');
  const confirmation = status.confirmation;
  Object.assign(confirmation, { undoneBy: userId, undoneAt: new Date(), undoReason: reason.trim() });
  return manager.getRepository(DcDeliveryConfirmation).save(confirmation);
}

/** Invoice gate: the DC's delivery must be confirmed. */
export async function assertDeliveryConfirmed(manager: EntityManager, dcId: string): Promise<void> {
  if (!(await activeConfirmation(manager, dcId))) {
    const dc = await loadDc(manager, dcId);
    throw new AppError(400, `Confirm the delivery of DC ${dc.no ?? ''} before creating the Final Invoice`.replace('  ', ' '));
  }
}

/** RBC gate: no return can be recorded / changed after the delivery is confirmed. */
export async function assertDeliveryNotConfirmed(manager: EntityManager, dcId: string | null | undefined, action: string): Promise<void> {
  if (!dcId) return;
  const confirmation = await activeConfirmation(manager, dcId);
  if (confirmation) {
    const dc = await loadDc(manager, dcId);
    throw new AppError(409, `Delivery of DC ${dc.no ?? ''} is already confirmed, so a Return By Customer cannot be ${action}`.replace('  ', ' '));
  }
}

/** Delivery state per DC for list columns. */
export async function deliveryStates(manager: EntityManager, dcIds: string[]): Promise<Record<string, { state: 'PENDING' | DeliveryOutcome; confirmedAt: Date | null; rbcNo: string | null }>> {
  const result: Record<string, { state: 'PENDING' | DeliveryOutcome; confirmedAt: Date | null; rbcNo: string | null }> = {};
  for (const id of dcIds) result[id] = { state: 'PENDING', confirmedAt: null, rbcNo: null };
  if (!dcIds.length) return result;
  const rows: Array<{ dc_id: string; outcome: DeliveryOutcome; confirmed_at: Date; rbc_no: string | null }> = await manager.query(
    `SELECT dc_id::text AS dc_id, outcome, confirmed_at, rbc_no FROM dc_delivery_confirmation
      WHERE dc_id = ANY($1::uuid[]) AND undone_at IS NULL`,
    [dcIds],
  );
  for (const r of rows) result[r.dc_id] = { state: r.outcome, confirmedAt: r.confirmed_at, rbcNo: r.rbc_no };
  return result;
}
