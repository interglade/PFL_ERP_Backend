import { GrnPaymentStatus } from '../utils/status.enum';

/**
 * GRN payment history (docs/grn-payment-history-plan.md): the balance, the payment status and
 * each payment's partial / full type, worked out in one place. Amounts are handled in paise so a
 * 0.01 rounding gap can never leave a GRN "partially paid".
 */

export type GrnPaymentType = 'partial' | 'full';

/** Payment modes, the same list as the GRN form's payment mode. */
export const GRN_PAYMENT_MODES = ['cash', 'upi', 'cheque', 'demand draft', 'neft', 'rtgs', 'other'] as const;
export type GrnPaymentMode = (typeof GRN_PAYMENT_MODES)[number];

export const toPaise = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
export const fromPaise = (paise: number): number => paise / 100;

export interface PaymentForSummary {
  id: string;
  paymentNo: number;
  paymentDate: string;
  amount: unknown;
}

export interface GrnPaymentSummary {
  totalAmt: number;
  advancePaidAmt: number;
  /** Sum of the live (not voided) recorded payments; the advance is not included. */
  paidAmt: number;
  /** total − advance − paid, never below 0. */
  balanceAmt: number;
  status: GrnPaymentStatus;
  /** The advance alone covers the whole total, so there is nothing left to record (see `storedStatus`). */
  advanceCoversTotal: boolean;
  /** Per live payment, in payment order: its type and the balance left after it. */
  rows: Array<{ id: string; paymentType: GrnPaymentType; balanceAfter: number }>;
}

/** Payments in the order they were paid: by date, then by the order they were recorded. */
export function paymentOrder<T extends { paymentDate: string; paymentNo: number }>(payments: T[]): T[] {
  return [...payments].sort((a, b) =>
    a.paymentDate === b.paymentDate ? a.paymentNo - b.paymentNo : a.paymentDate < b.paymentDate ? -1 : 1,
  );
}

/**
 * B1 balance = total − advance − live payments. B2 status: Paid when payments leave nothing,
 * Partially paid when something was recorded and a balance remains, Unpaid otherwise (an advance
 * alone does not count as payment). When the advance alone covers the total there is nothing to
 * record; such a GRN is Paid only once a finalizer confirms it (`storedStatus` paid).
 * P4: the payment that brings the balance to 0 is Full, every other one Partial.
 */
export function summarizeGrnPayments(input: {
  totalAmt: unknown;
  advancePaidAmt: unknown;
  payments: PaymentForSummary[];
  storedStatus?: string | null;
}): GrnPaymentSummary {
  const total = toPaise(input.totalAmt);
  const advance = toPaise(input.advancePaidAmt);
  let running = total - advance;
  let paid = 0;
  const rows = paymentOrder(input.payments).map((p) => {
    const amount = toPaise(p.amount);
    paid += amount;
    running -= amount;
    return {
      id: p.id,
      paymentType: (running <= 0 ? 'full' : 'partial') as GrnPaymentType,
      balanceAfter: fromPaise(Math.max(running, 0)),
    };
  });
  const balance = Math.max(total - advance - paid, 0);
  const advanceCoversTotal = paid === 0 && total > 0 && advance >= total;
  const status =
    paid > 0
      ? balance === 0 ? GrnPaymentStatus.PAID : GrnPaymentStatus.PARTIAL
      : advanceCoversTotal && input.storedStatus === GrnPaymentStatus.PAID
        ? GrnPaymentStatus.PAID
        : GrnPaymentStatus.UNPAID;
  return {
    totalAmt: fromPaise(total),
    advancePaidAmt: fromPaise(advance),
    paidAmt: fromPaise(paid),
    balanceAmt: fromPaise(balance),
    status,
    advanceCoversTotal,
    rows,
  };
}

/** Paid and balance from the GRN's stored paid amount, for lists and views. */
export function grnPaidAndBalance(totalAmt: unknown, advancePaidAmt: unknown, paidAmt: unknown): { paidAmt: number; balanceAmt: number } {
  return {
    paidAmt: fromPaise(toPaise(paidAmt)),
    balanceAmt: fromPaise(Math.max(toPaise(totalAmt) - toPaise(advancePaidAmt) - toPaise(paidAmt), 0)),
  };
}

/** The balance a GRN has before the given payment (or before a new one when `exceptId` is null). */
export function balanceExcluding(input: {
  totalAmt: unknown;
  advancePaidAmt: unknown;
  payments: Array<{ id: string; amount: unknown }>;
  exceptId: string | null;
}): number {
  const others = input.payments.filter((p) => p.id !== input.exceptId).reduce((s, p) => s + toPaise(p.amount), 0);
  return fromPaise(toPaise(input.totalAmt) - toPaise(input.advancePaidAmt) - others);
}

