import { inject, injectable } from 'inversify';
import { TYPES } from '../../types';
import { PackingMaterialRepository } from '../repository/packingMaterial.repository';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { CacheService } from '../../global/cache.service';
import { buildQuery, PaginationOptions } from '../../utils/pagination';
import { BulkDeletePackingMaterialResultDto, CreatePackingMaterialDto, PackingMaterialDetailDto, PackingMaterialListResponseDto, PackingMaterialPartialDto, UpdatePackingMaterialDto } from '../dto/packingMaterial.dto';
import { PackingMaterial } from '../entity/packingMaterial.entity';
import AppError from '../../utils/appError';



const CACHE_PREFIX = 'packingMaterial';
const CACHE_TTL = 300; // 5 minutes

@injectable()
export class PackingMaterialService {
  constructor(
    @inject(TYPES.PackingMaterialRepository)
    private readonly packingMaterialRepository: PackingMaterialRepository,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  // ─── Cache Helpers ────────────────────────────────────────────────────────

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
      this.cacheService.del(`${CACHE_PREFIX}:partial`),
      this.cacheService.del(`${CACHE_PREFIX}:dropdown`),
    ];
    if (id) {
      tasks.push(this.cacheService.del(`${CACHE_PREFIX}:id:${id}`));
    }
    await Promise.all(tasks);
  }

  // ─── Methods ──────────────────────────────────────────────────────────────

  async getAll(queryOptions: PaginationOptions): Promise<PackingMaterialListResponseDto> {
    const key = `${CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.packingMaterialRepository
      .createQueryBuilder('post_packaging_material')
      .leftJoin('post_packaging_material.uom', 'uom')
      .select([
        'post_packaging_material.id',
        'post_packaging_material.packagingMaterialName',
        'post_packaging_material.packagingMaterialWeight',
        'post_packaging_material.packagingMaterialDescription',
        'post_packaging_material.containsQuantity',
        'uom.id',
        'uom.unit',
      ])
      .orderBy('post_packaging_material.createdAt', 'DESC');

    const data = await buildQuery(queryBuilder, queryOptions, 'post_packaging_material');

    const formatted = {
      formatResponse: data.data.map((material) => ({
        id: material.id,
        packagingMaterialName: material.packagingMaterialName,
        packagingMaterialWeight: material.packagingMaterialWeight,
        packagingMaterialDescription: material.packagingMaterialDescription,
        uom: material.uom?.unit ?? null,
        containsQuantity: material.containsQuantity,
      })),
      data1: data.meta,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  async getMaterialById(id: string): Promise<PackingMaterialDetailDto> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const material = await this.packingMaterialRepository
      .createQueryBuilder('post_packaging_material')
      .leftJoin('post_packaging_material.uom', 'uom')
      .select([
        'post_packaging_material.id',
        'post_packaging_material.packagingMaterialName',
        'post_packaging_material.packagingMaterialWeight',
        'post_packaging_material.packagingMaterialDescription',
        'post_packaging_material.useFor',
        'post_packaging_material.containsQuantity',
        'uom.id',
      ])
      .where('post_packaging_material.id = :id', { id })
      .getOne();

    if (!material) {
      throw new Error('Material not found');
    }

    const formatted = {
      id: material.id,
      packagingMaterialName: material.packagingMaterialName,
      packagingMaterialWeight: material.packagingMaterialWeight,
      packagingMaterialDescription: material.packagingMaterialDescription,
      useFor: material.useFor,
      uom: material.uom?.id ?? null,
      containsQuantity: material.containsQuantity,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }



  async getAllPartial(): Promise<PackingMaterialPartialDto[]> {
    const key = `${CACHE_PREFIX}:partial`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const data = await this.packingMaterialRepository
      .createQueryBuilder('post_packaging_material')
      .select([
        'post_packaging_material.id',
        'post_packaging_material.packagingMaterialName',
        'post_packaging_material.packagingMaterialWeight',
      ])
      .orderBy('post_packaging_material.packagingMaterialName', 'ASC')
      .getMany();

    const formatted = data.map((material) => ({
      id: material.id,
      packagingMaterialName: material.packagingMaterialName,
      packagingMaterialWeight: material.packagingMaterialWeight,
    }));

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  async createPackingMaterial(data: CreatePackingMaterialDto): Promise<PackingMaterial> {
    const material = this.packingMaterialRepository.create(data as any) as unknown as PackingMaterial;
    const saved = await this.packingMaterialRepository.save(material) as unknown as PackingMaterial;
    await this.invalidateCache();
    return saved;
  }

  async updatePackingMaterial(id: string, data: UpdatePackingMaterialDto, updatedBy: string): Promise<PackingMaterial> {
    const material = await this.packingMaterialRepository.findOne({ where: { id } });

    if (!material) {
      throw new AppError(404, `packing material with ID ${id} not found`);
    }

    const oldData = { ...material };
    Object.assign(material, data);

    const updated = await this.packingMaterialRepository.save(material);

    await this.auditLogService.logChange(
      'post_packaging_material',
      id,
      oldData,
      updated,
      updatedBy,
    );

    await this.invalidateCache(id);
    return updated;
  }

  async deleteMultiplePackingMaterials(ids: string[]): Promise<BulkDeletePackingMaterialResultDto> {
    const success: string[] = [];
    const failed: { id: string; reason: string }[] = [];

    for (const id of ids) {
      try {
        const material = await this.packingMaterialRepository.findOne({ where: {id:id} });
        if (!material) {
          failed.push({ id, reason: 'Packing material not found' });
          continue;
        }

        await this.packingMaterialRepository.softDelete(id);
        await this.invalidateCache(id);
        success.push(id);
      } catch (error: any) {
        failed.push({ id, reason: error.message || 'Unknown error' });
      }
    }

    const message = `Deletion completed. Success: ${success.length}, Failed: ${failed.length}`;
    return { success, failed, message };
  }
}


  // async findAllPackingMaterial(): Promise<PackingMaterialDropdownDto[]> {
  //   const key = `${CACHE_PREFIX}:dropdown`;
  //   const cached = await this.cacheService.get<any>(key);
  //   if (cached) return cached;

  //   const materials = await this.packingMaterialRepository
  //     .createQueryBuilder('post_packaging_material')
  //     .select([
  //       'post_packaging_material.id',
  //       'post_packaging_material.packagingMaterialName',
  //     ])
  //     .orderBy('post_packaging_material.packagingMaterialName', 'ASC')
  //     .getMany();

  //   const formatted = materials.map((mat) => ({
  //     id: mat.id,
  //     name: mat.packagingMaterialName,
  //   }));

  //   await this.cacheService.set(key, formatted, CACHE_TTL);
  //   return formatted;
  // }

