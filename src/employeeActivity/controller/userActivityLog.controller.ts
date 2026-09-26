import { Request, Response, NextFunction } from 'express';
import { inject } from 'inversify';
import {
  controller,
  httpGet,
  httpDelete,
  request,
  response,
  next,
  requestParam,
  queryParam,
} from 'inversify-express-utils';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { ActivityLogFilters, UserActivityLogService } from '../service/userActivityLog.service';
import { TYPES } from '../../types';
import { ActivityAction, ActivityModule } from '../entity/userActivityLog.entity';
import { ControllerLogger } from '../../utils/controllerLogger';
import logger from '../../utils/logger';
import AppError from '../../utils/appError';


@controller('/user-activity-logs', deserializeUser, requireUser)
export class UserActivityLogController {
  constructor(
    @inject(TYPES.UserActivityLogService)
    private activityLogService: UserActivityLogService,
  ) {}

  /**
   * Get activity logs for a specific user
   * GET /user-activity-logs/user/:userId
   */
  @httpGet('/user/:userId')
  public async getUserActivityLogs(
    @requestParam('userId') userId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const {
        page = 1,
        limit = 50,
        action,
        module,
        startDate,
        endDate,
        isError,
      } = req.query;

      const filters: ActivityLogFilters = {};
      if (action) filters.action = action as ActivityAction;
      if (module) filters.module = module as ActivityModule;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      if (isError !== undefined) filters.isError = isError === 'true';

      const result = await this.activityLogService.getUserActivityLogs(
        userId,
        filters,
        Number(page),
        Number(limit),
      );

      ControllerLogger.logList('User Activity Logs', req, res);

      res.status(200).json({
       
         status: 'success',
        data: result.data,
        allRecords:result.total,
        totalPages: result.pages,
        page: Number(page),
        
      });
    } catch (error) {
      logger.error('Error fetching user activity logs:', error);
      ControllerLogger.logError('User Activity Logs retrieval', error, req, res);
      next(error);
    }
  }

  /**
   * Get all activity logs (Admin only)
   * GET /user-activity-logs
   */
  @httpGet('/')
  public async getAllActivityLogs(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      // Check if user is admin
      const userRole = res.locals.id;
      // console.log(userRole);
      // if (userRole !== 'SuperAdmin' && userRole !== 'Admin') {
      //   return next(new AppError(403, 'Access denied. Admin only.'));
      // }

      const {
        page = 1,
        limit = 50,
        userId,
        action,
        module,
        startDate,
        endDate,
        isError,
      } = req.query;

      const filters: ActivityLogFilters = {};
      if (userId) filters.userId = userId as string;
      if (action) filters.action = action as ActivityAction;
      if (module) filters.module = module as ActivityModule;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      if (isError !== undefined) filters.isError = isError === 'true';

      const result = await this.activityLogService.getAllActivityLogs(
        filters,
        Number(page),
        Number(limit),
      );

      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.total,
          pages: result.pages,
        },
      });
    } catch (error) {
      logger.error('Error fetching all activity logs:', error);
      next(error);
    }
  }

  /**
   * Get activity logs for a specific entity
   * GET /user-activity-logs/entity/:entityName/:entityId
   */
  @httpGet('/entity/:entityName/:entityId')
  public async getEntityActivityLogs(
    @requestParam('entityName') entityName: string,
    @requestParam('entityId') entityId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const { page = 1, limit = 50 } = req.query;

      const result = await this.activityLogService.getEntityActivityLogs(
        entityName,
        entityId,
        Number(page),
        Number(limit),
      );

      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.total,
          pages: result.pages,
        },
      });
    } catch (error) {
      logger.error('Error fetching entity activity logs:', error);
      next(error);
    }
  }

  /**
   * Get user activity summary
   * GET /user-activity-logs/user/:userId/summary
   */
  @httpGet('/user/:userId/summary')
  public async getUserActivitySummary(
    @requestParam('userId') userId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const { days = 30 } = req.query;

      const summary = await this.activityLogService.getUserActivitySummary(
        userId,
        Number(days),
      );

      res.status(200).json({
        status: 'success',
        data: summary,
      });
    } catch (error) {
      logger.error('Error fetching user activity summary:', error);
      next(error);
    }
  }

  /**
   * Get recent activities
   * GET /user-activity-logs/recent
   */
  @httpGet('/recent')
  public async getRecentActivities(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const { limit = 10 } = req.query;

      const activities = await this.activityLogService.getRecentActivities(
        Number(limit),
      );

      res.status(200).json({
        status: 'success',
        total: activities.length,
        data: activities,
      });
    } catch (error) {
      logger.error('Error fetching recent activities:', error);
      next(error);
    }
  }

  /**
   * Get user login history
   * GET /user-activity-logs/user/:userId/login-history
   */
  @httpGet('/user/:userId/login-history')
  public async getUserLoginHistory(
    @requestParam('userId') userId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const { page = 1, limit = 50 } = req.query;

      const result = await this.activityLogService.getUserLoginHistory(
        userId,
        Number(page),
        Number(limit),
      );

      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.total,
          pages: result.pages,
        },
      });
    } catch (error) {
      logger.error('Error fetching user login history:', error);
      next(error);
    }
  }

  /**
   * Get user error logs
   * GET /user-activity-logs/user/:userId/errors
   */
  @httpGet('/user/:userId/errors')
  public async getUserErrorLogs(
    @requestParam('userId') userId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const { page = 1, limit = 50 } = req.query;

      const result = await this.activityLogService.getUserErrorLogs(
        userId,
        Number(page),
        Number(limit),
      );

      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.total,
          pages: result.pages,
        },
      });
    } catch (error) {
      logger.error('Error fetching user error logs:', error);
      next(error);
    }
  }

  /**
   * Get current user's activity logs (for frontend dashboard)
   * GET /user-activity-logs/my-activities
   */
  @httpGet('/my-activities')
  public async getMyActivityLogs(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const currentUserId = res.locals.user.id;
      const {
        page = 1,
        limit = 20,
        action,
        module,
        startDate,
        endDate,
        isError,
      } = req.query;

      const filters: ActivityLogFilters = {};
      if (action) filters.action = action as ActivityAction;
      if (module) filters.module = module as ActivityModule;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      if (isError !== undefined) filters.isError = isError === 'true';

      const result = await this.activityLogService.getUserActivityLogs(
        currentUserId,
        filters,
        Number(page),
        Number(limit),
      );

      ControllerLogger.logList('My Activity Logs', req, res);

      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.total,
          pages: result.pages,
        },
      });
    } catch (error) {
      logger.error('Error fetching my activity logs:', error);
      ControllerLogger.logError('My Activity Logs retrieval', error, req, res);
      next(error);
    }
  }

  /**
   * Get activity feed for dashboard (recent activities across modules)
   * GET /user-activity-logs/activity-feed
   */
  @httpGet('/activity-feed')
  public async getActivityFeed(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const currentUserId = res.locals.user.id;
      const { limit = 50 } = req.query;

      // Get recent activities for current user
      const filters: ActivityLogFilters = {
        userId: currentUserId,
      };

      const result = await this.activityLogService.getAllActivityLogs(
        filters,
        1,
        Number(limit),
      );

      ControllerLogger.logList('Activity Feed', req, res);

      res.status(200).json({
        status: 'success',
        data: result.data,
        total: result.total,
      });
    } catch (error) {
      logger.error('Error fetching activity feed:', error);
      ControllerLogger.logError('Activity Feed retrieval', error, req, res);
      next(error);
    }
  }

  /**
   * Get activity statistics for dashboard
   * GET /user-activity-logs/stats
   */
  @httpGet('/stats')
  public async getActivityStats(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const currentUserId = res.locals.user.id;
      const { days = 30 } = req.query;

      const summary = await this.activityLogService.getUserActivitySummary(
        currentUserId,
        Number(days),
      );

      ControllerLogger.logView('Activity Statistics', currentUserId, req, res);

      res.status(200).json({
        status: 'success',
        data: summary,
      });
    } catch (error) {
      logger.error('Error fetching activity stats:', error);
      ControllerLogger.logError('Activity Statistics retrieval', error, req, res);
      next(error);
    }
  }

  /**
   * Delete old logs (Admin only)
   * DELETE /user-activity-logs/cleanup
   */
  @httpDelete('/cleanup')
  public async deleteOldLogs(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      // Check if user is admin
      const userRole = res.locals.user.role;
      if (userRole !== 'SuperAdmin') {
        return next(new AppError(403, 'Access denied. SuperAdmin only.'));
      }

      const { daysToKeep = 180 } = req.query;

      const deletedCount = await this.activityLogService.deleteOldLogs(
        Number(daysToKeep),
      );

      ControllerLogger.logSuccess('Old activity logs deleted', deletedCount.toString(), req, res);

      res.status(200).json({
        status: 'success',
        message: `Deleted ${deletedCount} old activity logs`,
        deletedCount,
      });
    } catch (error) {
      logger.error('Error deleting old logs:', error);
      ControllerLogger.logError('Old logs cleanup', error, req, res);
      next(error);
    }
  }
}
