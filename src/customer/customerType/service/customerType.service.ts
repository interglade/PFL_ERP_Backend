import { inject, injectable } from 'inversify';
import { DataSource, In } from 'typeorm';


import { CustomerTypeRepository } from '../repository/customerType.repository';
import { TYPES } from '../../../types';
import { CacheService } from '../../../global/cache.service';
import { AuditLogService } from '../../../employeeActivity/service/auditLog.service';
import { CustomerType } from '../entity/customerType.entity';
import { buildQuery, PaginationOptions } from '../../../utils/pagination';
import { CreateCustomerTypeDto, CustomerTypeResponseDto, PaginatedResponse } from '../../addcustomer/dto/createCustomer.dto';
import AppError from '../../../utils/appError';

const CACHE_PREFIX = 'customerType';
const CACHE_TTL = 300;        // 5 min for lists
const CACHE_TTL_DETAIL = 300; // 5 min for single record

@injectable()
export class CustomerTypeService {
  private customerTypeRepository: CustomerTypeRepository;

  constructor(
    @inject(TYPES.DataSource) private dataSource: DataSource,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {
    this.customerTypeRepository = this.dataSource.getRepository(
      CustomerType,
    ) as CustomerTypeRepository;
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

  async getAllCustomerTypes(queryOptions: PaginationOptions): Promise<PaginatedResponse<CustomerTypeResponseDto>> {
    const key = `${CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.customerTypeRepository
      .createQueryBuilder('customerType')
      .select(['customerType.id', 'customerType.name'])
      .orderBy('customerType.createdAt', 'DESC');

    const result = await buildQuery(queryBuilder, queryOptions, 'customerType');

    const formatted: PaginatedResponse<CustomerTypeResponseDto> = {
      ...result,
      data: result.data.map((cust: any) => ({
        id: cust.id,
        name: cust.name,
      })),
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  async getCustomerTypeById(id: string): Promise<CustomerTypeResponseDto | null> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<CustomerType>(key);
    if (cached) return cached;

    const customerType = await this.customerTypeRepository
      .createQueryBuilder('customerType')
      .select(['customerType.id', 'customerType.name'])
      .where('customerType.id = :id', { id })
      .getOne();

       if (!customerType) {
    return null;
  }

    const response: CustomerTypeResponseDto = {
    id: customerType.id,
    name: customerType.name,
  };

    if (customerType) await this.cacheService.set(key, customerType, CACHE_TTL_DETAIL);
    return response;
  }

  async createCustomerType(dto: CreateCustomerTypeDto): Promise<CustomerType> {
    const customerType = this.customerTypeRepository.create({ name: dto.name });
    const saved = await this.customerTypeRepository.save(customerType);
    await this.invalidateCache();
    return saved;
  }

  public async updateCustomerType(
    id: string,
    dto: CreateCustomerTypeDto,
    updatedBy: string,
  ): Promise<CustomerType | null> {
    const customerType = await this.customerTypeRepository.findOneBy({ id });

    if (!customerType) {
      return null;
    }

    await this.auditLogService.logChange(
      'CustomerType',
      id,
      customerType,
      { name: dto.name },
      updatedBy,
    );

    customerType.name = dto.name;
    const saved = await this.customerTypeRepository.save(customerType);
    await this.invalidateCache(id);
    return saved;
  }

  public async deleteCustomerType(id: string): Promise<{ name: string } | null> {
    const customerType = await this.customerTypeRepository.findOne({
      where: { id },
    });

    if (!customerType) {
      throw new AppError(404, `Customer Type with ID ${id} not found`);
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    customerType.deletionScheduledAt = sixMonthsFromNow;
    await this.customerTypeRepository.save(customerType);
    await this.invalidateCache(id);

    return { name: customerType.name };
  }

  async softDeleteCustomerType(typeIds: string[]): Promise<{ affected?: number | null; deleted: { id: string; name: string }[] }> {
    // Fetch names before deletion for activity log
    const types = await this.customerTypeRepository.find({
      where: { id: In(typeIds) },
      select: ['id', 'name'],
    });
    const deleted = types.map(t => ({ id: t.id, name: t.name }));

    const result = await this.customerTypeRepository.softDelete({
      id: In(typeIds),
    });
    await this.invalidateCache();
    return { affected: result.affected, deleted };
  }
}
