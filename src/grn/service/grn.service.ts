import { sourceDispatchStatuses } from '../../vehicleDispatch/service/dispatchRules';
import { DispatchType } from '../../vehicleDispatch/entity/vehicleDispatch.entity';
import { inject, injectable } from 'inversify';
import { CreatedWithApproval, withApproval } from '../../utils/approvalMessage';
import { TYPES } from '../../types';

import { ILike, In, LessThan, MoreThanOrEqual, DataSource, EntityManager } from 'typeorm';

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
import { GRN, GrnDeliveryMode } from '../entity/grn.entity';
import { ReceivingGuardService } from '../../receiving/service/receivingGuard.service';
import { completeDocumentExistsSql, isProcessingDocType, noCountingDocumentSql } from '../../receiving/receiving.sql';
import { assertDealSlipUsableForGrn, syncDealSlipGrnFlags, syncDealSlipGrnFlagsForGrns } from '../../dealSlip/dealSlipGrnLink';
import { isVoucherKind, liveVoucherForGrnExistsSql, VoucherKind, voucherKindFromLegacyFlags } from '../../vouchers/voucherGrnLink';
import { isUuid, latestDocumentStatusSql, liveRowSql, relationIdOf } from '../grnLinks.sql';

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
    @inject(TYPES.ReceivingGuardService) private readonly receivingGuardService: ReceivingGuardService,
  ) { }

  private readonly CACHE_PREFIX = 'grn';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:all:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:recycle:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:numbers:*`),
      // D-6: the deal slip number list derives "GRN created" from the GRNs.
      this.cacheService.invalidatePattern('dealslip:nos:*'),
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

  /** Trims the typed batch no; blank means "none". Rejects anything that is not letters and digits. */
  private normalizeBatchNo(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (!/^[A-Za-z0-9]{1,100}$/.test(text)) {
      throw new AppError(400, 'Batch no must contain only letters and digits (max 100 characters)');
    }
    return text;
  }

  /**
   * A batch no may be used by one live GRN per company (case-insensitive). A
   * deleted or rejected GRN releases its batch no, so the purchase can be
   * entered again under the same label. Creates of the same company + batch
   * serialise on an advisory lock held until the caller's transaction ends.
   */
  private async assertBatchNoUnique(
    manager: EntityManager,
    batchNo: string | null,
    companyId: string | null | undefined,
    excludeGrnId?: string,
  ): Promise<void> {
    if (!batchNo) return;
    const scope = `${companyId ?? ''}|${batchNo.toLowerCase()}`;
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext('grn-batch'), hashtext($1))`, [scope]);
    const rows: Array<{ grn_no: string | null }> = await manager.query(
      `SELECT g."grnNo" AS grn_no FROM grns g
        WHERE LOWER(g."batchNo") = LOWER($1)
          AND g.company_id IS NOT DISTINCT FROM $2
          AND COALESCE(g."isDeleted", false) = false AND g."deletedAt" IS NULL
          AND ($3::uuid IS NULL OR g.id <> $3::uuid)
          AND COALESCE((SELECT d.status::text FROM documents d
                         WHERE d.document_type_id = g.id::text AND d.type::text = $4
                         ORDER BY d."createdAt" DESC LIMIT 1), '') <> $5
        LIMIT 1`,
      [batchNo, companyId ?? null, excludeGrnId ?? null, DocumentTypeEnum.GRN, DocumentStatus.REJECT],
    );
    if (rows.length) {
      throw new AppError(409, `Batch no ${batchNo} is already used by GRN ${rows[0].grn_no ?? ''} of this company`.replace(/\s+of/, ' of'));
    }
  }

  /** Σ gross and Σ net weight of the lines (kg, 3 decimals); lines without a value count as 0. */
  private sumLineWeights(products: Array<{ grossWeight?: unknown; netWeight?: unknown }> | undefined | null): {
    totalGrossWeight: number;
    totalNetWeight: number;
  } {
    const sum = (pick: (p: { grossWeight?: unknown; netWeight?: unknown }) => unknown) =>
      Math.round((products ?? []).reduce((acc, p) => acc + (Number(pick(p)) || 0), 0) * 1000) / 1000;
    return { totalGrossWeight: sum((p) => p.grossWeight), totalNetWeight: sum((p) => p.netWeight) };
  }

  public async createGrn(grnData: CreateGrnDto): Promise<CreatedWithApproval<any>> {
    // Check if approval flow exists for the user
    if (!grnData.createdBy) {
      throw new AppError(400, 'createdBy field is required for approval flow validation');
    }
    await this.checkApprovalFlowExists(grnData.createdBy, DocDefEnum.PROCUREMENT);
    this.assertDeliveryMode(grnData.deliveryMode);
    // Receiving links D6: a GRN lists each product + variant once.
    this.receivingGuardService.assertNoDuplicateLines(
      (grnData.grnProducts ?? []).map((p) => ({ productId: p.productName ?? null, variantId: p.variant ?? null, uomId: p.uom ?? null })),
    );
    const batchNo = this.normalizeBatchNo(grnData.batchNo);
    // The batch no is the stock lot label carried to AQR / Inward / Dump / RTV and stock.
    if (!batchNo) throw new AppError(400, 'Batch no is required');

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

      const { variants: _discardVariants, ammountStatus: _discardPaymentStatus, ...grnPayload } = grnData as any;
      await this.assertBatchNoUnique(queryRunner.manager, batchNo, (grnData as { companyName?: string | null }).companyName ?? null);
      // D-6: the deal slip must be approved and not used by another live GRN.
      const dealSlipId = relationIdOf(grnPayload.dealSlipId);
      if (dealSlipId) await assertDealSlipUsableForGrn(queryRunner.manager, dealSlipId);
      const createPayload = {
        ...grnPayload,
        dealSlipId: dealSlipId ? { id: dealSlipId } : null,
        batchNo,
        // Totals are always derived from the lines; whatever the client sent is ignored.
        ...this.sumLineWeights(grnPayload.grnProducts),
        grnProducts: grnPayload.grnProducts?.map((product: any) => ({
          ...product,
          productName: product.productName ? { id: product.productName } : undefined,
          variant: product.variant ? { id: product.variant } : undefined,
          uom: product.uom ? { id: product.uom } : undefined,
          packagingMaterial: product.packagingMaterial ? { id: product.packagingMaterial } : null,
        })),
      };

      const grn = queryRunner.manager.create(this.grnRepository.target, createPayload as any);
      const savedGrn = await queryRunner.manager.save(grn) as GRN | GRN[];
      await syncDealSlipGrnFlags(queryRunner.manager, [dealSlipId]);
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

        const assignment = await this.documentbService.startApprovalFlow(document.id);

        await this.invalidateCache();
        return withApproval(savedGrn, assignment);
      } catch (error: any) {
        await queryRunner.rollbackTransaction();
        console.error('Error creating GRN:', error);
        throw error;
      } finally {
        await queryRunner.release();
      }
    }

