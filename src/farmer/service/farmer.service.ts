import { inject, injectable } from 'inversify';
import * as XLSX from 'xlsx';
import { Farmer } from '../entity/farmer.entity';
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

import { Status } from '../../utils/status.enum';
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
      throw new AppError(400, `Invalid status '${status}'. Only 'approved' or 'rejected' are allowed.`);
    }

    const approver = await this.userRepository.findOne({
      where: { id: approverId },
    });
    if (!approver) throw new AppError(404, 'Approver not found');

    // Only VERIFIER role can approve/reject farmers
    if (!approver.roles || !approver.roles.includes(Role.VERIFIER)) {
      throw new AppError(403, 'Only a Verifier can approve or reject farmers');
    }

    const farmer = await this.farmerRepository.findOne({
      where: { id: farmerId },
    });
    if (!farmer) throw new AppError(404, 'Farmer not found');

    // Farmer must be in 'pending' status — draft means not yet submitted
    if (farmer.status !== Status.PENDING) {
      throw new AppError(400, `Farmer cannot be approved because its current status is '${farmer.status}'. Only farmers with status 'pending' can be approved or rejected.`);
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
        || (approver as any)?.username || 'Verifier';

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
        await this.notificationService.createNotiForRole(
          `Farmer "${farmerFullName}" is awaiting your approval, created by ${creatorName}`,
          Role.VERIFIER,
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

    const { data } = await buildQuery(
      queryBuilder,
      { ...options, page: undefined, limit: undefined },
      'farmer',
    );

    const workbook = buildDataWorkbook(FARMER_SHEET, data as Farmer[]);
    return uploadWorkbookToSpaces(workbook, 'Farmers', data.length);
  }

  /**
   * Blank workbook carrying exactly the headers the importer reads, generated
   * from the same column map as the export.
   */
  async buildExcelTemplate(): Promise<UploadedExport> {
    const workbook = buildTemplateWorkbook(FARMER_SHEET);
    return uploadWorkbookToSpaces(workbook, 'Farmer_Template', 0);
  }

  /**
   * Imports farmers from a spreadsheet uploaded to Spaces.
   *
   * A farmer whose primary mobile number is already on record is skipped and
   * reported rather than updated, and the uploaded file is removed from Spaces
   * once read - success or failure.
   *
   * Owner and approval status are not read from the sheet: every imported farmer
   * belongs to `createdById` and starts as pending, exactly as if it had been
   * entered through the form.
   */
  async createFarmerwithExcel(
    fileUrl: string,
    createdById: string,
  ): Promise<ImportSummary> {
    if (!fileUrl) {
      throw new AppError(400, 'No file URL provided');
    }

    const summary = emptySummary();

    try {
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
      const productRepository = AppDataSource.getRepository(Product);

      const creator = await this.userRepository.findOneBy({ id: createdById });
      if (!creator) {
        throw new AppError(401, 'The logged-in user could not be found');
      }

      const byHeader = new Map(FARMER_SHEET.columns.map((c) => [c.header, c]));
      const column = (header: string) => {
        const found = byHeader.get(header);
        if (!found) throw new Error(`Unknown farmer column: ${header}`);
        return found;
      };
      const text = (row: ExcelRow, header: string) =>
        row.cell<string | null>(column(header));

      for (const row of sheet.rows) {
        try {
          const firstName = text(row, 'First Name');
          const primaryMobileNo = text(row, 'Primary Mobile No');

          if (!firstName || !primaryMobileNo) {
            summary.skipped.push({
              row: row.rowNumber,
              reason: 'First Name and Primary Mobile No are both required',
            });
            continue;
          }

          const existing = await farmerRepository.findOne({
            where: { primaryMobileNo },
          });

          if (existing) {
            summary.skipped.push({
              row: row.rowNumber,
              reason: `Farmer with mobile ${primaryMobileNo} already exists (${existing.farmerCode ?? existing.id})`,
            });
            continue;
          }

          const farmer = new Farmer();
          farmer.farmerfName = firstName;
          farmer.farmermName = text(row, 'Middle Name') as string;
          farmer.farmerlName = text(row, 'Last Name') as string;
          farmer.primaryMobileNo = primaryMobileNo;
          farmer.secondaryMobileNo = text(row, 'Secondary Mobile No') as string;
          farmer.email = text(row, 'Email') as string;
          farmer.gender = text(row, 'Gender') as string;
          farmer.landHoldingStatus = text(row, 'Land Holding') as string;
          farmer.landStatus = text(row, 'Land Status') as string;
          farmer.totalLandArea = row.cell<number | null>(
            column('Total Land Area'),
          ) as number;
          farmer.cultivationArea = row.cell<number | null>(
            column('Cultivation Area'),
          ) as number;
          farmer.farmerGrading = text(row, 'Farmer Grading') as string;
          farmer.howDoYouSell = text(row, 'How Do You Sell') as string;
          farmer.sevenTwelveNo = text(row, '7/12 Number') as string;
          farmer.idProofNo = text(row, 'ID Proof Number') as string;
          farmer.status = Status.PENDING;
          farmer.createdBy = creator;

          const dob = row.cell<string | null>(column('Date Of Birth'));
          if (dob) farmer.dob = new Date(dob);

          const dateOfVisit = row.cell<string | null>(column('Date Of Visit'));
          if (dateOfVisit) farmer.dateOfVisit = new Date(dateOfVisit);

          farmer.farmerCode = await this.generateBulkFarmerCode(farmerRepository);

          const residential = new Address();
          residential.address1 = text(row, 'Residential Address1') as string;
          residential.address2 = text(row, 'Residential Address2') as string;
          residential.location = text(row, 'Residential Location') as string;
          residential.city = text(row, 'Residential City') as string;
          residential.state = text(row, 'Residential State') as string;
          residential.pincode = text(row, 'Residential Pincode') as string;
          farmer.residensialAddress = residential;

          const farm = new Address();
          farm.address1 = text(row, 'Farm Address1') as string;
          farm.address2 = text(row, 'Farm Address2') as string;
          farm.location = text(row, 'Farm Location') as string;
          farm.city = text(row, 'Farm City') as string;
          farm.state = text(row, 'Farm State') as string;
          farm.pincode = text(row, 'Farm Pincode') as string;
          farmer.farmAddress = farm;

          const cropColumn = (header: string) =>
            FARMER_CROP_GROUP.columns.find((c) => c.header === header)!;

          const cropBlocks = row.eachGroupBlock(FARMER_CROP_GROUP, (index) => ({
            index,
            name: row.groupCell<string | null>(
              FARMER_CROP_GROUP,
              index,
              cropColumn('Crop'),
            ),
          }));

          farmer.crops = [];

          for (const block of cropBlocks) {
            if (!block.name) {
              summary.failed.push({
                row: row.rowNumber,
                reason: `Crop${block.index} has no crop name and was not imported`,
              });
              continue;
            }

            const product = await productRepository
              .createQueryBuilder('product')
              .where('LOWER(product.name) = LOWER(:name)', { name: block.name })
              .getOne();

            if (!product) {
              summary.failed.push({
                row: row.rowNumber,
                reason: `Crop "${block.name}" did not match any product and was not imported`,
              });
              continue;
            }

            const crop = new Crop();
            crop.crop = product;
            crop.variety = row.groupCell<string | null>(
              FARMER_CROP_GROUP,
              block.index,
              cropColumn('Variety'),
            ) as string;
            crop.noOfPlants = row.groupCell<number | null>(
              FARMER_CROP_GROUP,
              block.index,
              cropColumn('No_Of_Plants'),
            ) as number;
            crop.expectedQuantityInTonnes = row.groupCell<number | null>(
              FARMER_CROP_GROUP,
              block.index,
              cropColumn('Expected Quantity (Tonnes)'),
            ) as number;

            const pruningDate = row.groupCell<string | null>(
              FARMER_CROP_GROUP,
              block.index,
              cropColumn('Pruning Date'),
            );
            if (pruningDate) crop.pruningDate = new Date(pruningDate);

            const harvestDate = row.groupCell<string | null>(
              FARMER_CROP_GROUP,
              block.index,
              cropColumn('Expected Harvest Date'),
            );
            if (harvestDate) crop.expectedHarvestDate = new Date(harvestDate);

            farmer.crops.push(crop);
          }

          await farmerRepository.save(farmer);
          summary.created++;
        } catch (rowError: any) {
          summary.failed.push({
            row: row.rowNumber,
            reason: rowError?.message ?? 'Could not save this row',
          });
        }
      }

      if (summary.created > 0) {
        await this.invalidateFarmerCache();
      }

      return summary;
    } finally {
      await deleteFromSpaces(fileUrl);
    }
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

