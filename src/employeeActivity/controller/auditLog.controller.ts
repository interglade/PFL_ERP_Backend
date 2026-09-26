import { Request, Response, NextFunction } from 'express';
import { inject } from 'inversify';
import { controller, httpGet } from 'inversify-express-utils';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { TYPES } from '../../types';
import { AuditLogService } from '../service/auditLog.service';
import { AuditLogRepository } from '../repository/AuditLog.repository';


@controller('/audit-logs', deserializeUser, requireUser)
export class AuditLogController {
  constructor(
    @inject(TYPES.AuditLogService) private auditLogService: AuditLogService,
    @inject(TYPES.AuditLogRepository) private auditLogRepo:AuditLogRepository
  ) {}

  // Get all audit logs
  @httpGet('/')
  public async getAllAuditLogs(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const logs = await this.auditLogService.getAllLogs();
      res.status(200).json({
        status: 'success',
        data: logs,
      });
    } catch (error) {
      next(error);
    }
  }

  // Get audit logs by entity name and ID
  @httpGet('/:entityName/:entityId')
  public async getAuditLogs(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { entityName, entityId } = req.params;
      const logs = await this.auditLogService.getAuditLogs(
        entityName,
        entityId,
      );
      if (logs && logs.length > 0) {
        res.status(200).json({
          status: 'success',
          data: logs,
        });
      } else {
        res.status(404).send('Audit logs not found');
      }
    } catch (error) {
      next(error);
    }
  }

  // Admin: Get all logs for a specific user
  @httpGet('/user/:userId')
  public async getUserLogs(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { userId } = req.params;
      const { entityName, startDate, endDate, page, limit } = req.query;

      const options: any = {};
      if (entityName) options.entityName = entityName as string;
      if (startDate) options.startDate = new Date(startDate as string);
      if (endDate) options.endDate = new Date(endDate as string);
      if (page) options.page = parseInt(page as string);
      if (limit) options.limit = parseInt(limit as string);

      let logs;
      if (Object.keys(options).length > 0) {
        if (options.entityName && options.startDate && options.endDate) {
          logs = await this.auditLogService.getLogsByUserAndDateRange(
            userId,
            options.startDate,
            options.endDate
          );
        } else if (options.entityName) {
          logs = await this.auditLogService.getLogsByUserAndEntity(userId, options.entityName);
        } else if (options.page && options.limit) {
          logs = await this.auditLogService.getLogsByUserWithPagination(
            userId,
            options.page,
            options.limit
          );
        } else {
          logs = await this.auditLogService.getLogsByUser(userId);
        }
      } else {
        logs = await this.auditLogService.getLogsByUser(userId);
      }

      res.status(200).json({
        status: 'success',
        data: logs,
      });
    } catch (error) {
      next(error);
    }
  }

  // Admin: Get comprehensive user activity report
  @httpGet('/user/:userId/report')
  public async getUserActivityReport(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { userId } = req.params;
      const report = await this.auditLogService.getUserActivityReport(userId);
      
      res.status(200).json({
        status: 'success',
        data: report,
      });
    } catch (error) {
      next(error);
    }
  }

  // Admin: Get logs by date range (all users)
  @httpGet('/date-range')
  public async getLogsByDateRange(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { startDate, endDate, entityName } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({
          status: 'error',
          message: 'startDate and endDate are required',
        });
        return;
      }

      const logs = await this.auditLogRepo
        .createQueryBuilder('auditLog')
        .where('auditLog.updatedAt >= :startDate', { startDate: new Date(startDate as string) })
        .andWhere('auditLog.updatedAt <= :endDate', { endDate: new Date(endDate as string) })
        .andWhere(entityName ? 'auditLog.entityName = :entityName' : '1=1', 
          entityName ? { entityName } : {})
        .orderBy('auditLog.updatedAt', 'DESC')
        .getMany();

      res.status(200).json({
        status: 'success',
        data: logs,
      });
    } catch (error) {
      next(error);
    }
  }
}
