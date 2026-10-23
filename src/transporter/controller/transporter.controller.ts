import { inject } from 'inversify';
import {
  controller,
  httpDelete,
  httpGet,
  httpPatch,
  httpPost,
  httpPut,
  next,
  request,
  requestParam,
  response,
} from 'inversify-express-utils';
import { NextFunction, Request, Response } from 'express';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import { Status } from '../../utils/status.enum';
import { ControllerLogger } from '../../utils/controllerLogger';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { readIds, readListOptions } from '../../transport/transport.query';
import { TransporterService } from '../service/transporter.service';
import { TRANSPORTER_FILTERS } from '../filters/transporter.filters';

@controller('/transporters', deserializeUser, requireUser)
export class TransporterController {
  constructor(
    @inject(TYPES.TransporterService)
    private readonly transporterService: TransporterService,
  ) {}

  @httpPost('/')
  public async createTransporter(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const transporter = await this.transporterService.create(req.body, res.locals.user.id);
      ControllerLogger.logSuccess('Transporter created', transporter.id, req, res);
      res.status(201).json({
        status: 'success',
        message:
          transporter.status === Status.DRAFT
            ? 'Transporter saved as draft'
            : 'Transporter registration submitted successfully',
        data: transporter.id,
      });
    } catch (err) {
      ControllerLogger.logError('Create Transporter', err, req, res);
      next(err);
    }
  }

  @httpGet('/')
  public async getAllTransporters(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const options = readListOptions(req, TRANSPORTER_FILTERS);
      const result = await this.transporterService.getAll(options, res.locals.user.id);
      ControllerLogger.logGetAllRecords('Transporters', req, res);
      res.status(200).json({
        status: 'success',
        data: result.data,
        allRecords: result.meta.total,
        totalPages: result.meta.pages,
        page: result.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Get All Transporters', err, req, res);
      next(err);
    }
  }

  /** Approved and pending transporters, for the vehicle / driver forms. */
  @httpGet('/filterData/filter/all')
  public async getTransporterPickerList(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const data = await this.transporterService.getPickerList();
      res.status(200).json({ status: 'success', data });
    } catch (err) {
      ControllerLogger.logError('Get Transporter picker list', err, req, res);
      next(err);
    }
  }

  @httpGet('/view/:id')
  public async getTransporterForView(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const transporter = await this.transporterService.getForView(id);
      if (!transporter) return next(new AppError(404, 'Transporter not found'));
      ControllerLogger.logView('Transporter', id, req, res);
      res.status(200).json({ status: 'success', data: transporter });
    } catch (err) {
      ControllerLogger.logError('Get Transporter for view', err, req, res);
      next(err);
    }
  }

  @httpGet('/update/:id')
  public async getTransporterForUpdate(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const transporter = await this.transporterService.getForUpdate(id);
      if (!transporter) return next(new AppError(404, 'Transporter not found'));
      ControllerLogger.logView('Transporter (for update)', id, req, res);
      res.status(200).json({ status: 'success', data: transporter });
    } catch (err) {
      ControllerLogger.logError('Get Transporter for update', err, req, res);
      next(err);
    }
  }

  /** Submits a draft (pending, or approved straight away for an admin / verifier). */
  @httpPatch('/submit/:id')
  public async submitTransporter(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const transporter = await this.transporterService.submit(id, req.body, res.locals.user.id);
      ControllerLogger.logSuccess('Transporter submitted', id, req, res);
      res.status(200).json({
        status: 'success',
        message: 'Transporter registration submitted successfully',
        data: { id: transporter.id, status: transporter.status },
      });
    } catch (err) {
      ControllerLogger.logError('Submit Transporter', err, req, res);
      next(err);
    }
  }

  @httpPatch('/approve/:id')
  public async approveTransporter(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const transporter = await this.transporterService.approve(id, res.locals.user.id, req.query.status as Status);
      ControllerLogger.logSuccess('Transporter approval', id, req, res);
      res.status(200).json({
        status: 'success',
        message:
          transporter.status === Status.APPROVED
            ? 'Transporter approved successfully'
            : 'Transporter rejected successfully',
        data: { id: transporter.id, status: transporter.status },
      });
    } catch (err) {
      ControllerLogger.logError('Approve Transporter', err, req, res);
      next(err);
    }
  }

  @httpPut('/:id')
  public async updateTransporter(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const transporter = await this.transporterService.update(id, req.body, res.locals.user.id);
      ControllerLogger.logSuccess('Transporter updated', id, req, res);
      res.status(200).json({
        status: 'success',
        message: 'Transporter updated successfully',
        data: { id: transporter.id, status: transporter.status },
      });
    } catch (err) {
      ControllerLogger.logError('Update Transporter', err, req, res);
      next(err);
    }
  }

  @httpDelete('/delete/multiple')
  public async deleteMultipleTransporters(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const ids = readIds(req);
      const result = await this.transporterService.softDelete(ids, res.locals.user.id);
      ControllerLogger.logSuccess('Transporters bulk deleted', ids.join(','), req, res);
      res.status(200).json({
        status: 'success',
        message: 'Transporters deleted successfully',
        affected: result.affected,
      });
    } catch (err) {
      ControllerLogger.logError('Transporter bulk deletion', err, req, res);
      next(err);
    }
  }

  @httpDelete('/:id')
  public async deleteTransporter(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      await this.transporterService.softDelete([id], res.locals.user.id);
      ControllerLogger.logSuccess('Transporter deleted', id, req, res);
      res.status(200).json({ status: 'success', message: 'Transporter deleted successfully' });
    } catch (err) {
      ControllerLogger.logError('Delete Transporter', err, req, res);
      next(err);
    }
  }
}
