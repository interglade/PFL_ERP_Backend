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
import { TransporterService } from '../service/transporter.service';
import { TRANSPORTER_FILTERS } from '../filters/transporter.filters';

@controller('/transporters', deserializeUser, requireUser)
export class TransporterController {
  constructor(
    @inject(TYPES.TransporterService)
    private readonly transporterService: TransporterService,
  ) {}

  // ─── Excel (docs/master-data-excel-plan.md Phase 7) ───────────────────────

  @httpGet('/export/excel', checkPermission('transporters', 'export'))
  public async exportExcel(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const file = await this.transporterService.exportToExcel(res.locals.user.id);
      ControllerLogger.logList('Transporter Excel export', req, res);
      res.status(200).json({
        status: 'success',
        message: `${file.rowCount} transporter(s) exported successfully`,
        data: { downloadUrl: file.downloadUrl, fileName: file.fileName, totalRecords: file.rowCount },
      });
    } catch (err) {
      ControllerLogger.logError('Transporter Excel export', err, req, res);
      next(err);
    }
  }

  @httpGet('/download/template', checkPermission('transporters', 'create'))
  public async downloadExcelTemplate(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const file = await this.transporterService.buildExcelTemplate();
      ControllerLogger.logList('Transporter Excel template', req, res);
      res.status(200).json({
        status: 'success',
        message: 'Template ready',
        data: { downloadUrl: file.downloadUrl, fileName: file.fileName, totalRecords: 0 },
      });
    } catch (err) {
      ControllerLogger.logError('Transporter Excel template', err, req, res);
      next(err);
    }
  }

  @httpPost('/upload', checkPermission('transporters', 'create'), uploadSingle.single('file'))
  public async uploadExcel(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    try {
      const fileUrl = (req.file as any)?.location as string | undefined;
      if (!fileUrl) return next(new AppError(400, 'No file uploaded'));

      const summary = await this.transporterService.importFromExcel(fileUrl, res.locals.user.id);
      ControllerLogger.logSuccess('Transporter Excel uploaded', 'bulk', req, res);
      res.status(200).json({
        status: 'success',
        message:
          `${summary.created} transporter(s) imported` +
          (summary.drafted ? `, ${summary.drafted} saved as draft` : '') +
          (summary.updated ? `, ${summary.updated} draft(s) completed` : '') +
          (summary.skipped.length ? `, ${summary.skipped.length} skipped` : '') +
          (summary.failed.length ? `, ${summary.failed.length} failed` : ''),
        data: summary,
      });
    } catch (err) {
      ControllerLogger.logError('Transporter Excel upload', err, req, res);
      next(err);
    }
  }

  @httpPost('/', checkPermission('transporters', 'create'))
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

  @httpGet('/', checkPermission('transporters', 'view'))
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

  @httpGet('/view/:id', checkPermission('transporters', 'view'))
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

  @httpGet('/update/:id', checkPermission('transporters', 'edit'))
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
  @httpPatch('/submit/:id', checkPermission('transporters', 'create'))
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

  @httpPatch('/approve/:id', requireRole(Role.ADMIN, Role.VERIFIER))
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

  @httpPut('/:id', checkPermission('transporters', 'edit'), protectBody)
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

  @httpDelete('/delete/multiple', requireRole(Role.SUPER_ADMIN))
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

  @httpDelete('/:id', requireRole(Role.SUPER_ADMIN))
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
