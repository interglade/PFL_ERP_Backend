import 'reflect-metadata';
import { balanceExcluding, summarizeGrnPayments, validateGrnPayment } from '../../grn/grnPayment';
import { InvoicePaymentService } from '../../invoice/service/invoicePayment.service';
import { GrnPaymentStatus } from '../../utils/status.enum';

/**
 * Final Invoice payment history uses the GRN payment rules (client decision 2026-10-29), with no
 * advance: the same balance, unpaid / partial / paid status, partial / full type and validation.
 */
const pay = (id: string, paymentNo: number, paymentDate: string, amount: unknown) => ({ id, paymentNo, paymentDate, amount });
const summary = (totalAmt: unknown, payments: ReturnType<typeof pay>[], storedStatus?: string) =>
  summarizeGrnPayments({ totalAmt, advancePaidAmt: 0, payments, storedStatus });

describe('Final Invoice payment summary', () => {
  it('is unpaid with no payments, partial after some, paid when the balance is 0', () => {
    expect(summary(50000, [])).toMatchObject({ paidAmt: 0, balanceAmt: 50000, status: GrnPaymentStatus.UNPAID });
    const s = summary('50000.00', [pay('a', 1, '2026-11-02', 20000)]);
    expect(s).toMatchObject({ paidAmt: 20000, balanceAmt: 30000, status: GrnPaymentStatus.PARTIAL });
    const done = summary(50000, [pay('a', 1, '2026-11-02', 20000), pay('b', 2, '2026-11-05', '30000')]);
    expect(done).toMatchObject({ paidAmt: 50000, balanceAmt: 0, status: GrnPaymentStatus.PAID });
    expect(done.rows.map((r) => r.paymentType)).toEqual(['partial', 'full']);
  });

  it('a stored "paid" from the old manual switch does not make an unpaid invoice paid', () => {
    // No advance on invoices, so the stored status never overrides the payments
    expect(summary(1000, [], 'paid').status).toBe(GrnPaymentStatus.UNPAID);
  });

  it('a voided payment (left out of the live list) gives its amount back to the balance', () => {
    const live = [pay('a', 1, '2026-11-02', 400)];
    expect(balanceExcluding({ totalAmt: 1000, advancePaidAmt: 0, payments: live, exceptId: null })).toBe(600);
    expect(balanceExcluding({ totalAmt: 1000, advancePaidAmt: 0, payments: live, exceptId: 'a' })).toBe(1000);
  });
});

describe('Final Invoice payment validation', () => {
  const ctx = { balanceAmt: 1000, today: '2026-11-10', grnDate: '2026-11-01', grnLabel: 'Final Invoice INV-7' };

  it('refuses overpayment, a date before the invoice and a future date', () => {
    expect(validateGrnPayment({ paymentDate: '2026-11-05', amount: 1200, paymentMode: 'cash' }, ctx)).toMatchObject({ ok: false });
    const early = validateGrnPayment({ paymentDate: '2026-10-30', amount: 100, paymentMode: 'cash' }, ctx);
    expect(early).toMatchObject({ ok: false });
    expect((early as { message: string }).message).toContain('Final Invoice INV-7');
    expect(validateGrnPayment({ paymentDate: '2026-11-11', amount: 100, paymentMode: 'cash' }, ctx)).toMatchObject({ ok: false });
  });

  it('accepts a valid non-cash payment with the account paid into', () => {
    expect(
      validateGrnPayment({ paymentDate: '2026-11-05', amount: 1000, paymentMode: 'neft', paidToAccountNo: '1234567890', paidToIfsc: 'sbin0001234' }, ctx),
    ).toMatchObject({ ok: true, value: { amount: 1000, paymentMode: 'neft', paidToIfsc: 'SBIN0001234' } });
  });
});

describe('who manages Final Invoice payments', () => {
  it('only Payment Managers (finalizers, admins and Super Admins do not)', () => {
    expect(InvoicePaymentService.canManage({ id: 'u', roles: ['employee', 'payment_manager'] })).toBe(true);
    expect(InvoicePaymentService.canManage({ id: 'u', roles: ['employee', 'finalizer'] })).toBe(false);
    expect(InvoicePaymentService.canManage({ id: 'u', roles: ['employee', 'admin'] })).toBe(false);
    expect(InvoicePaymentService.canManage({ id: 'u', roles: ['employee', 'super_admin', 'admin'] })).toBe(false);
    expect(InvoicePaymentService.canManage({ id: 'u', roles: null })).toBe(false);
    expect(InvoicePaymentService.canManage(undefined)).toBe(false);
  });
});
