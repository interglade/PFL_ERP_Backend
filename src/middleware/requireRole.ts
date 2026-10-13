import { NextFunction, Request, Response } from 'express';
import AppError from '../utils/appError';
import { Role } from '../employee/entity/user.entity';

// Must run after deserializeUser (needs res.locals.user).
export const requireRole = (...allowed: Role[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user;

    if (!user) {
      return next(new AppError(401, 'You need to re-authenticate. Please log in.'));
    }

    const roles: Role[] = Array.isArray(user.roles) ? user.roles : [];
    if (!allowed.some((role) => roles.includes(role))) {
      return next(new AppError(403, 'Access denied. Admin only.'));
    }

    next();
  };
};
