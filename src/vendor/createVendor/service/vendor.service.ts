import { inject, injectable } from "inversify";
import { format } from "date-fns"; // Make sure to install the date-fns library

import { VendorRepository } from "../repository/vendor.repository";
import { TYPES } from "../../../types";
import AppError from "../../../utils/appError";
import * as XLSX from "xlsx";

import { AppDataSource } from "../../../utils/data-source";
import { buildQuery, PaginationOptions } from "../../../utils/pagination";

import { VendorSubcategoryRepository } from "../../vendorSubcategory/repository/vendorSubcategory.repository";
import { VendorCategory } from "../../vendorCategory/entity/vendorCategory.entity";

import { In } from "typeorm";
import { ProductRepository } from "../../../product/createproduct/repository/product.repository";
import { UserRepository } from "../../../employee/repository/user.repository";
import { PackingMaterialRepository } from "../../../packingMaterial/repository/packingMaterial.repository";

import { Status } from "../../../utils/status.enum";
import { applyMasterFilters } from "../../../global/filters/masterDataFilter";
import { VENDOR_FILTERS } from "../filters/vendor.filters";
import { formatDateTime } from "../../../utils/dateUtils";

import { NotificationService } from "../../../notification/service/notification.service";
import { formatAddress } from "../../../utils/addressFormate.utils";
import { CacheService } from "../../../global/cache.service";
import { createHash } from "crypto";
import { VendorCategoryRepository } from "../../vendorCategory/repository/vendorCategory.repository";
import { AddressService } from "../../../address/service/address.service";
import { VendorCategoryService } from "../../vendorCategory/service/vendorCategory.service";
import { BankDetailsvendService } from "./vendorBankDetails.service";
import { VendorSaleInfoService } from "./vendorsaleinfo.service";
import { VendorSubcategoryService } from "../../vendorSubcategory/service/vendorSubcategory.service";
import { AuditLogService } from "../../../employeeActivity/service/auditLog.service";
import { CreateVendorDto, UpdateVendorDto, VendorDropdownDto, VendorListResponseDto, VendorUpdateFormDto, VendorViewResponseDto } from "../dto/vendor.dto";
import { Vendor } from "../entity/vendor.entity";
import { Role } from "../../../employee/entity/user.entity";
import { Address } from "../../../address/entity/address.entity";
import { VendorSaleInfo } from "../entity/vendorsaleinfo.entity";
import { BankDetailsvend } from "../entity/bankDetailsVend.entity";
import { PackingMaterial, UseFor } from "../../../packingMaterial/entity/packingMaterial.entity";
import { VendorSubcategory } from "../../vendorSubcategory/entity/vendorSubcategory.entity";
import { Product } from "../../../product/createproduct/entity/product.entity";
import { VendorClassification } from "../entity/vendor.entity";
import { AccountType } from "../../../customer/addcustomer/entity/bankDetailsCust.entity";
import {
  attachImportReport,
  buildDataWorkbook,
  buildTemplateWorkbook,
  deleteFromSpaces,
  UploadedExport,
  uploadWorkbookToSpaces,
} from "../../../excel/excelFile.service";
import {
  emptySummary,
  ExcelRow,
  ImportSummary,
  readUploadedSheet,
} from "../../../excel/excelImport.service";
import { toList } from "../../../excel/excelValue";
import { VENDOR_SHEET } from "../excel/vendor.columns";
import { normaliseName } from "../../../excel/lookupByName";
import { LookupIndex } from "../../../excel/lookupIndex";
import { DraftLinks } from "../../../excel/draftLinks";
import { ContactPool, mergeFilled, RegistrationRowReader } from "../../../excel/registrationRow";
import { WorkbookLists } from "../../../excel/excelColumn";
import { assertImportPrerequisites } from "../../../excel/importPrerequisites";
import { countMasterRecords } from "../../../excel/importPrerequisiteCounts";


const CACHE_PREFIX = "vendor";
const CACHE_TTL = 180;
const CACHE_TTL_DETAIL = 300;

@injectable()
export class VendorService {
  constructor(
    @inject(TYPES.VendorRepository)
    private readonly vendorRepository: VendorRepository,
    @inject(TYPES.ProductRepository)
    private readonly productRepository: ProductRepository,
    @inject(TYPES.VendorCategoryRepository)
    private readonly vendorCategoryRepository: VendorCategoryRepository,
    @inject(TYPES.UserRepository) private userRepository: UserRepository,
    @inject(TYPES.PackingMaterialRepository)
    private readonly packingMaterialRepository: PackingMaterialRepository,
    @inject(TYPES.VendorSubcategoryRepository)
    private readonly vendorSubcategoryRepository: VendorSubcategoryRepository,

    @inject(TYPES.AddressService)
    private readonly addressService: AddressService,
    @inject(TYPES.VendorCategoryService)
    private readonly vendorCategoryService: VendorCategoryService,
    @inject(TYPES.BankDetailsvendService)
    private readonly vendorBankDetailService: BankDetailsvendService,
    @inject(TYPES.VendorSaleInfoService)
    private readonly vendorSaleInfoService: VendorSaleInfoService,
    @inject(TYPES.VendorSubcategoryService)
    private readonly vendorSubCategoryService: VendorSubcategoryService,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
    @inject(TYPES.NotificationService)
    private readonly notificationService: NotificationService,
  ) {}

  // ─── Cache Helpers ────────────────────────────────────────────────────────

