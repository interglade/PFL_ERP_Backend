/**
 * Receiving ↔ Vehicle Dispatch (src/receiving/receiving.dispatch.ts): the dispatch
 * state, attaching a dispatch to a computed receiving status, and the SQL used by
 * the Arrivals list.
 */

import 'reflect-metadata';

import { attachDispatch, dispatchReadySql, dispatchStateOf, dispatchStateSql } from '../../receiving/receiving.dispatch';
import { DispatchSummary, ReceivingSourceStatus } from '../../receiving/receiving.types';

const summary = (arrivedAt: string | null = null): DispatchSummary => ({
  id: 'd1', dispatchNo: 'VDP2610130001', documentId: 'doc1', status: 'hold',
  vehicleNo: 'MH12AB1234', vehicleType: 'Pickup', driverName: 'Raju', driverMobNo: '9800000000',
  transporterName: null, outTime: '09:30:00', reachingTime: null, arrivedAt, netWeightKg: 1500,
});

const status = (source: Partial<ReceivingSourceStatus['source']> = {}): ReceivingSourceStatus =>
  ({
    source: { type: 'grn', no: 'GRN-00031', isComplete: true, date: '2026-10-20T10:00:00', ...source },
    products: [
      { key: 'p1:null:u-kg', productId: 'p1', variantId: null, receivedKg: 1000 },
      { key: 'p2:v1:u-kg', productId: 'p2', variantId: 'v1', receivedKg: 500 },
    ],
    dispatch: null,
    dispatchState: 'none',
  }) as unknown as ReceivingSourceStatus;

describe('dispatchStateOf', () => {
  it('none without a dispatch, in-transit until marked arrived, then arrived', () => {
    expect(dispatchStateOf(null)).toBe('none');
    expect(dispatchStateOf(summary())).toBe('in-transit');
    expect(dispatchStateOf(summary('2026-10-13T09:00:00Z'))).toBe('arrived');
  });
});

describe('attachDispatch', () => {
  it('sets the summary, the state and each product dispatched kg', () => {
    const result = attachDispatch(status(), { summary: summary(), kgByKey: new Map([['p1:null:u-kg', 980]]) });
    expect(result.dispatch?.dispatchNo).toBe('VDP2610130001');
    expect(result.dispatchState).toBe('in-transit');
    expect(result.products[0].dispatchedKg).toBe(980);
    // A product the dispatch did not carry has no dispatched kg.
    expect(result.products[1].dispatchedKg).toBeNull();
  });

  it('clears everything when the source has no live dispatch', () => {
    const result = attachDispatch(status(), undefined);
    expect(result.dispatch).toBeNull();
    expect(result.dispatchState).toBe('none');
    expect(result.products.every((p) => p.dispatchedKg === null)).toBe(true);
  });
});

describe('attachDispatch readiness (dispatch-enforcement D3)', () => {
  const approved = (): DispatchSummary => ({ ...summary(), status: 'COMPLETE' });

  it('blocks a GRN created since go-live until its purchase dispatch exists and is approved', () => {
    expect(attachDispatch(status(), undefined)).toMatchObject({
      dispatchRequired: true, canReceive: false, blockers: ['Purchase dispatch not created yet'],
    });
    expect(attachDispatch(status(), { summary: summary(), kgByKey: new Map() })).toMatchObject({
      canReceive: false, blockers: ['Purchase dispatch VDP2610130001 is not approved yet'],
    });
    expect(attachDispatch(status(), { summary: approved(), kgByKey: new Map() })).toMatchObject({ canReceive: true, blockers: [] });
  });

  it('reports a source that is not approved yet', () => {
    const result = attachDispatch(status({ isComplete: false }), { summary: approved(), kgByKey: new Map() });
    expect(result.canReceive).toBe(false);
    expect(result.blockers).toEqual(['GRN GRN-00031 is not approved yet']);
  });

  it('uses the stock transfer dispatch for transfer DCs', () => {
    const result = attachDispatch(status({ type: 'stock-transfer-dc', no: 'STDC-1' }), undefined);
    expect(result.blockers).toEqual(['Stock transfer dispatch not created yet']);
  });

  it('does not require a dispatch for returns or for sources created before go-live', () => {
    expect(attachDispatch(status({ type: 'rbc' }), undefined)).toMatchObject({ dispatchRequired: false, canReceive: true });
    expect(attachDispatch(status({ date: '2026-09-01T10:00:00' }), undefined)).toMatchObject({ dispatchRequired: false, canReceive: true });
  });
});

describe('dispatchReadySql', () => {
  it('needs a live dispatch with a COMPLETE approval, only for sources created since go-live', () => {
    const sql = dispatchReadySql('g.id', 'g."createdAt"', 'grn');
    expect(sql).toContain('rl_rd."grn_id" = g.id');
    expect(sql).toContain(`= 'COMPLETE'`);
    expect(sql).toMatch(/CASE WHEN \(g\."createdAt"\) >= TIMESTAMP '2026-10-1[34] \d{2}:\d{2}:\d{2}' THEN/);
    expect(dispatchReadySql('r.id', 'r."createdAt"', 'rbc')).toBe('TRUE');
  });
});

describe('dispatchStateSql', () => {
  it('looks at the purchase dispatch of a GRN, ignoring deleted and rejected ones', () => {
    const sql = dispatchStateSql('g.id', 'grn');
    expect(sql).toContain('rl_vd."grn_id" = g.id');
    expect(sql).toContain(`rl_vd."dispatchType"::text = 'purchase'`);
    expect(sql).toContain('rl_vd."deletedAt" IS NULL');
    expect(sql).toContain(`status::text = 'REJECT'`);
    expect(sql).toContain(`'arrived' ELSE 'in-transit'`);
  });

  it('uses the stock transfer dispatch for a transfer DC', () => {
    const sql = dispatchStateSql('dc.id', 'stock-transfer-dc');
    expect(sql).toContain('rl_vd."delivery_challan_id" = dc.id');
    expect(sql).toContain(`'stock-transfer'`);
  });

  it('is a NULL literal for a return by customer (no dispatch exists)', () => {
    expect(dispatchStateSql('r.id', 'rbc')).toBe('NULL::text');
  });
});
