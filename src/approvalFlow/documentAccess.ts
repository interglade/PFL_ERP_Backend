import { NextFunction, Request, Response } from 'express';
import AppError from '../utils/appError';
import { AppDataSource } from '../utils/data-source';
import { Documentb, DocumentStatus, DocumentTypeEnum } from './entity/docuemnt.entity';
import { APPROVAL_ENGINE_TYPES } from './approvalGuards';
import { Role } from '../employee/entity/user.entity';
import { isPaymentManager, isSuperAdmin } from '../utils/roles';

/**
 * Record-level rules for documents with an approval flow (docs/access-gap-fixes.md, Phase 3):
 *
 *  Edit   — only the creator, and only until the approval is complete:
 *             single level (RFPA, Deal Slip, AQR, Inward, Vehicle Dispatch): until the first approval
 *             double level (DCs, Dump, RTV, RBC, Second Sale, ...): until the second approval
 *             GRN and vouchers: until Finalizer 2; their services restart the approval after an edit
 *           Rejected or deleted documents are never edited.
 *  Delete — Super Admin at any stage; anyone else only their own document before any approval
 *           (the Delete tick is checked separately by checkPermission).
 *  View   — admins, the creator, or a person in the document's approval flow (same as the lists);
 *           Payment Managers also see every completed GRN and Final Invoice.
 *
 * Routes name a document either by its approval document id (:docid) or by its record id
 * (:id, ?id=, body.ids); both are accepted.
 */

/** Statuses in which nobody has approved the document yet. */
const NOT_YET_APPROVED: ReadonlyArray<string> = [DocumentStatus.DRAFT, DocumentStatus.HOLD];

type Engine = keyof typeof APPROVAL_ENGINE_TYPES;
const engineOf = (type: DocumentTypeEnum): Engine | null =>
  (Object.keys(APPROVAL_ENGINE_TYPES) as Engine[]).find((e) => APPROVAL_ENGINE_TYPES[e].includes(type)) ?? null;

const PARTICIPANT_RELATIONS = [
  ['approvalFlow', 'flow'],
  ['flow.verifiers', 'verifier'],
  ['flow.approvers', 'levels'],
  ['levels.firstApprover', 'b1'], ['b1.users', 'u1'],
  ['levels.secondApprover', 'b2'], ['b2.users', 'u2'],
  ['levels.thirdApprover', 'b3'], ['b3.users', 'u3'],
  ['levels.fourthApprover', 'b4'], ['b4.users', 'u4'],
  ['levels.fifthApprover', 'b5'], ['b5.users', 'u5'],
  ['levels.sixthApprover', 'b6'], ['b6.users', 'u6'],
  ['flow.finalizers', 'fin'], ['fin.firstFinalizers', 'f1'], ['fin.secondFinalizers', 'f2'],
] as const;

/** Latest approval document of a record (or the document itself), deleted ones included. */
export async function findApprovalDocument(
  type: DocumentTypeEnum,
  idOrDocumentId: string,
  withParticipants = false,
): Promise<Documentb | null> {
  const qb = AppDataSource.getRepository(Documentb)
    .createQueryBuilder('document')
    .withDeleted()
    .leftJoinAndSelect('document.lastActionBy', 'creator')
    .where('document.type = :type', { type })
    .andWhere('(document.id::text = :id OR document.document_type_id = :id)', { id: idOrDocumentId })
    .orderBy('document.createdAt', 'DESC');
  if (withParticipants) {
    for (const [path, alias] of PARTICIPANT_RELATIONS) {
      qb.leftJoinAndSelect(path.includes('.') ? path : `document.${path}`, alias);
    }
  }
  return qb.getOne();
}

/** Everyone who can be routed this document by its approval flow. */
function participantIds(document: Documentb): Set<string> {
  const flow: any = document.approvalFlow;
  const ids = new Set<string>();
  const add = (users?: { id: string }[]) => (users ?? []).forEach((u) => u?.id && ids.add(u.id));
  add(flow?.verifiers);
  for (const block of ['firstApprover', 'secondApprover', 'thirdApprover', 'fourthApprover', 'fifthApprover', 'sixthApprover']) {
    add(flow?.approvers?.[block]?.users);
  }
  add(flow?.finalizers?.firstFinalizers);
  add(flow?.finalizers?.secondFinalizers);
  return ids;
}

const isDeleted = (document: Documentb) => !!document.isDeleted || !!document.deletedAt;

/** Why the creator can no longer edit a document in this status, or null when they can. */
export function editRefusal(type: DocumentTypeEnum, status: string | null | undefined, label: string): string | null {
  if (status === DocumentStatus.REJECT) return `This ${label} was rejected, so it can no longer be edited`;
  if (status === DocumentStatus.COMPLETE) return `This ${label} has completed its approval, so it can no longer be edited`;
  // Single level: the first approval completes it (APPROVED is treated the same way)
  if (engineOf(type) === 'single' && status === DocumentStatus.APPROVED) {
    return `This ${label} is approved, so it can no longer be edited`;
  }
  return null;
}