  private async invalidateVendorCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:filter:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:dropdown:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${CACHE_PREFIX}:view:${id}`),
        this.cacheService.del(`${CACHE_PREFIX}:update:${id}`),
        this.cacheService.del(`${CACHE_PREFIX}:withid:${id}`),
        this.cacheService.del(`${CACHE_PREFIX}:filter:id:${id}`),
      );
    }
    await Promise.all(tasks);
  }
async createVendor(vendorDto: CreateVendorDto & Record<string, any>): Promise<Vendor> {
    // Create the new Vendor entity

    // ── UPSERT: if id is present, the frontend is re-saving an existing draft ──
    if (vendorDto.id) {
      const updatedBy = vendorDto.createdBy ?? '';
      const updated = await this.updateVendor(
        vendorDto.id,
        vendorDto as any,
        updatedBy,
      );
      if (!updated) throw new AppError(404, 'Vendor not found for draft update');
      return updated;
    }

    const user = await this.userRepository.findOneBy({id: vendorDto.createdBy});

    // Always set status to draft - must go through submit → pending → approve flow
   // vendorDto.status = Status.DRAFT;

   if (!user) {
           throw new AppError(404, 'User not found');
         }

      // Admin/Verifier: draft → draft, anything else → approved
      // Other users:   draft → draft, anything else → pending
      if (user.roles && (user.roles.includes(Role.ADMIN) || user.roles.includes(Role.VERIFIER))) {
        vendorDto.status = vendorDto.status === Status.DRAFT ? Status.DRAFT : Status.APPROVED;
      } else {
        vendorDto.status = vendorDto.status === Status.DRAFT ? Status.DRAFT : Status.PENDING;
      }

    if(vendorDto.listOfAllProducts && Array.isArray(vendorDto.listOfAllProducts)){
      const productIds = vendorDto.listOfAllProducts.map((p: any) => p.id || p);
      
      const foundProducts = await this.productRepository.findBy({id: In(productIds)});
      
      vendorDto.listOfAllProducts = foundProducts;
    }

    // Handle mainProduct if provided
    if(vendorDto.mainProduct && typeof vendorDto.mainProduct === 'object' && vendorDto.mainProduct.id) {
      const mainProduct = await this.productRepository.findOneBy({id: vendorDto.mainProduct.id});
      if(mainProduct) {
        vendorDto.mainProduct = mainProduct;
      }
    }

    // Handle listOfPackingMaterial if provided
    if (vendorDto.listOfPackingMaterial && Array.isArray(vendorDto.listOfPackingMaterial)) {
      const pmIds = vendorDto.listOfPackingMaterial.map((p: any) => p.id || p);
      vendorDto.listOfPackingMaterial = await this.packingMaterialRepository.findBy({ id: In(pmIds) });
    }

    // Handle mainPackingMaterial if provided
    if (vendorDto.mainPackingMaterial && typeof vendorDto.mainPackingMaterial === 'object' && vendorDto.mainPackingMaterial.id) {
      const mainPM = await this.packingMaterialRepository.findOneBy({ id: vendorDto.mainPackingMaterial.id });
      if (mainPM) vendorDto.mainPackingMaterial = mainPM;
    } else if (typeof vendorDto.mainPackingMaterial === 'string' && vendorDto.mainPackingMaterial) {
      const mainPM = await this.packingMaterialRepository.findOneBy({ id: vendorDto.mainPackingMaterial });
      if (mainPM) vendorDto.mainPackingMaterial = mainPM;
    }
    //vendorDto.officeAddress = JSON.parse(vendorDto.officeAddress);

    const year = new Date().getFullYear();
    const prefix = `VENDOR${year}`;

    // Retry loop to handle race conditions where two requests generate the same code simultaneously
    let saved: Vendor | undefined;
    let attempts = 0;
    while (true) {
      attempts++;
      if (attempts > 10) throw new AppError(500, 'Failed to generate a unique vendor code after multiple attempts');

      // Use raw SQL to find the highest vendor code for this year,
      // bypassing TypeORM's soft-delete filter (deletedAt IS NULL) so we never
      // re-use a code that belongs to a soft-deleted or isDeleted record.
      const result = await this.vendorRepository.query(
        `SELECT vendor_code FROM vendor WHERE vendor_code LIKE $1 ORDER BY vendor_code DESC LIMIT 1`,
        [`${prefix}%`]
      );

      let nextNumber = 1;
      if (result.length > 0 && result[0].vendor_code) {
        const lastNumber = parseInt(result[0].vendor_code.slice(prefix.length), 10);
        if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
      }

      const vendorCode = `${prefix}${String(nextNumber).padStart(4, '0')}`;
      vendorDto.vendorCode = vendorCode;

      // Strip empty nested objects so TypeORM doesn't cascade-insert empty rows
      const hasData = (obj: any): boolean => {
        if (!obj || typeof obj !== 'object') return false;
        const keys = Object.keys(obj).filter(k => k !== 'id');
        return keys.length > 0;
      };
      const cleanedDto: any = { ...vendorDto };
      if (!hasData(cleanedDto.officeAddress)) delete cleanedDto.officeAddress;
      if (!hasData(cleanedDto.ref1Address)) delete cleanedDto.ref1Address;
      if (!hasData(cleanedDto.ref2Address)) delete cleanedDto.ref2Address;
      if (!hasData(cleanedDto.vendorSaleInfo)) delete cleanedDto.vendorSaleInfo;
      if (!hasData(cleanedDto.vendorBankDetails)) delete cleanedDto.vendorBankDetails;

      const newVendor = this.vendorRepository.create(cleanedDto as any) as unknown as Vendor;

      try {
        saved = await this.vendorRepository.save(newVendor);
        break; // success
      } catch (err: any) {
        // Postgres unique violation code
        if (err?.driverError?.code === '23505' || err?.code === '23505') {
          continue; // retry with next number
        }
        throw err; // unrelated error, rethrow
      }
    }

    await this.invalidateVendorCache();

    // Fire notifications — non-blocking, never throws
    this.notifyVendorCreated(saved!, vendorDto.createdBy ?? '').catch(() => {});

    return saved!;
  }

  // ─── Notification Helper ──────────────────────────────────────────────────

  private async notifyVendorCreated(vendor: Vendor, creatorId: string): Promise<void> {
    try {
      if (!creatorId) return;
      const creator = await this.userRepository.findOneBy({ id: creatorId });
      if (!creator) return;

      const isPrivileged =
        creator.roles?.includes(Role.ADMIN) || creator.roles?.includes(Role.VERIFIER);

      const vendorName = vendor.companyName || 'New Vendor';
      const creatorName = `${creator.firstName || ''} ${creator.lastName || ''}`.trim()
        || (creator as any).username || 'Unknown';

      if (isPrivileged) {
        await this.notificationService.createNoti(
          `Vendor "${vendorName}" created successfully`,
          creatorId,
        );
      } else {
        await this.notificationService.createNoti(
          `Your vendor "${vendorName}" has been sent for approval`,
          creatorId,
        );
        await this.notificationService.createNotiForRoles(
          `Vendor "${vendorName}" is awaiting your approval, created by ${creatorName}`,
          [Role.VERIFIER, Role.ADMIN],
        );
      }
    } catch {
      // Notification failure must never break the create flow
    }
  }

  async submitVendor(
    vendorId: string,
    fileUpdates: Record<string, string | null> = {},
    vendorData: Record<string, any> = {},
    submittedBy: string = '',
  ): Promise<Vendor> {
    const vendor = await this.vendorRepository.findOne({
      where: { id: vendorId },
      relations: ['officeAddress', 'ref1Address', 'ref2Address', 'vendorSaleInfo', 'vendorBankDetails'],
    });
    if (!vendor) throw new AppError(404, 'Vendor not found');

    // Admin/Verifier → approved directly; everyone else → pending
    if (submittedBy) {
      const submitter = await this.userRepository.findOneBy({ id: submittedBy });
      if (submitter?.roles && (submitter.roles.includes(Role.ADMIN) || submitter.roles.includes(Role.VERIFIER))) {
        vendor.status = Status.APPROVED;
      } else {
        vendor.status = Status.PENDING;
      }
    } else {
      vendor.status = Status.PENDING;
    }

    // ── Scalar fields apply
    const scalarFields: (keyof Vendor)[] = [
      'companyName', 'officeContactNo', 'officeEmail', 'gstn', 'ifGstnCopy',
      'panNo', 'ifPanCardCopy', 'msmeNo', 'ifMsmeCopy', 'website',
      'creditTerms', 'classification', 'vendorCode', 'vendorGrade',
      'dateOfIncorporation', 'inFandVBusinessSince', 'dispatchCenter',
      'warehouseLocations', 'packingCenterLocation', 'tradeLicenseNumber',
      'proposedPaymentTerms', 'anyDetailsTeamAndInfra', 'otherProductOrService',
      'paymentMode', 'ref1FName', 'ref1MName', 'ref1LName', 'ref1PrimaryCNumb',
      'ref1AltrCNumb', 'ref1Email', 'ref2FName', 'ref2MName', 'ref2LName',
      'ref2PrimaryCNumb', 'ref2AltrCNumb', 'ref2Email',
    ];

    for (const field of scalarFields) {
      if (vendorData[field] !== undefined && vendorData[field] !== null && vendorData[field] !== '') {
        (vendor as any)[field] = vendorData[field];
      }
    }

    // ── Helper: multipart/form-data madhe nested objects JSON string mhanun yetaat ──
    const parseIfString = (val: any): any => {
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    };

    // ── Nested object fields ──────────────────────────────────────────────
    const officeAddressData = parseIfString(vendorData.officeAddress);
    if (officeAddressData && typeof officeAddressData === 'object') {
      Object.assign(vendor.officeAddress ??= {} as Address, officeAddressData);
    }
    const ref1AddressData = parseIfString(vendorData.ref1Address);
    if (ref1AddressData && typeof ref1AddressData === 'object') {
      Object.assign(vendor.ref1Address ??= {} as Address, ref1AddressData);
    }
    const ref2AddressData = parseIfString(vendorData.ref2Address);
    if (ref2AddressData && typeof ref2AddressData === 'object') {
      Object.assign(vendor.ref2Address ??= {} as Address, ref2AddressData);
    }
    const vendorSaleInfoData = parseIfString(vendorData.vendorSaleInfo);
    if (vendorSaleInfoData && typeof vendorSaleInfoData === 'object') {
      Object.assign(vendor.vendorSaleInfo ??= {} as VendorSaleInfo, vendorSaleInfoData);
    }
    const vendorBankDetailsData = parseIfString(vendorData.vendorBankDetails);
    if (vendorBankDetailsData && typeof vendorBankDetailsData === 'object') {
      Object.assign(vendor.vendorBankDetails ??= {} as BankDetailsvend, vendorBankDetailsData);
    }

    // ── File updates apply करा ────────────────────────────────────────────
    if (fileUpdates.gstnCopy !== undefined)    vendor.gstnCopy    = fileUpdates.gstnCopy    ?? vendor.gstnCopy;
    if (fileUpdates.panCardCopy !== undefined) vendor.panCardCopy = fileUpdates.panCardCopy ?? vendor.panCardCopy;
    if (fileUpdates.msmeCopy !== undefined)    vendor.msmeCopy    = fileUpdates.msmeCopy    ?? vendor.msmeCopy;
    // cancelledChequeCopy is inside vendorBankDetails — handled above via nested object

    await this.vendorRepository.save(vendor);
    await this.invalidateVendorCache(vendorId);

    // Fresh fetch to ensure returned status reflects DB state
    const updated = await this.vendorRepository.findOne({ where: { id: vendorId } });
    return updated!;
  }

async approveVendor(vendorId: string, approverId: string, status: Status) {
  // Validate status — only approved or rejected are valid outcomes
  if (status !== Status.APPROVED && status !== Status.REJECTED) {
    throw new AppError(400, `Invalid status '${status}'. Only 'Approved' or 'Rejected' are allowed.`);
  }

  const approver = await this.userRepository.findOne({ where: { id: approverId } });
  if (!approver) throw new AppError(404, 'Approver not found');

  // Only ADMIN or VERIFIER role can approve/reject vendors
  if (!approver.roles || !(approver.roles.includes(Role.ADMIN) || approver.roles.includes(Role.VERIFIER))) {
    throw new AppError(403, 'Only an Admin or Verifier can approve or reject vendors');
  }

  const vendor = await this.vendorRepository.findOne({ where: { id: vendorId } });
  if (!vendor) throw new AppError(404, 'Vendor not found');

  // Vendor must be in 'pending' status — draft means not yet submitted
  if (vendor.status !== Status.PENDING) {
    throw new AppError(400, `Vendor cannot be approved because its current status is '${vendor.status}'. Only vendors with status 'Pending' can be approved or rejected.`);
  }

  vendor.status = status;
  vendor.approvedBy = { id: approverId } as any;
  const saved = await this.vendorRepository.save(vendor);
  await this.invalidateVendorCache(vendorId);

  // Notify verifier + creator — non-blocking
  this.notifyVendorApproved(saved, approverId, status).catch(() => {});

  return saved;
}

private async notifyVendorApproved(vendor: Vendor, approverId: string, status: Status): Promise<void> {
  try {
    const isApproved = status === Status.APPROVED;

    const approver = await this.userRepository.findOneBy({ id: approverId });
    const verifierName = `${approver?.firstName || ''} ${approver?.lastName || ''}`.trim()
      || (approver as any)?.username || (approver?.roles?.includes(Role.ADMIN) ? 'Admin' : 'Verifier');

    const vendorName = vendor.companyName || 'Vendor';

    // Notify the verifier who acted
    await this.notificationService.createNoti(
      isApproved
        ? `You approved vendor "${vendorName}" successfully`
        : `You rejected vendor "${vendorName}"`,
      approverId,
    );

    // Fetch vendor with createdBy to notify creator
    const vendorWithCreator = await this.vendorRepository.findOne({
      where: { id: vendor.id },
      relations: ['createdBy'],
    });
    const creatorId = (vendorWithCreator?.createdBy as any)?.id;
    if (creatorId && creatorId !== approverId) {
      await this.notificationService.createNoti(
        isApproved
          ? `Your vendor "${vendorName}" has been approved by ${verifierName}`
          : `Your vendor "${vendorName}" has been rejected by ${verifierName}`,
        creatorId,
      );
    }
  } catch {
    // Notification failure must never break the approve flow
  }
}
  
  async getVendorById(id: string): Promise<Vendor | null> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const vendor = await this.vendorRepository
      .createQueryBuilder("vendor")
      .leftJoinAndSelect("vendor.officeAddress", "officeAddress")
      .leftJoinAndSelect("vendor.vendorSaleInfo", "vendorSaleInfo")
      .leftJoinAndSelect("vendor.vendorBankDetails", "vendorBankDetails")
      .leftJoinAndSelect("vendorBankDetails.branchAddress", "branchAddress")
      .leftJoinAndSelect("vendor.ref1Address", "ref1Address")
      .leftJoinAndSelect("vendor.ref2Address", "ref2Address")
      .leftJoinAndSelect("vendor.subcategory", "subcategory")
      .leftJoinAndSelect("vendor.category", "category")
      .where("vendor.id = :id", { id })
      .getOne();

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    const result = {
      ...vendor,
      subcategory: vendor.subcategory?.id || null,
      category: vendor.category?.id || null,
    } as any;

    await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
    return result;
  }

  // Loads only the columns needed for the attachments view.
  async getVendorAttachments(id: string): Promise<Vendor | null> {
    return this.vendorRepository
      .createQueryBuilder("vendor")
      .leftJoin("vendor.vendorBankDetails", "vendorBankDetails")
      .select([
        "vendor.id",
        "vendor.vendorCode",
        "vendor.companyName",
        "vendor.gstnCopy",
        "vendor.panCardCopy",
        "vendor.msmeCopy",
        "vendorBankDetails.id",
        "vendorBankDetails.cancelledChequeCopy",
      ])
      .where("vendor.id = :id", { id })
      .getOne();
  }


//service

async getVendorByIdforview(id: string): Promise<VendorViewResponseDto> {
  const key = `${CACHE_PREFIX}:view:${id}`;
  const cached = await this.cacheService.get<any>(key);
  if (cached) return cached;

  const vendor = await this.vendorRepository
    .createQueryBuilder('vendor')
    .leftJoin('vendor.officeAddress', 'officeAddress')
    .leftJoin('vendor.vendorSaleInfo', 'vendorSaleInfo')
    .leftJoin('vendor.vendorBankDetails', 'vendorBankDetails')
    .leftJoin('vendorBankDetails.branchAddress', 'branchAddress')
    .leftJoin('vendor.ref1Address', 'ref1Address')
    .leftJoin('vendor.ref2Address', 'ref2Address')
    .leftJoin('vendor.subcategory', 'subcategory')
    .leftJoin('vendor.category', 'category')
    .leftJoin('vendor.mainProduct', 'mainProduct')
    .leftJoin('vendor.listOfAllProducts', 'listOfAllProducts')
    .leftJoin('vendor.mainPackingMaterial', 'mainPackingMaterial')
    .leftJoin('vendor.listOfPackingMaterial', 'listOfPackingMaterial')
    .leftJoin('vendor.createdBy', 'createdBy')
    .leftJoin('vendor.approvedBy', 'approvedBy')
    .select([
      'vendor.id', 'vendor.vendorCode', 'vendor.companyName', 'vendor.classification',
      'vendor.status', 'vendor.vendorGrade', 'vendor.paymentMode', 'vendor.creditTerms',
      'vendor.proposedPaymentTerms', 'vendor.otherProductOrService', 'vendor.dateOfIncorporation',
      'vendor.inFandVBusinessSince', 'vendor.dispatchCenter', 'vendor.warehouseLocations',
      'vendor.packingCenterLocation', 'vendor.tradeLicenseNumber', 'vendor.anyDetailsTeamAndInfra',
      'vendor.officeContactNo', 'vendor.officeEmail', 'vendor.website',
      'vendor.gstn', 'vendor.gstnCopy', 'vendor.ifGstnCopy',
      'vendor.panNo', 'vendor.panCardCopy', 'vendor.ifPanCardCopy',
      'vendor.msmeNo', 'vendor.msmeCopy', 'vendor.ifMsmeCopy',
      'vendor.ref1FName', 'vendor.ref1MName', 'vendor.ref1LName',
      'vendor.ref1PrimaryCNumb', 'vendor.ref1AltrCNumb', 'vendor.ref1Email',
      'vendor.ref2FName', 'vendor.ref2MName', 'vendor.ref2LName',
      'vendor.ref2PrimaryCNumb', 'vendor.ref2AltrCNumb', 'vendor.ref2Email',
      'vendor.createdAt',
      'officeAddress.address1', 'officeAddress.address2', 'officeAddress.location',
      'officeAddress.city', 'officeAddress.state', 'officeAddress.pincode',
      'vendorSaleInfo.contactFName', 'vendorSaleInfo.contactMName', 'vendorSaleInfo.contactLName',
      'vendorSaleInfo.directContactNumber', 'vendorSaleInfo.mobileNumber', 'vendorSaleInfo.email',
      'vendorBankDetails.beneficiaryFName', 'vendorBankDetails.beneficiaryMName', 'vendorBankDetails.beneficiaryLName',
      'vendorBankDetails.bankName', 'vendorBankDetails.typeOfAcc', 'vendorBankDetails.ifscCode',
      'vendorBankDetails.swiftNo', 'vendorBankDetails.invoiceCurrency',
      'vendorBankDetails.cancelledChequeCopy', 'vendorBankDetails.ifCancelledCheque','vendorBankDetails.bankCompanyName',
      'branchAddress.address1', 'branchAddress.address2', 'branchAddress.location',
      'branchAddress.city', 'branchAddress.state', 'branchAddress.pincode',
      'ref1Address.address1', 'ref1Address.address2', 'ref1Address.location',
      'ref1Address.city', 'ref1Address.state', 'ref1Address.pincode',
      'ref2Address.address1', 'ref2Address.address2', 'ref2Address.location',
      'ref2Address.city', 'ref2Address.state', 'ref2Address.pincode',
      'subcategory.name', 'category.name',
      'mainProduct.name', 'listOfAllProducts.name',
      'mainPackingMaterial.packagingMaterialName', 'listOfPackingMaterial.packagingMaterialName',
      'createdBy.firstName', 'createdBy.lastName',
      'approvedBy.firstName', 'approvedBy.lastName',
    ])
    .where('vendor.id = :id', { id })
    .getOne();

  if (!vendor) throw new AppError(404, 'Vendor not found');

 

  if (!vendor) {
    throw new AppError(404, "Vendor not found");
  }

  const formattedResult = {
    id: vendor.id,
    vendorCode: vendor.vendorCode,
    companyName: vendor.companyName,
    classification: vendor.classification,
    status: vendor.status,

    category: vendor.category?.name || null,
    subcategory: vendor.subcategory?.name || null,

    vendorGrade: vendor.vendorGrade,
    paymentMode: vendor.paymentMode,
    creditTerms: vendor.creditTerms,
    proposedPaymentTerms: vendor.proposedPaymentTerms,
    otherProductOrService: vendor.otherProductOrService,

    // 🔹 Date formatting
    dateOfIncorporation: vendor.dateOfIncorporation,
      // ? format(new Date(vendor.dateOfIncorporation), "dd-MM-yyyy")
      // : null,
    inFandVBusinessSince: vendor.inFandVBusinessSince,

    // 🔹 Product relations
    mainProduct: vendor.mainProduct?.name || null,
     
    

    // 🔹 Packing material relations
    mainPackingMaterial: vendor.mainPackingMaterial?.packagingMaterialName || null,
     listOfPackingMaterial: vendor.listOfPackingMaterial?.map(p => p.packagingMaterialName),
     
  listOfAllProducts: vendor.listOfAllProducts?.map(p => p.name),



    dispatchCenter: vendor.dispatchCenter,
    warehouseLocations: vendor.warehouseLocations,
    packingCenterLocation: vendor.packingCenterLocation,
    tradeLicenseNumber: vendor.tradeLicenseNumber,
    anyDetailsTeamAndInfra: vendor.anyDetailsTeamAndInfra,

    // --- Office Details ---
    officeAddress: vendor.officeAddress
      ? {
          address1: vendor.officeAddress.address1,
          address2: vendor.officeAddress.address2,
          location: vendor.officeAddress.location,
          city: vendor.officeAddress.city,
          state: vendor.officeAddress.state,
          pincode: vendor.officeAddress.pincode,
        }
      : null,
    officeContactNo: vendor.officeContactNo,
    officeEmail: vendor.officeEmail,
    website: vendor.website,

    // --- Tax and Regulatory Details ---
    gstn: vendor.gstn,
    gstnCopy: vendor.gstnCopy,
    ifGstnCopy: vendor.ifGstnCopy,
    panNo: vendor.panNo,
    panCardCopy: vendor.panCardCopy,
    ifPanCardCopy: vendor.ifPanCardCopy,
    msmeNo: vendor.msmeNo,
    msmeCopy: vendor.msmeCopy,
    ifMsmeCopy: vendor.ifMsmeCopy,

    // --- Contact Person (Vendor Sale Info) ---
    vendorSaleInfo: vendor.vendorSaleInfo
      ? {
          contactFName: vendor.vendorSaleInfo.contactFName,
          contactMName: vendor.vendorSaleInfo.contactMName,
          contactLName: vendor.vendorSaleInfo.contactLName,
          directContactNumber: vendor.vendorSaleInfo.directContactNumber,
          mobileNumber: vendor.vendorSaleInfo.mobileNumber,
          email: vendor.vendorSaleInfo.email,
        }
      : null,

    // --- Bank Details ---
    vendorBankDetails: vendor.vendorBankDetails
      ? {
          beneficiaryFName: vendor.vendorBankDetails.beneficiaryFName,
          beneficiaryMName: vendor.vendorBankDetails.beneficiaryMName,
          beneficiaryLName: vendor.vendorBankDetails.beneficiaryLName,
          bankName: vendor.vendorBankDetails.bankName,
          bankCompanyName:vendor.vendorBankDetails.bankCompanyName,
          typeOfAcc: vendor.vendorBankDetails.typeOfAcc,
          ifscCode: vendor.vendorBankDetails.ifscCode,
          swiftNo: vendor.vendorBankDetails.swiftNo,
          invoiceCurrency: vendor.vendorBankDetails.invoiceCurrency,
          cancelledChequeCopy: vendor.vendorBankDetails.cancelledChequeCopy,
          ifCancelledCheque: vendor.vendorBankDetails.ifCancelledCheque,
          branchAddress: vendor.vendorBankDetails.branchAddress
            ? {
                address1: vendor.vendorBankDetails.branchAddress.address1,
                address2: vendor.vendorBankDetails.branchAddress.address2,
                location: vendor.vendorBankDetails.branchAddress.location,
                city: vendor.vendorBankDetails.branchAddress.city,
                state: vendor.vendorBankDetails.branchAddress.state,
                pincode: vendor.vendorBankDetails.branchAddress.pincode,
              }
            : null,
        }
      : null,

    // --- Reference 1 ---
    
      ref1FName: vendor.ref1FName,
      ref1MName: vendor.ref1MName,
      ref1LName: vendor.ref1LName,
     ref1PrimaryCNumb: vendor.ref1PrimaryCNumb,
      ref1AltrCNumb :vendor.ref1AltrCNumb,
      ref1Email: vendor.ref1Email,
      ref1Address: vendor.ref1Address
        ? {
            address1: vendor.ref1Address.address1,
            address2: vendor.ref1Address.address2,
            location: vendor.ref1Address.location,
            city: vendor.ref1Address.city,
            state: vendor.ref1Address.state,
            pincode: vendor.ref1Address.pincode,
          }
        : null,
  

    // --- Reference 2 ---
    
      ref2FName: vendor.ref2FName,
      ref2MName: vendor.ref2MName,
      ref2LName: vendor.ref2LName,
      ref2PrimaryCNumb: vendor.ref2PrimaryCNumb,
      ref2AltrCNumb: vendor.ref2AltrCNumb,
      ref2Email: vendor.ref2Email,
      ref2Address: vendor.ref2Address
        ? {
            address1: vendor.ref2Address.address1,
            address2: vendor.ref2Address.address2,
            location: vendor.ref2Address.location,
            city: vendor.ref2Address.city,
            state: vendor.ref2Address.state,
            pincode: vendor.ref2Address.pincode,
          }
        : null,
  

    createdBy: vendor.createdBy?.firstName+' '+vendor.createdBy?.lastName,
    approvedBy: vendor.approvedBy
      ? `${vendor.approvedBy.firstName} ${vendor.approvedBy.lastName}`
      : null,
    createdTime:formatDateTime(vendor.createdAt).createdTime,
    createdDate: formatDateTime(vendor.createdAt).createdDate,
      // ? {
      //     id: vendor.createdBy.id,
      //     username: vendor.createdBy.username,
      //     email: vendor.createdBy.email,
      //   }
      // : null,
  };

  await this.cacheService.set(key, formattedResult, CACHE_TTL_DETAIL);
  return formattedResult;
}


async getVendorByIdforupdate(id: string): Promise<VendorUpdateFormDto> {
  const key = `${CACHE_PREFIX}:update:${id}`;
  const cached = await this.cacheService.get<any>(key);
  if (cached) return cached;

  const vendor = await this.vendorRepository
    .createQueryBuilder('vendor')
    .leftJoin('vendor.officeAddress', 'officeAddress')
    .leftJoin('vendor.vendorSaleInfo', 'vendorSaleInfo')
    .leftJoin('vendor.vendorBankDetails', 'vendorBankDetails')
    .leftJoin('vendorBankDetails.branchAddress', 'branchAddress')
    .leftJoin('vendor.ref1Address', 'ref1Address')
    .leftJoin('vendor.ref2Address', 'ref2Address')
    .leftJoin('vendor.subcategory', 'subcategory')
    .leftJoin('vendor.category', 'category')
    .leftJoin('vendor.mainProduct', 'mainProduct')
    .leftJoin('vendor.listOfAllProducts', 'listOfAllProducts')
    .leftJoin('vendor.mainPackingMaterial', 'mainPackingMaterial')
    .leftJoin('vendor.listOfPackingMaterial', 'listOfPackingMaterial')
    .leftJoin('vendor.createdBy', 'createdBy')
    .leftJoin('vendor.approvedBy', 'approvedBy')
    .select([
      'vendor.id', 'vendor.vendorCode', 'vendor.companyName', 'vendor.classification',
      'vendor.status', 'vendor.vendorGrade', 'vendor.paymentMode', 'vendor.creditTerms',
      'vendor.proposedPaymentTerms', 'vendor.otherProductOrService', 'vendor.dateOfIncorporation',
      'vendor.inFandVBusinessSince', 'vendor.dispatchCenter', 'vendor.warehouseLocations',
      'vendor.packingCenterLocation', 'vendor.tradeLicenseNumber', 'vendor.anyDetailsTeamAndInfra',
      'vendor.officeContactNo', 'vendor.officeEmail', 'vendor.website',
      'vendor.gstn', 'vendor.gstnCopy', 'vendor.ifGstnCopy',
      'vendor.panNo', 'vendor.panCardCopy', 'vendor.ifPanCardCopy',
      'vendor.msmeNo', 'vendor.msmeCopy', 'vendor.ifMsmeCopy',
      'vendor.ref1FName', 'vendor.ref1MName', 'vendor.ref1LName',
      'vendor.ref1PrimaryCNumb', 'vendor.ref1AltrCNumb', 'vendor.ref1Email',
      'vendor.ref2FName', 'vendor.ref2MName', 'vendor.ref2LName',
      'vendor.ref2PrimaryCNumb', 'vendor.ref2AltrCNumb', 'vendor.ref2Email',
      'vendor.createdAt',
     
      'officeAddress.address1', 'officeAddress.address2', 'officeAddress.location',
      'officeAddress.city', 'officeAddress.state', 'officeAddress.pincode',
      'vendorSaleInfo.contactFName', 'vendorSaleInfo.contactMName', 'vendorSaleInfo.contactLName',
      'vendorSaleInfo.directContactNumber', 'vendorSaleInfo.mobileNumber', 'vendorSaleInfo.email',
      'vendorBankDetails.beneficiaryFName', 'vendorBankDetails.beneficiaryMName', 'vendorBankDetails.beneficiaryLName',
      'vendorBankDetails.bankName', 'vendorBankDetails.typeOfAcc', 'vendorBankDetails.ifscCode',
      'vendorBankDetails.swiftNo', 'vendorBankDetails.invoiceCurrency',
      'vendorBankDetails.cancelledChequeCopy', 'vendorBankDetails.ifCancelledCheque','vendorBankDetails.bankCompanyName',
      'branchAddress.address1', 'branchAddress.address2', 'branchAddress.location',
      'branchAddress.city', 'branchAddress.state', 'branchAddress.pincode',
      'ref1Address.address1', 'ref1Address.address2', 'ref1Address.location',
      'ref1Address.city', 'ref1Address.state', 'ref1Address.pincode',
      'ref2Address.address1', 'ref2Address.address2', 'ref2Address.location',
      'ref2Address.city', 'ref2Address.state', 'ref2Address.pincode',
      'subcategory.id', 'category.id',
      'mainProduct.id', 'listOfAllProducts.id',
      'mainPackingMaterial.id', 'listOfPackingMaterial.id',
      'createdBy.id',
    ])
    .where('vendor.id = :id', { id })
    .getOne();

  if (!vendor) throw new AppError(404, 'Vendor not found');

  const { createdDate, createdTime } = formatDateTime(vendor.createdAt);
  const mapAddress = (addr: any) => addr ? {
    address1: addr.address1, address2: addr.address2, location: addr.location,
    city: addr.city, state: addr.state, pincode: addr.pincode,
  } : null;

  const formattedResult = {
    id: vendor.id,
    vendorCode: vendor.vendorCode,
    companyName: vendor.companyName,
    classification: vendor.classification,
    status: vendor.status,

    category: vendor.category?.id ?? null,
    subcategory: vendor.subcategory?.id ?? null,
    vendorGrade: vendor.vendorGrade,
    paymentMode: vendor.paymentMode,
    creditTerms: vendor.creditTerms,
    proposedPaymentTerms: vendor.proposedPaymentTerms,
    otherProductOrService: vendor.otherProductOrService,
    dateOfIncorporation: vendor.dateOfIncorporation,
    inFandVBusinessSince: vendor.inFandVBusinessSince,
    mainProduct: vendor.mainProduct?.id ?? null,
    listOfAllProducts: vendor.listOfAllProducts?.map(p => p.id) ?? [],
    mainPackingMaterial: vendor.mainPackingMaterial?.id ?? null,
    listOfPackingMaterial: vendor.listOfPackingMaterial?.map(p => p.id) ?? [],
    dispatchCenter: vendor.dispatchCenter,
    warehouseLocations: vendor.warehouseLocations,
    packingCenterLocation: vendor.packingCenterLocation,
    tradeLicenseNumber: vendor.tradeLicenseNumber,
    anyDetailsTeamAndInfra: vendor.anyDetailsTeamAndInfra,
    officeAddress: mapAddress(vendor.officeAddress),
    officeContactNo: vendor.officeContactNo,
    officeEmail: vendor.officeEmail,
    website: vendor.website,
    gstn: vendor.gstn, gstnCopy: vendor.gstnCopy, ifGstnCopy: vendor.ifGstnCopy,
    panNo: vendor.panNo, panCardCopy: vendor.panCardCopy, ifPanCardCopy: vendor.ifPanCardCopy,
    msmeNo: vendor.msmeNo, msmeCopy: vendor.msmeCopy, ifMsmeCopy: vendor.ifMsmeCopy,
    vendorSaleInfo: vendor.vendorSaleInfo ? {
      contactFName: vendor.vendorSaleInfo.contactFName,
      contactMName: vendor.vendorSaleInfo.contactMName,
      contactLName: vendor.vendorSaleInfo.contactLName,
      directContactNumber: vendor.vendorSaleInfo.directContactNumber,
      mobileNumber: vendor.vendorSaleInfo.mobileNumber,
      email: vendor.vendorSaleInfo.email,
    } : null,
    vendorBankDetails: vendor.vendorBankDetails ? {
      beneficiaryFName: vendor.vendorBankDetails.beneficiaryFName,
      beneficiaryMName: vendor.vendorBankDetails.beneficiaryMName,
      beneficiaryLName: vendor.vendorBankDetails.beneficiaryLName,
      bankName: vendor.vendorBankDetails.bankName,
      bankCompanyName:vendor.vendorBankDetails.bankCompanyName,
      typeOfAcc: vendor.vendorBankDetails.typeOfAcc,
      ifscCode: vendor.vendorBankDetails.ifscCode,
      swiftNo: vendor.vendorBankDetails.swiftNo,
      invoiceCurrency: vendor.vendorBankDetails.invoiceCurrency,
      cancelledChequeCopy: vendor.vendorBankDetails.cancelledChequeCopy,
      ifCancelledCheque: vendor.vendorBankDetails.ifCancelledCheque,
      branchAddress: mapAddress(vendor.vendorBankDetails.branchAddress),
    } : null,
    ref1FName: vendor.ref1FName, ref1MName: vendor.ref1MName, ref1LName: vendor.ref1LName,
    ref1PrimaryCNumb: vendor.ref1PrimaryCNumb, ref1AltrCNumb: vendor.ref1AltrCNumb,
    ref1Email: vendor.ref1Email, ref1Address: mapAddress(vendor.ref1Address),
    ref2FName: vendor.ref2FName, ref2MName: vendor.ref2MName, ref2LName: vendor.ref2LName,
    ref2PrimaryCNumb: vendor.ref2PrimaryCNumb, ref2AltrCNumb: vendor.ref2AltrCNumb,
    ref2Email: vendor.ref2Email, ref2Address: mapAddress(vendor.ref2Address),
    createdBy: vendor.createdBy?.id ?? null,
    createdDate,
    createdTime,
  };

  await this.cacheService.set(key, formattedResult, CACHE_TTL_DETAIL);
  return formattedResult;
}
// ─── Excel Export / Import ────────────────────────────────────────────────

  /**
   * Every vendor the user is allowed to see, matching the list-page filters,
   * as an Excel file stored in Spaces.
   *
   * The same visibility rules as the list endpoint apply: a non-privileged user
   * exports only the vendors they created, and a verifier never sees drafts.
   */
  async exportToExcel(
    options: PaginationOptions,
    userId: string,
  ): Promise<UploadedExport> {
    const user = await this.userRepository.findOneBy({ id: userId });
    const isAdmin = user?.roles?.includes(Role.ADMIN);
    const isVerifier = user?.roles?.includes(Role.VERIFIER);
    const isPrivileged = isAdmin || isVerifier;

    const queryBuilder = this.vendorRepository
      .createQueryBuilder('vendor')
      .leftJoinAndSelect('vendor.createdBy', 'createdBy')
      .leftJoinAndSelect('vendor.category', 'category')
      .leftJoinAndSelect('vendor.subcategory', 'subcategory')
      .leftJoinAndSelect('vendor.officeAddress', 'officeAddress')
      .leftJoinAndSelect('vendor.mainProduct', 'mainProduct')
      .leftJoinAndSelect('vendor.listOfAllProducts', 'listOfAllProducts')
      .leftJoinAndSelect('vendor.mainPackingMaterial', 'mainPackingMaterial')
      .leftJoinAndSelect('vendor.listOfPackingMaterial', 'listOfPackingMaterial')
      .leftJoinAndSelect('vendor.vendorSaleInfo', 'vendorSaleInfo')
      .leftJoinAndSelect('vendor.vendorBankDetails', 'vendorBankDetails')
      .leftJoinAndSelect('vendorBankDetails.branchAddress', 'branchAddress')
      .leftJoinAndSelect('vendor.ref1Address', 'ref1Address')
      .leftJoinAndSelect('vendor.ref2Address', 'ref2Address')
      .orderBy('vendor.createdAt', 'DESC');

    if (!isPrivileged) {
      queryBuilder.where('createdBy.id = :userId', { userId });
    }

    if (isVerifier && !isAdmin) {
      queryBuilder.andWhere('vendor.status != :draft', { draft: Status.DRAFT });
    }

    applyMasterFilters(queryBuilder, VENDOR_FILTERS, options.masterFilters);

    const { data } = await buildQuery(
      queryBuilder,
      { ...options, page: undefined, limit: undefined },
      'vendor',
    );

    const lists = this.vendorWorkbookLists(await this.loadVendorLinkIndexes());
    const workbook = buildDataWorkbook(VENDOR_SHEET, data as Vendor[], lists);
    return uploadWorkbookToSpaces(workbook, 'Vendors', data.length);
  }

  /**
   * Blank workbook carrying exactly the headers the importer reads, generated
   * from the same column map as the export.
   */
  async buildExcelTemplate(): Promise<UploadedExport> {
    const lists = this.vendorWorkbookLists(await this.loadVendorLinkIndexes());
    const workbook = buildTemplateWorkbook(VENDOR_SHEET, lists);
    return uploadWorkbookToSpaces(workbook, 'Vendor_Template', 0);
  }

  /**
   * The masters a vendor links to, each loaded once per file, so a sheet of a
   * few thousand vendors is matched in memory rather than with queries per row.
   */
  private async loadVendorLinkIndexes() {
    const live = <T extends { isDeleted?: boolean }>(records: T[]) =>
      records.filter((record) => !record.isDeleted);

    const [categories, subcategories, products, materials] = await Promise.all([
      this.vendorCategoryRepository.find(),
      this.vendorSubcategoryRepository.find({ relations: ['category'] }),
      this.productRepository.find({ select: { id: true, name: true, isDeleted: true } }),
      this.packingMaterialRepository.find(),
    ]);

    return {
      categories: LookupIndex.fromRecords(live(categories), { names: (c) => [c.name] }),
      subcategories: LookupIndex.fromRecords(live(subcategories), {
        names: (s) => [s.name],
        scope: (s) => s.category?.id ?? null,
      }),
      products: LookupIndex.fromRecords(live(products), { names: (p) => [p.name] }),
      // Scoped by Use For: the same name can exist for purchase and for sale.
      packingMaterials: LookupIndex.fromRecords(live(materials), {
        names: (m) => [m.packagingMaterialName],
        scope: (m) => m.useFor ?? null,
      }),
    };
  }

  /** Current master names for the dropdowns in the template and the export. */
  private vendorWorkbookLists(
    indexes: Awaited<ReturnType<VendorService['loadVendorLinkIndexes']>>,
  ): WorkbookLists {
    return {
      'vendor-category': indexes.categories.displayNames(),
      'vendor-subcategory': indexes.subcategories.displayNames(),
      product: indexes.products.displayNames(),
      'packaging-material': indexes.packingMaterials.displayNames(),
    };
  }

  /**
   * Matches every linked column of a vendor row, leaving what does not match
   * empty and noting it in `draft`. Only links the vendor does not have yet are
   * set, so the same code completes a draft vendor on a re-import.
   */
  private applyVendorLinks(
    vendor: Vendor,
    row: ExcelRow,
    text: (row: ExcelRow, header: string) => string | null,
    indexes: Awaited<ReturnType<VendorService['loadVendorLinkIndexes']>>,
    draft: DraftLinks,
    options: { categoryRequired?: boolean } = {},
  ): void {
    if (!vendor.category) {
      vendor.category = draft.one(indexes.categories, 'Vendor Category', text(row, 'Vendor Category'), {
        required: options.categoryRequired ?? true,
      }) as VendorCategory;
    }

    const subcategoryName = text(row, 'Vendor Subcategory');
    if (!vendor.subcategory && subcategoryName) {
      if (vendor.category) {
        vendor.subcategory = draft.one(indexes.subcategories, 'Vendor Subcategory', subcategoryName, {
          scope: vendor.category.id,
        }) as VendorSubcategory;
      } else {
        draft.note('Vendor Subcategory', subcategoryName, 'its Vendor Category did not match');
      }
    }

    if (!vendor.mainProduct) {
      vendor.mainProduct = draft.one(indexes.products, 'Main Product', text(row, 'Main Product')) as Product;
    }
    const productNames = toList(row.raw('List Of All Products'));
    if (!vendor.listOfAllProducts?.length && productNames.length) {
      vendor.listOfAllProducts = draft.many(indexes.products, 'List Of All Products', productNames);
    }

    // Vendors supply what is bought, so where a name exists both for purchase
    // and for sale the For Purchase one is taken.
    const packing = (field: string, name: string | null): PackingMaterial | null =>
      (name && indexes.packingMaterials.match(name, UseFor.PURCHASE)) ||
      draft.one(indexes.packingMaterials, field, name);

    if (!vendor.mainPackingMaterial) {
      vendor.mainPackingMaterial = packing('Main Packing Material', text(row, 'Main Packing Material')) as PackingMaterial;
    }
    const materialNames = toList(row.raw('List Of Packing Material'));
    if (!vendor.listOfPackingMaterial?.length && materialNames.length) {
      const materials: PackingMaterial[] = [];
      for (const name of materialNames) {
        const material = packing('List Of Packing Material', name);
        if (material && !materials.includes(material)) materials.push(material);
      }
      vendor.listOfPackingMaterial = materials;
    }
  }

  /**
   * Imports vendors from a spreadsheet uploaded to Spaces
   * (docs/registration-import-plan.md, decisions agreed 2026-11-04).
   *
   * Row by row, so one bad row never costs the rest of the file (D1). Every
   * vendor the import saves is a **draft** (D2): the admin checks it and submits
   * it from the form. A cell the form would refuse - a bad mobile, GSTIN or
   * date, or a mobile / email another vendor already has - and a linked name
   * that does not match are left empty and listed in the report (D4, D5).
   *
   * A row with the Vendor Code of a draft vendor updates it: filled cells replace
   * what is saved, empty cells keep it (D3). Vendors past draft are not changed
   * by an import (D6). A new row whose company name is already on record is
   * skipped. `checkOnly` runs every check and saves nothing.
   *
   * The uploaded file is removed from Spaces once read, success or failure.
   */
  async createVendorWithExcel(
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
      await assertImportPrerequisites('vendor', countMasterRecords);

      const sheet = await readUploadedSheet(fileUrl, VENDOR_SHEET);
      summary.unknownColumns = sheet.unknownColumns;
      summary.missingColumns = sheet.missingColumns;
      summary.totalRows = sheet.rows.length;

      if (sheet.missingColumns.length) {
        throw new AppError(
          400,
          `The uploaded file is missing required column(s): ${sheet.missingColumns.join(', ')}`,
        );
      }

      const creator = await this.userRepository.findOneBy({ id: createdById });
      if (!creator) {
        throw new AppError(401, 'The logged-in user could not be found');
      }

      const linkIndexes = await this.loadVendorLinkIndexes();

      // Existing vendors by name (case, spacing and punctuation ignored) and by
      // code, and every mobile / email in use, loaded once; rows of this file
      // are added as they go.
      const existingVendors = await this.vendorRepository.find({ relations: ['vendorSaleInfo'] });
      const byName = new Map<string, string>();
      const byCode = new Map<string, Vendor>();
      const contacts = new ContactPool();
      for (const existing of existingVendors) {
        const owner = { key: existing.id, label: vendorLabel(existing) };
        if (existing.companyName) byName.set(normaliseName(existing.companyName), owner.label);
        if (existing.vendorCode) byCode.set(existing.vendorCode.toUpperCase(), existing);
        contacts.add('phone', existing.officeContactNo, owner);
        contacts.add('email', existing.officeEmail, owner);
        contacts.add('phone', existing.vendorSaleInfo?.directContactNumber, owner);
        contacts.add('phone', existing.vendorSaleInfo?.mobileNumber, owner);
        contacts.add('email', existing.vendorSaleInfo?.email, owner);
      }

      const codeColumn = VENDOR_SHEET.columns.find((c) => c.header === 'Vendor Code')!;

      for (const row of sheet.rows) {
        try {
          const draft = new DraftLinks();
          const vendorCode = row.cell<string | null>(codeColumn);

          // ── A draft vendor named by its code: update it ────────────────
          if (vendorCode) {
            const known = byCode.get(vendorCode.toUpperCase());
            if (!known) {
              summary.skipped.push({
                row: row.rowNumber,
                reason: `Vendor Code ${vendorCode} was not found - clear it to add the row as a new vendor`,
              });
              continue;
            }
            if (known.status !== Status.DRAFT) {
              summary.skipped.push({
                row: row.rowNumber,
                reason: `Vendor ${vendorCode} is ${known.status} - an import only changes draft vendors; edit it in the form`,
              });
              continue;
            }

            const target = await this.vendorRepository.findOne({
              where: { id: known.id },
              relations: [
                'category', 'subcategory', 'mainProduct', 'listOfAllProducts',
                'mainPackingMaterial', 'listOfPackingMaterial', 'vendorSaleInfo',
                'vendorBankDetails', 'vendorBankDetails.branchAddress',
                'officeAddress', 'ref1Address', 'ref2Address',
              ],
            });
            if (!target) throw new Error(`Vendor ${vendorCode} could not be loaded`);

            const reader = new RegistrationRowReader(VENDOR_SHEET, row, draft, {
              contacts,
              ownerKey: target.id,
            });
            const incoming = this.vendorFromRow(reader, linkIndexes, { isNew: false });

            // A new name must not be another vendor's
            const newName = incoming.companyName;
            if (newName && normaliseName(newName) !== normaliseName(target.companyName ?? '')) {
              const holder = byName.get(normaliseName(newName));
              if (holder) {
                draft.note('Company Name', newName, `Kept the saved name: already used by ${holder}`);
                delete (incoming as Partial<Vendor>).companyName;
              }
            }

            mergeFilled(target, incoming);
            target.status = Status.DRAFT;
            if (!checkOnly) await this.vendorRepository.save(target);

            summary.updated++;
            if (draft.isDraft) summary.drafted++;
            summary.draftIssues.push(...draft.toReport(row.rowNumber, target.vendorCode, target.companyName));
            reader.registerContacts({ key: target.id, label: vendorLabel(target) });
            if (target.companyName) byName.set(normaliseName(target.companyName), vendorLabel(target));
            continue;
          }

          // ── A new vendor ───────────────────────────────────────────────
          const ownerKey = `row-${row.rowNumber}`;
          const reader = new RegistrationRowReader(VENDOR_SHEET, row, draft, { contacts, ownerKey });
          const companyName = reader.text('Company Name');
          if (!companyName) {
            summary.skipped.push({ row: row.rowNumber, reason: 'Company Name is empty' });
            continue;
          }
          const existing = byName.get(normaliseName(companyName));
          if (existing) {
            summary.skipped.push({
              row: row.rowNumber,
              reason: `Vendor "${companyName}" already exists (${existing})`,
            });
            continue;
          }

          const vendor = this.vendorFromRow(reader, linkIndexes, { isNew: true });
          reader.noteMissingRequired(['Company Name']);
          vendor.status = Status.DRAFT;
          vendor.createdBy = creator;

          let saved: Vendor = vendor;
          if (!checkOnly) {
            vendor.vendorCode = await this.generateBulkVendorCode();
            saved = await this.vendorRepository.save(vendor);
          }

          summary.created++;
          if (draft.isDraft) summary.drafted++;
          summary.draftIssues.push(...draft.toReport(row.rowNumber, saved.vendorCode ?? null, companyName));
          const owner = {
            key: saved.id ?? ownerKey,
            label: saved.vendorCode ? vendorLabel(saved) : `row ${row.rowNumber}`,
          };
          reader.registerContacts(owner);
          byName.set(normaliseName(companyName), owner.label);
          if (saved.vendorCode) byCode.set(saved.vendorCode.toUpperCase(), saved);
        } catch (rowError: any) {
          summary.failed.push({
            row: row.rowNumber,
            reason: rowError?.message ?? 'Could not save this row',
          });
        }
      }

      if (!checkOnly && (summary.created > 0 || summary.updated > 0)) {
        await this.invalidateVendorCache();
      }

      await attachImportReport(summary, 'Vendor');
      return summary;
    } finally {
      await deleteFromSpaces(fileUrl);
    }
  }

  /**
   * A Vendor built from one row - every cell through the column rules - with its
   * links matched. Used as the new vendor, or merged onto a draft (only what is
   * filled). `isNew`: a blank Vendor Category is then reported as required.
   */
  private vendorFromRow(
    reader: RegistrationRowReader,
    indexes: Awaited<ReturnType<VendorService['loadVendorLinkIndexes']>>,
    options: { isNew: boolean },
  ): Vendor {
    const text = (header: string) => reader.text(header) as string;
    const vendor = new Vendor();
    vendor.companyName = text('Company Name');

    this.applyVendorLinks(vendor, reader.row, (_row, header) => reader.text(header), indexes, reader.draft, {
      categoryRequired: options.isNew,
    });

    // ── Company details ─────────────────────────────────────────────────
    vendor.classification = reader.value<VendorClassification>('Classification') as VendorClassification;
    vendor.vendorGrade = text('Vendor Grade');
    vendor.officeContactNo = text('Office Contact No');
    vendor.officeEmail = text('Office Email');
    vendor.website = text('Website');
    vendor.inFandVBusinessSince = text('In F&V Business Since');
    vendor.dateOfIncorporation = reader.date('Date Of Incorporation') as Date;

    vendor.gstn = text('GSTIN');
    vendor.panNo = text('PAN Number');
    vendor.msmeNo = text('MSME Number');
    vendor.tradeLicenseNumber = text('Trade Licence Number');

    vendor.creditTerms = reader.number('Credit Terms') as number;
    vendor.proposedPaymentTerms = reader.number('Proposed Payment Terms') as number;
    vendor.paymentMode = text('Payment Mode');

    vendor.dispatchCenter = text('Dispatch Center');
    vendor.warehouseLocations = text('Warehouse Locations');
    vendor.packingCenterLocation = text('Packing Center Location');
    vendor.otherProductOrService = text('Other Product Or Service');
    vendor.anyDetailsTeamAndInfra = text('Any Other Details Regarding Team And Infrastructure');

    // ── Addresses ───────────────────────────────────────────────────────
    vendor.officeAddress = this.addressFromRow(reader, (part) => `Office ${part}`);
    vendor.ref1Address = this.addressFromRow(reader, (part) => `Reference 1 ${part}`);
    vendor.ref2Address = this.addressFromRow(reader, (part) => `Reference 2 ${part}`);

    // ── Sales contact ───────────────────────────────────────────────────
    const contact = new VendorSaleInfo();
    contact.contactFName = text('Contact First Name');
    contact.contactMName = text('Contact Middle Name');
    contact.contactLName = text('Contact Last Name');
    contact.directContactNumber = text('Direct Contact Number');
    contact.mobileNumber = text('Mobile Number');
    contact.email = text('Email');
    vendor.vendorSaleInfo = contact;

    // ── Bank details ────────────────────────────────────────────────────
    const bank = new BankDetailsvend();
    bank.beneficiaryFName = text('Beneficiary First Name');
    bank.beneficiaryMName = text('Beneficiary Middle Name');
    bank.beneficiaryLName = text('Beneficiary Last Name');
    bank.bankCompanyName = text('Bank Company Name');
    bank.bankName = text('Bank Name');
    bank.typeOfAcc = reader.value<AccountType>('Account Type') as AccountType;
    bank.ifscCode = text('IFSC Code');
    bank.swiftNo = text('SWIFT Code');
    bank.invoiceCurrency = text('Invoice Currency');
    bank.branchAddress = this.addressFromRow(reader, (part) => `Branch ${part}`);
    vendor.vendorBankDetails = bank;

    // ── References ──────────────────────────────────────────────────────
    vendor.ref1FName = text('Reference 1 First Name');
    vendor.ref1MName = text('Reference 1 Middle Name');
    vendor.ref1LName = text('Reference 1 Last Name');
    vendor.ref1PrimaryCNumb = text('Reference 1 Primary Contact No');
    vendor.ref1AltrCNumb = text('Reference 1 Alternative Contact No');
    vendor.ref1Email = text('Reference 1 Email');

    vendor.ref2FName = text('Reference 2 First Name');
    vendor.ref2MName = text('Reference 2 Middle Name');
    vendor.ref2LName = text('Reference 2 Last Name');
    vendor.ref2PrimaryCNumb = text('Reference 2 Primary Contact No');
    vendor.ref2AltrCNumb = text('Reference 2 Alternative Contact No');
    vendor.ref2Email = text('Reference 2 Email');

    return vendor;
  }

  /** One Address from the columns `header(part)` names, e.g. "Office City". */
  private addressFromRow(reader: RegistrationRowReader, header: (part: string) => string): Address {
    const address = new Address();
    address.address1 = reader.text(header('Address1')) as string;
    address.address2 = reader.text(header('Address2')) as string;
    address.location = reader.text(header('Location')) as string;
    address.city = reader.text(header('City')) as string;
    address.state = reader.text(header('State')) as string;
    address.pincode = reader.text(header('Pincode')) as string;
    return address;
  }

  /**
   * Next vendor code in the VENDOR<year>NNNN series, derived from the highest
   * existing code so codes are not reused after a vendor is deleted.
   */
  private async generateBulkVendorCode(): Promise<string> {
    const prefix = `VENDOR${new Date().getFullYear()}`;

    const last = await this.vendorRepository
      .createQueryBuilder('vendor')
      .where('vendor.vendorCode LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('vendor.vendorCode', 'DESC')
      .getOne();

    let next = 1;
    if (last?.vendorCode) {
      const lastNumber = parseInt(last.vendorCode.slice(prefix.length), 10);
      if (!Number.isNaN(lastNumber)) next = lastNumber + 1;
    }

    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  /**
   * Get available users for reference when uploading vendor data
   */

  //   const key = `${CACHE_PREFIX}:ref:users`;
  //   const cached = await this.cacheService.get<any>(key);
  //   if (cached) return cached;

  //   const users = await this.userRepository
  //     .createQueryBuilder('user')
  //     .select(['user.id', 'user.firstName', 'user.lastName'])
  //     .orderBy('user.firstName', 'ASC')
  //     .getMany();
    
  //   const result = users.map(user => ({ id: user.id, name: `${user.firstName} ${user.lastName}` }));
  //   await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
  //   return result;
  // }


//  public async getAllVendors1(queryOptions: PaginationOptions): Promise<any> {
//   const queryBuilder = this.vendorRepository
//     .createQueryBuilder('vendor')
//     .leftJoinAndSelect('vendor.createdBy', 'createdBy') // ✅ include who created
//     .leftJoinAndSelect('vendor.officeAddress', 'officeAddress')
//     .leftJoinAndSelect('vendor.vendorSaleInfo', 'vendorSaleInfo')
//     .leftJoinAndSelect('vendor.vendorBankDetails', 'vendorBankDetails')
//     .leftJoinAndSelect('vendor.ref1Address', 'ref1Address')
//     .leftJoinAndSelect('vendor.ref2Address', 'ref2Address')
//     .leftJoinAndSelect('vendor.subcategory', 'subcategory')
//     .leftJoinAndSelect('vendor.category', 'category')
//     .orderBy('vendor.createdAt', 'DESC');

//   const vendors = await buildQuery(queryBuilder, queryOptions, 'vendor');

  
//   const formattedData = vendors.data.map((vendor: any) => {
//     const { createdDate, createdTime } = formatDateTime(vendor.createdAt);

//     return {
//       ...vendor,
//       createdBy: `${vendor.createdBy?.firstName ?? ''} ${vendor.createdBy?.lastName ?? ''}`.trim(),
        
//       createdDate,
//       createdTime,
//       //createdAt: createdDate && createdTime ? `${createdDate} ${createdTime}` : null,
//     };
//   });

//   return {
//     ...vendors,
//     data: formattedData,
//   };
// }

public async getAllVendors1(queryOptions: PaginationOptions, userId: string): Promise<VendorListResponseDto> {
  // Fetch the user to check their role
  const user = await this.userRepository.findOneBy({ id: userId });
  const isAdmin = user?.roles?.includes(Role.ADMIN);
  const isVerifier = user?.roles?.includes(Role.VERIFIER);
  const isPrivileged = isAdmin || isVerifier;

  // Include userId in cache key so different users don't share results
  const hash = createHash('md5').update(JSON.stringify(queryOptions)).digest('hex');
  const key = `${CACHE_PREFIX}:list:${userId}:${hash}`;
  const cached = await this.cacheService.get<any>(key);
  if (cached) return cached;

  const queryBuilder = this.vendorRepository
    .createQueryBuilder('vendor')
    .leftJoin('vendor.createdBy', 'createdBy')
    .leftJoin('vendor.officeAddress', 'officeAddress')
    .leftJoin('vendor.mainProduct', 'mainProduct')
    .leftJoin('vendor.listOfAllProducts', 'listOfAllProducts')
    .leftJoin('vendor.mainPackingMaterial', 'mainPackingMaterial')
    .leftJoin('vendor.listOfPackingMaterial', 'listOfPackingMaterial')
    .leftJoin('vendor.subcategory', 'subcategory')
    .leftJoin('vendor.category', 'category')
    .select([
      'vendor.id', 'vendor.status', 'vendor.vendorCode', 'vendor.companyName',
      'vendor.officeContactNo', 'vendor.officeEmail', 'vendor.gstn', 'vendor.panNo',
      'vendor.msmeNo', 'vendor.tradeLicenseNumber', 'vendor.paymentMode',
      'vendor.proposedPaymentTerms', 'vendor.creditTerms', 'vendor.dispatchCenter',
      'vendor.warehouseLocations', 'vendor.packingCenterLocation', 'vendor.classification',
      'vendor.createdAt',
      'createdBy.firstName', 'createdBy.lastName',
      'officeAddress.location', 'officeAddress.city', 'officeAddress.state', 'officeAddress.pincode',
      'mainProduct.name',
      'listOfAllProducts.name',
      'mainPackingMaterial.packagingMaterialName',
      'listOfPackingMaterial.packagingMaterialName',
      'subcategory.name',
      'category.name',
    ])
    .orderBy('vendor.createdAt', 'DESC');

  // Visibility rules:
  // - Employee/other: only their own records (drafts included)
  // - Verifier (non-admin): all records except drafts
  // - Admin: all records; own drafts visible, others' drafts hidden
  if (!isPrivileged) {
    // Employee → only own records (all statuses)
    queryBuilder.where('createdBy.id = :userId', { userId });
  } else if (isVerifier && !isAdmin) {
    // Pure Verifier → everyone's records, no drafts at all
    queryBuilder.where('vendor.status != :draft', { draft: Status.DRAFT });
  } else if (isAdmin) {
    // Admin → everyone's records; own drafts visible, others' drafts hidden
    queryBuilder.where(
      '(vendor.status != :draft OR createdBy.id = :userId)',
      { draft: Status.DRAFT, userId },
    );
  }

  applyMasterFilters(queryBuilder, VENDOR_FILTERS, queryOptions.masterFilters);

  const vendors = await buildQuery(queryBuilder, queryOptions, 'vendor');

  const formattedData = vendors.data.map((vendor) => {
    const { createdDate, createdTime } = formatDateTime(vendor.createdAt);
    return {
      id: vendor.id,
      status: vendor.status,
      vendorCode: vendor.vendorCode?.toUpperCase() ?? '',
      companyName: vendor.companyName,
      category: vendor.category?.name ?? '',
      subcategory: vendor.subcategory?.name ?? '',
      officeAddress: vendor.officeAddress ? formatAddress(vendor.officeAddress) : '',
      officeContactNo: vendor.officeContactNo,
      officeEmail: vendor.officeEmail,
      gstn: vendor.gstn?.toUpperCase() ?? '',
      panNo: vendor.panNo?.toUpperCase() ?? '',
      msmeNo: vendor.msmeNo?.toUpperCase() ?? '',
      tradeLicenseNumber: vendor.tradeLicenseNumber?.toUpperCase() ?? '',
      paymentMode: vendor.paymentMode,
      proposedPaymentTerms: vendor.proposedPaymentTerms,
      creditTerms: vendor.creditTerms,
      dispatchCenter: vendor.dispatchCenter,
      warehouseLocations: vendor.warehouseLocations,
      packingCenterLocation: vendor.packingCenterLocation,
      classification: vendor.classification,
      mainProduct: vendor.mainProduct?.name ?? '',
      listOfAllProducts: vendor.listOfAllProducts?.map((p: Product) => p.name).join(',') ?? '',
      mainPackingMaterial: vendor.mainPackingMaterial?.packagingMaterialName ?? null,
      listOfPackingMaterial: vendor.listOfPackingMaterial?.map((p: PackingMaterial) => p.packagingMaterialName).join(',') ?? '',
      createdBy: `${vendor.createdBy?.firstName ?? ''} ${vendor.createdBy?.lastName ?? ''}`.trim(),
      createdDate,
      createdTime,
    };
  });

  const result = { ...vendors, data: formattedData };
  await this.cacheService.set(key, result, CACHE_TTL);
  return result;
}


  
  public async getAllVendor(subcategoryId?: string): Promise<VendorDropdownDto[]> {
    const key = `${CACHE_PREFIX}:dropdown:${subcategoryId || 'all'}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.vendorRepository
      .createQueryBuilder("vendor")
      .leftJoinAndSelect("vendor.officeAddress", "officeAddress")
      .leftJoinAndSelect("vendor.vendorSaleInfo", "vendorSaleInfo")

