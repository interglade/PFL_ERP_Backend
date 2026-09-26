import { inject, injectable } from 'inversify';
import { TYPES } from '../../types';

import { ILike, In, LessThan, MoreThanOrEqual, DataSource } from 'typeorm';

import AppError from '../../utils/appError';
import { ammountStatus } from '../../utils/status.enum';
import { buildQueryFromArray, PaginationOptions } from '../../utils/pagination';
import { formatDateTime } from '../../utils/dateUtils';

import { DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { DocumentTypeEnum as DocDefEnum } from '../../documentDef/entity/documentdef.entity';

import { ProductVarientRepository } from '../../product/productVarient/repository/varients.repository';
import { ApprovalFlowRepository } from '../../approvalFlow/repository/approvalFlow.repository';

import { createHash } from 'crypto';

import { GrnProduct } from '../entity/grnProduct.entity';
import { BulkDeleteResultDto, DeleteResultDto } from '../../global/general.dto';
import { GrnRepository } from '../repository/grn.repository';
import { GrnProductRepository } from '../repository/grnProduct.repository';
import { BranchessRepository } from '../../branch/repository/branches.repository';
import { DocumentbRepository } from '../../approvalFlow/repository/documentb.repository';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { CacheService } from '../../global/cache.service';
import { DocumentbService, DocumentWithRelatedData } from '../../approvalFlow/service/documentb.service';
import { ApprovalFlowService } from '../../approvalFlow/service/approvalFlow.service';
import { GrnProductHistoryService } from './grnProductHistory.service';
import { CreateGrnDto, GrnDetailDto, GrnListItemDto, UpdateGrnDto } from '../dto/grn.dto';
import { GRN } from '../entity/grn.entity';

interface SourceMetrics {
  totalPurchases: number;
  totalAmount: number;
  averageAmount: number;
  productBreakdown: any[];
  seasonalTrends: any[];
  qualityMetrics: any;
  paymentAnalysis: any;
}

@injectable()
export class GrnService {
  constructor(
    @inject(TYPES.GrnRepository) private readonly grnRepository: GrnRepository,
    @inject(TYPES.GrnProductRepository) private readonly grnProductRepository: GrnProductRepository,
    @inject(TYPES.ProductVarientRepository) private productVarientsRepository: ProductVarientRepository,
    @inject(TYPES.BranchessRepository) private readonly branchesRepository: BranchessRepository,
    @inject(TYPES.DocumentbRepository) private readonly documentbRepository: DocumentbRepository,
    @inject(TYPES.ApprovalFlowRepository) private readonly approvalFlowRepository: ApprovalFlowRepository,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
    @inject(TYPES.AuditLogService) private readonly auditLogService: AuditLogService,
    @inject(TYPES.DocumentbService) private readonly documentbService: DocumentbService,
    @inject(TYPES.ApprovalFlowService) private readonly approvalFlowService: ApprovalFlowService,
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.GrnProductHistoryService) private readonly grnProductHistoryService: GrnProductHistoryService,
  ) { }

  private readonly CACHE_PREFIX = 'grn';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:all:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:recycle:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:numbers:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${this.CACHE_PREFIX}:id:${id}`),
        // The view and update caches are keyed by the Documentb id (the route
        // param), not by this record's own id, so they can only be busted by
        // pattern from here.
        this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:view:*`),
        this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:update:*`),
        this.cacheService.del(`${this.CACHE_PREFIX}:details:${id}`),
      );
    }
    await Promise.all(tasks);
  }

public async getAllRecycleBinGrns(queryOptions: PaginationOptions, userId: string): Promise<{
    data: any[];
    meta: { total: number; page: number; pages: number };
  }> {
    const hash = createHash('md5').update(`${userId}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:recycle:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { search } = queryOptions;
    const { data } = await this.documentbService.getAllDocumentByUserId(
      userId,
      DocumentTypeEnum.GRN,
      queryOptions,
      false,
      true,
    );
    const paginatedData = await buildQueryFromArray(data, queryOptions);
    const typedDocuments = paginatedData.data as DocumentWithRelatedData[];

    const grnIds = typedDocuments.map(d => d.document_type_id).filter(Boolean) as string[];
    const grns = grnIds.length
      ? await this.grnRepository
          .createQueryBuilder('grn')
          .leftJoinAndSelect('grn.companyName', 'companyName')
          .leftJoinAndSelect('grn.grnProducts', 'grnProducts')
          .leftJoinAndSelect('grnProducts.productName', 'productName')
          .leftJoinAndSelect('grnProducts.uom', 'uom')
          .leftJoinAndSelect('grn.selectedFarmer', 'selectedFarmer')
          .leftJoinAndSelect('grn.selectedVendor', 'selectedVendor')
          .leftJoinAndSelect('grn.dealSlipId', 'dealSlipId')
          .leftJoinAndSelect('grn.purchaseForSalesLocation', 'purchaseForSalesLocation')
          .leftJoinAndSelect('grn.purchaseLocation', 'purchaseLocation')
          .leftJoinAndSelect('grn.paymentInfo', 'paymentInfo')
          .where('grn.id IN (:...ids)', { ids: grnIds })
          .andWhere('grn.isDeleted = true')
          .getMany()
      : [];
    const grnMap = new Map(grns.map(g => [g.id, g]));
    const docCreatedAtMap = new Map(typedDocuments.map(d => [d.id, d.createdAt]));

    let relatedDataOnly = typedDocuments
      .filter(doc => doc.document_type_id && grnMap.has(doc.document_type_id))
      .map((doc) => {
        const related = grnMap.get(doc.document_type_id!)!;
        const { createdDate, createdTime } = formatDateTime(doc.createdAt);
        return {
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: doc.lastActionBy
            ? `${doc.lastActionBy.firstName || ''} ${doc.lastActionBy.lastName || ''}`.trim()
            : null,
          createdDate,
          createdTime,
          id: related.id,
          companyName: related.companyName?.name || null,
          purchaseLocation: related.purchaseLocation?.name || null,
          purchaseForSalesLocation: related.purchaseForSalesLocation?.name || null,
          otherPurchaseForSalesLoc: related.otherPurchaseForSalesLoc || null,
          otherPurchaseLoc: related.otherPurchaseLoc || null,
          purchaseInstructionsBy: related.purchaseInstructionsBy || null,
          grnProducts: related.grnProducts?.map((product: any) => ({
            id: product.id,
            quantity: product.quantity,
            unitPrice: product.unitPrice,
            productName: product.productName?.id,
            variant: product.variant?.id || null,
            uom: product.uom?.id,
            amount: product.amount,
            rtv: product.rtv,
            purchaseDate: product.purchaseDate,
            dispatchDate: product.dispatchDate,
            deliveryDate: product.deliveryDate,
            expectedHarvestDate: product.expectedHarvestDate,
          })) || [],
        };
      });
  const objectToString = (obj: any): string => {
    if (obj == null) return '';
    if (typeof obj === 'object') {
      return Object.values(obj).map((v) => objectToString(v)).join(' ');
    }
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

  const recycleResult = {
    data: relatedDataOnly,
    meta: { total: paginatedData.meta.total, page: paginatedData.meta.page, pages: paginatedData.meta.pages },
  };
  await this.cacheService.set(cacheKey, recycleResult, this.CACHE_TTL);
  return recycleResult;
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

  public async createGrn(grnData: CreateGrnDto): Promise<any> {
    // Check if approval flow exists for the user
    if (!grnData.createdBy) {
      throw new AppError(400, 'createdBy field is required for approval flow validation');
    }
    await this.checkApprovalFlowExists(grnData.createdBy, DocDefEnum.PROCUREMENT);
    
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {

        grnData.createdAt = new Date();
        console.log('UTC Time:', grnData.createdAt);

        const branch = await queryRunner.manager.findOne(this.branchesRepository.target, {
          where: { id: grnData.purchaseLocation },
        });

        if (!branch) {
          throw new Error(`Branch not found for id: ${grnData.purchaseLocation}`);
        }

        const serialNo = await this.generateSerialNo(branch.prefix);
        grnData.grnNo = serialNo;

      let variantIds: string[] = [];
      if (Array.isArray(grnData.variants)) {
        variantIds = grnData.variants;
      } else if (grnData.variants) {
        variantIds = [grnData.variants];
      }

      const variants = await queryRunner.manager.find(this.productVarientsRepository.target, {
        where: { id: In(variantIds) },
        relations: ['product'],
      });
      const productIds = variants.map(v => v.product?.id).filter(Boolean);

      const { variants: _discardVariants, ...grnPayload } = grnData as any;
      const createPayload = {
        ...grnPayload,
        grnProducts: grnPayload.grnProducts?.map((product: any) => ({
          ...product,
          productName: product.productName ? { id: product.productName } : undefined,
          variant: product.variant ? { id: product.variant } : undefined,
          uom: product.uom ? { id: product.uom } : undefined,
        })),
      };

      const grn = queryRunner.manager.create(this.grnRepository.target, createPayload as any);
      const savedGrn = await queryRunner.manager.save(grn) as GRN | GRN[];
        console.log('totalAmt ', grnData.requestedBy);

        const document = await this.documentbService.createDocument({
          type: DocumentTypeEnum.GRN,
          docDef: DocDefEnum.PROCUREMENT,
          totalAmt: grnData.totalAmt,
          status: DocumentStatus.HOLD,
          remarks: 'Document auto-created with GRN',
          lastActionBy: { id: grnData.requestedBy },
          document_type_id: Array.isArray(savedGrn) ? (savedGrn[0] as GRN)?.id : (savedGrn as GRN).id
        }, );

        await queryRunner.commitTransaction();

        await this.documentbService.startApprovalFlow(document.id);

        await this.invalidateCache();
        return savedGrn;
      } catch (error: any) {
        await queryRunner.rollbackTransaction();
        console.error('Error creating GRN:', error);
        throw error;
      } finally {
        await queryRunner.release();
      }
    }

public async getAllGrns(queryOptions: PaginationOptions, userId: string): Promise<{
    data: GrnListItemDto[];
    meta: { total: number; page: number; pages: number };
  }> {
    const hash = createHash('md5').update(`${userId}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:all:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { search } = queryOptions;
    const { data: allDocuments } = await this.documentbService.getAllDocumentByUserId(
      userId,
      DocumentTypeEnum.GRN,
      queryOptions,
      true,
    );

    const typedDocuments = allDocuments as DocumentWithRelatedData[];

    const grnIds = typedDocuments.map(d => d.document_type_id).filter(Boolean) as string[];
    const grns = grnIds.length
      ? await this.grnRepository
          .createQueryBuilder('grn')
          .leftJoinAndSelect('grn.companyName', 'companyName')
          .leftJoinAndSelect('grn.purchaseLocation', 'purchaseLocation')
          .leftJoinAndSelect('grn.purchaseForSalesLocation', 'purchaseForSalesLocation')
          .leftJoinAndSelect('grn.paymentInfo', 'paymentInfo')
          .where('grn.id IN (:...ids)', { ids: grnIds })
          .andWhere('grn.isDeleted = false')
          .andWhere('grn.deletedAt IS NULL')
          .getMany()
      : [];
    const grnMap = new Map(grns.map(g => [g.id, g]));
    const docCreatedAtMap = new Map(typedDocuments.map(d => [d.id, d.createdAt]));

    let relatedDataOnly = typedDocuments
      .filter(doc => doc.document_type_id && grnMap.has(doc.document_type_id))
      .map((doc) => {
        const related = grnMap.get(doc.document_type_id!)!;
        const { createdDate, createdTime } = formatDateTime(doc.createdAt);
        return {
          id: related.id,
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: doc.lastActionBy
            ? `${doc.lastActionBy.firstName || ''} ${doc.lastActionBy.lastName || ''}`.trim()
            : null,
          createdDate,
          createdTime,
          companyName: related.companyName?.name || null,
          grnType: related.grnType || null,
          purchaseType: related.purchaseType || null,
          locationType: related.locationType || null,
          source: related.source || null,
          billNo: related.billNo || null,
          freight: related.freight || null,
          subTotalAmt: related.subTotalAmt || null,
          otherCharges: related.otherCharges || null,
          totalAmt: related.totalAmt || null,
          amtWords: related.amtWords || null,
          cratesIn: related.cratesIn || null,
          purchasedBy: related.purchasedBy || null,
          receivedThrough: related.receivedThrough || null,
          vehicleNo: related.vehicleNo || null,
          timeIn: related.timeIn || null,
          remark: related.remark || null,
          securityPerson: related.securityPerson || null,
          deliveryReceivingPerson: related.deliveryReceivingPerson || null,
          rmn: related.rmn || null,
          purchaseLocation: related.purchaseLocation?.name || null,
          purchaseForSalesLocation: related.purchaseForSalesLocation?.name || null,
          grnNo: related.grnNo || null,
          paymentInfo: {
            id: related.paymentInfo?.id || null,
            paymentTerms: related.paymentInfo?.paymentTerms || null,
            paymentDate: related.paymentInfo?.paymentDate || null,
            paymentMode: related.paymentInfo?.paymentMode || null,
            creditPeriod: related.paymentInfo?.creditPeriod || null,
            dueDate: related.paymentInfo?.dueDate || null,
            advancePaidAmt: related.paymentInfo?.advancePaidAmt || null,
          },
        };
      });

  const objectToString = (obj: any): string => {
    if (obj == null) return '';
    if (typeof obj === 'object') {
      return Object.values(obj).map((v) => objectToString(v)).join(' ');
    }
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

  const total = relatedDataOnly.length;
  const page = queryOptions.page || 1;
  const limit = queryOptions.limit || 10;
  const pages = Math.ceil(total / limit);
  const skip = (page - 1) * limit;
  const paginatedResult = relatedDataOnly.slice(skip, skip + limit);

  const allResult = {
    data: paginatedResult,
    meta: { total, page, pages },
  };
  await this.cacheService.set(cacheKey, allResult, this.CACHE_TTL);
  return allResult;
  }

  public async getGrnByIdForView(docid: string): Promise<any> {
    const cacheKey = `${this.CACHE_PREFIX}:view:${docid}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const document = await this.documentbService.getDocumentById(docid);
    const id = document.documentTypeId;
    console.log('id in getGrnByIdForView', id);

    if (id) {
      const grn = await this.grnRepository.findOne({
        where: { id },
        relations: [
          'companyName',
          'grnProducts',
          'grnProducts.productName',
          'grnProducts.uom',
          'grnProducts.variant',
          'selectedFarmer',
          'selectedVendor',
          'purchaseInstructionsBy',
          'paymentInfo',
          'dealSlipId',
          'purchaseForSalesLocation',
          'purchaseLocation',
          'createdBy',
          'purchaseBy',
        ],
      });

      if (!grn) {
        throw new Error('GRN not found');
      }

      let selectedPartyId: string | null = null;
      if (grn.source === 'vendor' && grn.selectedVendor) {
        selectedPartyId = grn.selectedVendor.companyName;
      } else if (grn.source === 'farmer' && grn.selectedFarmer) {
        selectedPartyId =
          grn.selectedFarmer.farmerfName +
          ' ' +
          grn.selectedFarmer.farmermName +
          ' ' +
          grn.selectedFarmer.farmerlName;
      }
      const rawDate = grn.createdAt;
      const { createdDate, createdTime } = formatDateTime(rawDate);

      const viewResult: GrnDetailDto = {
        id: grn.id,
        overAllStatus: document.overAllStatus ?? null,
        approvalSummary: document.approvalSummary ?? null,
        ammountStatus: grn.ammountStatus,
        companyName: grn.companyName?.name ?? null,
        purchaseInstructionsBy: grn.purchaseInstructionsBy
          ? `${grn.purchaseInstructionsBy.firstName || ''} ${grn.purchaseInstructionsBy.lastName || ''}`.trim()
          : null,
        dealSlipId: {
          id: grn.dealSlipId?.id || null,
          dealSlipNo: grn.dealSlipId?.dealSlipNo || null,
        },
        purchaseType: grn.purchaseType,
        otherPurchaseForSalesLoc: grn.otherPurchaseForSalesLoc || null,
        otherPurchaseLoc: grn.otherPurchaseLoc || null,
        grnNo: grn.grnNo,
        locationType: grn.locationType,
        grnType: grn.grnType,
        rmn: grn.rmn,
        createdDate: createdDate,
        createdTime: createdTime,
        createdBy:`${grn.createdBy.firstName} ${grn.createdBy.lastName}`.trim() || null,
        requestingDepartment: grn.requestingDepartment,
        purchaseLocation: grn.purchaseLocation?.name ?? null,
        purchaseForSalesLocation: grn.purchaseForSalesLocation?.name ?? null,
        selectedParty: selectedPartyId,
        source: grn.source,
        billNo: grn.billNo,
        billImage: grn.billImage,
        subTotalAmt: grn.subTotalAmt,
        freight: grn.freight,
        otherCharges: grn.otherCharges,
        totalAmt: grn.totalAmt,
        amtWords: grn.amtWords,
        purchasedBy: grn.purchasedBy,
        receivedThrough: grn.receivedThrough,
        vehicleNo: grn.vehicleNo,
        timeIn: grn.timeIn,
        cratesIn: grn.cratesIn,
        deliveryReceivingPerson: grn.deliveryReceivingPerson,
        baseLocation: grn.baseLocation,
        specialReq: grn.specialReq,
        securityPerson: grn.securityPerson,
        approvalNote: grn.approvalNote,
        remark: grn.remark,
        purchaseBy: grn.purchaseBy
          ? {
              firstName: grn.purchaseBy.firstName || '',
              lastName: grn.purchaseBy.lastName || '',
            }
          : null,
        paymentInfo: grn.paymentInfo
          ? {
              id: grn.paymentInfo.id,
              paymentMode: grn.paymentInfo.paymentMode,
              paymentDate: grn.paymentInfo.paymentDate,
              advancePaidAmt: grn.paymentInfo.advancePaidAmt,
              remainingAmt: grn.paymentInfo.remainingAmt,
              paymentTerms: grn.paymentInfo.paymentTerms,
              dueDate: grn.paymentInfo.dueDate,
              creditPeriod: grn.paymentInfo.creditPeriod,
            }
          : null,
        grnProducts: grn.grnProducts.map((product) => ({
          id: product.id,
          quantity: product.quantity,
          unitPrice: product.unitPrice,
          productName: product.productName?.name ?? null,
          variant: product.variant?.variantName || null,
          uom: product.uom?.unit ?? null,
          amount: product.amount,
          rtv: product.rtv,
          netWeight: product.netWeight,
          grossWeight: product.grossWeight,
          packingMaterialWeight: product.packingMaterialWeight,
          revisedRate: product.revisedRate,
          revisedQuantity: product.revisedQuantity,
          purchaseDate: product.purchaseDate,
          dispatchDate: product.dispatchDate,
          deliveryDate: product.deliveryDate,
          expectedHarvestDate: product.expectedHarvestDate,
        })),
      };
      await this.cacheService.set(cacheKey, viewResult, this.CACHE_TTL);
      return viewResult;
    }

    throw new Error('Document type ID not found for document');
  }

  public async getGrnByIdForupdate(id: string): Promise<GrnDetailDto> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

     const document = await this.documentbService.getDocumentById(id)
    const id1 = document.documentTypeId;
    console.log('id in getGrnByIdForView', id);

    const grn = await this.grnRepository.findOne({
      where: { id: id1 },
      relations: [
        'companyName',
        'grnProducts',
        'grnProducts.productName',
        'grnProducts.uom',
        'grnProducts.variant',
        'selectedFarmer',
        'selectedVendor',
       'purchaseInstructionsBy',

        'paymentInfo',
        'dealSlipId',
        'purchaseForSalesLocation',
        'purchaseLocation',
        'createdBy',
        'purchaseBy',
      ],
    });

    if (!grn) {
      throw new Error('GRN not found');
    }

    let selectedPartyId: string | null = null;
    if (grn.source === 'vendor' && grn.selectedVendor) {
      selectedPartyId = grn.selectedVendor.id;
    } else if (grn.source === 'farmer' && grn.selectedFarmer) {
      selectedPartyId = grn.selectedFarmer.id;
    }
    const rawDate = grn.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);
    console.log(grn.timeIn);
    const updateResult: GrnDetailDto = {
      id: grn.id,
      ammountStatus: grn.ammountStatus,
      companyName: grn.companyName?.id ?? null,
      purchaseInstructionsBy: grn.purchaseInstructionsBy?.id || null,
      dealSlipId: grn.dealSlipId?.id || null,

      // dealSlipId: {
      //   id: grn.dealSlipId?.id || null,
      //   dealSlipNo: grn.dealSlipId?.dealSlipNo || null,
      // },
      purchaseType: grn.purchaseType,
      otherPurchaseForSalesLoc: grn.otherPurchaseForSalesLoc || null,
      otherPurchaseLoc: grn.otherPurchaseLoc || null,
      grnNo: grn.grnNo,
      locationType: grn.locationType,
      grnType: grn.grnType,
      rmn: grn.rmn,
      createdDate: createdDate,
      createdTime: createdTime,
      requestingDepartment: grn.requestingDepartment,
      purchaseLocation: grn.purchaseLocation?.id ?? null,
      purchaseForSalesLocation: grn.purchaseForSalesLocation?.id ?? null,
      selectedParty: selectedPartyId,
      source: grn.source,
      billNo: grn.billNo,
      billImage: grn.billImage,
      subTotalAmt: grn.subTotalAmt,
      freight: grn.freight,
      otherCharges: grn.otherCharges,
      totalAmt: grn.totalAmt,
      amtWords: grn.amtWords,
      purchasedBy: grn.purchasedBy,
      receivedThrough: grn.receivedThrough,
      vehicleNo: grn.vehicleNo,
      timeIn: grn.timeIn,
      cratesIn: grn.cratesIn,
      deliveryReceivingPerson: grn.deliveryReceivingPerson,
      baseLocation: grn.baseLocation,
      specialReq: grn.specialReq,
      securityPerson: grn.securityPerson,
      approvalNote: grn.approvalNote,
      remark: grn.remark,

      purchaseBy: grn.purchaseBy
        ? {
          firstName: grn.purchaseBy.firstName || '',
          lastName: grn.purchaseBy.lastName || '',
        }
        : null,

      paymentInfo: grn.paymentInfo
        ? {
          id: grn.paymentInfo.id,
          paymentMode: grn.paymentInfo.paymentMode,
          paymentDate: grn.paymentInfo.paymentDate,
          advancePaidAmt: grn.paymentInfo.advancePaidAmt,
          remainingAmt: grn.paymentInfo.remainingAmt,
          paymentTerms: grn.paymentInfo.paymentTerms,
          dueDate: grn.paymentInfo.dueDate,
          creditPeriod: grn.paymentInfo.creditPeriod,
        }
        : null,
      grnProducts: grn.grnProducts.map((product) => ({
        id: product.id,
        quantity: product.quantity,
        unitPrice: product.unitPrice,
        productName: product.productName?.id ?? null,
        variant: product.variant?.id || null,
        uom: product.uom?.id ?? null,

        amount: product.amount,
        rtv: product.rtv,
        netWeight: product.netWeight,
        grossWeight: product.grossWeight,
        packingMaterialWeight: product.packingMaterialWeight,
        revisedRate: product.revisedRate,
        revisedQuantity: product.revisedQuantity,
        purchaseDate: product.purchaseDate,
        dispatchDate: product.dispatchDate,
        deliveryDate: product.deliveryDate,
        expectedHarvestDate: product.expectedHarvestDate,
      })),
    };
    await this.cacheService.set(cacheKey, updateResult, this.CACHE_TTL);
    return updateResult;
  }

  public async updateGrn(
  id: string,
  grnData: UpdateGrnDto,
  updatedBy: string | any,
): Promise<any> {
  // Safely extract just the UUID — controller may pass full User object
  const modifiedByUserId: string =
    typeof updatedBy === 'string' ? updatedBy : updatedBy?.id ?? updatedBy;
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // Fetch the current GRN with its products inside the transaction
    const grn = await queryRunner.manager.findOne(this.grnRepository.target, {
      where: { id },
      relations: [
        'companyName',
        'purchaseInstructionsBy',
        'purchaseLocation',
        'purchaseForSalesLocation',
        'dealSlipId',
        'selectedVendor',
        'selectedFarmer',
        'purchaseBy',
        'paymentInfo',
        'grnProducts',
        'grnProducts.productName',
        'grnProducts.uom',
        'grnProducts.variant',
      ],
    });

    if (!grn) {
      await queryRunner.rollbackTransaction();
      return null;
    }

    const originalGrn = { ...grn };

    // ── Build history records before applying the update ─────────────────────
    if (grnData.grnProducts && grnData.grnProducts.length > 0) {
      // Build a map of existing products by id for quick lookup
      const existingProductMap = new Map(
        grn.grnProducts.map((p) => [p.id, p]),
      );

      const historyRecords = grnData.grnProducts
        .filter((incoming) => incoming.id && existingProductMap.has(incoming.id!))
        .map((incoming) => {
          const existing = existingProductMap.get(incoming.id!)!;
          return {
            grnId: grn.id,
            grnProductId: existing.id,
            productId: existing.productName?.id ?? null,
            variantId: existing.variant?.id ?? null,
            oldQuantity: Number(existing.quantity ?? 0),
            newQuantity: Number(incoming.quantity ?? existing.quantity ?? 0),
            oldRate: Number(existing.unitPrice ?? 0),
            newRate: Number(incoming.unitPrice ?? existing.unitPrice ?? 0),
            modifiedById: modifiedByUserId,
          };
        });

      // Requirement 2, 3, 12 — only writes rows where qty or rate actually changed
      await this.grnProductHistoryService.createHistoryForChangedProducts(
        queryRunner.manager,
        historyRecords,
      );
    }

    // ── Apply the update to the GRN ──────────────────────────────────────────
    const payload = { ...grnData } as any;
    delete payload.id;
    delete payload.variants;

    const relatedFields: any = {};

    if (payload.companyName) relatedFields.companyName = { id: payload.companyName };
    if (payload.purchaseInstructionsBy) relatedFields.purchaseInstructionsBy = { id: payload.purchaseInstructionsBy };
    if (payload.purchaseLocation) relatedFields.purchaseLocation = { id: payload.purchaseLocation };
    if (payload.purchaseForSalesLocation) relatedFields.purchaseForSalesLocation = { id: payload.purchaseForSalesLocation };
    if (payload.dealSlipId) relatedFields.dealSlipId = { id: payload.dealSlipId };
    if (payload.selectedVendor) {
      relatedFields.selectedVendor =
        typeof payload.selectedVendor === 'string'
          ? { id: payload.selectedVendor }
          : payload.selectedVendor;
    }
    if (payload.selectedFarmer) {
      relatedFields.selectedFarmer =
        typeof payload.selectedFarmer === 'string'
          ? { id: payload.selectedFarmer }
          : payload.selectedFarmer;
    }
    if (payload.purchaseBy) relatedFields.purchaseBy = { id: payload.purchaseBy };
    if ('paymentInfo' in payload) {
      relatedFields.paymentInfo = payload.paymentInfo
        ? {
            id: payload.paymentInfo.id,
            paymentMode: payload.paymentInfo.paymentMode,
            paymentDate: payload.paymentInfo.paymentDate,
            advancePaidAmt: payload.paymentInfo.advancePaidAmt,
            remainingAmt: payload.paymentInfo.remainingAmt,
            paymentTerms: payload.paymentInfo.paymentTerms,
            dueDate: payload.paymentInfo.dueDate,
            creditPeriod: payload.paymentInfo.creditPeriod,
          }
        : null;
    }
    if (payload.grnProducts) {
      relatedFields.grnProducts = payload.grnProducts.map((product: any) => ({
        id: product.id,
        quantity: product.quantity,
        unitPrice: product.unitPrice,
        productName: product.productName ? { id: product.productName } : undefined,
        variant: product.variant ? { id: product.variant } : undefined,
        uom: product.uom ? { id: product.uom } : undefined,
        amount: product.amount,
        rtv: product.rtv,
        netWeight: product.netWeight,
        grossWeight: product.grossWeight,
        packingMaterialWeight: product.packingMaterialWeight,
        revisedRate: product.revisedRate,
        revisedQuantity: product.revisedQuantity,
        purchaseDate: product.purchaseDate,
        dispatchDate: product.dispatchDate,
        deliveryDate: product.deliveryDate,
        expectedHarvestDate: product.expectedHarvestDate,
      }));
    }

    const scalarPayload = { ...payload };
    [
      'companyName',
      'purchaseInstructionsBy',
      'purchaseLocation',
      'purchaseForSalesLocation',
      'dealSlipId',
      'selectedVendor',
      'selectedFarmer',
      'purchaseBy',
      'paymentInfo',
      'grnProducts',
    ].forEach((key) => delete scalarPayload[key]);

    Object.assign(grn, scalarPayload, relatedFields);

    const updatedGrn = await queryRunner.manager.save(this.grnRepository.target, grn);

    // If document is approved and GRN is edited, reset status back to hold
    // Use queryRunner.manager to stay within the same transaction
    const document = await queryRunner.manager.findOne(this.documentbRepository.target, {
      where: { document_type_id: id },
    });
    if (!document) {
      await queryRunner.rollbackTransaction();
      throw new AppError(404, 'Document not found');
    }
    let approvalFlowNeedsRestart = false;

    // These statuses mean the document has progressed through the approval flow.
    // If the GRN is edited at any of these stages, reset back to HOLD so the
    // entire approval cycle restarts from scratch.
    const progressedStatuses = new Set([
      DocumentStatus.VERIFIED,
      DocumentStatus.APPROVED,
      DocumentStatus.FINALIZING,
      DocumentStatus.FINALIZED,
      DocumentStatus.COMPLETE,
    ]);

    if (progressedStatuses.has(document.status)) {
      document.status = DocumentStatus.HOLD;
      document.approvalInfo = null as any;
      document.remarks = 'Document reset to hold due to GRN edit after approval';
      await queryRunner.manager.save(this.documentbRepository.target, document);
      approvalFlowNeedsRestart = true;
    }

    await queryRunner.commitTransaction();

    // Re-start the approval flow if the document was reset (after commit so
    // the document is visible to startApprovalFlow's DB connection)
    if (approvalFlowNeedsRestart) {
      try {
        await this.documentbService.startApprovalFlow(document.id);
      } catch (_) { /* non-critical — log if needed */ }
    }

    // ── Clear ALL caches (Redis + TypeORM query cache) ───────────────────────
    await this.auditLogService.logChange('GRN', grn.id, originalGrn, grnData, modifiedByUserId);

    // 1. TypeORM database query cache — clears stale getAllGrns / getById queries
    try {
      await this.dataSource.queryResultCache?.clear();
    } catch (_) { /* non-critical */ }

    // 2. Redis cache — grn:all:*, grn:numbers:*, grn:id:grnId etc.
    await this.invalidateCache(id);

    // 3. Redis cache — grn:view:docId and grn:update:docId (keyed by document id)
    try {
      const doc = await this.documentbRepository.findOne({
        where: { document_type_id: id } as any,
        select: ['id'] as any,
      });
      if (doc?.id) {
        await Promise.all([
          this.cacheService.del(`${this.CACHE_PREFIX}:view:${doc.id}`),
          this.cacheService.del(`${this.CACHE_PREFIX}:update:${doc.id}`),
        ]);
      }
    } catch (_) { /* non-critical */ }

    return updatedGrn;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error('Error updating GRN:', error);
    throw error;
  } finally {
    await queryRunner.release();
  }
}

  /** Fetch the product-level edit history for an entire GRN (by GRN id). */
  public async getGrnProductHistory(grnId: string): Promise<any[]> {
    const records = await this.grnProductHistoryService.getHistoryByGrnId(grnId);
    return records.map((r) => ({
      id: r.id,
      grnId: r.grn?.id,
      grnNo: r.grn?.grnNo ?? null,
      grnProductId: r.grnProduct?.id,
      productId: r.product?.id ?? null,
      productName: r.product?.name ?? null,
      variantId: r.variant?.id ?? null,
      variantName: r.variant?.variantName ?? null,
      version: r.version,
      oldQuantity: r.oldQuantity,
      newQuantity: r.newQuantity,
      oldRate: r.oldRate,
      newRate: r.newRate,
      modifiedBy: r.modifiedBy
        ? `${r.modifiedBy.firstName ?? ''} ${r.modifiedBy.lastName ?? ''}`.trim()
        : null,
      modifiedDate: formatDateTime(r.modifiedAt).createdDate,
      modifiedTime: formatDateTime(r.modifiedAt).createdTime,
    }));
  }

  public async deleteGrn(id: string): Promise<DeleteResultDto | null> {
    const exists = await this.grnRepository.count({ where: { id } });
    if (!exists) throw new AppError(404, `GRN with ID ${id} not found`);

    const grn=await this.grnRepository.findOne({where:{id}});
    if(!grn)
    {
      throw new AppError(404,`Grn With ID ${id} not found`);
    }
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    await this.grnRepository.update({ id }, { deletionScheduledAt: sixMonthsFromNow } as any);
    await this.invalidateCache(id);
    return {No:grn.grnNo};
  }

  /**
   * Update the ammountStatus (paid / unpaid) of a GRN by its ID.
   */
  public async updateAmountStatus(
    id: string,
    status: ammountStatus,
  ): Promise<{ id: string; ammountStatus: ammountStatus }> {
    console.log(id)
    const grn = await this.grnRepository.findOne({ where: { id }, withDeleted: true });
    if (!grn) throw new AppError(404, `GRN with ID ${id} not found`);

    grn.ammountStatus = status;
    await this.grnRepository.save(grn);

    // Invalidate grn:all:*, grn:numbers:*, grn:id:grnId etc.
    await this.invalidateCache(id);

    // Also invalidate grn:view:docId and grn:update:docId (keyed by document id, not grn id)
    try {
      const doc = await this.documentbRepository.findOne({
        where: { document_type_id: id } as any,
        select: ['id'] as any,
      });
      if (doc?.id) {
        await Promise.all([
          this.cacheService.del(`${this.CACHE_PREFIX}:view:${doc.id}`),
          this.cacheService.del(`${this.CACHE_PREFIX}:update:${doc.id}`),
        ]);
      }
    } catch (_) { /* non-critical */ }

    return { id: grn.id, ammountStatus: grn.ammountStatus };
  }





  public async getAllGrnNumbers(
  filter: {
    overAllStatus?: string;
    isAQRCreated?: boolean;
    isInwardCreated?: boolean;
    isDumpCreated?: boolean;
    isDCForCustomerCreated?: boolean;
    isMCVoucherCreated?: boolean;
    isTPVoucherCreated?: boolean;
    isPMPVoucherCreated?: boolean;
    isLPVoucherCreated?: boolean;
    employeeBaseHirechey?: boolean;
    page?: number;
    limit?: number;
    search?: string;
  },
  loginUserId: string
): Promise<any> {

  const hash = createHash('md5').update(`${loginUserId}:${JSON.stringify(filter)}`).digest('hex');
  const cacheKey = `${this.CACHE_PREFIX}:numbers:${hash}`;
  const cached = await this.cacheService.get<any>(cacheKey);
  if (cached) return cached;

  const page = filter.page || 1;
  const limit = filter.limit || 10;

  const where: any = {};

  if (typeof filter?.isAQRCreated === "boolean") where.isAQRCreated = filter.isAQRCreated;
  if (typeof filter?.isInwardCreated === "boolean") where.isInwardCreated = filter.isInwardCreated;
  if (typeof filter?.isDumpCreated === "boolean") where.isDumpCreated = filter.isDumpCreated;
  if (typeof filter?.isDCForCustomerCreated === "boolean") where.isDCForCustomerCreated = filter.isDCForCustomerCreated;
  if (typeof filter?.isMCVoucherCreated === "boolean") where.isMCVoucherCreated = filter.isMCVoucherCreated;
  if (typeof filter?.isTPVoucherCreated === "boolean") where.isTPVoucherCreated = filter.isTPVoucherCreated;
  if (typeof filter?.isPMPVoucherCreated === "boolean") where.isPMPVoucherCreated = filter.isPMPVoucherCreated;
  if (typeof filter?.isLPVoucherCreated === "boolean") where.isLPVoucherCreated = filter.isLPVoucherCreated;

  const grns = await this.grnRepository.find({
    select: [
      "id",
      "grnNo",
      "isAQRCreated",
      "isInwardCreated",
      "isDumpCreated",
      "isDCForCustomerCreated",
      "isMCVoucherCreated",
      "isTPVoucherCreated",
      "isPMPVoucherCreated",
      "isLPVoucherCreated"
    ],
    where,
    relations: ["createdBy"],
    order: { createdAt: "DESC" }
  });

  if (!grns.length) {
    return {
      data: [],
      pagination: {
        total: 0,
        page,
        limit,
        totalPages: 0
      }
    };
  }

  const grnIds = grns.map(g => g.id);
  const creatorIds = [...new Set(grns.map(g => g.createdBy?.id))];

  const documents = await this.documentbRepository
    .createQueryBuilder("doc")
    .select(["doc.id", "doc.status", "doc.document_type_id"])
    .where("doc.document_type_id IN (:...ids)", { ids: grnIds })
    .getMany();

  const documentMap = new Map(
    documents.map(d => [d.document_type_id, d])
  );

  const approvalFlows = await this.approvalFlowRepository
    .createQueryBuilder("approvalflows")

    .leftJoinAndSelect("approvalflows.creator", "creator")
    .leftJoinAndSelect("approvalflows.verifiers", "verifiers")

    .leftJoinAndSelect("approvalflows.approvers", "approvers")

    .leftJoinAndSelect("approvers.firstApprover", "firstApprover")
    .leftJoinAndSelect("firstApprover.users", "firstApproverUsers")

    .leftJoinAndSelect("approvers.secondApprover", "secondApprover")
    .leftJoinAndSelect("secondApprover.users", "secondApproverUsers")

    .leftJoinAndSelect("approvers.thirdApprover", "thirdApprover")
    .leftJoinAndSelect("thirdApprover.users", "thirdApproverUsers")

    .leftJoinAndSelect("approvalflows.finalizers", "finalizers")
    .leftJoinAndSelect("finalizers.firstFinalizers", "firstFinalizers")
    .leftJoinAndSelect("finalizers.secondFinalizers", "secondFinalizers")

    .where("creator.id IN (:...ids)", { ids: creatorIds })
    .andWhere("approvalflows.type = :documentType", { documentType: "Procurement" })

    .getMany();

  const flowMap = new Map(
    approvalFlows.map(f => [f.creator?.id, f])
  );

  const filteredResults: {
    id: string;
    grnNo: string;
    documentId: string | null;
  }[] = [];

  for (const grn of grns) {

    const document = documentMap.get(grn.id);
    const documentId = document?.id || null;
    const documentStatus = document?.status;

    if (filter?.employeeBaseHirechey) {

      const approvalFlow = flowMap.get(grn.createdBy?.id);

      if (!approvalFlow) continue;

      let hierarchy = 0;

      if (approvalFlow.creator?.id === loginUserId) hierarchy = 1;
      else if (approvalFlow.verifiers?.some(v => v.id === loginUserId)) hierarchy = 2;
      else if (approvalFlow.approvers?.firstApprover?.users?.some(u => u.id === loginUserId)) hierarchy = 3;
      else if (approvalFlow.approvers?.secondApprover?.users?.some(u => u.id === loginUserId)) hierarchy = 4;
      else if (approvalFlow.approvers?.thirdApprover?.users?.some(u => u.id === loginUserId)) hierarchy = 5;
      else if (approvalFlow.finalizers?.firstFinalizers?.some(u => u.id === loginUserId)) hierarchy = 6;
      else if (approvalFlow.finalizers?.secondFinalizers?.some(u => u.id === loginUserId)) hierarchy = 7;

      if (hierarchy === 0) continue;

      if (hierarchy === 1 && grn.createdBy?.id !== loginUserId) continue;
    }

    if (filter?.overAllStatus) {
      if (documentStatus === filter.overAllStatus) {
        filteredResults.push({
          id: grn.id,
          grnNo: grn.grnNo,
          documentId
        });
      }
    } else {
      filteredResults.push({
        id: grn.id,
        grnNo: grn.grnNo,
        documentId
      });
    }
  }

  let searchedResults = filteredResults;

  if (filter?.search) {
    const search = filter.search.toLowerCase().trim();
    searchedResults = filteredResults.filter(r =>
      r.grnNo.toLowerCase().includes(search) ||
      r.id.toLowerCase() === search  // exact ID match
    );
  }

  const start = (page - 1) * limit;

  const paginatedResults = searchedResults.slice(start, start + limit);

  const numbersResult = {
    data: paginatedResults,
    pagination: {
      total: searchedResults.length,
      page,
      limit,
      totalPages: Math.ceil(searchedResults.length / limit)
    }
  };
  await this.cacheService.set(cacheKey, numbersResult, this.CACHE_TTL);
  return numbersResult;
}

  private async generateSerialNo(prefix: string): Promise<string> {
    const count = await this.grnRepository.count({
      where: { grnNo: ILike(`${prefix}%`) },
    });
    console.log(count);
    const serialNo = `${prefix}-${(count + 1).toString().padStart(5, '0')}`;
    return serialNo;
  }

  public async deleteMultipleGrns(ids: string[]):Promise<BulkDeleteResultDto> {
    //if (!ids.length) return { message: 'No IDs provided' };

     const success: { id: string; No: string }[] = [];
    const failed: { id: string; reason: string }[] = [];
    const [grns, relatedDocuments] = await Promise.all([
      this.grnRepository.find({ where: { id: In(ids) } }),
      this.documentbRepository
        .createQueryBuilder('doc')
        .select(['doc.id', 'doc.document_type_id'])
        .where('doc.document_type_id IN (:...ids)', { ids })
        .getMany(),
    ]);

    const foundIds = new Set(grns.map(g => g.id));
    const missingId = ids.find(id => !foundIds.has(id));
    if (missingId) throw new Error(`GRN with ID ${missingId} not found`);

    const docIds = relatedDocuments.map(d => d.id);
    if (docIds.length) {
      await Promise.all([
        this.documentbRepository.softDelete(docIds),
        this.documentbRepository.createQueryBuilder().update().set({ isDeleted: true } as any).whereInIds(docIds).execute(),
      ]);
    }

    await Promise.all([
      this.grnRepository.softDelete(ids),
      this.grnRepository.createQueryBuilder().update().set({ isDeleted: true } as any).whereInIds(ids).execute(),
    ]);

    await Promise.all(ids.map(id => this.invalidateCache(id)));
    grns.map((v)=>{
      success.push({ id:v.id, No: v.grnNo });
    })

    return { success,failed,message: 'GRN records marked for deletion successfully' };
  }

}



  // async generateGRNNo(): Promise<string> {
  //   const today = new Date();
  //   const datePart = today.toISOString().slice(0, 10).replace(/-/g, ''); // Generate date part in YYYYMMDD format

  //   const startOfDay = new Date(
  //     today.getFullYear(),
  //     today.getMonth(),
  //     today.getDate(),
  //     0,
  //     0,
  //     0,
  //   );
  //   const endOfDay = new Date(
  //     today.getFullYear(),
  //     today.getMonth(),
  //     today.getDate() + 1,
  //     0,
  //     0,
  //     0,
  //   );

  //   const lastGRN = await this.grnRepository.findOne({
  //     where: [
  //       { createdAt: MoreThanOrEqual(startOfDay) },
  //       { createdAt: LessThan(endOfDay) },
  //     ],
  //     order: { createdAt: 'DESC' }, // Order by creation time, descending
  //   });

  //   const sequenceNumber = lastGRN ? parseInt(lastGRN.grnNo.slice(-4)) + 1 : 1;

  //   return `${datePart}${sequenceNumber.toString().padStart(4, '0')}`;
  // }


  // public async getGrnDetails(grnId: string): Promise<GRN | null> {
  //   const cacheKey = `${this.CACHE_PREFIX}:details:${grnId}`;
  //   const cached = await this.cacheService.get<GRN | null>(cacheKey);
  //   if (cached) return cached;

  //   const result = await this.grnRepository
  //     .createQueryBuilder('grn')
  //     .leftJoinAndSelect('grn.selectedVendor', 'selectedVendor')
  //     .leftJoinAndSelect('grn.grnProducts', 'grnProducts')
  //     .leftJoinAndSelect('grn.purchaseForWhich', 'purchaseForWhich')
  //     .leftJoinAndSelect('grn.purchaseLocation', 'purchaseLocation')
  //     .where('grn.id = :grnId', { grnId })
  //     .getOne();

  //   if (result) await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
  //   return result;
  // }





