import { Response } from 'express';
import { Role } from '../employee/entity/user.entity';

/**
 * True when the logged-in user has the admin role. Roles are plain strings on
 * the user. Document lists use this to show admins every document instead of
 * only the ones the user created or approves.
 */
export const isAdminUser = (res: Response): boolean => {
  const roles: string[] = res.locals.user?.roles ?? [];
  return roles.includes(Role.ADMIN);
};
