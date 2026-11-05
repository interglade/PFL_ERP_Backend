import { inject, injectable } from 'inversify';
import { DataSource, EntityManager } from 'typeorm';
import { formatInTimeZone } from 'date-fns-tz';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import logger from '../../utils/logger';
import { CacheService } from '../../global/cache.service';
import { NotificationService } from '../../notification/service/notification.service';
import { DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { GrnPaymentStatus } from '../../utils/status.enum';
import { isPaymentManager } from '../../utils/roles';
import { InvoicePayment } from '../entity/invoicePayment.entity';
import { InvoicePaymentChange } from '../entity/invoicePaymentChange.entity';
import { refreshTransactionOf } from '../../transactions/transaction.core';
import {
  balanceExcluding,
  diffGrnPayment,
  GrnPaymentInput,
  GrnPaymentSummary,
  summarizeGrnPayments,
  validateGrnPayment,
} from '../../grn/grnPayment';

const IST = 'Asia/Kolkata';

export interface InvoicePaymentActor {
  id: string;
  roles?: string[] | null;
  firstName?: string | null;
  lastName?: string | null;
}

interface InvoicePaymentHead {
  id: string;
  invoiceNo: string | null;
  totalAmount: string | null;
  ammountStatus: string | null;
  invoiceDate: string | null;
  createdAt: Date;
  createdById: string | null;
  customerId: string | null;
}

const userName = (u: { firstName?: string | null; lastName?: string | null } | null | undefined): string | null =>
  u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || null : null;

const dateText = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return formatInTimeZone(v, 'UTC', 'yyyy-MM-dd');
  return String(v).slice(0, 10);
};

/**
 * Final Invoice payment history (client decision 2026-10-29): part payments exactly like GRN
 * payments (docs/grn-payment-history-plan.md), with the same balance, status, validation and change
 * log (shared helpers in grn/grnPayment.ts, used with no advance). Only Payment Managers record,
 * edit and void; the invoice must have completed its approval.
 */
