import { inject, injectable } from "inversify";

import { VendorCategory } from "../entity/vendorCategory.entity";
import { TYPES } from "../../../types";

import AppError from "../../../utils/appError";
import { buildQuery, PaginationOptions } from "../../../utils/pagination";
import { In } from "typeorm";

import {
  CreateVendorCategoryDto,
  UpdateVendorCategoryDto,
  VendorCategoryResponseDto,
  VendorCategoryListResponseDto,
} from "../dto/vendorCategory.dto";
import { VendorCategoryRepository } from "../repository/vendorCategory.repository";
import { AuditLogService } from "../../../employeeActivity/service/auditLog.service";
import { CacheService } from "../../../global/cache.service";

const CACHE_PREFIX = "vendorCategory";
const CACHE_TTL = 300;

@injectable()
export class VendorCategoryService {
  constructor(
    @inject(TYPES.VendorCategoryRepository)
    private readonly vendorCategoryRepository: VendorCategoryRepository,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  // ─── Cache Helpers ────────────────────────────────────────────────────────

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
    ];
    if (id) {
      tasks.push(this.cacheService.del(`${CACHE_PREFIX}:id:${id}`));
    }
    await Promise.all(tasks);
  }

  // ─── Methods ──────────────────────────────────────────────────────────────

  public async create(categoryData: CreateVendorCategoryDto): Promise<VendorCategory | null> {
    const category = this.vendorCategoryRepository.create(categoryData);
    const saved = await this.vendorCategoryRepository.save(category);
    await this.invalidateCache();
    return saved;
  }

  public async getCategories(queryOptions: PaginationOptions): Promise<VendorCategoryListResponseDto> {
    const key = `${CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<VendorCategoryListResponseDto>(key);
    if (cached) return cached;

    const baseQuery = this.vendorCategoryRepository
      .createQueryBuilder("vendorCategory")
      .select(["vendorCategory.id", "vendorCategory.name"])
      .orderBy("vendorCategory.createdAt", "DESC");

    const result = await buildQuery(baseQuery, queryOptions, "vendorCategory");

    const formatted: VendorCategoryListResponseDto = {
      data: result.data.map((category): VendorCategoryResponseDto => ({
        id: category.id,
        name: category.name,
      })),
      meta: result.meta,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  public async getById(id: string): Promise<VendorCategory | null> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<VendorCategory>(key);
    if (cached) return cached;

    const category = await this.vendorCategoryRepository
      .createQueryBuilder("vendorCategory")
      .select(["vendorCategory.id", "vendorCategory.name"])
      .where("vendorCategory.id = :id", { id })
      .getOne();

    if (category) await this.cacheService.set(key, category, CACHE_TTL);
    return category;
  }

  public async update(
    id: string,
    categoryData: UpdateVendorCategoryDto,
    updatedBy: string,
  ): Promise<VendorCategoryResponseDto | null> {
    const existingCategory = await this.vendorCategoryRepository.findOne({ where: { id } });

    if (!existingCategory) {
      throw new AppError(404, `VendorCategory with id ${id} not found`);
    }

    await this.vendorCategoryRepository.update(id, categoryData);
    const updatedCategory = await this.getById(id);

    if (!updatedCategory) {
      throw new AppError(500, "Error retrieving updated category");
    }

    await this.auditLogService.logChange("VendorCategory", id, existingCategory, updatedCategory, updatedBy);
    await this.invalidateCache(id);

    return updatedCategory;
  }

  public async delete(id: string): Promise<boolean> {
    const vendorCategory = await this.vendorCategoryRepository.findOne({ where: { id } });

    if (!vendorCategory) {
      throw new AppError(404, "Vendor Category not found");
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    vendorCategory.deletionScheduledAt = sixMonthsFromNow;
    await this.vendorCategoryRepository.save(vendorCategory);
    await this.invalidateCache(id);

    return true;
  }

  async softDeleteCategory(userIds: string[]) {
    const result = await this.vendorCategoryRepository.softDelete({ id: In(userIds) });
    await this.invalidateCache();
    console.log("updated result",result)
    return result;
  }
}
