import { inject, injectable } from "inversify";
import { TYPES } from "../../types";
import AppError from "../../utils/appError";
import { buildQuery, PaginationOptions } from "../../utils/pagination";
import { CacheService } from "../../global/cache.service";
import { LaborRepository } from "../repository/labor.repository";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { Labor } from "../entity/labor.entity";

@injectable()
export class LaborService {
  constructor(
    @inject(TYPES.LaborRepository)
    private readonly laborRepository: LaborRepository,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  private readonly CACHE_PREFIX = 'labor';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
    ];
    if (id) {
      tasks.push(this.cacheService.del(`${this.CACHE_PREFIX}:id:${id}`));
    }
    await Promise.all(tasks);
  }

  async createLabor(laborData: Partial<Labor>): Promise<Labor> {
    const labor = this.laborRepository.create(laborData);
    const saved = await this.laborRepository.save(labor);
    await this.invalidateCache();
    return saved;
  }

  async getLaborById(id: string): Promise<Labor | null> {
    const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const result = await this.laborRepository.findOne({
      where: { id },
      relations: ["bankDetails", "familyDetails", "workExperience", "presentAddress", "permanentAddress"],
    });
    if (result) await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  async getAllLabors(queryOptions: PaginationOptions): Promise<any> {
    const cacheKey = `${this.CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const query = this.laborRepository.createQueryBuilder("labor")
      .leftJoinAndSelect("labor.bankDetails", "bankDetails")
      .leftJoinAndSelect("labor.familyDetails", "familyDetails")
      .leftJoinAndSelect("labor.workExperience", "workExperience")
      .leftJoinAndSelect("labor.presentAddress", "presentAddress")
      .leftJoinAndSelect("labor.permanentAddress", "permanentAddress")
      .orderBy("labor.createdAt", "DESC");

    const result = await buildQuery(query, queryOptions, "labor");
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  async updateLabor(id: string, laborData: any, updatedBy: string): Promise<any> {
    
    const labor = await this.laborRepository.findOne({
      where: { id },
      relations: ["workExperience", "familyDetails", "bankDetails", "permanentAddress", "presentAddress"],
    });

    if (!labor) {
      return null;
    }

    const oldData = { ...labor };
    Object.assign(labor, laborData);

    const updatedLabor = await this.laborRepository.save(labor);
   

    await this.auditLogService.logChange("Labor", id, oldData, updatedLabor, updatedBy);
    await this.invalidateCache(id);
    return updatedLabor;
  }

  async deleteLabor(id: string): Promise<boolean> {
    const labor = await this.laborRepository.findOne({ where: { id } });

    if (!labor) {
      throw new AppError(404, `Labor with ID ${id} not found`);
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    
    labor.deletionScheduledAt = sixMonthsFromNow;
    await this.laborRepository.save(labor);

   
    await this.invalidateCache(id);
    return true;
  }
}
