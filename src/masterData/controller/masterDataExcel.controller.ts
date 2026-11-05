import { NextFunction, Request, Response } from 'express';
import { inject } from 'inversify';
import { controller, httpGet, httpPost, next, request, response } from 'inversify-express-utils';
import { Role } from '../../employee/entity/user.entity';
import { requireRole } from '../../middleware/requireRole';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { uploadSingle } from '../../middleware/uploadsingle.middleware';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import { ControllerLogger } from '../../utils/controllerLogger';
import { MasterDataExcelService } from '../service/masterDataExcel.service';

/**
 * Excel template, export and import for the small masters, one route per
 * master key (`uom`, `vendor-category`, ...). Admin only, like every other
 * master-data write.
 */
@controller('/master-data', deserializeUser, requireUser)
export class MasterDataExcelController {
  constructor(
    @inject(TYPES.MasterDataExcelService)
    private readonly masterDataExcelService: MasterDataExcelService,
  ) {}

  @httpGet('/:master/template', requireRole(Role.ADMIN))
  public async downloadTemplate(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const file = await this.masterDataExcelService.buildTemplate(req.params.master);
      ControllerLogger.logList(`${req.params.master} Excel template`, req, res);
      return res.status(200).json({
        status: 'success',
        message: 'Template ready',
        data: { downloadUrl: file.downloadUrl, fileName: file.fileName, totalRecords: 0 },
      });
    } catch (error) {
      ControllerLogger.logError(`${req.params.master} Excel template`, error, req, res);
      next(error);
    }
  }

  @httpGet('/:master/export', requireRole(Role.ADMIN))
  public async exportExcel(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      // `?type=` narrows a Locations export to the list page's own Location Type.
      const type = typeof req.query.type === 'string' ? req.query.type : undefined;
      const file = await this.masterDataExcelService.exportAll(req.params.master, { type });
      ControllerLogger.logList(`${req.params.master} Excel export`, req, res);
      return res.status(200).json({
        status: 'success',
        message: `${file.rowCount} record(s) exported`,
        data: {
          downloadUrl: file.downloadUrl,
          fileName: file.fileName,
          totalRecords: file.rowCount,
        },
      });
    } catch (error) {
      ControllerLogger.logError(`${req.params.master} Excel export`, error, req, res);
      next(error);
    }
  }

  /** `?checkOnly=true` runs every check and saves nothing. */
  @httpPost('/:master/import', requireRole(Role.ADMIN), uploadSingle.single('file'))
  public async importExcel(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const fileUrl = (req.file as any)?.location as string | undefined;
      if (!fileUrl) {
        ControllerLogger.logValidationError(`${req.params.master} Excel import`, 'No file uploaded', req, res);
        return next(new AppError(400, 'No file uploaded'));
      }

      const result = await this.masterDataExcelService.importFile(req.params.master, fileUrl, {
        checkOnly: req.query.checkOnly === 'true',
        userId: res.locals.user?.id,
        // The Users import applies the form's Super Admin rules to whoever imports.
        actor: res.locals.user ? { id: res.locals.user.id, roles: res.locals.user.roles ?? [] } : undefined,
      });

      ControllerLogger.logList(`${req.params.master} Excel import`, req, res);
      return res.status(200).json({
        status: 'success',
        message: result.message,
        data: result.summary,
      });
    } catch (error) {
      ControllerLogger.logError(`${req.params.master} Excel import`, error, req, res);
      next(error);
    }
  }
}
