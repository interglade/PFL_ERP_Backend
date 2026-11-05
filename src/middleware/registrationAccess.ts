import { NextFunction, Request, Response } from 'express';
import { EntityTarget, ObjectLiteral } from 'typeorm';
import AppError from '../utils/appError';
import { AppDataSource } from '../utils/data-source';
import { Role } from '../employee/entity/user.entity';
import { Status } from '../utils/status.enum';

/**
 * Who may edit a registration (vendor, farmer, customer): admins and verifiers always;
 * the creator only while it is not yet approved. Same rule as transporters, drivers and vehicles
 * (transportRegistration.service canModify).
 */
export const guardRegistrationEdit =
  (entity: EntityTarget<ObjectLiteral>, label: string) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = res.locals.user;
      const roles: string[] = Array.isArray(user?.roles) ? user.roles : [];
      if (roles.includes(Role.ADMIN) || roles.includes(Role.VERIFIER)) return next();

      const record = await AppDataSource.getRepository(entity).findOne({
        where: { id: req.params.id },
        relations: ['createdBy'],
      });
      if (!record) return next(); // the controller answers 404

      if (record.createdBy?.id !== user?.id) {
        return next(new AppError(403, `You can only edit ${label} records you created`));
      }
      if (record.status === Status.APPROVED) {
        return next(new AppError(403, `This ${label} is approved; only an admin or verifier can edit it`));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
