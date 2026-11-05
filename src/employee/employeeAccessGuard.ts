import { In, Not } from 'typeorm';
import AppError from '../utils/appError';
import { AppDataSource } from '../utils/data-source';
import { EmployeeStatus, Role, User } from './entity/user.entity';
import { isSuperAdmin, normalizeRoles } from '../utils/roles';
import { hasAnyTick } from './employeePermissions';

/** The change an admin is about to make to one or more employees. */
export interface EmployeeChange {
  roles?: unknown;
  status?: string;
  permissions?: unknown;
  deleting?: boolean;
}

const definitionIdOf = (p: any): string | undefined =>
  typeof p?.documentDefinition === 'string' ? p.documentDefinition : p?.documentDefinition?.id;

/**
 * Guardrails for employee administration:
 *  - nobody changes their own roles, status or permissions, or deletes themselves
 *  - only a Super Admin grants / removes the Super Admin role or changes a Super Admin account
 *  - at least one active Super Admin always remains
 *  - only a Super Admin changes Delete ticks; for anyone else the saved ticks are kept
 *
 * Returns the permissions to save (Delete ticks restored when the actor is not a Super Admin).
 */
export async function assertEmployeeChangeAllowed(
  actor: User,
  targetIds: string[],
  change: EmployeeChange,
): Promise<unknown> {
  const repo = AppDataSource.getRepository(User);
  const actorIsSuperAdmin = isSuperAdmin(actor);
  const touchesAccess =
    change.roles !== undefined || change.status !== undefined || change.permissions !== undefined || !!change.deleting;

  if (touchesAccess && targetIds.includes(actor.id)) {
    throw new AppError(403, 'You cannot change your own roles, status or permissions, or delete your own account');
  }

  const targets = await repo.find({
    where: { id: In(targetIds) },
    relations: change.permissions !== undefined ? ['permissions', 'permissions.documentDefinition'] : [],
  });

  let removesSuperAdmin = false;
  for (const target of targets) {
    const wasSuperAdmin = isSuperAdmin(target);
    const willBeSuperAdmin =
      change.roles !== undefined ? normalizeRoles(change.roles).includes(Role.SUPER_ADMIN) : wasSuperAdmin;

    if (!actorIsSuperAdmin && (wasSuperAdmin || willBeSuperAdmin)) {
      throw new AppError(403, 'Only a Super Admin can grant the Super Admin role or change a Super Admin account');
    }

    const staysActive = change.status === undefined || change.status === EmployeeStatus.ACTIVE;
    if (wasSuperAdmin && (!willBeSuperAdmin || !staysActive || change.deleting)) {
      removesSuperAdmin = true;
    }
  }

  if (removesSuperAdmin) {
    const remaining = await repo
      .createQueryBuilder('e')
      .where(`:role = ANY(e.roles)`, { role: Role.SUPER_ADMIN })
      .andWhere('e.status = :active', { active: EmployeeStatus.ACTIVE })
      .andWhere(targetIds.length ? { id: Not(In(targetIds)) } : '1=1')
      .getCount();
    if (remaining === 0) {
      throw new AppError(400, 'At least one active Super Admin is required');
    }
  }

  // Delete ticks are granted by a Super Admin only; keep what was saved
  if (change.permissions !== undefined && Array.isArray(change.permissions) && !actorIsSuperAdmin) {
    const saved = new Map<string, boolean>();
    for (const p of targets[0]?.permissions ?? []) {
      if (p.documentDefinition?.id) saved.set(p.documentDefinition.id, !!p.canDelete);
    }
    return change.permissions.map((p: any) => ({
      ...p,
      canDelete: saved.get(definitionIdOf(p) ?? '') ?? false,
    }));
  }

  return change.permissions;
}

/**
 * A Standard User cannot be activated without any permission tick (docs/user-import-plan.md D4):
 * they would log in to an empty menu. Admins and Super Admins need no ticks. `roles` and
 * `permissions` are the values being saved with the activation, when the form sends them.
 */
export async function assertActivationAllowed(
  targetId: string,
  change: { status?: string; roles?: unknown; permissions?: unknown },
): Promise<void> {
  if (change.status !== EmployeeStatus.ACTIVE) return;
  const target = await AppDataSource.getRepository(User).findOne({
    where: { id: targetId },
    relations: ['permissions'],
  });
  if (!target || target.status === EmployeeStatus.ACTIVE) return;

  const roles = change.roles !== undefined ? normalizeRoles(change.roles) : target.roles ?? [];
  if (roles.includes(Role.ADMIN)) return;

  const permissions = Array.isArray(change.permissions) ? change.permissions : target.permissions ?? [];
  if (permissions.some(hasAnyTick)) return;

  throw new AppError(
    400,
    'This user has no permissions yet. Open the user, set Permission Configuration, then activate.',
  );
}

/**
 * Creating an employee: only a Super Admin creates a Super Admin or gives Delete ticks.
 * Returns the permissions to save.
 */
export function assertEmployeeCreateAllowed(actor: User, body: { roles?: unknown; permissions?: unknown }): unknown {
  if (isSuperAdmin(actor)) return body.permissions;
  if (normalizeRoles(body.roles).includes(Role.SUPER_ADMIN)) {
    throw new AppError(403, 'Only a Super Admin can create a Super Admin');
  }
  return Array.isArray(body.permissions)
    ? body.permissions.map((p: any) => ({ ...p, canDelete: false }))
    : body.permissions;
}
