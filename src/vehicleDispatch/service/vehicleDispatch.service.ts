import { inject, injectable } from 'inversify';
import { EntityManager } from 'typeorm';
import moment from 'moment-timezone';
import { CreatedWithApproval, withApproval } from '../../utils/approvalMessage';
import { TYPES } from '../../types';
import { VehicleDispatchRepository } from '../repository/vehicleDispatch.repository';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { DocSingalApproverService } from '../../approvalFlow/service/DocSingalApproverService.service';
import { DocumentbService, DocumentWithRelatedData } from '../../approvalFlow/service/documentb.service';
import { DocumentbRepository } from '../../approvalFlow/repository/documentb.repository';
import { ApprovalFlowService } from '../../approvalFlow/service/approvalFlow.service';
import { CacheService } from '../../global/cache.service';
import {
  CreateVehicleDispatchDto,
  DispatchSummaryDto,
  DispatchWritableFields,
  UpdateVehicleDispatchDto,
  VehicleDispatchListItemDto,
  VehicleDispatchUpdateFormDto,
  VehicleDispatchViewDto,
} from '../dto/vehicleDispatch.dto';
import { DispatchType, VehicleDispatch } from '../entity/vehicleDispatch.entity';
import { DispatchProduct } from '../entity/dispatchProduct.entity';
import { DocumentTypeEnum, DocumentTypeEnum as DocDefEnum } from '../../documentDef/entity/documentdef.entity';
import { DocumentStatus } from '../../approvalFlow/entity/docuemnt.entity';
import { formatDateTime } from '../../utils/dateUtils';
import { PaginationOptions } from '../../utils/pagination';
import { BulkDeleteResultDto, DeleteResultDto } from '../../global/general.dto';
import AppError from '../../utils/appError';
import { Status, Source } from '../../utils/status.enum';
import { GrnDeliveryMode } from '../../grn/entity/grn.entity';
import { Address } from '../../address/entity/address.entity';
import { Customer } from '../../customer/addcustomer/entity/customer.entity';
import { Vehicle } from '../../vehicle/entity/vehicle.entity';
import { Drivers } from '../../driver/entity/driver.entity';
import { Transporter } from '../../transporter/entity/transporter.entity';
import {
  blankToNull,
  dateOrNull,
  formatAddress,
  fullName,
  mapAddress,
  readAddress,
} from '../../transport/transport.utils';
import {
  assertDispatchType,
  DispatchSourceResolver,
  partyName,
  ResolvedSource,
  SourceLine,
  syncGrnVehicleDispatchFlag,
  syncGrnVehicleDispatchFlagForDispatch,
  totalsOf,
} from './dispatchSource';
import {
  approvalBlockedReason,
  assertDispatchGate,
  AUTO_REJECT_PREFIX,
  buildDispatchProducts,
  pendingDispatchCounts,
  sourceDispatchStatuses,
} from './dispatchRules';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const IST = 'Asia/Kolkata';
const NUMBER_PREFIX: Record<DispatchType, string> = {
  [DispatchType.PURCHASE]: 'VDP',
  [DispatchType.STOCK_TRANSFER]: 'VDT',
  [DispatchType.SALES]: 'VDS',
};
const SOURCE_LABEL: Record<DispatchType, string> = {
  [DispatchType.PURCHASE]: 'GRN',
  [DispatchType.STOCK_TRANSFER]: 'Stock transfer delivery challan',
  [DispatchType.SALES]: 'Customer delivery challan',
};

/** Relations for the detail / update-form reads. */
const DETAIL_RELATIONS = [
  'companyName', 'grn', 'deliveryChallanNo', 'fromLocation', 'toLocation',
  'customer', 'customer.deliveryDetails', 'customer.deliveryDetails.deliveryAddress', 'toAddress',
  'vendor', 'farmer', 'transporter', 'vehicle', 'driver', 'arrivedBy', 'clientAddress',
  'products', 'products.productName', 'products.variant', 'products.uom', 'products.packagingMaterial',
];

