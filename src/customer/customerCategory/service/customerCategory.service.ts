// customerCategory.service.ts
import { inject, injectable } from 'inversify';
import { CustomerCategoryRepository } from '../repository/customerCategory.repository';
import { CustomerCategory } from '../entity/customerCategory.entity';
import { DataSource, In } from 'typeorm';


import { TYPES } from '../../../types';
import { AuditLogService } from '../../../employeeActivity/service/auditLog.service';
import { CacheService } from '../../../global/cache.service';
import { buildQuery, PaginationOptions } from '../../../utils/pagination';
import AppError from '../../../utils/appError';
import { CreateCustomerCategoryDto, CustomerCategoryResponseDto, PaginatedResponse } from '../../addcustomer/dto/createCustomer.dto';

const CACHE_PREFIX = 'customerCategory';
const CACHE_TTL = 300;       // 5 min for lists
const CACHE_TTL_DETAIL = 300; // 5 min for single record

@injectable()
export class CustomerCategoryService {
  private customerCategoryRepository: CustomerCategoryRepository;

  constructor(
    @inject(TYPES.DataSource) private dataSource: DataSource,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {
    this.customerCategoryRepository = this.dataSource.getRepository(
      CustomerCategory,
    ) as CustomerCategoryRepository;
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

  public async getAll(queryOptions: PaginationOptions): Promise<PaginatedResponse<CustomerCategoryResponseDto>> {
    const key = `${CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.customerCategoryRepository
      .createQueryBuilder('customerCategory')
      .select(['customerCategory.id', 'customerCategory.name'])
      .orderBy('customerCategory.createdAt', 'DESC');

    const result = await buildQuery(queryBuilder, queryOptions, 'customerCategory');

    const formatted:PaginatedResponse<CustomerCategoryResponseDto> = {
      data: result.data.map((category) => ({
        id: category.id,
        name: category.name,
      })),
      meta: result.meta,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  public async getById(id: string): Promise<CustomerCategoryResponseDto | null> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<CustomerCategory>(key);
    if (cached) return cached;

    const category: CustomerCategoryResponseDto | null = await this.customerCategoryRepository
      .createQueryBuilder('customerCategory')
      .select(['customerCategory.id', 'customerCategory.name'])
      .where('customerCategory.id = :id', { id })
      .getOne();

    if (category) await this.cacheService.set(key, category, CACHE_TTL_DETAIL);
    return category;
  }

  public async create(
    categoryData: CreateCustomerCategoryDto,
  ): Promise<CustomerCategory> {
    const category = this.customerCategoryRepository.create(categoryData);
    const saved = await this.customerCategoryRepository.save(category);
    await this.invalidateCache();
    return saved;
  }

  public async update(
    id: string,
    categoryData: CreateCustomerCategoryDto,
    updatedBy: string,
  ): Promise<CustomerCategoryResponseDto | null> {
    const existingCategory = await this.customerCategoryRepository.findOne({
      where: { id },
    });

    if (!existingCategory) {
      throw new Error('Customer Category not found');
    }

    await this.auditLogService.logChange(
      'CustomerCategory',
      id,
      existingCategory,
      categoryData,
      updatedBy,
    );

    await this.customerCategoryRepository.update(id, categoryData);
    await this.invalidateCache(id);

    return this.getById(id);
  }

  public async deleteCustomerCategory(id: string): Promise<{ name: string } | null> {
    const customerCategory = await this.customerCategoryRepository.findOne({
      where: { id },
    });

    if (!customerCategory) {
      throw new AppError(404, `Customer Category with ID ${id} not found`);
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    customerCategory.deletionScheduledAt = sixMonthsFromNow;
    await this.customerCategoryRepository.save(customerCategory);
    await this.invalidateCache(id);

    return { name: customerCategory.name };
  }

  async softDeleteCustomerCategory(ids: string[]): Promise<{ affected?: number | null; deleted: { id: string; name: string }[] }> {
    // Fetch names before deletion for activity log
    const categories = await this.customerCategoryRepository.find({
      where: { id: In(ids) },
      select: ['id', 'name'],
    });
    const deleted = categories.map(c => ({ id: c.id, name: c.name }));

    const result = await this.customerCategoryRepository.softDelete({
      id: In(ids),
    });
    await this.invalidateCache();
    return { affected: result.affected, deleted };
  }
}
