/**
 * Week bucketing for the weekly business-plan dashboard.
 *
 * These are the buckets both halves of every row land in: the plan's assigned
 * figure is matched to them by week number, and a GRN or invoice is counted in
 * the bucket its createdAt falls in. A boundary that is off by a millisecond or
 * a day silently moves a document into the wrong week, so the edges are pinned
 * here.
 */

import { weekWindowsForMonth } from '../../dashboard/service/weeklyBusinessPlan.service';
import { fromPlanMonth, toPlanMonth } from '../../utils/planMonth';

const day = (window: { start: Date; end: Date }) => [
  window.start.toISOString().slice(0, 10),
  window.end.toISOString().slice(0, 10),
];

describe('weekWindowsForMonth', () => {
  it('cuts a 31-day month into five weeks', () => {
    const weeks = weekWindowsForMonth(1, 2026); // January, 31 days

    expect(weeks).toHaveLength(5);
    expect(weeks.map(day)).toEqual([
      ['2026-01-01', '2026-01-07'],
      ['2026-01-08', '2026-01-14'],
      ['2026-01-15', '2026-01-21'],
      ['2026-01-22', '2026-01-28'],
      ['2026-01-29', '2026-01-31'],
    ]);
  });

  it('cuts a 30-day month into five weeks with a short last one', () => {
    const weeks = weekWindowsForMonth(4, 2026); // April, 30 days

    expect(weeks).toHaveLength(5);
    expect(day(weeks[4])).toEqual(['2026-04-29', '2026-04-30']);
  });

  it('gives a 28-day February exactly four weeks', () => {
    const weeks = weekWindowsForMonth(2, 2026);

    expect(weeks).toHaveLength(4);
    expect(day(weeks[3])).toEqual(['2026-02-22', '2026-02-28']);
  });

  it('gives a leap February a fifth week holding just the 29th', () => {
    const weeks = weekWindowsForMonth(2, 2028);

    expect(weeks).toHaveLength(5);
    expect(day(weeks[4])).toEqual(['2028-02-29', '2028-02-29']);
  });

  it('numbers the weeks from 1', () => {
    expect(weekWindowsForMonth(6, 2026).map((w) => w.weekNo)).toEqual([1, 2, 3, 4, 5]);
  });

  it('covers every moment of the month with no gap and no overlap', () => {
    const weeks = weekWindowsForMonth(3, 2026); // March, 31 days

    // The first week opens at the very start of the month...
    expect(weeks[0].start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    // ...and the last closes at the very end of it.
    expect(weeks[weeks.length - 1].end.toISOString()).toBe('2026-03-31T23:59:59.999Z');

    for (let i = 1; i < weeks.length; i++) {
      const gap = weeks[i].start.getTime() - weeks[i - 1].end.getTime();
      expect(`week ${i + 1} follows week ${i} by ${gap}ms`).toBe(
        `week ${i + 1} follows week ${i} by 1ms`,
      );
    }
  });

  it('handles December without rolling into the next year', () => {
    const weeks = weekWindowsForMonth(12, 2026);

    expect(weeks).toHaveLength(5);
    expect(day(weeks[4])).toEqual(['2026-12-29', '2026-12-31']);
  });

  it('handles January without rolling back into the previous year', () => {
    expect(day(weekWindowsForMonth(1, 2026)[0])).toEqual(['2026-01-01', '2026-01-07']);
  });
});

describe('toPlanMonth', () => {
  // The two plan tables number their months differently and both are live.
  // Reading procurement as 1-based made a request for July return the August
  // plan, which is what this guards against.

  it('shifts a procurement month down, because that table is 0-based', () => {
    expect(toPlanMonth(1, 'procurement')).toBe(0); // January
    expect(toPlanMonth(7, 'procurement')).toBe(6); // July
    expect(toPlanMonth(12, 'procurement')).toBe(11); // December
  });

  it('leaves a sales month alone, because that table is 1-based', () => {
    expect(toPlanMonth(1, 'sales')).toBe(1);
    expect(toPlanMonth(7, 'sales')).toBe(7);
    expect(toPlanMonth(12, 'sales')).toBe(12);
  });

  it('keeps the two conventions exactly one apart', () => {
    for (let month = 1; month <= 12; month++) {
      expect(toPlanMonth(month, 'sales') - toPlanMonth(month, 'procurement')).toBe(1);
    }
  });

  it('never lets a procurement month leak outside 0-11', () => {
    const stored = Array.from({ length: 12 }, (_, i) => toPlanMonth(i + 1, 'procurement'));
    expect(stored).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('fromPlanMonth', () => {
  it('reverses toPlanMonth for both tables', () => {
    for (let month = 1; month <= 12; month++) {
      expect(fromPlanMonth(toPlanMonth(month, 'procurement'), 'procurement')).toBe(month);
      expect(fromPlanMonth(toPlanMonth(month, 'sales'), 'sales')).toBe(month);
    }
  });

  it('reads a stored procurement month back as a human month', () => {
    expect(fromPlanMonth(0, 'procurement')).toBe(1); // stored 0 is January
    expect(fromPlanMonth(7, 'procurement')).toBe(8); // stored 7 is August
  });
});
