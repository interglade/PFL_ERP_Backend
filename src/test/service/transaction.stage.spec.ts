/**
 * Steps, stage and close rules (docs/transaction-tracking-plan.md §9.3) from
 * plain facts, and the transaction columns written by the stock primitives.
 */

import 'reflect-metadata';
import { EntityManager } from 'typeorm';
import { DocFact } from '../../transactions/transaction.docs';
import { daysBetween, deriveStage, StageFacts } from '../../transactions/transaction.stage';
import { consumeDocument, postIn } from '../../inventoryStock/batch/stockBatch.core';
import { TxnDocType } from '../../transactions/transaction.types';

let seq = 0;
const doc = (docType: TxnDocType, step: string, status: string | null, extra: Partial<DocFact> = {}): DocFact => ({
  docType, id: `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`, docNo: `${docType}-${seq}`, documentId: null,
  status, deleted: false, step, createdAt: null, createdBy: null, ...extra,
});

const purchase = (docs: DocFact[], extra: Partial<StageFacts> = {}): StageFacts => ({
  type: 'purchase', originDocType: 'rfpa', originStatus: docs[0]?.status ?? null, originDeleted: false, docs, ...extra,
});

const stateOf = (steps: Array<{ key: string; state: string }>) => Object.fromEntries(steps.map((s) => [s.key, s.state]));

describe('purchase', () => {
  it('waits for RFPA approval first', () => {
    const r = deriveStage(purchase([doc('rfpa', 'rfpa', 'Hold')]));
    expect(r).toEqual(expect.objectContaining({ stage: 'rfpa', stageLabel: 'Waiting for RFPA approval', status: 'Open' }));
    expect(stateOf(r.steps)).toEqual({ rfpa: 'Current', 'deal-slip': 'Pending', grn: 'Pending', dispatch: 'Pending', receiving: 'Pending', payment: 'Pending' });
  });

  it('shows In transit while the vehicle has not been received', () => {
    const docs = [doc('rfpa', 'rfpa', 'Complete'), doc('deal-slip', 'deal-slip', 'Complete'), doc('grn', 'grn', 'Complete'), doc('dispatch', 'dispatch', 'Complete')];
    const r = deriveStage(purchase(docs, { dispatchStatus: 'Approved', receivingState: 'In Transit' }));
    expect(r.stage).toBe('receiving');
    expect(r.stageLabel).toBe('In transit');
    const r2 = deriveStage(purchase(docs, { dispatchStatus: 'Approved', receivingState: 'In Progress' }));
    expect(r2.stageLabel).toBe('At the CC/DC – receiving');
  });

  it('closes only when receiving is done and the GRN is paid', () => {
    const docs = [doc('rfpa', 'rfpa', 'Complete'), doc('deal-slip', 'deal-slip', 'Complete'), doc('grn', 'grn', 'Complete')];
    const unpaid = deriveStage(purchase(docs, { dispatchStatus: 'Approved', receivingState: 'Done', grnPaid: false }));
    expect(unpaid).toEqual(expect.objectContaining({ stage: 'payment', stageLabel: 'Waiting for payment', status: 'Open' }));
    const paid = deriveStage(purchase(docs, { dispatchStatus: 'Approved', receivingState: 'Done', grnPaid: true }));
    expect(paid).toEqual(expect.objectContaining({ stage: 'done', stageLabel: 'Done', status: 'Closed' }));
    // Paid but not received yet: still open.
    expect(deriveStage(purchase(docs, { dispatchStatus: 'Approved', receivingState: 'Received', grnPaid: true })).status).toBe('Open');
  });

  it('a G purchase starts at the GRN; a dispatch not required is skipped', () => {
    const r = deriveStage({ type: 'purchase', originDocType: 'grn', originStatus: 'Complete', originDeleted: false, docs: [doc('grn', 'grn', 'Complete')], dispatchStatus: 'Not Required', receivingState: 'Received' });
    expect(r.steps.map((s) => s.key)).toEqual(['grn', 'dispatch', 'receiving', 'payment']);
    expect(stateOf(r.steps).dispatch).toBe('Skipped');
    expect(r.stage).toBe('receiving');
  });

  it('a direct-to-customer GRN replaces receiving with the delivery to the customer', () => {
    const docs = [doc('grn', 'grn', 'Complete')];
    const base = { type: 'purchase' as const, originDocType: 'grn' as const, originStatus: 'Complete', originDeleted: false, docs, directToCustomer: true, dispatchStatus: 'Approved' as const, grnPaid: true };
    const pending = deriveStage({ ...base, deliveredToCustomer: false });
    expect(pending.steps.map((s) => s.key)).toEqual(['grn', 'dispatch', 'delivered-to-customer', 'payment']);
    expect(pending).toEqual(expect.objectContaining({ stage: 'delivered-to-customer', stageLabel: 'Delivered to customer pending', status: 'Open' }));
    expect(deriveStage({ ...base, deliveredToCustomer: true }).status).toBe('Closed');
  });

  it('a rejected GRN shows as rejected and keeps the transaction open', () => {
    const docs = [doc('rfpa', 'rfpa', 'Complete'), doc('deal-slip', 'deal-slip', 'Complete'), doc('grn', 'grn', 'Rejected')];
    const r = deriveStage(purchase(docs));
    expect(r).toEqual(expect.objectContaining({ stage: 'grn', stageLabel: 'GRN rejected', status: 'Open' }));
    expect(stateOf(r.steps).grn).toBe('Rejected');
    // Redone: the new live GRN counts, the rejected one is history.
    const redone = deriveStage(purchase([...docs, doc('grn', 'grn', 'Hold')]));
    expect(redone.stageLabel).toBe('Waiting for GRN approval');
  });

  it('is cancelled when the origin document is rejected or deleted', () => {
    expect(deriveStage(purchase([doc('rfpa', 'rfpa', 'Rejected')])).status).toBe('Cancelled');
    const deleted = deriveStage(purchase([doc('rfpa', 'rfpa', 'Hold', { deleted: true })], { originDeleted: true }));
    expect(deleted).toEqual(expect.objectContaining({ stage: 'cancelled', stageLabel: 'Cancelled', status: 'Cancelled' }));
  });
});