// public async getGrnById(id: string): Promise<any> {
  //   const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
  //   const cached = await this.cacheService.get<any>(cacheKey);
  //   if (cached) return cached;

  //   const grn = await this.grnRepository.findOne({
  //     where: { id },
  //     relations: [
  //       'companyName',
  //       'grnProducts',
  //       'grnProducts.productName',
  //       'grnProducts.uom',
  //       'selectedFarmer',
  //       'selectedVendor',
  //       'paymentInfo',
  //       'dealSlipId',
  //       'purchaseForSalesLocation',
  //       'purchaseLocation',
  //       'purchaseBy',
  //     ],
  //   });

  //   if (!grn) {
  //     throw new Error('GRN not found');
  //   }

  //   let selectedPartyId: string | null = null;
  //   if (grn.source === 'vendor' && grn.selectedVendor) {
  //     selectedPartyId = grn.selectedVendor.id;
  //   } else if (grn.source === 'farmer' && grn.selectedFarmer) {
  //     selectedPartyId = grn.selectedFarmer.id;
  //   }
  //   const rawDate = grn.createdAt;
  //   const { createdDate, createdTime } = formatDateTime(rawDate);
  //   console.log(grn.timeIn);
  //   const result = {
  //     id: grn.id,
  //     companyName: grn.companyName?.id ?? null,
  //     purchaseInstructionsBy: grn.purchaseInstructionsBy,
  //     dealSlipId: {
  //       id: grn.dealSlipId?.id || null,
  //       dealSlipNo: grn.dealSlipId?.dealSlipNo || null,
  //     },
  //     purchaseType: grn.purchaseType,
  //     otherPurchaseForSalesLoc: grn.otherPurchaseForSalesLoc || null,
  //     otherPurchaseLoc: grn.otherPurchaseLoc || null,
  //     grnNo: grn.grnNo,
  //     locationType: grn.locationType,
  //     grnType: grn.grnType,
  //     rmn: grn.rmn,
  //     createdDate: createdDate,
  //     createdTime: createdTime,
  //     requestingDepartment: grn.requestingDepartment,
  //     purchaseLocation: grn.purchaseLocation?.id ?? null,
  //     purchaseForSalesLocation: grn.purchaseForSalesLocation?.id ?? null,
  //     selectedParty: selectedPartyId,
  //     source: grn.source,
  //     billNo: grn.billNo,
  //     billImage: grn.billImage,
  //     subTotalAmt: grn.subTotalAmt,
  //     freight: grn.freight,
  //     otherCharges: grn.otherCharges,
  //     totalAmt: grn.totalAmt,
  //     amtWords: grn.amtWords,
  //     purchasedBy: grn.purchasedBy,
  //     receivedThrough: grn.receivedThrough,
  //     vehicleNo: grn.vehicleNo,
  //     timeIn: grn.timeIn,
  //     cratesIn: grn.cratesIn,
  //     deliveryReceivingPerson: grn.deliveryReceivingPerson,
  //     baseLocation: grn.baseLocation,
  //     specialReq: grn.specialReq,
  //     securityPerson: grn.securityPerson,
  //     approvalNote: grn.approvalNote,
  //     remark: grn.remark,

  //     purchaseBy: {
  //       firstName: grn.purchaseBy?.firstName || '',
  //       lastName: grn.purchaseBy?.lastName || '',
  //     },

  //     paymentInfo: grn.paymentInfo
  //       ? {
  //         id: grn.paymentInfo.id,
  //         paymentMode: grn.paymentInfo.paymentMode,
  //         paymentDate: grn.paymentInfo.paymentDate,
  //         advancePaidAmt: grn.paymentInfo.advancePaidAmt,
  //         remainingAmt: grn.paymentInfo.remainingAmt,
  //         paymentTerms: grn.paymentInfo.paymentTerms,
  //         dueDate: grn.paymentInfo.dueDate,
  //         creditPeriod: grn.paymentInfo.creditPeriod,
  //       }
  //       : null,
  //     grnProducts: grn.grnProducts.map((product) => ({
  //       id: product.id,
  //       quantity: product.quantity,
  //       unitPrice: product.unitPrice,
  //       productName: product.productName?.id ?? null,
  //       uom: product.uom?.id ?? null,
  //       variant: product.variant?.id || null,
  //       amount: product.amount,
  //       rtv: product.rtv,
  //       netWeight: product.netWeight,
  //       grossWeight: product.grossWeight,
  //       packingMaterialWeight: product.packingMaterialWeight,
  //       revisedRate: product.revisedRate,
  //       revisedQuantity: product.revisedQuantity,
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