      .leftJoinAndSelect("vendor.category", "category") // Fixed extra space
      .leftJoin("vendor.subcategory", "subcategory")
      .select([
        "vendor.id",
        "vendor.companyName",
        "vendor.officeContactNo",
        "vendor.email",
        "category.id",
        "subcategory.id",
        "vendor.vendorCode",
        "officeAddress.id",
        "officeAddress.address1",
        "officeAddress.address2",
        "officeAddress.location",
        "officeAddress.city",
        "officeAddress.state",
        "officeAddress.pincode",
        "vendorSaleInfo.contactFName",
        "vendorSaleInfo.contactMName",
        "vendorSaleInfo.contactLName",
      ]);

    // Add the filter condition if subcategoryId is provided
    if (subcategoryId) {
      queryBuilder.where("subcategory.id = :subcategoryId", { subcategoryId });
    }

    // Fetch data from the database
    const vendors = await queryBuilder.getMany();

    // Map the results to the desired format
    const result = vendors.map((vendor) => ({
      id: vendor.id,
      companyName: vendor.companyName,
      vendorCode: vendor.vendorCode,
      officeContactNo: vendor.officeContactNo,
      email: vendor.officeEmail,
      subcategory: vendor.subcategory?.id || null,
      category: vendor.category?.id || null,
      contactPersonName: vendor.vendorSaleInfo
        ? `${vendor.vendorSaleInfo.contactFName || ""} ${
            vendor.vendorSaleInfo.contactMName || ""
          } ${vendor.vendorSaleInfo.contactLName || ""}`.trim()
        : null,
      officeAddress: vendor.officeAddress
        ? {
            address1: vendor.officeAddress.address1,
            address2: vendor.officeAddress.address2,
            location: vendor.officeAddress.location,
            city: vendor.officeAddress.city,
            state: vendor.officeAddress.state,
            pincode: vendor.officeAddress.pincode,
          }
        : null,
    }));
    await this.cacheService.set(key, result, CACHE_TTL);
    return result;
  }






  async getAllVendors(): Promise<Vendor[]> {
    return this.vendorRepository
      .createQueryBuilder("vendor")
      .leftJoinAndSelect("vendor.officeAddress", "officeAddress")
      .leftJoinAndSelect("vendor.vendorSaleInfo", "vendorSaleInfo")
      .orderBy("vendor.createdAt", "DESC")
      .getMany();
  }




  public async updateVendor(
    id: string,
    vendorData: UpdateVendorDto & Record<string, any>,
    updateBy: string
  ): Promise<Vendor | null> {
    const vendor = await this.vendorRepository
      .createQueryBuilder("vendor")
      .leftJoinAndSelect("vendor.officeAddress", "officeAddress")
      .leftJoinAndSelect("vendor.ref1Address", "ref1Address")
      .leftJoinAndSelect("vendor.ref2Address", "ref2Address")
      .leftJoinAndSelect("vendor.vendorSaleInfo", "vendorSaleInfo")
      .leftJoinAndSelect("vendor.vendorBankDetails", "vendorBankDetails")
      .leftJoinAndSelect("vendor.mainProduct", "mainProduct")
      .leftJoinAndSelect("vendor.listOfAllProducts", "listOfAllProducts")
      .leftJoinAndSelect("vendor.mainPackingMaterial", "mainPackingMaterial")
      .leftJoinAndSelect("vendor.listOfPackingMaterial", "listOfPackingMaterial")
      .leftJoinAndSelect("vendor.subcategory", "subcategory")
      .leftJoinAndSelect("vendor.category", "category")
      .where("vendor.id = :id", { id })
      .getOne();

    if (!vendor) return null;

    // ---- Addresses ----
    if (vendorData.officeAddress) {
      vendor.officeAddress = {
        ...vendor.officeAddress,
        ...vendorData.officeAddress,
      } as Address;
    }

    if (vendorData.ref1Address) {
      vendor.ref1Address = {
        ...vendor.ref1Address,
        ...vendorData.ref1Address,
      } as Address;
    }

    if (vendorData.ref2Address) {
      vendor.ref2Address = {
        ...vendor.ref2Address,
        ...vendorData.ref2Address,
      } as Address;
    }

    // ---- Sale Info ----
    if (vendorData.vendorSaleInfo) {
      vendor.vendorSaleInfo = {
        ...vendor.vendorSaleInfo,
        ...vendorData.vendorSaleInfo,
      } as VendorSaleInfo;
    }

    // ---- Bank Details ----
    if (vendorData.vendorBankDetails) {
      vendor.vendorBankDetails = {
        ...vendor.vendorBankDetails,
        ...vendorData.vendorBankDetails,
      } as BankDetailsvend;
    }

    // ---- Main Product ----
    if (vendorData.mainProduct) {
      const mainProductId = (vendorData.mainProduct as any)?.id || vendorData.mainProduct;
      if (mainProductId && typeof mainProductId === 'string') {
        const foundProduct = await this.productRepository.findOneBy({ id: mainProductId });
        if (foundProduct) vendor.mainProduct = foundProduct;
      }
    }

    // ---- List of All Products ----
    if (vendorData.listOfAllProducts?.length) {
      const productIds = vendorData.listOfAllProducts.map((p: any) => p?.id || p).filter(Boolean);
      vendor.listOfAllProducts = await this.productRepository.findBy({
        id: In(productIds),
      });
    }

    // ---- Main Packing Material ----
    if ((vendorData as any).mainPackingMaterial) {
      const pmId = (vendorData as any).mainPackingMaterial?.id || (vendorData as any).mainPackingMaterial;
      if (pmId && typeof pmId === 'string') {
        const foundPM = await this.packingMaterialRepository.findOneBy({ id: pmId });
        if (foundPM) vendor.mainPackingMaterial = foundPM;
      }
    }

    // ---- List of Packing Materials ----
    if ((vendorData as any).listOfPackingMaterial?.length) {
      const pmIds = (vendorData as any).listOfPackingMaterial.map((p: any) => p?.id || p).filter(Boolean);
      vendor.listOfPackingMaterial = await this.packingMaterialRepository.findBy({ id: In(pmIds) });
    }

    // ---- Category / Subcategory ----
    if ((vendorData as any).category) {
      const catId = (vendorData as any).category?.id || (vendorData as any).category;
      if (catId && typeof catId === 'string') {
        vendor.category = { id: catId } as any;
      }
    }
    if ((vendorData as any).subcategory) {
      const subId = (vendorData as any).subcategory?.id || (vendorData as any).subcategory;
      if (subId && typeof subId === 'string') {
        vendor.subcategory = { id: subId } as any;
      }
    }

    // ---- Simple fields ----
    // Exclude nested relation fields that were already handled above
    const {
      officeAddress,
      ref1Address,
      ref2Address,
      vendorSaleInfo,
      vendorBankDetails,
      mainProduct,
      listOfAllProducts,
      mainPackingMaterial,
      listOfPackingMaterial,
      subcategory,
      category,
      ...simpleFields
    } = vendorData as any;
    Object.assign(vendor, simpleFields);

    // Save everything
    const saved = await this.vendorRepository.save(vendor);
    await this.invalidateVendorCache(id);
    return saved;
  }


  async deleteVendor(id: string): Promise<boolean> {
    // Step 1: Find the vendor by ID
    const vendor = await this.vendorRepository.findOne({ where: { id } });

    // Step 2: If the vendor doesn't exist, return false
    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    // Step 3: Calculate the date 6 months ahead
    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6); // Adds 6 months to the current date
    sixMonthsFromNow.setHours(0, 0, 0, 0); // Optionally, set the time to midnight (00:00:00)

    // Log the scheduled deletion

    // Step 4: Set the deletionScheduledAt field and null out vendorCode
    // to free the unique constraint slot so the code is never re-blocked.
    vendor.deletionScheduledAt = sixMonthsFromNow;
    vendor.vendorCode = null as any;
    await this.vendorRepository.save(vendor);
    await this.invalidateVendorCache(id);
    return true;
  }




  async getAllVendorsbyfilter(queryOptions: PaginationOptions): Promise<any> {
    const hash = createHash('md5').update(JSON.stringify(queryOptions)).digest('hex');
    const key = `${CACHE_PREFIX}:filter:${hash}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.vendorRepository
    .createQueryBuilder("vendor")
    .leftJoinAndSelect("vendor.vendorSaleInfo", "vendorSaleInfo")
    .leftJoinAndSelect("vendor.officeAddress", "officeAddress")
    .leftJoinAndSelect("vendor.category", "category")
    .leftJoinAndSelect("vendor.subcategory", "subcategory")
    .leftJoin("vendor.createdBy", "createdBy")
    .select([
      "vendor.id",
      "vendor.companyName",
      "vendor.vendorCode",
      "vendor.officeContactNo",
      "vendor.officeEmail",
      "vendor.paymentMode",
      "vendor.proposedPaymentTerms",
      "vendor.creditTerms",
      "vendor.status",
      "createdBy.firstName",
      "createdBy.lastName",
      "category.name",
      "subcategory.name",
      "vendorSaleInfo.contactFName",
      "vendorSaleInfo.contactMName",
      "vendorSaleInfo.contactLName",
      "officeAddress.id",
      "officeAddress.address1",
      "officeAddress.address2",
      "officeAddress.location",
      "officeAddress.city",
      "officeAddress.state",
      "officeAddress.pincode",
    ]);

  // Use your reusable buildQuery function
  const result = await buildQuery(queryBuilder, queryOptions, "vendor");

  // Map final result with custom formatting
  const transformed = result.data.map((vendor: any) => ({
    id: vendor.id,
    companyName: vendor.companyName,
    vendorCode: vendor.vendorCode,
    officeContactNo: vendor.officeContactNo,
    officeEmail: vendor.officeEmail,
    status: vendor.status || null,
    createdBy: vendor.createdBy
      ? `${vendor.createdBy.firstName || ''} ${vendor.createdBy.lastName || ''}`.trim() || null
      : null,
    paymentMode: vendor.paymentMode || null,
    proposedPaymentTerms: vendor.proposedPaymentTerms || null,
    creditTerms: vendor.creditTerms || null,
    contactPersonName: vendor.vendorSaleInfo
      ? `${vendor.vendorSaleInfo.contactFName || ""} ${vendor.vendorSaleInfo.contactMName || ""} ${vendor.vendorSaleInfo.contactLName || ""}`.trim()
      : null,
    officeAddress: vendor.officeAddress,
    category: vendor.category?.name || null,
    subcategory: vendor.subcategory?.name || null,
  }));

  const finalResult = {
    data: transformed,
    meta: result.meta,
  };
  await this.cacheService.set(key, finalResult, CACHE_TTL);
  return finalResult;
}


  async getVendorByIdWithFilter(id: string): Promise<any> {
    const key = `${CACHE_PREFIX}:filter:id:v2:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const qb = this.vendorRepository
      .createQueryBuilder("vendor")
      .leftJoinAndSelect("vendor.vendorSaleInfo", "vendorSaleInfo")
      .leftJoinAndSelect("vendor.officeAddress", "officeAddress")
      .leftJoinAndSelect("vendor.category", "category")
      .leftJoinAndSelect("vendor.subcategory", "subcategory")
      .leftJoinAndSelect("vendor.createdBy", "createdBy")
      .select([
        "vendor.id",
        "vendor.companyName",
        "vendor.vendorCode",
        "vendor.officeContactNo",
        "vendor.officeEmail",
        "vendor.paymentMode",
        "vendor.proposedPaymentTerms",
        "vendor.creditTerms",
        "vendor.status",
        "category.name",
        "subcategory.name",
        "vendorSaleInfo.contactFName",
        "vendorSaleInfo.contactMName",
        "vendorSaleInfo.contactLName",
        "officeAddress.id",
        "officeAddress.address1",
        "officeAddress.address2",
        "officeAddress.location",
        "officeAddress.city",
        "officeAddress.state",
        "officeAddress.pincode",
        "createdBy.id",
        "createdBy.firstName",
        "createdBy.lastName",
      ]);

    if (isUuid) {
      qb.where("vendor.id = :id", { id });
    } else {
      qb.where("LOWER(vendor.companyName) = LOWER(:name)", { name: id });
    }

    const vendor = await qb.getOne();
    if (!vendor) return null;

    const result = {
      id: vendor.id,
      companyName: vendor.companyName,
      vendorCode: vendor.vendorCode,
      officeContactNo: vendor.officeContactNo,
      officeEmail: vendor.officeEmail,
      paymentMode: vendor.paymentMode ?? null,
      proposedPaymentTerms: vendor.proposedPaymentTerms ?? null,
      creditTerms: vendor.creditTerms ?? null,
      status: vendor.status ?? null,
      createdBy: vendor.createdBy
        ? `${vendor.createdBy.firstName || ""} ${vendor.createdBy.lastName || ""}`.trim()
        : null,
      contactPersonName: vendor.vendorSaleInfo
        ? `${vendor.vendorSaleInfo.contactFName || ""} ${
            vendor.vendorSaleInfo.contactMName || ""
          } ${vendor.vendorSaleInfo.contactLName || ""}`.trim()
        : null,
      officeAddress: vendor.officeAddress,
      category: vendor.category?.name || null,
      subcategory: vendor.subcategory?.name || null,
    };
    await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
    return result;
  }




  async getAllVendorsbyquery(filter: string): Promise<any[]> {
    const query = this.vendorRepository
      .createQueryBuilder("vendor")
      .leftJoinAndSelect("vendor.vendorSaleInfo", "vendorSaleInfo")
      .leftJoinAndSelect("vendor.officeAddress", "officeAddress")
      .leftJoinAndSelect("vendor.category", "category")
      .leftJoinAndSelect("vendor.subcategory", "subcategory")
      .select([
        "vendor.id",
        "vendor.companyName",
        "vendor.vendorCode",
        "vendor.officeContactNo",
        "vendor.officeEmail",
        "category.name",
        "subcategory.name",
        "vendorSaleInfo.contactFName",
        "vendorSaleInfo.contactMName",
        "vendorSaleInfo.contactLName",
        "officeAddress.id",
        "officeAddress.address1",
        "officeAddress.address2",
        "officeAddress.location",
        "officeAddress.city",
        "officeAddress.state",
        "officeAddress.pincode",
      ]);
  
    // Apply filtering only if 'filter' is provided
    if (filter) {
      query.where("vendor.companyName ILIKE :filter", { filter: `%${filter}%` });
    }
  
    const vendors = await query.getMany();
  
    return vendors.map((vendor) => ({
      id: vendor.id,
      companyName: vendor.companyName,
      vendorCode: vendor.vendorCode,
      officeContactNo: vendor.officeContactNo,
      officeEmail: vendor.officeEmail,
      contactPersonName: vendor.vendorSaleInfo
        ? `${vendor.vendorSaleInfo.contactFName || ""} ${
            vendor.vendorSaleInfo.contactMName || ""
          } ${vendor.vendorSaleInfo.contactLName || ""}`.trim()
        : null,
      officeAddress: vendor.officeAddress,
      category: vendor.category?.name || null,
      subcategory: vendor.subcategory?.name || null,
    }));
  }


