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
import { Address } from '../../address/entity/address.entity';
import { TransportRegistrationService, CACHE_TTL_DETAIL, CACHE_TTL_LIST } from '../../transport/transportRegistration.service';
import {
  assertMatches,
  blankToNull,
  formatAddress,
  GSTIN_REGEX,
  IFSC_REGEX,
  EMAIL_REGEX,
  mapAddress,
  normalizePhone,
  numberOrNull,
  PAN_REGEX,
  PHONE_REGEX,
  readAddress,
  requireText,
  upperOrNull,
  AddressPayload,
} from '../../transport/transport.utils';
import { Transporter, TransporterType } from '../entity/transporter.entity';
import { TransporterRepository } from '../repository/transporter.repository';
import { TRANSPORTER_FILTERS } from '../filters/transporter.filters';
import {
  TransporterDetailDto,
  TransporterListItemDto,
  TransporterPickerDto,
} from '../dto/transporter.dto';

const EMPTY_ADDRESS: AddressPayload = {
  address1: null,
  address2: null,
  location: null,
  city: null,
  state: null,
  pincode: null,
};

@injectable()
export class TransporterService extends TransportRegistrationService<Transporter> {
  protected readonly label = 'Transporter';
  protected readonly cachePrefix = 'transporter';
  protected readonly tableName = 'transporters';
  protected readonly codeColumn = 'transporterCode';
  protected readonly codePrefix = 'TR-';

  constructor(
    @inject(TYPES.TransporterRepository) transporterRepository: TransporterRepository,
    @inject(TYPES.UserRepository) userRepository: UserRepository,
    @inject(TYPES.CacheService) cacheService: CacheService,
    @inject(TYPES.NotificationService) notificationService: NotificationService,
    @inject(TYPES.AuditLogService) auditLogService: AuditLogService,
  ) {
    super(transporterRepository, userRepository, cacheService, notificationService, auditLogService);
  }

  // ─── Module hooks ─────────────────────────────────────────────────────────

  protected displayName(entity: Transporter): string {
    return entity.name || entity.transporterCode || 'Transporter';
  }

  protected newEntity(): Transporter {
    return this.repo.create();
  }

  protected loadForWrite(id: string): Promise<Transporter | null> {
    return this.repo.findOne({ where: { id }, relations: ['address', 'createdBy'] });
  }

  protected async applyBody(entity: Transporter, body: Record<string, any>): Promise<void> {
    const has = (key: string) => body[key] !== undefined;

    if (has('name')) entity.name = blankToNull(body.name) as string;
    if (has('transporterType')) {
      const type = blankToNull(body.transporterType);
      if (type && !Object.values(TransporterType).includes(type as TransporterType)) {
        throw new AppError(400, `Invalid transporter type '${type}'. Allowed: ${Object.values(TransporterType).join(', ')}`);
      }
      entity.transporterType = type as TransporterType;
    }
    if (has('contactPerson')) entity.contactPerson = blankToNull(body.contactPerson) as string;

    if (has('primaryPhone')) {
      entity.primaryPhone = normalizePhone(body.primaryPhone) as string;
      assertMatches(entity.primaryPhone, PHONE_REGEX, 'Please enter a valid primary phone number');
    }
    if (has('altPhone')) {
      entity.altPhone = normalizePhone(body.altPhone) as string;
      assertMatches(entity.altPhone, PHONE_REGEX, 'Please enter a valid alternate phone number');
    }
    if (has('email')) {
      entity.email = blankToNull(body.email) as string;
      assertMatches(entity.email, EMAIL_REGEX, 'Please enter a valid email');
    }

    if (has('gstin')) {
      entity.gstin = upperOrNull(body.gstin) as string;
      assertMatches(entity.gstin, GSTIN_REGEX, 'Please enter a valid GSTIN');
    }
    if (has('pan')) {
      entity.pan = upperOrNull(body.pan) as string;
      assertMatches(entity.pan, PAN_REGEX, 'Please enter a valid PAN');
    }
    if (has('bankName')) entity.bankName = blankToNull(body.bankName) as string;
    if (has('accountHolderName')) entity.accountHolderName = blankToNull(body.accountHolderName) as string;
    if (has('accountNo')) entity.accountNo = blankToNull(body.accountNo) as string;
    if (has('ifsc')) {
      entity.ifsc = upperOrNull(body.ifsc) as string;
      assertMatches(entity.ifsc, IFSC_REGEX, 'Please enter a valid IFSC code');
    }
    if (has('upiId')) entity.upiId = blankToNull(body.upiId) as string;
    if (has('paymentTerms')) entity.paymentTerms = blankToNull(body.paymentTerms) as string;
    if (has('creditDays')) {
      const days = numberOrNull(body.creditDays);
      if (days !== null && (!Number.isInteger(days) || days < 0)) {
        throw new AppError(400, 'Credit days must be a whole number of 0 or more');
      }
      entity.creditDays = days as number;
    }
    if (has('remarks')) entity.remarks = blankToNull(body.remarks) as string;

    if (has('address')) {
      const next = readAddress(body.address);
      if (!next) {
        entity.address = null as unknown as Address;
      } else if (entity.address?.id) {
        Object.assign(entity.address, next);
      } else {
        entity.address = next as unknown as Address;
      }
    }
  }