describe('transfer', () => {
  const facts = (extra: Partial<StageFacts>): StageFacts => ({
    type: 'transfer', originDocType: 'dc-transfer', originStatus: 'Complete', originDeleted: false, docs: [doc('dc-transfer', 'transfer-dc', 'Complete')], ...extra,
  });
  it('waits for the dispatch, then closes when receiving at the To-location is done', () => {
    expect(deriveStage(facts({ dispatchStatus: 'None' }))).toEqual(expect.objectContaining({ stage: 'dispatch', stageLabel: 'Vehicle dispatch pending' }));
    expect(deriveStage(facts({ dispatchStatus: 'Approved', receivingState: 'In Transit' })).stageLabel).toBe('In transit');
    expect(deriveStage(facts({ dispatchStatus: 'Approved', receivingState: 'Done' })).status).toBe('Closed');
  });
  it('waits for the Transfer DC approval', () => {
    const r = deriveStage({ type: 'transfer', originDocType: 'dc-transfer', originStatus: 'Hold', originDeleted: false, docs: [doc('dc-transfer', 'transfer-dc', 'Hold')] });
    expect(r).toEqual(expect.objectContaining({ stage: 'transfer-dc', stageLabel: 'Transfer DC pending' }));
  });
});

describe('sale', () => {
  const dc = () => doc('dc-customer', 'customer-dc', 'Complete');
  const facts = (docs: DocFact[], extra: Partial<StageFacts>): StageFacts => ({
    type: 'sale', originDocType: 'dc-customer', originStatus: 'Complete', originDeleted: false, docs, ...extra,
  });

  it('without return: dispatch, delivery, invoice, payment', () => {
    const r = deriveStage(facts([dc()], { dispatchStatus: 'Approved', deliveryConfirmed: false }));
    expect(r.steps.map((s) => s.key)).toEqual(['customer-dc', 'dispatch', 'delivery', 'invoice', 'payment']);
    expect(r).toEqual(expect.objectContaining({ stage: 'delivery', stageLabel: 'Delivery confirmation pending' }));
    const invoicing = deriveStage(facts([dc()], { dispatchStatus: 'Approved', deliveryConfirmed: true }));
    expect(invoicing.stageLabel).toBe('Final invoice pending');
  });

  it('with an RBC waiting for approval: the return step comes before the delivery', () => {
    const r = deriveStage(facts([dc(), doc('return-by-customer', 'return', 'Hold')], { dispatchStatus: 'Approved' }));
    expect(r.steps.map((s) => s.key)).toEqual(['customer-dc', 'dispatch', 'return', 'delivery', 'invoice', 'payment']);
    expect(r).toEqual(expect.objectContaining({ stage: 'return', stageLabel: 'Waiting for return (RBC) approval' }));
  });

  it('closes on an approved, paid invoice even when the return receiving is still open', () => {
    const docs = [dc(), doc('return-by-customer', 'return', 'Complete'), doc('final-invoice', 'invoice', 'Complete')];
    const r = deriveStage(facts(docs, { dispatchStatus: 'Approved', deliveryConfirmed: true, invoicePaid: true, returnReceivingState: 'In Progress' }));
    expect(r.status).toBe('Closed');
    const side = r.steps.find((s) => s.key === 'return-receiving');
    expect(side).toEqual(expect.objectContaining({ side: true, state: 'Current' }));
    const unpaid = deriveStage(facts(docs, { dispatchStatus: 'Approved', deliveryConfirmed: true, invoicePaid: false, returnReceivingState: 'Done' }));
    expect(unpaid).toEqual(expect.objectContaining({ stage: 'payment', status: 'Open' }));
  });

  it('a direct sale has no dispatch step to wait for', () => {
    const r = deriveStage(facts([dc()], { directSale: true, deliveryConfirmed: false }));
    expect(stateOf(r.steps).dispatch).toBe('Skipped');
    expect(r.stage).toBe('delivery');
  });

  it('a rejected RBC is not needed once the delivery is confirmed without it', () => {
    const r = deriveStage(facts([dc(), doc('return-by-customer', 'return', 'Rejected')], { dispatchStatus: 'Approved', deliveryConfirmed: true }));
    expect(stateOf(r.steps).return).toBe('Skipped');
    expect(r.stage).toBe('invoice');
  });
});

