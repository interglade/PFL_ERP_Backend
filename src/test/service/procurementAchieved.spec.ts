/**
 * Weekly roll-up of procurement actually done.
 *
 * `getTargetPerformance` used to read `procurement_achievements`, a table
 * nothing in the codebase ever writes to, so every "achieved" figure came back
 * as zero even for an employee with completed GRNs. It now counts the GRN lines
 * themselves, and this pins how a line is placed into a plan week.
 */

import {
  AchievedLine,
  sumAchievedInWeek,
} from '../../procurementTarget/service/procurementTarget.service';

const ONION = 'p-onion';
const DRAGON = 'p-dragon';

/** A GRN line received at the given local date/time. */
const line = (productId: string, netWeight: number, at: string): AchievedLine => ({
  productId,
  netWeight,
  amount: 0,
  at: new Date(at),
});

/** Plan weeks come out of the database as dates with no time on them. */
const week = (from: string, to: string) => [new Date(from), new Date(to)] as const;

describe('sumAchievedInWeek', () => {
  // The GRN that prompted this: raised 18 August, 700kg onion and 430kg
  // dragon fruit, on a plan cut into 7-day weeks.
  const grnLines = [
    line(ONION, 700, '2026-08-18T12:00:00'),
    line(DRAGON, 430, '2026-08-18T12:00:00'),
  ];

  const [w1From, w1To] = week('2026-08-01', '2026-08-07');
  const [w3From, w3To] = week('2026-08-15', '2026-08-21');

  it('puts a line in the week its date falls in', () => {
    expect(sumAchievedInWeek(grnLines, ONION, w3From, w3To)).toBe(700);
    expect(sumAchievedInWeek(grnLines, DRAGON, w3From, w3To)).toBe(430);
  });

  it('leaves the other weeks at zero', () => {
    expect(sumAchievedInWeek(grnLines, ONION, w1From, w1To)).toBe(0);
  });

  it('keeps products apart when a product is named', () => {
    // Asking for onion must not pick up the dragon fruit on the same GRN.
    expect(sumAchievedInWeek(grnLines, ONION, w3From, w3To)).not.toBe(1130);
  });

  it('counts every product in the week when no product is named', () => {
    // The week-wise view is a total: 430 dragon fruit + 700 onion. Matching
    // per planned product hid the 430 entirely, because dragon fruit was not
    // in the plan.
    expect(sumAchievedInWeek(grnLines, null, w3From, w3To)).toBe(1130);
  });

  it('still respects the week window when no product is named', () => {
    expect(sumAchievedInWeek(grnLines, null, w1From, w1To)).toBe(0);
  });

  it('counts an unplanned product in the week total', () => {
    const offPlan = [line('p-never-planned', 90, '2026-08-18T12:00:00')];
    expect(sumAchievedInWeek(offPlan, null, w3From, w3To)).toBe(90);
    expect(sumAchievedInWeek(offPlan, ONION, w3From, w3To)).toBe(0);
  });

  it('adds up several lines of the same product in one week', () => {
    const many = [
      line(ONION, 700, '2026-08-15T09:00:00'),
      line(ONION, 300, '2026-08-18T12:00:00'),
      line(ONION, 250, '2026-08-21T18:00:00'),
    ];
    expect(sumAchievedInWeek(many, ONION, w3From, w3To)).toBe(1250);
  });

  it('counts a line received late on the last day of the week', () => {
    // The plan stores the week end as a bare date. Comparing against it as-is
    // would drop everything received after midnight on that day.
    const late = [line(ONION, 500, '2026-08-21T23:30:00')];
    expect(sumAchievedInWeek(late, ONION, w3From, w3To)).toBe(500);
  });

  it('counts a line received first thing on the opening day', () => {
    const early = [line(ONION, 500, '2026-08-15T00:05:00')];
    expect(sumAchievedInWeek(early, ONION, w3From, w3To)).toBe(500);
  });

  it('excludes a line one day either side of the week', () => {
    const outside = [
      line(ONION, 100, '2026-08-14T23:59:00'),
      line(ONION, 100, '2026-08-22T00:01:00'),
    ];
    expect(sumAchievedInWeek(outside, ONION, w3From, w3To)).toBe(0);
  });

  it('returns zero rather than throwing when a week has no dates', () => {
    expect(sumAchievedInWeek(grnLines, ONION, null, w3To)).toBe(0);
    expect(sumAchievedInWeek(grnLines, ONION, w3From, null)).toBe(0);
  });

  it('returns zero for a target product that has no product attached', () => {
    // targetProduct.product can be null. An empty id is not the same as null:
    // it must match nothing, not everything.
    expect(sumAchievedInWeek(grnLines, '', w3From, w3To)).toBe(0);
  });
});