  protected assertComplete(entity: Transporter): void {
    requireText(entity.name, 'Transporter name is required');
    requireText(entity.transporterType, 'Transporter type is required');
    requireText(entity.primaryPhone, 'Primary phone number is required');
  }

  protected async assertUnique(entity: Transporter, excludeId?: string): Promise<void> {
    const notSelf = excludeId ? { id: Not(excludeId) } : {};

    if (entity.gstin) {
      const dup = await this.repo.findOne({ where: { gstin: entity.gstin, ...notSelf } });
      if (dup) throw this.duplicate(dup, `GSTIN ${entity.gstin}`);
    }
    if (entity.name && entity.primaryPhone) {
      const qb = this.repo
        .createQueryBuilder('t')
        .where('LOWER(t.name) = LOWER(:name)', { name: entity.name })
        .andWhere('t.primaryPhone = :phone', { phone: entity.primaryPhone });
      if (excludeId) qb.andWhere('t.id != :excludeId', { excludeId });
      const dup = await qb.getOne();
      if (dup) throw this.duplicate(dup, `name "${entity.name}" and phone ${entity.primaryPhone}`);
    }
  }

  private duplicate(existing: Transporter, by: string): AppError {
    return new AppError(
      409,
      `Transporter ${existing.transporterCode ?? ''} "${existing.name}" (${existing.status}) is already registered with ${by}`.replace(/\s+/g, ' '),
    );
  }

  protected snapshot(entity: Transporter): Record<string, unknown> {
    return {
      name: entity.name,
      transporterType: entity.transporterType,
      contactPerson: entity.contactPerson,
      primaryPhone: entity.primaryPhone,
      altPhone: entity.altPhone,
      email: entity.email,
      address: formatAddress(entity.address),
      gstin: entity.gstin,
      pan: entity.pan,
      bankName: entity.bankName,
      accountHolderName: entity.accountHolderName,
      accountNo: entity.accountNo,
      ifsc: entity.ifsc,
      upiId: entity.upiId,
      paymentTerms: entity.paymentTerms,
      creditDays: entity.creditDays,
      remarks: entity.remarks,
      status: entity.status,
    };
  }

  protected async assertDeletable(entities: Transporter[]): Promise<void> {
    const ids = entities.map((e) => e.id);
    const counts = await this.dependentCounts(ids);
    const blocked = entities.find((e) => (counts.get(e.id)?.vehicles ?? 0) + (counts.get(e.id)?.drivers ?? 0) > 0);
    if (blocked) {
      const c = counts.get(blocked.id)!;
      throw new AppError(
        409,
        `Transporter "${blocked.name}" still has ${c.vehicles} vehicle(s) and ${c.drivers} driver(s) registered. Reassign or delete them first.`,
      );
    }
  }

