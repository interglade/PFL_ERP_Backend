import { inject, injectable } from 'inversify';
import * as XLSX from 'xlsx';
import { Farmer, LandHoldingStatus, LandStatus } from '../entity/farmer.entity';
import { FarmerRepository } from '../repository/farmer.repository';
import { TYPES } from '../../types';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../../middleware/spaces.config';

import { Crop } from '../entity/crop.entity';

import fs from 'fs';
;

import AppError from '../../utils/appError';
import { applyNumericFilter, buildQuery, PaginationOptions } from '../../utils/pagination';

import { AppDataSource } from '../../utils/data-source';
import { parseExcelDate } from '../../utils/excelParser';
import { UserRepository } from '../../employee/repository/user.repository';

import { parseStatus, Status } from '../../utils/status.enum';
import { applyMasterFilters } from '../../global/filters/masterDataFilter';
import { FARMER_FILTERS } from '../filters/farmer.filters';
import { NotificationService } from '../../notification/service/notification.service';
import { formatDateTime } from '../../utils/dateUtils';
import { CreateFarmerDto, FarmerListResponseDto, FarmerListItemDto, AddressDto, CropDto, LandHoldingStatusType, LandStatusType, UpdateFarmerDto, FarmerResponseDto } from '../dto/farmer.dto';
import { In } from 'typeorm';
import { CacheService } from '../../global/cache.service';
import { AddressRepository } from '../../address/repository/address.repository';
import { CropRepository } from '../repository/crop.repository';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { Role, User } from '../../employee/entity/user.entity';
import { Address } from '../../address/entity/address.entity';
import { Product } from '../../product/createproduct/entity/product.entity';
import { Repository } from 'typeorm';
import {
  attachImportReport,
  buildDataWorkbook,
  buildTemplateWorkbook,
  deleteFromSpaces,
  UploadedExport,
  uploadWorkbookToSpaces,
} from '../../excel/excelFile.service';
import {
  emptySummary,
  ExcelRow,
  ImportSummary,
  readUploadedSheet,
} from '../../excel/excelImport.service';
import { FARMER_CROP_GROUP, FARMER_SHEET } from '../excel/farmer.columns';
import { LookupIndex } from '../../excel/lookupIndex';
import { DraftLinks, EMPTY_LINK } from '../../excel/draftLinks';
import { ContactPool, mergeFilled, RegistrationRowReader } from '../../excel/registrationRow';
import { FORMAT_RULES } from '../../excel/formatRules';
import { assertImportPrerequisites } from '../../excel/importPrerequisites';
import { countMasterRecords } from '../../excel/importPrerequisiteCounts';

/** "First Last" for the import report. */
const farmerName = (farmer: Farmer): string | null =>
  [farmer.farmerfName, farmer.farmerlName].filter(Boolean).join(' ') || null;

const CACHE_PREFIX = 'farmer';
const CACHE_TTL = 180;
const CACHE_TTL_DETAIL = 300;

@injectable()
export class FarmerService {
  constructor(
    @inject(TYPES.FarmerRepository)
    private readonly farmerRepository: FarmerRepository,
    @inject(TYPES.AddressRepository)
    private readonly addressRepository: AddressRepository,
    @inject(TYPES.CropRepository)
    private readonly cropRepository: CropRepository,
    @inject(TYPES.UserRepository)
    private userRepository: UserRepository,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
    @inject(TYPES.NotificationService)
    private readonly notificationService: NotificationService,
  ) {}

  // ─── Cache Helpers ────────────────────────────────────────────────────────

  private async invalidateFarmerCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${CACHE_PREFIX}:view:${id}`),
        this.cacheService.del(`${CACHE_PREFIX}:update:${id}`),
      );
    }
    await Promise.all(tasks);
  }





  async getAllFarmers(options: PaginationOptions, userId: string): Promise<FarmerListResponseDto> {
  // Fetch the user to check their role
  const user = await this.userRepository.findOneBy({ id: userId });
  const isAdmin = user?.roles?.includes(Role.ADMIN);
  const isVerifier = user?.roles?.includes(Role.VERIFIER);
  const isPrivileged = isAdmin || isVerifier;

  // Include userId in cache key so different users don't share results
  const key = `${CACHE_PREFIX}:list:${userId}:${JSON.stringify(options)}`;
  const cached = await this.cacheService.get<FarmerListResponseDto>(key);
  if (cached) return cached;

  const queryBuilder = this.farmerRepository
    .createQueryBuilder('farmer')
    .leftJoin('farmer.createdBy', 'createdBy')
    .leftJoin('farmer.residensialAddress', 'residensialAddress')
    .leftJoin('farmer.farmAddress', 'farmAddress')
    .select([
      'farmer.id', 'farmer.status', 'farmer.farmerCode',
      'farmer.farmerfName', 'farmer.farmermName', 'farmer.farmerlName',
      'farmer.primaryMobileNo', 'farmer.secondaryMobileNo', 'farmer.email',
      'farmer.gender', 'farmer.dob', 'farmer.totalLandArea', 'farmer.cultivationArea',
      'farmer.landHoldingStatus', 'farmer.landStatus', 'farmer.idProofNo', 'farmer.createdAt',
      'createdBy.firstName', 'createdBy.lastName',
      'residensialAddress.address1', 'residensialAddress.address2', 'residensialAddress.location',
      'residensialAddress.city', 'residensialAddress.state', 'residensialAddress.pincode',
      'farmAddress.address1', 'farmAddress.address2', 'farmAddress.location',
      'farmAddress.city', 'farmAddress.state', 'farmAddress.pincode',
    ])
    .orderBy('farmer.createdAt', 'DESC');

  // Visibility rules:
  // - Employee/other: only their own records (drafts included)
  // - Verifier (non-admin): all records except drafts
  // - Admin: all records; own drafts visible, others' drafts hidden
  if (!isPrivileged) {
    // Employee → only own records (all statuses)
    queryBuilder.where('createdBy.id = :userId', { userId });
  } else if (isVerifier && !isAdmin) {
    // Pure Verifier → everyone's records, no drafts at all
    queryBuilder.where('farmer.status != :draft', { draft: Status.DRAFT });
  } else if (isAdmin) {
    // Admin → everyone's records; own drafts visible, others' drafts hidden
    queryBuilder.where(
      '(farmer.status != :draft OR createdBy.id = :userId)',
      { draft: Status.DRAFT, userId },
    );
  }

  applyMasterFilters(queryBuilder, FARMER_FILTERS, options.masterFilters);

  const farmers = await buildQuery(queryBuilder, options, 'farmer');

  const formatAddr = (addr: any): string => addr
    ? [addr.address1, addr.address2, addr.location, addr.city, addr.state, addr.pincode]
        .filter(Boolean).join(' ')
    : '';

  const response: FarmerListResponseDto = {
    data: farmers.data.map((farmer: any): FarmerListItemDto => {
      const { createdDate, createdTime } = formatDateTime(farmer.createdAt);
      return {
        id: farmer.id,
        status: farmer.status,
        farmerCode: farmer.farmerCode?.toUpperCase() ?? '',
        farmerfName: farmer.farmerfName,
        farmermName: farmer.farmermName,
        farmerlName: farmer.farmerlName,
        primaryMobileNo: farmer.primaryMobileNo,
        secondaryMobileNo: farmer.secondaryMobileNo,
        email: farmer.email,
        gender: farmer.gender,
        dob: farmer.dob,
        totalLandArea: farmer.totalLandArea,
        cultivationArea: farmer.cultivationArea,
        landHoldingStatus: farmer.landHoldingStatus,
        landStatus: farmer.landStatus,
        idProofNo: farmer.idProofNo,
        residensialAddress: formatAddr(farmer.residensialAddress),
        farmAddress: formatAddr(farmer.farmAddress),
        createdBy: farmer.createdBy
          ? `${farmer.createdBy.firstName} ${farmer.createdBy.lastName}`
          : null,
        createdDate,
        createdTime,
        
      };
    }),
    meta: farmers.meta,
  };

  await this.cacheService.set(key, response, CACHE_TTL);
  return response;
}





  public async getAllFarmer(
    queryOptions: PaginationOptions,
  ): Promise<{ data1: any[]; meta: any }> {
    const key = `${CACHE_PREFIX}:all:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.farmerRepository
      .createQueryBuilder('farmer')
      .leftJoinAndSelect('farmer.residensialAddress', 'residensialAddress')
      .leftJoinAndSelect('farmer.farmAddress', 'farmAddress')
      .leftJoin('farmer.createdBy', 'createdBy')
      .addSelect(['createdBy.firstName', 'createdBy.lastName'])
      .orderBy('farmer.createdAt', 'DESC');

    const { data, meta } = await buildQuery(
      queryBuilder,
      queryOptions,
      'farmer',
    );