export async function assertCanEditDocument(type: DocumentTypeEnum, id: string, user: any, label: string): Promise<void> {
  const document = await findApprovalDocument(type, id);
  if (!document) return; // records without an approval document are governed by their own rules
  if (isDeleted(document)) throw new AppError(409, `This ${label} has been deleted; it can no longer be changed`);
  if (document.lastActionBy?.id !== user?.id) throw new AppError(403, `Only the creator of this ${label} can edit it`);
  const refusal = editRefusal(type, document.status, label);
  if (refusal) throw new AppError(409, refusal);
}

export async function assertCanDeleteDocument(type: DocumentTypeEnum, id: string, user: any, label: string): Promise<void> {
  if (isSuperAdmin(user)) return;
  const document = await findApprovalDocument(type, id);
  if (!document) return;
  if (document.lastActionBy?.id !== user?.id) throw new AppError(403, `Only the creator of this ${label} can delete it`);
  if (!NOT_YET_APPROVED.includes(document.status)) {
    throw new AppError(409, `This ${label} has already been acted on in its approval, so only a Super Admin can delete it`);
  }
}

/**
 * Documents whose payments are recorded by Payment Managers. Once their approval is complete they
 * reach every Payment Manager, whoever created them and whatever the approval flow (2026-10-30).
 */
export const PAYMENT_DOCUMENT_TYPES: ReadonlyArray<string> = [DocumentTypeEnum.GRN, DocumentTypeEnum.FINAL_INVOICE];

/** Whether this user sees completed documents of this type for recording payments. */
export const seesCompletedForPayment = (type: string, user: { roles?: string[] } | null | undefined): boolean =>
  PAYMENT_DOCUMENT_TYPES.includes(type) && isPaymentManager(user);

export async function assertCanViewDocument(type: DocumentTypeEnum, id: string, user: any, label: string): Promise<void> {
  const roles: string[] = Array.isArray(user?.roles) ? user.roles : [];
  if (roles.includes(Role.ADMIN)) return;
  const document = await findApprovalDocument(type, id, true);
  if (!document) return;
  if (document.lastActionBy?.id === user?.id) return;
  if (participantIds(document).has(user?.id)) return;
  if (document.status === DocumentStatus.COMPLETE && !isDeleted(document) && seesCompletedForPayment(type, user)) return;
  throw new AppError(403, `You do not have access to this ${label}`);
}

// ─── Route middleware ────────────────────────────────────────────────────────

const idsOf = (req: Request): string[] => {
  const one = req.params.id ?? req.params.docid ?? (typeof req.query.id === 'string' ? req.query.id : undefined);
  if (one) return [one];
  const many = req.body?.ids;
  return Array.isArray(many) ? many.filter((x: unknown): x is string => typeof x === 'string') : [];
};

const guard =
  (check: (type: DocumentTypeEnum, id: string, user: any, label: string) => Promise<void>) =>
  (type: DocumentTypeEnum, label: string) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      for (const id of idsOf(req)) await check(type, id, res.locals.user, label);
      next();
    } catch (err) {
      next(err);
    }
  };

/** Creator only, until the approval is complete. */
export const guardDocumentEdit = guard(assertCanEditDocument);
/** Super Admin always; others only their own document before any approval. */
export const guardDocumentDelete = guard(assertCanDeleteDocument);
/** Admins, the creator, or people in the document's approval flow. */
export const guardDocumentView = guard(assertCanViewDocument);

// ─── Approval restart after an edit (GRN and vouchers) ───────────────────────

/**
 * After a GRN, voucher or two-level document is edited before its approval completes, the approval
 * starts again: status back to Hold and an empty approval summary (everyone who acted has to act
 * again). Nothing happens while nobody has acted yet (Draft / Hold). `starter` is the
 * DocumentbService, whose startApprovalFlow re-assigns and notifies the first stage.
 */
export async function restartApprovalAfterEdit(
  starter: { startApprovalFlow(documentId: string): Promise<unknown> },
  type: DocumentTypeEnum,
  recordId: string,
  remarks: string,
): Promise<void> {
  const document = await findApprovalDocument(type, recordId);
  if (!document || isDeleted(document)) return;
  if (document.status === DocumentStatus.DRAFT || document.status === DocumentStatus.HOLD) return;
  await AppDataSource.getRepository(Documentb).update(
    { id: document.id },
    { status: DocumentStatus.HOLD, approvalInfo: null as any, remarks },
  );
  await starter.startApprovalFlow(document.id);
}