async softDeleteVendors(vendorIds: string[]) {
  // Null out vendorCode before soft-deleting so the unique constraint
  // slot is freed and the code can be reused (or at least not block new inserts).
  await this.vendorRepository
    .createQueryBuilder()
    .update(Vendor)
    .set({ vendorCode: () => 'NULL' })
    .where('id IN (:...ids)', { ids: vendorIds })
    .execute();

  const result = await this.vendorRepository.softDelete({
    id: In(vendorIds)
  });
  await this.invalidateVendorCache();
  return result;
}



}


  // async getAllVendorsbyfilter(): Promise<any[]> {
  //   const vendors = await this.vendorRepository
  //     .createQueryBuilder("vendor")
  //     .leftJoinAndSelect("vendor.vendorSaleInfo", "vendorSaleInfo") // Fixed alias
  //     .leftJoinAndSelect("vendor.officeAddress", "officeAddress") // Fixed alias
  //     .leftJoinAndSelect("vendor.category", "category") // Fixed alias
  //     .leftJoinAndSelect("vendor.subcategory", "subcategory") // Fixed alias
  //     .select([
  //       "vendor.id",
  //       "vendor.companyName",
  //       "vendor.vendorCode",
  //       "vendor.officeContactNo",
  //       "vendor.officeEmail",
  //       "category.name",
  //       "subcategory.name",
  //       "vendorSaleInfo.contactFName",
  //       "vendorSaleInfo.contactMName",
  //       "vendorSaleInfo.contactLName",
  //       "officeAddress.id", // Ensure this alias matches the join
  //       "officeAddress.address1",
  //       "officeAddress.address2",
  //       "officeAddress.location",
  //       "officeAddress.city",
  //       "officeAddress.state",
  //       "officeAddress.pincode",
  //     ])
  //     .getMany();

  //   return vendors.map((vendor) => ({
  //     id: vendor.id,
  //     companyName: vendor.companyName,
  //     vendorCode: vendor.vendorCode,
  //     officeContactNo: vendor.officeContactNo,
  //     officeEmail: vendor.officeEmail,
  //     contactPersonName: vendor.vendorSaleInfo
  //       ? `${vendor.vendorSaleInfo.contactFName || ""} ${
  //           vendor.vendorSaleInfo.contactMName || ""
  //         } ${vendor.vendorSaleInfo.contactLName || ""}`.trim()
  //       : null,
  //     officeAddress: vendor.officeAddress,
  //     category: vendor.category || null,
  //     subcategory: vendor.subcategory?.name || null,
  //   }));
  // }


  // async createVendor(vendorDto: any): Promise<any> {
  //   // Create the new Vendor entity
  //   //vendorDto.officeAddress = JSON.parse(vendorDto.officeAddress);
  //   const newVendor = this.vendorRepository.create(vendorDto);
  //   // Save the new Vendor to the database
  //   return await this.vendorRepository.save(newVendor);
  // }

  // async updateVendor(
  //   id: string,
  //   vendorData: UpdateVendor,
  //   updatedBy: string
  // ): Promise<Vendor | null> {
  //   // Step 1: Retrieve the existing vendor to capture the original data
  //   const vendor = await this.vendorRepository.findOne({
  //     where: { id },
  //     relations: [
  //       "officeAddress",
  //       "vendorSaleInfo",
  //       "vendorBankDetails",
  //       "ref1Address",
  //       "ref2Address",
  //       "subcategory",
  //       "category",
  //     ],
  //   });

  //   if (!vendor) {
  //     throw new AppError(404, "Vendor not found");
  //   }

  //   // Step 2: Capture the original vendor data for audit purposes
  //   const originalVendor = { ...vendor };

  //   // Step 3: Update the address if provided
  //   if (vendorData.address) {
  //     if (vendor.officeAddress) {
  //       // Update existing address
  //       const updatedAddress = await this.addressService.update(
  //         vendor.officeAddress.id,
  //         vendorData.address
  //       );
  //     }
  //   }

  //   // Step 4: Update vendor fields
  //   Object.assign(vendor, vendorData);

  //   // Step 5: Save the updated vendor
  //   const updatedVendor = await this.vendorRepository.save(vendor);

  //   // Step 6: Log the change using the audit log service
  //   await this.auditLogService.logChange(
  //     "Vendor", // Entity name
  //     id, // Entity ID
  //     originalVendor, // Original data (before update)
  //     updatedVendor, // Updated data (after update)
  //     updatedBy // User who made the update
  //   );

  //   // Step 7: Return the updated vendor
  //   return updatedVendor;
  // }


  // async getAvailableUsers(): Promise<{ id: string; name: string }[]> {


  // /**
  //  * Get available products for reference when uploading vendor data
  //  */
  // async getAvailableProducts(): Promise<{ id: string; name: string }[]> {
  //   const key = `${CACHE_PREFIX}:ref:products`;
  //   const cached = await this.cacheService.get<any>(key);
  //   if (cached) return cached;

  //   const products = await this.productRepository
  //     .createQueryBuilder('product')
  //     .select(['product.id', 'product.name'])
  //     .orderBy('product.name', 'ASC')
  //     .getMany();
    
  //   const result = products.map(product => ({ id: product.id, name: product.name }));
  //   await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
  //   return result;
  // }


  // /**
  //  * Get available vendor subcategories for reference when uploading vendor data
  //  */
  // async getAvailableVendorSubcategories(categoryId?: string): Promise<{ id: string; name: string; categoryName: string }[]> {
  //   const key = `${CACHE_PREFIX}:ref:subcategories:${categoryId || 'all'}`;
  //   const cached = await this.cacheService.get<any>(key);
  //   if (cached) return cached;

  //   const queryBuilder = this.vendorSubcategoryRepository
  //     .createQueryBuilder('subcategory')
  //     .leftJoinAndSelect('subcategory.category', 'category')
  //     .select(['subcategory.id', 'subcategory.name', 'category.name'])
  //     .orderBy('category.name', 'ASC')
  //     .addOrderBy('subcategory.name', 'ASC');
    
  //   if (categoryId) {
  //     queryBuilder.where('category.id = :categoryId', { categoryId });
  //   }
    
  //   const subcategories = await queryBuilder.getMany();
  //   const result = subcategories.map(subcategory => ({
  //     id: subcategory.id,
  //     name: subcategory.name,
  //     categoryName: subcategory.category?.name || 'Unknown'
  //   }));
  //   await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
  //   return result;
  // }


  // /**
  //  * Get available vendor categories for reference when uploading vendor data
  //  */
  // async getAvailableVendorCategories(): Promise<{ id: string; name: string }[]> {
  //   const key = `${CACHE_PREFIX}:ref:categories`;
  //   const cached = await this.cacheService.get<any>(key);
  //   if (cached) return cached;

  //   const categories = await this.vendorCategoryRepository
  //     .createQueryBuilder('category')
  //     .select(['category.id', 'category.name'])
  //     .orderBy('category.name', 'ASC')
  //     .getMany();
    
  //   const result = categories.map(category => ({ id: category.id, name: category.name }));
  //   await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
  //   return result;
  // }