@injectable()
export class InvoicePaymentService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
    @inject(TYPES.NotificationService) private readonly notificationService: NotificationService,
  ) {}

  /** Only Payment Managers record, edit and void payments (finalizers, admins and Super Admins don't). */
  static canManage(user: InvoicePaymentActor | null | undefined): boolean {
    return isPaymentManager({ roles: user?.roles ?? undefined });
  }

  private assertCanManage(user: InvoicePaymentActor): void {
    if (!InvoicePaymentService.canManage(user)) {
      throw new AppError(403, 'Only a Payment Manager can record, edit or void Final Invoice payments');
    }
  }

  // ── Reads ────────────────────────────────────────────────────────────────────

  private async loadHead(m: EntityManager, invoiceId: string, lock = false): Promise<InvoicePaymentHead> {
    if (lock) {
      // One payment change per invoice at a time, so two people can't overpay together.
      await m.query(`SELECT id FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
    }
    const rows: InvoicePaymentHead[] = await m.query(
      `SELECT i.id, i."invoiceNo", i."totalAmount", i."ammountStatus"::text AS "ammountStatus",
              i."invoiceDate" AS "invoiceDate", i."createdAt", i.created_by AS "createdById",
              i.customer_id AS "customerId"
         FROM invoices i
        WHERE i.id = $1 AND COALESCE(i."isDeleted", false) = false AND i."deletedAt" IS NULL`,
      [invoiceId],
    );
    if (!rows[0]) throw new AppError(404, `Final Invoice with ID ${invoiceId} not found`);
    return rows[0];
  }

  private label(head: InvoicePaymentHead): string {
    return `Final Invoice ${head.invoiceNo ?? ''}`.trim();
  }

  /** Payments are recorded once the invoice has completed its approval. Null when payable, else the reason. */
  async payableBlockedReason(m: EntityManager, head: InvoicePaymentHead): Promise<string | null> {
    const status: Array<{ status: string | null }> = await m.query(
      `SELECT d.status::text AS status FROM documents d
        WHERE d.document_type_id = $1 AND d.type::text = $2 AND d."isDeleted" = false
        ORDER BY d."createdAt" DESC LIMIT 1`,
      [head.id, DocumentTypeEnum.FINAL_INVOICE],
    );
    if (status[0]?.status !== DocumentStatus.COMPLETE) {
      return `${this.label(head)} has not completed its approval yet, so payments cannot be recorded`;
    }
    return null;
  }

  private livePayments(m: EntityManager, invoiceId: string): Promise<InvoicePayment[]> {
    return m.getRepository(InvoicePayment).createQueryBuilder('p')
      .where('p.invoice_id = :invoiceId', { invoiceId })
      .andWhere('p.voidedAt IS NULL')
      .andWhere('p.isDeleted = false')
      .getMany();
  }

  private summarize(head: InvoicePaymentHead, payments: InvoicePayment[]): GrnPaymentSummary {
    return summarizeGrnPayments({
      totalAmt: head.totalAmount,
      advancePaidAmt: 0,
      storedStatus: head.ammountStatus,
      payments: payments.map((p) => ({ id: p.id, paymentNo: p.paymentNo, paymentDate: dateText(p.paymentDate)!, amount: p.amount })),
    });
  }

  /** The Payments section of the invoice view: summary, every payment (voided too) and its trail. */
  async getPayments(invoiceId: string, user: InvoicePaymentActor) {
    const m = this.dataSource.manager;
    const head = await this.loadHead(m, invoiceId);
    const payments = await m.getRepository(InvoicePayment).find({
      where: { invoice: { id: invoiceId }, isDeleted: false },
      relations: ['recordedBy', 'voidedBy'],
      order: { paymentNo: 'ASC' },
    });
    const live = payments.filter((p) => !p.voidedAt);
    const summary = this.summarize(head, live);
    const changes = payments.length
      ? await m.getRepository(InvoicePaymentChange).createQueryBuilder('c')
          .leftJoinAndSelect('c.changedBy', 'changedBy')
          .leftJoin('c.payment', 'payment')
          .addSelect('payment.id')
          .where('c.invoice_payment_id IN (:...ids)', { ids: payments.map((p) => p.id) })
          .orderBy('c.createdAt', 'ASC')
          .getMany()
      : [];
    const blockedReason = await this.payableBlockedReason(m, head);
    const canManage = InvoicePaymentService.canManage(user);

    return {
      invoiceId: head.id,
      invoiceNo: head.invoiceNo,
      summary: {
        totalAmt: summary.totalAmt,
        paidAmt: summary.paidAmt,
        balanceAmt: summary.balanceAmt,
        status: summary.status,
        paymentCount: live.length,
      },
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
      lastPaidTo: await this.lastPaidTo(m, head),
    };
  }

  /** The account this customer last paid into, to pre-fill the next payment. */
  private async lastPaidTo(m: EntityManager, head: InvoicePaymentHead) {
    if (!head.customerId) return null;
    const rows = await m.query(
      `SELECT p.paid_to_account_no AS "accountNo", p.paid_to_ifsc AS ifsc, p.paid_to_bank_name AS "bankName"
         FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.customer_id = $1 AND p.voided_at IS NULL AND p."isDeleted" = false AND p.paid_to_account_no IS NOT NULL
        ORDER BY p."createdAt" DESC LIMIT 1`,
      [head.customerId],
    );
    return rows[0] ?? null;
  }

  // ── Writes ───────────────────────────────────────────────────────────────────

  private dateContext(head: InvoicePaymentHead) {
    const invoiceDate = dateText(head.invoiceDate) ?? formatInTimeZone(new Date(head.createdAt), IST, 'yyyy-MM-dd');
    return {
      today: formatInTimeZone(new Date(), IST, 'yyyy-MM-dd'),
      grnDate: invoiceDate,
      grnLabel: this.label(head),
    };
  }

  /** Re-derives every live payment's type and balance-after, and the invoice's paid amount and status. */
  private async recompute(m: EntityManager, head: InvoicePaymentHead): Promise<{ before: string | null; summary: GrnPaymentSummary }> {
    const live = await this.livePayments(m, head.id);
    const summary = this.summarize(head, live);
    for (const row of summary.rows) {
      await m.update(InvoicePayment, { id: row.id }, { paymentType: row.paymentType, balanceAfter: row.balanceAfter });
    }
    await m.query(`UPDATE invoices SET paid_amount = $2, "ammountStatus" = $3 WHERE id = $1`, [head.id, summary.paidAmt, summary.status]);
    // The Sale closes when its invoice is approved and paid (docs/transaction-tracking-plan.md §9.3). Never throws.
    await refreshTransactionOf(m, 'final-invoice', head.id);
    return { before: head.ammountStatus, summary };
  }

  private async afterChange(head: InvoicePaymentHead, before: string | null, summary: GrnPaymentSummary): Promise<void> {
    await this.invalidateCache();
    // The creator is told only when the invoice becomes fully paid.
    if (before !== GrnPaymentStatus.PAID && summary.status === GrnPaymentStatus.PAID && head.createdById) {
      try {
        await this.notificationService.createNoti(
          `${this.label(head)} is fully paid (₹${summary.totalAmt.toFixed(2)})`,
          head.createdById,
        );
      } catch (error) {
        logger.error(`Fully-paid notification for invoice ${head.id} failed`, error);
      }
    }
  }

  async recordPayment(invoiceId: string, input: GrnPaymentInput, user: InvoicePaymentActor) {
    this.assertCanManage(user);
    const result = await this.dataSource.transaction(async (m) => {
      const head = await this.loadHead(m, invoiceId, true);
      const blocked = await this.payableBlockedReason(m, head);
      if (blocked) throw new AppError(409, blocked);

      const live = await this.livePayments(m, invoiceId);
      const balanceAmt = balanceExcluding({ totalAmt: head.totalAmount, advancePaidAmt: 0, payments: live, exceptId: null });
      const checked = validateGrnPayment(input, { balanceAmt, ...this.dateContext(head) });
      if (!checked.ok) throw new AppError(400, checked.message);

      const [{ next }] = await m.query(`SELECT COALESCE(MAX(payment_no), 0) + 1 AS next FROM invoice_payments WHERE invoice_id = $1`, [invoiceId]);
      const payment = await m.save(m.create(InvoicePayment, {
        ...checked.value,
        invoice: { id: invoiceId } as any,
        paymentNo: Number(next),
        recordedBy: { id: user.id } as any,
      }));
      await m.save(m.create(InvoicePaymentChange, {
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

  async editPayment(invoiceId: string, paymentId: string, input: GrnPaymentInput & { reason?: unknown }, user: InvoicePaymentActor) {
    this.assertCanManage(user);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!reason) throw new AppError(400, 'A reason is required to edit a payment');

    const result = await this.dataSource.transaction(async (m) => {
      const head = await this.loadHead(m, invoiceId, true);
      const payment = await this.loadPayment(m, invoiceId, paymentId);
      if (payment.voidedAt) throw new AppError(409, `Payment ${payment.paymentNo} of ${this.label(head)} is voided, so it can't be edited`);

      const live = await this.livePayments(m, invoiceId);
      const balanceAmt = balanceExcluding({ totalAmt: head.totalAmount, advancePaidAmt: 0, payments: live, exceptId: paymentId });
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

      await m.update(InvoicePayment, { id: paymentId }, checked.value);
      await m.save(m.create(InvoicePaymentChange, {
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

  async voidPayment(invoiceId: string, paymentId: string, reasonInput: unknown, user: InvoicePaymentActor) {
    this.assertCanManage(user);
    const reason = typeof reasonInput === 'string' ? reasonInput.trim() : '';
    if (!reason) throw new AppError(400, 'A reason is required to void a payment');

    const result = await this.dataSource.transaction(async (m) => {
      const head = await this.loadHead(m, invoiceId, true);
      const payment = await this.loadPayment(m, invoiceId, paymentId);
      if (payment.voidedAt) throw new AppError(409, `Payment ${payment.paymentNo} of ${this.label(head)} is already voided`);

      await m.update(InvoicePayment, { id: paymentId }, {
        voidedAt: new Date(),
        voidedBy: { id: user.id } as any,
        voidReason: reason,
      });
      await m.save(m.create(InvoicePaymentChange, {
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

  private async loadPayment(m: EntityManager, invoiceId: string, paymentId: string): Promise<InvoicePayment> {
    const payment = await m.getRepository(InvoicePayment).findOne({ where: { id: paymentId, invoice: { id: invoiceId }, isDeleted: false } });
    if (!payment) throw new AppError(404, `Payment ${paymentId} of this Final Invoice not found`);
    return payment;
  }

  private writeResult(r: { head: InvoicePaymentHead; summary: GrnPaymentSummary; paymentId: string; paymentNo: number }) {
    const row = r.summary.rows.find((x) => x.id === r.paymentId);
    return {
      invoiceId: r.head.id,
      invoiceNo: r.head.invoiceNo,
      paymentId: r.paymentId,
      paymentNo: r.paymentNo,
      paymentType: row?.paymentType ?? null,
      paidAmt: r.summary.paidAmt,
      balanceAmt: r.summary.balanceAmt,
      ammountStatus: r.summary.status,
    };
  }

  /** Same cache keys as FinalInvoiceService (prefix `finv`): lists, views, edit data and PDF. */
  private async invalidateCache(): Promise<void> {
    try {
      await this.cacheService.invalidatePattern('finv:*');
    } catch (error) {
      logger.error('Clearing the Final Invoice caches after a payment change failed', error);
    }
  }
}

/** Live (not voided) payments of an invoice exist: it can no longer be deleted (as for GRN). */
export async function invoiceHasLivePayments(m: EntityManager, invoiceId: string): Promise<boolean> {
  const rows = await m.query(
    `SELECT 1 FROM invoice_payments WHERE invoice_id = $1 AND voided_at IS NULL AND "isDeleted" = false LIMIT 1`,
    [invoiceId],
  );
  return rows.length > 0;
}
