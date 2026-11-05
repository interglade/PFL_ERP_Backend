import { Not, Repository } from 'typeorm';
import AppError from '../utils/appError';
import { ApprovalFlow } from './entity/approvalFlow.entity';

/** People of one approval flow, slot name → user ids. */
export interface FlowPeople {
  creatorId: string;
  type: string;
  slots: Record<string, string[]>;
}

export const APPROVER_SLOTS = [
  'firstApprover', 'secondApprover', 'thirdApprover', 'fourthApprover', 'fifthApprover', 'sixthApprover',
] as const;

const ids = (list: unknown): string[] =>
  Array.isArray(list) ? list.map((u: any) => (typeof u === 'string' ? u : u?.id)).filter(Boolean) : [];

/** People of a create / update payload (`users` and finalizer lists hold ids). */
export function flowPeopleFromInput(data: any): Record<string, string[]> {
  const slots: Record<string, string[]> = {};
  if (data?.verifiers !== undefined) slots.verifiers = ids(data.verifiers);
  for (const slot of APPROVER_SLOTS) {
    if (data?.approvers?.[slot] !== undefined) slots[slot] = ids(data.approvers[slot]?.users);
  }
  if (data?.finalizers?.firstFinalizers !== undefined) slots.firstFinalizers = ids(data.finalizers.firstFinalizers);
  if (data?.finalizers?.secondFinalizers !== undefined) slots.secondFinalizers = ids(data.finalizers.secondFinalizers);
  return slots;
}

/** People of a saved flow loaded with its blocks and users. */
export function flowPeopleFromEntity(flow: any): Record<string, string[]> {
  const slots: Record<string, string[]> = { verifiers: ids(flow?.verifiers) };
  for (const slot of APPROVER_SLOTS) slots[slot] = ids(flow?.approvers?.[slot]?.users);
  slots.firstFinalizers = ids(flow?.finalizers?.firstFinalizers);
  slots.secondFinalizers = ids(flow?.finalizers?.secondFinalizers);
  return slots;
}

/**
 * Configuration rules of an approval flow:
 *  - one flow per creator per process (type); otherwise the engine picks one at random
 *  - the creator is not in their own flow (no self-approval)
 *  - a person sits in one slot only (one person, one step; two slots would leave documents stuck)
 */
export async function assertValidFlow(
  repo: Repository<ApprovalFlow>,
  people: FlowPeople,
  excludeFlowId?: string,
): Promise<void> {
  const duplicate = await repo.findOne({
    where: {
      creator: { id: people.creatorId },
      type: people.type as any,
      ...(excludeFlowId ? { id: Not(excludeFlowId) } : {}),
    },
  });
  if (duplicate) {
    throw new AppError(400, `This employee already has a ${people.type} approval flow`);
  }

  assertFlowPeopleValid(people.creatorId, people.slots);
}

const amount = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);

/**
 * Amount bands of the approvers in a payload: amounts are numbers, not negative,
 * and the maximum is not below the minimum.
 */
export function assertAmountBandsValid(approvers: any): void {
  for (const slot of APPROVER_SLOTS) {
    const block = approvers?.[slot];
    if (!block) continue;
    const min = amount(block.minAmtCanApprove);
    const max = amount(block.maxAmtCanApprove);
    for (const value of [min, max]) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        throw new AppError(400, 'Approval amounts must be numbers that are not negative');
      }
    }
    if (min !== null && max !== null && max < min) {
      throw new AppError(400, 'The maximum amount an approver can approve cannot be less than their minimum amount');
    }
  }
}

/** The creator is not in their own flow, and a person sits in one slot only. */
export function assertFlowPeopleValid(creatorId: string, slots: Record<string, string[]>): void {
  const seen = new Map<string, string>();
  for (const [slot, users] of Object.entries(slots)) {
    for (const userId of new Set(users)) {
      if (userId === creatorId) {
        throw new AppError(400, 'The creator cannot be a verifier, approver or finalizer in their own approval flow');
      }
      const other = seen.get(userId);
      if (other && other !== slot) {
        throw new AppError(400, 'A person can hold only one step in an approval flow');
      }
      seen.set(userId, slot);
    }
  }
}
