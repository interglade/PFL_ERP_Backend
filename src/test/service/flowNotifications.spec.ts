/**
 * D-9 notifications: recipients (creator + approval-flow users) and the
 * transitions that send messages. D-4: which GRN statuses allow receiving.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Documentb } from '../../approvalFlow/entity/docuemnt.entity';
import { documentPeople, notifyApprovalTransition } from '../../notification/flowNotifications';
import { isGrnReceivableStatus } from '../../grn/grnApproval';

const flowDocument = {
  lastActionBy: { id: 'creator' },
  approvalFlow: {
    creator: { id: 'creator' },
    verifiers: [{ id: 'verifier' }],
    approvers: { firstApprover: { users: [{ id: 'a1' }] }, secondApprover: { users: [{ id: 'a2' }, { id: 'a1' }] }, thirdApprover: null },
    finalizers: { firstFinalizers: [{ id: 'f1' }], secondFinalizers: [] },
  },
};

const fakeDataSource = (queries: Array<[RegExp, unknown[]]>, document: unknown = flowDocument) => {
  const manager = {
    query: jest.fn(async (sql: string) => queries.find(([p]) => p.test(sql))?.[1] ?? []),
    getRepository: jest.fn((entity: unknown) => {
      if (entity !== Documentb) throw new Error('unexpected repository');
      return { findOne: jest.fn(async () => document) };
    }),
  };
  return { dataSource: { manager, query: manager.query } as unknown as DataSource, manager };
};

describe('receivable GRN statuses (client decision 2026-10-15)', () => {
  it('lets goods move only once the whole approval is complete', () => {
    expect(isGrnReceivableStatus('COMPLETE')).toBe(true);
    expect(['approved', 'FINALIZING', 'FINALIZED', 'hold', 'VERIFIED', 'REJECT', null].map(isGrnReceivableStatus)).toEqual(
      [false, false, false, false, false, false, false],
    );
  });
});

describe('D-9 flow notifications', () => {
  it('notifies the creator and every approval-flow user once each', async () => {
    const { manager } = fakeDataSource([]);
    expect((await documentPeople(manager as never, 'grn', 'g1')).sort()).toEqual(['a1', 'a2', 'creator', 'f1', 'verifier']);
  });

  it('tells the GRN people (not the actor) when a GRN completes its approval, and the pending dispatch people', async () => {
    const { dataSource } = fakeDataSource([
      [/FROM documents WHERE id/, [{ type: 'grn', status: 'COMPLETE', record_id: 'g1' }]],
      [/FROM grns/, [{ no: 'BR-00012' }]],
      [/FROM dispatch d WHERE d.grn_id/, [{ id: 'v1', no: 'VDP2610150001', status: 'hold' }]],
    ]);
    const notifier = { createBatchNoti: jest.fn(async () => undefined) };
    await notifyApprovalTransition(dataSource, notifier, 'doc1', 'FINALIZING', 'a1');
    expect(notifier.createBatchNoti).toHaveBeenCalledTimes(2);
    const [grnMessage, grnPeople] = (notifier.createBatchNoti.mock.calls as unknown as Array<[string, string[]]>)[0];
    expect(grnMessage).toContain('GRN BR-00012 has completed its approval');
    expect(grnPeople).not.toContain('a1');
    expect((notifier.createBatchNoti.mock.calls as unknown as Array<[string, string[]]>)[1][0]).toContain('dispatch VDP2610150001 can now be approved');
  });

  it('sends nothing when the status did not change', async () => {
    const { dataSource } = fakeDataSource([[/FROM documents WHERE id/, [{ type: 'grn', status: 'approved', record_id: 'g1' }]]]);
    const notifier = { createBatchNoti: jest.fn(async () => undefined) };
    await notifyApprovalTransition(dataSource, notifier, 'doc1', 'approved', 'a1');
    expect(notifier.createBatchNoti).not.toHaveBeenCalled();
  });

  it('tells the GRN people that an approved purchase dispatch is on the way', async () => {
    const { dataSource } = fakeDataSource([
      [/FROM documents WHERE id/, [{ type: 'vehicle-dispatch-register', status: 'COMPLETE', record_id: 'v1' }]],
      [/FROM dispatch d LEFT JOIN branches/, [{ no: 'VDP2610150001', type: 'purchase', grn_id: 'g1', dc_id: null, to_name: 'Satana CC' }]],
      [/FROM grns/, [{ no: 'BR-00012' }]],
    ]);
    const notifier = { createBatchNoti: jest.fn(async () => undefined) };
    await notifyApprovalTransition(dataSource, notifier, 'doc1', 'hold', 'x');
    expect((notifier.createBatchNoti.mock.calls as unknown as Array<[string, string[]]>)[0][0]).toBe(
      'Dispatch VDP2610150001 of GRN BR-00012 is approved and on the way to Satana CC: receive it in Arrivals',
    );
  });
});
