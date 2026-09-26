import { inject, injectable } from 'inversify';
import { TYPES } from '../../types';

import { CacheService } from '../../global/cache.service';
import AppError from '../../utils/appError';
import { buildQuery, PaginationOptions } from '../../utils/pagination';
import { In } from 'typeorm';
import {
  CreateBranchDto,
  UpdateBranchDto,
  BranchDetailDto,
  BranchListResponseDto,
  BranchFilterItemDto,
  BulkDeleteBranchResultDto,
  DeleteBranchResultDto,
  DeletedBranchItemDto,
} from '../dto/branch.dto';
import { BranchessRepository } from '../repository/branches.repository';
import { AddressService } from '../../address/service/address.service';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { Branches, BranchType } from '../entity/branches.entity';

const CACHE_TTL = 300; // 5 minutes
const CACHE_PREFIX = 'branches';

@injectable()
export class BranchessService {
  constructor(
    @inject(TYPES.BranchessRepository)
    private readonly branchesRepository: BranchessRepository,
    @inject(TYPES.AddressService)
    private readonly addressService: AddressService,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  // ─── Cache Helpers ────────────────────────────────────────────────────────

  private cacheKey(...parts: string[]): string {
    return this.cacheService.generateKey(CACHE_PREFIX, ...parts);
  }

  private async invalidateBranchCache(id?: string, branchType?: string): Promise<void> {
    await this.cacheService.invalidatePattern(`${CACHE_PREFIX}:*`);
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async createBranch(branchData: CreateBranchDto & Record<string, any>): Promise<Branches> {
    const { address, totalCapacity, ...data } = branchData;

    const newAddress = await this.addressService.create(address as any);

    const branch = this.branchesRepository.create({
      ...data,
      address: newAddress,
      totalCapacity,
    } as any) as unknown as Branches;

    const saved = await this.branchesRepository.save(branch) as unknown as Branches;
    await this.invalidateBranchCache();
    return saved;
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async updateBranch(id: string, branchData: UpdateBranchDto & Record<string, any>, updatedBy: string): Promise<Branches | null> {
    const branch = await this.branchesRepository.findOne({
      where: { id },
      relations: ['address'],
    });

    if (!branch) return null;

    const originalBranch = { ...branch };

    // Recalculate balanceCapacity if capacities changed
    if (branchData.currentCapacity !== undefined || branchData.totalCapacity !== undefined) {
      const currentCapacity = branchData.currentCapacity ?? branch.currentCapacity;
      const totalCapacity = branchData.totalCapacity ?? branch.totalCapacity;
      branchData.balanceCapacity = totalCapacity - currentCapacity;
    }

    if (branchData.address) {
      const originalAddress = { ...branch.address };
      const updatedAddress = await this.addressService.update(branch.address.id, branchData.address as any);
      if (!updatedAddress) throw new Error('Failed to update address');

      await this.auditLogService.logChange('Address', branch.address.id, originalAddress, updatedAddress, updatedBy);
      branch.address = updatedAddress;
    }

    Object.assign(branch, branchData);
    const updatedBranch = await this.branchesRepository.save(branch);

    await this.auditLogService.logChange('Branches', id, originalBranch, updatedBranch, updatedBy);
    await this.invalidateBranchCache(id, branch.type);

    return updatedBranch;
  }

  // ─── Soft Delete Multiple ─────────────────────────────────────────────────

  async softDeleteBranches(ids: string[], branchType: BranchType): Promise<BulkDeleteBranchResultDto & { deleted: { id: string; name: string; type: BranchType }[] }> {
    // Fetch names+types before deletion for activity log
    const branches = await this.branchesRepository.find({
      where: { id: In(ids) },
      select: ['id', 'name', 'type'],
    });
    const deleted = branches.map(b => ({ id: b.id, name: b.name, type: b.type }));

    const result = await this.branchesRepository.softDelete({
      id: In(ids),
    });
    await this.invalidateBranchCache();
    return { ...result, deleted };
  }

  // ─── Get By ID ────────────────────────────────────────────────────────────

  async getBranchByIdAndType(id: string): Promise<BranchDetailDto | null> {
    const key = this.cacheKey('id', id);
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const branch = await this.branchesRepository
      .createQueryBuilder('branch')
      .leftJoin('branch.address', 'address')
      .select([
        'branch.id',
        'branch.name',
        'branch.cFirstName',
        'branch.cMiddleName',
        'branch.cLastName',
        'branch.contactNumber',
        'branch.notes',
        'branch.totalCapacity',
        'branch.currentCapacity',
        'branch.balanceCapacity',
        'branch.type',
        'branch.prefix',
        'address.id',
        'address.address1',
        'address.address2',
        'address.location',
        'address.city',
        'address.state',
        'address.pincode',
      ])
      .where('branch.id = :id', { id })
      .getOne();

    if (branch) await this.cacheService.set(key, branch, CACHE_TTL);
    return branch as BranchDetailDto | null;
  }

  // ─── Get All By Type (paginated) ──────────────────────────────────────────

  async getAllByBranchType(branchType: BranchType, queryOptions: PaginationOptions): Promise<BranchListResponseDto> {
    const key = this.cacheKey('list', branchType, JSON.stringify(queryOptions));
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const qb = this.branchesRepository
      .createQueryBuilder('branch')
      .leftJoin('branch.address', 'address')
      .select([
        'branch.id', 'branch.type', 'branch.name',
        'branch.cFirstName', 'branch.cMiddleName', 'branch.cLastName',
        'branch.contactNumber', 'branch.totalCapacity', 'branch.currentCapacity', 'branch.balanceCapacity',
        'address.id', 'address.address1', 'address.address2',
        'address.city', 'address.location', 'address.pincode', 'address.state',
      ])
      .where('branch.type = :branchType', { branchType })
      .orderBy('branch.createdAt', 'DESC');

    const result = await buildQuery(qb, queryOptions, 'branch');

    const response = {
      data: result.data.map((branch) => ({
        id: branch.id,
        type: branch.type,
        name: branch.name,
        address: {
          id: branch.address?.id,
          address1: branch.address?.address1,
          address2: branch.address?.address2,
          city: branch.address?.city,
          location: branch.address?.location,
          pincode: branch.address?.pincode,
          state: branch.address?.state,
        },
        contactPerson: [branch.cFirstName, branch.cMiddleName, branch.cLastName]
          .filter(Boolean)
          .join(' '),
        contact: branch.contactNumber || '',
        totalCapacity: branch.totalCapacity,
        currentCapacity: branch.currentCapacity,
        balanceCapacity: branch.balanceCapacity,
      })),
      meta: result.meta,
    };

    await this.cacheService.set(key, response, CACHE_TTL);
    return response as BranchListResponseDto;
  }

  // ─── Get Filter Data ──────────────────────────────────────────────────────

  async getAllByFilterDataBranchType(): Promise<BranchFilterItemDto[]> {
    const key = this.cacheKey('filter');
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const branches = await this.branchesRepository.find({
      select: ['id', 'name', 'type'],
    });

    await this.cacheService.set(key, branches, CACHE_TTL);
    return branches as BranchFilterItemDto[];
  }

  // ─── Delete (schedule) ────────────────────────────────────────────────────

  async deleteBranch(id: string, branchType: BranchType): Promise<{ name: string; type: BranchType } | null> {
    const branch = await this.branchesRepository.findOne({
      where: { id, type: branchType },
    });

    if (!branch) throw new AppError(404, `Branch with ID ${id} not found`);

    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    branch.deletionScheduledAt = sixMonthsFromNow;
    await this.branchesRepository.save(branch);

    // Soft delete so it's immediately filtered out from getAll queries
    await this.branchesRepository.softDelete({ id });

    await this.invalidateBranchCache(id, branchType);

    return { name: branch.name, type: branch.type };
  }
}
