import "reflect-metadata";
import { inject, injectable } from "inversify";
import { In } from "typeorm";
import { VendorSubcategoryRepository } from "../repository/vendorSubcategory.repository";

import { TYPES } from "../../../types";

import AppError from "../../../utils/appError";
import { buildQuery, PaginationOptions } from "../../../utils/pagination";

import {
  CreateVendorSubcategoryDto,
  UpdateVendorSubcategoryDto,
  VendorSubcategoryResponseDto,
  VendorSubcategoryListResponseDto,
  VendorSubcategoryListItemDto,
  VendorSubcategoryDropdownDto,
} from "../dto/vendorSubcategory.dto";
import { VendorCategoryRepository } from "../../vendorCategory/repository/vendorCategory.repository";
import { AuditLogService } from "../../../employeeActivity/service/auditLog.service";
import { CacheService } from "../../../global/cache.service";
import { VendorSubcategory } from "../entity/vendorSubcategory.entity";

const CACHE_PREFIX = "vendorSubcategory";
const CACHE_TTL = 300;

@injectable()
export class VendorSubcategoryService {
  constructor(
    @inject(TYPES.VendorSubcategoryRepository)
    private readonly vendorSubcategoryRepository: VendorSubcategoryRepository,
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
      this.cacheService.del(`${CACHE_PREFIX}:bycategory:all`),
    ];
    if (id) {
      tasks.push(this.cacheService.del(`${CACHE_PREFIX}:id:${id}`));
    }
    await Promise.all(tasks);
  }

  // ─── Methods ──────────────────────────────────────────────────────────────

  public async create(subcategoryData: CreateVendorSubcategoryDto): Promise<VendorSubcategory | null> {
    const vendorCategory = await this.vendorCategoryRepository.findOne({
      where: { id: subcategoryData.category },
    });

    if (!vendorCategory) {
      throw new Error(`Vendor category with ID ${subcategoryData.category} not found`);
    }

    const subcategory = this.vendorSubcategoryRepository.create({
      name: subcategoryData.name,
      category: vendorCategory,
    });

    const saved = await this.vendorSubcategoryRepository.save(subcategory);
    await this.invalidateCache();
    return saved;
  }

  public async getSubcategories(categoryIdOrName?: string): Promise<VendorSubcategoryDropdownDto[]> {
    const cacheKey = `${CACHE_PREFIX}:bycategory:${categoryIdOrName ?? "all"}`;
    const cached = await this.cacheService.get<VendorSubcategoryDropdownDto[]>(cacheKey);
    if (cached) return cached;

    const queryBuilder = this.vendorSubcategoryRepository
      .createQueryBuilder("subcategory")
      .leftJoin("subcategory.category", "category")
      .select(["subcategory.id", "subcategory.name"])
      .orderBy("subcategory.createdAt", "DESC");

    if (categoryIdOrName) {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryIdOrName);
      if (isUUID) {
        queryBuilder.where("subcategory.categoryId = :categoryId", { categoryId: categoryIdOrName });
      } else {
        queryBuilder.where("category.name = :categoryName", { categoryName: categoryIdOrName });
      }
    }

    const result = await queryBuilder.getMany();
    const formatted: VendorSubcategoryDropdownDto[] = result.map((s) => ({
      id: s.id,
      name: s.name,
    }));
    await this.cacheService.set(cacheKey, formatted, CACHE_TTL);
    return formatted;
  }

  public async getByall(queryOptions: PaginationOptions): Promise<VendorSubcategoryListResponseDto> {
    const key = `${CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<VendorSubcategoryListResponseDto>(key);
    if (cached) return cached;

    const baseQuery = this.vendorSubcategoryRepository
      .createQueryBuilder("vendorSubcategory")
      .leftJoin("vendorSubcategory.category", "category")
      .select(["vendorSubcategory.id", "vendorSubcategory.name", "category.name"])
      .orderBy("vendorSubcategory.createdAt", "DESC");

    const result = await buildQuery(baseQuery, queryOptions, "vendorSubcategory");

    const formatted: VendorSubcategoryListResponseDto = {
      data: result.data.map((item: any): VendorSubcategoryListItemDto => ({
        id: item.id,
        name: item.name,
        category: item.category?.name ?? null,
      })),
      meta: result.meta,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  public async getById(id: string): Promise<VendorSubcategoryResponseDto | null> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<VendorSubcategoryResponseDto>(key);
    if (cached) return cached;

    const result = await this.vendorSubcategoryRepository
      .createQueryBuilder("vendorSubcategory")
      .leftJoin("vendorSubcategory.category", "category")
      .select(["vendorSubcategory.id", "vendorSubcategory.name", "category.id"])
      .where("vendorSubcategory.id = :id", { id })
      .getOne();

    if (!result) return null;

    const formatted: VendorSubcategoryResponseDto = {
      id: result.id,
      name: result.name,
      category: result.category?.id ?? null,
    };
    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  public async update(
    id: string,
    subcategoryData: UpdateVendorSubcategoryDto,
    updatedBy: string,
  ): Promise<VendorSubcategory | null> {
    const existingSubcategory = await this.vendorSubcategoryRepository.findOne({ where: { id } });

    if (!existingSubcategory) return null;

    Object.assign(existingSubcategory, subcategoryData);
    const updatedSubcategory = await this.vendorSubcategoryRepository.save(existingSubcategory);

    await this.auditLogService.logChange("VendorSubcategory", id, existingSubcategory, updatedSubcategory, updatedBy);
    await this.invalidateCache(id);

    return updatedSubcategory;
  }

  public async delete(id: string): Promise<boolean> {
    const vendorSubcategory = await this.vendorSubcategoryRepository.findOne({ where: { id } });

    if (!vendorSubcategory) {
      throw new AppError(404, "Vendor Subcategory not found");
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    vendorSubcategory.deletionScheduledAt = sixMonthsFromNow;
    await this.vendorSubcategoryRepository.save(vendorSubcategory);
    await this.invalidateCache(id);

    return true;
  }

  async softDeleteSubcategory(userIds: string[]) {
    const result = await this.vendorSubcategoryRepository.softDelete({ id: In(userIds) });
    await this.invalidateCache();
    return result;
  }
}
