import { inject, injectable } from "inversify";
import { DataSource, In } from "typeorm";
import { UOMRepository } from "../repository/uom.repository";
import { TYPES } from "../../types";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { CacheService } from "../../global/cache.service";
import { UOM } from "../entity/uom.entity";
import { buildQuery, PaginationOptions } from "../../utils/pagination";
import { CreateUOMDto, UOMDetailDto, UOMListResponseDto, UOMPartialDto, UpdateUOMDto } from "../dto/uom.dto";



const CACHE_PREFIX = "uom";
const CACHE_TTL = 300; // 5 minutes

@injectable()
export class UOMService {
  private UOMRepository: UOMRepository;

  constructor(
    @inject(TYPES.DataSource) private dataSource: DataSource,
    @inject(TYPES.AuditLogService) private auditLogService: AuditLogService,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
  ) {
    this.UOMRepository = this.dataSource.getRepository(UOM) as UOMRepository;
  }

  // ─── Cache Helpers ────────────────────────────────────────────────────────

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
      this.cacheService.del(`${CACHE_PREFIX}:partial`),
    ];
    if (id) {
      tasks.push(this.cacheService.del(`${CACHE_PREFIX}:id:${id}`));
    }
    await Promise.all(tasks);
  }

  // ─── Methods ──────────────────────────────────────────────────────────────

  public async getAll(queryOptions: PaginationOptions): Promise<UOMListResponseDto> {
    const key = `${CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.UOMRepository.createQueryBuilder("uom")
      .select(["uom.id", "uom.unit", "uom.abbreviation", "uom.description"])
      .orderBy("uom.createdAt", "DESC");

    const result = await buildQuery(queryBuilder, queryOptions, "uom");

    const formatted = {
      data: result.data.map((unit) => ({
        id: unit.id,
        unit: unit.unit,
        abbreviation: unit.abbreviation,
        description: unit.description,
      })),
      meta: result.meta,
    };

    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  public async getAllPartial(): Promise<UOMPartialDto[]> {
    const key = `${CACHE_PREFIX}:partial`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const uoms = await this.UOMRepository.createQueryBuilder("uom")
      .select(["uom.id", "uom.unit"])
      .orderBy("uom.unit", "ASC")
      .getMany();

    await this.cacheService.set(key, uoms, CACHE_TTL);
    return uoms;
  }

  public async getById(id: string): Promise<UOMDetailDto | null> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const uom = await this.UOMRepository.createQueryBuilder("uom")
      .select(["uom.id", "uom.unit", "uom.abbreviation", "uom.description"])
      .where("uom.id = :id", { id })
      .getOne();

    if (!uom) return null;

    await this.cacheService.set(key, uom, CACHE_TTL);
    return uom;
  }

  public async create(uomData: CreateUOMDto): Promise<UOM> {
    const uom = this.UOMRepository.create(uomData as any) as unknown as UOM;
    const saved = await this.UOMRepository.save(uom) as unknown as UOM;
    await this.invalidateCache();
    return saved;
  }

  public async update(
    id: string,
    uomData: UpdateUOMDto,
    updatedBy: string,
  ): Promise<UOMDetailDto | null> {
    const existingUOM = await this.UOMRepository.findOne({ where: { id } });

    if (!existingUOM) {
      throw new Error(`UOM with ID ${id} not found`);
    }

    const oldData = { ...existingUOM };
    Object.assign(existingUOM, uomData);

    await this.auditLogService.logChange("UOM", id, oldData, uomData, updatedBy);

    await this.UOMRepository.save(existingUOM);
    await this.invalidateCache(id);
    return this.getById(id);
  }

  public async delete(id: string): Promise<boolean> {
    const uom = await this.UOMRepository.findOne({ where: { id } });

    if (!uom) return false;

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    uom.deletionScheduledAt = sixMonthsFromNow;
    await this.UOMRepository.save(uom);
    await this.invalidateCache(id);

    return true;
  }

  public async multipledelete(ids: string[]): Promise<boolean> {
    try {
      const result = await this.UOMRepository.softDelete({ id: In(ids) });
      await this.invalidateCache();
      return result.affected !== 0;
    } catch (err) {
      
      return false;
    }
  }
}