//   async filterVendors(filters: VendorFilterDto) {
//   const {
//     classification,
//     categoryId,
//     subcategoryId,
//     pincode,
//     city,
//     state,
//     productId,
//     page,
//     limit,
//   } = filters;

//   const query = this.vendorRepository
//     .createQueryBuilder('vendor')
//     .leftJoinAndSelect('vendor.category', 'category')
//     .leftJoinAndSelect('vendor.subcategory', 'subcategory')
//     .leftJoinAndSelect('vendor.officeAddress', 'officeAddress')
//     .leftJoinAndSelect('vendor.mainProduct', 'mainProduct')
//     .leftJoinAndSelect('vendor.listOfAllProducts', 'listOfAllProducts')
//     .where('1=1');

//   // ✅ Apply filters dynamically
//   if (classification) query.andWhere('vendor.classification = :classification', { classification });
//   if (categoryId) query.andWhere('category.id = :categoryId', { categoryId });
//   if (subcategoryId) query.andWhere('subcategory.id = :subcategoryId', { subcategoryId });
//   if (pincode) query.andWhere('officeAddress.pincode ILIKE :pincode', { pincode: `%${pincode}%` });
//   if (city) query.andWhere('officeAddress.city ILIKE :city', { city: `%${city}%` });
//   if (state) query.andWhere('officeAddress.state ILIKE :state', { state: `%${state}%` });
//   if (productId) {
//     query.andWhere('(mainProduct.id = :productId OR listOfAllProducts.id = :productId)', { productId });
//   }