describe('other sale and second sale', () => {
  it('close when approved', () => {
    const other = (status: string) => deriveStage({ type: 'other-sale', originDocType: 'dc-other', originStatus: status, originDeleted: false, docs: [doc('dc-other', 'other-dc', status)] });
    expect(other('Hold')).toEqual(expect.objectContaining({ stage: 'other-dc', stageLabel: 'Other DC pending', status: 'Open' }));
    expect(other('Complete').status).toBe('Closed');
    const second = deriveStage({ type: 'second-sale', originDocType: 'second-sale', originStatus: 'Complete', originDeleted: false, docs: [doc('second-sale', 'second-sale', 'Complete')] });
    expect(second.status).toBe('Closed');
  });
});

describe('daysBetween', () => {
  it('counts whole days, never negative', () => {
    expect(daysBetween('2026-10-25T10:00:00Z', '2026-10-29T09:00:00Z')).toBe(3);
    expect(daysBetween('2026-10-29T10:00:00Z', '2026-10-28T10:00:00Z')).toBe(0);
    expect(daysBetween(null)).toBe(0);
  });
});

describe('stock primitives write transaction numbers', () => {
  const fake = (rules: Array<[RegExp, unknown[]]>) => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return rules.find(([p]) => p.test(sql))?.[1] ?? [];
      }),
    } as unknown as EntityManager;
    return { manager, calls };
  };

  it('postIn sets the batch origin transaction (once) and the ledger txn_no from the Inward', async () => {
    const { manager, calls } = fake([[/INSERT INTO stock_batch/, [{ id: 'b1', qty: '5', net_kg: '25', value: '100' }]]]);
    await postIn(manager, {
      companyId: 'c', locationId: 'l', productId: 'p', variantId: null, uomId: null, batchNo: 'B1', stockType: 'FRESH',
      qty: 5, kg: 25, value: 100, originType: 'GRN', movementType: 'INWARD_PURCHASE',
      doc: { type: 'inward-register', id: 'iw-1', no: 'IWD1' },
    });
    expect(calls[0].sql).toContain('(SELECT th.txn_no FROM "inward_register" th WHERE th.id = $15::uuid)');
    expect(calls[0].sql).toContain('origin_txn_no = COALESCE(stock_batch.origin_txn_no, EXCLUDED.origin_txn_no)');
    expect(calls[0].params[14]).toBe('iw-1');
    expect(calls[1].sql).toContain('(SELECT th.txn_no FROM "inward_register" th WHERE th.id = $25::uuid)');
    expect(calls[1].params).toHaveLength(25);
  });

  it('adjustments write no transaction number and bind no extra parameter', async () => {
    const { manager, calls } = fake([[/INSERT INTO stock_batch/, [{ id: 'b1', qty: '5', net_kg: '25', value: '100' }]]]);
    await postIn(manager, {
      companyId: 'c', locationId: 'l', productId: 'p', variantId: null, uomId: null, batchNo: 'B1', stockType: 'FRESH',
      qty: 5, kg: 25, value: 100, originType: 'ADJUSTMENT', movementType: 'ADJUSTMENT',
      doc: { type: 'stock-adjustment', id: 'adj-1', no: 'ADJ1' },
    });
    expect(calls[0].params).toHaveLength(14);
    expect(calls[1].params).toHaveLength(24);
    expect(calls[1].sql).toMatch(/\$24,\s*NULL\)/);
  });

  it('consumeDocument links the batch origin to the consuming DC per allocation', async () => {
    const { manager, calls } = fake([
      [/FROM stock_allocation WHERE doc_type/, [{ id: 'a1', line_id: 'i1', stock_batch_id: 'b1', qty: '4', net_kg: '20' }]],
      [/FROM stock_batch WHERE id = \$1 FOR UPDATE/, [{
        id: 'b1', company_id: 'c', location_id: 'l', product_id: 'p', variant_id: null, uom_id: null,
        batch_no: 'B1', stock_type: 'FRESH', qty: '10', net_kg: '50', value: '1000', unit_cost: '100',
      }]],
      [/RETURNING qty, net_kg, value/, [{ qty: '6', net_kg: '30', value: '600' }]],
    ]);
    await consumeDocument(manager, { docType: 'DC_TYPE_CUSTOMER', docId: 'dc-1', docNo: 'CN1', movementType: 'DC_CUSTOMER' });
    const link = calls.find((c) => c.sql.includes('INSERT INTO transaction_links'))!;
    expect(link.sql).toContain('"delivery_challan_purchase" h');
    expect(link.params).toEqual(['b1', 'dc-1', 'sold', 4, 20]);
    const ledger = calls.find((c) => c.sql.includes('INSERT INTO stock_ledger'))!;
    expect(ledger.params[24]).toBe('dc-1');
  });
});
