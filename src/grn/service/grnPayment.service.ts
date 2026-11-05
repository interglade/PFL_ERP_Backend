import { isPaymentManager } from '../../utils/roles';
import { refreshTransactionOf } from '../../transactions/transaction.core';
import { inject, injectable } from 'inversify';
import { DataSource, EntityManager } from 'typeorm';
import { formatInTimeZone } from 'date-fns-tz';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import logger from '../../utils/logger';
import { CacheService } from '../../global/cache.service';
import { NotificationService } from '../../notification/service/notification.service';
import { DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { Role } from '../../employee/entity/user.entity';
import { GrnPaymentStatus } from '../../utils/status.enum';
import { GrnDeliveryMode } from '../entity/grn.entity';
import { GrnPayment } from '../entity/grnPayment.entity';
import { GrnPaymentChange } from '../entity/grnPaymentChange.entity';
import {
  balanceExcluding,
  diffGrnPayment,
  GrnPaymentInput,
  GrnPaymentSummary,
  summarizeGrnPayments,
  validateGrnPayment,
} from '../grnPayment';

const IST = 'Asia/Kolkata';

export interface GrnPaymentActor {
  id: string;
  roles?: string[] | null;
  firstName?: string | null;
  lastName?: string | null;
}

interface GrnPaymentHead {
  id: string;
  grnNo: string | null;
  totalAmt: string | null;
  ammountStatus: string | null;
  createdAt: Date;
  createdById: string | null;
  vendorId: string | null;
  farmerId: string | null;
  advancePaidAmt: string | null;
  advanceDate: string | null;
  advanceMode: string | null;
  deliveryMode: string | null;
}

/** The Customer DC of a direct-to-customer GRN (sale from GRN), with its delivery state. */
export interface DirectSaleDcState {
  dcId: string;
  dcNo: string | null;
  documentId: string | null;
  status: string | null;
  deliveryConfirmed: boolean;
  deliveryOutcome: string | null;
  confirmedAt: Date | null;
}

const userName = (u: { firstName?: string | null; lastName?: string | null } | null | undefined): string | null =>
  u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || null : null;

const dateText = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return formatInTimeZone(v, 'UTC', 'yyyy-MM-dd');
  return String(v).slice(0, 10);
};

/**
 * GRN payment history (docs/grn-payment-history-plan.md): record, edit and void the payments made
 * to a GRN's vendor or farmer, and keep the GRN's paid amount and payment status in step with them.
 */
