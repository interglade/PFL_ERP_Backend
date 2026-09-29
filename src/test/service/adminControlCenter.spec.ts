import 'reflect-metadata';
import moment from 'moment-timezone';
import {
  IST,
  buildSeries,
  buckets,
  fyStart,
  parseFilters,
  pctChange,
  periodRange,
  contactRole,
  parseRoles,
  primaryRole,
  parseDepartments,
} from '../../adminControlCenter/service/accShared.util';
import {
  FlowDef,
  deriveStage,
  requiredApprovals,
  DOC_TYPES,
} from '../../adminControlCenter/service/accApprovalStage';
import { firstUncoveredAmount } from '../../adminControlCenter/service/accUsers.service';
import { referenceFromDescription } from '../../adminControlCenter/service/accOverview.service';

const at = (s: string) => moment.tz(s, 'YYYY-MM-DD HH:mm', IST);
const now = at('2026-09-28 11:05');

describe('admin control center - periods', () => {
  it('financial year starts on 1 April', () => {
    expect(fyStart(at('2026-09-28 10:00')).format('YYYY-MM-DD')).toBe('2026-04-01');
    expect(fyStart(at('2027-02-10 10:00')).format('YYYY-MM-DD')).toBe('2026-04-01');
    expect(fyStart(at('2026-04-01 00:00')).format('YYYY-MM-DD')).toBe('2026-04-01');
  });

  it('this-month charts every day, future days null', () => {
    const series = buildSeries('this-month', [{ day: '2026-09-02', a: 5 }], ['a'] as const, now);
    expect(series.labels).toHaveLength(30);
    expect(series.labels[0]).toBe('01 Sep');
    expect(series.a[0]).toBe(0);
    expect(series.a[1]).toBe(5);
    expect(series.a[27]).toBe(0); // today
    expect(series.a[28]).toBeNull();
  });

  it('this-year is always 12 FY months, null after the current month', () => {
    const series = buildSeries(
      'this-year',
      [
        { day: '2026-04-03', a: 1 },
        { day: '2026-04-20', a: 2 },
        { day: '2026-09-01', a: 4 },
      ],
      ['a'] as const,
      now,
    );
    expect(series.labels).toEqual(['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']);
    expect(series.a.slice(0, 7)).toEqual([3, 0, 0, 0, 0, 4, null]);
    expect(series.a.every((v, i) => (i > 5 ? v === null : v !== null))).toBe(true);
  });

  it('last-month covers the whole previous month', () => {
    const r = periodRange('last-month', now);
    expect(r.start.format('YYYY-MM-DD HH:mm')).toBe('2026-08-01 00:00');
    expect(r.end.format('YYYY-MM-DD HH:mm')).toBe('2026-09-01 00:00');
    expect(buckets(r, now)).toHaveLength(31);
  });

  it('this-quarter charts its three months', () => {
    const series = buildSeries('this-quarter', [], ['a'] as const, now);
    expect(series.labels).toEqual(['Jul', 'Aug', 'Sep']);
    expect(series.a).toEqual([0, 0, 0]);
  });

  it('parses filters, defaulting to this-month and all', () => {
    expect(parseFilters({})).toEqual({ period: 'this-month', location: null, company: null });
    expect(() => parseFilters({ period: 'yesterday' })).toThrow();
    expect(() => parseFilters({ location: 'nashik' })).toThrow();
  });

  it('percent change is signed with one decimal, 0 with nothing to compare', () => {
    expect(pctChange(108.4, 100)).toBe(8.4);
    expect(pctChange(90, 100)).toBe(-10);
    expect(pctChange(50, 0)).toBe(0);
  });
});

describe('admin control center - approval stage', () => {
  const flow: FlowDef = {
    verifiers: ['v1'],
    blocks: [
      { min: 0, max: 50000, users: ['a1'] },
      { min: 50000.01, max: 200000, users: ['a2'] },
      { min: 200000.01, max: null, users: ['a3'] },
    ],
    firstFinalizers: ['f1'],
    secondFinalizers: ['f2'],
  };
  const grn = { type: 'grn', status: 'hold', totalAmt: 10000, verified: false, a1: false, a2: false, a3: false };

  it('uses the amount band to decide how many approvers a GRN needs', () => {
    expect(requiredApprovals(flow, 10000)).toBe(1);
    expect(requiredApprovals(flow, 100000)).toBe(2);
    expect(requiredApprovals(flow, 500000)).toBe(3);
  });

  it('walks a GRN through verification, approvals and finalization', () => {
    expect(deriveStage(grn, flow)).toEqual({ stage: 'Verification', waitingOn: ['v1'] });
    const big = { ...grn, totalAmt: 500000, verified: true, status: 'VERIFIED' };
    expect(deriveStage(big, flow).stage).toBe('Approval L1');
    expect(deriveStage({ ...big, a1: true }, flow)).toEqual({ stage: 'Approval L2', waitingOn: ['a2'] });
    expect(deriveStage({ ...big, a1: true, a2: true }, flow).stage).toBe('Approval L3');
    expect(deriveStage({ ...grn, status: 'approved' }, flow)).toEqual({ stage: 'Finalization 1', waitingOn: ['f1'] });
    expect(deriveStage({ ...grn, status: 'FINALIZING' }, flow)).toEqual({ stage: 'Finalization 2', waitingOn: ['f2'] });
  });

  it('a 2-approver GRN never waits at L3', () => {
    const mid = { ...grn, totalAmt: 100000, verified: true, status: 'VERIFIED', a1: true, a2: true };
    expect(deriveStage(mid, flow).stage).toBe('Finalization 1');
  });

  it('final invoices wait on whichever of L1 / L2 has not acted', () => {
    const inv = { ...grn, type: 'final-invoice' };
    expect(deriveStage(inv, flow).stage).toBe('Approval L1');
    expect(deriveStage({ ...inv, a1: true }, flow).stage).toBe('Approval L2');
  });

  it('pipeline lists all 18 document types', () => {
    expect(DOC_TYPES).toHaveLength(18);
  });
});

describe('admin control center - setup gaps and formatting', () => {
  const block = (min: number | null, max: number | null) => ({ min, max, users: ['u'] });

  it('finds amount ranges no approver covers', () => {
    const base = { verifiers: ['v'], firstFinalizers: [], secondFinalizers: [] };
    expect(firstUncoveredAmount({ ...base, blocks: [block(0, 50000), block(50000.01, null), null] })).toBeNull();
    expect(firstUncoveredAmount({ ...base, blocks: [block(0, 50000), block(100000, null), null] })).toContain('₹50,000 - ₹1,00,000');
    expect(firstUncoveredAmount({ ...base, blocks: [block(0, 50000), null, null] })).toContain('above ₹50,000');
  });

  it('formats contact roles as position - department', () => {
    expect(contactRole('Employee', ['Procurement'])).toBe('Employee - Procurement');
    expect(contactRole('Approver', ['Procurement'], true)).toBe('Approver - Procurement TL');
    expect(primaryRole(parseRoles('{employee,approver}'))).toBe('Approver');
    expect(parseDepartments('procurement,operations')).toEqual(['Procurement', 'Operation']);
  });

  it('pulls a document number out of old log descriptions', () => {
    expect(referenceFromDescription('Anil has created GRN GRN-2026-0912')).toBe('GRN-2026-0912');
    expect(referenceFromDescription('Anil created farmer "Dnyaneshwar Kale" (FRM-001)')).toBe('FRM-001');
    expect(referenceFromDescription('Anil created customer "FreshMart"')).toBe('FreshMart');
  });
});
