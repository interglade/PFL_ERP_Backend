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
import { Transporter } from '../../transporter/entity/transporter.entity';
import {
  CACHE_TTL_DETAIL,
  CACHE_TTL_LIST,
  TransportRegistrationService,
} from '../../transport/transportRegistration.service';
import {
  AddressPayload,
  assertMatches,
  blankToNull,
  dateOrNull,
  EMAIL_REGEX,
  formatAddress,
  fullName,
  mapAddress,
  normalizePhone,
  PHONE_REGEX,
  readAddress,
  requireText,
  upperOrNull,
} from '../../transport/transport.utils';
import { Drivers } from '../entity/driver.entity';
import { DriverRepository } from '../repository/driver.repository';
import { DRIVER_FILTERS } from '../filters/driver.filters';
import { DriverDetailDto, DriverListItemDto, DriverLookupDto, DriverPickerDto } from '../dto/driver.dto';

const EMPTY_ADDRESS: AddressPayload = {
  address1: null,
  address2: null,
  location: null,
  city: null,
  state: null,
  pincode: null,
};

@injectable()
export class DriversService extends TransportRegistrationService<Drivers> {
  protected readonly label = 'Driver';
  protected readonly cachePrefix = 'driver';
  protected readonly tableName = 'drivers';
  protected readonly codeColumn = 'driverCode';
  protected readonly codePrefix = 'DR-';

  constructor(
    @inject(TYPES.DriverRepository) driverRepository: DriverRepository,
    @inject(TYPES.UserRepository) userRepository: UserRepository,
    @inject(TYPES.CacheService) cacheService: CacheService,
    @inject(TYPES.NotificationService) notificationService: NotificationService,
    @inject(TYPES.AuditLogService) auditLogService: AuditLogService,
  ) {
    super(driverRepository, userRepository, cacheService, notificationService, auditLogService);
  }

  // ─── Module hooks ─────────────────────────────────────────────────────────

  protected displayName(entity: Drivers): string {
    return fullName(entity.firstName, entity.lastName) || entity.driverCode || 'Driver';
  }

  protected newEntity(): Drivers {
    return this.repo.create();
  }

  protected loadForWrite(id: string): Promise<Drivers | null> {
    return this.repo.findOne({ where: { id }, relations: ['address', 'transporter', 'createdBy'] });
  }

  protected async applyBody(entity: Drivers, body: Record<string, any>): Promise<void> {
    const has = (key: string) => body[key] !== undefined;

    if (has('firstName')) entity.firstName = blankToNull(body.firstName) as string;
    if (has('lastName')) entity.lastName = blankToNull(body.lastName) as string;
    if (has('phoneNumber')) {
      entity.phoneNumber = normalizePhone(body.phoneNumber) as string;
      assertMatches(entity.phoneNumber, PHONE_REGEX, 'Please enter a valid phone number');
    }
    if (has('altPhoneNumber')) {
      entity.altPhoneNumber = normalizePhone(body.altPhoneNumber) as string;
      assertMatches(entity.altPhoneNumber, PHONE_REGEX, 'Please enter a valid alternate phone number');
    }
    if (has('email')) {
      entity.email = blankToNull(body.email) as string;
      assertMatches(entity.email, EMAIL_REGEX, 'Please enter a valid email');
    }
    if (has('licenseNo')) entity.licenseNo = upperOrNull(body.licenseNo) as string;
    if (has('licenseType')) entity.licenseType = blankToNull(body.licenseType) as string;
    if (has('licenseExpiry')) entity.licenseExpiry = dateOrNull(body.licenseExpiry, 'Licence expiry') as string;
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

  protected assertComplete(entity: Drivers): void {
    requireText(entity.firstName, 'First name is required');
    requireText(entity.phoneNumber, 'Phone number is required');
  }

  protected async assertUnique(entity: Drivers, excludeId?: string): Promise<void> {
    const notSelf = excludeId ? { id: Not(excludeId) } : {};
    const checks: Array<[string, Record<string, string>]> = [];
    if (entity.phoneNumber) checks.push([`phone ${entity.phoneNumber}`, { phoneNumber: entity.phoneNumber }]);
    if (entity.email) checks.push([`email ${entity.email}`, { email: entity.email }]);
    if (entity.licenseNo) checks.push([`licence ${entity.licenseNo}`, { licenseNo: entity.licenseNo }]);

    for (const [by, where] of checks) {
      const existing = await this.repo.findOne({ where: { ...where, ...notSelf } });
      if (existing) {
        throw new AppError(
          409,
          `Driver ${this.displayName(existing)} (${existing.status}) is already registered with ${by}`,
        );
      }
    }
  }

  protected snapshot(entity: Drivers): Record<string, unknown> {
    return {
      firstName: entity.firstName,
      lastName: entity.lastName,
      phoneNumber: entity.phoneNumber,
      altPhoneNumber: entity.altPhoneNumber,
      email: entity.email,
      address: formatAddress(entity.address),
      licenseNo: entity.licenseNo,
      licenseType: entity.licenseType,
      licenseExpiry: entity.licenseExpiry,
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
        .createQueryBuilder('driver')
        .leftJoin('driver.createdBy', 'createdBy')
        .leftJoin('driver.approvedBy', 'approvedBy')
        .leftJoin('driver.transporter', 'transporter')
        .leftJoin('driver.address', 'address')
        .select([
          'driver.id', 'driver.driverCode', 'driver.firstName', 'driver.lastName', 'driver.phoneNumber',
          'driver.altPhoneNumber', 'driver.email', 'driver.licenseNo', 'driver.licenseType',
          'driver.licenseExpiry', 'driver.remarks', 'driver.status', 'driver.createdAt',
          'transporter.id', 'transporter.name',
          'createdBy.id', 'createdBy.firstName', 'createdBy.lastName',
          'approvedBy.id', 'approvedBy.firstName', 'approvedBy.lastName',
          'address.address1', 'address.address2', 'address.location', 'address.city', 'address.state', 'address.pincode',
        ])
        .orderBy('driver.createdAt', 'DESC');

      this.applyVisibility(qb, 'driver', requester);
      applyMasterFilters(qb, DRIVER_FILTERS, options.masterFilters);

      const { data, meta } = await buildQuery(qb, options, 'driver');
      const rows: DriverListItemDto[] = data.map((d: Drivers) => ({
        ...this.toBase(d),
        address: formatAddress(d.address),
        canEdit: this.canEditRow(requester, (d.createdBy as any)?.id),
      }));
      return { data: rows, meta };
    });
  }

