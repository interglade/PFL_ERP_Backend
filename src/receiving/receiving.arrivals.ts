/**
 * Arrivals list — pure planning helpers (Phase D-7).
 *
 * The list is built in two phases: phase 1 filters and sorts on cheap base
 * columns and yields the ordered source keys; phase 2 computes the expensive
 * per-source status (slots, kg, dispatch) for the visible page only.
 *
 * The receiving `state` is partly known in SQL (`sqlStateExpr`): `in-transit`,
 * `received` and, while a step is unfinished, `in-progress` are exact there. A
 * source whose every step is approved (or skipped) has `sql_state = NULL`: done
 * or in-progress then needs the per-product kg matching of the status service.
 * The plan says whether a state filter can be answered by SQL alone.
 */

import { ReceivingState, SkipFlags, SlotState } from './receiving.types';

/** States that only the status service can tell apart once every step is approved. */
const UNRESOLVED_STATES: ReceivingState[] = ['In Progress', 'Done'];

export interface StateFilterPlan {
  /** No filter on state. */
  any: boolean;
  /** The filter can never match (only `Not Received`, which the list never holds). */
  none: boolean;
  /** States requested, `Not Received` removed. */
  states: ReceivingState[];
  /** Rows with `sql_state IS NULL` may match and must be kept by SQL. */
  includeUnresolved: boolean;
  /** Unresolved rows must be classified by the status service before paging. */
  needsCompute: boolean;
}

export function normaliseStates(value: ReceivingState | ReceivingState[] | null | undefined): ReceivingState[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(new Set(list));
}

export function planStateFilter(value: ReceivingState | ReceivingState[] | null | undefined): StateFilterPlan {
  const requested = normaliseStates(value);
  if (!requested.length) return { any: true, none: false, states: [], includeUnresolved: true, needsCompute: false };
  // The list only contains Complete sources, so `Not Received` never matches.
  const states = requested.filter((s) => s !== 'Not Received');
  if (!states.length) return { any: false, none: true, states, includeUnresolved: false, needsCompute: false };
  const unresolvedStates = states.filter((s) => UNRESOLVED_STATES.includes(s));
  const includeUnresolved = unresolvedStates.length > 0;
  // Both states an unresolved source can have are wanted: no need to tell them apart.
  const needsCompute = includeUnresolved && unresolvedStates.length < UNRESOLVED_STATES.length;
  return { any: false, none: false, states, includeUnresolved, needsCompute };
}

/** SQL condition on the `sql_state` column for a plan; `stateParam` is the bound `text[]` of `plan.states`. */
export function stateConditionSql(plan: StateFilterPlan, stateParam: string): string | null {
  if (plan.any) return null;
  if (plan.none) return 'FALSE';
  const known = `sql_state = ANY(${stateParam}::text[])`;
  return plan.includeUnresolved ? `(sql_state IS NULL OR ${known})` : known;
}

/** Slot chip with the "not needed" mark: a missing (or rejected) Dump / RTV that was skipped shows `Skipped`. */
export function slotWithSkip(state: SlotState, skipped: boolean): SlotState {
  if (skipped && (state === 'Missing' || state === 'Rejected')) return 'Skipped';
  return state;
}

export const NO_SKIPS: SkipFlags = Object.freeze({ dump: false, rtv: false }) as SkipFlags;

/** Splits a list into chunks of `size`. */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
