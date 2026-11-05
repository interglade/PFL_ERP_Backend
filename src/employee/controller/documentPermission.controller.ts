import { isSuperAdmin } from '../../utils/roles';
import { Role } from '../../employee/entity/user.entity';
import { requireRole } from '../../middleware/requireRole';
import {
  controller,
  httpGet,
  httpPost,
  next,
  request,
  response,
} from 'inversify-express-utils';

import { inject } from 'inversify';

import { NextFunction, Response, Request } from 'express';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { TYPES } from '../../types';
import { DocumentPermissionService } from '../service/documentPermission.service';
import AppError from '../../utils/appError';



@controller('/document-permission', deserializeUser, requireUser)
export class DocumentPermissionController {
  constructor(
    @inject(TYPES.DocumentPermissionService)
    readonly documentPermissionService: DocumentPermissionService,
  ) {}

  @httpGet('/:id', requireRole(Role.ADMIN))
  public async getDocumentPermissionWithId(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const documentId = req.params.id;
      const result =
        await this.documentPermissionService.getDocumentPermissionById(
          documentId,
        );
      if (!result) {
        return next(new AppError(404, 'Permission not found'));
      }
      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
  @httpGet('/', requireRole(Role.ADMIN))
  public async getAllDocumentPermissions(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const result =
        await this.documentPermissionService.getAllDocumentPermissions();
      if (!result) {
        return next(new AppError(404, 'Permissions not found'));
      }
      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  @httpPost('/', requireRole(Role.ADMIN))
  public async createPermission(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const data = req.body;
      // Delete is granted by a Super Admin only (same rule as the employee form)
      if (data && typeof data === 'object' && !isSuperAdmin(res.locals.user)) data.canDelete = false;
      const result =
        await this.documentPermissionService.createDocumentPermission(data);
        if(!result){
          return next(new AppError(404,'Permission not created'))
        }
      res.status(201).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
  
}
