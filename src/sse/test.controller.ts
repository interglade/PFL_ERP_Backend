import { inject } from 'inversify';
import {
  controller,
  httpPost,
  httpGet,
  request,
  response,
  next,
} from 'inversify-express-utils';
import { Request, Response, NextFunction } from 'express';
import { TYPES } from '../types';

import { SSEService } from './sse.service';
import { deserializeUser, requireUser } from '../middleware/deserializeUser';
import logger from '../utils/logger';
import { NotificationService } from '../notification/service/notification.service';

@controller('/test', deserializeUser, requireUser)
export class TestController {
  constructor(
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.SSEService)
    private sseService: SSEService
  ) {}

  /**
   * Send test notification to specific user
   * POST /test/send-notification
   */
  @httpPost('/send-notification')
  public async sendTestNotification(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { message, userId } = req.body;

      if (!userId || !message) {
        return res.status(400).json({
          status: 'error',
          message: 'userId and message are required',
        });
      }

      // Send notification
      await this.notificationService.createNoti(message, userId);

      logger.info(`Test notification sent to user ${userId}`);

      res.status(200).json({
        status: 'success',
        message: 'Notification sent successfully',
        data: {
          userId,
          message,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('Error sending test notification:', error);
      next(error);
    }
  }

  /**
   * Send test notification to current user
   * POST /test/send-notification-to-me
   */
  @httpPost('/send-notification-to-me')
  public async sendTestNotificationToMe(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const userId = res.locals.user?.id;
      const { message } = req.body;

      if (!userId) {
        return res.status(401).json({
          status: 'error',
          message: 'User not authenticated',
        });
      }

      const notificationMessage =
        message || `Test notification sent at ${new Date().toLocaleTimeString()}`;

      // Send notification
      await this.notificationService.createNoti(notificationMessage, userId);

      logger.info(`Test notification sent to current user ${userId}`);

      res.status(200).json({
        status: 'success',
        message: 'Notification sent to you successfully',
        data: {
          userId,
          message: notificationMessage,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('Error sending test notification:', error);
      next(error);
    }
  }

  /**
   * Broadcast test notification to all connected users
   * POST /test/broadcast
   */
  @httpPost('/broadcast')
  public async broadcastTestNotification(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({
          status: 'error',
          message: 'message is required',
        });
      }

      // Broadcast via SSE
      this.sseService.broadcast({
        type: 'broadcast',
        message,
        timestamp: new Date().toISOString(),
      });

      const activeConnections = this.sseService.getActiveConnectionsCount();

      logger.info(`Broadcast sent to ${activeConnections} connections`);

      res.status(200).json({
        status: 'success',
        message: 'Broadcast sent successfully',
        data: {
          message,
          recipientCount: activeConnections,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('Error broadcasting notification:', error);
      next(error);
    }
  }

  /**
   * Send multiple test notifications
   * POST /test/send-multiple
   */
  @httpPost('/send-multiple')
  public async sendMultipleNotifications(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { count = 5, userId, delay = 1000 } = req.body;

      if (!userId) {
        return res.status(400).json({
          status: 'error',
          message: 'userId is required',
        });
      }

      // Send notifications with delay
      const notifications = [];
      for (let i = 1; i <= count; i++) {
        setTimeout(async () => {
          const message = `Test notification ${i} of ${count}`;
          await this.notificationService.createNoti(message, userId);
          logger.info(`Sent notification ${i}/${count} to user ${userId}`);
        }, i * delay);

        notifications.push({
          number: i,
          message: `Test notification ${i} of ${count}`,
          scheduledAt: new Date(Date.now() + i * delay).toISOString(),
        });
      }

      res.status(200).json({
        status: 'success',
        message: `Scheduled ${count} notifications`,
        data: {
          userId,
          count,
          delay,
          notifications,
        },
      });
    } catch (error) {
      logger.error('Error sending multiple notifications:', error);
      next(error);
    }
  }

  /**
   * Get SSE connection statistics
   * GET /test/sse-stats
   */
  @httpGet('/sse-stats')
  public async getSSEStats(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const stats = {
        totalConnections: this.sseService.getActiveConnectionsCount(),
        activeUsers: this.sseService.getActiveUsers(),
        activeUserCount: this.sseService.getActiveUsers().length,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json({
        status: 'success',
        data: stats,
      });
    } catch (error) {
      logger.error('Error getting SSE stats:', error);
      next(error);
    }
  }

  /**
   * Test different notification types
   * POST /test/notification-types
   */
  @httpPost('/notification-types')
  public async testNotificationTypes(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const userId = res.locals.user?.id;

      if (!userId) {
        return res.status(401).json({
          status: 'error',
          message: 'User not authenticated',
        });
      }

      // Send different types of notifications
      const types = [
        { type: 'info', message: 'This is an info notification' },
        { type: 'success', message: 'This is a success notification' },
        { type: 'warning', message: 'This is a warning notification' },
        { type: 'error', message: 'This is an error notification' },
      ];

      for (let i = 0; i < types.length; i++) {
        setTimeout(() => {
          this.sseService.sendToUser(userId, {
            ...types[i],
            timestamp: new Date().toISOString(),
          });
        }, i * 1000);
      }

      res.status(200).json({
        status: 'success',
        message: 'Sending different notification types',
        data: {
          userId,
          types,
        },
      });
    } catch (error) {
      logger.error('Error testing notification types:', error);
      next(error);
    }
  }
}
