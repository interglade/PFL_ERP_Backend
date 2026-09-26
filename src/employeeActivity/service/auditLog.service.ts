import { inject, injectable } from 'inversify';
import { TYPES } from '../../types';
import { AuditLogRepository } from '../repository/AuditLog.repository';
import { AuditLog } from '../entity/auditLog.entity';



@injectable()
export class AuditLogService {
 
  constructor(
    @inject(TYPES.AuditLogRepository)
    private readonly auditLogRepo : AuditLogRepository,
  
  ) {}
  // Function to log changes
  async logChange(
    entityName: string,
    entityId: string,
    oldData: any,
    newData: any,
    // date: Date,
    updatedBy: string,
  ): Promise<void> {
    const changes: Record<string, { oldValue: any; newValue: any;  }> = {};

    for (const key of Object.keys(newData)) {
      if (oldData[key] !== newData[key]) {
        changes[key] = {
          oldValue: oldData[key],
          newValue: newData[key],
          // date: new Date,
        };
      }
    }

    if (Object.keys(changes).length > 0) {
      const auditLog = this.auditLogRepo.create({
        entityName,
        entityId,
        changes,
        updatedBy,
      });
      await this.auditLogRepo.save(auditLog);
    }
  }
  async getAllLogs(): Promise<AuditLog[]> {
    
    return this.auditLogRepo.find({
      order: { updatedAt: "DESC" },
    });
  }

  async getAuditLogs(entityName: string, entityId: string): Promise<AuditLog[]> {
    return this.auditLogRepo.find({
      where: { entityName, entityId },
      order: { updatedAt: "DESC" }, // Latest logs first
    });
  }

  // Get all logs for a specific user (admin functionality)
  async getLogsByUser(userId: string): Promise<AuditLog[]> {
    return this.auditLogRepo.find({
      where: { updatedBy: userId },
      order: { updatedAt: "DESC" }, // Latest logs first
    });
  }

  // Get logs for a specific user with pagination
  async getLogsByUserWithPagination(
    userId: string, 
    page: number = 1, 
    limit: number = 50
  ): Promise<{ data: AuditLog[], total: number, page: number, pages: number }> {
    const [data, total] = await this.auditLogRepo.findAndCount({
      where: { updatedBy: userId },
      order: { updatedAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  // Get logs for a specific user and entity type
  async getLogsByUserAndEntity(
    userId: string, 
    entityName: string
  ): Promise<AuditLog[]> {
    return this.auditLogRepo.find({
      where: { 
        updatedBy: userId,
        entityName: entityName 
      },
      order: { updatedAt: "DESC" },
    });
  }

  // Get logs for a specific user within a date range
  async getLogsByUserAndDateRange(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<AuditLog[]> {
    return this.auditLogRepo
      .createQueryBuilder('auditLog')
      .where('auditLog.updatedBy = :userId', { userId })
      .andWhere('auditLog.updatedAt >= :startDate', { startDate })
      .andWhere('auditLog.updatedAt <= :endDate', { endDate })
      .orderBy('auditLog.updatedAt', 'DESC')
      .getMany();
  }

  // Get comprehensive user activity report
  async getUserActivityReport(userId: string): Promise<{
    totalChanges: number;
    entitiesModified: { entityName: string; count: number }[];
    recentActivity: AuditLog[];
    dateRange: { firstActivity: Date | null; lastActivity: Date | null };
  }> {
    const logs = await this.getLogsByUser(userId);
    
    // Count entities modified
    const entityCounts: Record<string, number> = {};
    logs.forEach(log => {
      entityCounts[log.entityName] = (entityCounts[log.entityName] || 0) + 1;
    });

    const entitiesModified = Object.entries(entityCounts).map(([entityName, count]) => ({
      entityName,
      count
    }));

    return {
      totalChanges: logs.length,
      entitiesModified,
      recentActivity: logs.slice(0, 10), // Last 10 activities
      dateRange: {
        firstActivity: logs.length > 0 ? logs[logs.length - 1].updatedAt : null,
        lastActivity: logs.length > 0 ? logs[0].updatedAt : null,
      }
    };
  }
}