public async getAllGrns(queryOptions: PaginationOptions, userId: string, isAdmin: boolean = false): Promise<{
    data: GrnListItemDto[];
    meta: { total: number; page: number; pages: number };
  }> {
    const hash = createHash('md5').update(`${userId}:${isAdmin ? 'admin' : 'user'}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:all:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { search } = queryOptions;
    const { data: allDocuments } = await this.documentbService.getAllDocumentByUserId(
      userId,
      DocumentTypeEnum.GRN,
      queryOptions,
      true,
      false,
      isAdmin,
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
          deliveryMode: related.deliveryMode || null,
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
          timeIn: related.timeIn || null,
          remark: related.remark || null,
          securityPerson: related.securityPerson || null,
          receivingPerson: related.receivingPerson || null,
          rmn: related.rmn || null,
          purchaseLocation: related.purchaseLocation?.name || null,
          purchaseForSalesLocation: related.purchaseForSalesLocation?.name || null,
          grnNo: related.grnNo || null,
          batchNo: related.batchNo || null,
          totalGrossWeight: related.totalGrossWeight ?? null,
          totalNetWeight: related.totalNetWeight ?? null,
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
          'grnProducts.packagingMaterial',
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
        batchNo: grn.batchNo ?? null,
        totalGrossWeight: grn.totalGrossWeight ?? null,
        totalNetWeight: grn.totalNetWeight ?? null,
        locationType: grn.locationType,
        grnType: grn.grnType,
        deliveryMode: grn.deliveryMode ?? null,
        rmn: grn.rmn,
        createdDate: createdDate,
        createdTime: createdTime,
        createdBy:`${grn.createdBy.firstName} ${grn.createdBy.lastName}`.trim() || null,
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
        timeIn: grn.timeIn,
        cratesIn: grn.cratesIn,
        receivingPerson: grn.receivingPerson,
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
          packagingMaterial: product.packagingMaterial?.packagingMaterialName ?? null,
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
        'grnProducts.packagingMaterial',
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
      batchNo: grn.batchNo ?? null,
      totalGrossWeight: grn.totalGrossWeight ?? null,
      totalNetWeight: grn.totalNetWeight ?? null,
      locationType: grn.locationType,
      grnType: grn.grnType,
      deliveryMode: grn.deliveryMode ?? null,
      rmn: grn.rmn,
      createdDate: createdDate,
      createdTime: createdTime,
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
      timeIn: grn.timeIn,
      cratesIn: grn.cratesIn,
      receivingPerson: grn.receivingPerson,
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
        packagingMaterial: product.packagingMaterial?.id ?? null,

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
  this.assertDeliveryMode(grnData.deliveryMode);
  if (grnData.grnProducts) {
    this.receivingGuardService.assertNoDuplicateLines(
      grnData.grnProducts.map((p) => ({ productId: p.productName ?? null, variantId: p.variant ?? null, uomId: p.uom ?? null })),
    );
  }
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // Receiving links R9: a GRN that already has an AQR / Inward / Dump / RTV cannot change.
    await this.receivingGuardService.assertSourceEditable('grn', id, queryRunner.manager);
    // D-5: once its purchase dispatch is approved the goods have left on that vehicle.
    await this.assertNoApprovedDispatch(queryRunner.manager, id, 'edited');
    // A GRN can be edited only until its approval process is complete.
    await this.assertApprovalNotComplete(queryRunner.manager, id);

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
    // D-6: pointing the GRN at a different deal slip re-checks that slip (approved, unused).
    const previousDealSlipId = grn.dealSlipId?.id ?? null;
    const nextDealSlipId = relationIdOf(payload.dealSlipId);
    if (nextDealSlipId && nextDealSlipId !== previousDealSlipId) {
      await assertDealSlipUsableForGrn(queryRunner.manager, nextDealSlipId, id);
    }
    if (nextDealSlipId) relatedFields.dealSlipId = { id: nextDealSlipId };
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
        // The edit form sends every line in full and omits blank values, so an absent
        // packaging material means "none selected".
        packagingMaterial: product.packagingMaterial ? { id: product.packagingMaterial } : null,
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
    // Payment status changes only through its own action (after approval and receipt).
    delete (scalarPayload as Record<string, unknown>).ammountStatus;
    // Totals are derived from the lines, never taken from the client.
    delete scalarPayload.totalGrossWeight;
    delete scalarPayload.totalNetWeight;
    if ('batchNo' in payload || payload.companyName) {
      const nextBatchNo = 'batchNo' in payload ? this.normalizeBatchNo(payload.batchNo) : (grn.batchNo ?? null);
      // Once a GRN has a batch no it cannot be removed (older GRNs without one may stay without).
      if (!nextBatchNo && grn.batchNo) throw new AppError(400, 'Batch no is required');
      if ('batchNo' in payload) scalarPayload.batchNo = nextBatchNo;
      await this.assertBatchNoUnique(queryRunner.manager, nextBatchNo, payload.companyName ?? grn.companyName?.id ?? null, id);
    }
    if (payload.grnProducts) {
      Object.assign(scalarPayload, this.sumLineWeights(payload.grnProducts));
    }
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
    if (nextDealSlipId && nextDealSlipId !== previousDealSlipId) {
      await syncDealSlipGrnFlags(queryRunner.manager, [previousDealSlipId, nextDealSlipId]);
    }

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

  /** Newest approval status of the GRN. */
  private async grnApprovalStatus(manager: EntityManager, grnId: string): Promise<string | null> {
    const rows: Array<{ status: string | null }> = await manager.query(
      `SELECT d.status::text AS status FROM documents d WHERE d.document_type_id = $1 AND d.type::text = $2 ORDER BY d."createdAt" DESC LIMIT 1`,
      [grnId, DocumentTypeEnum.GRN],
    );
    return rows[0]?.status ?? null;
  }

  /** A GRN can be edited only until its approval process is complete. */
  private async assertApprovalNotComplete(manager: EntityManager, grnId: string): Promise<void> {
    if ((await this.grnApprovalStatus(manager, grnId)) === DocumentStatus.COMPLETE) {
      const no = await manager.query(`SELECT "grnNo" AS no FROM grns WHERE id = $1`, [grnId]);
      throw new AppError(409, `GRN ${no[0]?.no ?? ''} has completed its approval, so it can no longer be edited`.replace(/\s+/g, ' '));
    }
  }

  /**
   * Why the payment status cannot change yet, or null: the approval must be
   * complete and the goods received (an approved Inward Register of the GRN).
   */
  private async paymentStatusBlockedReason(manager: EntityManager, grnId: string, grnNo: string): Promise<string | null> {
    if ((await this.grnApprovalStatus(manager, grnId)) !== DocumentStatus.COMPLETE) {
      return `GRN ${grnNo} has not completed its approval yet, so its payment status cannot change`;
    }
    const received: Array<{ n: string }> = await manager.query(
      `SELECT COUNT(*) AS n FROM inward_register ir
        WHERE ir.grn_id = $1 AND COALESCE(ir."isDeleted", false) = false AND ir."deletedAt" IS NULL
          AND (SELECT d.status::text FROM documents d WHERE d.document_type_id = ir.id::text AND d.type::text = $2
                ORDER BY d."createdAt" DESC LIMIT 1) = $3`,
      [grnId, DocumentTypeEnum.INWARD_REGISTER, DocumentStatus.COMPLETE],
    );
    if (Number(received[0]?.n ?? 0) === 0) {
      return `The goods of GRN ${grnNo} are not received yet (no approved Inward Register), so its payment status cannot change`;
    }
    return null;
  }

  /** D-5: a GRN whose purchase dispatch is approved cannot be edited or deleted (the goods have left). */
  private async assertNoApprovedDispatch(manager: EntityManager, grnId: string, action: 'edited' | 'deleted'): Promise<void> {
    const status = (await sourceDispatchStatuses(manager, DispatchType.PURCHASE, [grnId]))[grnId];
    if (status?.status === 'approved') {
      const no = await manager.query(`SELECT "grnNo" AS no FROM grns WHERE id = $1`, [grnId]);
      throw new AppError(
        409,
        `GRN ${no[0]?.no ?? ''} has an approved purchase dispatch (${status.vehicleDispatchNo ?? ''}), so it cannot be ${action}`.replace(/\s+/g, ' '),
      );
    }
  }

  public async deleteGrn(id: string): Promise<DeleteResultDto | null> {
    const exists = await this.grnRepository.count({ where: { id } });
    if (!exists) throw new AppError(404, `GRN with ID ${id} not found`);

    const grn=await this.grnRepository.findOne({where:{id}});
    if(!grn)
    {
      throw new AppError(404,`Grn With ID ${id} not found`);
    }
    // Receiving links R10: not while a processing document counts against it.
    await this.receivingGuardService.assertSourceEditable('grn', id);
    await this.assertNoApprovedDispatch(this.dataSource.manager, id, 'deleted');
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    await this.grnRepository.update({ id }, { deletionScheduledAt: sixMonthsFromNow } as any);
    // D-5: its pending purchase dispatch is rejected, as on the bulk delete.
    await this.documentbService.rejectDispatchesForSource(DocumentTypeEnum.GRN, [id], 'deleted', `GRN ${grn.grnNo ?? ''}`.trim());
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
    if (!Object.values(ammountStatus).includes(status)) {
      throw new AppError(400, `Payment status must be one of ${Object.values(ammountStatus).join(', ')}`);
    }
    const grn = await this.grnRepository.findOne({ where: { id } });
    if (!grn || grn.isDeleted) throw new AppError(404, `GRN with ID ${id} not found`);

    // Payment status changes only after the approval is complete and the goods are received.
    const blocked = await this.paymentStatusBlockedReason(this.dataSource.manager, id, grn.grnNo ?? '');
    if (blocked) throw new AppError(409, blocked);

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
    isVehicleDispatchCreated?: boolean;
    employeeBaseHirechey?: boolean;
    page?: number;
    limit?: number;
    search?: string;
    /** Receiving picker: only COMPLETE, cc-dc, not deleted GRNs. */
    receivable?: boolean;
    /** Receiving picker: only GRNs with no counting document of this type (aqr | inward | dump | rtv). */
    missing?: string;
    /** Receiving picker: purchase-for (receiving) location id. */
    locationId?: string;
    /** Voucher picker (D-6): only GRNs with no live, non-rejected voucher of this type (mc | tp | pmp | lp). */
    missingVoucher?: string;
    /** Voucher picker: always list this GRN (the voucher being edited keeps its own GRN). */
    includeId?: string;
  },
  loginUserId: string
): Promise<any> {

  if (filter?.receivable || filter?.missing || filter?.locationId) {
    return this.getReceivableGrnNumbers(filter);
  }

  if (filter?.missingVoucher !== undefined && filter.missingVoucher !== '' && !isVoucherKind(filter.missingVoucher)) {
    throw new AppError(400, 'missingVoucher must be one of mc, tp, pmp, lp');
  }
  // The legacy `is*VoucherCreated=false` flags were never written; they now mean `missingVoucher`.
  const missingVoucher = isVoucherKind(filter?.missingVoucher)
    ? filter.missingVoucher
    : voucherKindFromLegacyFlags(filter as Record<string, unknown>);
  if (missingVoucher) {
    return this.getVoucherableGrnNumbers({ ...filter, missingVoucher });
  }

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
  if (typeof filter?.isVehicleDispatchCreated === "boolean") where.isVehicleDispatchCreated = filter.isVehicleDispatchCreated;

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
      "isLPVoucherCreated",
      "isVehicleDispatchCreated"
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

  private assertDeliveryMode(value: unknown): void {
    if (value === undefined || value === null || value === '') return;
    if (!Object.values(GrnDeliveryMode).includes(value as GrnDeliveryMode)) {
      throw new AppError(400, 'deliveryMode must be cc-dc or direct-to-customer');
    }
  }

  /**
   * Source picker for the receiving forms (AQR / Inward / Dump / RTV). All of
   * it runs in SQL:
   * - `receivable=true`  -> the GRN is COMPLETE (via `documents`), not deleted and `deliveryMode = cc-dc`;
   * - `missing=<type>`   -> no counting document of that type (aqr | inward | dump | rtv) references the GRN
   *                         (counting = not deleted and `documents.status` <> REJECT);
   * - `locationId`       -> purchase-for (receiving) location.
   * `search` matches `grnNo` (ILIKE) or the exact id; `page` / `limit` paginate.
   * The legacy `is*Created` / `overAllStatus` / `employeeBaseHirechey` flags do
   * not apply on this path. Not cached: the list changes the moment a document
   * is created or rejected.
   */
  private async getReceivableGrnNumbers(filter: {
    page?: number;
    limit?: number;
    search?: string;
    receivable?: boolean;
    missing?: string;
    locationId?: string;
  }): Promise<any> {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filter.limit) || 10));
    if (filter.missing !== undefined && filter.missing !== '' && !isProcessingDocType(filter.missing)) {
      throw new AppError(400, 'missing must be one of aqr, inward, dump, rtv');
    }

    const qb = this.grnRepository
      .createQueryBuilder('grn')
      .select(['grn.id', 'grn.grnNo', 'grn.createdAt'])
      .where('grn.isDeleted = false');

    if (filter.receivable) {
      qb.andWhere('grn.deliveryMode = :deliveryMode', { deliveryMode: GrnDeliveryMode.CC_DC });
      qb.andWhere(completeDocumentExistsSql('grn.id', 'grn'));
    }
    if (filter.missing && isProcessingDocType(filter.missing)) {
      qb.andWhere(noCountingDocumentSql('grn.id', 'grn', filter.missing));
    }
    if (filter.locationId) {
      qb.leftJoin('grn.purchaseForSalesLocation', 'receivingLocation')
        .andWhere('receivingLocation.id = :locationId', { locationId: String(filter.locationId) });
    }
    if (filter.search && String(filter.search).trim()) {
      const term = String(filter.search).trim();
      qb.andWhere('(grn.grnNo ILIKE :search OR grn.id::text = :exact)', { search: `%${term}%`, exact: term });
    }

    const [grns, total] = await qb
      .orderBy('grn.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const documentMap = new Map<string, string>();
    if (grns.length) {
      const documents = await this.documentbRepository
        .createQueryBuilder('doc')
        .select(['doc.id', 'doc.document_type_id', 'doc.createdAt'])
        .where('doc.type = :type', { type: DocumentTypeEnum.GRN })
        .andWhere('doc.document_type_id IN (:...ids)', { ids: grns.map((g) => g.id) })
        .orderBy('doc.createdAt', 'DESC')
        .getMany();
      for (const doc of documents) {
        if (doc.document_type_id && !documentMap.has(doc.document_type_id)) documentMap.set(doc.document_type_id, doc.id);
      }
    }

    const totalPages = Math.ceil(total / limit);
    return {
      data: grns.map((g) => ({ id: g.id, grnNo: g.grnNo, documentId: documentMap.get(g.id) ?? null })),
      pagination: { total, page, limit, totalPages, pages: totalPages },
    };
  }

  /**
   * GRN picker of the voucher forms (D-6), all in SQL: live GRNs (not deleted)
   * with no live, non-rejected voucher of `missingVoucher` referencing them;
   * `overAllStatus` matches the GRN's latest document status; `includeId` is
   * always listed (edit mode). `search` matches `grnNo` (ILIKE) or the exact id.
   * Not cached: the list changes the moment a voucher is created or rejected.
   */
  private async getVoucherableGrnNumbers(filter: {
    page?: number;
    limit?: number;
    search?: string;
    overAllStatus?: string;
    missingVoucher: VoucherKind;
    includeId?: string;
  }): Promise<any> {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filter.limit) || 10));

    const qb = this.grnRepository
      .createQueryBuilder('grn')
      .select(['grn.id', 'grn.grnNo', 'grn.createdAt'])
      .where(liveRowSql('grn'));

    const conditions: string[] = [`NOT ${liveVoucherForGrnExistsSql('grn.id', filter.missingVoucher)}`];
    const params: Record<string, unknown> = {};
    if (filter.overAllStatus) {
      conditions.push(`${latestDocumentStatusSql('grn.id', DocumentTypeEnum.GRN, 'grn_d')} = :overAllStatus`);
      params.overAllStatus = String(filter.overAllStatus);
    }
    const eligible = conditions.join(' AND ');
    const includeId = relationIdOf(filter.includeId);
    if (isUuid(includeId)) {
      qb.andWhere(`((${eligible}) OR grn.id = :includeId)`, { ...params, includeId });
    } else {
      qb.andWhere(`(${eligible})`, params);
    }
    if (filter.search && String(filter.search).trim()) {
      const term = String(filter.search).trim();
      qb.andWhere('(grn.grnNo ILIKE :search OR grn.id::text = :exact)', { search: `%${term}%`, exact: term });
    }

    // The included GRN comes first so the edit form finds it on page 1.
    if (isUuid(includeId)) qb.orderBy(`CASE WHEN grn.id = :includeId THEN 0 ELSE 1 END`, 'ASC').addOrderBy('grn.createdAt', 'DESC');
    else qb.orderBy('grn.createdAt', 'DESC');

    const [grns, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const documentMap = new Map<string, string>();
    if (grns.length) {
      const documents = await this.documentbRepository
        .createQueryBuilder('doc')
        .select(['doc.id', 'doc.document_type_id', 'doc.createdAt'])
        .where('doc.type = :type', { type: DocumentTypeEnum.GRN })
        .andWhere('doc.document_type_id IN (:...ids)', { ids: grns.map((g) => g.id) })
        .orderBy('doc.createdAt', 'DESC')
        .getMany();
      for (const doc of documents) {
        if (doc.document_type_id && !documentMap.has(doc.document_type_id)) documentMap.set(doc.document_type_id, doc.id);
      }
    }

    const totalPages = Math.ceil(total / limit);
    return {
      data: grns.map((g) => ({ id: g.id, grnNo: g.grnNo, documentId: documentMap.get(g.id) ?? null })),
      pagination: { total, page, limit, totalPages, pages: totalPages },
    };
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

    // Receiving links R10: none of them may already have a counting processing document.
    for (const id of ids) {
      await this.receivingGuardService.assertSourceEditable('grn', id);
      await this.assertNoApprovedDispatch(this.dataSource.manager, id, 'deleted');
    }

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
    // D-6: their deal slips become available again.
    await syncDealSlipGrnFlagsForGrns(this.dataSource.manager, ids);

    await Promise.all(ids.map(id => this.invalidateCache(id)));
    // Their pending purchase dispatches are rejected automatically.
    for (const grn of grns) {
      await this.documentbService.rejectDispatchesForSource(DocumentTypeEnum.GRN, [grn.id], 'deleted', `GRN ${grn.grnNo ?? ''}`.trim());
    }
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