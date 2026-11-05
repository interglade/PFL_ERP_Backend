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
import { VehicleService } from '../service/vehicle.service';
import { VEHICLE_FILTERS } from '../filters/vehicle.filters';

@controller('/vehicles', deserializeUser, requireUser)
export class VehicleController {
  constructor(
    @inject(TYPES.VehicleService)
    private readonly vehicleService: VehicleService,
  ) {}

  // ─── Excel (docs/master-data-excel-plan.md Phase 7) ───────────────────────

  @httpGet('/export/excel', checkPermission('vehicles', 'export'))
  public async exportExcel(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const file = await this.vehicleService.exportToExcel(res.locals.user.id);
      ControllerLogger.logList('Vehicle Excel export', req, res);
      res.status(200).json({
        status: 'success',
        message: `${file.rowCount} vehicle(s) exported successfully`,
        data: { downloadUrl: file.downloadUrl, fileName: file.fileName, totalRecords: file.rowCount },
      });
    } catch (err) {
      ControllerLogger.logError('Vehicle Excel export', err, req, res);
      next(err);
    }
  }

  @httpGet('/download/template', checkPermission('vehicles', 'create'))
  public async downloadExcelTemplate(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const file = await this.vehicleService.buildExcelTemplate();
      ControllerLogger.logList('Vehicle Excel template', req, res);
      res.status(200).json({
        status: 'success',
        message: 'Template ready',
        data: { downloadUrl: file.downloadUrl, fileName: file.fileName, totalRecords: 0 },
      });
    } catch (err) {
      ControllerLogger.logError('Vehicle Excel template', err, req, res);
      next(err);
    }
  }

  @httpPost('/upload', checkPermission('vehicles', 'create'), uploadSingle.single('file'))
  public async uploadExcel(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const fileUrl = (req.file as any)?.location as string | undefined;
      if (!fileUrl) return next(new AppError(400, 'No file uploaded'));

      const summary = await this.vehicleService.importFromExcel(fileUrl, res.locals.user.id);
      ControllerLogger.logSuccess('Vehicle Excel uploaded', 'bulk', req, res);
      res.status(200).json({
        status: 'success',
        message:
          `${summary.created} vehicle(s) imported` +
          (summary.drafted ? `, ${summary.drafted} saved as draft` : '') +
          (summary.updated ? `, ${summary.updated} draft(s) completed` : '') +
          (summary.skipped.length ? `, ${summary.skipped.length} skipped` : '') +
          (summary.failed.length ? `, ${summary.failed.length} failed` : ''),
        data: summary,
      });
    } catch (err) {
      ControllerLogger.logError('Vehicle Excel upload', err, req, res);
      next(err);
    }
  }

  @httpPost('/', checkPermission('vehicles', 'create'))
  public async createVehicle(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const vehicle = await this.vehicleService.create(req.body, res.locals.user.id);
      ControllerLogger.logSuccess('Vehicle created', vehicle.id, req, res);
      res.status(201).json({
        status: 'success',
        message:
          vehicle.status === Status.DRAFT ? 'Vehicle saved as draft' : 'Vehicle registration submitted successfully',
        data: vehicle.id,
      });
    } catch (err) {
      ControllerLogger.logError('Create Vehicle', err, req, res);
      next(err);
    }
  }

  @httpGet('/', checkPermission('vehicles', 'view'))
  public async getAllVehicles(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const options = readListOptions(req, VEHICLE_FILTERS);
      const result = await this.vehicleService.getAll(options, res.locals.user.id);
      ControllerLogger.logGetAllRecords('Vehicles', req, res);
      res.status(200).json({
        status: 'success',
        data: result.data,
        allRecords: result.meta.total,
        totalPages: result.meta.pages,
        page: result.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Get All Vehicles', err, req, res);
      next(err);
    }
  }

  /** Approved and pending vehicles; `?transporterId=` narrows to one transporter. */
  @httpGet('/filterData/filter/all')
  public async getVehiclePickerList(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const transporterId = typeof req.query.transporterId === 'string' ? req.query.transporterId : undefined;
      const data = await this.vehicleService.getPickerList(transporterId);
      res.status(200).json({ status: 'success', data });
    } catch (err) {
      ControllerLogger.logError('Get Vehicle picker list', err, req, res);
      next(err);
    }
  }

  /** Duplicate check for the form: the vehicle registered under this plate, or `data: null`. */
  @httpGet('/by-number/:vehicleNo')
  public async lookupVehicleByNumber(
    @requestParam('vehicleNo') vehicleNo: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const data = await this.vehicleService.lookupByNumber(vehicleNo);
      res.status(200).json({ status: 'success', data });
    } catch (err) {
      ControllerLogger.logError('Lookup Vehicle by number', err, req, res);
      next(err);
    }
  }

  @httpGet('/view/:id', checkPermission('vehicles', 'view'))
  public async getVehicleForView(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const vehicle = await this.vehicleService.getForView(id);
      if (!vehicle) return next(new AppError(404, 'Vehicle not found'));
      ControllerLogger.logView('Vehicle', id, req, res);
      res.status(200).json({ status: 'success', data: vehicle });
    } catch (err) {
      ControllerLogger.logError('Get Vehicle for view', err, req, res);
      next(err);
    }
  }

  @httpGet('/update/:id', checkPermission('vehicles', 'edit'))
  public async getVehicleForUpdate(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const vehicle = await this.vehicleService.getForUpdate(id);
      if (!vehicle) return next(new AppError(404, 'Vehicle not found'));
      ControllerLogger.logView('Vehicle (for update)', id, req, res);
      res.status(200).json({ status: 'success', data: vehicle });
    } catch (err) {
      ControllerLogger.logError('Get Vehicle for update', err, req, res);
      next(err);
    }
  }

  /** Submits a draft (pending, or approved straight away for an admin / verifier). */
  @httpPatch('/submit/:id', checkPermission('vehicles', 'create'))
  public async submitVehicle(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const vehicle = await this.vehicleService.submit(id, req.body, res.locals.user.id);
      ControllerLogger.logSuccess('Vehicle submitted', id, req, res);
      res.status(200).json({
        status: 'success',
        message: 'Vehicle registration submitted successfully',
        data: { id: vehicle.id, status: vehicle.status },
      });
    } catch (err) {
      ControllerLogger.logError('Submit Vehicle', err, req, res);
      next(err);
    }
  }

  @httpPatch('/approve/:id', requireRole(Role.ADMIN, Role.VERIFIER))
  public async approveVehicle(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const vehicle = await this.vehicleService.approve(id, res.locals.user.id, req.query.status as Status);
      ControllerLogger.logSuccess('Vehicle approval', id, req, res);
      res.status(200).json({
        status: 'success',
        message:
          vehicle.status === Status.APPROVED ? 'Vehicle approved successfully' : 'Vehicle rejected successfully',
        data: { id: vehicle.id, status: vehicle.status },
      });
    } catch (err) {
      ControllerLogger.logError('Approve Vehicle', err, req, res);
      next(err);
    }
  }

  @httpPut('/:id', checkPermission('vehicles', 'edit'), protectBody)
  public async updateVehicle(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const vehicle = await this.vehicleService.update(id, req.body, res.locals.user.id);
      ControllerLogger.logSuccess('Vehicle updated', id, req, res);
      res.status(200).json({
        status: 'success',
        message: 'Vehicle updated successfully',
        data: { id: vehicle.id, status: vehicle.status },
      });
    } catch (err) {
      ControllerLogger.logError('Update Vehicle', err, req, res);
      next(err);
    }
  }

  @httpDelete('/delete/multiple', requireRole(Role.SUPER_ADMIN))
  public async deleteMultipleVehicles(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const ids = readIds(req);
      const result = await this.vehicleService.softDelete(ids, res.locals.user.id);
      ControllerLogger.logSuccess('Vehicles bulk deleted', ids.join(','), req, res);
      res.status(200).json({
        status: 'success',
        message: 'Vehicles deleted successfully',
        affected: result.affected,
      });
    } catch (err) {
      ControllerLogger.logError('Vehicle bulk deletion', err, req, res);
      next(err);
    }
  }

  @httpDelete('/:id', requireRole(Role.SUPER_ADMIN))
  public async deleteVehicle(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      await this.vehicleService.softDelete([id], res.locals.user.id);
      ControllerLogger.logSuccess('Vehicle deleted', id, req, res);
      res.status(200).json({ status: 'success', message: 'Vehicle deleted successfully' });
    } catch (err) {
      ControllerLogger.logError('Delete Vehicle', err, req, res);
      next(err);
    }
  }
}