    const data1 = data.map((farmer) => ({
      id: farmer.id,
      fullName: [farmer.farmerfName, farmer.farmermName, farmer.farmerlName]
        .filter(Boolean)
        .join(' '),
      primaryMobileNo: farmer.primaryMobileNo,
      secondaryMobileNo: farmer.secondaryMobileNo,
      status: farmer.status,
      createdBy: farmer.createdBy
        ? `${farmer.createdBy.firstName || ''} ${farmer.createdBy.lastName || ''}`.trim() || null
        : null,
      email: farmer.email,
      farmerCode: farmer.farmerCode,
      residensialAddress: farmer.residensialAddress
        ? {
            id: farmer.residensialAddress.id,
            address1: farmer.residensialAddress.address1,
            address2: farmer.residensialAddress.address2,
            location: farmer.residensialAddress.location,
            city: farmer.residensialAddress.city,
            state: farmer.residensialAddress.state,
            pincode: farmer.residensialAddress.pincode,
          }
        : null,
      farmAddress: farmer.farmAddress
        ? {
            id: farmer.farmAddress.id,
            address1: farmer.farmAddress.address1,
            address2: farmer.farmAddress.address2,
            location: farmer.farmAddress.location,
            city: farmer.farmAddress.city,
            state: farmer.farmAddress.state,
            pincode: farmer.farmAddress.pincode,
          }
        : null,
    }));

