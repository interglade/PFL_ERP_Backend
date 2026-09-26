import { inject, injectable } from "inversify";
import { TYPES } from "../../../types";
import { In } from "typeorm";
import { ProductClassification } from "../entity/product_classification.entity";
import AppError from "../../../utils/appError";
import { buildQuery, PaginationOptions } from "../../../utils/pagination";
import { ProductClassificationRepository } from "../repository/product_classification.repository";
import { AuditLogService } from "../../../employeeActivity/service/auditLog.service";
import { CacheService } from "../../../global/cache.service";
import { PaginatedResponse } from "../../../customer/addcustomer/dto/createCustomer.dto";
import { CreateProductClassificationDto, ProductClassificationResponseDto } from "../../createproduct/dto/product.dto";


const CACHE_PREFIX = "productClassification";
const CACHE_TTL = 300;

@injectable()
export class ProductClassificationService {
  constructor(
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

  async findAll(queryOptions: PaginationOptions): Promise<PaginatedResponse<ProductClassificationResponseDto>> {
    const key = `${CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.productClassificationRepository
      .createQueryBuilder("productClassification")
      .select(["productClassification.id", "productClassification.name"])
      .orderBy("productClassification.createdAt", "DESC");

    const result = await buildQuery(queryBuilder, queryOptions, "productClassification");

    const formatted: PaginatedResponse<ProductClassificationResponseDto> = {
      data: result.data.map((pro) => ({ id: pro.id, name: pro.name })),
      meta: result.meta,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  async findById(id: string): Promise<ProductClassificationResponseDto | null> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<ProductClassification>(key);
    if (cached) return cached;

    const result: ProductClassificationResponseDto | null = await this.productClassificationRepository
      .createQueryBuilder("productClassification")
      .select(["productClassification.id", "productClassification.name"])
      .where("productClassification.id = :id", { id })
      .getOne();

    if (result) await this.cacheService.set(key, result, CACHE_TTL);
    return result;
  }

  async getById(id: string): Promise<ProductClassificationResponseDto | null> {
    return this.findById(id);
  }

  async create(productClassificationData: CreateProductClassificationDto): Promise<ProductClassification> {
    const productClassification = this.productClassificationRepository.create(productClassificationData);
    const saved = await this.productClassificationRepository.save(productClassification);
    await this.invalidateCache();
    return saved;
  }

  public async update(
    id: string,
    productClassificationData: CreateProductClassificationDto,
    updatedBy: string,
  ): Promise<ProductClassification | null> {
    const existingProductClassification = await this.productClassificationRepository.findOneBy({ id });

    if (!existingProductClassification) {
      throw new Error(`Product classification with ID ${id} not found`);
    }

    const oldData = { ...existingProductClassification };
    Object.assign(existingProductClassification, productClassificationData);

    await this.auditLogService.logChange("ProductClassification", id, oldData, productClassificationData, updatedBy);

    const saved = await this.productClassificationRepository.save(existingProductClassification);
    await this.invalidateCache(id);
    return saved;
  }

  public async delete(id: string): Promise<boolean> {
    const classification = await this.productClassificationRepository.findOne({ where: { id } });

    if (!classification) {
      throw new AppError(400, `Product classification with ID ${id} not found`);
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    classification.deletionScheduledAt = sixMonthsFromNow;
    await this.productClassificationRepository.save(classification);
    await this.invalidateCache(id);

    return true;
  }

  async softDeleteClassification(userIds: string[]) {
    const result = await this.productClassificationRepository.softDelete({ id: In(userIds) });
    await this.invalidateCache();
    return result;
  }
}
