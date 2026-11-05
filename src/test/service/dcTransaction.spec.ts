jest.mock('../../transactions/transaction.core', () => ({
  attachToTransaction: jest.fn(async (_m: unknown, input: { txnNo: string }) => input.txnNo),
}));

import { attachToTransaction } from '../../transactions/transaction.core';
import { attachToDcTransaction } from '../../deliveryChallans/customerDeliveryChllan/service/dcTransaction';

const managerReturning = (rows: unknown[]) => ({ query: jest.fn().mockResolvedValue(rows) }) as any;

describe('attachToDcTransaction', () => {
  beforeEach(() => (attachToTransaction as jest.Mock).mockClear());

  it("stamps an RBC with its Customer DC's sale number, read from the RBC's own row", async () => {
    const m = managerReturning([{ no: 'RBC1', txn_no: 'S26102900001' }]);
    await expect(attachToDcTransaction(m, 'return-by-customer', 'r1')).resolves.toBe('S26102900001');
    expect(m.query.mock.calls[0][0]).toContain('FROM "return_by_customer" h');
    expect(m.query.mock.calls[0][0]).toContain('h."rbcNo"');
    expect(attachToTransaction).toHaveBeenCalledWith(m, { txnNo: 'S26102900001', docType: 'return-by-customer', docId: 'r1', docNo: 'RBC1' });
  });

  it('reads a Final Invoice from the invoices table', async () => {
    const m = managerReturning([{ no: 'INV1', txn_no: 'S26102900002' }]);
    await attachToDcTransaction(m, 'final-invoice', 'i1');
    expect(m.query.mock.calls[0][0]).toContain('FROM "invoices" h');
    expect(attachToTransaction).toHaveBeenCalledWith(m, { txnNo: 'S26102900002', docType: 'final-invoice', docId: 'i1', docNo: 'INV1' });
  });

  it('does nothing when the DC has no transaction (created before go-live) or is missing', async () => {
    await expect(attachToDcTransaction(managerReturning([{ no: 'RBC2', txn_no: null }]), 'return-by-customer', 'r2')).resolves.toBeNull();
    await expect(attachToDcTransaction(managerReturning([]), 'final-invoice', 'i2')).resolves.toBeNull();
    expect(attachToTransaction).not.toHaveBeenCalled();
  });
});