@injectable()
export class GrnPaymentService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
    @inject(TYPES.NotificationService) private readonly notificationService: NotificationService,
  ) {}

  /** Only Payment Managers record, edit and void payments (client decision 2026-10-29; finalizers no longer). */
  static canManage(user: GrnPaymentActor | null | undefined): boolean {
    return isPaymentManager({ roles: user?.roles ?? undefined });
  }

  private assertCanManage(user: GrnPaymentActor): void {
    if (!GrnPaymentService.canManage(user)) {
      throw new AppError(403, 'Only a Payment Manager can record, edit or void GRN payments');
    }
  }

  // ── Reads ────────────────────────────────────────────────────────────────────

  private async loadHead(m: EntityManager, grnId: string, lock = false): Promise<GrnPaymentHead> {
    if (lock) {
      // P6: one payment change per GRN at a time, so two people can't overpay together.
      await m.query(`SELECT id FROM grns WHERE id = $1 FOR UPDATE`, [grnId]);
    }
    const rows: GrnPaymentHead[] = await m.query(
      `SELECT g.id, g."grnNo", g."totalAmt", g."ammountStatus"::text AS "ammountStatus", g."createdAt",
              g.createdby_id AS "createdById", g.vendor_id AS "vendorId", g.farmer_id AS "farmerId",
              pi.advance_paid_amount AS "advancePaidAmt", pi.payment_date AS "advanceDate", pi.payment_mode AS "advanceMode",
              g."deliveryMode"::text AS "deliveryMode"
         FROM grns g
         LEFT JOIN payment_info_for_grn pi ON pi.id = g.payment_info_id
        WHERE g.id = $1 AND g."isDeleted" = false AND g."deletedAt" IS NULL`,
      [grnId],
    );
    if (!rows[0]) throw new AppError(404, `GRN with ID ${grnId} not found`);
    return rows[0];
  }

  private label(head: GrnPaymentHead): string {
    return `GRN ${head.grnNo ?? ''}`.trim();
  }

  /**
   * The live (not deleted, not rejected) Customer DC raised from a direct-to-customer GRN, and its
   * delivery confirmation (docs/customer-dc-sale-types-plan.md P1). Null when there is none.
   */
  async directSaleDc(m: EntityManager, grnId: string): Promise<DirectSaleDcState | null> {
    const rows: Array<Record<string, any>> = await m.query(
      `SELECT dc.id::text AS dc_id, dc."challanNo" AS dc_no, doc.id::text AS document_id, doc.status::text AS status,
              conf.outcome, conf.confirmed_at
         FROM delivery_challan_purchase dc
         LEFT JOIN LATERAL (SELECT d.id, d.status FROM documents d
                             WHERE d.document_type_id = dc.id::text AND d.type::text = $2 AND d."deletedAt" IS NULL
                             ORDER BY d."createdAt" DESC LIMIT 1) doc ON true
         LEFT JOIN LATERAL (SELECT c.outcome, c.confirmed_at FROM dc_delivery_confirmation c
                             WHERE c.dc_id = dc.id AND c.undone_at IS NULL
                             ORDER BY c.confirmed_at DESC LIMIT 1) conf ON true
        WHERE dc.grn_id = $1 AND dc.type::text = 'customer_delivery_challan'
          AND COALESCE(dc."isDeleted", false) = false AND dc."deletedAt" IS NULL
          AND COALESCE(doc.status::text, '') <> $3
        ORDER BY dc."createdAt" DESC LIMIT 1`,
      [grnId, DocumentTypeEnum.DC_TYPE_CUSTOMER, DocumentStatus.REJECT],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      dcId: r.dc_id,
      dcNo: r.dc_no ?? null,
      documentId: r.document_id ?? null,
      status: r.status ?? null,
      deliveryConfirmed: !!r.outcome,
      deliveryOutcome: r.outcome ?? null,
      confirmedAt: r.confirmed_at ?? null,
    };
  }

  /**
   * P1: payments are recorded once the GRN is payable: its approval is complete and its goods
   * are received. A CC / DC GRN needs an approved Inward Register; a direct-to-customer GRN needs
   * the delivery of its Customer DC confirmed, with or without a return (the confirmation itself
   * needs the DC and the purchase dispatch approved). Null when payable, else the reason.
   */
  async payableBlockedReason(m: EntityManager, head: GrnPaymentHead): Promise<string | null> {
    const label = this.label(head);
    const status: Array<{ status: string | null }> = await m.query(
      `SELECT d.status::text AS status FROM documents d
        WHERE d.document_type_id = $1 AND d.type::text = $2 AND d."isDeleted" = false
        ORDER BY d."createdAt" DESC LIMIT 1`,
      [head.id, DocumentTypeEnum.GRN],
    );
    if (status[0]?.status !== DocumentStatus.COMPLETE) {
      return `${label} has not completed its approval yet, so payments cannot be recorded`;
    }
    if (head.deliveryMode === GrnDeliveryMode.DIRECT_TO_CUSTOMER) {
      const dc = await this.directSaleDc(m, head.id);
      if (!dc) return `No Customer DC has been raised from ${label} yet, so payments cannot be recorded`;
      if (!dc.deliveryConfirmed) {
        return `The delivery of Customer DC ${dc.dcNo ?? ''} is not confirmed yet, so payments cannot be recorded`.replace(/\s+/g, ' ');
      }
      return null;
    }
    const received: Array<{ n: string }> = await m.query(
      `SELECT COUNT(*) AS n FROM inward_register ir
        WHERE ir.grn_id = $1 AND COALESCE(ir."isDeleted", false) = false AND ir."deletedAt" IS NULL
          AND (SELECT d.status::text FROM documents d WHERE d.document_type_id = ir.id::text AND d.type::text = $2
                ORDER BY d."createdAt" DESC LIMIT 1) = $3`,
      [head.id, DocumentTypeEnum.INWARD_REGISTER, DocumentStatus.COMPLETE],
    );
    if (Number(received[0]?.n ?? 0) === 0) {
      return `The goods of ${label} are not received yet (no approved Inward Register), so payments cannot be recorded`;
    }
    return null;
  }

  private livePayments(m: EntityManager, grnId: string): Promise<GrnPayment[]> {
    return m.getRepository(GrnPayment).createQueryBuilder('p')
      .where('p.grn_id = :grnId', { grnId })
      .andWhere('p.voidedAt IS NULL')
      .andWhere('p.isDeleted = false')
      .getMany();
  }

  private summarize(head: GrnPaymentHead, payments: GrnPayment[]): GrnPaymentSummary {
    return summarizeGrnPayments({
      totalAmt: head.totalAmt,
      advancePaidAmt: head.advancePaidAmt,
      storedStatus: head.ammountStatus,
      payments: payments.map((p) => ({ id: p.id, paymentNo: p.paymentNo, paymentDate: dateText(p.paymentDate)!, amount: p.amount })),
    });
  }

  /** The Payments section of the GRN view: summary, advance, every payment (voided too) and its trail. */
  async getPayments(grnId: string, user: GrnPaymentActor) {
    const m = this.dataSource.manager;
    const head = await this.loadHead(m, grnId);
    const payments = await m.getRepository(GrnPayment).find({
      where: { grn: { id: grnId }, isDeleted: false },
      relations: ['recordedBy', 'voidedBy'],
      order: { paymentNo: 'ASC' },
    });
    const live = payments.filter((p) => !p.voidedAt);
    const summary = this.summarize(head, live);
    const changes = payments.length
      ? await m.getRepository(GrnPaymentChange).createQueryBuilder('c')
          .leftJoinAndSelect('c.changedBy', 'changedBy')
          .leftJoin('c.payment', 'payment')
          .addSelect('payment.id')
          .where('c.grn_payment_id IN (:...ids)', { ids: payments.map((p) => p.id) })
          .orderBy('c.createdAt', 'ASC')
          .getMany()
      : [];
    const blockedReason = await this.payableBlockedReason(m, head);
    const canManage = GrnPaymentService.canManage(user);

    return {
      grnId: head.id,
      grnNo: head.grnNo,
      summary: {
        totalAmt: summary.totalAmt,
        advancePaidAmt: summary.advancePaidAmt,
        paidAmt: summary.paidAmt,
        balanceAmt: summary.balanceAmt,
        status: summary.status,
        paymentCount: live.length,
      },
      advance: summary.advancePaidAmt > 0
        ? { amount: summary.advancePaidAmt, paymentDate: dateText(head.advanceDate), paymentMode: head.advanceMode ?? null }
        : null,
      payments: payments.map((p) => ({
        id: p.id,
        paymentNo: p.paymentNo,
        paymentDate: dateText(p.paymentDate),
        amount: Number(p.amount),
        // A voided payment counts for nothing, so it is neither partial nor full.
        paymentType: p.voidedAt ? null : p.paymentType,
        paymentMode: p.paymentMode,
        paidToAccountNo: p.paidToAccountNo,
        paidToIfsc: p.paidToIfsc,
        paidToBankName: p.paidToBankName,
        referenceNo: p.referenceNo,
        remarks: p.remarks,
        balanceAfter: p.voidedAt ? null : Number(p.balanceAfter),
        recordedBy: userName(p.recordedBy),
        recordedAt: p.createdAt,
        isVoided: !!p.voidedAt,
        voidedAt: p.voidedAt,
        voidedBy: userName(p.voidedBy),
        voidReason: p.voidReason,
        history: changes
          .filter((c) => c.payment?.id === p.id)
          .map((c) => ({ action: c.action, changes: c.changes, reason: c.reason, changedBy: userName(c.changedBy), changedAt: c.createdAt })),
      })),
      canManage,
      // Why "Record payment" is unavailable, or null.
      recordBlockedReason: !canManage
        ? 'Only a Payment Manager can record payments'
        : blockedReason ?? (summary.balanceAmt <= 0 ? `${this.label(head)} has no balance left to pay` : null),
      // The advance alone covers the total: a finalizer confirms the GRN as paid instead.
      canConfirmPaidByAdvance: canManage && !blockedReason && summary.advanceCoversTotal && summary.status !== GrnPaymentStatus.PAID,
      lastPaidTo: await this.lastPaidTo(m, head),
      // Sale from GRN: the Customer DC whose delivery confirmation makes the GRN payable.
      directSaleDc: head.deliveryMode === GrnDeliveryMode.DIRECT_TO_CUSTOMER ? await this.directSaleDc(m, head.id) : null,
    };
  }

  /** The account this vendor or farmer was last paid to, to pre-fill the next payment. */
  private async lastPaidTo(m: EntityManager, head: GrnPaymentHead) {
    const column = head.vendorId ? 'vendor_id' : head.farmerId ? 'farmer_id' : null;
    if (!column) return null;
    const rows = await m.query(
      `SELECT p.paid_to_account_no AS "accountNo", p.paid_to_ifsc AS ifsc, p.paid_to_bank_name AS "bankName"
         FROM grn_payments p JOIN grns g ON g.id = p.grn_id
        WHERE g.${column} = $1 AND p.voided_at IS NULL AND p."isDeleted" = false AND p.paid_to_account_no IS NOT NULL
        ORDER BY p."createdAt" DESC LIMIT 1`,
      [head.vendorId ?? head.farmerId],
    );
    return rows[0] ?? null;
  }

  // ── Writes ───────────────────────────────────────────────────────────────────

  private dateContext(head: GrnPaymentHead) {
    return {
      today: formatInTimeZone(new Date(), IST, 'yyyy-MM-dd'),
      grnDate: formatInTimeZone(new Date(head.createdAt), IST, 'yyyy-MM-dd'),
      grnLabel: this.label(head),
    };
  }

  /**
   * Re-derives every live payment's type and balance-after, and the GRN's paid amount and status.
   * Returns the status before and after.
   */
  private async recompute(m: EntityManager, head: GrnPaymentHead): Promise<{ before: string | null; summary: GrnPaymentSummary }> {
    const live = await this.livePayments(m, head.id);
    const summary = this.summarize(head, live);
    for (const row of summary.rows) {
      await m.update(GrnPayment, { id: row.id }, { paymentType: row.paymentType, balanceAfter: row.balanceAfter });
    }
    await m.query(`UPDATE grns SET paid_amount = $2, "ammountStatus" = $3 WHERE id = $1`, [head.id, summary.paidAmt, summary.status]);
    // The purchase closes when the GRN is fully paid (docs/transaction-tracking-plan.md §9.3). Never throws.
    await refreshTransactionOf(m, 'grn', head.id);
    return { before: head.ammountStatus, summary };
  }

  private async afterChange(head: GrnPaymentHead, before: string | null, summary: GrnPaymentSummary): Promise<void> {
    await this.invalidateCache(head.id);
    // Q8: the creator is told only when the GRN becomes fully paid.
    if (before !== GrnPaymentStatus.PAID && summary.status === GrnPaymentStatus.PAID && head.createdById) {
      try {
        await this.notificationService.createNoti(
          `${this.label(head)} is fully paid (₹${summary.totalAmt.toFixed(2)})`,
          head.createdById,
        );
      } catch (error) {
        logger.error(`Fully-paid notification for GRN ${head.id} failed`, error);
      }
    }
  }

  async recordPayment(grnId: string, input: GrnPaymentInput, user: GrnPaymentActor) {
    this.assertCanManage(user);
    const result = await this.dataSource.transaction(async (m) => {
      const head = await this.loadHead(m, grnId, true);
      const blocked = await this.payableBlockedReason(m, head);
      if (blocked) throw new AppError(409, blocked);

      const live = await this.livePayments(m, grnId);
      const balanceAmt = balanceExcluding({ totalAmt: head.totalAmt, advancePaidAmt: head.advancePaidAmt, payments: live, exceptId: null });
      const checked = validateGrnPayment(input, { balanceAmt, ...this.dateContext(head) });
      if (!checked.ok) throw new AppError(400, checked.message);

      const [{ next }] = await m.query(`SELECT COALESCE(MAX(payment_no), 0) + 1 AS next FROM grn_payments WHERE grn_id = $1`, [grnId]);
      const payment = await m.save(m.create(GrnPayment, {
        ...checked.value,
        grn: { id: grnId } as any,
        paymentNo: Number(next),
        recordedBy: { id: user.id } as any,
      }));
      await m.save(m.create(GrnPaymentChange, {
        payment: { id: payment.id } as any,
        action: 'recorded',
        changes: Object.fromEntries(Object.entries(checked.value).map(([k, v]) => [k, { oldValue: null, newValue: v }])),
        changedBy: { id: user.id } as any,
      }));
      const { before, summary } = await this.recompute(m, head);
      return { head, before, summary, paymentId: payment.id, paymentNo: payment.paymentNo };
    });
    await this.afterChange(result.head, result.before, result.summary);
    return this.writeResult(result);
  }

  async editPayment(grnId: string, paymentId: string, input: GrnPaymentInput & { reason?: unknown }, user: GrnPaymentActor) {
    this.assertCanManage(user);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!reason) throw new AppError(400, 'A reason is required to edit a payment');

    const result = await this.dataSource.transaction(async (m) => {
      const head = await this.loadHead(m, grnId, true);
      const payment = await this.loadPayment(m, grnId, paymentId);
      if (payment.voidedAt) throw new AppError(409, `Payment ${payment.paymentNo} of ${this.label(head)} is voided, so it can't be edited`);

      const live = await this.livePayments(m, grnId);
      const balanceAmt = balanceExcluding({ totalAmt: head.totalAmt, advancePaidAmt: head.advancePaidAmt, payments: live, exceptId: paymentId });
      // Fields left out of the request keep their current value.
      const merged: GrnPaymentInput = {
        paymentDate: dateText(payment.paymentDate),
        amount: payment.amount,
        paymentMode: payment.paymentMode,
        paidToAccountNo: payment.paidToAccountNo,
        paidToIfsc: payment.paidToIfsc,
        paidToBankName: payment.paidToBankName,
        referenceNo: payment.referenceNo,
        remarks: payment.remarks,
        ...Object.fromEntries(Object.entries(input).filter(([k, v]) => k !== 'reason' && v !== undefined)),
      };
      const checked = validateGrnPayment(merged, { balanceAmt, ...this.dateContext(head) });
      if (!checked.ok) throw new AppError(400, checked.message);

      const changes = diffGrnPayment({ ...payment, paymentDate: dateText(payment.paymentDate) } as any, checked.value);
      if (!Object.keys(changes).length) throw new AppError(400, 'Nothing was changed');

      await m.update(GrnPayment, { id: paymentId }, checked.value);
      await m.save(m.create(GrnPaymentChange, {
        payment: { id: paymentId } as any,
        action: 'edited',
        changes,
        reason,
        changedBy: { id: user.id } as any,
      }));
      const { before, summary } = await this.recompute(m, head);
      return { head, before, summary, paymentId, paymentNo: payment.paymentNo, changes };
    });
    await this.afterChange(result.head, result.before, result.summary);
    return { ...this.writeResult(result), changes: result.changes };
  }

  async voidPayment(grnId: string, paymentId: string, reasonInput: unknown, user: GrnPaymentActor) {
    this.assertCanManage(user);
    const reason = typeof reasonInput === 'string' ? reasonInput.trim() : '';
    if (!reason) throw new AppError(400, 'A reason is required to void a payment');

    const result = await this.dataSource.transaction(async (m) => {
      const head = await this.loadHead(m, grnId, true);
      const payment = await this.loadPayment(m, grnId, paymentId);
      if (payment.voidedAt) throw new AppError(409, `Payment ${payment.paymentNo} of ${this.label(head)} is already voided`);

      await m.update(GrnPayment, { id: paymentId }, {
        voidedAt: new Date(),
        voidedBy: { id: user.id } as any,
        voidReason: reason,
      });
      await m.save(m.create(GrnPaymentChange, {
        payment: { id: paymentId } as any,
        action: 'voided',
        changes: null,
        reason,
        changedBy: { id: user.id } as any,
      }));
      const { before, summary } = await this.recompute(m, head);
      return { head, before, summary, paymentId, paymentNo: payment.paymentNo };
    });
    await this.afterChange(result.head, result.before, result.summary);
    return this.writeResult(result);
  }

  /**
   * The advance paid at GRN time already covers the whole total, so there is no payment to
   * record: a finalizer confirms the GRN as paid. (Replaces the old free "Mark As Paid".)
   */
  async confirmPaidByAdvance(grnId: string, user: GrnPaymentActor) {
    this.assertCanManage(user);
    const result = await this.dataSource.transaction(async (m) => {
      const head = await this.loadHead(m, grnId, true);
      const blocked = await this.payableBlockedReason(m, head);
      if (blocked) throw new AppError(409, blocked);
      const live = await this.livePayments(m, grnId);
      const summary = this.summarize(head, live);
      if (!summary.advanceCoversTotal) {
        throw new AppError(
          409,
          `${this.label(head)} still has a balance of ${summary.balanceAmt.toFixed(2)}; record payments to mark it paid`,
        );
      }
      await m.query(`UPDATE grns SET "ammountStatus" = $2 WHERE id = $1`, [grnId, GrnPaymentStatus.PAID]);
      await refreshTransactionOf(m, 'grn', grnId);
      return { head, before: head.ammountStatus, summary: { ...summary, status: GrnPaymentStatus.PAID } };
    });
    await this.afterChange(result.head, result.before, result.summary);
    return { grnId, ammountStatus: GrnPaymentStatus.PAID };
  }

  private async loadPayment(m: EntityManager, grnId: string, paymentId: string): Promise<GrnPayment> {
    const payment = await m.getRepository(GrnPayment).findOne({ where: { id: paymentId, grn: { id: grnId }, isDeleted: false } });
    if (!payment) throw new AppError(404, `Payment ${paymentId} of this GRN not found`);
    return payment;
  }

  private writeResult(r: { head: GrnPaymentHead; summary: GrnPaymentSummary; paymentId: string; paymentNo: number }) {
    const row = r.summary.rows.find((x) => x.id === r.paymentId);
    return {
      grnId: r.head.id,
      grnNo: r.head.grnNo,
      paymentId: r.paymentId,
      paymentNo: r.paymentNo,
      paymentType: row?.paymentType ?? null,
      paidAmt: r.summary.paidAmt,
      balanceAmt: r.summary.balanceAmt,
      ammountStatus: r.summary.status,
    };
  }

  private async invalidateCache(grnId: string): Promise<void> {
    try {
      await Promise.all([
        this.cacheService.invalidatePattern('grn:all:*'),
        this.cacheService.invalidatePattern('grn:view:*'),
        this.cacheService.invalidatePattern('grn:update:*'),
        this.cacheService.del(`grn:id:${grnId}`),
        this.cacheService.del(`grn:details:${grnId}`),
      ]);
    } catch (error) {
      logger.error(`Clearing the GRN caches after a payment change failed`, error);
    }
  }
}

/** Live (not voided) payments of a GRN exist: it can no longer be edited or deleted (G1, G2). */
export async function grnHasLivePayments(m: EntityManager, grnId: string): Promise<boolean> {
  const rows = await m.query(
    `SELECT 1 FROM grn_payments WHERE grn_id = $1 AND voided_at IS NULL AND "isDeleted" = false LIMIT 1`,
    [grnId],
  );
  return rows.length > 0;
}
