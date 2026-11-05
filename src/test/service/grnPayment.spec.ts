import 'reflect-metadata';
import {
  balanceExcluding,
  diffGrnPayment,
  grnPaidAndBalance,
  summarizeGrnPayments,
  validateGrnPayment,
} from '../../grn/grnPayment';
import { GrnPaymentService } from '../../grn/service/grnPayment.service';
import { GrnPaymentStatus } from '../../utils/status.enum';

const pay = (id: string, paymentNo: number, paymentDate: string, amount: unknown) => ({ id, paymentNo, paymentDate, amount });

describe('GRN payment summary (balance, status, partial / full)', () => {
  it("follows the client's example: 10,00,000 paid as 5,00,000 + 2,00,000 + 3,00,000", () => {
    const payments = [pay('a', 1, '2026-11-02', '500000'), pay('b', 2, '2026-11-09', 200000)];
    let s = summarizeGrnPayments({ totalAmt: '1000000.00', advancePaidAmt: null, payments });
    expect(s).toMatchObject({ paidAmt: 700000, balanceAmt: 300000, status: GrnPaymentStatus.PARTIAL });
    expect(s.rows).toEqual([
      { id: 'a', paymentType: 'partial', balanceAfter: 500000 },
      { id: 'b', paymentType: 'partial', balanceAfter: 300000 },
    ]);

    s = summarizeGrnPayments({ totalAmt: 1000000, advancePaidAmt: 0, payments: [...payments, pay('c', 3, '2026-11-20', 300000)] });
    expect(s).toMatchObject({ paidAmt: 1000000, balanceAmt: 0, status: GrnPaymentStatus.PAID });
    expect(s.rows.map((r) => r.paymentType)).toEqual(['partial', 'partial', 'full']);
  });

  it('one payment of the whole amount is Full', () => {
    const s = summarizeGrnPayments({ totalAmt: 1250.5, advancePaidAmt: 0, payments: [pay('a', 1, '2026-11-02', '1250.50')] });
    expect(s.status).toBe(GrnPaymentStatus.PAID);
    expect(s.rows[0]).toEqual({ id: 'a', paymentType: 'full', balanceAfter: 0 });
  });

  it('counts the advance towards paid, but an advance alone leaves the GRN unpaid', () => {
    expect(summarizeGrnPayments({ totalAmt: 1000, advancePaidAmt: 400, payments: [] })).toMatchObject({
      paidAmt: 0, balanceAmt: 600, status: GrnPaymentStatus.UNPAID, advanceCoversTotal: false,
    });
    const s = summarizeGrnPayments({ totalAmt: 1000, advancePaidAmt: 400, payments: [pay('a', 1, '2026-11-02', 600)] });
    expect(s).toMatchObject({ balanceAmt: 0, status: GrnPaymentStatus.PAID });
    expect(s.rows[0].paymentType).toBe('full');
  });

  it('an advance covering the total is paid only once a Payment Manager confirms it', () => {
    expect(summarizeGrnPayments({ totalAmt: 1000, advancePaidAmt: 1000, payments: [] })).toMatchObject({
      balanceAmt: 0, status: GrnPaymentStatus.UNPAID, advanceCoversTotal: true,
    });
    expect(summarizeGrnPayments({ totalAmt: 1000, advancePaidAmt: 1000, payments: [], storedStatus: 'Paid' }).status)
      .toBe(GrnPaymentStatus.PAID);
  });

  it('orders by payment date, then by the order recorded (a back-dated payment comes first)', () => {
    const s = summarizeGrnPayments({
      totalAmt: 300,
      advancePaidAmt: 0,
      payments: [pay('late', 1, '2026-11-10', 100), pay('early', 2, '2026-11-01', 200), pay('same-day', 3, '2026-11-10', 0)],
    });
    expect(s.rows.map((r) => [r.id, r.balanceAfter])).toEqual([['early', 100], ['late', 0], ['same-day', 0]]);
  });

  it('works in paise, so 0.1 + 0.2 clears a total of 0.3', () => {
    const s = summarizeGrnPayments({ totalAmt: '0.30', advancePaidAmt: 0, payments: [pay('a', 1, '2026-11-01', 0.1), pay('b', 2, '2026-11-01', 0.2)] });
    expect(s).toMatchObject({ paidAmt: 0.3, balanceAmt: 0, status: GrnPaymentStatus.PAID });
  });

  it('list / view balance from the stored paid amount', () => {
    expect(grnPaidAndBalance('1000000.00', '100000.00', '500000.00')).toEqual({ paidAmt: 500000, balanceAmt: 400000 });
    expect(grnPaidAndBalance(null, undefined, undefined)).toEqual({ paidAmt: 0, balanceAmt: 0 });
  });

  it('the balance available to a payment excludes the payment itself (edit)', () => {
    const payments = [{ id: 'a', amount: 500 }, { id: 'b', amount: 200 }];
    expect(balanceExcluding({ totalAmt: 1000, advancePaidAmt: 100, payments, exceptId: null })).toBe(200);
    expect(balanceExcluding({ totalAmt: 1000, advancePaidAmt: 100, payments, exceptId: 'b' })).toBe(400);
  });
});

