import { inject, injectable } from "inversify";
import { UOMConversionMatrixRepository } from "../repository/uomMatrix.repository";
import { TYPES } from "../../types";
import { DataSource, In } from "typeorm";

import { buildQuery, PaginationOptions } from "../../utils/pagination";

import {
  CreateUOMConversionMatrixDto,
  UpdateUOMConversionMatrixDto,
  UOMConversionMatrixListResponseDto,
  UOMConversionMatrixDetailDto,
  UOMConversionMatrixUpdateFormDto,
  BulkDeleteUOMConversionMatrixResultDto,
} from "../dto/uomConversionMatrix.dto";
import { UOMConversionMatrix } from "../entity/uom_matrix.entity";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { CacheService } from "../../global/cache.service";

const CACHE_PREFIX = "uomMatrix";
const CACHE_TTL = 300; // 5 minutes

@injectable()
export class UOMConversionMatrixService {
  private uomConversionMatrixRepository: UOMConversionMatrixRepository;

  constructor(
    @inject(TYPES.DataSource) private dataSource: DataSource,
    @inject(TYPES.AuditLogService) private readonly auditLogService: AuditLogService,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
  ) {
    this.uomConversionMatrixRepository = this.dataSource.getRepository(
      UOMConversionMatrix
    ) as UOMConversionMatrixRepository;
  }

  // ─── Cache Helpers ────────────────────────────────────────────────────────

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
    ];
    if (id) {
      tasks.push(this.cacheService.del(`${CACHE_PREFIX}:id:${id}`));
      tasks.push(this.cacheService.del(`${CACHE_PREFIX}:update:${id}`));
    }
    await Promise.all(tasks);
  }

  // ─── Methods ──────────────────────────────────────────────────────────────

  public async getAll(queryOptions: PaginationOptions): Promise<UOMConversionMatrixListResponseDto> {
    const key = `${CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.uomConversionMatrixRepository
      .createQueryBuilder("uomConversionMatrix")
      .leftJoin("uomConversionMatrix.fromUOM", "fromUOM")
      .leftJoin("uomConversionMatrix.toUOM", "toUOM")
      .select([
        "uomConversionMatrix.id",
        "uomConversionMatrix.conversionFactor",
        "fromUOM.id",
        "fromUOM.unit",
        "toUOM.id",
        "toUOM.unit",
      ])
      .orderBy("uomConversionMatrix.createdAt", "DESC");

    const result = await buildQuery(queryBuilder, queryOptions, "uomConversionMatrix");

    const formatted = {
      data: result.data.map((uom) => ({
        id: uom.id,
        conversionFactor: uom.conversionFactor,
        fromUOM: uom.fromUOM?.unit ?? null,
        toUOM: uom.toUOM?.unit ?? null,
      })),
      meta: result.meta,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  public async getById(id: string): Promise<UOMConversionMatrixDetailDto | null> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const result = await this.uomConversionMatrixRepository
      .createQueryBuilder("uomConversionMatrix")
      .leftJoin("uomConversionMatrix.fromUOM", "fromUOM")
      .leftJoin("uomConversionMatrix.toUOM", "toUOM")
      .select([
        "uomConversionMatrix.id",
        "uomConversionMatrix.conversionFactor",
        "fromUOM.id",
        
        "toUOM.id",
       
      ])
      .where("uomConversionMatrix.id = :id", { id })
      .getOne();

    if (!result) return null;

    const formatted = {
      id: result.id,
      conversionFactor: result.conversionFactor,
      fromUOM: result.fromUOM?.id ?? null,
      toUOM: result.toUOM?.id ?? null,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  // public async getByIdForUpdate(id: string): Promise<UOMConversionMatrixUpdateFormDto | null> {
  //   const key = `${CACHE_PREFIX}:update:${id}`;
  //   const cached = await this.cacheService.get<any>(key);
  //   if (cached) return cached;

  //   const result = await this.uomConversionMatrixRepository
  //     .createQueryBuilder("uomConversionMatrix")
  //     .leftJoin("uomConversionMatrix.fromUOM", "fromUOM")
  //     .leftJoin("uomConversionMatrix.toUOM", "toUOM")
  //     .select([
  //       "uomConversionMatrix.id",
  //       "uomConversionMatrix.conversionFactor",
  //       "fromUOM.id",
  //       "toUOM.id",
  //     ])
  //     .where("uomConversionMatrix.id = :id", { id })
  //     .getOne();

  //   if (!result) return null;

  //   const formatted = {
  //     id: result.id,
  //     conversionFactor: result.conversionFactor,
  //     fromUOM: result.fromUOM?.id ?? null,
  //     toUOM: result.toUOM?.id ?? null,
  //   };

  //   await this.cacheService.set(key, formatted, CACHE_TTL);
  //   return formatted;
  // }

  public async create(conversionData: CreateUOMConversionMatrixDto): Promise<UOMConversionMatrix> {
    const conversion = this.uomConversionMatrixRepository.create(conversionData as any) as unknown as UOMConversionMatrix;
    const saved = await this.uomConversionMatrixRepository.save(conversion) as unknown as UOMConversionMatrix;
    await this.invalidateCache();
    return saved;
  }

  public async update(
    id: string,
    conversionData: UpdateUOMConversionMatrixDto,
    updatedBy: string,
  ): Promise<UOMConversionMatrix | null> {
    const existingConversionMatrix = await this.uomConversionMatrixRepository.findOne({
      where: { id },
    });

    if (!existingConversionMatrix) {
      throw new Error("UOM Conversion Matrix not found");
    }

    const oldData = { ...existingConversionMatrix };
    Object.assign(existingConversionMatrix, conversionData);

    const updatedConversionMatrix = await this.uomConversionMatrixRepository.save(existingConversionMatrix);

    await this.auditLogService.logChange(
      "UOMConversionMatrix",
      id,
      oldData,
      updatedConversionMatrix,
      updatedBy,
    );

    await this.invalidateCache(id);
    return updatedConversionMatrix;
  }

  public async delete(id: string): Promise<boolean> {
    const uomConversionMatrix = await this.uomConversionMatrixRepository.findOne({
      where: { id },
    });

    if (!uomConversionMatrix) return false;

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    uomConversionMatrix.deletionScheduledAt = sixMonthsFromNow;
    await this.uomConversionMatrixRepository.save(uomConversionMatrix);
    await this.invalidateCache(id);

    return true;
  }

  public async softDeleteConversion(ids: string[]): Promise<BulkDeleteUOMConversionMatrixResultDto> {
    const result = await this.uomConversionMatrixRepository.softDelete({ id: In(ids) });
    await this.invalidateCache();
    return result;
  }
}
