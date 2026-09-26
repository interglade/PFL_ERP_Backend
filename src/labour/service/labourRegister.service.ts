import { inject, injectable } from "inversify";
import { Repository } from "typeorm";
import { TYPES } from "../../types";
import { LaborRegisterRepository } from "../repository/labourRegister.repository";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { CacheService } from "../../global/cache.service";
import AppError from "../../utils/appError";
import { LaborRegister } from "../entity/labourregister.entity";
import { buildQuery, PaginationOptions } from "../../utils/pagination";


@injectable()
export class LaborRegisterService {
  constructor(
    @inject(TYPES.LaborRegisterRepository)
    private laborRepository: LaborRegisterRepository,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  private readonly CACHE_PREFIX = 'labour';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${this.CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:search:*`),
      );
    }
    await Promise.all(tasks);
  }

  /**
   * Create a new labor record.
   * @param data - Labor details
   * @returns Created labor record
   */
  async createLabor(data: any): Promise<any> {
    const existingLabor = await this.laborRepository.findOne({
      where: {
        laborName: data.laborName,
        contactNo: data.contactNo,
      
      },
    });

    if (existingLabor) {
      throw new AppError(400, "Laborer with this name and contact already exists.");
    }

    const labor = this.laborRepository.create(data);
    const saved = await this.laborRepository.save(labor);
    await this.invalidateCache();
    return saved;
  }


  /**
   * Update an existing labor record.
   * @param id - Labor ID
   * @param updateData - Data to update
   * @returns Updated labor record
   */
  async updateLabor(
    id: string,
    updateData: any,
    updatedBy: string
  ): Promise<LaborRegister> {
    // Fetch the existing labor record
    const labor = await this.laborRepository.findOne({ where: { id } });
  
    if (!labor) {
      throw new AppError(404, "Laborer not found.");
    }
  
    // Save the original data for audit logging
    const oldData = { ...labor };
  
    // Apply the updates to the existing labor record
    Object.assign(labor, updateData);
  
    // Save the updated labor record
    const updatedLabor = await this.laborRepository.save(labor);
  
    // Log the changes using AuditLogService
    await this.auditLogService.logChange(
      'LaborRegister',
      id,
      oldData,
      updatedLabor,
      updatedBy
    );

    await this.invalidateCache(id);
    return updatedLabor;
  }
  

  /**
   * Delete a labor record by ID.
   * @param id - Labor ID
   * @returns Boolean indicating success or failure
   */
  async deleteLabor(id: string): Promise<boolean> {
    // Find the laborer by ID
    const labor = await this.laborRepository.findOne({ where: { id } });
  
    if (!labor) {
      throw new AppError(404, `Laborer with ID ${id} not found`);
    }
  
    // Calculate the date 6 months ahead
    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6); // Adds 6 months to the current date
    sixMonthsFromNow.setHours(0, 0, 0, 0); // Optionally, set the time to midnight (00:00:00)
  

  
    // Set the deletionScheduledAt field for the laborer
    labor.deletionScheduledAt = sixMonthsFromNow;
  
    // Save the updated laborer with the scheduled deletion date
    await this.laborRepository.save(labor);
  

    await this.invalidateCache(id);
    return true;
  }
  

  /**
   * Get all laborers.
   * @returns List of all labor records
   */
  async getAllLaborers(queryOptions: PaginationOptions): Promise<any> {
    const cacheKey = `${this.CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    let query = await this.laborRepository.createQueryBuilder("labor");
    const result = await buildQuery(query, queryOptions, "labor");
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

 /**
 * Get a labor record by ID.
 * @param id - Labor ID
 * @returns Found labor record or null
 */
async getLaborById(id: string): Promise<LaborRegister | null> {
  const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
  const cached = await this.cacheService.get<any>(cacheKey);
  if (cached) return cached;

  const labor = await this.laborRepository.findOne({
    where: { id },
    relations: ['attendances'],
  });

  if (!labor) {
    throw new AppError(404, `Laborer with ID ${id} not found.`);
  }

  await this.cacheService.set(cacheKey, labor, this.CACHE_TTL);
  return labor;
}


public async deleteMultipleLabourRegister(ids: string[]): Promise<{ success: string[]; failed: { id: string; reason: string }[]; message: string }> {
  const success: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      const labourRegister = await this.laborRepository.findOne({
        where: { id },
      });
      if (!labourRegister) {
        failed.push({ id, reason: 'Labour Register not found' });
        continue;
      }
      

      const deleteAqr = await this.laborRepository.delete(labourRegister.id);
      if (!deleteAqr) {
        throw new Error(`Failed to delete Labour Register with ID ${id}`);
      }
      success.push(id);
    } catch (error: any) {
      failed.push({ id, reason: error.message || 'Unknown error' });
    }
  }
  const message = `Deletion completed. Success: ${success.length}, Failed: ${failed.length}`;
  await this.invalidateCache();
  return { success, failed, message };
}


}


  // /**
  //  * Find a laborer by name, contact, and location.
  //  * @param name - Labor name
  //  * @param contactNo - Contact number
  //  * @param location - Location
  //  * @returns Found labor record or null
  //  */
  // async findLaborByNameAndContact(laborName: string, contactNo: string): Promise<LaborRegister | null> {
  //   const cacheKey = `${this.CACHE_PREFIX}:search:${laborName}:${contactNo}`;
  //   const cached = await this.cacheService.get<any>(cacheKey);
  //   if (cached) return cached;

  //   const result = await this.laborRepository.findOne({
  //     where: { laborName, contactNo },
  //   });
  //   if (result) await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
  //   return result;
  // }