/** Same as restartApprovalAfterEdit, for callers without the DocumentbService injected (controllers). */
export async function restartApprovalAfterEditOf(type: DocumentTypeEnum, recordId: string, remarks: string): Promise<void> {
  // Loaded lazily: the container imports the services, which import this module.
  const { container } = await import('../inversify.config');
  const { TYPES } = await import('../types');
  const starter = container.get<{ startApprovalFlow(documentId: string): Promise<unknown> }>(TYPES.DocumentbService);
  await restartApprovalAfterEdit(starter, type, recordId, remarks);
}

// ─── Who may act now (Approve / Reject buttons) ──────────────────────────────

const usersOf = (block: any): string[] => (block?.users ?? block ?? []).map((u: any) => u?.id).filter(Boolean);
const inRange = (block: any, amount: number) =>
  amount >= Number(block?.minAmtCanApprove || 0) && amount <= Number(block?.maxAmtCanApprove || Infinity);

/**
 * Whether `userId` is the person the document waits for right now, with the same stage order as
 * the three approval engines. Drives the Approve / Reject buttons; the engines still decide.
 */
export async function canActOnDocument(documentId: string, userId: string): Promise<boolean> {
  const document: any = await AppDataSource.getRepository(Documentb)
    .createQueryBuilder('document')
    .leftJoinAndSelect('document.lastActionBy', 'creator')
    .leftJoinAndSelect('document.approvalInfo', 'info')
    .leftJoinAndSelect('info.verified', 'sv')
    .leftJoinAndSelect('info.firstApproved', 's1')
    .leftJoinAndSelect('info.secondApproved', 's2')
    .leftJoinAndSelect('info.thirdApproved', 's3')
    .leftJoinAndSelect('info.firstFinalized', 'sf1')
    .leftJoinAndSelect('info.secondFinalized', 'sf2')
    .leftJoinAndSelect('document.approvalFlow', 'flow')
    .leftJoinAndSelect('flow.verifiers', 'verifier')
    .leftJoinAndSelect('flow.approvers', 'levels')
    .leftJoinAndSelect('levels.firstApprover', 'b1').leftJoinAndSelect('b1.users', 'u1')
    .leftJoinAndSelect('levels.secondApprover', 'b2').leftJoinAndSelect('b2.users', 'u2')
    .leftJoinAndSelect('levels.thirdApprover', 'b3').leftJoinAndSelect('b3.users', 'u3')
    .leftJoinAndSelect('flow.finalizers', 'fin')
    .leftJoinAndSelect('fin.firstFinalizers', 'f1').leftJoinAndSelect('fin.secondFinalizers', 'f2')
    .where('document.id::text = :id', { id: documentId })
    .getOne();
  if (!document || !document.approvalFlow || isDeleted(document)) return false;

  const status = document.status;
  if ([DocumentStatus.DRAFT, DocumentStatus.COMPLETE, DocumentStatus.REJECT].includes(status)) return false;
  if (document.lastActionBy?.id === userId) return false;

  const info = document.approvalInfo ?? {};
  const stages = ['verified', 'firstApproved', 'secondApproved', 'thirdApproved', 'firstFinalized', 'secondFinalized'];
  if (stages.some((s) => info[s]?.userId === userId)) return false;

  const flow = document.approvalFlow;
  const blocks = flow.approvers ?? {};
  const engine = engineOf(document.type);

  if (engine === 'single') return usersOf(blocks.firstApprover).includes(userId);

  if (engine === 'double') {
    if (!info.firstApproved) return usersOf(blocks.firstApprover).includes(userId);
    if (!info.secondApproved) return usersOf(blocks.secondApprover).includes(userId);
    return false;
  }

  // GRN and vouchers: verifier → approver levels required by the amount → finalizer 1 → finalizer 2
  if (!info.verified) return usersOf(flow.verifiers).includes(userId);
  const amount = Number(document.totalAmt || 0);
  const all = [
    { block: blocks.firstApprover, done: info.firstApproved },
    { block: blocks.secondApprover, done: info.secondApproved },
    { block: blocks.thirdApprover, done: info.thirdApproved },
  ];
  // As in the engine: the level whose band covers the amount, and every level below it, must
  // approve, in order L1 → L2 → L3 - e.g. a ₹4 L GRN needs level 1, then level 2.
  const top = all.findIndex((l) => usersOf(l.block).length > 0 && inRange(l.block, amount));
  const levels = all.slice(0, top + 1).filter((l) => usersOf(l.block).length > 0);
  const next = levels.find((l) => !l.done);
  if (next) return usersOf(next.block).includes(userId);
  if (!info.firstFinalized) return usersOf(flow.finalizers?.firstFinalizers).includes(userId);
  if (!info.secondFinalized) return usersOf(flow.finalizers?.secondFinalizers).includes(userId);
  return false;
}
