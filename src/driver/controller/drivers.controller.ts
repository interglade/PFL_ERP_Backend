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
import { DriversService } from '../service/driver.service';
import { DRIVER_FILTERS } from '../filters/driver.filters';

@controller('/drivers', deserializeUser, requireUser)
export class DriverController {
  constructor(
    @inject(TYPES.DriversService)
    private readonly driversService: DriversService,
  ) {}

  @httpPost('/')
  public async createDriver(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const driver = await this.driversService.create(req.body, res.locals.user.id);
      ControllerLogger.logSuccess('Driver created', driver.id, req, res);
      res.status(201).json({
        status: 'success',
        message:
          driver.status === Status.DRAFT ? 'Driver saved as draft' : 'Driver registration submitted successfully',
        data: driver.id,
      });
    } catch (err) {
      ControllerLogger.logError('Create Driver', err, req, res);
      next(err);
    }
  }

  @httpGet('/')
  public async getAllDrivers(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const options = readListOptions(req, DRIVER_FILTERS);
      const result = await this.driversService.getAll(options, res.locals.user.id);
      ControllerLogger.logGetAllRecords('Drivers', req, res);
      res.status(200).json({
        status: 'success',
        data: result.data,
        allRecords: result.meta.total,
        totalPages: result.meta.pages,
        page: result.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Get All Drivers', err, req, res);
      next(err);
    }
  }

  /**
   * Approved and pending drivers. `?transporterId=` narrows to one transporter's
   * drivers; add `includeFree=true` to include the independent ones too.
   */
  @httpGet('/filterData/filter/all')
  public async getDriverPickerList(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const transporterId = typeof req.query.transporterId === 'string' ? req.query.transporterId : undefined;
      const includeFree = String(req.query.includeFree ?? '').toLowerCase() === 'true';
      const data = await this.driversService.getPickerList(transporterId, includeFree);
      res.status(200).json({ status: 'success', data });
    } catch (err) {
      ControllerLogger.logError('Get Driver picker list', err, req, res);
      next(err);
    }
  }

  /** Duplicate check for the form: the driver registered with this phone, or `data: null`. */
  @httpGet('/by-phone/:phone')
  public async lookupDriverByPhone(
    @requestParam('phone') phone: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const data = await this.driversService.lookupByPhone(phone);
      res.status(200).json({ status: 'success', data });
    } catch (err) {
      ControllerLogger.logError('Lookup Driver by phone', err, req, res);
      next(err);
    }
  }

  @httpGet('/view/:id')
  public async getDriverForView(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const driver = await this.driversService.getForView(id);
      if (!driver) return next(new AppError(404, 'Driver not found'));
      ControllerLogger.logView('Driver', id, req, res);
      res.status(200).json({ status: 'success', data: driver });
    } catch (err) {
      ControllerLogger.logError('Get Driver for view', err, req, res);
      next(err);
    }
  }

  @httpGet('/update/:id')
  public async getDriverForUpdate(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const driver = await this.driversService.getForUpdate(id);
      if (!driver) return next(new AppError(404, 'Driver not found'));
      ControllerLogger.logView('Driver (for update)', id, req, res);
      res.status(200).json({ status: 'success', data: driver });
    } catch (err) {
      ControllerLogger.logError('Get Driver for update', err, req, res);
      next(err);
    }
  }

  /** Submits a draft (pending, or approved straight away for an admin / verifier). */
  @httpPatch('/submit/:id')
  public async submitDriver(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const driver = await this.driversService.submit(id, req.body, res.locals.user.id);
      ControllerLogger.logSuccess('Driver submitted', id, req, res);
      res.status(200).json({
        status: 'success',
        message: 'Driver registration submitted successfully',
        data: { id: driver.id, status: driver.status },
      });
    } catch (err) {
      ControllerLogger.logError('Submit Driver', err, req, res);
      next(err);
    }
  }

  @httpPatch('/approve/:id')
  public async approveDriver(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const driver = await this.driversService.approve(id, res.locals.user.id, req.query.status as Status);
      ControllerLogger.logSuccess('Driver approval', id, req, res);
      res.status(200).json({
        status: 'success',
        message: driver.status === Status.APPROVED ? 'Driver approved successfully' : 'Driver rejected successfully',
        data: { id: driver.id, status: driver.status },
      });
    } catch (err) {
      ControllerLogger.logError('Approve Driver', err, req, res);
      next(err);
    }
  }

  @httpPut('/:id')
  public async updateDriver(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const driver = await this.driversService.update(id, req.body, res.locals.user.id);
      ControllerLogger.logSuccess('Driver updated', id, req, res);
      res.status(200).json({
        status: 'success',
        message: 'Driver updated successfully',
        data: { id: driver.id, status: driver.status },
      });
    } catch (err) {
      ControllerLogger.logError('Update Driver', err, req, res);
      next(err);
    }
  }

  @httpDelete('/delete/multiple')
  public async deleteMultipleDrivers(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const ids = readIds(req);
      const result = await this.driversService.softDelete(ids, res.locals.user.id);
      ControllerLogger.logSuccess('Drivers bulk deleted', ids.join(','), req, res);
      res.status(200).json({
        status: 'success',
        message: 'Drivers deleted successfully',
        affected: result.affected,
      });
    } catch (err) {
      ControllerLogger.logError('Driver bulk deletion', err, req, res);
      next(err);
    }
  }

  @httpDelete('/:id')
  public async deleteDriver(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      await this.driversService.softDelete([id], res.locals.user.id);
      ControllerLogger.logSuccess('Driver deleted', id, req, res);
      res.status(200).json({ status: 'success', message: 'Driver deleted successfully' });
    } catch (err) {
      ControllerLogger.logError('Delete Driver', err, req, res);
      next(err);
    }
  }
}
