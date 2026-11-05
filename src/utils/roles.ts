import { Response } from 'express';
import { Role } from '../employee/entity/user.entity';

/**
 * Builds the stored role list: always EMPLOYEE, unknown values dropped,
 * and SUPER_ADMIN always brings ADMIN so every admin check also passes for a Super Admin.
 */
export const normalizeRoles = (input: unknown): Role[] => {
  const valid = Object.values(Role) as string[];
  const list = Array.isArray(input) ? input : [];
  const roles = new Set<Role>([Role.EMPLOYEE]);
  for (const r of list) {
    if (typeof r === 'string' && valid.includes(r)) roles.add(r as Role);
  }
  if (roles.has(Role.SUPER_ADMIN)) roles.add(Role.ADMIN);
  // Responsibilities are for standard users only; admins and Super Admins never hold them
  if (roles.has(Role.ADMIN)) RESPONSIBILITY_ROLES.forEach((r) => roles.delete(r));
  return Array.from(roles);
};

/** Roles a standard user can combine (verifier, approver, finalizer, payment manager). */
export const RESPONSIBILITY_ROLES: Role[] = [Role.VERIFIER, Role.APPROVER, Role.FINALIZER, Role.PAYMENT_MANAGER];

export const hasRole = (user: { roles?: string[] } | null | undefined, role: Role): boolean =>
  Array.isArray(user?.roles) && user!.roles!.includes(role);

export const isSuperAdmin = (user: { roles?: string[] } | null | undefined): boolean =>
  hasRole(user, Role.SUPER_ADMIN);

/** Super Admin check on the logged-in user (res.locals.user). */
export const isSuperAdminUser = (res: Response): boolean => isSuperAdmin(res.locals.user);

/** Records, edits and voids payments on GRNs and Final Invoices. Only this role; never admins. */
export const isPaymentManager = (user: { roles?: string[] } | null | undefined): boolean =>
  hasRole(user, Role.PAYMENT_MANAGER);
