import { Request, Response, NextFunction } from 'express';
import { container } from '../inversify.config';
import { TYPES } from '../types';
import { UserActivityLogService } from '../employeeActivity/service/userActivityLog.service';

import logger from '../utils/logger';
import { ActivityAction, ActivityModule } from '../employeeActivity/entity/userActivityLog.entity';

/**
 * Middleware to automatically log user activities
 */
export const activityLoggerMiddleware = (
  action: ActivityAction,
  module: ActivityModule,
  getDescription?: (req: Request) => string,
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Store original send function
    const originalSend = res.send;

    // Override send function to log after response
    res.send = function (data: any): Response {
      res.send = originalSend; // Restore original send

      // Log activity after response is sent
      setImmediate(async () => {
        try {
          const activityLogService = container.get<UserActivityLogService>(
            TYPES.UserActivityLogService,
          );

          const userId = res.locals.user?.id;
          if (!userId) {
            return; // Skip logging if no user
          }

          const responseTime = Date.now() - startTime;
          const description = getDescription
            ? getDescription(req)
            : `${action} ${module}`;

          await activityLogService.logActivity({
            userId,
            userName: `${res.locals.user?.firstName || ''} ${res.locals.user?.lastName || ''}`.trim(),
            action,
            module,
            description,
            entityName: req.params.id ? module : undefined,
            entityId: req.params.id,
            metadata: {
              params: req.params,
              query: req.query,
              body: sanitizeBody(req.body),
            },
            ipAddress: getClientIp(req),
            userAgent: req.get('user-agent'),
            endpoint: req.originalUrl,
            httpMethod: req.method,
            statusCode: res.statusCode,
            responseTime,
            isError: res.statusCode >= 400,
          });
        } catch (error) {
          logger.error('Failed to log activity:', error);
        }
      });

      return originalSend.call(this, data);
    };

    next();
  };
};

/**
 * Sanitize request body to remove sensitive data
 */
function sanitizeBody(body: any): any {
  if (!body) return body;

  const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'accessToken'];
  const sanitized = { ...body };

  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '***REDACTED***';
    }
  });

  return sanitized;
}

/**
 * Get client IP address
 */
function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/**
 * Log activity manually (for use in controllers)
 */
export async function logActivity(
  userId: string,
  action: ActivityAction,
  module: ActivityModule,
  description: string,
  options?: {
    entityName?: string;
    entityId?: string;
    metadata?: Record<string, any>;
    changes?: Record<string, { oldValue: any; newValue: any }>;
  },
): Promise<void> {
  try {
    const activityLogService = container.get<UserActivityLogService>(
      TYPES.UserActivityLogService,
    );

    await activityLogService.logActivity({
      userId,
      action,
      module,
      description,
      ...options,
    });
  } catch (error) {
    logger.error('Failed to log activity:', error);
  }
}
