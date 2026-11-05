import { protectBody } from '../../middleware/protectBody';
import { checkPermission } from '../../middleware/checkPermission';
import { Role } from '../../employee/entity/user.entity';
import { requireRole } from '../../middleware/requireRole';
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
import { uploadSingle } from '../../middleware/uploadsingle.middleware';
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

  // ─── Excel (docs/master-data-excel-plan.md Phase 7) ───────────────────────

  @httpGet('/export/excel', checkPermission('drivers', 'export'))
  public async exportExcel(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const file = await this.driversService.exportToExcel(res.locals.user.id);
      ControllerLogger.logList('Driver Excel export', req, res);
      res.status(200).json({
        status: 'success',
        message: `${file.rowCount} driver(s) exported successfully`,
        data: { downloadUrl: file.downloadUrl, fileName: file.fileName, totalRecords: file.rowCount },
      });
    } catch (err) {
      ControllerLogger.logError('Driver Excel export', err, req, res);
      next(err);
    }
  }

  @httpGet('/download/template', checkPermission('drivers', 'create'))
  public async downloadExcelTemplate(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const file = await this.driversService.buildExcelTemplate();
      ControllerLogger.logList('Driver Excel template', req, res);
      res.status(200).json({
        status: 'success',
        message: 'Template ready',
        data: { downloadUrl: file.downloadUrl, fileName: file.fileName, totalRecords: 0 },
      });
    } catch (err) {
      ControllerLogger.logError('Driver Excel template', err, req, res);
      next(err);
    }
  }

  @httpPost('/upload', checkPermission('drivers', 'create'), uploadSingle.single('file'))
  public async uploadExcel(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const fileUrl = (req.file as any)?.location as string | undefined;
      if (!fileUrl) return next(new AppError(400, 'No file uploaded'));

      const summary = await this.driversService.importFromExcel(fileUrl, res.locals.user.id);
      ControllerLogger.logSuccess('Driver Excel uploaded', 'bulk', req, res);
      res.status(200).json({
        status: 'success',
        message:
          `${summary.created} driver(s) imported` +
          (summary.drafted ? `, ${summary.drafted} saved as draft` : '') +
          (summary.updated ? `, ${summary.updated} draft(s) completed` : '') +
          (summary.skipped.length ? `, ${summary.skipped.length} skipped` : '') +
          (summary.failed.length ? `, ${summary.failed.length} failed` : ''),
        data: summary,
      });
    } catch (err) {
      ControllerLogger.logError('Driver Excel upload', err, req, res);
      next(err);
    }
  }

  @httpPost('/', checkPermission('drivers', 'create'))
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

  @httpGet('/', checkPermission('drivers', 'view'))
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

  @httpGet('/view/:id', checkPermission('drivers', 'view'))
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

  @httpGet('/update/:id', checkPermission('drivers', 'edit'))
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
  @httpPatch('/submit/:id', checkPermission('drivers', 'create'))
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

  @httpPatch('/approve/:id', requireRole(Role.ADMIN, Role.VERIFIER))
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

  @httpPut('/:id', checkPermission('drivers', 'edit'), protectBody)
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

  @httpDelete('/delete/multiple', requireRole(Role.SUPER_ADMIN))
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

  @httpDelete('/:id', requireRole(Role.SUPER_ADMIN))
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
