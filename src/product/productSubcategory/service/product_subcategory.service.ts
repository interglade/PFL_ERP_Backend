import { inject, injectable } from "inversify";
import { DataSource, In } from "typeorm";
import { TYPES } from "../../../types";
import { ProductSubcategoryRepository } from "../repository/product_subcategory.repository";
import { AuditLogService } from "../../../employeeActivity/service/auditLog.service";
import { CacheService } from "../../../global/cache.service";
import { ProductSubcategory } from "../entity/product_subcategory.entity";
import { buildQuery, PaginationOptions } from "../../../utils/pagination";
import { PaginatedResponse } from "../../../customer/addcustomer/dto/createCustomer.dto";
import { CreateProductSubcategoryDto, ProductSubcategoryResponseDto } from "../../createproduct/dto/product.dto";
import { ProductCategory } from "../../productCategory/entity/product_category.entity";
;

const CACHE_PREFIX = "productSubcategory";
const CACHE_TTL = 300;

@injectable()
export class ProductSubcategoryService {
  private productSubcategoryRepository: ProductSubcategoryRepository;

  constructor(
    @inject(TYPES.DataSource) private dataSource: DataSource,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {
    this.productSubcategoryRepository = this.dataSource.getRepository(
      ProductSubcategory,
    ) as ProductSubcategoryRepository;
  }

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

  async getAll(queryOptions: PaginationOptions): Promise<PaginatedResponse<ProductSubcategoryResponseDto>> {
    const key = `${CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const baseQuery = this.productSubcategoryRepository
      .createQueryBuilder("productSubcategory")
      .leftJoin("productSubcategory.category", "category")
      .select([
        "productSubcategory.id",
        "productSubcategory.name",
        "category.id",
        "category.name",
      ])
      .orderBy("productSubcategory.createdAt", "DESC");

    const subcategories = await buildQuery(baseQuery, queryOptions, "productSubcategory");

    const formatted:PaginatedResponse<ProductSubcategoryResponseDto> = {
      data: subcategories.data.map((subcategory) => ({
        id: subcategory.id,
        name: subcategory.name,
        category: subcategory.category?.name ?? null,
      })),
      meta: subcategories.meta,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  async getById(id: string): Promise<ProductSubcategoryResponseDto | null> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const result = await this.productSubcategoryRepository
      .createQueryBuilder("productSubcategory")
      .leftJoin("productSubcategory.category", "category")
      .select(["productSubcategory.id", "productSubcategory.name", "category.id"])
      .where("productSubcategory.id = :id", { id })
      .getOne();

    if (!result) return null;

    const formatted : ProductSubcategoryResponseDto = {
      id: result.id,
      name: result.name,
      category: result.category?.id ?? null,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  async create(name: string, category: string): Promise<ProductSubcategory> {
    const subcategory = this.productSubcategoryRepository.create({
      name,
      category: { id: category } as ProductCategory,
    });
    const saved = await this.productSubcategoryRepository.save(subcategory);
    await this.invalidateCache();
    return saved;
  }

  async update(
    id: string,
    subcategoryData: CreateProductSubcategoryDto,
    updatedBy: string,
  ): Promise<ProductSubcategory | null> {
    const existingSubcategory = await this.productSubcategoryRepository.findOne({
      where: { id },
      relations: ["category"],
    });

    if (!existingSubcategory) {
      throw new Error(`Product subcategory with ID ${id} not found`);
    }

    const oldData = { ...existingSubcategory };

    if (subcategoryData.name) {
      existingSubcategory.name = subcategoryData.name;
    }
    if (subcategoryData.category) {
      existingSubcategory.category = { id: subcategoryData.category } as ProductCategory;
    }

    await this.auditLogService.logChange("ProductSubcategory", id, oldData, subcategoryData, updatedBy);

    const saved = await this.productSubcategoryRepository.save(existingSubcategory);
    await this.invalidateCache(id);
    return saved;
  }

  async delete(id: string): Promise<boolean> {
    const subcategory = await this.productSubcategoryRepository.findOne({ where: { id } });

    if (!subcategory) {
      throw new Error(`Product subcategory with ID ${id} not found`);
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    subcategory.deletionScheduledAt = sixMonthsFromNow;
    await this.productSubcategoryRepository.save(subcategory);
    await this.invalidateCache(id);

    return true;
  }

  async softDeleteSubcategory(userIds: string[]) {
    const result = await this.productSubcategoryRepository.softDelete({ id: In(userIds) });
    await this.invalidateCache();
    return result;
  }
}
