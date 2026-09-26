import { inject, injectable } from "inversify";
import { TYPES } from "../../../types";
import { In } from "typeorm";
import { ProductCategoryRepository } from "../repository/product_category.repository";

import AppError from "../../../utils/appError";
import { buildQuery, PaginationOptions } from "../../../utils/pagination";
import { ProductClassificationRepository } from "../../productClassification/repository/product_classification.repository";
import { AuditLogService } from "../../../employeeActivity/service/auditLog.service";
import { CacheService } from "../../../global/cache.service";
import { PaginatedResponse } from "../../../customer/addcustomer/dto/createCustomer.dto";
import { CreateProductCategoryDto, ProductCategoryResponseDto } from "../../createproduct/dto/product.dto";
import { ProductCategory } from "../entity/product_category.entity";


const CACHE_PREFIX = "productCategory";
const CACHE_TTL = 300;

@injectable()
export class ProductCategoryService {
  constructor(
    @inject(TYPES.ProductCategoryRepository)
    private readonly productCategoryRepository: ProductCategoryRepository,
    @inject(TYPES.ProductClassificationRepository)
    private readonly productClassificationRepository: ProductClassificationRepository,
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

  async getAll(queryOptions: PaginationOptions): Promise<PaginatedResponse<ProductCategoryResponseDto>> {
    const key = `${CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.productCategoryRepository
      .createQueryBuilder("productCategory")
      .leftJoin("productCategory.productClassification", "productClassification")
      .select([
        "productCategory.id",
        "productCategory.name",
        "productClassification.id",
        "productClassification.name",
      ])
      .orderBy("productCategory.createdAt", "DESC");

    const result = await buildQuery(queryBuilder, queryOptions, "productCategory");

    const formatted: PaginatedResponse<ProductCategoryResponseDto> = {
      data: result.data.map((pro) => ({
        id: pro.id,
        name: pro.name,
        productClassification: pro.productClassification?.name ?? null,
      })),
      meta: result.meta,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  async getById(id: string): Promise<ProductCategoryResponseDto | null> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const result = await this.productCategoryRepository
      .createQueryBuilder("productCategory")
      .leftJoin("productCategory.productClassification", "productClassification")
      .select([
        "productCategory.id",
        "productCategory.name",
        "productClassification.id",
      ])
      .where("productCategory.id = :id", { id })
      .getOne();

    if (!result) return null;

    const formatted: ProductCategoryResponseDto = {
      id: result.id,
      name: result.name,
      productClassification: result.productClassification?.id ?? null,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  async create(data: CreateProductCategoryDto): Promise<ProductCategory> {
    const productClassification = await this.productClassificationRepository.findOneBy({
      id: data.productClassification,
    });

    if (!productClassification) {
      throw new Error("Product Classification not found");
    }

    const productCategory =
    this.productCategoryRepository.create({
      name: data.name,
      productClassification,
    });

    //const productCategory = this.productCategoryRepository.create({ ...data });
    const saved =
    await this.productCategoryRepository.save(productCategory);
    //const saved = await this.productCategoryRepository.save(productCategory);
    await this.invalidateCache();
    return saved;
  }

  public async update(
    id: string,
    categoryData: CreateProductCategoryDto,
    updatedBy: string,
  ): Promise<ProductCategory | null> {
    const category = await this.productCategoryRepository.findOne({
      where: { id },
      relations: ["productClassification"],
    });

    if (!category) {
      throw new Error(`Product category with ID ${id} not found`);
    }

    const oldData = {
      name: category.name,
      classificationId: category.productClassification?.id,
    };

    if (categoryData.name) {
      category.name = categoryData.name;
    }

    if (categoryData.productClassification) {
      const classification = await this.productClassificationRepository.findOne({
        where: { id: categoryData.productClassification },
      });

      if (!classification) {
        throw new Error(`Product classification with ID ${categoryData.productClassification} not found`);
      }

      category.productClassification = classification;
    }

    const newData = {
      name: category.name,
      productClassification: category.productClassification?.id,
    };

    await this.auditLogService.logChange("ProductCategory", id, oldData, newData, updatedBy);

    const saved = await this.productCategoryRepository.save(category);
    await this.invalidateCache(id);
    return saved;
  }

  public async delete(id: string): Promise<boolean> {
    const category = await this.productCategoryRepository.findOne({ where: { id } });

    if (!category) {
      throw new AppError(400, `Product category with ID ${id} not found`);
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    category.deletionScheduledAt = sixMonthsFromNow;
    await this.productCategoryRepository.save(category);
    await this.invalidateCache(id);

    return true;
  }

  async softDeleteCategory(userIds: string[]) {
    const result = await this.productCategoryRepository.softDelete({ id: In(userIds) });
    await this.invalidateCache();
    return result;
  }
}
