import { inject, injectable } from 'inversify';
import { Not } from 'typeorm';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import { Status } from '../../utils/status.enum';
import { buildQuery, PaginationOptions } from '../../utils/pagination';
import { applyMasterFilters } from '../../global/filters/masterDataFilter';
import { UserRepository } from '../../employee/repository/user.repository';
import { CacheService } from '../../global/cache.service';
import { NotificationService } from '../../notification/service/notification.service';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { Transporter } from '../../transporter/entity/transporter.entity';
import {
  CACHE_TTL_DETAIL,
  CACHE_TTL_LIST,
  TransportRegistrationService,
} from '../../transport/transportRegistration.service';
import {
  assertMatches,
  blankToNull,
  normalizeVehicleNo,
  numberOrNull,
  requireText,
  upperOrNull,
  VEHICLE_NO_REGEX,
} from '../../transport/transport.utils';
import { Vehicle } from '../entity/vehicle.entity';
import { VehicleRepository } from '../repository/vehicle.repository';
import { VEHICLE_FILTERS } from '../filters/vehicle.filters';
import { VehicleDetailDto, VehicleListItemDto, VehicleLookupDto, VehiclePickerDto } from '../dto/vehicle.dto';

@injectable()
export class VehicleService extends TransportRegistrationService<Vehicle> {
  protected readonly label = 'Vehicle';
  protected readonly cachePrefix = 'vehicle';
  protected readonly tableName = 'vehicles';
  protected readonly codeColumn = 'vehicleCode';
  protected readonly codePrefix = 'VH-';

  constructor(
    @inject(TYPES.VehicleRepository) vehicleRepository: VehicleRepository,
    @inject(TYPES.UserRepository) userRepository: UserRepository,
    @inject(TYPES.CacheService) cacheService: CacheService,
    @inject(TYPES.NotificationService) notificationService: NotificationService,
    @inject(TYPES.AuditLogService) auditLogService: AuditLogService,
  ) {
    super(vehicleRepository, userRepository, cacheService, notificationService, auditLogService);
  }

  // ─── Module hooks ─────────────────────────────────────────────────────────

  protected displayName(entity: Vehicle): string {
    return entity.vehicleNo || entity.vehicleCode || 'Vehicle';
  }

  protected newEntity(): Vehicle {
    return this.repo.create();
  }

  protected loadForWrite(id: string): Promise<Vehicle | null> {
    return this.repo.findOne({ where: { id }, relations: ['transporter', 'createdBy'] });
  }

  protected async applyBody(entity: Vehicle, body: Record<string, any>): Promise<void> {
    const has = (key: string) => body[key] !== undefined;

    if (has('vehicleNo')) {
      const normalized = normalizeVehicleNo(body.vehicleNo);
      assertMatches(normalized, VEHICLE_NO_REGEX, 'Please enter a valid vehicle number, e.g. MH12AB1234');
      entity.vehicleNo = blankToNull(body.vehicleNo)?.toUpperCase() as string;
      entity.vehicleNoNormalized = normalized as string;
    }
    if (has('vehicleType')) entity.vehicleType = blankToNull(body.vehicleType) as string;
    if (has('capacityKg')) {
      const capacity = numberOrNull(body.capacityKg);
      if (capacity !== null && capacity < 0) throw new AppError(400, 'Capacity cannot be negative');
      entity.capacityKg = capacity === null ? (null as unknown as string) : String(capacity);
    }
    if (has('rcNumber')) entity.rcNumber = upperOrNull(body.rcNumber) as string;
    if (has('remarks')) entity.remarks = blankToNull(body.remarks) as string;

    if (has('transporterId')) {
      const transporterId = blankToNull(body.transporterId);
      if (!transporterId) {
        entity.transporter = null as unknown as Transporter;
      } else {
        const transporter = await this.repo.manager
          .getRepository(Transporter)
          .findOne({ where: { id: transporterId }, select: ['id', 'name', 'status'] });
        if (!transporter) throw new AppError(400, 'Selected transporter was not found');
        if (transporter.status === Status.REJECTED || transporter.status === Status.DRAFT) {
          throw new AppError(400, `Transporter "${transporter.name}" is not available (status '${transporter.status}')`);
        }
        entity.transporter = { id: transporter.id } as Transporter;
      }
    }
  }

  protected assertComplete(entity: Vehicle): void {
    requireText(entity.vehicleNo, 'Vehicle number is required');
    requireText(entity.vehicleType, 'Vehicle type is required');
  }

  protected async assertUnique(entity: Vehicle, excludeId?: string): Promise<void> {
    if (!entity.vehicleNoNormalized) return;
    const existing = await this.repo.findOne({
      where: { vehicleNoNormalized: entity.vehicleNoNormalized, ...(excludeId ? { id: Not(excludeId) } : {}) },
      relations: ['transporter'],
    });
    if (existing) {
      const owner = existing.transporter?.name
        ? `under ${existing.transporter.name}`
        : 'as an independent vehicle';
      throw new AppError(
        409,
        `Vehicle ${existing.vehicleNo} is already registered (${existing.status}) ${owner}`,
      );
    }
  }

