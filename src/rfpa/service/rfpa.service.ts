import { inject, injectable } from 'inversify';
import { TYPES } from '../../types';

import { DeepPartial, In, SelectQueryBuilder, DataSource } from 'typeorm';
import { UOMRepository } from '../../uom/repository/uom.repository';
import { ProductRepository } from '../../product/createproduct/repository/product.repository';
import { VendorService } from '../../vendor/createVendor/service/vendor.service';
import { FarmerService } from '../../farmer/service/farmer.service';

import AppError from '../../utils/appError';

import { buildQueryFromArray, PaginationOptions } from '../../utils/pagination';
import { formatDateTime } from '../../utils/dateUtils';
import { createHash } from 'crypto';

import { DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { DocumentStatus } from '../../approvalFlow/entity/docuemnt.entity';
import { DocumentTypeEnum as DocDefEnum } from '../../documentDef/entity/documentdef.entity';

import { ProductVarientRepository } from '../../product/productVarient/repository/varients.repository';
import { RfpaPaymentInfoRepository } from '../repository/rfpaPaymentInfo.repository';
import { ApprovalFlowRepository } from '../../approvalFlow/repository/approvalFlow.repository';
import { CacheService } from '../../global/cache.service';
import logger from '../../utils/logger';

import { BulkDeleteResultDto, DeleteResultDto } from '../../global/general.dto';
import { RFPA } from '../entity/rfpa.entity';
import { RfpaRepository } from '../repository/rfpa.repository';
import { UserService } from '../../employee/service/user.service';
import { NotificationService } from '../../notification/service/notification.service';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { DocumentbService, DocumentWithRelatedData } from '../../approvalFlow/service/documentb.service';
import { DocSingalApproverService } from '../../approvalFlow/service/DocSingalApproverService.service';
import { ApprovalFlowService } from '../../approvalFlow/service/approvalFlow.service';
import { DocumentbRepository } from '../../approvalFlow/repository/documentb.repository';
import { CreateRfpaDto, RfpaDocumentViewResponseDto, RfpaListResponseDto, RfpaNumbersResponseDto, RfpaRecycleBinResponseDto, RfpaUpdateFormDto, UpdateRfpaDto } from '../dto/rfpa.dto';
import { PaymentInfoForRFPA } from '../entity/rfpaPayementInfo.entity';
import { RFPAProduct } from '../entity/rfpaProduct.entity';
import { Company } from '../../company/entity/company.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { Vendor } from '../../vendor/createVendor/entity/vendor.entity';
import { Farmer } from '../../farmer/entity/farmer.entity';
import { Product } from '../../product/createproduct/entity/product.entity';
import { ProductVarient } from '../../product/productVarient/entity/productVarient.entity';
import { UOM } from '../../uom/entity/uom.entity';

export interface RFPAWithRelatedData extends RFPA {
  relatedData?: any;
}

function normalizeDateFormat(date: string | null | undefined): string | null | undefined {
  if (!date) return date;
  const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/;
  const match = date.match(ddmmyyyy);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return date;
}

@injectable()
export class RfpaService {
  constructor(
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
    @inject(TYPES.RfpaRepository)
    private readonly rfpaRepository: RfpaRepository,
    @inject(TYPES.ProductRepository)
    private readonly productRepository: ProductRepository,
    @inject(TYPES.UOMRepository)
    private readonly uomRepository: UOMRepository,
    @inject(TYPES.VendorService)
    private readonly vendorService: VendorService,
    @inject(TYPES.FarmerService)
    private readonly farmerService: FarmerService,
    @inject(TYPES.UserService)
    private readonly userService: UserService,
    @inject(TYPES.NotificationService)
    private readonly notificationService: NotificationService,

    @inject(TYPES.ProductVarientRepository)
    private productVarientsRepository: ProductVarientRepository,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.DocumentbService)
    private readonly documentbService: DocumentbService, // Replace with actual type if available
    @inject(TYPES.DocSingalApproverService)
    private readonly docSingalApproverService: DocSingalApproverService,
    @inject(TYPES.ApprovalFlowService)
    private approvalFlowService: ApprovalFlowService,
    @inject(TYPES.DocumentbRepository)
    private documentbRepository: DocumentbRepository,
    @inject(TYPES.RfpaPaymentInfoRepository)
    private rfpaPaymentInfoRepository: RfpaPaymentInfoRepository,
    @inject(TYPES.ApprovalFlowRepository)
    private approvalFlowRepository: ApprovalFlowRepository,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) { }

  private readonly CACHE_PREFIX = 'rfpa';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:recycle:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:all:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:rfpanumbers:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${this.CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:update:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:view:${id}`),
      );
    }
    await Promise.all(tasks);
  }

  private async checkApprovalFlowExists(userId: string | null | undefined, documentType: DocDefEnum): Promise<void> {
    if (!userId) {
      throw new AppError(400, 'Creator is required to validate the approval flow before creating this document.');
    }
    const approvalFlow = await this.approvalFlowService.getApprovalFlowForUserAndDepartment(userId, documentType);
    
    if (!approvalFlow) {
      throw new AppError(400, `Approval flow not configured for user. Please configure approval flow for ${documentType} type documents before creating.`);
    }
  }

  async createRfpa(rfpaData: CreateRfpaDto & Record<string, any>): Promise<RFPA> {
    // Check if approval flow exists for the user
    if (!rfpaData.createdBy) {
      throw new AppError(400, 'createdBy field is required for approval flow validation');
    }
    await this.checkApprovalFlowExists(rfpaData.createdBy, DocDefEnum.PROCUREMENT);
    
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const rfpaId = await this.generateRFPAId();



      const extractId = (value: any) => {
        if (!value) return null;
        if (typeof value === 'string') return value;
        if (typeof value === 'object' && value.id) return value.id;
        return null;
      };

      const selectedVendorId = rfpaData.source === 'vendor' ? extractId(rfpaData.selectedParty || rfpaData.selectedVendor) : null;
      const selectedFarmerId = rfpaData.source === 'farmer' ? extractId(rfpaData.selectedParty || rfpaData.selectedFarmer) : null;

      const rfpaPaymentInfo = queryRunner.manager.create(this.rfpaPaymentInfoRepository.target, {
        paymentMode: rfpaData.paymentInfo.paymentMode,
        creditPeriod: rfpaData.paymentInfo.creditPeriod,
        paymentDate: rfpaData.paymentInfo.paymentDate,
        paymentTerms: rfpaData.paymentInfo.paymentTerms,
        dueDate: rfpaData.paymentInfo.dueDate,
        advancePaidAmt: rfpaData.paymentInfo.advancePaidAmt,
        validityOfQuote: rfpaData.paymentInfo.validityOfQuote
      } as any) as unknown as PaymentInfoForRFPA;

      const saveRfpaPaymentInfo = await queryRunner.manager.save(rfpaPaymentInfo);

      const rfpaEntity = queryRunner.manager.create(this.rfpaRepository.target, {
        rfpaId,
        requestingDepartment: rfpaData.requestingDepartment,
        companyName: extractId(rfpaData.companyName),
        purchaseLocation: extractId(rfpaData.purchaseLocation),
        purchaseForSalesLocation: extractId(rfpaData.purchaseForSalesLocation),
        otherPurchaseLoc: rfpaData.otherPurchaseLoc,
        otherPurchaseForSalesLoc: rfpaData.otherPurchaseForSalesLoc,
        deliveryReceivingPerson: rfpaData.deliveryReceivingPerson,
        packingInstruction: rfpaData.packingInstruction,
        selectedVendor: selectedVendorId,
        selectedFarmer: selectedFarmerId,
        specialReq: rfpaData.specialReq,
        source: rfpaData.source,
        paymentInfo: saveRfpaPaymentInfo.id,
        remark: rfpaData.remark,
      } as any) as unknown as RFPA;

      if (rfpaData.rfpaProducts && Array.isArray(rfpaData.rfpaProducts)) {
        rfpaEntity.rfpaProducts = rfpaData.rfpaProducts.map((product: any) => {
          const rfpaProduct = new RFPAProduct();
          rfpaProduct.productName = extractId(product.productName) as any;
          rfpaProduct.variant = extractId(product.variant) as any;
          rfpaProduct.grade = product.grade;
          rfpaProduct.quantity = product.quantity;
          rfpaProduct.uom = extractId(product.uom) as any;
          rfpaProduct.unitPrice = product.unitPrice;
          rfpaProduct.count = product.count;
          rfpaProduct.size = product.size;
          rfpaProduct.origin = product.origin;
          rfpaProduct.variety = product.variety;
          rfpaProduct.amount = product.amount;
          rfpaProduct.purchaseDate = product.purchaseDate;
          rfpaProduct.expectedHarvestDate = product.expectedHarvestDate;
          rfpaProduct.dispatchDate = product.dispatchDate;
          rfpaProduct.deliveryDate = product.deliveryDate;
          return rfpaProduct;
        });
      }

      const savedRfpaResult = await queryRunner.manager.save(rfpaEntity);

      const savedRfpa = Array.isArray(savedRfpaResult) ? savedRfpaResult[0] : savedRfpaResult;
      const document = await this.documentbService.createDocument({
        type: DocumentTypeEnum.RFPA,
        docDef: DocDefEnum.PROCUREMENT,
        status: DocumentStatus.HOLD,
        remarks: 'Document auto-created with RFPA',
        lastActionBy: { id: rfpaData.createdBy } as any,
        document_type_id: savedRfpa.id,
      });

      await queryRunner.commitTransaction();

      await this.documentbService.startApprovalFlow(document.id);

      await this.invalidateCache();
      return savedRfpa;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      logger.error('Error creating RFPA:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }







  async generateRFPAId(): Promise<string> {
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const datePrefix = `RFPA${yyyy}${mm}${dd}`;

    const result = await this.rfpaRepository
      .createQueryBuilder('rfpa')
      .select(`MAX(rfpa.rfpaId)`, 'maxId')
      .where('rfpa.rfpaId LIKE :prefix', { prefix: `${datePrefix}%` })
      .getRawOne();

    let nextSeq = 1;
    if (result?.maxId) {
      const suffix = result.maxId.replace(datePrefix, '');
      const parsed = parseInt(suffix, 10);
      if (!isNaN(parsed)) nextSeq = parsed + 1;
    }

    return `${datePrefix}${nextSeq.toString().padStart(5, '0')}`;
  }












  async updateRfpa(id: string, rfpaData: UpdateRfpaDto & Record<string, any>, updatedBy: string): Promise<RFPA | null> {
    return await this.dataSource.transaction(async (manager) => {
      const existingRfpa = await manager.findOne(RFPA, {
        where: { id },
        relations: [
          'companyName',
          'purchaseLocation',
          'purchaseForSalesLocation',
          'selectedVendor',
          'selectedFarmer',
          'paymentInfo',
          'rfpaProducts',
        ],
      });

      if (!existingRfpa) {
        throw new AppError(404, 'RFPA not found');
      }

      const originalRfpa = { ...existingRfpa };

      if (rfpaData.rfpaId !== undefined) existingRfpa.rfpaId = rfpaData.rfpaId as any;
      if (rfpaData.requestingDepartment !== undefined) existingRfpa.requestingDepartment = rfpaData.requestingDepartment as any;
      if (rfpaData.otherPurchaseLoc !== undefined) existingRfpa.otherPurchaseLoc = rfpaData.otherPurchaseLoc as any;
      if (rfpaData.otherPurchaseForSalesLoc !== undefined) existingRfpa.otherPurchaseForSalesLoc = rfpaData.otherPurchaseForSalesLoc as any;
      if (rfpaData.deliveryReceivingPerson !== undefined) existingRfpa.deliveryReceivingPerson = rfpaData.deliveryReceivingPerson as any;
      if (rfpaData.packingInstruction !== undefined) existingRfpa.packingInstruction = rfpaData.packingInstruction as any;
      if (rfpaData.specialReq !== undefined) existingRfpa.specialReq = rfpaData.specialReq as any;
      if (rfpaData.source !== undefined) existingRfpa.source = rfpaData.source as any;
      if (rfpaData.remark !== undefined) existingRfpa.remark = rfpaData.remark as any;

      const extractId = (value: any): string | null => {
        if (!value) return null;
        if (typeof value === 'string') return value;
        if (typeof value === 'object' && value.id) return value.id;
        return null;
      };

      const companyId = extractId(rfpaData.companyName);
      const purchaseLocationId = extractId(rfpaData.purchaseLocation);
      const purchaseForSalesLocationId = extractId(rfpaData.purchaseForSalesLocation);
      const selectedPartyId = extractId(rfpaData.selectedParty);
      const selectedVendorId = extractId(rfpaData.selectedVendor) || (rfpaData.source === 'vendor' ? selectedPartyId : null);
      const selectedFarmerId = extractId(rfpaData.selectedFarmer) || (rfpaData.source === 'farmer' ? selectedPartyId : null);

      const branchIds = [purchaseLocationId, purchaseForSalesLocationId].filter(Boolean) as string[];

      const [company, branches, vendor, farmer] = await Promise.all([
        companyId ? manager.findOne(Company, { where: { id: companyId } }) : Promise.resolve(null),
        branchIds.length ? manager.find(Branches, { where: { id: In(branchIds) } }) : Promise.resolve([] as Branches[]),
        selectedVendorId ? manager.findOne(Vendor, { where: { id: selectedVendorId } }) : Promise.resolve(null),
        selectedFarmerId ? manager.findOne(Farmer, { where: { id: selectedFarmerId } }) : Promise.resolve(null),
      ]);

      const branchMap = new Map((branches as Branches[]).map((b: Branches) => [b.id, b]));

      if (companyId) {
        if (company) existingRfpa.companyName = company;
      } else if (rfpaData.companyName === null) {
        existingRfpa.companyName = null as any;
      }

      if (purchaseLocationId) {
        const branch = branchMap.get(purchaseLocationId);
        if (branch) existingRfpa.purchaseLocation = branch;
      } else if (rfpaData.purchaseLocation === null) {
        existingRfpa.purchaseLocation = null as any;
      }

      if (purchaseForSalesLocationId) {
        const branch = branchMap.get(purchaseForSalesLocationId);
        if (branch) existingRfpa.purchaseForSalesLocation = branch;
      } else if (rfpaData.purchaseForSalesLocation === null) {
        existingRfpa.purchaseForSalesLocation = null as any;
      }

      if (selectedVendorId) {
        if (vendor) {
          existingRfpa.selectedVendor = vendor;
          existingRfpa.selectedFarmer = null as any;
        }
      } else if (rfpaData.selectedVendor === null && !selectedPartyId) {
        existingRfpa.selectedVendor = null as any;
      }

      if (selectedFarmerId) {
        if (farmer) {
          existingRfpa.selectedFarmer = farmer;
          existingRfpa.selectedVendor = null as any;
        }
      } else if (rfpaData.selectedFarmer === null && !selectedPartyId) {
        existingRfpa.selectedFarmer = null as any;
      }

      if (rfpaData.paymentInfo) {
        const toStr = (v: string | Date | null | undefined) =>
          v instanceof Date ? v.toISOString() : v;
        const normalizedPaymentInfo = {
          ...rfpaData.paymentInfo,
          paymentDate: normalizeDateFormat(toStr(rfpaData.paymentInfo.paymentDate)),
          dueDate: normalizeDateFormat(toStr(rfpaData.paymentInfo.dueDate)),
          validityOfQuote: normalizeDateFormat(toStr(rfpaData.paymentInfo.validityOfQuote)),
        };
        if (existingRfpa.paymentInfo) {
          Object.assign(existingRfpa.paymentInfo, normalizedPaymentInfo);
          await manager.save(PaymentInfoForRFPA, existingRfpa.paymentInfo);
        } else {
          const paymentInfo = manager.create(PaymentInfoForRFPA, normalizedPaymentInfo as any) as unknown as PaymentInfoForRFPA;
          const savedPaymentInfo = await manager.save(PaymentInfoForRFPA, paymentInfo);
          existingRfpa.paymentInfo = savedPaymentInfo;
        }
      } else if (rfpaData.paymentInfo === null && existingRfpa.paymentInfo) {
        await manager.remove(PaymentInfoForRFPA, existingRfpa.paymentInfo);
        existingRfpa.paymentInfo = null as any;
      }

      if (rfpaData.rfpaProducts && Array.isArray(rfpaData.rfpaProducts)) {
        if (existingRfpa.rfpaProducts && existingRfpa.rfpaProducts.length > 0) {
          await manager.remove(RFPAProduct, existingRfpa.rfpaProducts);
        }

        const productNameIds = rfpaData.rfpaProducts.map((p: any) => extractId(p.productName)).filter(Boolean) as string[];
        const variantIds = rfpaData.rfpaProducts.map((p: any) => extractId(p.variant)).filter(Boolean) as string[];
        const uomIds = rfpaData.rfpaProducts.map((p: any) => extractId(p.uom)).filter(Boolean) as string[];

        const [productEntities, variantEntities, uomEntities] = await Promise.all([
          productNameIds.length ? manager.find(Product, { where: { id: In(productNameIds) } }) : Promise.resolve([]),
          variantIds.length ? manager.find(ProductVarient, { where: { id: In(variantIds) } }) : Promise.resolve([]),
          uomIds.length ? manager.find(UOM, { where: { id: In(uomIds) } }) : Promise.resolve([]),
        ]);

        const productMap = new Map(productEntities.map((p: any) => [p.id, p]));
        const variantMap = new Map(variantEntities.map((v: any) => [v.id, v]));
        const uomMap = new Map(uomEntities.map((u: any) => [u.id, u]));

        const builtProducts = rfpaData.rfpaProducts.map((productData: any) => {
          const product = manager.create(RFPAProduct, {
            ...productData,
            purchaseDate: normalizeDateFormat(productData.purchaseDate),
            expectedHarvestDate: normalizeDateFormat(productData.expectedHarvestDate),
            dispatchDate: normalizeDateFormat(productData.dispatchDate),
            deliveryDate: normalizeDateFormat(productData.deliveryDate),
            rfpa: existingRfpa,
          });

          const productNameId = extractId(productData.productName);
          if (productNameId) {
            const productEntity = productMap.get(productNameId);
            if (productEntity) product.productName = productEntity;
          }

          const variantId = extractId(productData.variant);
          if (variantId) {
            const variantEntity = variantMap.get(variantId);
            if (variantEntity) product.variant = variantEntity;
          }

          const uomId = extractId(productData.uom);
          if (uomId) {
            const uomEntity = uomMap.get(uomId);
            if (uomEntity) product.uom = uomEntity;
          }

          return product;
        });

        existingRfpa.rfpaProducts = await manager.save(RFPAProduct, builtProducts);
      }

      const updatedRfpa = await manager.save(RFPA, existingRfpa);

      await this.auditLogService.logChange(
        'RFPA',
        updatedRfpa.id,
        originalRfpa,
        updatedRfpa,
        updatedBy,
      );

      await this.invalidateCache(id);

      return await manager.findOne(RFPA, {
        where: { id: updatedRfpa.id },
        relations: [
          'companyName',
          'purchaseLocation',
          'purchaseForSalesLocation',
          'selectedVendor',
          'selectedFarmer',
          'paymentInfo',
          'rfpaProducts',
          'rfpaProducts.productName',
          'rfpaProducts.variant',
          'rfpaProducts.uom',
        ],
      });
    });
  }



  public async getRecycleBinRfpa(queryOptions: PaginationOptions, userId: string): Promise<RfpaRecycleBinResponseDto> {
    const cacheKey = `${this.CACHE_PREFIX}:recycle:${userId}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const queryBuilder = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(
      userId,
      DocumentTypeEnum.RFPA,
      true, // includeDeleted for recycle bin
    );
    const { search } = queryOptions;
    const paginatedResult = await buildQueryFromArray(queryBuilder, queryOptions);

    const typedDocuments = paginatedResult.data as DocumentWithRelatedData[];
    const activeDocuments = typedDocuments;

    const rfpaIds = activeDocuments
      .map(doc => doc.document_type_id)
      .filter(Boolean) as string[];

    const rfpas = rfpaIds.length
      ? await this.rfpaRepository
        .createQueryBuilder('rfpa')
        .leftJoinAndSelect('rfpa.selectedVendor', 'selectedVendor')
        .leftJoinAndSelect('selectedVendor.officeAddress', 'officeAddress')
        .leftJoinAndSelect('rfpa.selectedFarmer', 'selectedFarmer')
        .leftJoinAndSelect('selectedFarmer.residensialAddress', 'residensialAddress')
        .leftJoinAndSelect('selectedFarmer.farmAddress', 'farmAddress')
        .leftJoinAndSelect('rfpa.paymentInfo', 'paymentInfo')
        .leftJoinAndSelect('rfpa.rfpaProducts', 'rfpaProducts')
        .leftJoinAndSelect('rfpaProducts.productName', 'productName')
        .leftJoinAndSelect('rfpaProducts.uom', 'uom')
        .leftJoinAndSelect('rfpa.companyName', 'companyName')
        .leftJoinAndSelect('rfpa.purchaseLocation', 'purchaseLocation')
        .leftJoinAndSelect('rfpa.purchaseForSalesLocation', 'purchaseForSalesLocation')
        .where('rfpa.id IN (:...ids)', { ids: rfpaIds })
        .andWhere('rfpa.isDeleted = true')
        .getMany()
      : [];

    const rfpaMap = new Map(rfpas.map(r => [r.id, r]));
    const recycleDocCreatedAtMap = new Map(activeDocuments.map(d => [d.id, d.createdAt]));

    let relatedDataOnly = activeDocuments
      .filter(doc => doc.document_type_id && rfpaMap.has(doc.document_type_id))
      .map((doc) => {
        const rd: any = rfpaMap.get(doc.document_type_id!)!;
        const { createdDate, createdTime } = formatDateTime(doc.createdAt);
        return {
          id: rd.id,
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: doc.lastActionBy
            ? `${doc.lastActionBy.firstName || ''} ${doc.lastActionBy.lastName || ''}`.trim() || null
            : null,
          createdDate,
          createdTime,
          rfpaId: rd.rfpaId || null,
          remark: rd.remark || null,
          source: rd.source || null,
          specialRequest: rd.specialRequest || null,
          requestingDepartment: rd.requestingDepartment || null,
          otherPurchaseLoc: rd.otherPurchaseLoc || null,
          otherPurchaseForSalesLoc: rd.otherPurchaseForSalesLoc || null,
          deliveryReceivingPerson: rd.deliveryReceivingPerson,
          packingInstruction: rd.packingInstruction,
          vendor: rd.selectedVendor ? {
            selectedParty: rd.selectedParty || null,
            companyName: rd.selectedVendor.companyName || null,
            gstn: rd.selectedVendor.gstn || null,
            panNo: rd.selectedVendor.panNo || null,
            officeAddress: rd.selectedVendor.officeAddress || null,
          } : null,
          farmer: rd.selectedFarmer ? {
            selectedParty: rd.selectedParty || null,
            fullName: `${rd.selectedFarmer.farmerfName ?? ''} ${rd.selectedFarmer.farmermName ?? ''} ${rd.selectedFarmer.farmerlName ?? ''}`.trim(),
            primaryMobileNo: rd.selectedFarmer.primaryMobileNo || null,
            landStatus: rd.selectedFarmer.landStatus || null,
            totalLandArea: rd.selectedFarmer.totalLandArea || null,
            residensialAddress: rd.selectedFarmer.residensialAddress || null,
            farmAddress: rd.selectedFarmer.farmAddress || null,
          } : null,
          paymentInfo: rd.paymentInfo ? {
            paymentMode: rd.paymentInfo.paymentMode || null,
            paymentDate: rd.paymentInfo.paymentDate || null,
            advancePaidAmt: rd.paymentInfo.advancePaidAmt || null,
            paymentTerms: rd.paymentInfo.paymentTerms || null,
            dueDate: rd.paymentInfo.dueDate || null,
            creditPeriod: rd.paymentInfo.creditPeriod || null,
            validityOfQuote: rd.paymentInfo.validityOfQuote || null,
          } : null,
          rfpaProducts: rd.rfpaProducts ? rd.rfpaProducts.map((p: any) => ({
            productName: p.productName?.name || null,
            variant: p.variant?.variantName || null,
            grade: p.grade || null,
            quantity: p.quantity || null,
            uom: p.uom?.unit || null,
            unitPrice: p.unitPrice || null,
            amount: p.amount || null,
            purchaseDate: p.purchaseDate || null,
            expectedHarvestDate: p.expectedHarvestDate || null,
            dispatchDate: p.dispatchDate || null,
            deliveryDate: p.deliveryDate || null,
          })) : [],
          companyName: rd.companyName?.name || null,
          purchaseLocation: rd.purchaseLocation?.name || null,
          purchaseForSalesLocation: rd.purchaseForSalesLocation?.name || null,
        };
      });

    const objectToString = (obj: any): string => {
      if (obj == null) return '';
      if (typeof obj === 'object') return Object.values(obj).map((v) => objectToString(v)).join(' ');
      return String(obj);
    };

    if (search && search.trim()) {
      const term = search.toLowerCase();
      relatedDataOnly = relatedDataOnly.filter((item) =>
        objectToString(item).toLowerCase().includes(term)
      );
    }

    if (queryOptions.sort) {
      const [field, direction] = queryOptions.sort.split(':');
      const sortOrder = direction?.toUpperCase() === 'DESC' ? -1 : 1;
      const getNestedValue = (obj: any, path: string) =>
        path.split('.').reduce((o, key) => (o ? o[key] : undefined), obj);

      relatedDataOnly.sort((a, b) => {
        const valA = getNestedValue(a, field);
        const valB = getNestedValue(b, field);
        if (valA == null && valB == null) return 0;
        if (valA == null) return -1 * sortOrder;
        if (valB == null) return 1 * sortOrder;
        if (!isNaN(valA) && !isNaN(valB)) return (Number(valA) - Number(valB)) * sortOrder;
        return String(valA).localeCompare(String(valB)) * sortOrder;
      });
    } else {
      relatedDataOnly.sort((a, b) => {
        const tA = new Date(recycleDocCreatedAtMap.get(a.documentId) ?? 0).getTime();
        const tB = new Date(recycleDocCreatedAtMap.get(b.documentId) ?? 0).getTime();
        return tB - tA;
      });
    }

    const result = {
      data: relatedDataOnly,
      meta: {
        total: paginatedResult.meta.total,
        page: paginatedResult.meta.page,
        pages: paginatedResult.meta.pages,
      },
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  public async getAllRFPANumbers(
    filter: {
      overAllStatus?: string;
      isDealSlipCreated?: boolean;
      employeeBaseHirechey?: boolean;
      page?: number;
      limit?: number;
      search?: string;
    },
    loginUserId: string
  ): Promise<RfpaNumbersResponseDto> {
    const hash = createHash('md5').update(JSON.stringify({ filter, loginUserId })).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:rfpanumbers:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const rfpaWhere: any = { isDeleted: false };
    if (typeof filter?.isDealSlipCreated === 'boolean') {
      rfpaWhere.isDealSlipCreated = filter.isDealSlipCreated;
    }

    const rfpas = await this.rfpaRepository.find({
      select: ['id', 'rfpaId', 'isDealSlipCreated'],
      where: rfpaWhere,
      relations: ['createdBy'],
      order: { createdAt: 'DESC' },
    });

    const validRfpas = rfpas.filter(r => r.id && r.rfpaId);
    if (!validRfpas.length) {
      const empty = { data: [], total: 0, page: filter.page || 1, limit: filter.limit || 10, totalPages: 0 };
      await this.cacheService.set(cacheKey, empty, this.CACHE_TTL);
      return empty;
    }

    const rfpaIds = validRfpas.map(r => r.id);
    const documents = await this.documentbRepository
      .createQueryBuilder('doc')
      .select(['doc.id', 'doc.status', 'doc.document_type_id'])
      .where('doc.document_type_id IN (:...ids)', { ids: rfpaIds })
      .getMany();
    const docMap = new Map(documents.map(d => [d.document_type_id, d]));

    let approvalFlowMap = new Map<string, any>();
    if (filter?.employeeBaseHirechey) {
      const creatorIds = [...new Set(validRfpas.map(r => r.createdBy?.id).filter(Boolean))] as string[];
      if (creatorIds.length) {
        const flows = await this.approvalFlowRepository
          .createQueryBuilder('approvalflows')
          .leftJoinAndSelect('approvalflows.creator', 'creator')
          .leftJoinAndSelect('approvalflows.verifiers', 'verifiers')
          .leftJoinAndSelect('approvalflows.approvers', 'approvers')
          .leftJoinAndSelect('approvers.firstApprover', 'firstApprover')
          .leftJoinAndSelect('firstApprover.users', 'firstApproverUsers')
          .leftJoinAndSelect('approvers.secondApprover', 'secondApprover')
          .leftJoinAndSelect('secondApprover.users', 'secondApproverUsers')
          .leftJoinAndSelect('approvers.thirdApprover', 'thirdApprover')
          .leftJoinAndSelect('thirdApprover.users', 'thirdApproverUsers')
          .leftJoinAndSelect('approvalflows.finalizers', 'finalizers')
          .leftJoinAndSelect('finalizers.firstFinalizers', 'firstFinalizers')
          .leftJoinAndSelect('finalizers.secondFinalizers', 'secondFinalizers')
          .where('creator.id IN (:...creatorIds)', { creatorIds })
          .andWhere('approvalflows.type = :documentType', { documentType: 'Procurement' })
          .getMany();
        for (const flow of flows) {
          if (flow.creator?.id) approvalFlowMap.set(flow.creator.id, flow);
        }
      }
    }

    const filteredResults: { id: string; rfpaId: string; documentId: string | null }[] = [];

    for (const rfpa of validRfpas) {
      const doc = docMap.get(rfpa.id);
      const documentId = doc?.id || null;
      const documentStatus = doc?.status;

      if (filter?.employeeBaseHirechey) {
        const approvalFlow = approvalFlowMap.get(rfpa.createdBy?.id);
        if (!approvalFlow) continue;

        let hierarchy = 0;
        if (approvalFlow.creator?.id === loginUserId) hierarchy = 1;
        else if (approvalFlow.verifiers?.some((v: any) => v.id === loginUserId)) hierarchy = 2;
        else if (approvalFlow.approvers?.firstApprover?.users?.some((u: any) => u.id === loginUserId)) hierarchy = 3;
        else if (approvalFlow.approvers?.secondApprover?.users?.some((u: any) => u.id === loginUserId)) hierarchy = 4;
        else if (approvalFlow.approvers?.thirdApprover?.users?.some((u: any) => u.id === loginUserId)) hierarchy = 5;
        else if (approvalFlow.finalizers?.firstFinalizers?.some((u: any) => u.id === loginUserId)) hierarchy = 6;
        else if (approvalFlow.finalizers?.secondFinalizers?.some((u: any) => u.id === loginUserId)) hierarchy = 7;

        if (hierarchy === 0) continue;
        if (hierarchy === 1 && rfpa.createdBy?.id !== loginUserId) continue;
      }

      const matchesStatus = !filter?.overAllStatus || documentStatus === filter.overAllStatus;
      const matchesDealSlip = typeof filter?.isDealSlipCreated !== 'boolean' || rfpa.isDealSlipCreated === filter.isDealSlipCreated;

      if (matchesStatus && matchesDealSlip) {
        filteredResults.push({ id: rfpa.id, rfpaId: rfpa.rfpaId, documentId });
      }
    }

    let searchedResults = filteredResults;
    if (filter?.search) {
      const term = filter.search.toLowerCase().trim();
      searchedResults = filteredResults.filter(item =>
        item.rfpaId.toLowerCase().includes(term) ||
        item.id.toLowerCase() === term  // exact ID match
      );
    }

    const page = filter.page || 1;
    const limit = filter.limit || 10;
    const paginatedResults = searchedResults.slice((page - 1) * limit, page * limit);

    const result = {
      data: paginatedResults,
      total: searchedResults.length,
      page,
      limit,
      totalPages: Math.ceil(searchedResults.length / limit),
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }



  async deleteRfpa(id: string): Promise<DeleteResultDto | null> {
    const exists = await this.rfpaRepository.count({ where: { id } });
    const rfpa=await this.rfpaRepository.findOne({where:{id}})
    if(!rfpa){
      throw new AppError(404,`RFPA with ID${id} not found`)
    }
    if (!exists) {
      throw new Error(`RFPA with ID ${id} not found`);
    }

    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    await this.rfpaRepository.update({ id }, { deletionScheduledAt: sixMonthsFromNow } as any);
    await this.invalidateCache(id);
    return {No:rfpa.rfpaId};
  }











  public async getAllRfpa(queryOptions: PaginationOptions, userId: string): Promise<RfpaListResponseDto> {
    const cacheKey = `${this.CACHE_PREFIX}:list:${userId}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const queryBuilder = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(
      userId,
      DocumentTypeEnum.RFPA,
      false,
      queryOptions,
    );
    const { search } = queryOptions;
    const paginatedResult = await buildQueryFromArray(queryBuilder, queryOptions);

    const typedDocuments = paginatedResult.data as DocumentWithRelatedData[];
    const activeDocuments = typedDocuments;

    const rfpaIds = activeDocuments
      .map(doc => doc.document_type_id)
      .filter(Boolean) as string[];

    const rfpas = rfpaIds.length
      ? await this.rfpaRepository
        .createQueryBuilder('rfpa')
        .leftJoinAndSelect('rfpa.companyName', 'companyName')
        .leftJoinAndSelect('rfpa.purchaseLocation', 'purchaseLocation')
        .leftJoinAndSelect('rfpa.purchaseForSalesLocation', 'purchaseForSalesLocation')
        .leftJoinAndSelect('rfpa.paymentInfo', 'paymentInfo')
        .where('rfpa.id IN (:...ids)', { ids: rfpaIds })
        .andWhere('rfpa.isDeleted = false')
        .andWhere('rfpa.deletedAt IS NULL')
        .getMany()
      : [];

    const rfpaMap = new Map(rfpas.map(r => [r.id, r]));
    const docCreatedAtMap = new Map(activeDocuments.map(d => [d.id, d.createdAt]));

    let relatedDataOnly = activeDocuments
      .filter(doc => doc.document_type_id && rfpaMap.has(doc.document_type_id))
      .map((doc) => {
        const rd: any = rfpaMap.get(doc.document_type_id!)!;
        return {
          id: rd.id,
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: doc.lastActionBy
            ? `${doc.lastActionBy.firstName || ''} ${doc.lastActionBy.lastName || ''}`.trim() || null
            : null,
          createdDate: formatDateTime(doc.createdAt).createdDate,
          createdTime: formatDateTime(doc.createdAt).createdTime,
          rfpaId: rd.rfpaId || null,
          remark: rd.remark || null,
          source: rd.source || null,
          deliveryReceivingPerson: rd.deliveryReceivingPerson,
          packingInstruction: rd.packingInstruction,
          paymentInfo: rd.paymentInfo ? {
            paymentMode: rd.paymentInfo.paymentMode || null,
            paymentDate: rd.paymentInfo.paymentDate || null,
            advancePaidAmt: rd.paymentInfo.advancePaidAmt || null,
            paymentTerms: rd.paymentInfo.paymentTerms || null,
            dueDate: rd.paymentInfo.dueDate || null,
            creditPeriod: rd.paymentInfo.creditPeriod || null,
            validityOfQuote: rd.paymentInfo.validityOfQuote || null,
          } : null,
          companyName: rd.companyName?.name || null,
          purchaseLocation: rd.purchaseLocation?.name || null,
          purchaseForSalesLocation: rd.purchaseForSalesLocation?.name || null,
        };
      });

    const objectToString = (obj: any): string => {
      if (obj == null) return '';
      if (typeof obj === 'object') return Object.values(obj).map((v) => objectToString(v)).join(' ');
      return String(obj);
    };

    if (search && search.trim()) {
      const term = search.toLowerCase();
      relatedDataOnly = relatedDataOnly.filter((item) =>
        objectToString(item).toLowerCase().includes(term)
      );
    }

    if (queryOptions.sort) {
      const [field, direction] = queryOptions.sort.split(':');
      const sortOrder = direction?.toUpperCase() === 'DESC' ? -1 : 1;
      const getNestedValue = (obj: any, path: string) =>
        path.split('.').reduce((o, key) => (o ? o[key] : undefined), obj);

      relatedDataOnly.sort((a, b) => {
        const valA = getNestedValue(a, field);
        const valB = getNestedValue(b, field);
        if (valA == null && valB == null) return 0;
        if (valA == null) return -1 * sortOrder;
        if (valB == null) return 1 * sortOrder;
        if (!isNaN(valA) && !isNaN(valB)) return (Number(valA) - Number(valB)) * sortOrder;
        return String(valA).localeCompare(String(valB)) * sortOrder;
      });
    } else {
      relatedDataOnly.sort((a, b) => {
        const tA = new Date(docCreatedAtMap.get(a.documentId) ?? 0).getTime();
        const tB = new Date(docCreatedAtMap.get(b.documentId) ?? 0).getTime();
        return tB - tA;
      });
    }

    const result = {
      data: relatedDataOnly,
      meta: {
        total: paginatedResult.meta.total,
        page: paginatedResult.meta.page,
        pages: paginatedResult.meta.pages,
      },
    };

    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }




  public async getRfpaByIdForView(docid: string, userId: string): Promise<RfpaDocumentViewResponseDto | null> {
    const document = await this.docSingalApproverService.getSingleApprovalDocumentById(docid, userId)
    if (!document) {
      return null;
    }
    const id = document.documentTypeId;



    if (!id) {
      throw new Error('Document type ID not found.');
    }

    const rfpaEntity = await this.rfpaRepository.findOne({
      where: { id },
      relations: [
        'selectedVendor',
        'selectedVendor.officeAddress',
        'selectedVendor.vendorSaleInfo',
        'selectedFarmer',
        'selectedFarmer.residensialAddress',
        'selectedFarmer.farmAddress',
        'paymentInfo',
        'rfpaProducts',
        'rfpaProducts.productName',
        'rfpaProducts.uom',
        'rfpaProducts.variant',
        'companyName',
        'purchaseLocation',
        'purchaseForSalesLocation',
      ],
    });

    if (!rfpaEntity) {
      throw new Error('RFPA not found');
    }

    const rawDate = document.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);

    const selectedVendorInRFPA = rfpaEntity.selectedVendor ? {
      companyName: rfpaEntity.selectedVendor.companyName || null,
      vendorCode: rfpaEntity.selectedVendor.vendorCode || null,
      contactPersonName: `${rfpaEntity.selectedVendor?.vendorSaleInfo?.contactFName ?? ''} ${rfpaEntity.selectedVendor?.vendorSaleInfo?.contactLName ?? ''}`.trim() || null,
      officeContactNo: rfpaEntity.selectedVendor.officeContactNo || null,
      officeEmail: rfpaEntity.selectedVendor.officeEmail || null,
      officeAddress: rfpaEntity.selectedVendor.officeAddress || null,
    } : null;

    const selectedFarmerInRFPA = rfpaEntity.selectedFarmer ? {
      fullName: `${rfpaEntity.selectedFarmer.farmerfName ?? ''} ${rfpaEntity.selectedFarmer.farmermName ?? ''} ${rfpaEntity.selectedFarmer.farmerlName ?? ''}`.trim(),
      primaryMobileNo: rfpaEntity.selectedFarmer.primaryMobileNo || null,
      email: rfpaEntity.selectedFarmer.email || null,
      farmerCode: rfpaEntity.selectedFarmer.farmerCode || null,
      residensialAddress: rfpaEntity.selectedFarmer.residensialAddress || null,
      farmAddress: rfpaEntity.selectedFarmer.farmAddress || null
    } : null;

    const selectedPartyData = rfpaEntity.source === 'vendor' ? selectedVendorInRFPA : selectedFarmerInRFPA;

    return {
      documentId: document.documentId,
      overAllStatus: document.status,
      createdBy: document.createdBy,
      createdDate: formatDateTime(document.createdAt).createdDate,
      createdTime: formatDateTime(document.createdAt).createdTime,
      approvalSummary: document.approvalSummary ?? null,

      rfpaId: rfpaEntity.rfpaId || null,
      remark: rfpaEntity.remark || null,
      specialReq: rfpaEntity.specialReq || null,
      requestingDepartment: rfpaEntity.requestingDepartment || null,
      otherPurchaseLoc: rfpaEntity.otherPurchaseLoc || null,
      otherPurchaseForSalesLoc: rfpaEntity.otherPurchaseForSalesLoc || null,
      source: rfpaEntity.source || null,
      deliveryReceivingPerson: rfpaEntity.deliveryReceivingPerson || null,
      packingInstruction: rfpaEntity.packingInstruction || null,

      selectedParty: selectedPartyData,

      paymentInfo: rfpaEntity.paymentInfo ? {
        paymentMode: rfpaEntity.paymentInfo.paymentMode || null,
        paymentDate: rfpaEntity.paymentInfo.paymentDate || null,
        advancePaidAmt: rfpaEntity.paymentInfo.advancePaidAmt || null,
        paymentTerms: rfpaEntity.paymentInfo.paymentTerms || null,
        dueDate: rfpaEntity.paymentInfo.dueDate || null,
        creditPeriod: rfpaEntity.paymentInfo.creditPeriod || null,
        validityOfQuote: rfpaEntity.paymentInfo.validityOfQuote || null,
      } : null,

      rfpaProducts: rfpaEntity.rfpaProducts ? rfpaEntity.rfpaProducts.map((p: any) => ({
        productName: p.productName?.name || null,
        variant: p.variant?.variantName || null,
        grade: p.grade || null,
        quantity: p.quantity || null,
        uom: p.uom?.unit || null,
        unitPrice: p.unitPrice || null,
        amount: p.amount || null,

        purchaseDate: p.purchaseDate || null,
        expectedHarvestDate: p.expectedHarvestDate || null,
        dispatchDate: p.dispatchDate || null,
        deliveryDate: p.deliveryDate || null,
      })) : [],

      companyName: rfpaEntity.companyName?.name || null,
      purchaseLocation: rfpaEntity.purchaseLocation?.name || null,
      purchaseForSalesLocation: rfpaEntity.purchaseForSalesLocation?.name || null,
    }

  }



  async deleteMultipleRFPA(ids: string[]): Promise<BulkDeleteResultDto> {
    //if (!ids.length) return { message: 'No IDs provided' };
    const success: { id: string; No: string }[] = [];
    const failed: { id: string; reason: string }[] = [];

    const [rfpas, relatedDocuments] = await Promise.all([
      this.rfpaRepository.find({ where: { id: In(ids) } }),
      this.documentbRepository
        .createQueryBuilder('doc')
        .select(['doc.id', 'doc.document_type_id'])
        .where('doc.document_type_id IN (:...ids)', { ids })
        .getMany(),
    ]);

    const foundIds = new Set(rfpas.map(r => r.id));
    const missingId = ids.find(id => !foundIds.has(id));
    if (missingId) throw new Error(`RFPA with ID ${missingId} not found`);

    const docMap = new Map(relatedDocuments.map(d => [d.document_type_id, d]));

    const docIds = relatedDocuments.map(d => d.id);
    if (docIds.length) {
      await this.documentbRepository
        .createQueryBuilder()
        .update()
        .set({ isDeleted: true } as any)
        .whereInIds(docIds)
        .execute();
    }

    await this.rfpaRepository
      .createQueryBuilder()
      .update()
      .set({ isDeleted: true } as any)
      .whereInIds(ids)
      .execute();

    await Promise.all([
      ...ids.flatMap(id => [
        this.cacheService.del(`${this.CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:update:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:view:${id}`),
      ]),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:recycle:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:all:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:rfpanumbers:*`),
    ]);

    rfpas.map((v)=>{
      success.push({id:v.id,No:v.rfpaId});
    })
    return { success,failed,message: 'RFPA records marked for deletion successfully' };
  }

  async getRFQByIdForUpdate(id: string): Promise<RfpaUpdateFormDto | null> {
  const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
  const cached = await this.cacheService.get<any>(cacheKey);
  if (cached) return cached;

  const rfpa = await this.rfpaRepository.findOne({
    where: { id },
    relations: [
      'companyName',
      'selectedVendor',
      'selectedFarmer',
      'rfpaProducts',
      'rfpaProducts.variant',
      'rfpaProducts.productName',
      'rfpaProducts.uom',
      'paymentInfo',
      'purchaseForSalesLocation',
      'purchaseLocation',
    ],
  });

  if (!rfpa) throw new Error(`RFQ with ID ${id} not found`);

  const selectedParty =
    rfpa.source === 'vendor' && rfpa.selectedVendor
      ? rfpa.selectedVendor.id
      : rfpa.source === 'farmer' && rfpa.selectedFarmer
      ? rfpa.selectedFarmer.id
      : null;
  const rawDate = rfpa.createdAt;
  const { createdDate, createdTime } = formatDateTime(rawDate);

  const result:RfpaUpdateFormDto = {
    rfpaId: rfpa.rfpaId,
    companyName: rfpa.companyName?.id,
    createdDate,
    createdTime,
    requestingDepartment: rfpa.requestingDepartment,
    purchaseLocation: rfpa.purchaseLocation?.id || null,
    purchaseForSalesLocation: rfpa.purchaseForSalesLocation?.id || null,
    otherPurchaseForSalesLoc: rfpa.otherPurchaseForSalesLoc,
    otherPurchaseLoc: rfpa.otherPurchaseLoc,
    deliveryReceivingPerson: rfpa.deliveryReceivingPerson,
    remark: rfpa.remark,
    packingInstruction: rfpa.packingInstruction,
    specialReq: rfpa.specialReq,
    source: rfpa.source,
    selectedParty,
    paymentInfo: rfpa.paymentInfo
      ? {
          paymentMode: rfpa.paymentInfo.paymentMode,
          paymentDate: rfpa.paymentInfo.paymentDate,
          advancePaidAmt: rfpa.paymentInfo.advancePaidAmt,
          paymentTerms: rfpa.paymentInfo.paymentTerms,
          validityOfQuote: rfpa.paymentInfo.validityOfQuote,
          creditPeriod: rfpa.paymentInfo.creditPeriod,
          dueDate: rfpa.paymentInfo.dueDate,
        }
      : null,
    rfpaProducts: rfpa.rfpaProducts.map((product) => ({
      grade: product.grade,
      quantity: product.quantity,
      unitPrice: product.unitPrice,
      productName: product.productName?.id || null,
      variant: product.variant?.id || null,
      uom: product.uom?.id || null,
      amount: product.amount,
      purchaseDate: product.purchaseDate,
      dispatchDate: product.dispatchDate,
      deliveryDate: product.deliveryDate,
      expectedHarvestDate: product.expectedHarvestDate,
    })),
  };
  console.log("getting result.............................",result);
  await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
  return result;
}

}



//  async filterRfpas(
//   page: number,
//   limit: number,
//   filters: Record<string, any>
// ) {
//   const queryBuilder: SelectQueryBuilder<RFPA> =
//     this.rfpaRepository.createQueryBuilder("rfpa");

//   queryBuilder.select("rfpa");

//   queryBuilder
//     .where("rfpa.isDeleted = false")
//     .andWhere("rfpa.deletedAt IS NULL");

//   queryBuilder
//     .leftJoin("rfpa.companyName", "companyName")
//     .addSelect("companyName.name")
//     .leftJoin("rfpa.purchaseLocation", "purchaseLocation")
//     .addSelect("purchaseLocation.name")
//     .leftJoin("rfpa.purchaseForSalesLocation", "purchaseForSalesLocation")
//     .addSelect("purchaseForSalesLocation.name")
//     .leftJoin("rfpa.selectedVendor", "selectedVendor")
//   .addSelect(["selectedVendor.companyName"])
//   .leftJoin("rfpa.selectedFarmer", "selectedFarmer")
//   .addSelect([
//     "selectedFarmer.farmerlName",
//     "selectedFarmer.farmermName",
//     "selectedFarmer.farmerfName",
//   ])
//   .leftJoin("rfpa.paymentInfo","paymentInfo")
//   .addSelect("paymentInfo.paymentMode")
//   .leftJoinAndSelect("rfpa.rfpaProducts", "rfpaProducts")
//   .leftJoinAndSelect("rfpaProducts.productName", "product")
//   .addSelect(["product.name"]);

// Object.entries(filters).forEach(([key, value], index) => {
//   const paramKey = `param_${index}`; // avoid param conflicts

//   const parts = key.split(".");
//   if (parts.length > 1) {
//     const aliasPath = parts.slice(0, -1).join(".");
//     const field = parts[parts.length - 1];
//     const alias = parts[parts.length - 2]; // e.g. productName -> alias "product"

//     if (typeof value === "string" && isNaN(Number(value))) {
//       queryBuilder.andWhere(`${alias}.${field} ILIKE :${paramKey}`, {
//         [paramKey]: `%${value}%`,
//       });
//     } else {
//       queryBuilder.andWhere(`${alias}.${field} = :${paramKey}`, {
//         [paramKey]: value,
//       });
//     }
//   } else {
//     if (typeof value === "string" && isNaN(Number(value))) {
//       queryBuilder.andWhere(`rfpa.${key} ILIKE :${paramKey}`, {
//         [paramKey]: `%${value}%`,
//       });
//     } else {
//       queryBuilder.andWhere(`rfpa.${key} = :${paramKey}`, {
//         [paramKey]: value,
//       });
//     }
//   }
// });

//   queryBuilder.skip((page - 1) * limit).take(limit);

//   const [data, total] = await queryBuilder.getManyAndCount();

//   return {
//     data,
//     total,
//     page,
//     limit,
//     totalPages: Math.ceil(total / limit),
//   };
// }



// async getRFQById(id: string) {
//   const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
//   const cached = await this.cacheService.get<any>(cacheKey);
//   if (cached) return cached;

//   const rfpa = await this.rfpaRepository.findOne({
//     where: { id },
//     relations: [
//       'companyName',
//       'selectedVendor',
//       'selectedFarmer',
//       'rfpaProducts',
//       'rfpaProducts.productName',
//       'rfpaProducts.uom',
//       'paymentInfo',
//       'purchaseForSalesLocation',
//       'purchaseLocation',
//     ],
//   });

//   if (!rfpa) throw new Error(`RFQ with ID ${id} not found`);

//   const selectedParty =
//     rfpa.source === 'vendor' && rfpa.selectedVendor
//       ? rfpa.selectedVendor.id
//       : rfpa.source === 'farmer' && rfpa.selectedFarmer
//       ? rfpa.selectedFarmer.id
//       : null;
//   const rawDate = rfpa.createdAt;
//   const { createdDate, createdTime } = formatDateTime(rawDate);

//   const result = {
//     rfpaId: rfpa.rfpaId,
//     companyName: rfpa.companyName
//       ? { id: rfpa.companyName.id, companyName: rfpa.companyName.name }
//       : null,
//     createdDate,
//     createdTime,
//     requestingDepartment: rfpa.requestingDepartment,
//     purchaseLocation: rfpa.purchaseLocation?.id || null,
//     purchaseForSalesLocation: rfpa.purchaseForSalesLocation?.id || null,
//     otherPurchaseForSalesLoc: rfpa.otherPurchaseForSalesLoc,
//     otherPurchaseLoc: rfpa.otherPurchaseLoc,
//     deliveryReceivingPerson: rfpa.deliveryReceivingPerson,
//     remark: rfpa.remark,
//     packingInstruction: rfpa.packingInstruction,
//     specialReq: rfpa.specialReq,
//     source: rfpa.source,
//     selectedParty,
//     paymentInfo: rfpa.paymentInfo
//       ? {
//           paymentMode: rfpa.paymentInfo.paymentMode,
//           paymentDate: rfpa.paymentInfo.paymentDate,
//           advancePaidAmt: rfpa.paymentInfo.advancePaidAmt,
//           paymentTerms: rfpa.paymentInfo.paymentTerms,
//           validityOfQuote: rfpa.paymentInfo.validityOfQuote,
//           creditPeriod: rfpa.paymentInfo.creditPeriod,
//           dueDate: rfpa.paymentInfo.dueDate,
//         }
//       : null,
//     rfpaProducts: rfpa.rfpaProducts.map((product) => ({
//       grade: product.grade,
//       quantity: product.quantity,
//       unitPrice: product.unitPrice,
//       productName: product.productName
//         ? { id: product.productName.id, name: product.productName.name }
//         : null,
//       uom: product.uom
//         ? { id: product.uom.id, unit: product.uom.unit }
//         : null,
//       amount: product.amount,
//       purchaseDate: product.purchaseDate,
//       dispatchDate: product.dispatchDate,
//       deliveryDate: product.deliveryDate,
//       deliveryLocation: product.deliveryLocation,
//       expectedHarvestDate: product.expectedHarvestDate,
//     })),
//   };
//   await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
//   return result;
// }


// async findAllRfpas(
//   queryOptions: PaginationOptions,
// ): Promise<{ data: any[]; meta: any }> {
//   const hash = createHash('md5').update(JSON.stringify(queryOptions)).digest('hex');
//   const cacheKey = `${this.CACHE_PREFIX}:all:${hash}`;
//   const cached = await this.cacheService.get<any>(cacheKey);
//   if (cached) return cached;

//   const page = queryOptions.page ?? 1;
//   const limit = queryOptions.limit ?? 10;

//   const skip = (page - 1) * limit;

//   const [rfpas, total] = await this.rfpaRepository.findAndCount({
//     relations: [
//       'companyName',
//       'selectedVendor',
//       'selectedFarmer',
//       'rfpaProducts',
//       'rfpaProducts.productName',
//       'rfpaProducts.uom',
//       'paymentInfo',
//       'purchaseForSalesLocation',
//       'purchaseLocation',
//     ],
//     where: { isDeleted: false },
//     order: {
//       createdAt: 'DESC',
//     },
//     skip,
//     take: limit,
//   });

//   const formattedResponses = rfpas.map((rfpa) => {
//     const rawDate = rfpa.createdAt;
//     const { createdDate, createdTime } = formatDateTime(rawDate);
//     const getSelectedParty = (rfpa: RFPA) => {
//       return rfpa.source === 'vendor'
//         ? rfpa.selectedVendor?.id || null
//         : rfpa.source === 'farmer'
//         ? rfpa.selectedFarmer?.id || null
//         : null;
//     };

//     return {
//       id: rfpa.id,
//       companyName: rfpa.companyName?.name || null,
//       rfpaId: rfpa.rfpaId,
//       createdTime,
//       createdDate,

//       requestingDepartment: rfpa.requestingDepartment,
//       purchaseLocation: rfpa.purchaseLocation?.name || null,
//       purchaseForSalesLocation: rfpa.purchaseForSalesLocation?.name || null,
//       deliveryReceivingPerson: rfpa.deliveryReceivingPerson,
//       packingInstruction: rfpa.packingInstruction,
//      specialReq: rfpa.specialReq,
//       source: rfpa.source,
//       selectedParty: getSelectedParty(rfpa),
//       paymentInfo: rfpa.paymentInfo
//         ? {
//             id: rfpa.paymentInfo.id,
//             paymentMode: rfpa.paymentInfo.paymentMode,
//             paymentDate: rfpa.paymentInfo.paymentDate,
//             advancePaidAmount: rfpa.paymentInfo.advancePaidAmt,
//             paymentTerms: rfpa.paymentInfo.paymentTerms,
//             validityOfQuote: rfpa.paymentInfo.validityOfQuote,
//             creditPeriod: rfpa.paymentInfo.creditPeriod,
//             dueDate: rfpa.paymentInfo.dueDate,
//           }
//         : null,
//       rfpaProducts: rfpa.rfpaProducts
//         ? rfpa.rfpaProducts.map((product) => ({
//             id: product.id,
//             grade: product.grade,
//             quantity: product.quantity,
//             unitPrice: product.unitPrice,
//             productName: product.productName?.name || null,
//             uom: product.uom?.unit || null,
//             amount: product.amount,
//             purchaseDate: product.purchaseDate,
//             dispatchDate: product.dispatchDate,
//             deliveryDate: product.deliveryDate,
//             deliveryLocation: product.deliveryLocation,
//             expectedHarvestDate: product.expectedHarvestDate,
//           }))
//         : [],
//     };
//   });

//   const result = {
//     data: formattedResponses,
//     meta: {
//       total,
//       page,
//       pages: Math.ceil(total / limit),
//     },
//   };
//   await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
//   return result;
// }







// async getRFQByIdByView(id: string): Promise<RfpaViewResponseDto | null> {
//   const cacheKey = `${this.CACHE_PREFIX}:view:${id}`;
//   const cached = await this.cacheService.get<any>(cacheKey);
//   if (cached) return cached;

//   const rfpa = await this.rfpaRepository.findOne({
//     where: { id },
//     relations: [
//       'companyName',
//       'selectedVendor',
//       'selectedFarmer',
//       'rfpaProducts',
//       'rfpaProducts.variant',
//       'rfpaProducts.productName',
//       'rfpaProducts.uom',
//       'paymentInfo',
//       'purchaseForSalesLocation',
//       'purchaseLocation',
//     ],
//   });

//   if (!rfpa) throw new Error(`RFQ with ID ${id} not found`);

//   const selectedParty =
//     rfpa.source === 'vendor' && rfpa.selectedVendor
//       ? {
//           id: rfpa.selectedVendor.id,
//           vendorCode: rfpa.selectedVendor.vendorCode,
//           companyName: rfpa.selectedVendor.companyName,
//         }
//       : rfpa.source === 'farmer' && rfpa.selectedFarmer
//       ? {
//           id: rfpa.selectedFarmer.id,
//           farmerCode: rfpa.selectedFarmer.farmerCode,
//           name: rfpa.selectedFarmer.farmerfName + ' ' + rfpa.selectedFarmer.farmerlName,
//         }
//       : null;

//   const rawDate = rfpa.createdAt;
//   const { createdDate, createdTime } = formatDateTime(rawDate);

//   const result = {
//     rfpa: rfpa.rfpaId,
//     companyName: rfpa.companyName.name,
//     createdDate,
//     createdTime,
//     requestingDepartment: rfpa.requestingDepartment,
//     purchaseLocation: rfpa.purchaseLocation?.name || null,
//     purchaseForSalesLocation: rfpa.purchaseForSalesLocation?.name || null,
//     otherPurchaseForSalesLoc: rfpa.otherPurchaseForSalesLoc,
//     otherPurchaseLoc: rfpa.otherPurchaseLoc,
//     deliveryReceivingPerson: rfpa.deliveryReceivingPerson || null,
//     remark: rfpa.remark || null,
//     packingInstruction: rfpa.packingInstruction || null,
//     specialReq: rfpa.specialReq,
//     source: rfpa.source,
//     selectedParty,
//     paymentInfo: rfpa.paymentInfo
//       ? {
//           paymentMode: rfpa.paymentInfo.paymentMode,
//           paymentDate: rfpa.paymentInfo.paymentDate,
//           advancePaidAmt: rfpa.paymentInfo.advancePaidAmt,
//           paymentTerms: rfpa.paymentInfo.paymentTerms,
//           validityOfQuote: rfpa.paymentInfo.validityOfQuote,
//           creditPeriod: rfpa.paymentInfo.creditPeriod,
//           dueDate: rfpa.paymentInfo.dueDate,
//         }
//       : null,
//     rfpaProducts: rfpa.rfpaProducts.map((product) => ({
//       grade: product.grade,
//       quantity: product.quantity,
//       unitPrice: product.unitPrice,
//       productName: product.productName?.name || null,
//       variant: product.variant?.variantName || null,
//       uom: product.uom?.unit || null,
//       amount: product.amount,
//       purchaseDate: product.purchaseDate,
//       dispatchDate: product.dispatchDate,
//       deliveryDate: product.deliveryDate,
//       deliveryLocation: product.deliveryLocation,
//       expectedHarvestDate: product.expectedHarvestDate,
//     })),
//   };
//   await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
//   return result;
// }