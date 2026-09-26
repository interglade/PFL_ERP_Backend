import { inject, injectable } from "inversify";

import { In } from "typeorm";
import { TYPES } from "../../types";
import { OfficesRepository } from "../repository/offices.repository";
import { AddressService } from "../../address/service/address.service";
import { CacheService } from "../../global/cache.service";
import { BulkDeleteOfficeResultDto, CreateOfficeDto, OfficeDetailDto, OfficeFilterItemDto, OfficeListResponseDto, OfficeSearchItemDto, UpdateOfficeDto } from "../dto/office.dto";
import { OFFICE_TYPE, OfficesData } from "../entity/offices.entity";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { buildQuery, PaginationOptions } from "../../utils/pagination";
import AppError from "../../utils/appError";


@injectable()
export class OfficesService {
  constructor(
    @inject(TYPES.OfficesRepository)
    private readonly officesRepository: OfficesRepository,
    @inject(TYPES.AddressService)
    private readonly addressService: AddressService,
    @inject(TYPES.AuditLogService) private readonly auditLogService: AuditLogService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  private readonly CACHE_PREFIX = 'office';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:type:*`),
      this.cacheService.del(`${this.CACHE_PREFIX}:all`),
      this.cacheService.del(`${this.CACHE_PREFIX}:filter`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${this.CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:idtype:${id}`),
      );
    }
    await Promise.all(tasks);
  }

  async createOffice(officeData: CreateOfficeDto & Record<string, any>): Promise<OfficesData> {
    const { address, capacity, ...data } = officeData;

    const newAddress = await this.addressService.create(address as any);

    const office = this.officesRepository.create({
      ...data,
      address: newAddress,
      capacity,
    } as any) as unknown as OfficesData;

    const saved = await this.officesRepository.save(office) as unknown as OfficesData;
    await this.invalidateCache();
    return saved;
  }

  public async updateOffice(
    id: string,
    officeData: UpdateOfficeDto & Record<string, any>,
    updatedBy: string,
  ): Promise<OfficesData | null> {
    const office = await this.officesRepository.findOne({
      where: { id },
      relations: ['address'],
    });

    if (!office) return null;

    const previousOfficeData = { ...office };

    await this.auditLogService.logChange('Office', id, previousOfficeData, officeData, updatedBy);

    if (officeData.address) {
      const previousAddressData = { ...office.address };

      const updatedAddress = await this.addressService.update(office.address.id, officeData.address as any);

      if (!updatedAddress) {
        throw new Error("Failed to update address");
      }

      await this.auditLogService.logChange('Address', office.address.id, previousAddressData, officeData.address, updatedBy);

      office.address = updatedAddress;
    }

    Object.assign(office, officeData);

    const saved = await this.officesRepository.save(office);
    await this.invalidateCache(id);
    return saved;
  }

  async softDeleteOffices(userIds: string[], officeType: OFFICE_TYPE): Promise<BulkDeleteOfficeResultDto> {
    const result = await this.officesRepository.softDelete({
      id: In(userIds),
      //type: officeType,
    });
    await this.invalidateCache();
    return result;
  }

  async getOfficeByIdAndType(id: string, officeType: OFFICE_TYPE): Promise<OfficeDetailDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:idtype:${id}:${officeType}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const result = await this.officesRepository
      .createQueryBuilder('offices')
      .leftJoin('offices.address', 'address')
      .select([
        'offices.id',
        'offices.name',
        'offices.officeEmail',
        'offices.contactNumber',
        'offices.cFirstName',
        'offices.cMiddleName',
        'offices.cLastName',
        'offices.notes',
        'offices.type',
        'address.id',
        'address.address1',
        'address.address2',
        'address.location',
        'address.city',
        'address.state',
        'address.pincode',
      ])
      .where('offices.id = :id AND offices.type = :officeType', { id, officeType })
      .getOne();

    if (result) await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result as unknown as OfficeDetailDto | null;
  }

  async getOfficeById(id: string): Promise<OfficesData | null> {
    const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const result = await this.officesRepository.findOne({
      where: { id },
      relations: ['address'],
    });
    if (result) await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  async getOfficesByType(officeType: OFFICE_TYPE): Promise<OfficeSearchItemDto[]> {
    const cacheKey = `${this.CACHE_PREFIX}:type:${officeType}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const result = await this.officesRepository.find({
      where: { type: officeType },
      relations: ['address'],
    });
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result as unknown as OfficeSearchItemDto[];
  }

  async getAllByFilterDataOffice(): Promise<OfficeFilterItemDto[]> {
    const cacheKey = `${this.CACHE_PREFIX}:filter`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const result = await this.officesRepository.find({
      select: ['id', 'name', 'type'],
    });
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result as OfficeFilterItemDto[];
  }

  async getOfficesByType1(officeType: OFFICE_TYPE, queryOptions: PaginationOptions): Promise<OfficeListResponseDto> {
    const cacheKey = `${this.CACHE_PREFIX}:list:${officeType}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const queryBuilder = this.officesRepository
      .createQueryBuilder('offices')
      .leftJoin('offices.address', 'address')
      .select([
        'offices.id',
        'offices.name',
        'offices.officeEmail',
        'offices.contactNumber',
        'offices.cFirstName',
        'offices.cMiddleName',
        'offices.cLastName',
        'offices.notes',
        'offices.type',
        'address.id', 'address.address1', 'address.address2',
        'address.city', 'address.location', 'address.pincode', 'address.state',
      ])
      .where('offices.type = :officeType', { officeType })
      .orderBy('offices.createdAt', 'DESC');

    const result = await buildQuery(queryBuilder, queryOptions, 'offices');
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result as unknown as OfficeListResponseDto;
  }



  async deleteOffice(id: string, officeType: OFFICE_TYPE): Promise<boolean> {
    const office = await this.officesRepository.findOne({
      where: { id, type: officeType },
    });

    if (!office) {
      throw new AppError(404, `Office with ID ${id} and type ${officeType} not found`);
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    office.deletionScheduledAt = sixMonthsFromNow;

    await this.officesRepository.save(office);
    await this.invalidateCache(id);
    return true;
  }
}


  // async getAllOffice(): Promise<OfficeSearchItemDto[]> {
  //   const cacheKey = `${this.CACHE_PREFIX}:all`;
  //   const cached = await this.cacheService.get<any>(cacheKey);
  //   if (cached) return cached;

  //   const result = await this.officesRepository.find({
  //     relations: ['address'],
  //   });
  //   await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
  //   return result as unknown as OfficeSearchItemDto[];
  // }

