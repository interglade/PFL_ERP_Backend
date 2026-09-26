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

  @httpGet('/:id')
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
  @httpGet('/')
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

  @httpPost('/')
  public async createPermission(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const data = req.body;
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
