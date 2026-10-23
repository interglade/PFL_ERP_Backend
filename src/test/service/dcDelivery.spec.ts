/**
 * Delivery confirmation rules (Phase D-1 / D-3): outcome, RBC must be approved,
 * invoice gate, undo permissions.
 */

import 'reflect-metadata';
import { EntityManager } from 'typeorm';

jest.mock('../../vehicleDispatch/service/dispatchRules', () => ({
  assertCustomerDcReady: jest.fn(async () => undefined),
}));

import { assertCustomerDcReady } from '../../vehicleDispatch/service/dispatchRules';
import { Documentb } from '../../approvalFlow/entity/docuemnt.entity';
import { DcDeliveryConfirmation } from '../../deliveryChallans/customerDeliveryChllan/entity/dcDeliveryConfirmation.entity';
import {
  assertDeliveryConfirmed,
  assertDeliveryNotConfirmed,
  confirmDelivery,
  deliveryStatus,
  undoDeliveryConfirmation,
} from '../../deliveryChallans/customerDeliveryChllan/service/dcDelivery';

interface World {
  rbc?: { id: string; no: string; status: string } | null;
  invoice?: { id: string; no: string; status: string } | null;
  confirmation?: Partial<DcDeliveryConfirmation> | null;
  dcApprovers?: string[];
}

const fakeManager = (world: World) => {
  const saved: unknown[] = [];
  const manager = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM delivery_challan_purchase dc WHERE dc.id')) {
        return [{ id: 'dc1', no: 'CN20261015C00001', type: 'customer', deleted: false, status: 'COMPLETE' }];
      }
      if (sql.includes('FROM return_by_customer rec')) return world.rbc ? [world.rbc] : [];
      if (sql.includes('FROM invoices rec')) return world.invoice ? [world.invoice] : [];
      if (sql.includes('SELECT id::text AS id FROM invoices')) return world.invoice ? [{ id: world.invoice.id }] : [];
      return [];
    }),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === DcDeliveryConfirmation) {
        return {
          findOne: jest.fn(async () => (world.confirmation ? { ...world.confirmation } : null)),
          create: (v: unknown) => v,
          save: jest.fn(async (v: unknown) => {
            saved.push(v);
            return v;
          }),
        };
      }
      if (entity === Documentb) {
        return {
          findOne: jest.fn(async () => ({
            approvalFlow: { approvers: { firstApprover: { users: (world.dcApprovers ?? []).map((id) => ({ id })) }, secondApprover: { users: [] } } },
          })),
        };
      }
      throw new Error('unexpected repository');
    }),
  } as unknown as EntityManager;
  return { manager, saved };
};

describe('delivery confirmation', () => {
  beforeEach(() => (assertCustomerDcReady as jest.Mock).mockClear());

  it('records "Delivered – no return" when the DC has no RBC', async () => {
    const { manager, saved } = fakeManager({});
    await confirmDelivery(manager, 'dc1', 'u1', { receiverName: ' Ramesh ' });
    expect(saved[0]).toMatchObject({ dcId: 'dc1', outcome: 'DELIVERED_NO_RETURN', rbcId: null, receiverName: 'Ramesh', confirmedBy: 'u1' });
  });

  it('records "Delivered – with return" and links the approved RBC', async () => {
    const { manager, saved } = fakeManager({ rbc: { id: 'r1', no: 'RBC2026101500003', status: 'COMPLETE' } });
    await confirmDelivery(manager, 'dc1', 'u1', {});
    expect(saved[0]).toMatchObject({ outcome: 'DELIVERED_WITH_RETURN', rbcId: 'r1', rbcNo: 'RBC2026101500003' });
  });

  it('refuses while the RBC is still awaiting approval', async () => {
    const { manager } = fakeManager({ rbc: { id: 'r1', no: 'RBC3', status: 'hold' } });
    await expect(confirmDelivery(manager, 'dc1', 'u1', {})).rejects.toThrow('Return By Customer RBC3 is awaiting approval');
  });

  it('refuses while the DC or its dispatch is not approved', async () => {
    (assertCustomerDcReady as jest.Mock).mockRejectedValueOnce(new Error('Cannot continue yet: Sales dispatch not created yet'));
    const { manager } = fakeManager({});
    await expect(confirmDelivery(manager, 'dc1', 'u1', {})).rejects.toThrow('Delivery cannot be confirmed: Sales dispatch not created yet');
  });

  it('gates the invoice on the confirmation and the RBC on its absence', async () => {
    await expect(assertDeliveryConfirmed(fakeManager({}).manager, 'dc1')).rejects.toThrow('Confirm the delivery of DC CN20261015C00001 before creating the Final Invoice');
    const confirmed = fakeManager({ confirmation: { dcId: 'dc1', outcome: 'DELIVERED_NO_RETURN', confirmedBy: 'u1' } }).manager;
    await expect(assertDeliveryConfirmed(confirmed, 'dc1')).resolves.toBeUndefined();
    await expect(assertDeliveryNotConfirmed(confirmed, 'dc1', 'raised')).rejects.toThrow('is already confirmed, so a Return By Customer cannot be raised');
  });

  it('lets only an approver of the DC undo, never the confirming user, and never once a live invoice exists', async () => {
    const confirmation = { id: 'c1', dcId: 'dc1', outcome: 'DELIVERED_NO_RETURN' as const, confirmedBy: 'u1', undoneAt: null };

    const byConfirmer = await deliveryStatus(fakeManager({ confirmation, dcApprovers: ['u1'] }).manager, 'dc1', 'u1');
    expect(byConfirmer.undoBlockedReason).toBe('The user who confirmed the delivery cannot undo it');

    const byStranger = await deliveryStatus(fakeManager({ confirmation, dcApprovers: ['a1'] }).manager, 'dc1', 'u9');
    expect(byStranger.canUndo).toBe(false);

    const byApprover = fakeManager({ confirmation, dcApprovers: ['a1'] });
    await expect(undoDeliveryConfirmation(byApprover.manager, 'dc1', 'a1', '')).rejects.toThrow('Give the reason');
    await undoDeliveryConfirmation(byApprover.manager, 'dc1', 'a1', 'Wrong DC confirmed');
    expect(byApprover.saved[0]).toMatchObject({ undoneBy: 'a1', undoReason: 'Wrong DC confirmed' });

    const invoiced = await deliveryStatus(
      fakeManager({ confirmation, dcApprovers: ['a1'], invoice: { id: 'i1', no: 'PF-2026-VSH-00001', status: 'hold' } }).manager,
      'dc1',
      'a1',
    );
    expect(invoiced.undoBlockedReason).toBe('Final Invoice PF-2026-VSH-00001 exists for this DC');
  });
});