describe('GRN payment validation', () => {
  const ctx = { balanceAmt: 300000, today: '2026-11-20', grnDate: '2026-11-01', grnLabel: 'GRN G-1' };
  const good = { paymentDate: '2026-11-20', amount: '300000', paymentMode: 'NEFT', paidToAccountNo: ' 1234567890 ', paidToIfsc: 'sbin0001234' };

  it('cleans a valid payment', () => {
    const r = validateGrnPayment({ ...good, remarks: '  final  ', referenceNo: '' }, ctx);
    expect(r).toEqual({
      ok: true,
      value: {
        paymentDate: '2026-11-20', amount: 300000, paymentMode: 'neft', paidToAccountNo: '1234567890',
        paidToIfsc: 'SBIN0001234', paidToBankName: null, referenceNo: null, remarks: 'final',
      },
    });
  });

  it.each([
    ['a missing date', { paymentDate: '' }, 'Payment date is required (yyyy-MM-dd)'],
    ['a future date', { paymentDate: '2026-11-21' }, 'Payment date cannot be in the future'],
    ['a date before the GRN', { paymentDate: '2026-10-31' }, 'Payment date cannot be before the date of GRN G-1 (2026-11-01)'],
    ['a missing amount', { amount: '' }, 'Amount is required'],
    ['a zero amount', { amount: 0 }, 'Amount must be more than 0'],
    ['a negative amount', { amount: -5 }, 'Amount must be more than 0'],
    ['overpayment', { amount: 300000.01 }, 'Amount 300000.01 is more than the balance of GRN G-1 (300000.00)'],
    ['an unknown mode', { paymentMode: 'barter' }, 'Payment mode must be one of cash, upi, cheque, demand draft, neft, rtgs, other'],
    ['no account for a bank payment', { paidToAccountNo: '  ' }, 'The account number paid to is required for a non-cash payment'],
  ])('refuses %s', (_label, change, message) => {
    expect(validateGrnPayment({ ...good, ...change }, ctx)).toEqual({ ok: false, message });
  });

  it('does not need an account for cash', () => {
    const r = validateGrnPayment({ paymentDate: '2026-11-05', amount: 10, paymentMode: 'cash' }, ctx);
    expect(r.ok).toBe(true);
  });

  it('logs only the fields an edit changed, comparing amounts in paise', () => {
    const before = { paymentDate: '2026-11-20', amount: '300000.00', paymentMode: 'neft', paidToAccountNo: '1234567890', paidToIfsc: 'SBIN0001234', paidToBankName: null, referenceNo: null, remarks: null };
    const after = { ...before, amount: 300000, remarks: 'UTR corrected', referenceNo: 'UTR9' } as any;
    expect(diffGrnPayment(before, after)).toEqual({
      referenceNo: { oldValue: null, newValue: 'UTR9' },
      remarks: { oldValue: null, newValue: 'UTR corrected' },
    });
  });
});

describe('who manages GRN payments', () => {
  it('only Payment Managers (finalizers, admins and Super Admins no longer)', () => {
    expect(GrnPaymentService.canManage({ id: 'u', roles: ['employee', 'payment_manager'] })).toBe(true);
    expect(GrnPaymentService.canManage({ id: 'u', roles: ['employee', 'finalizer'] })).toBe(false);
    expect(GrnPaymentService.canManage({ id: 'u', roles: ['employee', 'admin'] })).toBe(false);
    expect(GrnPaymentService.canManage({ id: 'u', roles: ['employee', 'super_admin', 'admin'] })).toBe(false);
    expect(GrnPaymentService.canManage({ id: 'u', roles: null })).toBe(false);
    expect(GrnPaymentService.canManage(undefined)).toBe(false);
  });
});