//   query.orderBy('vendor.createdAt', 'DESC');

//   // ✅ If pagination params are provided
//   if (page && limit) {
//     const skip = (page - 1) * limit;
//     const [vendors, total] = await query.skip(skip).take(limit).getManyAndCount();

//     return {
//       data: vendors,
//       pagination: {
//         total,
//         page,
//         limit,
//         totalPages: Math.ceil(total / limit),
//       },
//     };
//   }

  
// }


  // public async getvendorwithid(id?: string): Promise<any> {
  //   const key = `${CACHE_PREFIX}:withid:${id || 'all'}`;
  //   const cached = await this.cacheService.get<any>(key);
  //   if (cached) return cached;

  //   const queryBuilder = this.vendorRepository
  //     .createQueryBuilder("vendor")
  //     .leftJoinAndSelect("vendor.officeAddress", "officeAddress")
  //     .leftJoinAndSelect("vendor.vendorSaleInfo", "vendorSaleInfo")
  //     .leftJoinAndSelect("vendor.category", "category")
  //     .leftJoinAndSelect("vendor.subcategory", "subcategory")
  //     .select([
  //       "vendor.id",
  //       "vendor.companyName",
  //       "vendor.officeContactNo",
  //       "vendor.email",
  //       "vendor.vendorCode",
  //       "officeAddress.id",
  //       "officeAddress.address1",
  //       "officeAddress.address2",
  //       "officeAddress.location",
  //       "officeAddress.city",
  //       "officeAddress.state",
  //       "officeAddress.pincode",
  //       "vendorSaleInfo.contactFName",
  //       "vendorSaleInfo.contactMName",
  //       "vendorSaleInfo.contactLName",
  //       "category.id",
  //       "subcategory.id",
  //     ]);

  //   if (id) {
  //     queryBuilder.where("vendor.id = :id", { id });
  //   }

  //   const vendor = await queryBuilder.getOne();
  //   if (!vendor) return null;

  //   const result = {
  //     id: vendor.id,
  //     companyName: vendor.companyName,
  //     officeContactNo: vendor.officeContactNo,
  //     email: vendor.officeEmail,
  //     vendorCode: vendor.vendorCode,
  //     officeAddress: vendor.officeAddress
  //       ? {
  //           id: vendor.officeAddress.id,
  //           address1: vendor.officeAddress.address1,
  //           address2: vendor.officeAddress.address2,
  //           location: vendor.officeAddress.location,
  //           city: vendor.officeAddress.city,
  //           state: vendor.officeAddress.state,
  //           pincode: vendor.officeAddress.pincode,
  //         }
  //       : null,
  //     contactPersonName: vendor.vendorSaleInfo
  //       ? `${vendor.vendorSaleInfo.contactFName || ""} ${
  //           vendor.vendorSaleInfo.contactMName || ""
  //         } ${vendor.vendorSaleInfo.contactLName || ""}`.trim()
  //       : null,
  //     category: vendor.category?.id || null,
  //     subcategory: vendor.subcategory?.id || null,
  //   };
  //   await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
  //   return result;
  // }


  // async getVendorByVendorName(companyName: string): Promise<Vendor | null> {
  //   const vendor = await this.vendorRepository
  //     .createQueryBuilder("vendor")
  //     .leftJoinAndSelect("vendor.officeAddress", "officeAddress")
  //     .leftJoinAndSelect("vendor.vendorSaleInfo", "vendorSaleInfo")
  //     .leftJoinAndSelect("vendor.vendorBankDetails", "vendorBankDetails")
  //     .leftJoinAndSelect("vendorBankDetails.branchAddress", "branchAddress")
  //     .leftJoinAndSelect("vendor.ref1Address", "ref1Address")
  //     .leftJoinAndSelect("vendor.ref2Address", "ref2Address")
  //     .leftJoinAndSelect("vendor.subcategory", "subcategory")
  //     .leftJoinAndSelect("vendor.category", "category")
  //     .where("vendor.companyName = :companyName", { companyName })
  //     .getOne();

  //   if (!vendor) throw new AppError(404, "Vendor not found");
  //   return vendor;
  // }


  // async getVendorByVendorCode(vendorCode: string): Promise<Vendor | null> {
  //   const vendor = await this.vendorRepository
  //     .createQueryBuilder("vendor")
  //     .leftJoinAndSelect("vendor.officeAddress", "officeAddress")
  //     .leftJoinAndSelect("vendor.vendorSaleInfo", "vendorSaleInfo")
  //     .leftJoinAndSelect("vendor.vendorBankDetails", "vendorBankDetails")
  //     .leftJoinAndSelect("vendorBankDetails.branchAddress", "branchAddress")
  //     .leftJoinAndSelect("vendor.ref1Address", "ref1Address")
  //     .leftJoinAndSelect("vendor.ref2Address", "ref2Address")
  //     .leftJoinAndSelect("vendor.subcategory", "subcategory")
  //     .leftJoinAndSelect("vendor.category", "category")
  //     .where("vendor.vendorCode = :vendorCode", { vendorCode })
  //     .getOne();

  //   if (!vendor) throw new AppError(404, "Vendor not found");
  //   return vendor;
  // }

/** How the import names a vendor: "VENDOR20260003 Fresh Farms". */
const vendorLabel = (vendor: Pick<Vendor, 'vendorCode' | 'companyName'>): string =>
  [vendor.vendorCode, vendor.companyName].filter(Boolean).join(' ');