  protected snapshot(entity: Vehicle): Record<string, unknown> {
    return {
      vehicleNo: entity.vehicleNo,
      vehicleType: entity.vehicleType,
      capacityKg: entity.capacityKg,
      rcNumber: entity.rcNumber,
      transporter: (entity.transporter as Transporter | undefined)?.id ?? null,
      remarks: entity.remarks,
      status: entity.status,
    };
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  async getAll(options: PaginationOptions, userId: string) {
    const requester = await this.getRequester(userId);
    const key = `${this.cachePrefix}:list:${userId}:${JSON.stringify(options)}`;
    return this.remember(key, CACHE_TTL_LIST, async () => {
      const qb = this.repo
        .createQueryBuilder('vehicle')
        .leftJoin('vehicle.createdBy', 'createdBy')
        .leftJoin('vehicle.approvedBy', 'approvedBy')
        .leftJoin('vehicle.transporter', 'transporter')
        .select([
          'vehicle.id', 'vehicle.vehicleCode', 'vehicle.vehicleNo', 'vehicle.vehicleType', 'vehicle.capacityKg',
          'vehicle.rcNumber', 'vehicle.remarks', 'vehicle.status', 'vehicle.createdAt',
          'transporter.id', 'transporter.name',
          'createdBy.id', 'createdBy.firstName', 'createdBy.lastName',
          'approvedBy.id', 'approvedBy.firstName', 'approvedBy.lastName',
        ])
        .orderBy('vehicle.createdAt', 'DESC');

      this.applyVisibility(qb, 'vehicle', requester);
      applyMasterFilters(qb, VEHICLE_FILTERS, options.masterFilters);

      const { data, meta } = await buildQuery(qb, options, 'vehicle');
      const rows: VehicleListItemDto[] = data.map((v: Vehicle) => ({
        ...this.toDetail(v),
        canEdit: this.canEditRow(requester, (v.createdBy as any)?.id),
      }));
      return { data: rows, meta };
    });
  }

  async getForView(id: string): Promise<VehicleDetailDto | null> {
    return this.remember(`${this.cachePrefix}:view:${id}`, CACHE_TTL_DETAIL, () => this.loadDetail(id));
  }

  async getForUpdate(id: string): Promise<VehicleDetailDto | null> {
    return this.remember(`${this.cachePrefix}:update:${id}`, CACHE_TTL_DETAIL, () => this.loadDetail(id));
  }

  private async loadDetail(id: string): Promise<VehicleDetailDto | null> {
    const vehicle = await this.repo.findOne({ where: { id }, relations: ['transporter', 'createdBy', 'approvedBy'] });
    return vehicle ? this.toDetail(vehicle) : null;
  }

  /** Approved and pending vehicles, optionally only those of one transporter. */
  async getPickerList(transporterId?: string): Promise<VehiclePickerDto[]> {
    return this.remember(`${this.cachePrefix}:picker:${transporterId || 'all'}`, CACHE_TTL_LIST, async () => {
      const qb = this.repo
        .createQueryBuilder('vehicle')
        .leftJoin('vehicle.transporter', 'transporter')
        .select([
          'vehicle.id', 'vehicle.vehicleCode', 'vehicle.vehicleNo', 'vehicle.vehicleType',
          'vehicle.capacityKg', 'vehicle.rcNumber', 'vehicle.status', 'transporter.id', 'transporter.name',
        ])
        .orderBy('vehicle.vehicleNo', 'ASC');
      this.applyPickable(qb, 'vehicle');
      if (transporterId) qb.andWhere('transporter.id = :transporterId', { transporterId });
      const rows = await qb.getMany();
      return rows.map((v) => ({
        id: v.id,
        vehicleCode: v.vehicleCode ?? null,
        vehicleNo: v.vehicleNo ?? null,
        vehicleType: v.vehicleType ?? null,
        capacityKg: v.capacityKg === null || v.capacityKg === undefined ? null : Number(v.capacityKg),
        rcNumber: v.rcNumber ?? null,
        transporterId: v.transporter?.id ?? null,
        transporterName: v.transporter?.name ?? null,
        status: v.status,
      }));
    });
  }

  /** The vehicle registered under this plate (whatever its status), or null. */
  async lookupByNumber(vehicleNo: string): Promise<VehicleLookupDto | null> {
    const normalized = normalizeVehicleNo(vehicleNo);
    if (!normalized) return null;
    const vehicle = await this.repo.findOne({
      where: { vehicleNoNormalized: normalized },
      relations: ['transporter'],
    });
    return vehicle
      ? {
          id: vehicle.id,
          vehicleNo: vehicle.vehicleNo ?? null,
          status: vehicle.status,
          transporterName: vehicle.transporter?.name ?? null,
        }
      : null;
  }

  private toDetail(v: Vehicle): VehicleDetailDto {
    return {
      id: v.id,
      vehicleCode: v.vehicleCode ?? null,
      vehicleNo: v.vehicleNo ?? null,
      vehicleType: v.vehicleType ?? null,
      capacityKg: v.capacityKg === null || v.capacityKg === undefined ? null : Number(v.capacityKg),
      rcNumber: v.rcNumber ?? null,
      transporterId: v.transporter?.id ?? null,
      transporterName: v.transporter?.name ?? null,
      remarks: v.remarks ?? null,
      status: v.status,
      ...this.auditFields(v),
    };
  }
}
