/**
 * Month numbering for the two business-plan tables.
 *
 * They disagree, and both are live:
 *
 *   procurement_targets.month  is 0-BASED - January 0 ... December 11
 *   sales_targets.month        is 1-BASED - January 1 ... December 12
 *
 * Each module's own read path confirms it. Procurement formats its month name
 * with `monthNames[target.month]` and guards the value with `>= 0 && <= 11`;
 * sales uses `monthNames[target.month - 1]` guarded with `>= 1 && <= 12`.
 *
 * Anything that takes a month from a caller should take it as 1-12 - that is
 * what a person types and what every other date API uses - and convert here
 * before it touches the database. Querying procurement with a 1-12 month reads
 * the following month's plan, which looks exactly like "no plan found".
 */

export type PlanKind = 'procurement' | 'sales';

/** Converts a 1-12 month into the number the plan table stores. */
export function toPlanMonth(month: number, plan: PlanKind): number {
  return plan === 'procurement' ? month - 1 : month;
}

/** Converts a stored plan month back to 1-12, for display or for comparison. */
export function fromPlanMonth(storedMonth: number, plan: PlanKind): number {
  return plan === 'procurement' ? storedMonth + 1 : storedMonth;
}
