import { grnTransactionAction } from '../../grn/grnTransaction';
import { assertDealSlipUsableForGrn, dealSlipGrnBlockReason } from '../../dealSlip/dealSlipGrnLink';

jest.mock('../../transactions/transaction.core', () => ({
  attachToTransaction: jest.fn(),
  openTransaction: jest.fn(),
  refreshTransaction: jest.fn(),
}));

const SLIP = '11111111-1111-4111-8111-111111111111';
const GRN = '22222222-2222-4222-8222-222222222222';

describe('GRN transaction number (docs/transaction-tracking-plan.md §9.4)', () => {
  it('opens a G purchase for a new GRN without a deal slip', () => {
    expect(grnTransactionAction({ grnTxnNo: null, hasDealSlip: false, dealSlipTxnNo: null, creating: true })).toBe('open');
  });

  it('never opens a number on edit for a GRN created before go-live', () => {
    expect(grnTransactionAction({ grnTxnNo: null, hasDealSlip: false, dealSlipTxnNo: null, creating: false })).toBe('none');
  });

  it('keeps an existing number when there is no deal slip', () => {
    expect(grnTransactionAction({ grnTxnNo: 'G26102900001', hasDealSlip: false, dealSlipTxnNo: null, creating: false })).toBe('none');
  });

  it("attaches to the deal slip's purchase, on create and when the deal slip changes", () => {
    expect(grnTransactionAction({ grnTxnNo: null, hasDealSlip: true, dealSlipTxnNo: 'R26102900001', creating: true })).toBe('attach');
    expect(grnTransactionAction({ grnTxnNo: 'R26102900001', hasDealSlip: true, dealSlipTxnNo: 'R26102900002', creating: false })).toBe('attach');
  });

  it('does nothing when already in the deal slip purchase', () => {
    expect(grnTransactionAction({ grnTxnNo: 'R26102900001', hasDealSlip: true, dealSlipTxnNo: 'R26102900001', creating: false })).toBe('none');
  });

  it('leaves its transaction when moved to a deal slip without a number, and gets none on create', () => {
    expect(grnTransactionAction({ grnTxnNo: 'R26102900001', hasDealSlip: true, dealSlipTxnNo: null, creating: false })).toBe('detach');
    expect(grnTransactionAction({ grnTxnNo: null, hasDealSlip: true, dealSlipTxnNo: null, creating: true })).toBe('none');
  });
});

describe('One Deal Slip = one GRN', () => {
  it('refuses a used deal slip with 409 and the agreed message', () => {
    expect(dealSlipGrnBlockReason({ deal_slip_no: 'DL2026102900001', live: true, status: 'Complete', used_by_grn_no: 'PFL-00007' })).toEqual({
      status: 409,
      message: 'Deal Slip DL2026102900001 is already used by GRN PFL-00007',
    });
  });

  it('locks the deal slip row and leaves the edited GRN out of the check', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('pg_advisory_xact_lock')) return [];
        return [{ deal_slip_no: 'DL1', live: true, status: 'Complete', used_by_grn_no: null }];
      }),
    };
    await expect(assertDealSlipUsableForGrn(manager as any, SLIP, GRN)).resolves.toBeUndefined();
    const check = calls.find((c) => c.sql.includes('FROM deal_slips ds'));
    expect(check?.sql).toContain('FOR UPDATE OF ds');
    expect(check?.params).toEqual([SLIP, GRN]);
  });

  it('a rejected or deleted GRN does not count (the SQL filters them)', async () => {
    const manager = { query: jest.fn(async () => [{ deal_slip_no: 'DL1', live: true, status: 'Complete', used_by_grn_no: null }]) };
    await assertDealSlipUsableForGrn(manager as any, SLIP);
    const sql = (manager.query.mock.calls as unknown as Array<[string]>).map((c) => c[0]).join('\n');
    expect(sql).toContain(`g."isDeleted" = false AND g."deletedAt" IS NULL`);
    expect(sql).toContain(`<> 'Rejected'`);
  });
});