export interface GrnPaymentInput {
  paymentDate?: unknown;
  amount?: unknown;
  paymentMode?: unknown;
  paidToAccountNo?: unknown;
  paidToIfsc?: unknown;
  paidToBankName?: unknown;
  referenceNo?: unknown;
  remarks?: unknown;
}

export interface CleanGrnPayment {
  paymentDate: string;
  amount: number;
  paymentMode: GrnPaymentMode;
  paidToAccountNo: string | null;
  paidToIfsc: string | null;
  paidToBankName: string | null;
  referenceNo: string | null;
  remarks: string | null;
}

const text = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
};

/**
 * P2, P3 (amount > 0, at most the balance), P5 (not in the future, not before the GRN date).
 * Dates are yyyy-MM-dd in India time. Returns the cleaned payment, or the first problem found.
 */
export function validateGrnPayment(
  input: GrnPaymentInput,
  ctx: { balanceAmt: number; today: string; grnDate: string; grnLabel: string },
): { ok: true; value: CleanGrnPayment } | { ok: false; message: string } {
  const paymentDate = text(input.paymentDate, 10);
  if (!paymentDate || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || Number.isNaN(Date.parse(paymentDate))) {
    return { ok: false, message: 'Payment date is required (yyyy-MM-dd)' };
  }
  if (paymentDate > ctx.today) return { ok: false, message: 'Payment date cannot be in the future' };
  if (paymentDate < ctx.grnDate) {
    return { ok: false, message: `Payment date cannot be before the date of ${ctx.grnLabel} (${ctx.grnDate})` };
  }

  const amountPaise = toPaise(input.amount);
  if (input.amount === undefined || input.amount === null || input.amount === '' || !Number.isFinite(Number(input.amount))) {
    return { ok: false, message: 'Amount is required' };
  }
  if (amountPaise <= 0) return { ok: false, message: 'Amount must be more than 0' };
  const balancePaise = toPaise(ctx.balanceAmt);
  if (amountPaise > balancePaise) {
    return {
      ok: false,
      message: `Amount ${fromPaise(amountPaise).toFixed(2)} is more than the balance of ${ctx.grnLabel} (${fromPaise(Math.max(balancePaise, 0)).toFixed(2)})`,
    };
  }

  const mode = text(input.paymentMode, 50)?.toLowerCase() ?? '';
  if (!(GRN_PAYMENT_MODES as readonly string[]).includes(mode)) {
    return { ok: false, message: `Payment mode must be one of ${GRN_PAYMENT_MODES.join(', ')}` };
  }

  const paidToAccountNo = text(input.paidToAccountNo, 34);
  if (mode !== 'cash' && !paidToAccountNo) {
    return { ok: false, message: 'The account number paid to is required for a non-cash payment' };
  }

  return {
    ok: true,
    value: {
      paymentDate,
      amount: fromPaise(amountPaise),
      paymentMode: mode as GrnPaymentMode,
      paidToAccountNo,
      paidToIfsc: text(input.paidToIfsc, 11)?.toUpperCase() ?? null,
      paidToBankName: text(input.paidToBankName, 150),
      referenceNo: text(input.referenceNo, 100),
      remarks: text(input.remarks, 1000),
    },
  };
}

/** The tracked fields of a payment, for the change log of an edit. */
export const GRN_PAYMENT_FIELDS: Array<keyof CleanGrnPayment> = [
  'paymentDate', 'amount', 'paymentMode', 'paidToAccountNo', 'paidToIfsc', 'paidToBankName', 'referenceNo', 'remarks',
];

export function diffGrnPayment(
  before: Record<string, unknown>,
  after: CleanGrnPayment,
): Record<string, { oldValue: unknown; newValue: unknown }> {
  const norm = (field: string, v: unknown) =>
    v === undefined || v === null || v === '' ? null : field === 'amount' ? toPaise(v) : String(v);
  const changes: Record<string, { oldValue: unknown; newValue: unknown }> = {};
  for (const field of GRN_PAYMENT_FIELDS) {
    if (norm(field, before[field]) !== norm(field, after[field])) {
      changes[field] = {
        oldValue: field === 'amount' && before[field] != null ? Number(before[field]) : (before[field] ?? null),
        newValue: after[field] ?? null,
      };
    }
  }
  return changes;
}
