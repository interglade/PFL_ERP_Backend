import { NextFunction, Request, Response } from 'express';
import { inject } from 'inversify';
import { controller, httpGet, next, request, requestParam, response } from 'inversify-express-utils';
import { ActionType, hasPermission } from '../../middleware/checkPermission';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { ActivityAction, ActivityModule } from '../../employeeActivity/entity/userActivityLog.entity';
import { UserActivityLogService } from '../../employeeActivity/service/userActivityLog.service';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import logger from '../../utils/logger';
import { REPORTS } from '../engine/registry';
import { MAX_PDF_ROWS, REPORT_TYPE_LABELS, ReportPermKey } from '../reportCenter.types';
import { reportCsv, reportWorkbook } from '../output/reportExcel';
import { reportHtml } from '../output/reportHtml';
import { reportPdf } from '../output/reportPdf';
import { ReportCenterService } from '../service/reportCenter.service';

const FORMATS = {
  xlsx: { action: 'export', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', log: ActivityAction.EXPORT },
  csv: { action: 'export', type: 'text/csv; charset=utf-8', log: ActivityAction.EXPORT },
  pdf: { action: 'download', type: 'application/pdf', log: ActivityAction.DOWNLOAD },
} as const;

/**
 * Report Center (docs/reports-plan.md). Permissions per report type:
 * view = run it and see the table / template; download = PDF; export = Excel and CSV.
 */
@controller('/report-center', deserializeUser, requireUser)
export class ReportCenterController {
  constructor(
    @inject(TYPES.ReportCenterService) private readonly service: ReportCenterService,
    @inject(TYPES.UserActivityLogService) private readonly activityLogService: UserActivityLogService,
  ) {}

  /** Reports this user may open, grouped by type, with what they may do with each. */
  @httpGet('/catalog')
  async catalog(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const reports = [];
      for (const def of REPORTS) {
        if (!(await hasPermission(res, def.permKey, 'view'))) continue;
        reports.push({
          key: def.key,
          code: def.code,
          title: def.title,
          description: def.description,
          permKey: def.permKey,
          typeLabel: REPORT_TYPE_LABELS[def.permKey],
          params: def.params,
          groupings: def.groupings.map(({ key, label }) => ({ key, label })),
          defaultGroupBy: def.defaultGroupBy,
          allowSummaryOnly: !!def.allowSummaryOnly,
          layout: def.layout,
          canDownload: await hasPermission(res, def.permKey, 'download'),
          canExport: await hasPermission(res, def.permKey, 'export'),
        });
      }
      res.status(200).json({ data: reports });
    } catch (error) {
      nextFn(error);
    }
  }

  @httpGet('/options')
  async options(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const type = req.query.type ? String(req.query.type) : 'purchase-report';
      if (!(type in REPORT_TYPE_LABELS)) throw new AppError(400, `Unknown report type "${type}"`);
      res.status(200).json({ data: await this.service.options(res.locals.user, type as ReportPermKey) });
    } catch (error) {
      nextFn(error);
    }
  }

  @httpGet('/:key/run')
  async run(@requestParam('key') key: string, @request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      await this.allow(res, key, 'view');
      const { result } = await this.service.run(key, req.query, res.locals.user);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ data: result });
    } catch (error) {
      nextFn(error);
    }
  }

  /** The printable page as HTML - what the PDF will look like. */
  @httpGet('/:key/template')
  async template(@requestParam('key') key: string, @request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      await this.allow(res, key, 'view');
      const { result } = await this.service.run(key, req.query, res.locals.user);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ data: { html: reportHtml(result) } });
    } catch (error) {
      nextFn(error);
    }
  }

  @httpGet('/:key/export')
  async export(@requestParam('key') key: string, @request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const format = String(req.query.format || 'xlsx') as keyof typeof FORMATS;
      const spec = FORMATS[format];
      if (!spec) throw new AppError(400, 'Format must be xlsx, pdf or csv');
      await this.allow(res, key, spec.action);

      const { result, detailRows, groupCount } = await this.service.run(key, req.query, res.locals.user);
      const shownRows = result.rows.filter((r) => r.kind === 'detail').length;
      if (format === 'pdf' && shownRows > MAX_PDF_ROWS) {
        throw new AppError(
          422,
          `${shownRows.toLocaleString('en-IN')} rows is too large for a PDF. Use "Summary only", narrow the filters, or download Excel.`,
        );
      }

      const file =
        format === 'pdf'
          ? await reportPdf(result)
          : format === 'csv'
            ? reportCsv(result.columns, detailRows)
            : await reportWorkbook(result, detailRows, groupCount);

      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = `${result.code}_${result.title.replace(/[^A-Za-z0-9]+/g, '_')}_${stamp}.${format}`;
      res.status(200);
      res.setHeader('Content-Type', spec.type);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      res.setHeader('Cache-Control', 'no-store');
      res.end(file);
      void this.log(req, res, spec.log, result.title, format, result.detailCount);
    } catch (error) {
      nextFn(error);
    }
  }

  private async allow(res: Response, key: string, action: ActionType) {
    const def = this.service.getDefinition(key);
    if (!(await hasPermission(res, def.permKey, action))) {
      const what = action === 'view' ? 'open' : action === 'download' ? 'download the PDF of' : 'export';
      throw new AppError(403, `You do not have permission to ${what} ${REPORT_TYPE_LABELS[def.permKey]}`);
    }
  }

  private async log(req: Request, res: Response, action: ActivityAction, title: string, format: string, rows: number) {
    try {
      const user = res.locals.user;
      const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'Unknown User';
      await this.activityLogService.logActivity({
        userId: user.id,
        userName,
        action,
        module: ActivityModule.REPORT,
        entityName: 'Report',
        entityId: req.params.key,
        description: `${userName} downloaded ${title} (${format.toUpperCase()}, ${rows} rows)`,
        metadata: { query: req.query },
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: res.statusCode,
      });
    } catch (error) {
      logger.error('Failed to log report download:', error);
    }
  }
}