    const result = { data1, meta };
    await this.cacheService.set(key, result, CACHE_TTL);
    return result;
  }

  public async getPartialFarmersById(id: string): Promise<any> {
    const key = `${CACHE_PREFIX}:partial:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const farmer = await this.farmerRepository
      .createQueryBuilder('farmer')
      .leftJoinAndSelect('farmer.residensialAddress', 'residensialAddress')
      .leftJoinAndSelect('farmer.farmAddress', 'farmAddress')
      .select([
        'farmer.id',
        'farmer.primaryMobileNo',
        'farmer.secondaryMobileNo',
        'farmer.email',
        'farmer.farmerCode',
        'residensialAddress.id',
        'residensialAddress.address1',
        'residensialAddress.address2',
        'residensialAddress.location',
        'residensialAddress.city',
        'residensialAddress.state',
        'residensialAddress.pincode',
        'farmAddress.id',
        'farmAddress.address1',
        'farmAddress.address2',
        'farmAddress.location',
        'farmAddress.city',
        'farmAddress.state',
        'farmAddress.pincode',
      ])
      .addSelect(
        `
        TRIM(CONCAT(
          COALESCE(farmer.farmerfName, ''), ' ',
          COALESCE(farmer.farmermName, ''), ' ',
          COALESCE(farmer.farmerlName, '')
        ))`,
        'fullName',
      )
      .where('farmer.id = :id', { id })
      .getRawOne();

    if (!farmer) return null;

    const result = {
      id: farmer.farmer_id,
      fullName: farmer.fullName,
      primaryMobileNo: farmer.farmer_primaryMobileNo,
      secondaryMobileNo: farmer.farmer_secondaryMobileNo,
      email: farmer.farmer_email,
      farmerCode: farmer.farmer_farmerCode,
      residensialAddress: farmer.residensialAddress_id
        ? {
            id: farmer.residensialAddress_id,
            address1: farmer.residensialAddress_address1,
            address2: farmer.residensialAddress_address2,
            location: farmer.residensialAddress_location,
            city: farmer.residensialAddress_city,
            state: farmer.residensialAddress_state,
            pincode: farmer.residensialAddress_pincode,
          }
        : null,
      farmAddress: farmer.farmAddress_id
        ? {
            id: farmer.farmAddress_id,
            address1: farmer.farmAddress_address1,
            address2: farmer.farmAddress_address2,
            location: farmer.farmAddress_location,
            city: farmer.farmAddress_city,
            state: farmer.farmAddress_state,
            pincode: farmer.farmAddress_pincode,
          }
        : null,
    };
    await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
    return result;
  }

  public async getfarmerbyidforview(id: string): Promise<FarmerResponseDto | null> {
    const key = `${CACHE_PREFIX}:view:${id}`;
    const cached = await this.cacheService.get<FarmerResponseDto>(key);
    if (cached) return cached;

    const farmer = await this.farmerRepository
      .createQueryBuilder('farmer')
      .leftJoin('farmer.residensialAddress', 'residensialAddress')
      .leftJoin('farmer.farmAddress', 'farmAddress')
      .leftJoin('farmer.createdBy', 'createdBy')
      .leftJoin('farmer.approvedBy', 'approvedBy')
      .leftJoin('farmer.crops', 'crops')
      .leftJoin('crops.crop', 'crop')
      .select([
        'farmer.id', 'farmer.farmerfName', 'farmer.farmermName', 'farmer.farmerlName',
        'farmer.gender', 'farmer.dob', 'farmer.idProofNo', 'farmer.idProofCopy',
        'farmer.howDoYouSell', 'farmer.landHoldingStatus', 'farmer.landStatus',
        'farmer.totalLandArea', 'farmer.cultivationArea', 'farmer.sevenTwelveNo',
        'farmer.sevenTwelveCopy', 'farmer.primaryMobileNo', 'farmer.secondaryMobileNo',
        'farmer.email', 'farmer.farmerCode', 'farmer.farmerPhoto', 'farmer.farmPhoto',
        'farmer.status', 'farmer.createdAt',
        'createdBy.firstName', 'createdBy.lastName',
        'approvedBy.firstName', 'approvedBy.lastName',
        'residensialAddress.id', 'residensialAddress.address1', 'residensialAddress.address2',
        'residensialAddress.location', 'residensialAddress.city', 'residensialAddress.state', 'residensialAddress.pincode',
        'farmAddress.id', 'farmAddress.address1', 'farmAddress.address2',
        'farmAddress.location', 'farmAddress.city', 'farmAddress.state', 'farmAddress.pincode',
        'crops.id', 'crops.variety', 'crops.noOfPlants', 'crops.pruningDate',
        'crops.expectedHarvestDate', 'crops.expectedQuantityInTonnes',
        'crop.name',
      ])
      .where('farmer.id = :id', { id })
      .getOne();

    if (!farmer) return null;

    const { createdDate, createdTime } = formatDateTime(farmer.createdAt);
    const mapAddress = (addr: any): AddressDto | null => addr?.id ? {
      id: addr.id,
      address1: addr.address1,
      address2: addr.address2,
      location: addr.location,
      city: addr.city,
      state: addr.state,
      pincode: addr.pincode,
    } : null;

    const result: FarmerResponseDto = {
      id: farmer.id,
      farmerfName: farmer.farmerfName ?? null,
      farmermName: farmer.farmermName ?? null,
      farmerlName: farmer.farmerlName ?? null,
      gender: farmer.gender,
      status: farmer.status,
      dob: farmer.dob ? String(farmer.dob) : null,
      idProofNo: farmer.idProofNo,
      idProofCopy: farmer.idProofCopy,
      howDoYouSell: farmer.howDoYouSell,
      landHoldingStatus: farmer.landHoldingStatus as LandHoldingStatusType | null,
      landStatus: farmer.landStatus as LandStatusType | null,
      totalLandArea: farmer.totalLandArea,
      cultivationArea: farmer.cultivationArea,
      sevenTwelveNo: farmer.sevenTwelveNo,
      sevenTwelveCopy: farmer.sevenTwelveCopy,
      farmerPhoto: farmer.farmerPhoto ?? null,
      farmPhoto: farmer.farmPhoto ?? null,
      primaryMobileNo: farmer.primaryMobileNo,
      secondaryMobileNo: farmer.secondaryMobileNo,
      email: farmer.email,
      farmerCode: farmer.farmerCode,
      createdBy: farmer.createdBy
        ? `${farmer.createdBy.firstName} ${farmer.createdBy.lastName}`
        : null,
      approvedBy: farmer.approvedBy
        ? `${farmer.approvedBy.firstName} ${farmer.approvedBy.lastName}`
        : null,
      createdDate,
      createdTime,
      residensialAddress: mapAddress(farmer.residensialAddress) ?? {},
      farmAddress: mapAddress(farmer.farmAddress) ?? {},
      crops: farmer.crops?.map((crop: Crop): CropDto => ({
        id: crop.id,
        crop: crop.crop?.name ?? null,
        variety: crop.variety,
        noOfPlants: crop.noOfPlants,
        pruningDate: crop.pruningDate ? String(crop.pruningDate) : null,
        expectedHarvestDate: crop.expectedHarvestDate ? String(crop.expectedHarvestDate) : null,
        expectedQuantityInTonnes: crop.expectedQuantityInTonnes,
      })) ?? [],
    };

    await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
    return result;
  }

  public async getfarmerbyidforupdate(id: string): Promise<FarmerResponseDto | null> {
    const key = `${CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<FarmerResponseDto>(key);
    if (cached) return cached;

    const farmer = await this.farmerRepository
      .createQueryBuilder('farmer')
      .leftJoin('farmer.residensialAddress', 'residensialAddress')
      .leftJoin('farmer.farmAddress', 'farmAddress')
      .leftJoin('farmer.crops', 'crops')
      .leftJoin('farmer.createdBy', 'createdBy')
      .leftJoin('crops.crop', 'crop')
      .select([
        'farmer.id', 'farmer.farmerfName', 'farmer.farmermName', 'farmer.farmerlName',
        'farmer.gender', 'farmer.dob', 'farmer.idProofNo', 'farmer.idProofCopy',
        'farmer.howDoYouSell', 'farmer.landHoldingStatus', 'farmer.landStatus',
        'farmer.totalLandArea', 'farmer.cultivationArea', 'farmer.sevenTwelveNo',
        'farmer.sevenTwelveCopy', 'farmer.primaryMobileNo', 'farmer.secondaryMobileNo',
        'farmer.email', 'farmer.farmerCode', 'farmer.farmerPhoto', 'farmer.farmPhoto',
        'farmer.status',
        'farmer.createdAt',
        'createdBy.id',
        'residensialAddress.id', 'residensialAddress.address1', 'residensialAddress.address2',
        'residensialAddress.location', 'residensialAddress.city', 'residensialAddress.state', 'residensialAddress.pincode',
        'farmAddress.id', 'farmAddress.address1', 'farmAddress.address2',
        'farmAddress.location', 'farmAddress.city', 'farmAddress.state', 'farmAddress.pincode',
        'crops.id', 'crops.variety', 'crops.noOfPlants', 'crops.pruningDate',
        'crops.expectedHarvestDate', 'crops.expectedQuantityInTonnes',
        'crop.id',
      ])
      .where('farmer.id = :id', { id })
      .getOne();

    if (!farmer) return null;

    const { createdDate, createdTime } = formatDateTime(farmer.createdAt);
    const mapAddress = (addr: any): AddressDto | null => addr?.id ? {
      id: addr.id, address1: addr.address1, address2: addr.address2,
      location: addr.location, city: addr.city, state: addr.state, pincode: addr.pincode,
    } : null;

    const result: FarmerResponseDto = {
      id: farmer.id,
      farmerfName: farmer.farmerfName ?? null,
      farmermName: farmer.farmermName ?? null,
      farmerlName: farmer.farmerlName ?? null,
      gender: farmer.gender,
      status: farmer.status,
      dob: farmer.dob ? String(farmer.dob) : null,
      idProofNo: farmer.idProofNo,
      idProofCopy: farmer.idProofCopy,
      howDoYouSell: farmer.howDoYouSell,
      landHoldingStatus: farmer.landHoldingStatus as LandHoldingStatusType | null,
      landStatus: farmer.landStatus as LandStatusType | null,
      totalLandArea: farmer.totalLandArea,
      cultivationArea: farmer.cultivationArea,
      sevenTwelveNo: farmer.sevenTwelveNo,
      sevenTwelveCopy: farmer.sevenTwelveCopy,
      primaryMobileNo: farmer.primaryMobileNo,
      secondaryMobileNo: farmer.secondaryMobileNo,
      email: farmer.email,
      farmerCode: farmer.farmerCode,
      farmerPhoto: farmer.farmerPhoto ?? null,
      farmPhoto: farmer.farmPhoto ?? null,
      /** createdBy returns the user id for update forms (frontend needs it to pre-select) */
      createdBy: farmer.createdBy?.id ?? null,
      createdDate,
      createdTime,
      residensialAddress: mapAddress(farmer.residensialAddress) ?? {},
      farmAddress: mapAddress(farmer.farmAddress) ?? {},
      crops: farmer.crops?.map((crop: Crop): CropDto => ({
        id: crop.id,
        crop: crop.crop?.id ?? null,       // product id for update form (not name)
        variety: crop.variety,
        noOfPlants: crop.noOfPlants,
        pruningDate: crop.pruningDate ? String(crop.pruningDate) : null,
        expectedHarvestDate: crop.expectedHarvestDate ? String(crop.expectedHarvestDate) : null,
        expectedQuantityInTonnes: crop.expectedQuantityInTonnes,
      })) ?? [],
    };

    await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
    return result;
  }

 public async getAllFarmerWithFilter(filter: string): Promise<any[]> {
    const key = `${CACHE_PREFIX}:withFilter:${filter}`;
    const cached = await this.cacheService.get<any[]>(key);
    if (cached) return cached;

    const query = this.farmerRepository
      .createQueryBuilder('farmer')
      .leftJoin('farmer.residensialAddress', 'residensialAddress')
      .leftJoin('farmer.farmAddress', 'farmAddress')
      .select([
        'farmer.id',
        'farmer.primaryMobileNo',
        'farmer.secondaryMobileNo',
        'farmer.email',
        'farmer.farmerCode',
        'residensialAddress.id',
        'residensialAddress.address1',
        'residensialAddress.address2',
        'residensialAddress.location',
        'residensialAddress.city',
        'residensialAddress.state',
        'residensialAddress.pincode',
        'farmAddress.id',
        'farmAddress.address1',
        'farmAddress.address2',
        'farmAddress.location',
        'farmAddress.city',
        'farmAddress.state',
        'farmAddress.pincode',
      ])
      .addSelect(
        `TRIM(CONCAT(
          COALESCE(farmer.farmerfName, ''), ' ',
          COALESCE(farmer.farmermName, ''), ' ',
          COALESCE(farmer.farmerlName, '')
        ))`,
        'fullName',
      )
      .orderBy('farmer.createdAt', 'DESC');

    // Apply filtering only if 'filter' is provided
    if (filter) {
      query.where(
        `TRIM(CONCAT(
          COALESCE(farmer.farmerfName, ''), ' ',
          COALESCE(farmer.farmermName, ''), ' ',
          COALESCE(farmer.farmerlName, '')
        )) ILIKE :filter`,
        { filter: `%${filter}%` },
      );
    }

    const farmers = await query.getRawMany();

    const result = farmers.map((farmer) => ({
      id: farmer.farmer_id,
      fullName: farmer.fullName,
      primaryMobileNo: farmer.farmer_primaryMobileNo,
      secondaryMobileNo: farmer.farmer_secondaryMobileNo,
      email: farmer.farmer_email,
      farmerCode: farmer.farmer_farmerCode,
      residensialAddress: farmer.residensialAddress_id
        ? {
            id: farmer.residensialAddress_id,
            address1: farmer.residensialAddress_address1,
            address2: farmer.residensialAddress_address2,
            location: farmer.residensialAddress_location,
            city: farmer.residensialAddress_city,
            state: farmer.residensialAddress_state,
            pincode: farmer.residensialAddress_pincode,
          }
        : null, // Return null if residential address is missing
      farmAddress: farmer.farmAddress_id
        ? {
            id: farmer.farmAddress_id,
            address1: farmer.farmAddress_address1,
            address2: farmer.farmAddress_address2,
            location: farmer.farmAddress_location,
            city: farmer.farmAddress_city,
            state: farmer.farmAddress_state,
            pincode: farmer.farmAddress_pincode,
          }
        : null, // Return null if farm address is missing
    }));
    await this.cacheService.set(key, result, CACHE_TTL);
    return result;
  }
  async submitFarmer(
    farmerId: string,
    fileUpdates: Record<string, string | null> = {},
    farmerData: Record<string, any> = {},
    submittedBy: string = '',
  ): Promise<Farmer> {
    const farmer = await this.farmerRepository.findOne({
      where: { id: farmerId },
      relations: ['residensialAddress', 'farmAddress', 'crops'],
    });
    if (!farmer) throw new AppError(404, 'Farmer not found');

    // Admin/Verifier → approved directly; everyone else → pending
    if (submittedBy) {
      const submitter = await this.userRepository.findOneBy({ id: submittedBy });
      if (submitter?.roles && (submitter.roles.includes(Role.ADMIN) || submitter.roles.includes(Role.VERIFIER))) {
        farmer.status = Status.APPROVED;
      } else {
        farmer.status = Status.PENDING;
      }
    } else {
      farmer.status = Status.PENDING;
    }

    // ── Helper: multipart/form-data madhe nested objects JSON string mhanun yetaat ──
    const parseIfString = (val: any): any => {
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    };

    
    const scalarFields: (keyof Farmer)[] = [
      'farmerfName', 'farmermName', 'farmerlName',
      'primaryMobileNo', 'secondaryMobileNo', 'email',
      'gender', 'dob', 'landHoldingStatus', 'landStatus',
      'totalLandArea', 'cultivationArea', 'farmerCode',
      'farmerGrading', 'sevenTwelveNo', 'idProofNo',
      'dateOfVisit', 'howDoYouSell',
    ];

    for (const field of scalarFields) {
      if (farmerData[field] !== undefined && farmerData[field] !== null && farmerData[field] !== '') {
        (farmer as any)[field] = farmerData[field];
      }
    }

    
    const residensialAddressData = parseIfString(farmerData.residensialAddress);
    if (residensialAddressData && typeof residensialAddressData === 'object') {
      Object.assign(farmer.residensialAddress ??= {} as Address, residensialAddressData);
    }

    const farmAddressData = parseIfString(farmerData.farmAddress);
    if (farmAddressData && typeof farmAddressData === 'object') {
      Object.assign(farmer.farmAddress ??= {} as Address, farmAddressData);
    }

    // ── Crops update ───────────────────────────────────────────────────────
    const cropsData = parseIfString(farmerData.crops);
    if (Array.isArray(cropsData) && cropsData.length > 0) {
      farmer.crops = cropsData as Crop[];
    }

    // ── File updates apply
    if (fileUpdates.farmPhoto !== undefined)       farmer.farmPhoto       = fileUpdates.farmPhoto       ?? farmer.farmPhoto;
    if (fileUpdates.farmerPhoto !== undefined)     farmer.farmerPhoto     = fileUpdates.farmerPhoto     ?? farmer.farmerPhoto;
    if (fileUpdates.idProofCopy !== undefined)     farmer.idProofCopy     = fileUpdates.idProofCopy     ?? farmer.idProofCopy;
    if (fileUpdates.sevenTwelveCopy !== undefined) farmer.sevenTwelveCopy = fileUpdates.sevenTwelveCopy ?? farmer.sevenTwelveCopy;

    await this.farmerRepository.save(farmer);
    await this.invalidateFarmerCache(farmerId);

    // Fresh fetch to ensure returned status reflects DB state
    const updated = await this.farmerRepository.findOne({ where: { id: farmerId } });
    return updated!;
  }

  async approveFarmer(farmerId: string, approverId: string, status: Status) {
    // Validate status — only approved or rejected are valid outcomes
    if (status !== Status.APPROVED && status !== Status.REJECTED) {
      throw new AppError(400, `Invalid status '${status}'. Only 'Approved' or 'Rejected' are allowed.`);
    }

    const approver = await this.userRepository.findOne({
      where: { id: approverId },
    });
    if (!approver) throw new AppError(404, 'Approver not found');

    // Only ADMIN or VERIFIER role can approve/reject farmers
    if (!approver.roles || !(approver.roles.includes(Role.ADMIN) || approver.roles.includes(Role.VERIFIER))) {
      throw new AppError(403, 'Only an Admin or Verifier can approve or reject farmers');
    }

    const farmer = await this.farmerRepository.findOne({
      where: { id: farmerId },
    });
    if (!farmer) throw new AppError(404, 'Farmer not found');

    // Farmer must be in 'pending' status — draft means not yet submitted
    if (farmer.status !== Status.PENDING) {
      throw new AppError(400, `Farmer cannot be approved because its current status is '${farmer.status}'. Only farmers with status 'Pending' can be approved or rejected.`);
    }

    farmer.status = status;
    farmer.approvedBy = { id: approverId } as any;
    const saved = await this.farmerRepository.save(farmer);
    await this.invalidateFarmerCache(farmerId);

    // Notify verifier + creator — non-blocking
    this.notifyFarmerApproved(saved, approverId, status).catch(() => {});

    return saved;
  }

  private async notifyFarmerApproved(farmer: Farmer, approverId: string, status: Status): Promise<void> {
    try {
      const isApproved = status === Status.APPROVED;

      // Fetch approver name
      const approver = await this.userRepository.findOneBy({ id: approverId });
      const verifierName = `${approver?.firstName || ''} ${approver?.lastName || ''}`.trim()
        || (approver as any)?.username || (approver?.roles?.includes(Role.ADMIN) ? 'Admin' : 'Verifier');

      const farmerFullName = [farmer.farmerfName, farmer.farmermName, farmer.farmerlName]
        .filter(Boolean).join(' ');

      // Notify the verifier who acted
      await this.notificationService.createNoti(
        isApproved
          ? `You approved farmer "${farmerFullName}" successfully`
          : `You rejected farmer "${farmerFullName}"`,
        approverId,
      );

      // Fetch farmer with createdBy to notify the creator
      const farmerWithCreator = await this.farmerRepository.findOne({
        where: { id: farmer.id },
        relations: ['createdBy'],
      });
      const creatorId = (farmerWithCreator?.createdBy as any)?.id;
      if (creatorId && creatorId !== approverId) {
        await this.notificationService.createNoti(
          isApproved
            ? `Your farmer "${farmerFullName}" has been approved by ${verifierName}`
            : `Your farmer "${farmerFullName}" has been rejected by ${verifierName}`,
          creatorId,
        );
      }
    } catch {
      // Notification failure must never break the approve flow
    }
  }
  async getFarmerById(id: string): Promise<Farmer | null> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<Farmer>(key);
    if (cached) return cached;

    const farmer = await this.farmerRepository
      .createQueryBuilder('farmer')
      .leftJoinAndSelect('farmer.crops', 'crops')
      .leftJoinAndSelect('crops.crop', 'crop')
      .leftJoinAndSelect('farmer.residensialAddress', 'residensialAddress')
      .leftJoinAndSelect('farmer.farmAddress', 'farmAddress')
      .where('farmer.id = :id', { id })
      .getOne();

    if (farmer) await this.cacheService.set(key, farmer, CACHE_TTL_DETAIL);
    return farmer;
  }

  // Loads only the columns needed for the attachments view (no joins).
  async getFarmerAttachments(id: string): Promise<Farmer | null> {
    return this.farmerRepository
      .createQueryBuilder('farmer')
      .select([
        'farmer.id',
        'farmer.farmerCode',
        'farmer.farmerfName',
        'farmer.farmermName',
        'farmer.farmerlName',
        'farmer.sevenTwelveCopy',
        'farmer.idProofCopy',
        'farmer.farmerPhoto',
        'farmer.farmPhoto',
      ])
      .where('farmer.id = :id', { id })
      .getOne();
  }


  public async createFarmer(farmerData: CreateFarmerDto): Promise<Farmer> {

    // ── UPSERT: if id is present, the frontend is re-saving an existing draft ──
    if ((farmerData as any).id) {
      const updatedBy = farmerData.createdBy ?? '';
      const updated = await this.updateFarmer(
        (farmerData as any).id,
        farmerData as any,
        updatedBy,
        updatedBy,
      );
      if (!updated) throw new AppError(404, 'Farmer not found for draft update');
      return updated;
    }

    const user = await this.userRepository.findOneBy({
      id: farmerData.createdBy,
    });

    // Use raw SQL to find the highest farmer code, bypassing soft-delete filter
    const farmYear = new Date().getFullYear();
    const farmPrefix = `FARM${farmYear}`;
    const lastFarmCode = await this.farmerRepository.query(
      `SELECT "farmerCode" FROM farmer WHERE "farmerCode" LIKE $1 ORDER BY "farmerCode" DESC LIMIT 1`,
      [`${farmPrefix}%`]
    );
    let farmNext = 1;
    if (lastFarmCode.length > 0 && lastFarmCode[0].farmerCode) {
      const lastNum = parseInt(lastFarmCode[0].farmerCode.slice(farmPrefix.length), 10);
      if (!isNaN(lastNum)) farmNext = lastNum + 1;
    }

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Admin/Verifier: draft → draft, anything else → approved
    // Other users:   draft → draft, anything else → pending
    let resolvedStatus: Status;
    if (user.roles && (user.roles.includes(Role.ADMIN) || user.roles.includes(Role.VERIFIER))) {
      resolvedStatus = farmerData.status === Status.DRAFT ? Status.DRAFT : Status.APPROVED;
    } else {
      resolvedStatus = farmerData.status === Status.DRAFT ? Status.DRAFT : Status.PENDING;
    }

    // Helper: strip related objects that have no meaningful data (only id or empty)
    const hasData = (obj: any): boolean => {
      if (!obj || typeof obj !== 'object') return false;
      const keys = Object.keys(obj).filter(k => k !== 'id');
      return keys.length > 0;
    };

    // Strip empty nested objects so TypeORM doesn't cascade-insert empty rows
    const cleanedData: any = { ...farmerData };
    if (!hasData(cleanedData.residensialAddress)) delete cleanedData.residensialAddress;
    if (!hasData(cleanedData.farmAddress)) delete cleanedData.farmAddress;
    if (!Array.isArray(cleanedData.crops) || cleanedData.crops.length === 0) delete cleanedData.crops;

    // status and farmerCode are set internally — not from client input
    const entityData = {
      ...cleanedData,
      status: resolvedStatus,
      farmerCode: `${farmPrefix}${String(farmNext).padStart(4, '0')}`,
    };

    const farmer = this.farmerRepository.create(entityData as unknown as Farmer);
    const saved = await this.farmerRepository.save(farmer);
    await this.invalidateFarmerCache();

    // Fire notifications — non-blocking, never throws
    this.notifyFarmerCreated(saved, farmerData.createdBy ?? '').catch(() => {});

    return saved;
  }

  // ─── Notification Helpers ─────────────────────────────────────────────────

  /**
   * Sends role-aware notifications after a farmer is created.
   * - Admin / Verifier creator → "created successfully" to self only.
   * - Regular employee creator → "sent for approval" to self,
   *   + "awaiting your approval, created by <name>" to all Verifiers & Admins.
   */
  private async notifyFarmerCreated(farmer: Farmer, creatorId: string): Promise<void> {
    try {
      if (!creatorId) return;

      const creator = await this.userRepository.findOneBy({ id: creatorId });
      if (!creator) return;

      const isPrivileged =
        creator.roles?.includes(Role.ADMIN) || creator.roles?.includes(Role.VERIFIER);

      const farmerFullName = [farmer.farmerfName, farmer.farmermName, farmer.farmerlName]
        .filter(Boolean).join(' ');
      const creatorName = `${creator.firstName || ''} ${creator.lastName || ''}`.trim()
        || creator.username || 'Unknown';

      if (isPrivileged) {
        await this.notificationService.createNoti(
          `Farmer "${farmerFullName}" created successfully`,
          creatorId,
        );
      } else {
        await this.notificationService.createNoti(
          `Your farmer "${farmerFullName}" has been sent for approval`,
          creatorId,
        );
        await this.notificationService.createNotiForRoles(
          `Farmer "${farmerFullName}" is awaiting your approval, created by ${creatorName}`,
          [Role.VERIFIER, Role.ADMIN],
        );
      }
    } catch (err) {
      // Notification failure must never break the create flow
    }
  }


  public async updateFarmer(
    farmerId: string,
    updateData: UpdateFarmerDto,
    updatedBy: string,
    requestedBy: string | { id?: string }
  ): Promise<Farmer | null> {


    const farmer = await this.farmerRepository.findOne({
      where: { id: farmerId },
      relations: ['crops'],
    });

    if (!farmer) return null;

    const { crops: updatedCrops, ...outerFields } = updateData;
 
  const requesterId =
    typeof requestedBy === 'object' && requestedBy !== null && 'id' in requestedBy && requestedBy.id
      ? requestedBy.id
      : (requestedBy as string);

  if (!requesterId) {
    throw new Error('Requester id not provided');
  }

  // ✅ Find the requester user
  const requester = await this.userRepository.findOne({
    where: { id: requesterId },
  });

  if (!requester) throw new Error('Requester not found');

  // ✅ Check if user has admin role
  if (Array.isArray(requester.roles) && requester.roles.includes('admin' as Role)) {
    farmer.status =Status.APPROVED;
  } else {
  }
    // Audit farmer outer fields
    await this.auditLogService.logChange(
      'Farmer',
      farmerId,
      { ...farmer },
      { ...outerFields },
      updatedBy,
    );

    // Update outer fields
    Object.assign(farmer, outerFields);

    if (updatedCrops) {
      const updatedCropIds = updatedCrops
        .filter((c: CropDto) => c.id)
        .map((c: CropDto) => c.id);

      // Keep only crops that still exist in request (others will be deleted by orphanedRowAction)
      farmer.crops = farmer.crops.filter((c) => updatedCropIds.includes(c.id));

      for (const updatedCrop of updatedCrops) {
        if (updatedCrop.id) {
          // Update existing crop
          const existingCrop = farmer.crops.find(
            (c) => c.id === updatedCrop.id,
          );
          if (existingCrop) {
            await this.auditLogService.logChange(
              'Crop',
              updatedCrop.id,
              existingCrop,
              updatedCrop,
              updatedBy,
            );
            Object.assign(existingCrop, updatedCrop);
          }
        } else {
          // Add new crop — map CropDto to DeepPartial<Crop> for the repository
          const newCrop = this.cropRepository.create(updatedCrop as unknown as Crop);
          if (Array.isArray(newCrop)) {
            farmer.crops.push(...newCrop);
          } else {
            farmer.crops.push(newCrop);
          }
        }
      }
    }

    await this.farmerRepository.save(farmer);
    await this.invalidateFarmerCache(farmerId);
    return farmer;
  }
  // Delete a farmer with scheduled deletion (6 months)
  async deleteFarmer(id: string): Promise<boolean> {
    const farmer = await this.farmerRepository.findOne({ where: { id } });

    if (!farmer) {
      throw new AppError(404, `Farmer with ID ${id} not found`);
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    // Bulk update all crops for this farmer in one query instead of N individual saves
    await this.cropRepository
      .createQueryBuilder()
      .update()
      .set({ deletionScheduledAt: sixMonthsFromNow })
      .where('"farmerId" = :id', { id })
      .execute();

    // Null out farmerCode to free the unique constraint slot
    farmer.deletionScheduledAt = sixMonthsFromNow;
    farmer.farmerCode = null as any;
    await this.farmerRepository.save(farmer);
    await this.invalidateFarmerCache(id);

    return true;
  }
 
// ─── Excel Export / Import ────────────────────────────────────────────────

  /**
   * Every farmer the user is allowed to see, matching the list-page filters,
   * as an Excel file stored in Spaces.
   *
   * The same visibility rules as the list endpoint apply: a non-privileged user
   * exports only the farmers they created, and a verifier never sees drafts.
   */
  async exportToExcel(
    options: PaginationOptions,
    userId: string,
  ): Promise<UploadedExport> {
    const user = await this.userRepository.findOneBy({ id: userId });
    const isAdmin = user?.roles?.includes(Role.ADMIN);
    const isVerifier = user?.roles?.includes(Role.VERIFIER);
    const isPrivileged = isAdmin || isVerifier;

    const queryBuilder = this.farmerRepository
      .createQueryBuilder('farmer')
      .leftJoinAndSelect('farmer.createdBy', 'createdBy')
      .leftJoinAndSelect('farmer.residensialAddress', 'residensialAddress')
      .leftJoinAndSelect('farmer.farmAddress', 'farmAddress')
      .leftJoinAndSelect('farmer.crops', 'crops')
      .leftJoinAndSelect('crops.crop', 'cropProduct')
      .orderBy('farmer.createdAt', 'DESC');

    if (!isPrivileged) {
      queryBuilder.where('createdBy.id = :userId', { userId });
    }

    if (isVerifier && !isAdmin) {
      queryBuilder.andWhere('farmer.status != :draft', { draft: Status.DRAFT });
    }

    applyMasterFilters(queryBuilder, FARMER_FILTERS, options.masterFilters);

    const { data } = await buildQuery(
      queryBuilder,
      { ...options, page: undefined, limit: undefined },
      'farmer',
    );

    const workbook = buildDataWorkbook(FARMER_SHEET, data as Farmer[], {
      product: (await this.loadCropIndex()).displayNames(),
    });
    return uploadWorkbookToSpaces(workbook, 'Farmers', data.length);
  }

  /** Products a crop can name, loaded once per file and matched in memory. */
  private async loadCropIndex(): Promise<LookupIndex<Product>> {
    const products = await AppDataSource.getRepository(Product).find({
      select: { id: true, name: true, isDeleted: true },
    });
    return LookupIndex.fromRecords(
      products.filter((product) => !product.isDeleted),
      { names: (product) => [product.name] },
    );
  }

  /**
   * Reads the crop blocks of a row onto the farmer. A crop whose product does
   * not match is not added and is noted in `draft`; a product the farmer already
   * grows is not added twice, so the same code completes a draft farmer.
   */
  private applyCrops(
    farmer: Farmer,
    row: ExcelRow,
    products: LookupIndex<Product>,
    draft: DraftLinks,
  ): void {
    const cropColumn = (header: string) =>
      FARMER_CROP_GROUP.columns.find((c) => c.header === header)!;
    const at = <T>(index: number, header: string) =>
      row.groupCell<T | null>(FARMER_CROP_GROUP, index, cropColumn(header));

    const blocks = row.eachGroupBlock(FARMER_CROP_GROUP, (index) => ({
      index,
      name: at<string>(index, 'Crop'),
    }));

    farmer.crops = farmer.crops ?? [];
    const grown = new Set(farmer.crops.map((crop) => crop.crop?.id).filter(Boolean));

    for (const block of blocks) {
      const field = `Crop${block.index}`;
      if (!block.name) {
        draft.note(field, EMPTY_LINK, 'the crop block has other values but no crop name');
        continue;
      }

      const product = draft.one(products, field, block.name);
      if (!product || grown.has(product.id)) continue;
      grown.add(product.id);

      const crop = new Crop();
      crop.crop = product;
      crop.variety = at<string>(block.index, 'Variety') as string;
      crop.noOfPlants = at<number>(block.index, 'No Of Plants') as number;
      crop.expectedQuantityInTonnes = at<number>(block.index, 'Expected Quantity (Tonnes)') as number;

      const pruningDate = at<string>(block.index, 'Pruning Date');
      if (pruningDate) crop.pruningDate = new Date(pruningDate);

      const harvestDate = at<string>(block.index, 'Expected Harvest Date');
      if (harvestDate) crop.expectedHarvestDate = new Date(harvestDate);

      farmer.crops.push(crop);
    }
  }

  /**
   * Blank workbook carrying exactly the headers the importer reads, generated
   * from the same column map as the export.
   */
  async buildExcelTemplate(): Promise<UploadedExport> {
    const workbook = buildTemplateWorkbook(FARMER_SHEET, {
      product: (await this.loadCropIndex()).displayNames(),
    });
    return uploadWorkbookToSpaces(workbook, 'Farmer_Template', 0);
  }

  /**
   * Imports farmers from a spreadsheet uploaded to Spaces
   * (docs/registration-import-plan.md, decisions agreed 2026-11-04).
   *
   * Row by row (D1). Every farmer the import saves is a **draft** (D2): the
   * admin checks it and submits it from the form. A cell the form would refuse,
   * a mobile / email another farmer already has, a required cell left blank and
   * a crop that does not match a product are left empty and listed in the report
   * (D4, D5). A new row whose primary mobile is already a farmer's is skipped.
   *
   * A row with the Farmer Code of a draft farmer updates it: filled cells replace
   * what is saved, empty cells keep it, and crops not grown yet are added (D3).
   * Farmers past draft are not changed by an import (D6). `checkOnly` runs every
   * check and saves nothing.
   *
   * The uploaded file is removed from Spaces once read, success or failure.
   */
  async createFarmerwithExcel(
    fileUrl: string,
    createdById: string,
    options: { checkOnly?: boolean } = {},
  ): Promise<ImportSummary> {
    if (!fileUrl) {
      throw new AppError(400, 'No file URL provided');
    }

    const checkOnly = !!options.checkOnly;
    const summary = emptySummary();

    try {
      await assertImportPrerequisites('farmer', countMasterRecords);

      const sheet = await readUploadedSheet(fileUrl, FARMER_SHEET);
      summary.unknownColumns = sheet.unknownColumns;
      summary.missingColumns = sheet.missingColumns;
      summary.totalRows = sheet.rows.length;

      if (sheet.missingColumns.length) {
        throw new AppError(
          400,
          `The uploaded file is missing required column(s): ${sheet.missingColumns.join(', ')}`,
        );
      }

      const farmerRepository = AppDataSource.getRepository(Farmer);

      const creator = await this.userRepository.findOneBy({ id: createdById });
      if (!creator) {
        throw new AppError(401, 'The logged-in user could not be found');
      }

      const cropIndex = await this.loadCropIndex();

      // Existing farmers by code, and every mobile / email in use, loaded once;
      // rows of this file are added as they go.
      const existingFarmers = await farmerRepository.find({
        select: {
          id: true, farmerCode: true, status: true, farmerfName: true, farmerlName: true,
          primaryMobileNo: true, secondaryMobileNo: true, email: true,
        },
      });
      const byCode = new Map<string, Farmer>();
      const contacts = new ContactPool();
      for (const existing of existingFarmers) {
        const owner = { key: existing.id, label: farmerLabel(existing) };
        if (existing.farmerCode) byCode.set(existing.farmerCode.toUpperCase(), existing);
        contacts.add('phone', existing.primaryMobileNo, owner);
        contacts.add('phone', existing.secondaryMobileNo, owner);
        contacts.add('email', existing.email, owner);
      }

      const codeColumn = FARMER_SHEET.columns.find((c) => c.header === 'Farmer Code')!;

      for (const row of sheet.rows) {
        try {
          const draft = new DraftLinks();
          const farmerCode = row.cell<string | null>(codeColumn);

          // ── A draft farmer named by its code: update it ────────────────
          if (farmerCode) {
            const known = byCode.get(farmerCode.toUpperCase());
            if (!known) {
              summary.skipped.push({
                row: row.rowNumber,
                reason: `Farmer Code ${farmerCode} was not found - clear it to add the row as a new farmer`,
              });
              continue;
            }
            if (known.status !== Status.DRAFT) {
              summary.skipped.push({
                row: row.rowNumber,
                reason: `Farmer ${farmerCode} is ${known.status} - an import only changes draft farmers; edit it in the form`,
              });
              continue;
            }

            const target = await farmerRepository.findOne({
              where: { id: known.id },
              relations: ['crops', 'crops.crop', 'residensialAddress', 'farmAddress'],
            });
            if (!target) throw new Error(`Farmer ${farmerCode} could not be loaded`);

            const reader = new RegistrationRowReader(FARMER_SHEET, row, draft, {
              contacts,
              ownerKey: target.id,
            });
            mergeFilled(target, this.farmerFromRow(reader));
            this.applyCrops(target, row, cropIndex, draft);
            target.status = Status.DRAFT;
            if (!checkOnly) await farmerRepository.save(target);

            summary.updated++;
            if (draft.isDraft) summary.drafted++;
            summary.draftIssues.push(...draft.toReport(row.rowNumber, target.farmerCode, farmerName(target)));
            reader.registerContacts({ key: target.id, label: farmerLabel(target) });
            continue;
          }

          // ── A new farmer ───────────────────────────────────────────────
          const ownerKey = `row-${row.rowNumber}`;
          const reader = new RegistrationRowReader(FARMER_SHEET, row, draft, { contacts, ownerKey });

          if (!reader.typed('First Name')) {
            summary.skipped.push({ row: row.rowNumber, reason: 'First Name is empty' });
            continue;
          }

          // The primary mobile is how a farmer is told apart: one already on record skips the row.
          const typedMobile = reader.typed('Primary Mobile No');
          const mobile = typedMobile ? FORMAT_RULES.mobile.clean(typedMobile) : null;
          const holder = mobile ? contacts.holder('phone', mobile, ownerKey) : null;
          if (holder) {
            summary.skipped.push({
              row: row.rowNumber,
              reason: `Farmer with mobile ${typedMobile} already exists (${holder})`,
            });
            continue;
          }

          const farmer = this.farmerFromRow(reader);
          reader.noteMissingRequired();
          farmer.crops = [];
          this.applyCrops(farmer, row, cropIndex, draft);
          farmer.status = Status.DRAFT;
          farmer.createdBy = creator;

          let saved: Farmer = farmer;
          if (!checkOnly) {
            farmer.farmerCode = await this.generateBulkFarmerCode(farmerRepository);
            saved = await farmerRepository.save(farmer);
          }

          summary.created++;
          if (draft.isDraft) summary.drafted++;
          summary.draftIssues.push(...draft.toReport(row.rowNumber, saved.farmerCode ?? null, farmerName(saved)));
          reader.registerContacts({
            key: saved.id ?? ownerKey,
            label: saved.farmerCode ? farmerLabel(saved) : `row ${row.rowNumber}`,
          });
          if (saved.farmerCode) byCode.set(saved.farmerCode.toUpperCase(), saved);
        } catch (rowError: any) {
          summary.failed.push({
            row: row.rowNumber,
            reason: rowError?.message ?? 'Could not save this row',
          });
        }
      }

      if (!checkOnly && (summary.created > 0 || summary.updated > 0)) {
        await this.invalidateFarmerCache();
      }

      await attachImportReport(summary, 'Farmer');
      return summary;
    } finally {
      await deleteFromSpaces(fileUrl);
    }
  }

  /**
   * A Farmer built from one row - every cell through the column rules - without
   * crops. Used as the new farmer, or merged onto a draft (only what is filled).
   */
  private farmerFromRow(reader: RegistrationRowReader): Farmer {
    const text = (header: string) => reader.text(header) as string;
    const farmer = new Farmer();
    farmer.farmerfName = text('First Name');
    farmer.farmermName = text('Middle Name');
    farmer.farmerlName = text('Last Name');
    farmer.primaryMobileNo = text('Primary Mobile No');
    farmer.secondaryMobileNo = text('Secondary Mobile No');
    farmer.email = text('Email');
    farmer.gender = text('Gender');

    // Land Holding / Land Status: the form's lists; anything else is left empty and reported
    const landHoldingText = text('Land Holding');
    const landHolding = landHoldingText ? parseStatus(LandHoldingStatus, landHoldingText) : null;
    if (landHolding) farmer.landHoldingStatus = landHolding;
    else if (landHoldingText) {
      reader.draft.note('Land Holding', landHoldingText, `Left empty: must be one of ${Object.values(LandHoldingStatus).join(', ')}`);
    }
    const landStatusText = text('Land Status');
    const landStatus = landStatusText ? parseStatus(LandStatus, landStatusText) : null;
    if (landStatus) farmer.landStatus = landStatus;
    else if (landStatusText) {
      reader.draft.note('Land Status', landStatusText, `Left empty: must be one of ${Object.values(LandStatus).join(', ')}`);
    }

    farmer.totalLandArea = reader.number('Total Land Area') as number;
    farmer.cultivationArea = reader.number('Cultivation Area') as number;
    farmer.farmerGrading = text('Farmer Grading');
    farmer.howDoYouSell = text('How Do You Sell');
    farmer.sevenTwelveNo = text('7/12 Number');
    farmer.idProofNo = text('ID Proof Number');
    farmer.dob = reader.date('Date Of Birth') as Date;
    farmer.dateOfVisit = reader.date('Date Of Visit') as Date;

    const address = (prefix: string) => {
      const value = new Address();
      value.address1 = text(`${prefix} Address1`);
      value.address2 = text(`${prefix} Address2`);
      value.location = text(`${prefix} Location`);
      value.city = text(`${prefix} City`);
      value.state = text(`${prefix} State`);
      value.pincode = text(`${prefix} Pincode`);
      return value;
    };
    farmer.residensialAddress = address('Residential');
    farmer.farmAddress = address('Farm');
    return farmer;
  }

  /**
   * Next farmer code in the FARM<year>NNNN series.
   *
   * Derived from the highest existing code rather than a row count, so codes
   * are not reused after a farmer is deleted.
   */
  private async generateBulkFarmerCode(
    farmerRepository: Repository<Farmer>,
  ): Promise<string> {
    const prefix = `FARM${new Date().getFullYear()}`;

    const last = await farmerRepository.query(
      `SELECT "farmerCode" FROM farmer WHERE "farmerCode" LIKE $1 ORDER BY "farmerCode" DESC LIMIT 1`,
      [`${prefix}%`],
    );

    let next = 1;
    if (last.length > 0 && last[0].farmerCode) {
      const lastNumber = parseInt(last[0].farmerCode.slice(prefix.length), 10);
      if (!Number.isNaN(lastNumber)) next = lastNumber + 1;
    }

    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  async softDeleteFarmers(farmerIds: string[]) {
    // Null out farmerCode before soft-deleting so the unique constraint
    // slot is freed and the code is never re-blocked.
    await this.farmerRepository
      .createQueryBuilder()
      .update(Farmer)
      .set({ farmerCode: () => 'NULL' })
      .where('id IN (:...ids)', { ids: farmerIds })
      .execute();

    const result = await this.farmerRepository.softDelete({
      id: In(farmerIds)
    });
    await this.invalidateFarmerCache();
    return result;
  }

//   async getAllFarmers(options: PaginationOptions): Promise<FarmerListResponseDto> {
//   const key = `${CACHE_PREFIX}:list:${JSON.stringify(options)}`;
//   const cached = await this.cacheService.get<FarmerListResponseDto>(key);
//   if (cached) return cached;

//   const queryBuilder = this.farmerRepository
//     .createQueryBuilder('farmer')
//     .leftJoin('farmer.createdBy', 'createdBy')
//     .leftJoin('farmer.residensialAddress', 'residensialAddress')
//     .leftJoin('farmer.farmAddress', 'farmAddress')
//     .select([
//       'farmer.id', 'farmer.status', 'farmer.farmerCode',
//       'farmer.farmerfName', 'farmer.farmermName', 'farmer.farmerlName',
//       'farmer.primaryMobileNo', 'farmer.secondaryMobileNo', 'farmer.email',
//       'farmer.gender', 'farmer.dob', 'farmer.totalLandArea', 'farmer.cultivationArea',
//       'farmer.landHoldingStatus', 'farmer.landStatus', 'farmer.idProofNo', 'farmer.createdAt',
//       'createdBy.firstName', 'createdBy.lastName',
//       'residensialAddress.address1', 'residensialAddress.address2', 'residensialAddress.location',
//       'residensialAddress.city', 'residensialAddress.state', 'residensialAddress.pincode',
//       'farmAddress.address1', 'farmAddress.address2', 'farmAddress.location',
//       'farmAddress.city', 'farmAddress.state', 'farmAddress.pincode',
//     ])
//     .orderBy('farmer.createdAt', 'DESC');

//   const farmers = await buildQuery(queryBuilder, options, 'farmer');

//   const formatAddr = (addr: any): string => addr
//     ? [addr.address1, addr.address2, addr.location, addr.city, addr.state, addr.pincode]
//         .filter(Boolean).join(' ')
//     : '';

//   const response: FarmerListResponseDto = {
//     data: farmers.data.map((farmer: any): FarmerListItemDto => {
//       const { createdDate, createdTime } = formatDateTime(farmer.createdAt);
//       return {
//         id: farmer.id,
//         status: farmer.status,
//         farmerCode: farmer.farmerCode?.toUpperCase() ?? '',
//         farmerfName: farmer.farmerfName,
//         farmermName: farmer.farmermName,
//         farmerlName: farmer.farmerlName,
//         primaryMobileNo: farmer.primaryMobileNo,
//         secondaryMobileNo: farmer.secondaryMobileNo,
//         email: farmer.email,
//         gender: farmer.gender,
//         dob: farmer.dob,
//         totalLandArea: farmer.totalLandArea,
//         cultivationArea: farmer.cultivationArea,
//         landHoldingStatus: farmer.landHoldingStatus,
//         landStatus: farmer.landStatus,
//         idProofNo: farmer.idProofNo,
//         residensialAddress: formatAddr(farmer.residensialAddress),
//         farmAddress: formatAddr(farmer.farmAddress),
//         createdBy: farmer.createdBy
//           ? `${farmer.createdBy.firstName} ${farmer.createdBy.lastName}`
//           : null,
//         createdDate,
//         createdTime,
        
//       };
//     }),
//     meta: farmers.meta,
//   };

//   await this.cacheService.set(key, response, CACHE_TTL);
//   return response;
// }

    
  }


  


    // public async updateFarmer(
  //   farmerId: string,
  //   updateData: any
  // ): Promise<Farmer | null> {
  //   const farmer = await this.farmerRepository.findOne({
  //     where: { id: farmerId },
  //     relations: ["crops"],
  //   });
  //   if (!farmer) {
  //     return null;
  //   }

  //   const { crops: updatedCrops, ...outerFields } = updateData;
  //   Object.assign(farmer, outerFields);

  //   if (updatedCrops) {
  //     updatedCrops.forEach((updatedCrop: any) => {
  //       const existingCrop = farmer.crops.find(
  //         (crop) => crop.id === updatedCrop.id
  //       );
  //       if (existingCrop) {
  //         for (const key in updatedCrop) {
  //           if (updatedCrop.hasOwnProperty(key)) {
  //             (existingCrop as any)[key] = updatedCrop[key];
  //           }
  //         }
  //       }
  //     });
  //   }

  //   await this.farmerRepository.save(farmer);
  //   return farmer;
  // }
  // public async updateFarmer(
  //   farmerId: string,
  //   updateData: any,
  //   updatedBy: string,
  // ): Promise<Farmer | null> {
  //   // Step 1: Fetch the existing Farmer with relations to "crops"
  //   const farmer = await this.farmerRepository.findOne({
  //     where: { id: farmerId },
  //     relations: ['crops'],
  //   });

  //   if (!farmer) {
  //     return null; // If Farmer doesn't exist, return null
  //   }

  //   // Step 2: Prepare the data for audit logging (before update)
  //   const { crops: updatedCrops, ...outerFields } = updateData;
  //   const previousFarmerData = { ...farmer };

  //   // Log changes for the Farmer fields (excluding crops)
  //   await this.auditLogService.logChange(
  //     'Farmer',
  //     farmerId,
  //     previousFarmerData,
  //     { ...outerFields },
  //     updatedBy,
  //   );

  //   Object.assign(farmer, outerFields);

  //   if (updatedCrops) {

  //     updatedCrops.forEach((updatedCrop: Partial<Crop>) => {
  //       const existingCrop = farmer.crops.find(
  //         (crop) => crop.id === updatedCrop.id,
  //       );
  //       if (existingCrop) {

  //         this.auditLogService.logChange(
  //           'Crop',
  //           updatedCrop.id!,
  //           existingCrop,
  //           updatedCrop,
  //           updatedBy,
  //         );

  //         for (const key in updatedCrop) {
  //           if (Object.prototype.hasOwnProperty.call(updatedCrop, key)) {
  //             (existingCrop as any)[key] = updatedCrop[key as keyof Crop]!;
  //           }
  //         }
  //       }
  //     });
  //   }

  //   // Step 5: Save the updated Farmer (and related crops)
  //   await this.farmerRepository.save(farmer);

  //   return farmer; // Return the updated Farmer entity
  // }

  //   public async updateFarmer(
  //   farmerId: string,
  //   updateData: any,
  //   updatedBy: string
  // ): Promise<Farmer | null> {
  //   const farmer = await this.farmerRepository.findOne({
  //     where: { id: farmerId },
  //     relations: ["crops"],
  //   });

  //   if (!farmer) return null;

  //   const { crops: updatedCrops, ...outerFields } = updateData;

  //   // Audit farmer outer fields
  //   await this.auditLogService.logChange(
  //     "Farmer",
  //     farmerId,
  //     { ...farmer },
  //     { ...outerFields },
  //     updatedBy
  //   );

  //   // Update outer fields
  //   Object.assign(farmer, outerFields);

  //   if (updatedCrops) {
  //     const updatedCropIds = updatedCrops.filter((c: { id: any }) => c.id).map((c: { id: any }) => c.id);

  //     // Keep only crops that still exist in request (others will be deleted by orphanedRowAction)
  //     farmer.crops = farmer.crops.filter(c => updatedCropIds.includes(c.id));

  //     for (const updatedCrop of updatedCrops) {
  //       if (updatedCrop.id) {
  //         // Update existing crop
  //         const existingCrop = farmer.crops.find(c => c.id === updatedCrop.id);
  //         if (existingCrop) {
  //           await this.auditLogService.logChange(
  //             "Crop",
  //             updatedCrop.id,
  //             existingCrop,
  //             updatedCrop,
  //             updatedBy
  //           );
  //           Object.assign(existingCrop, updatedCrop);
  //         }
  //       } else {
  //         // Add new crop
  //         const newCrop = this.cropRepository.create(updatedCrop);
  //         if (Array.isArray(newCrop)) {
  //           farmer.crops.push(...newCrop);
  //         } else {
  //           farmer.crops.push(newCrop);
  //         }
  //       }
  //     }
  //   }

  //   await this.farmerRepository.save(farmer);
  //   return farmer;
  // }



  //  public async getFarmersWithFilters(queryOptions: PaginationOptions) {
//     const key = `${CACHE_PREFIX}:filtered:${JSON.stringify(queryOptions)}`;
//     const cached = await this.cacheService.get<any>(key);
//     if (cached) return cached;

//     const queryBuilder = this.farmerRepository
//       .createQueryBuilder('farmer')
//       .leftJoinAndSelect('farmer.residensialAddress', 'residensialAddress')
//       .leftJoinAndSelect('farmer.farmAddress', 'farmAddress')
//       .leftJoinAndSelect('farmer.crops', 'crops')
//       .orderBy('farmer.createdAt', 'DESC');

//        const { filters = {} } = queryOptions;

  
//   for (const [key, value] of Object.entries(filters)) {
//     if (!value) continue;

//     if (['totalLandArea', 'cultivationArea'].includes(key)) continue;

   
//     if (key.includes('.')) {
//       const [alias, column] = key.split('.');

//       if (alias === 'farmAddress' || alias === 'residensialAddress') {
       
//         if (column === 'pincode') {
//           queryBuilder.andWhere(`"${alias}"."${column}" = :${alias}_${column}`, { [`${alias}_${column}`]: value });
//         } else {
         
//           queryBuilder.andWhere(`LOWER("${alias}"."${column}") LIKE LOWER(:${alias}_${column})`, { [`${alias}_${column}`]: `%${value}%` });
//         }
//       }


//       if (alias === 'crops' && column === 'crop') {
//         queryBuilder.andWhere(qb => {
//           const subQuery = qb
//             .subQuery()
//             .select('1')
//             .from('crop', 'c')
//             .where('"c"."farmerId" = "farmer"."id"')
//             .andWhere('LOWER(c.crop) = LOWER(:crop)')
//             .getQuery();
//           return `EXISTS ${subQuery}`;
//         }, { crop: value });
//       }
//     } else {
      
//       queryBuilder.andWhere(`farmer.${key} = :${key}`, { [key]: value });
//     }
//   }

//     const {
//       status,
//       landStatus,
//       landHoldingStatus,
//       totalLandArea,
//       cultivationArea,

//     } = queryOptions.filters || {};

    

   
//     if (status) queryBuilder.andWhere('farmer.status = :status', { status });
//     if (landStatus) queryBuilder.andWhere('farmer.landStatus = :landStatus', { landStatus });
//     if (landHoldingStatus) queryBuilder.andWhere('farmer.landHoldingStatus = :landHoldingStatus', { landHoldingStatus });

   
//     applyNumericFilter(queryBuilder, 'farmer', 'totalLandArea', totalLandArea);
//     applyNumericFilter(queryBuilder, 'farmer', 'cultivationArea', cultivationArea);

//     const [sql, params] = queryBuilder.getQueryAndParameters();
    
   
//     const { data, meta } = await buildQuery(queryBuilder, queryOptions, 'farmer');

   
//     const formattedData = data.map((farmer) => ({
//       id: farmer.id,
//       fullName: [farmer.farmerfName, farmer.farmermName, farmer.farmerlName]
//         .filter(Boolean)
//         .join(' '),
//       primaryMobileNo: farmer.primaryMobileNo,
//       secondaryMobileNo: farmer.secondaryMobileNo,
//       status: farmer.status,
//       email: farmer.email,
//       farmerCode: farmer.farmerCode,
//       totalLandArea: farmer.totalLandArea,
//       cultivationArea: farmer.cultivationArea,
//       landHoldingStatus: farmer.landHoldingStatus,
//       landStatus: farmer.landStatus,
//       residensialAddress: farmer.residensialAddress || null,
//       farmAddress: farmer.farmAddress || null,
//       crops: farmer.crops || [],
//     }));

//     const response = {
//       data: formattedData,
//       total: meta.total,
//       currentPage: meta.page,
//       totalPages: meta.pages,
//     };
//     await this.cacheService.set(key, response, CACHE_TTL);
//     return response;
//   }


    // async getFarmerDetails(farmerId: string): Promise<Farmer | null> {
  //   const key = `${CACHE_PREFIX}:details:${farmerId}`;
  //   const cached = await this.cacheService.get<Farmer>(key);
  //   if (cached) return cached;

  //   const farmer = await this.farmerRepository
  //     .createQueryBuilder("farmer")
  //     .leftJoinAndSelect("farmer.residensialAddress", "residensialAddress")
  //     .leftJoinAndSelect("farmer.farmAddress", "farmAddress")
  //     .select([
  //       "farmer.id",
  //       "farmer.farmerCode",
  //       "farmer.farmerfName",
  //       "farmer.farmerlName",
  //       "farmer.farmermName",
  //       "farmer.primaryMobileNo",
  //       "farmer.email",
  //       "residensialAddress",
  //       "farmAddress",
  //     ])
  //     .where("farmer.id = :farmerId", { farmerId })
  //     .getOne();

  //   if (farmer) await this.cacheService.set(key, farmer, CACHE_TTL_DETAIL);
  //   return farmer;
  // }


    // public async getAllFarmerCodes(): Promise<string[]> {
  //   const key = `${CACHE_PREFIX}:codes:all`;
  //   const cached = await this.cacheService.get<string[]>(key);
  //   if (cached) return cached;

  //   const farmers = await this.farmerRepository.find({
  //     select: ['farmerCode'], 
  //     order: {
  //       createdAt: 'DESC', 
  //     },
  //   });

  //   const result = farmers.map((farmer) => farmer.farmerCode);
  //   await this.cacheService.set(key, result, CACHE_TTL);
  //   return result;
  // }


  

  // async getFarmerByIdForUpdate(id: string) {
  //   const key = `${CACHE_PREFIX}:idForUpdate:${id}`;
  //   const cached = await this.cacheService.get<any>(key);
  //   if (cached) return cached;

  //   const farmer = await this.farmerRepository
  //     .createQueryBuilder("farmer")
  //     .leftJoinAndSelect("farmer.residensialAddress", "residensialAddress")
  //     .leftJoinAndSelect("farmer.farmAddress", "farmAddress")
  //     .leftJoinAndSelect("farmer.crops", "crops")
  //     .where("farmer.id = :id", { id })
  //     .getOne();

  //   if (!farmer) throw new Error("Farmer not found");

  //   const result = {
  //     id: farmer.id,
  //     farmerfName: farmer.farmerfName,
  //     farmerlName: farmer.farmerlName,
  //     primaryMobileNo: farmer.primaryMobileNo,
  //     dob: farmer.dob,
  //     residensialAddress: farmer.residensialAddress?.id || null,
  //     farmAddress: farmer.farmAddress?.id || null,
  //     crop: farmer.crops,
  //   };
  //   await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
  //   return result;
  // }

/** How the import names a farmer: "FARM20260004 Ramesh Jadhav". */
const farmerLabel = (farmer: Pick<Farmer, 'farmerCode' | 'farmerfName' | 'farmerlName'>): string =>
  [farmer.farmerCode, farmer.farmerfName, farmer.farmerlName].filter(Boolean).join(' ');
