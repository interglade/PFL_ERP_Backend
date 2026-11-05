/**
 * Month numbering of the two business-plan tables.
 *
 * Both store the month 0-BASED - January 0 ... December 11 - because both plan
 * forms send the value of the shared MONTH dropdown (sharedStaticData.MONTH,
 * January = 0) unchanged:
 *
 *   procurement_targets.month  formats with `monthNames[target.month]`, guard 0..11
 *   sales_targets.month        formats with `monthNames[target.month]`, guard 0..11
 *
 * (An earlier version of this file said sales was 1-based. It never was: a
 * November sales plan is stored as 10, and reading it with 11 finds nothing,
 * which showed as "sales plan missing" and zero planned sales.)
 *
 * Anything that takes a month from a caller should take it as 1-12 - that is
 * what a person types and what every other date API uses - and convert here
 * before it touches the database.
 */

export type PlanKind = 'procurement' | 'sales';

/** Converts a 1-12 month into the number the plan table stores. */
export function toPlanMonth(month: number, _plan: PlanKind): number {
  return month - 1;
}

/** Converts a stored plan month back to 1-12, for display or for comparison. */
export function fromPlanMonth(storedMonth: number, _plan: PlanKind): number {
  return storedMonth + 1;
}