  async getForView(id: string): Promise<DriverDetailDto | null> {
    return this.remember(`${this.cachePrefix}:view:${id}`, CACHE_TTL_DETAIL, () => this.loadDetail(id));
  }

  async getForUpdate(id: string): Promise<DriverDetailDto | null> {
    return this.remember(`${this.cachePrefix}:update:${id}`, CACHE_TTL_DETAIL, () => this.loadDetail(id));
  }

  private async loadDetail(id: string): Promise<DriverDetailDto | null> {
    const d = await this.repo.findOne({
      where: { id },
      relations: ['address', 'transporter', 'createdBy', 'approvedBy'],
    });
    return d ? { ...this.toBase(d), address: mapAddress(d.address) ?? { ...EMPTY_ADDRESS } } : null;
  }

  /**
   * Approved and pending drivers. With `transporterId` only that transporter's
   * drivers, plus the independent ones when `includeFree` is set.
   */
  async getPickerList(transporterId?: string, includeFree = false): Promise<DriverPickerDto[]> {
    const key = `${this.cachePrefix}:picker:${transporterId || 'all'}:${includeFree ? 'free' : 'own'}`;
    return this.remember(key, CACHE_TTL_LIST, async () => {
      const qb = this.repo
        .createQueryBuilder('driver')
        .leftJoin('driver.transporter', 'transporter')
        .leftJoin('driver.address', 'address')
        .select([
          'driver.id', 'driver.driverCode', 'driver.firstName', 'driver.lastName', 'driver.phoneNumber',
          'driver.altPhoneNumber', 'driver.licenseNo', 'driver.status', 'transporter.id', 'transporter.name',
          'address.id', 'address.address1', 'address.address2', 'address.location', 'address.city', 'address.state', 'address.pincode',
        ])
        .orderBy('driver.firstName', 'ASC')
        .addOrderBy('driver.lastName', 'ASC');
      this.applyPickable(qb, 'driver');
      if (transporterId) {
        qb.andWhere(
          includeFree ? '(transporter.id = :transporterId OR transporter.id IS NULL)' : 'transporter.id = :transporterId',
          { transporterId },
        );
      }
      const rows = await qb.getMany();
      return rows.map((d) => ({
        id: d.id,
        driverCode: d.driverCode ?? null,
        fullName: fullName(d.firstName, d.lastName),
        phoneNumber: d.phoneNumber ?? null,
        altPhoneNumber: d.altPhoneNumber ?? null,
        licenseNo: d.licenseNo ?? null,
        address: formatAddress(d.address) || null,
        transporterId: d.transporter?.id ?? null,
        transporterName: d.transporter?.name ?? null,
        status: d.status,
      }));
    });
  }

  /** The driver registered with this phone number (whatever the status), or null. */
  async lookupByPhone(phone: string): Promise<DriverLookupDto | null> {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    const driver = await this.repo.findOne({ where: { phoneNumber: normalized } });
    return driver
      ? {
          id: driver.id,
          fullName: fullName(driver.firstName, driver.lastName),
          phoneNumber: driver.phoneNumber ?? null,
          status: driver.status,
        }
      : null;
  }

  private toBase(d: Drivers): Omit<DriverDetailDto, 'address'> {
    return {
      id: d.id,
      driverCode: d.driverCode ?? null,
      firstName: d.firstName ?? null,
      lastName: d.lastName ?? null,
      fullName: fullName(d.firstName, d.lastName),
      phoneNumber: d.phoneNumber ?? null,
      altPhoneNumber: d.altPhoneNumber ?? null,
      email: d.email ?? null,
      licenseNo: d.licenseNo ?? null,
      licenseType: d.licenseType ?? null,
      licenseExpiry: d.licenseExpiry ? String(d.licenseExpiry).slice(0, 10) : null,
      transporterId: d.transporter?.id ?? null,
      transporterName: d.transporter?.name ?? null,
      remarks: d.remarks ?? null,
      status: d.status,
      ...this.auditFields(d),
    };
  }
}
