/**
 * Mandatory vehicle dispatch per process step (src/vehicleDispatch/service/dispatchRules.ts):
 * the go-live rule and the gate used by receiving, mark arrived, final invoice and RBC.
 */

import 'reflect-metadata';

const sourceDocument = jest.fn();
const liveDispatch = jest.fn();

jest.mock('../../vehicleDispatch/service/dispatchSource', () => ({
  ...jest.requireActual('../../vehicleDispatch/service/dispatchSource'),
  DispatchSourceResolver: jest.fn().mockImplementation(() => ({ sourceDocument, liveDispatch })),
}));

import { EntityManager } from 'typeorm';
import { DispatchType } from '../../vehicleDispatch/entity/vehicleDispatch.entity';
import {
  assertDispatchGate,
  dispatchGate,
  dispatchGoLiveDate,
  dispatchRequiredSql,
  isDispatchRequired,
} from '../../vehicleDispatch/service/dispatchRules';

const manager = (row: Record<string, unknown> | null) =>
  ({ query: jest.fn().mockResolvedValue(row ? [row] : []) }) as unknown as EntityManager;

const source = (over: Record<string, unknown> = {}) => ({
  no: 'GRN-00031', created_at: new Date('2026-10-20T10:00:00'), deleted: false, direct_sale: false, ...over,
});

const dispatch = (status: string) => ({ id: 'd1', vehicleDispatchNo: 'VDP2610200001', documentId: 'doc1', status });

beforeEach(() => {
  delete process.env.DISPATCH_REQUIRED_FROM;
  sourceDocument.mockReset();
  liveDispatch.mockReset();
});

describe('go-live', () => {
  it('defaults to 2026-10-14 and honours a valid DISPATCH_REQUIRED_FROM', () => {
    expect(dispatchGoLiveDate()).toBe('2026-10-14');
    process.env.DISPATCH_REQUIRED_FROM = '2026-11-01';
    expect(dispatchGoLiveDate()).toBe('2026-11-01');
    process.env.DISPATCH_REQUIRED_FROM = 'soon';
    expect(dispatchGoLiveDate()).toBe('2026-10-14');
  });

  it('requires a dispatch for documents created on or after the go-live day (IST)', () => {
    expect(isDispatchRequired('2026-10-13T12:00:00+05:30')).toBe(false);
    expect(isDispatchRequired('2026-10-14T00:05:00+05:30')).toBe(true);
    expect(isDispatchRequired(new Date('2026-12-01T10:00:00Z'))).toBe(true);
  });

  it('builds a constant SQL boundary', () => {
    expect(dispatchRequiredSql('g."createdAt"')).toMatch(/^\(g\."createdAt"\) >= TIMESTAMP '2026-10-1[34] \d{2}:\d{2}:\d{2}'$/);
  });
});

describe('dispatchGate', () => {
  it('lists every reason: source not approved and dispatch missing', async () => {
    sourceDocument.mockResolvedValue({ status: 'hold' });
    liveDispatch.mockResolvedValue(null);
    const gate = await dispatchGate(manager(source()), DispatchType.PURCHASE, 'g1');
    expect(gate).toMatchObject({ required: true, sourceComplete: false, ready: false });
    expect(gate.reasons).toEqual(['GRN GRN-00031 is not approved yet', 'Purchase dispatch not created yet']);
  });

  it('waits for the dispatch approval, then is ready', async () => {
    sourceDocument.mockResolvedValue({ status: 'COMPLETE' });
    liveDispatch.mockResolvedValue(dispatch('hold'));
    const pending = await dispatchGate(manager(source()), DispatchType.PURCHASE, 'g1');
    expect(pending.reasons).toEqual(['Purchase dispatch VDP2610200001 is not approved yet']);

    liveDispatch.mockResolvedValue(dispatch('COMPLETE'));
    const ready = await dispatchGate(manager(source()), DispatchType.PURCHASE, 'g1');
    expect(ready).toMatchObject({ ready: true, reasons: [] });
  });

  it('does not require a dispatch before go-live or for a direct-sale customer DC', async () => {
    sourceDocument.mockResolvedValue({ status: 'COMPLETE' });
    liveDispatch.mockResolvedValue(null);
    const old = await dispatchGate(manager(source({ created_at: new Date('2026-09-01T10:00:00') })), DispatchType.PURCHASE, 'g1');
    expect(old).toMatchObject({ required: false, ready: true });

    const direct = await dispatchGate(manager(source({ no: 'DC-1', direct_sale: true })), DispatchType.SALES, 'dc1');
    expect(direct).toMatchObject({ required: false, ready: true });
  });

  it('404s for a missing or deleted source and 400s through assertDispatchGate', async () => {
    await expect(dispatchGate(manager(null), DispatchType.STOCK_TRANSFER, 'x')).rejects.toMatchObject({ statusCode: 404 });
    await expect(dispatchGate(manager(source({ deleted: true })), DispatchType.PURCHASE, 'x')).rejects.toMatchObject({ statusCode: 404 });

    sourceDocument.mockResolvedValue({ status: 'COMPLETE' });
    liveDispatch.mockResolvedValue(null);
    await expect(assertDispatchGate(manager(source()), DispatchType.PURCHASE, 'g1')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Cannot continue yet: Purchase dispatch not created yet',
    });
  });
});