  /** Live vehicles and drivers per transporter. */
  private async dependentCounts(ids: string[]): Promise<Map<string, { vehicles: number; drivers: number }>> {
    const result = new Map<string, { vehicles: number; drivers: number }>();
    if (ids.length === 0) return result;
    const read = async (table: string): Promise<Array<{ tid: string; n: number }>> =>
      this.repo.query(
        `SELECT "transporter_id"::text AS tid, COUNT(*)::int AS n FROM "${table}" ` +
          `WHERE "deletedAt" IS NULL AND "transporter_id" = ANY($1::uuid[]) GROUP BY "transporter_id"`,
        [ids],
      );
    for (const row of await read('vehicles')) {
      result.set(row.tid, { vehicles: row.n, drivers: result.get(row.tid)?.drivers ?? 0 });
    }
    for (const row of await read('drivers')) {
      result.set(row.tid, { vehicles: result.get(row.tid)?.vehicles ?? 0, drivers: row.n });
    }
    return result;
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  async getAll(options: PaginationOptions, userId: string) {
    const requester = await this.getRequester(userId);
    const key = `${this.cachePrefix}:list:${userId}:${JSON.stringify(options)}`;
    return this.remember(key, CACHE_TTL_LIST, async () => {
      const qb = this.repo
        .createQueryBuilder('transporter')
        .leftJoin('transporter.createdBy', 'createdBy')
        .leftJoin('transporter.address', 'address')
        .select([
          'transporter.id', 'transporter.transporterCode', 'transporter.name', 'transporter.transporterType',
          'transporter.contactPerson', 'transporter.primaryPhone', 'transporter.altPhone', 'transporter.email',
          'transporter.gstin', 'transporter.pan', 'transporter.bankName', 'transporter.accountHolderName',
          'transporter.accountNo', 'transporter.ifsc', 'transporter.upiId', 'transporter.paymentTerms',
          'transporter.creditDays', 'transporter.remarks', 'transporter.status', 'transporter.createdAt',
          'createdBy.id', 'createdBy.firstName', 'createdBy.lastName',
          'address.address1', 'address.address2', 'address.location', 'address.city', 'address.state', 'address.pincode',
        ])
        .orderBy('transporter.createdAt', 'DESC');

      this.applyVisibility(qb, 'transporter', requester);
      applyMasterFilters(qb, TRANSPORTER_FILTERS, options.masterFilters);

      const { data, meta } = await buildQuery(qb, options, 'transporter');
      const counts = await this.dependentCounts(data.map((t) => t.id));

      const rows: TransporterListItemDto[] = data.map((t: Transporter) => ({
        ...this.toBase(t),
        address: formatAddress(t.address),
        canEdit: this.canEditRow(requester, (t.createdBy as any)?.id),
        vehicleCount: counts.get(t.id)?.vehicles ?? 0,
        driverCount: counts.get(t.id)?.drivers ?? 0,
      }));
      return { data: rows, meta };
    });
  }

  async getForView(id: string): Promise<TransporterDetailDto | null> {
    return this.remember(`${this.cachePrefix}:view:${id}`, CACHE_TTL_DETAIL, () => this.loadDetail(id));
  }

  async getForUpdate(id: string): Promise<TransporterDetailDto | null> {
    return this.remember(`${this.cachePrefix}:update:${id}`, CACHE_TTL_DETAIL, () => this.loadDetail(id));
  }

  private async loadDetail(id: string): Promise<TransporterDetailDto | null> {
    const t = await this.repo.findOne({ where: { id }, relations: ['address', 'createdBy', 'approvedBy'] });
    if (!t) return null;
    return { ...this.toBase(t), address: mapAddress(t.address) ?? { ...EMPTY_ADDRESS } };
  }

  /** Approved and pending transporters, for the vehicle / driver forms. */
  async getPickerList(): Promise<TransporterPickerDto[]> {
    return this.remember(`${this.cachePrefix}:picker:all`, CACHE_TTL_LIST, async () => {
      const qb = this.repo
        .createQueryBuilder('transporter')
        .select([
          'transporter.id', 'transporter.transporterCode', 'transporter.name',
          'transporter.transporterType', 'transporter.primaryPhone', 'transporter.status',
        ])
        .orderBy('transporter.name', 'ASC');
      this.applyPickable(qb, 'transporter');
      const rows = await qb.getMany();
      return rows.map((t) => ({
        id: t.id,
        transporterCode: t.transporterCode ?? null,
        name: t.name ?? null,
        transporterType: t.transporterType ?? null,
        primaryPhone: t.primaryPhone ?? null,
        status: t.status,
      }));
    });
  }

  private toBase(t: Transporter): Omit<TransporterDetailDto, 'address'> {
    return {
      id: t.id,
      transporterCode: t.transporterCode ?? null,
      name: t.name ?? null,
      transporterType: t.transporterType ?? null,
      contactPerson: t.contactPerson ?? null,
      primaryPhone: t.primaryPhone ?? null,
      altPhone: t.altPhone ?? null,
      email: t.email ?? null,
      gstin: t.gstin ?? null,
      pan: t.pan ?? null,
      bankName: t.bankName ?? null,
      accountHolderName: t.accountHolderName ?? null,
      accountNo: t.accountNo ?? null,
      ifsc: t.ifsc ?? null,
      upiId: t.upiId ?? null,
      paymentTerms: t.paymentTerms ?? null,
      creditDays: t.creditDays ?? null,
      remarks: t.remarks ?? null,
      status: t.status,
      ...this.auditFields(t),
    };
  }
}
