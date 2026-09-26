import { injectable, inject } from 'inversify';
import { TYPES } from '../../types';

import { Between, FindOptionsWhere, In } from 'typeorm';
import logger from '../../utils/logger';
import { ActivityAction, ActivityModule, UserActivityLog } from '../entity/userActivityLog.entity';
import { UserActivityLogRepository } from '../repository/userActivityLog.repository';

export interface LogActivityOptions {
    userId: string;
    userName?: string;
    action: ActivityAction;
    module: ActivityModule;
    entityName?: string;
    entityId?: string;
    description: string;
    metadata?: Record<string, any>;
    changes?: Record<string, { oldValue: any; newValue: any }>;
    ipAddress?: string;
    userAgent?: string;
    endpoint?: string;
    httpMethod?: string;
    statusCode?: number;
    responseTime?: number;
    isError?: boolean;
    errorMessage?: string;
}

export interface ActivityLogFilters {
    userId?: string;
    userIds?: string[];
    action?: ActivityAction;
    actions?: ActivityAction[];
    module?: ActivityModule;
    modules?: ActivityModule[];
    startDate?: Date;
    endDate?: Date;
    isError?: boolean;
    search?: string;
}

@injectable()
export class UserActivityLogService {
    constructor(
        @inject(TYPES.UserActivityLogRepository)
        private activityLogRepo: UserActivityLogRepository,
    ) { }

    /**
     * Map a UserActivityLog entity to a clean response object
     */
    private mapLog(log: UserActivityLog): Record<string, any> {
        return {
            id: log.id,
            userName: log.userName,
            userId: log.userId,
            action: log.action,
            module: log.module,
            description: log.description,
            entityName: log.entityName ?? null,
            entityId: log.entityId ?? null,
            ipAddress: log.ipAddress ?? null,
            endpoint: log.endpoint ?? null,
            httpMethod: log.httpMethod ?? null,
            statusCode: log.statusCode ?? null,
            userAgent: log.userAgent ?? null,
            responseTime: log.responseTime ?? null,
            isError: log.isError,
            errorMessage: log.errorMessage ?? null,
            createdAt: log.createdAt,
        };
    }

    /**
     * Log user activity
     */
    async logActivity(options: LogActivityOptions): Promise<void> {
        try {
            const activityLog = this.activityLogRepo.create({
                userId: options.userId,
                userName: options.userName,
                action: options.action,
                module: options.module,
                entityName: options.entityName,
                entityId: options.entityId,
                description: options.description,
                metadata: options.metadata,
                changes: options.changes,
                ipAddress: options.ipAddress,
                userAgent: options.userAgent,
                endpoint: options.endpoint,
                httpMethod: options.httpMethod,
                statusCode: options.statusCode,
                responseTime: options.responseTime,
                isError: options.isError || false,
                errorMessage: options.errorMessage,
            });

            await this.activityLogRepo.save(activityLog);
            logger.info(`Activity logged: ${options.action} - ${options.module} by user ${options.userId}`);
        } catch (error) {
            logger.error('Failed to log activity:', error);
            // Don't throw error - logging should not break the main operation
        }
    }

    /**
     * Get activity logs for a specific user
     */
    async getUserActivityLogs(
        userId: string,
        filters?: ActivityLogFilters,
        page: number = 1,
        limit: number = 50
    ): Promise<{ data: any[]; total: number; pages: number }> {
        const where: FindOptionsWhere<UserActivityLog> = { userId };

        if (filters) {
            if (filters.action) where.action = filters.action;
            if (filters.actions) where.action = In(filters.actions);
            if (filters.module) where.module = filters.module;
            if (filters.modules) where.module = In(filters.modules);
            if (filters.isError !== undefined) where.isError = filters.isError;
            if (filters.startDate && filters.endDate) {
                where.createdAt = Between(filters.startDate, filters.endDate);
            }
        }

        const [data, total] = await this.activityLogRepo.findAndCount({
            where,
            relations: ['user'],
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });

        return {
            data: data.map(this.mapLog),
            total,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Get all activity logs with filters
     */
    async getAllActivityLogs(
        filters?: ActivityLogFilters,
        page: number = 1,
        limit: number = 50
    ): Promise<{ data: any[]; total: number; pages: number }> {
        const where: FindOptionsWhere<UserActivityLog> = {};

        if (filters) {
            if (filters.userId) where.userId = filters.userId;
            if (filters.userIds) where.userId = In(filters.userIds);
            if (filters.action) where.action = filters.action;
            if (filters.actions) where.action = In(filters.actions);
            if (filters.module) where.module = filters.module;
            if (filters.modules) where.module = In(filters.modules);
            if (filters.isError !== undefined) where.isError = filters.isError;
            if (filters.startDate && filters.endDate) {
                where.createdAt = Between(filters.startDate, filters.endDate);
            }
        }

        const [data, total] = await this.activityLogRepo.findAndCount({
            where,
            relations: ['user'],
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });

        return {
            data: data.map(this.mapLog),
            total,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Get activity logs for a specific entity
     */
    async getEntityActivityLogs(
        entityName: string,
        entityId: string,
        page: number = 1,
        limit: number = 50
    ): Promise<{ data: UserActivityLog[]; total: number; pages: number }> {
        const [data, total] = await this.activityLogRepo.findAndCount({
            where: { entityName, entityId },
            relations: ['user'],
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });

        return {
            data,
            total,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Get user activity summary
     */
    async getUserActivitySummary(userId: string, days: number = 30): Promise<any> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const logs = await this.activityLogRepo.find({
            where: {
                userId,
                createdAt: Between(startDate, new Date()),
            },
        });

        const summary = {
            totalActivities: logs.length,
            byAction: {} as Record<string, number>,
            byModule: {} as Record<string, number>,
            errorCount: logs.filter(l => l.isError).length,
            lastActivity: logs[0]?.createdAt || null,
        };

        logs.forEach(log => {
            summary.byAction[log.action] = (summary.byAction[log.action] || 0) + 1;
            summary.byModule[log.module] = (summary.byModule[log.module] || 0) + 1;
        });

        return summary;
    }

    /**
     * Get recent activities across all users
     */
    async getRecentActivities(limit: number = 100): Promise<any[]> {
        const data = await this.activityLogRepo.find({
            relations: ['user'],
            order: { createdAt: 'DESC' },
            take: limit,
        });
        return data.map(this.mapLog);
    }

    /**
     * Get user login history
     */
    async getUserLoginHistory(
        userId: string,
        page: number = 1,
        limit: number = 50
    ): Promise<{ data: UserActivityLog[]; total: number; pages: number }> {
        const [data, total] = await this.activityLogRepo.findAndCount({
            where: {
                userId,
                action: In([ActivityAction.LOGIN, ActivityAction.LOGOUT]),
            },
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });

        return {
            data,
            total,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Get error logs for a user
     */
    async getUserErrorLogs(
        userId: string,
        page: number = 1,
        limit: number = 50
    ): Promise<{ data: UserActivityLog[]; total: number; pages: number }> {
        const [data, total] = await this.activityLogRepo.findAndCount({
            where: {
                userId,
                isError: true,
            },
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });

        return {
            data,
            total,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Delete old logs (for cleanup)
     */
    async deleteOldLogs(daysToKeep: number = 90): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        const result = await this.activityLogRepo
            .createQueryBuilder()
            .delete()
            .where('createdAt < :cutoffDate', { cutoffDate })
            .execute();

        logger.info(`Deleted ${result.affected} old activity logs`);
        return result.affected || 0;
    }
}