/** Relations for list rows (batch fetch). */
const LIST_RELATIONS = ['companyName', 'grn', 'deliveryChallanNo', 'fromLocation', 'toLocation', 'customer'];

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const decimalOrNull = (value: number | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

@injectable()
export class VehicleDispatchService {
  constructor(
    @inject(TYPES.VehicleDispatchRepository)
    private readonly vehicleDispatchRepository: VehicleDispatchRepository,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.DocSingalApproverService)
    private readonly docSingalApproverService: DocSingalApproverService,
    @inject(TYPES.DocumentbService)
    private readonly documentbService: DocumentbService,
    @inject(TYPES.DocumentbRepository)
    private readonly documentbRepository: DocumentbRepository,
    @inject(TYPES.ApprovalFlowService)
    private approvalFlowService: ApprovalFlowService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  private readonly CACHE_PREFIX = 'vehicleDispatch';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:recycle:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:all:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${this.CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:update:${id}`),
        // The view cache is keyed by Documentb id (+ userId), not by the vehicle
        // dispatch id, so it can only be busted by pattern from here.
        this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:view:*`),
      );
    }
    await Promise.all(tasks);
  }

  private resolver(manager?: EntityManager): DispatchSourceResolver {
    return new DispatchSourceResolver(manager ?? this.vehicleDispatchRepository.manager);
  }

  /**
   * `VDP` / `VDT` / `VDS` + YYMMDD (IST) + 4 digits. The caller holds an advisory
   * lock for the rest of its transaction, so two dispatches never get the same number.
   */
  private async generateSerialNo(dispatchType: DispatchType, manager: EntityManager): Promise<string> {
    const prefix = `${NUMBER_PREFIX[dispatchType]}${moment().tz(IST).format('YYMMDD')}`;
    const [{ last }] = await manager.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(SUBSTRING("vehicleDispatchNo" FROM ${prefix.length + 1}), '\\D', '', 'g'), '')::int), 0) AS last
         FROM dispatch WHERE "vehicleDispatchNo" LIKE $1`,
      [`${prefix}%`],
    );
    return `${prefix}${String(Number(last) + 1).padStart(4, '0')}`;
  }

  // Creating a document without a configured approval flow leaves it with no
  // approvers, so reject it up front — same guard as RFPA / Deal Slip.
  private async checkApprovalFlowExists(userId: string | null | undefined, documentType: DocDefEnum): Promise<void> {
    if (!userId) {
      throw new AppError(400, 'Creator is required to validate the approval flow before creating this document.');
    }
    const approvalFlow = await this.approvalFlowService.getApprovalFlowForUserAndDepartment(userId, documentType);

    if (!approvalFlow) {
      throw new AppError(400, `Approval flow not configured for user. Please configure approval flow for ${documentType} type documents before creating.`);
    }
  }

  // ─── Sources ──────────────────────────────────────────────────────────────

  /** Completed GRNs / DCs of this register without a live dispatch. */
  async getDispatchableSources(dispatchType: unknown, search?: string) {
    return this.resolver().dispatchableSources(assertDispatchType(dispatchType), search);
  }

  /** The source as the form shows it, plus the dispatch already raised against it (if any). */
  async getSource(dispatchType: unknown, sourceId: string) {
    const type = assertDispatchType(dispatchType);
    const resolver = this.resolver();
    const source = await resolver.resolve(type, sourceId);
    const existingDispatch = await resolver.liveDispatch(type, sourceId);
    return { ...source, existingDispatch };
  }

  // ─── Field helpers ────────────────────────────────────────────────────────

  private readTime(value: unknown, label: string): string | null {
    const text = blankToNull(value);
    if (text === null) return null;
    if (!TIME_REGEX.test(text)) throw new AppError(400, `${label} must be a time (HH:mm)`);
    return text.length === 5 ? `${text}:00` : text;
  }

  private applyMovement(d: VehicleDispatch, dto: DispatchWritableFields, isNew: boolean): void {
    const has = (key: keyof DispatchWritableFields) => dto[key] !== undefined;
    if (has('date') || isNew) {
      const date = dateOrNull(dto.date, 'Dispatch date') ?? (isNew ? moment().tz(IST).format('YYYY-MM-DD') : null);
      if (!date) throw new AppError(400, 'Dispatch date is required');
      d.date = date as unknown as Date;
    }
    if (has('batchNo')) d.batchNo = blankToNull(dto.batchNo) as string;
    if (has('outDate')) d.outDate = dateOrNull(dto.outDate, 'Out date');
    if (has('outTime')) d.outTime = this.readTime(dto.outTime, 'Out time') as string;
    if (has('expectedReachingDate')) {
      d.expectedReachingDate = dateOrNull(dto.expectedReachingDate, 'Expected reaching date');
    }
    if (has('reachingTime')) d.reachingTime = this.readTime(dto.reachingTime, 'Expected reaching time') as string;
    if (has('receivingPerson')) d.receivingPerson = blankToNull(dto.receivingPerson) as string;
    if (has('remarksPFL')) d.remarksPFL = blankToNull(dto.remarksPFL) as string;
    this.assertOutAndReachingConsistent(d);
  }

  /** A time is only meaningful with its date, and the vehicle cannot be expected before it left. */
  private assertOutAndReachingConsistent(d: VehicleDispatch): void {
    if (d.outTime && !d.outDate) {
      throw new AppError(400, 'Out date is required when out time is entered');
    }
    if (d.reachingTime && !d.expectedReachingDate) {
      throw new AppError(400, 'Expected reaching date is required when expected reaching time is entered');
    }
    if (d.outDate && d.expectedReachingDate) {
      const before =
        d.expectedReachingDate < d.outDate ||
        (d.expectedReachingDate === d.outDate && d.outTime && d.reachingTime && d.reachingTime < d.outTime);
      if (before) throw new AppError(400, 'Expected reaching date/time cannot be before the out date/time');
    }
  }

  /** Vehicle and driver are required; pending registrations are allowed, rejected or draft ones are not. */
  private async applyTransport(m: EntityManager, d: VehicleDispatch, dto: DispatchWritableFields, isNew: boolean): Promise<void> {
    const touched = isNew || ['vehicleId', 'driverId', 'transporterId'].some((k) => (dto as any)[k] !== undefined);
    if (!touched) return;

    const vehicleId = dto.vehicleId !== undefined ? blankToNull(dto.vehicleId) : d.vehicle?.id ?? null;
    const driverId = dto.driverId !== undefined ? blankToNull(dto.driverId) : d.driver?.id ?? null;
    if (!vehicleId) throw new AppError(400, 'Vehicle is required');
    if (!driverId) throw new AppError(400, 'Driver is required');

    const usable = (status: Status | undefined) => status !== Status.REJECTED && status !== Status.DRAFT;

    const vehicle = await m.getRepository(Vehicle).findOne({ where: { id: vehicleId }, relations: ['transporter'] });
    if (!vehicle) throw new AppError(400, 'Selected vehicle was not found');
    if (!usable(vehicle.status)) throw new AppError(400, `Vehicle ${vehicle.vehicleNo} is not available (status '${vehicle.status}')`);

    const driver = await m.getRepository(Drivers).findOne({ where: { id: driverId } });
    if (!driver) throw new AppError(400, 'Selected driver was not found');
    if (!usable(driver.status)) throw new AppError(400, `Driver ${fullName(driver.firstName, driver.lastName)} is not available (status '${driver.status}')`);

    let transporter: Transporter | null = null;
    const transporterId = dto.transporterId !== undefined ? blankToNull(dto.transporterId) : d.transporter?.id ?? null;
    if (transporterId) {
      transporter = await m.getRepository(Transporter).findOne({ where: { id: transporterId } });
      if (!transporter) throw new AppError(400, 'Selected transporter was not found');
      if (!usable(transporter.status)) throw new AppError(400, `Transporter "${transporter.name}" is not available (status '${transporter.status}')`);
    } else if (vehicle.transporter) {
      transporter = vehicle.transporter;
    }

    d.vehicle = { id: vehicle.id } as Vehicle;
    d.driver = { id: driver.id } as Drivers;
    d.transporter = (transporter ? { id: transporter.id } : null) as Transporter;
    // Snapshot, so an issued dispatch and its print never change with the masters.
    d.vehicleNo = vehicle.vehicleNo;
    d.vehicleType = vehicle.vehicleType;
    d.vehicleCapacityKg = vehicle.capacityKg ?? (null as unknown as string);
    d.driverName = fullName(driver.firstName, driver.lastName);
    d.driverMobNo = driver.phoneNumber;
    d.driverAltMobNo = driver.altPhoneNumber ?? (null as unknown as string);
    d.licenseNo = driver.licenseNo ?? (null as unknown as string);
    d.transporterName = transporter?.name ?? (null as unknown as string);
    d.transporterContact = transporter?.primaryPhone ?? (null as unknown as string);
  }

  /** Whether this dispatch goes to a customer rather than to a CC / DC. */
  private goesToCustomer(dispatchType: DispatchType, deliveryMode: GrnDeliveryMode | null | undefined): boolean {
    return (
      dispatchType === DispatchType.SALES ||
      (dispatchType === DispatchType.PURCHASE && deliveryMode === GrnDeliveryMode.DIRECT_TO_CUSTOMER)
    );
  }

  /**
   * Customer + effective shipping address: the typed current shipping address when
   * given, otherwise a copy of the customer's registered delivery address.
   */
  private async applyCustomer(
    m: EntityManager,
    d: VehicleDispatch,
    dto: DispatchWritableFields,
    fallbackCustomerId: string | null,
  ): Promise<void> {
    const customerId = (dto.customerId !== undefined ? blankToNull(dto.customerId) : d.customer?.id ?? null) ?? fallbackCustomerId;
    if (!customerId) throw new AppError(400, 'Customer is required');

    const customer = await m.getRepository(Customer).findOne({
      where: { id: customerId },
      relations: ['deliveryDetails', 'deliveryDetails.deliveryAddress'],
    });
    if (!customer) throw new AppError(400, 'Selected customer was not found');

    const typed = dto.currentShippingAddress !== undefined ? readAddress(dto.currentShippingAddress) : null;
    const keepExisting = dto.currentShippingAddress === undefined && dto.customerId === undefined && !!d.toAddress;
    if (!keepExisting) {
      const registered = customer.deliveryDetails?.deliveryAddress;
      const next = typed ?? (registered ? readAddress(registered) : null);
      if (next) {
        if (d.toAddress?.id) Object.assign(d.toAddress, next);
        else d.toAddress = next as unknown as Address;
      } else {
        d.toAddress = null as unknown as Address;
      }
      d.usesCurrentShippingAddress = !!typed;
    }

    d.customer = { id: customer.id } as Customer;
    d.clientName = customer.organisationName;
  }

  private linesToProducts(m: EntityManager, lines: SourceLine[]): DispatchProduct[] {
    return buildDispatchProducts(m, lines);
  }

  // ─── Create / update ──────────────────────────────────────────────────────

  async create(data: CreateVehicleDispatchDto): Promise<CreatedWithApproval<VehicleDispatch>> {
    await this.checkApprovalFlowExists(data.requestedBy, DocumentTypeEnum.OPERATION);
    const dispatchType = assertDispatchType(data.dispatchType);
    const sourceId = blankToNull(data.sourceId);
    if (!sourceId) throw new AppError(400, `${SOURCE_LABEL[dispatchType]} is required`);

    const saved = await this.vehicleDispatchRepository.manager.transaction(async (m) => {
      const resolver = this.resolver(m);
      await resolver.lockSource(dispatchType, sourceId);
      const source = await resolver.resolve(dispatchType, sourceId);

      // The dispatch is raised as soon as the source exists; it can only be approved
      // once the source is COMPLETE (docs/dispatch-enforcement-plan.md D1 / D5).
      if (!source.sourceStatus) {
        throw new AppError(400, `${SOURCE_LABEL[dispatchType]} ${source.sourceNo ?? ''} has no approval document yet`);
      }
      if (source.sourceStatus === DocumentStatus.REJECT) {
        throw new AppError(400, `${SOURCE_LABEL[dispatchType]} ${source.sourceNo ?? ''} was rejected, so it cannot be dispatched`);
      }
      const live = await resolver.liveDispatch(dispatchType, sourceId);
      if (live) {
        throw new AppError(409, `A vehicle dispatch already exists for ${source.sourceNo ?? 'this source'} (${live.vehicleDispatchNo ?? live.id})`);
      }
      if (!source.products.length) throw new AppError(400, `${SOURCE_LABEL[dispatchType]} ${source.sourceNo ?? ''} has no product lines`);

      const d = m.getRepository(VehicleDispatch).create();
      d.dispatchType = dispatchType;
      if (dispatchType === DispatchType.PURCHASE) d.grn = { id: sourceId } as any;
      else d.deliveryChallanNo = { id: sourceId } as any;
      d.companyName = (source.company ? { id: source.company.id } : null) as any;

      if (dispatchType === DispatchType.PURCHASE && source.party) {
        d.source = source.party.type;
        if (source.party.type === Source.VENDOR) d.vendor = { id: source.party.id } as any;
        else d.farmer = { id: source.party.id } as any;
      }
      d.fromLocation = (source.fromLocation ? { id: source.fromLocation.id } : null) as any;
      d.fromText = source.fromText as string;

      if (dispatchType === DispatchType.SALES) {
        // A sales dispatch delivers what the Customer DC says: its customer and its
        // current shipping address (else the customer's registered one), not the form's.
        if (!source.customer) throw new AppError(400, `Customer delivery challan ${source.sourceNo ?? ''} has no customer`);
        await this.applyCustomer(m, d, { customerId: source.customer.id, currentShippingAddress: source.currentShippingAddress }, null);
      } else if (this.goesToCustomer(dispatchType, source.deliveryMode)) {
        await this.applyCustomer(m, d, data, null);
      } else {
        if (!source.toLocation) {
          throw new AppError(400, `${SOURCE_LABEL[dispatchType]} ${source.sourceNo ?? ''} has no destination CC / DC`);
        }
        d.toLocation = { id: source.toLocation.id } as any;
      }

      await this.applyTransport(m, d, data, true);
      this.applyMovement(d, data, true);

      d.products = this.linesToProducts(m, source.products);
      d.totalQuantity = decimalOrNull(source.totals.quantity) as string;
      d.totalGrossWeight = decimalOrNull(source.totals.grossWeight) as string;
      d.totalNetWeight = decimalOrNull(source.totals.netWeight) as string;
      d.totalAmount = decimalOrNull(source.totals.amount) as string;

      await m.query(`SELECT pg_advisory_xact_lock(hashtext('vehicle-dispatch-no'))`);
      d.vehicleDispatchNo = await this.generateSerialNo(dispatchType, m);
      const created = await m.getRepository(VehicleDispatch).save(d);
      if (dispatchType === DispatchType.PURCHASE) await syncGrnVehicleDispatchFlag(m, sourceId);
      return created;
    });

    // Same order as before: the approval document is created after the business row.
    const document = await this.documentbService.createDocument({
      type: DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER,
      docDef: DocumentTypeEnum.OPERATION,
      status: DocumentStatus.HOLD,
      remarks: 'Document auto-created with Vehical_Dispatch',
      lastActionBy: { id: data.requestedBy },
      document_type_id: saved.id,
    });
    const assignment = await this.documentbService.startApprovalFlow(document.id);

    await this.invalidateCache();
    if (dispatchType === DispatchType.PURCHASE) await this.cacheService.invalidatePattern('grn:numbers:*');
    return withApproval(saved, assignment);
  }

  /** Header, transport, movement and (where it applies) customer can change; the source and its lines cannot. */
  async update(id: string, data: UpdateVehicleDispatchDto, updatedBy: string): Promise<VehicleDispatch | null> {
    const repo = this.vehicleDispatchRepository;
    const d = await repo.findOne({
      where: { id },
      relations: ['grn', 'customer', 'toAddress', 'transporter', 'vehicle', 'driver', 'products'],
    });
    if (!d) return null;

    // D-5: an approved dispatch is a record of what left; it cannot be edited.
    const latest: Array<{ status: string | null }> = await repo.manager.query(
      `SELECT d.status::text AS status FROM documents d WHERE d.document_type_id = $1 AND d.type::text = $2 ORDER BY d."createdAt" DESC LIMIT 1`,
      [id, DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER],
    );
    if (latest[0]?.status === DocumentStatus.COMPLETE) {
      throw new AppError(409, `Dispatch ${d.vehicleDispatchNo ?? ''} is approved, so it cannot be edited`.replace('  ', ' '));
    }

    const before = this.snapshot(d);
    const isLegacy = !d.products?.length;

    await repo.manager.transaction(async (m) => {
      // Only a direct-to-customer purchase picks its customer on the form; a sales
      // dispatch keeps the Customer DC's customer and address.
      if (!isLegacy && d.dispatchType === DispatchType.PURCHASE && this.goesToCustomer(d.dispatchType, d.grn?.deliveryMode)) {
        if (data.customerId !== undefined || data.currentShippingAddress !== undefined || !d.customer) {
          await this.applyCustomer(m, d, data, null);
        }
      }
      await this.applyTransport(m, d, data, false);
      this.applyMovement(d, data, false);
      await m.getRepository(VehicleDispatch).save(d);
    });

    try {
      await this.auditLogService.logChange('VehicleDispatch', id, before, this.snapshot(d), updatedBy);
    } catch {
      // The audit trail must never block an edit.
    }
    await this.invalidateCache(id);
    return d;
  }

  private snapshot(d: VehicleDispatch): Record<string, unknown> {
    return {
      date: d.date,
      batchNo: d.batchNo,
      transporter: d.transporter?.id ?? null,
      vehicle: d.vehicle?.id ?? null,
      driver: d.driver?.id ?? null,
      vehicleNo: d.vehicleNo,
      driverName: d.driverName,
      outDate: d.outDate,
      outTime: d.outTime,
      expectedReachingDate: d.expectedReachingDate,
      reachingTime: d.reachingTime,
      receivingPerson: d.receivingPerson,
      remarksPFL: d.remarksPFL,
      customer: d.customer?.id ?? null,
      shippingAddress: formatAddress(d.toAddress),
    };
  }

  /**
   * Gate signal for purchase and stock transfer dispatches to a CC / DC. Fills the
   * reaching time with the current time when it is still empty. Idempotent.
   */
  async markArrived(id: string, userId: string): Promise<VehicleDispatch> {
    const d = await this.vehicleDispatchRepository.findOne({ where: { id }, relations: ['toLocation'] });
    if (!d) throw new AppError(404, 'Vehicle dispatch not found');
    if (d.dispatchType === DispatchType.SALES || !d.toLocation) {
      throw new AppError(400, 'Only purchase and stock transfer dispatches to a CC / DC can be marked as arrived');
    }
    // Both the source and this dispatch must be fully approved first.
    const sourceId = (await this.vehicleDispatchRepository.query(
      `SELECT COALESCE(grn_id, delivery_challan_id)::text AS source_id FROM dispatch WHERE id = $1`,
      [id],
    ))[0]?.source_id as string | undefined;
    if (sourceId) await assertDispatchGate(this.vehicleDispatchRepository.manager, d.dispatchType, sourceId);
    if (!d.arrivedAt) {
      d.arrivedAt = new Date();
      d.arrivedBy = { id: userId } as any;
      if (!d.reachingTime) d.reachingTime = moment().tz(IST).format('HH:mm:ss');
      await this.vehicleDispatchRepository.save(d);
      await this.invalidateCache(id);
    }
    return d;
  }

  /** The live dispatch of a source, for the Dispatch tab on the GRN / DC detail pages. */
  async getBySource(dispatchType: unknown, sourceId: string): Promise<DispatchSummaryDto | null> {
    const type = assertDispatchType(dispatchType);
    const live = await this.resolver().liveDispatch(type, sourceId);
    if (!live) return null;
    const d = await this.vehicleDispatchRepository.findOne({ where: { id: live.id } });
    if (!d) return null;
    return {
      id: d.id,
      documentId: live.documentId,
      vehicleDispatchNo: d.vehicleDispatchNo ?? null,
      status: live.status,
      vehicleNo: d.vehicleNo ?? null,
      driverName: d.driverName ?? null,
      transporterName: d.transporterName ?? null,
      totalNetWeight: num(d.totalNetWeight),
      outDate: d.outDate ?? null,
      outTime: d.outTime ?? null,
      expectedReachingDate: d.expectedReachingDate ?? null,
      reachingTime: d.reachingTime ?? null,
      arrivedAt: d.arrivedAt ?? null,
    };
  }

  // ─── Read models ──────────────────────────────────────────────────────────

  private sourceNo(d: VehicleDispatch): string | null {
    return d.grn?.grnNo ?? d.deliveryChallanNo?.challanNo ?? null;
  }

  private toRow(doc: DocumentWithRelatedData, d: VehicleDispatch): VehicleDispatchListItemDto {
    const { createdDate, createdTime } = formatDateTime(doc.createdAt);
    return {
      documentId: doc.id,
      overAllStatus: doc.status,
      createdBy: `${doc.lastActionBy?.firstName ?? ''} ${doc.lastActionBy?.lastName ?? ''}`.trim(),
      createdDate,
      createdTime,
      id: d.id,
      sourceId: d.grn?.id ?? d.deliveryChallanNo?.id ?? null,
      dispatchType: d.dispatchType ?? null,
      vehicleDispatchNo: d.vehicleDispatchNo ?? null,
      date: d.date ?? null,
      batchNo: d.batchNo ?? null,
      sourceNo: this.sourceNo(d),
      companyName: d.companyName?.name ?? null,
      fromName: d.fromLocation?.name ?? d.fromText ?? null,
      toName: d.toLocation?.name ?? d.customer?.organisationName ?? d.clientName ?? null,
      vehicleNo: d.vehicleNo ?? null,
      vehicleType: d.vehicleType ?? null,
      driverName: d.driverName ?? null,
      driverMobNo: d.driverMobNo ?? null,
      transporterName: d.transporterName ?? null,
      totalNetWeight: num(d.totalNetWeight),
      outDate: d.outDate ?? null,
      outTime: d.outTime ?? null,
      expectedReachingDate: d.expectedReachingDate ?? null,
      reachingTime: d.reachingTime ?? null,
      arrivedAt: d.arrivedAt ?? null,
    };
  }

  private productLines(d: VehicleDispatch): SourceLine[] {
    return (d.products ?? []).map((p) => ({
      productId: p.productName?.id ?? null,
      productName: p.productName?.name ?? null,
      variantId: p.variant?.id ?? null,
      variantName: p.variant?.variantName ?? null,
      uomId: p.uom?.id ?? null,
      uomName: p.uom?.unit ?? null,
      quantity: num(p.quantity),
      unitPrice: num(p.unitPrice),
      amount: num(p.amount),
      packagingMaterialId: p.packagingMaterial?.id ?? null,
      packagingMaterialName: p.packagingMaterial?.packagingMaterialName ?? null,
      packingMaterialWeight: num(p.packingMaterialWeight),
      grossWeight: num(p.grossWeight),
      netWeight: num(p.netWeight),
    }));
  }

  /** The stored dispatch in the shape of a resolved source (read-only parts of the form). */
  private storedAsSource(d: VehicleDispatch, sourceDocument: { id: string; status: string } | null): ResolvedSource {
    const products = this.productLines(d);
    const partyRef = d.source === Source.VENDOR ? d.vendor : d.source === Source.FARMER ? d.farmer : null;
    return {
      dispatchType: d.dispatchType,
      sourceId: d.grn?.id ?? d.deliveryChallanNo?.id ?? '',
      sourceNo: this.sourceNo(d),
      sourceDocumentId: sourceDocument?.id ?? null,
      sourceStatus: sourceDocument?.status ?? null,
      company: d.companyName ? { id: d.companyName.id, name: d.companyName.name ?? null } : null,
      deliveryMode: d.grn?.deliveryMode ?? null,
      source: d.source ?? null,
      party: partyRef && d.source ? { id: partyRef.id, name: partyName(d.source, d.vendor, d.farmer), type: d.source } : null,
      fromLocation: d.fromLocation ? { id: d.fromLocation.id, name: d.fromLocation.name ?? null } : null,
      fromText: d.fromText ?? null,
      toLocation: d.toLocation ? { id: d.toLocation.id, name: d.toLocation.name ?? null } : null,
      customer: d.customer ? { id: d.customer.id, name: d.customer.organisationName ?? null } : null,
      currentShippingAddress: d.usesCurrentShippingAddress ? mapAddress(d.toAddress) : null,
      products,
      totals: products.length ? totalsOf(products) : {
        quantity: num(d.totalQuantity) ?? 0,
        grossWeight: num(d.totalGrossWeight) ?? 0,
        netWeight: num(d.totalNetWeight) ?? 0,
        amount: num(d.totalAmount) ?? 0,
      },
    };
  }

  private async loadSourceDocument(d: VehicleDispatch): Promise<{ id: string; status: string } | null> {
    const sourceId = d.grn?.id ?? d.deliveryChallanNo?.id;
    return sourceId ? this.resolver().sourceDocument(d.dispatchType, sourceId) : null;
  }

  /** GET /update/:id - current values for the edit form plus the read-only display. */
  async getForUpdate(id: string): Promise<VehicleDispatchUpdateFormDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<VehicleDispatchUpdateFormDto>(cacheKey);
    if (cached) return cached;

    const d = await this.vehicleDispatchRepository.findOne({ where: { id }, relations: DETAIL_RELATIONS });
    if (!d) return null;
    const display = this.storedAsSource(d, await this.loadSourceDocument(d));
    const result: VehicleDispatchUpdateFormDto = {
      id: d.id,
      dispatchType: d.dispatchType,
      sourceId: display.sourceId || null,
      sourceNo: display.sourceNo,
      date: d.date ?? null,
      batchNo: d.batchNo ?? null,
      transporterId: d.transporter?.id ?? null,
      vehicleId: d.vehicle?.id ?? null,
      driverId: d.driver?.id ?? null,
      outDate: d.outDate ?? null,
      outTime: d.outTime ?? null,
      expectedReachingDate: d.expectedReachingDate ?? null,
      reachingTime: d.reachingTime ?? null,
      receivingPerson: d.receivingPerson ?? null,
      remarksPFL: d.remarksPFL ?? null,
      customerId: d.customer?.id ?? null,
      currentShippingAddress: d.usesCurrentShippingAddress ? mapAddress(d.toAddress) : null,
      display,
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  /** Visible documents of the register, newest first (visibility: creator / approver / admin). */
  private async listRows(
    queryOptions: PaginationOptions,
    userId: string,
    isAdmin: boolean,
    includeDeleted: boolean,
    dispatchType?: DispatchType,
  ): Promise<VehicleDispatchListItemDto[]> {
    const docs = (await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(
      userId,
      DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER,
      includeDeleted,
      includeDeleted ? undefined : queryOptions,
      isAdmin,
    )) as DocumentWithRelatedData[];
    docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const ids = docs.map((doc) => doc.document_type_id).filter(Boolean) as string[];
    if (!ids.length) return [];

    const qb = this.vehicleDispatchRepository.createQueryBuilder('vd').where('vd.id IN (:...ids)', { ids });
    for (const relation of LIST_RELATIONS) qb.leftJoinAndSelect(`vd.${relation}`, relation);
    if (includeDeleted) qb.withDeleted().andWhere('vd.isDeleted = true');
    else qb.andWhere('vd.isDeleted = false').andWhere('vd.deletedAt IS NULL');
    if (dispatchType) qb.andWhere('vd.dispatchType = :dispatchType', { dispatchType });
    const dispatches = await qb.getMany();
    const byId = new Map(dispatches.map((d) => [d.id, d]));

    let rows = docs
      .filter((doc) => doc.document_type_id && byId.has(doc.document_type_id))
      .map((doc) => this.toRow(doc, byId.get(doc.document_type_id!)!));

    const { search, sort } = queryOptions;
    if (search && search.trim()) {
      const term = search.toLowerCase();
      const flat = (obj: any): string =>
        obj == null ? '' : typeof obj === 'object' ? Object.values(obj).map(flat).join(' ') : String(obj);
      rows = rows.filter((row) => flat(row).toLowerCase().includes(term));
    }
    if (sort) {
      const [field, direction] = sort.split(':');
      const order = direction?.toUpperCase() === 'DESC' ? -1 : 1;
      rows.sort((a: any, b: any) => {
        const x = a[field];
        const y = b[field];
        if (x == null && y == null) return 0;
        if (x == null) return -order;
        if (y == null) return order;
        if (!isNaN(x) && !isNaN(y)) return (Number(x) - Number(y)) * order;
        return String(x).localeCompare(String(y)) * order;
      });
    }
    return rows;
  }

  public async getAllvehicalDispatch(
    queryOptions: PaginationOptions,
    userId: string,
    isAdmin: boolean = false,
    dispatchType?: unknown,
  ): Promise<any> {
    const type = dispatchType === undefined || dispatchType === null || dispatchType === '' ? undefined : assertDispatchType(dispatchType);
    const cacheKey = `${this.CACHE_PREFIX}:list:${userId}:${isAdmin ? 'admin' : 'user'}:${type ?? 'all'}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const rows = await this.listRows(queryOptions, userId, isAdmin, false, type);
    const result = {
      data: rows,
      meta: { total: rows.length, page: queryOptions.page || 1, pages: Math.ceil(rows.length / (queryOptions.limit || 10)) },
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  public async getAllRecycleBinVehicalDispatch(queryOptions: PaginationOptions, userId: string, dispatchType?: unknown): Promise<any> {
    const type = dispatchType === undefined || dispatchType === null || dispatchType === '' ? undefined : assertDispatchType(dispatchType);
    const cacheKey = `${this.CACHE_PREFIX}:recycle:${userId}:${type ?? 'all'}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const rows = await this.listRows(queryOptions, userId, false, true, type);
    const result = {
      data: rows,
      meta: { total: rows.length, page: queryOptions.page || 1, pages: Math.ceil(rows.length / (queryOptions.limit || 10)) },
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  public async getVehicalDispatchByIdForView(docid: string, userId: string, isAdmin: boolean = false): Promise<VehicleDispatchViewDto | null> {
    // Keyed by userId as well: access is checked per user (non creator/approver
    // gets null -> 403), so a shared key would serve the document to users who
    // are not allowed to see it.
    const cacheKey = `${this.CACHE_PREFIX}:view:${docid}:${userId}`;
    const cached = await this.cacheService.get<VehicleDispatchViewDto>(cacheKey);
    if (cached) return cached;

    const document = await this.docSingalApproverService.getSingleApprovalDocumentById(docid, userId, isAdmin);
    if (!document?.documentTypeId) return null;

    const d = await this.vehicleDispatchRepository.findOne({ where: { id: document.documentTypeId }, relations: DETAIL_RELATIONS });
    if (!d) throw new AppError(404, 'Vehicle dispatch not found');

    const stored = this.storedAsSource(d, await this.loadSourceDocument(d));
    const { createdDate, createdTime } = formatDateTime(d.createdAt);
    const registered = d.customer?.deliveryDetails?.deliveryAddress;
    const result: VehicleDispatchViewDto = {
      documentId: document.documentId,
      overAllStatus: document.status,
      createdBy: document.createdBy?.name || null,
      createdDate,
      createdTime,
      approvalSummary: document.approvalSummary ?? null,
      id: d.id,
      dispatchType: d.dispatchType ?? null,
      vehicleDispatchNo: d.vehicleDispatchNo ?? null,
      date: d.date ?? null,
      batchNo: d.batchNo ?? null,
      sourceNo: stored.sourceNo,
      companyName: d.companyName?.name ?? null,
      fromName: d.fromLocation?.name ?? d.fromText ?? null,
      toName: d.toLocation?.name ?? d.customer?.organisationName ?? d.clientName ?? null,
      vehicleNo: d.vehicleNo ?? null,
      vehicleType: d.vehicleType ?? null,
      driverName: d.driverName ?? null,
      driverMobNo: d.driverMobNo ?? null,
      transporterName: d.transporterName ?? null,
      totalNetWeight: num(d.totalNetWeight),
      outDate: d.outDate ?? null,
      outTime: d.outTime ?? null,
      expectedReachingDate: d.expectedReachingDate ?? null,
      reachingTime: d.reachingTime ?? null,
      arrivedAt: d.arrivedAt ?? null,
      sourceId: stored.sourceId || null,
      sourceDocumentId: stored.sourceDocumentId,
      source: stored.source,
      party: stored.party,
      fromLocation: stored.fromLocation,
      fromText: stored.fromText,
      toLocation: stored.toLocation,
      customer: stored.customer,
      registeredShippingAddress: registered ? formatAddress(registered) || null : null,
      shippingAddress: mapAddress(d.toAddress),
      usesCurrentShippingAddress: !!d.usesCurrentShippingAddress,
      transporterContact: d.transporterContact ?? null,
      vehicleCapacityKg: num(d.vehicleCapacityKg),
      driverAltMobNo: d.driverAltMobNo ?? null,
      licenseNo: d.licenseNo ?? null,
      receivingPerson: d.receivingPerson ?? null,
      remarksPFL: d.remarksPFL ?? null,
      products: stored.products,
      totals: stored.totals,
      arrivedBy: d.arrivedBy ? `${d.arrivedBy.firstName ?? ''} ${d.arrivedBy.lastName ?? ''}`.trim() || null : null,
      isLegacy: !d.products?.length,
      sourceStatus: stored.sourceStatus,
      approvalBlockedReason:
        document.status === DocumentStatus.COMPLETE || document.status === DocumentStatus.REJECT
          ? null
          : await approvalBlockedReason(this.vehicleDispatchRepository.manager, d.id),
      autoRejectedReason: await this.autoRejectedReason(document.documentId, document.status),
      clientName: d.clientName ?? null,
      clientAddress: formatAddress(d.clientAddress) || null,
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  /** The reason recorded when the dispatch was rejected because its source was rejected or deleted. */
  private async autoRejectedReason(documentId: string, status: string): Promise<string | null> {
    if (status !== DocumentStatus.REJECT) return null;
    const rows = await this.vehicleDispatchRepository.query(`SELECT remarks FROM documents WHERE id = $1`, [documentId]);
    const remarks: string | null = rows[0]?.remarks ?? null;
    return remarks && remarks.startsWith(AUTO_REJECT_PREFIX) ? remarks.slice(AUTO_REJECT_PREFIX.length) : null;
  }

  /** Dispatch status of many sources of one register (chips on the GRN / DC lists). */
  async getSourceStatuses(dispatchType: unknown, sourceIds: unknown) {
    const type = assertDispatchType(dispatchType);
    if (!Array.isArray(sourceIds)) throw new AppError(400, 'sourceIds must be an array');
    return sourceDispatchStatuses(this.vehicleDispatchRepository.manager, type, sourceIds.map(String));
  }

  /** Per register, sources since go-live that still wait for their dispatch. */
  async getPendingCounts() {
    return pendingDispatchCounts(this.vehicleDispatchRepository.manager);
  }

  // ─── Delete (unchanged behaviour) ─────────────────────────────────────────

  async delete(id: string): Promise<DeleteResultDto | null> {
    const dispatch = await this.vehicleDispatchRepository.findOne({ where: { id } });
    if (!dispatch) {
      throw new AppError(404, `Distpatch with ID ${id} not found`);
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);
    dispatch.deletionScheduledAt = sixMonthsFromNow;
    await this.vehicleDispatchRepository.save(dispatch);

    await this.invalidateCache(id);
    return { No: dispatch.vehicleDispatchNo };
  }

  public async deleteMultipleVehicleDispatch(ids: string[]): Promise<BulkDeleteResultDto> {
    const success: { id: string; No: string }[] = [];
    const failed: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const vehicalDispatch = await this.vehicleDispatchRepository.findOne({ where: { id } });

      if (!vehicalDispatch) {
        failed.push({ id, reason: 'Vehicle Dispatch not found' });
        continue;
      }

      const relatedDocument = await this.documentbRepository.findOne({
        where: { document_type_id: vehicalDispatch.id },
      });

      if (!relatedDocument) {
        throw new Error(`Something went wrong`);
      }

      await this.documentbRepository.softDelete(relatedDocument.id);
      await this.documentbRepository.update(relatedDocument.id, { isDeleted: true } as any);

      await this.vehicleDispatchRepository.softDelete(vehicalDispatch.id);
      await this.vehicleDispatchRepository.update(vehicalDispatch.id, { isDeleted: true } as any);
      await syncGrnVehicleDispatchFlagForDispatch(this.vehicleDispatchRepository.manager, vehicalDispatch.id);
      success.push({ id, No: vehicalDispatch.vehicleDispatchNo });
    }
    const message = `Deletion completed. Success: ${success.length}, Failed: ${failed.length}`;
    await this.invalidateCache();
    await this.cacheService.invalidatePattern('grn:numbers:*');
    return { success, failed, message };
  }
}
