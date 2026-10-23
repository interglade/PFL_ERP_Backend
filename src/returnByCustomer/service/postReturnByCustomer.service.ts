import { assertDeliveryConfirmed, assertDeliveryNotConfirmed } from '../../deliveryChallans/customerDeliveryChllan/service/dcDelivery';
import { compactDate, nextDocumentNumber, SERIES } from '../../global/numbering/documentNumber';
import { inject, injectable } from 'inversify';
import { CreatedWithApproval, withApproval } from '../../utils/approvalMessage';
import { TYPES } from '../../types';

import { DeliveryChallanRepository } from '../../deliveryChallans/deliverychllan/repository/deliveryChallan.repository';

import * as ExcelJS from 'exceljs';
import { PaginationOptions } from '../../utils/pagination';
import { formatDateTime } from '../../utils/dateUtils';
import { DocumentTypeEnum, Documentb } from '../../approvalFlow/entity/docuemnt.entity';
import { UserLogger } from '../../utils/logger';
import { DocumentStatus } from '../../approvalFlow/entity/docuemnt.entity';
import { DocumentTypeEnum as DocDefEnum } from "../../documentDef/entity/documentdef.entity";
import { dcIdsOfSalesDocuments, syncCustomerDcSalesLinks } from '../../deliveryChallans/customerDeliveryChllan/service/dcSalesLinks';
import { ApprovalFlowService } from "../../approvalFlow/service/approvalFlow.service";
import { CustomerDeliveryChallanService } from "../../deliveryChallans/customerDeliveryChllan/service/customerDeliveryChallan.service";
import AppError from "../../utils/appError";
import { DataSource, ILike, In } from 'typeorm';
import { CustomerRepository } from '../../customer/addcustomer/repository/customer.repository';
import { UserRepository } from '../../employee/repository/user.repository';
import { ProductRepository } from '../../product/createproduct/repository/product.repository';
import { CompanyRepository } from '../../company/repository/company.repository';

import { createHash } from 'crypto';
import {
  CreateRBCDto,
  UpdateRBCDto,
  RBCListResponseDto,
  RBCDetailDto,
  RBCViewDto,
  RBCUpdateFormDto,
  RBCNumbersResponseDto,
  BulkDeleteRBCResultDto,
} from '../dto/postReturnByCustomer.dto';
import { BulkDeleteResultDto } from '../../global/general.dto';
import { PostReturnByCustomerRepository } from '../repository/postReturnByCustomer.repository';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { BranchessRepository } from '../../branch/repository/branches.repository';
import { DocumentbService, DocumentWithRelatedData } from '../../approvalFlow/service/documentb.service';
import { DocDoubleApproverService } from '../../approvalFlow/service/docDoubleApprover.service';
import { DocumentbRepository } from '../../approvalFlow/repository/documentb.repository';
import { CacheService } from '../../global/cache.service';
import { PostReturnByCustomer } from '../entity/postReturnByCustomer.entity';
import { ReceivingGuardService } from '../../receiving/service/receivingGuard.service';
import { refId } from '../../receiving/receiving.helpers';
import { assertCustomerDcReady } from '../../vehicleDispatch/service/dispatchRules';
import { completeDocumentExistsSql, isProcessingDocType, noCountingDocumentSql } from '../../receiving/receiving.sql';

/** Receiving picker filters for `getAllRBCNumbers`. */
export interface RbcReceivingFilter {
  /** Only COMPLETE, not deleted RBCs. */
  receivable?: boolean;
  /** Only RBCs with no counting document of this type (aqr | inward | dump). */
  missing?: string;
  /** Receiving location (branch) id. */
  locationId?: string;
}
export interface ReturnByCustomerReportFilter {
  startDate?: string;
  endDate?: string;
  referredDeliveryChallan?: string | string[];
  company?: string | string[];
  deliverFromLocation?: string | string[];
  poNumber?: string;
  customers?: string | string[];
  createdBy?: string | string[];
  product?: string | string[];
  totalQuantity?: number;
  totalQuantityOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  returneQuantity?: number;
  returneQuantityOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  returnedAmount?: number;
  returnedAmountOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  totalAmount?: number;
  totalAmountOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  rejectedQuantity?: number;
  rejectedQuantityOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  rejectedAmount?: number;
  rejectedAmountOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  driverName?: string | string[];
  driverLicenseNumber?: string | string[];
  vehicleNumber?: string | string[];
  receiverName?: string | string[];
  status?: string | string[];
  rmName?: string;
  approvedBy?: string;
}
@injectable()
export class PostReturnByCustomerService {
  constructor(
    @inject(TYPES.PostReturnByCustomerRepository)
    private readonly postReturnByCustomerRepository: PostReturnByCustomerRepository,
    @inject(TYPES.DeliveryChallanRepository)
    private readonly deliveryChallanRepository: DeliveryChallanRepository,
    @inject(TYPES.AuditLogService) 
    private readonly auditLogService: AuditLogService,
      @inject(TYPES.CustomerRepository) 
    private readonly customerRepo: CustomerRepository,
      @inject(TYPES.CompanyRepository) 
    private readonly companyRepository: CompanyRepository,
      @inject(TYPES.BranchessRepository) 
    private readonly branchesRepository: BranchessRepository,
     @inject(TYPES.UserRepository) 
    private readonly userRepository: UserRepository,
     @inject(TYPES.ProductRepository) 
    private readonly productRepository: ProductRepository,
    @inject(TYPES.DocumentbService)
    private readonly documentbService: DocumentbService,
    @inject(TYPES.DocDoubleApproverService)
    private readonly docDoubleApproverService: DocDoubleApproverService,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
     @inject(TYPES.DocumentbRepository)
    private readonly documentbRepository: DocumentbRepository,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
    @inject(TYPES.ApprovalFlowService)
    private readonly approvalFlowService: ApprovalFlowService,
    @inject(TYPES.CustomerDeliveryChallanService)
    private readonly customerDeliveryChallanService: CustomerDeliveryChallanService,
    @inject(TYPES.ReceivingGuardService)
    private readonly receivingGuardService: ReceivingGuardService,
  ) {}

  private readonly CACHE_PREFIX = 'rbc';

  /** Receiving links D6: an RBC lists each product + variant once. */
  private assertNoDuplicateProducts(products: unknown): void {
    if (!Array.isArray(products)) return;
    this.receivingGuardService.assertNoDuplicateLines(
      products.map((p: any) => ({ productId: refId(p?.productName), variantId: refId(p?.variant), uomId: refId(p?.saleUoM) })),
    );
  }
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:numbers:*`),
    ];
    if (id) {
      tasks.push(
        // view/update/id all accept the Documentb id as well as this record's
        // own id, so they can only be busted by pattern from here.
        this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:id:*`),
        this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:view:*`),
        this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:update:*`),
      );
    }
    await Promise.all(tasks);
  }

  /**
   * Creates a customer return record with optimized transaction handling
   * 
   * LOGIC FLOW:
   * 1. Validates delivery challan exists and checks if return already created
   * 2. Validates that returned products match delivery challan products
   * 3. Creates return record with returned products (cascade saves products automatically)
   * 4. Marks delivery challan as returned and sets isReturnByCustomerCreated flag
   * 5. Updates delivery challan items with return/reject/accept quantities
   * 6. Creates approval document and starts workflow
   * 7. Logs the creation event
   * 
   * BUSINESS RULES:
   * - Only ONE return can be created per delivery challan
   * - Returned products must match delivery challan products
   * - AcceptedQty = DeliveryChallanQty - ReturnedQty - RejectedQty
   * 
   * OPTIMIZATIONS:
   * - Uses single transaction for data consistency
   * - Cascade save for returnedProducts (no manual save needed)
   * - Efficient SQL aggregation for quantity updates
   */
  /** Next number of the day; issued by the shared sequence (no COUNT / MAX race, never reused). */
  private async generateSerialNo(): Promise<string> {
    return nextDocumentNumber(this.postReturnByCustomerRepository.manager, SERIES.rbc, `RBC${compactDate()}`, 5);
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

  async createReturn(returnData: CreateRBCDto & Record<string, any>, requestedBy: string, clientIp?: string): Promise<CreatedWithApproval<PostReturnByCustomer>> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(requestedBy, DocDefEnum.OPERATION);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1️⃣ Validate required input
      if (!returnData.deliveryChallanNo) {
        throw new Error('Delivery Challan number is required');
      }
      this.assertNoDuplicateProducts(returnData.returnedProducts);

      // 2️⃣ Fetch and validate delivery challan with products
      const deliveryChallan = await queryRunner.manager.findOne(
        this.deliveryChallanRepository.target, 
        { 
          where: { id: returnData.deliveryChallanNo },
          relations: ['deliveryChallanProducts', 'deliveryChallanProducts.productName', 'deliveryChallanProducts.variant', 'deliveryChallanProducts.saleUoM', 'deliveryChallanProducts.uom']
        }
      );

      if (!deliveryChallan) {
        throw new Error('Delivery Challan not found');
      }

      // 3️⃣ Check if return already created for this delivery challan
      if ((deliveryChallan as any).isReturnByCustomerCreated) {
        throw new Error('Return By Customer has already been created for this Delivery Challan');
      }

      // DC and its vehicle dispatch must be approved (docs/dispatch-enforcement-plan.md D6).
      await assertCustomerDcReady(queryRunner.manager, returnData.deliveryChallanNo);
      // Returns are recorded at delivery, before the delivery is confirmed (D-1 / D-3).
      await assertDeliveryNotConfirmed(queryRunner.manager, returnData.deliveryChallanNo, 'raised');

      // 4️⃣ Validate that returned products match delivery challan products
      if (returnData.returnedProducts && returnData.returnedProducts.length > 0) {
        for (const returnProduct of returnData.returnedProducts) {
          const productId = typeof returnProduct.productName === 'object' && returnProduct.productName
            ? returnProduct.productName.id 
            : (returnProduct.productName ?? null);
          const variantId = returnProduct.variant 
            ? (typeof returnProduct.variant === 'object' ? returnProduct.variant.id : returnProduct.variant)
            : null;

          // Find matching product in delivery challan
          const matchingProduct = deliveryChallan.deliveryChallanProducts.find(dcProduct => {
            const dcProductId = dcProduct.productName?.id;
            const dcVariantId = dcProduct.variant?.id || null;
            
            return dcProductId === productId && dcVariantId === variantId;
          });

          if (!matchingProduct) {
            throw new Error(
              `Product ${productId}${variantId ? ` with variant ${variantId}` : ''} does not exist in the Delivery Challan`
            );
          }

          // Validate quantities
          const originalQty = Number(matchingProduct.quantity || 0);
          const returnedQty = Number(returnProduct.returnedQty || 0);
          const rejectedQty = Number(returnProduct.rejectedQty || 0);

          if (returnedQty + rejectedQty > originalQty) {
            throw new Error(
              `Total returned (${returnedQty}) and rejected (${rejectedQty}) quantity cannot exceed original quantity (${originalQty}) for product ${productId}`
            );
          }

          // D-2: quantities are in the DC line's unit; returned goods are received
          // in kg, so a returned quantity needs its net kg, within the DC line's kg.
          const dcUnit = (matchingProduct as { saleUoM?: { id?: string } | null; uom?: { id?: string } | null }).saleUoM?.id
            ?? (matchingProduct as { uom?: { id?: string } | null }).uom?.id ?? null;
          if (dcUnit) (returnProduct as Record<string, unknown>).saleUoM = dcUnit;
          const returnedKg = Number(returnProduct.returnedNetWt || 0);
          const dcKg = Number(matchingProduct.netWeight || 0);
          const label = matchingProduct.productName?.name ?? productId;
          if (returnedQty > 0 && returnedKg <= 0) {
            throw new AppError(400, `${label}: enter the returned net weight (kg) — returned goods are received by weight`);
          }
          if (dcKg > 0 && returnedKg + Number(returnProduct.rejectedNetWt || 0) > dcKg) {
            throw new AppError(400, `${label}: returned and rejected net weight cannot exceed the ${dcKg} kg delivered`);
          }
        }
      }
      const serialNo = await this.generateSerialNo();
      returnData.rbcNo = serialNo;

      // 5️⃣ Create return entity with returnedProducts (cascade will auto-save products)
      const newReturn = queryRunner.manager.create(
        this.postReturnByCustomerRepository.target, 
        {
          rbcNo: serialNo,
          deliveryChallanNo: returnData.deliveryChallanNo,
          companyName: returnData.companyName,
          location: returnData.location,
          customerName: returnData.customerName,
          date: returnData.date,
          remark: returnData.remark,
          createdBy: { id: requestedBy },
          returnedProducts: returnData.returnedProducts?.map((product: any) => {
            const unitPrice    = Number(product.unitPrice   ?? 0);
            const returnedQty  = Number(product.returnedQty ?? 0);
            const rejectedQty  = Number(product.rejectedQty ?? 0);
            // Always compute amounts server-side — never trust client values
            const returnedQtyAmt  = parseFloat((returnedQty  * unitPrice).toFixed(2));
            const rejectedQtyAmt  = parseFloat((rejectedQty  * unitPrice).toFixed(2));
            return {
              productName:               product.productName,
              variant:                   product.variant || null,
              saleUoM:                   product.saleUoM,
              unitPrice,
              returnedQty,
              returnedQtyAmt,
              returnedPackingMaterialWt: product.returnedPackingMaterialWt,
              returnedGrossWt:           product.returnedGrossWt,
              returnedNetWt:             product.returnedNetWt,
              rejectedQty,
              rejectedQtyAmt,
              rejectedPackingMaterialWt: product.rejectedPackingMaterialWt,
              rejectedGrossWt:           product.rejectedGrossWt,
              rejectedNetWt:             product.rejectedNetWt,
            };
          }) || [],
        } as any
      );

      const savedReturn = await queryRunner.manager.save(newReturn);
      const savedReturnEntity = Array.isArray(savedReturn) ? savedReturn[0] : savedReturn;

      // 6️⃣ DC flags follow the live documents: this pending RBC sets
      // isReturnByCustomerCreated; the DC line quantities change only when the
      // RBC is approved (see syncCustomerDcSalesLinks).
      await syncCustomerDcSalesLinks(queryRunner.manager, [returnData.deliveryChallanNo]);

      // 8️⃣ Create document and start approval flow
      const document = await this.documentbService.createDocument({
        type: DocumentTypeEnum.RETURN_BY_CUSTOMER,
        docDef: DocDefEnum.OPERATION,
        status: DocumentStatus.HOLD,
        remarks: 'Document auto-created with RBC',
        lastActionBy: { id: requestedBy },
        document_type_id: savedReturnEntity.id,
      });

      // 9️⃣ Log creation
      UserLogger.logRfpaCreated(savedReturnEntity.id, requestedBy, clientIp);

      await queryRunner.commitTransaction();

      // Start approval flow after commit so RBC is visible to other DB connections
      const assignment = await this.documentbService.startApprovalFlow(document.id);
      // This return rewrote the delivery challan's item quantities (returned /
      // rejected / accepted) and its isReturned flags, so the challan's own
      // caches are now stale — bust them alongside ours.
      await Promise.all([
        this.invalidateCache(),
        this.customerDeliveryChallanService.invalidateCDCCache(returnData.deliveryChallanNo),
      ]);
      return withApproval(savedReturnEntity, assignment);

    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getAllPostReturnByCustomer(
    queryOptions: PaginationOptions,
    userId: string,
    isAdmin: boolean = false,
  ): Promise<RBCListResponseDto> {
    const hash = createHash('md5').update(`${userId}:${isAdmin ? 'admin' : 'user'}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:list:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { data, meta } = await this.docDoubleApproverService.getAllDocumentByUserIdForDoubleApprover(
      userId,
      DocumentTypeEnum.RETURN_BY_CUSTOMER,
      queryOptions,
      false,
      isAdmin,
    );

    const { search } = queryOptions;
    const typedDocuments = data as DocumentWithRelatedData[];
    const activeDocuments = typedDocuments
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // ---- Batch fetch instead of N+1 ----
    const rbcIds = activeDocuments
      .map(doc => doc.document_type_id)
      .filter(Boolean) as string[];

    const records = rbcIds.length
      ? await this.postReturnByCustomerRepository
          .createQueryBuilder('rbc')
          .leftJoin('rbc.companyName', 'companyName')
          .leftJoin('rbc.deliveryChallanNo', 'deliveryChallanNo')
          .leftJoin('rbc.returnedProducts', 'returnedProducts')
          .leftJoin('returnedProducts.productName', 'productName')
          .leftJoin('returnedProducts.saleUoM', 'saleUoM')
          .select([
            'rbc.id', 'rbc.rbcNo', 'rbc.date', 'rbc.remark',
            'companyName.name',
            'deliveryChallanNo.challanNo',
            'returnedProducts.id', 'returnedProducts.unitPrice',
            'productName.name', 'saleUoM.unit',
          ])
          .where('rbc.id IN (:...ids)', { ids: rbcIds })
          .andWhere('rbc.isDeleted = false')
          .andWhere('rbc.deletedAt IS NULL')
          .getMany()
      : [];

    const recordMap = new Map(records.map(r => [r.id, r]));

    let relatedDataOnly = activeDocuments
      .filter(doc => doc.document_type_id && recordMap.has(doc.document_type_id))
      .map((doc) => {
        const rd = recordMap.get(doc.document_type_id!)!;
        const { createdDate, createdTime } = formatDateTime(doc.createdAt);
        return {
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: `${doc.lastActionBy?.firstName ?? ''} ${doc.lastActionBy?.lastName ?? ''}`.trim(),
          createdDate,
          createdTime,
          id: rd.id,
          rbcNo: rd.rbcNo ?? null,
          date: formatDateTime(rd.date).createdDate,
          remark: rd.remark ?? null,
          companyName: rd.companyName?.name ?? null,
          deliveryChallanNo: rd.deliveryChallanNo?.challanNo ?? null,
          returnedProducts: (rd.returnedProducts ?? []).map((p: any) => ({
            id: p.id,
            productName: p.productName?.name ?? null,
            saleUoM: p.saleUoM?.unit ?? null,
            unitPrice: p.unitPrice,
          })),
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

    const result = {
      data: relatedDataOnly,
      meta: { total: meta.total, page: meta.page, pages: meta.pages },
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  async getByIdPostReturnByCustomerforView(docid: string): Promise<RBCViewDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:view:${docid}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const document1 = await this.docDoubleApproverService.getDocumentById(docid);
    const id = document1.documentTypeId;
    if (!id) return null;

    const result = await this.postReturnByCustomerRepository
      .createQueryBuilder('postReturn')
      .leftJoin('postReturn.companyName', 'company')
      .leftJoin('postReturn.location', 'location')
      .leftJoin('postReturn.deliveryChallanNo', 'deliveryChallanNo')
      .leftJoin('postReturn.returnedProducts', 'returnedProduct')
      .leftJoin('returnedProduct.productName', 'product')
      .leftJoin('returnedProduct.variant', 'variant')
      .leftJoin('returnedProduct.saleUoM', 'saleUoM')
      .leftJoin('postReturn.customerName', 'customerName')
      .select([
        'postReturn.id', 'postReturn.date', 'postReturn.remark', 'postReturn.createdAt',
        'company.name', 'location.name',
        'deliveryChallanNo.challanNo',
        'customerName.organisationName',
        'returnedProduct.id', 'returnedProduct.unitPrice',
        'returnedProduct.returnedQty', 'returnedProduct.returnedQtyAmt',
        'returnedProduct.rejectedQty', 'returnedProduct.rejectedQtyAmt',
        'returnedProduct.returnedNetWt', 'returnedProduct.returnedPackingMaterialWt',
        'returnedProduct.returnedGrossWt', 'returnedProduct.rejectedNetWt',
        'returnedProduct.rejectedGrossWt', 'returnedProduct.rejectedPackingMaterialWt',
        'product.name', 'variant.variantName', 'saleUoM.unit',
      ])
      .where('postReturn.id = :id', { id })
      .getOne();

    if (!result) throw new Error(`PostReturnByCustomer with ID ${id} not found`);

    const { createdDate, createdTime } = formatDateTime(result.createdAt);

    const viewResult = {
      id: result.id,
      documentId: document1.documentId,
      overAllStatus: document1.status,
      createdBy: document1.createdBy,
      createdDate,
      createdTime,
      approvalSummary: document1.approvalSummary ?? null,
      companyName: result.companyName?.name ?? null,
      customerName: result.customerName?.organisationName ?? null,
      location: result.location?.name ?? null,
      date: formatDateTime(result.date).createdDate,
      deliveryChallanNo: result.deliveryChallanNo?.challanNo ?? null,
      remark: result.remark ?? null,
      returnedProducts: (result.returnedProducts ?? []).map((p) => ({
        productName: p.productName?.name ?? null,
        variant: p.variant?.variantName ?? null,
        saleUoM: p.saleUoM?.unit ?? null,
        unitPrice: p.unitPrice,
        returnedQty: p.returnedQty,
        returnedQtyAmt: p.returnedQtyAmt,
        rejectedQty: p.rejectedQty,
        rejectedQtyAmt: p.rejectedQtyAmt,
        returnedNetWt: p.returnedNetWt,
        returnedPackingMaterialWt: p.returnedPackingMaterialWt,
        returnedGrossWt: p.returnedGrossWt,
        rejectedNetWt: p.rejectedNetWt,
        rejectedGrossWt: p.rejectedGrossWt,
        rejectedPackingMaterialWt: p.rejectedPackingMaterialWt,
      })),
    };

    await this.cacheService.set(cacheKey, viewResult, this.CACHE_TTL);
    return viewResult;
  }

  async getByIdPostReturnByCustomerforupdate(docid: string): Promise<RBCUpdateFormDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${docid}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    // docid can be either the document ID or the RBC record ID
    let document1 = await this.documentbRepository.findOne({
      where: { id: docid },
      select: ['id'],
    });
    if (!document1) {
      document1 = await this.documentbRepository.findOne({
        where: { document_type_id: docid },
        select: ['id'],
      });
    }
    if (!document1) throw new Error(`Document with ID ${docid} not found`);

    const fullDocument = await this.docDoubleApproverService.getDocumentById(document1.id);
    const id = fullDocument.documentTypeId;

    const result = await this.postReturnByCustomerRepository
      .createQueryBuilder('postReturn')
      .leftJoin('postReturn.companyName', 'company')
      .leftJoin('postReturn.location', 'location')
      .leftJoin('postReturn.deliveryChallanNo', 'deliveryChallanNo')
      .leftJoin('postReturn.returnedProducts', 'returnedProduct')
      .leftJoin('returnedProduct.productName', 'product')
      .leftJoin('returnedProduct.variant', 'variant')
      .leftJoin('returnedProduct.saleUoM', 'saleUoM')
      .leftJoin('postReturn.customerName', 'customerName')
      .select([
        'postReturn.id', 'postReturn.date', 'postReturn.remark', 'postReturn.createdAt',
        'company.id', 'location.id', 'deliveryChallanNo.id', 'customerName.id',
        'returnedProduct.id', 'returnedProduct.unitPrice',
        'returnedProduct.returnedQty', 'returnedProduct.returnedQtyAmt',
        'returnedProduct.rejectedQty', 'returnedProduct.rejectedQtyAmt',
        'returnedProduct.returnedNetWt', 'returnedProduct.returnedPackingMaterialWt',
        'returnedProduct.returnedGrossWt', 'returnedProduct.rejectedNetWt',
        'returnedProduct.rejectedGrossWt', 'returnedProduct.rejectedPackingMaterialWt',
        'product.id', 'variant.id', 'saleUoM.id',
      ])
      .where('postReturn.id = :id', { id })
      .getOne();

    if (!result) throw new Error(`PostReturnByCustomer with ID ${id} not found`);

    const { createdDate, createdTime } = formatDateTime(result.createdAt);

    const updateResult = {
      id: result.id,
      documentId: fullDocument.documentId,
      overAllStatus: fullDocument.status,
      createdBy: fullDocument.createdBy,
      createdDate,
      createdTime,
      approvalSummary: fullDocument.approvalSummary ?? null,
      companyName: result.companyName?.id ?? null,
      customerName: result.customerName?.id ?? null,
      date: formatDateTime(result.date).createdDate,
      location: result.location?.id ?? null,
      deliveryChallanNo: result.deliveryChallanNo?.id ?? null,
      remark: result.remark ?? null,
      returnedProducts: (result.returnedProducts ?? []).map((p) => ({
        productName: p.productName?.id ?? null,
        variant: p.variant?.id ?? null,
        saleUoM: p.saleUoM?.id ?? null,
        unitPrice: p.unitPrice,
        returnedQty: p.returnedQty,
        returnedQtyAmt: p.returnedQtyAmt,
        rejectedQty: p.rejectedQty,
        rejectedQtyAmt: p.rejectedQtyAmt,
        returnedNetWt: p.returnedNetWt,
        returnedPackingMaterialWt: p.returnedPackingMaterialWt,
        returnedGrossWt: p.returnedGrossWt,
        rejectedNetWt: p.rejectedNetWt,
        rejectedGrossWt: p.rejectedGrossWt,
        rejectedPackingMaterialWt: p.rejectedPackingMaterialWt,
      })),
    };

    await this.cacheService.set(cacheKey, updateResult, this.CACHE_TTL);
    return updateResult;
  }

  async getByIdPostReturnByCustomer(id: string): Promise<RBCDetailDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    // Resolve actual postReturn ID — the caller may pass either the postReturn ID
    // or the document ID (from the documentb table). Try direct lookup first,
    // then fall back to resolving via document_type_id.
    let resolvedId = id;
    let directResult = await this.postReturnByCustomerRepository
      .createQueryBuilder('postReturn')
      .where('postReturn.id = :id', { id })
      .getOne();

    if (!directResult) {
      try {
        const document = await this.docDoubleApproverService.getDocumentById(id);
        if (document?.documentTypeId) {
          resolvedId = document.documentTypeId;
        }
      } catch (_) {
        // document not found either — will throw below
      }
    }

    const result = await this.postReturnByCustomerRepository
      .createQueryBuilder('postReturn')
      .leftJoinAndSelect('postReturn.companyName', 'company')
      .leftJoinAndSelect('postReturn.deliveryChallanNo', 'deliveryChallanNo')
      .leftJoinAndSelect('postReturn.returnedProducts', 'returnedProduct')
      .leftJoinAndSelect('returnedProduct.productName', 'product')
      .leftJoinAndSelect('returnedProduct.variant','variant')
      .leftJoinAndSelect('returnedProduct.saleUoM', 'saleUoM')

      .where('postReturn.id = :id', { id: resolvedId })
      .getOne();

    if (!result) {
      throw new Error(`PostReturnByCustomer with ID ${id} not found`);
    }
    const rawDate = result.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);
    const date = formatDateTime(result.date);
    const idResult: RBCDetailDto = {
      id: result.id,
      rbcNo: result.rbcNo ?? null,
      companyName: result.companyName?.name ?? null,
      //  ? {
      //   id: result.companyName.id,
      //   companyName: result.companyName.name,
      // } : null,
      date: date.createdDate,
      createdDate,
      createdTime,

      deliveryChallanNo: result.deliveryChallanNo?.challanNo,
      // ? {
      //   id: result.deliveryChallanNo.id,
      //   deliveryChallanNo: result.deliveryChallanNo.challanNo
      // } : null,

      remark: result.remark,

      returnedProducts: result.returnedProducts.map((returnedProduct) => ({
        productName: returnedProduct.productName?.name,
        saleUoM: returnedProduct.saleUoM?.unit || null,
        returnedQty: returnedProduct.returnedQty,
        returnedQtyAmt: returnedProduct.returnedQtyAmt,
        rejectedQty: returnedProduct.rejectedQty,
        rejectedQtyAmt: returnedProduct.rejectedQtyAmt,
        returnedNetWt: returnedProduct.returnedNetWt,
        returnedPackingMaterialWt: returnedProduct.returnedPackingMaterialWt,
        returnedGrossWt: returnedProduct.returnedGrossWt,
        rejectedNetWt: returnedProduct.rejectedNetWt,
        rejectedGrossWt: returnedProduct.rejectedGrossWt,
        rejectedPackingMaterialWt: returnedProduct.rejectedPackingMaterialWt,

        unitPrice: returnedProduct.unitPrice,
      })),
    };
    await this.cacheService.set(cacheKey, idResult, this.CACHE_TTL);
    return idResult;
  }
  async getAllRBCNumbers(page?: number, limit?: number, search?: string, receiving?: RbcReceivingFilter): Promise<RBCNumbersResponseDto> {
    if (receiving && (receiving.receivable || receiving.missing || receiving.locationId)) {
      return this.getReceivableRBCNumbers(page, limit, search, receiving);
    }
    const cacheKey = `${this.CACHE_PREFIX}:numbers:${page ?? 'all'}:${limit ?? 'all'}:${search ?? ''}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    if (!page || !limit) {
      const allData = await this.postReturnByCustomerRepository.find({
        select: ['id', 'rbcNo'],
        order: { createdAt: 'DESC' },
      });

      let data = allData;
      if (search?.trim()) {
        const term = search.trim().toLowerCase();
        data = allData.filter(r =>
          r.rbcNo?.toLowerCase().includes(term) ||
          r.id.toLowerCase() === term  // exact ID match
        );
      }

      const result = { data, total: data.length, page: 1, totalPages: 1 };
      await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
      return result;
    }

    const allData = await this.postReturnByCustomerRepository.find({
      select: ['id', 'rbcNo'],
      order: { createdAt: 'DESC' },
    });

    let filtered = allData;
    if (search?.trim()) {
      const term = search.trim().toLowerCase();
      filtered = allData.filter(r =>
        r.rbcNo?.toLowerCase().includes(term) ||
        r.id.toLowerCase() === term  // exact ID match
      );
    }

    const total = filtered.length;
    const data = filtered.slice((page - 1) * limit, page * limit);

    const result = {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  /**
   * Receiving picker for RBCs, applied in SQL:
   * - `receivable=true` -> the RBC is COMPLETE (via `documents`) and not deleted;
   * - `missing=<type>`  -> no counting document of that type (aqr | inward | dump) references the RBC
   *                        (counting = not deleted and `documents.status` <> REJECT);
   * - `locationId`      -> receiving location (branch).
   * `search` matches `rbcNo` (ILIKE) or the exact id. Without `page` / `limit` every match is
   * returned (capped at 500). Not cached: the list changes the moment a document is created.
   */
  private async getReceivableRBCNumbers(
    page: number | undefined,
    limit: number | undefined,
    search: string | undefined,
    receiving: RbcReceivingFilter,
  ): Promise<RBCNumbersResponseDto> {
    if (receiving.missing && !isProcessingDocType(receiving.missing)) {
      throw new AppError(400, 'missing must be one of aqr, inward, dump, rtv');
    }
    const paginated = Boolean(page && limit);
    const currentPage = paginated ? Math.max(1, Number(page)) : 1;
    const currentLimit = paginated ? Math.min(200, Math.max(1, Number(limit))) : 500;

    if (receiving.missing === 'rtv') {
      // An RTV can only be raised against a GRN, so no RBC is ever "missing" one.
      return { data: [], total: 0, page: currentPage, totalPages: 0 };
    }

    const qb = this.postReturnByCustomerRepository
      .createQueryBuilder('rbc')
      .select(['rbc.id', 'rbc.rbcNo', 'rbc.createdAt'])
      .where('rbc.isDeleted = false');

    if (receiving.receivable) qb.andWhere(completeDocumentExistsSql('rbc.id', 'rbc'));
    if (receiving.missing && isProcessingDocType(receiving.missing)) {
      qb.andWhere(noCountingDocumentSql('rbc.id', 'rbc', receiving.missing));
    }
    if (receiving.locationId) {
      qb.leftJoin('rbc.location', 'receivingLocation').andWhere('receivingLocation.id = :locationId', { locationId: String(receiving.locationId) });
    }
    if (search && search.trim()) {
      const term = search.trim();
      qb.andWhere('(rbc.rbcNo ILIKE :search OR rbc.id::text = :exact)', { search: `%${term}%`, exact: term });
    }

    const [rows, total] = await qb
      .orderBy('rbc.createdAt', 'DESC')
      .skip((currentPage - 1) * currentLimit)
      .take(currentLimit)
      .getManyAndCount();

    return {
      data: rows.map((r) => ({ id: r.id, rbcNo: r.rbcNo ?? null })),
      total,
      page: currentPage,
      totalPages: paginated ? Math.ceil(total / currentLimit) : 1,
    };
  }

   //TODO:Delte Multiple
public async deleteMultipleRBC(ids: string[]): Promise<BulkDeleteResultDto> {
  const success: {id: string; No: string}[]= []
  const failed: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      const rbc = await this.postReturnByCustomerRepository.findOne({
        where: { id },
      });
      if (!rbc) {
        failed.push({ id, reason: 'RBC not found' });
        continue;
      }
      // Receiving links R10 — a 409 here lands in `failed` with its message.
      await this.receivingGuardService.assertSourceEditable('rbc', id);
      // Not once the DC's delivery is confirmed (the invoice relies on it).
      const [rbcDc] = await dcIdsOfSalesDocuments(this.dataSource.manager, DocumentTypeEnum.RETURN_BY_CUSTOMER, [rbc.id]);
      await assertDeliveryNotConfirmed(this.dataSource.manager, rbcDc, 'deleted');
      const relatedDocument = await this.documentbRepository.findOne({
        where: { document_type_id: rbc.id }
      });

      if (!relatedDocument) {
        throw new Error(`Something went wrong`);
      }

      if (relatedDocument) {
        await this.documentbRepository.softDelete(relatedDocument.id);
        await this.documentbRepository.update(relatedDocument.id, { isDeleted: true } as any);
      }

      await this.postReturnByCustomerRepository.softDelete(rbc.id);
      await this.postReturnByCustomerRepository.update(rbc.id, { isDeleted: true } as any);
      // The DC can take a new RBC again and loses this one's quantities.
      const dcIds = await dcIdsOfSalesDocuments(this.dataSource.manager, DocumentTypeEnum.RETURN_BY_CUSTOMER, [rbc.id]);
      await syncCustomerDcSalesLinks(this.dataSource.manager, dcIds);
      await Promise.all([this.invalidateCache(rbc.id), ...dcIds.map((dcId) => this.customerDeliveryChallanService.invalidateCDCCache(dcId))]);
      success.push({id,No:rbc.rbcNo});
    } catch (error: any) {
      failed.push({ id, reason: error.message || 'Unknown error' });
    }
  }
  const message = `Deletion completed. Success: ${success.length}, Failed: ${failed.length}`;
  return { success, failed, message };
}
  async updatePostReturnByCustomer(
    id: string,
    returnData: any,
    updatedBy: string,
    clientIp?: string,
  ): Promise<any> {
    // Receiving links R9 / D6: not while an AQR / Inward / Dump counts against it; no repeated product + variant.
    await this.receivingGuardService.assertSourceEditable('rbc', id);
    {
      const [rbcDc] = await dcIdsOfSalesDocuments(this.dataSource.manager, DocumentTypeEnum.RETURN_BY_CUSTOMER, [id]);
      await assertDeliveryNotConfirmed(this.dataSource.manager, rbcDc, 'changed');
    }
    this.assertNoDuplicateProducts(returnData?.returnedProducts);
    const postReturn = await this.postReturnByCustomerRepository.findOne({
      where: { id },
      relations: [
        'companyName',
        'deliveryChallanNo',
        'proformaInvNo',
        'returnedProducts',
        'returnedProducts.productName',
        'returnedProducts.returnedUOM',
      ],
    });

    if (!postReturn) {
      throw new Error(`PostReturnByCustomer with ID ${id} not found`);
    }

    if (returnData?.returnedProducts) {
      for (const updatedProduct of returnData.returnedProducts) {
        const existingProduct = postReturn.returnedProducts.find(
          (p) => p.id === updatedProduct.id,
        );
        if (existingProduct) {
          Object.assign(existingProduct, updatedProduct);
        }
      }
    }

    // Update main entity fields
    Object.assign(postReturn, returnData);

    // Save updated entity
    const updatedPostReturn = await this.postReturnByCustomerRepository.save(
      postReturn,
    );

    // The DC line figures follow the approved returns (an edit of an approved RBC changes them).
    if (postReturn.deliveryChallanNo?.id) {
      await syncCustomerDcSalesLinks(this.dataSource.manager, [postReturn.deliveryChallanNo.id]);
    }

    // Same staleness as createReturn: this edit changed both this return and the
    // delivery challan's item quantities.
    await Promise.all([
      this.invalidateCache(id),
      ...(postReturn.deliveryChallanNo?.id
        ? [this.customerDeliveryChallanService.invalidateCDCCache(postReturn.deliveryChallanNo.id)]
        : []),
    ]);

    // Log the update
    UserLogger.logRfpaUpdated(id, updatedBy, clientIp);

    return updatedPostReturn;
  }

  // Admin functionality: Get audit logs for a specific user
  async getAuditLogsForUser(
    userId: string,
    options?: {
      entityName?: string;
      startDate?: Date;
      endDate?: Date;
      page?: number;
      limit?: number;
    }
  ): Promise<any> {
    if (options?.entityName && options?.startDate && options?.endDate) {
      // Filter by entity and date range
      return this.auditLogService.getLogsByUserAndDateRange(
        userId,
        options.startDate,
        options.endDate
      );
    } else if (options?.entityName) {
      // Filter by entity type
      return this.auditLogService.getLogsByUserAndEntity(userId, options.entityName);
    } else if (options?.page && options?.limit) {
      // Paginated results
      return this.auditLogService.getLogsByUserWithPagination(
        userId,
        options.page,
        options.limit
      );
    } else {
      // All logs for user
      return this.auditLogService.getLogsByUser(userId);
    }
  }

  // Admin functionality: Get comprehensive user activity report
  async getUserActivityReport(userId: string): Promise<any> {
    return this.auditLogService.getUserActivityReport(userId);
  }

  // Admin functionality: Get all users who have made changes to PostReturnByCustomer
  async getUsersWithReturnChanges(): Promise<{ userId: string; changeCount: number }[]> {
    const allLogs = await this.auditLogService.getAllLogs();
    
    // Filter logs for PostReturnByCustomer entity
    const returnLogs = allLogs.filter(log => log.entityName === 'PostReturnByCustomer');
    
    // Group by user and count changes
    const userChanges: Record<string, number> = {};
    returnLogs.forEach(log => {
      userChanges[log.updatedBy] = (userChanges[log.updatedBy] || 0) + 1;
    });

    return Object.entries(userChanges).map(([userId, changeCount]) => ({
      userId,
      changeCount
    })).sort((a, b) => b.changeCount - a.changeCount); // Sort by most active users
  }

  async generateReturnByCustomerReport(filter: ReturnByCustomerReportFilter): Promise<Buffer> {

  const toArray = (val: any) =>
    Array.isArray(val) ? val : String(val).split(',');

  // const formatDate = (date: any) => {
  //   if (!date) return '';
  //   const d = new Date(date);
  //   const day = String(d.getDate()).padStart(2, '0');
  //   const month = String(d.getMonth() + 1).padStart(2, '0');
  //   const year = d.getFullYear();
  //   return `${day}-${month}-${year}`;
  // };

  const formatDate = (date: any) => {
  if (!date) return '';

  const d = new Date(date);

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  return `${day}-${month}-${year}`;
};

  let companyNames = 'All';
  let locationNames = 'All';
  let customerNames = 'All';
  let productNames = 'All';
  let challanNos = 'All';
  let createdByNames = 'All';
  let approvedByNames = 'All';
  

  /*
  ==========================
  QUERY
  ==========================
  */

  const qb = this.postReturnByCustomerRepository
    .createQueryBuilder('ret')

    .leftJoinAndSelect('ret.companyName', 'company')
    .leftJoinAndSelect('ret.location', 'branch')
    .leftJoinAndSelect('ret.customerName', 'customer')
    .leftJoinAndSelect('ret.deliveryChallanNo', 'dc')
    .leftJoinAndSelect('ret.createdBy', 'createdByUser')

    .leftJoinAndSelect('ret.returnedProducts', 'item')
    .leftJoinAndSelect('item.productName', 'product')
    .leftJoinAndSelect('item.variant', 'variant')
    .leftJoinAndSelect('item.saleUoM', 'uom')
    .leftJoin(
            Documentb,
            'doc',
            'doc.document_type_id::uuid = ret.id'
          )
              .leftJoin('doc.lastActionBy', 'lastActionBy')
          
              .addSelect([
                'doc.id',
                'doc.status',
                'lastActionBy.id',
                'lastActionBy.firstName',
                'lastActionBy.lastName'
              ]);
    

  /*
  ==========================
  FILTERS
  ==========================
  */

  if (filter.referredDeliveryChallan) {
  const ids = toArray(filter.referredDeliveryChallan);

  qb.andWhere('dc.id IN (:...ids)', { ids });

  const data = await this.deliveryChallanRepository.findBy({ id: In(ids) });
  challanNos = data.map(d => d.challanNo).join(', ');
}


if (filter.createdBy) {
  const ids = toArray(filter.createdBy);

  qb.andWhere('ret.createdBy IN (:...cb)', { cb: ids });

  const users = await this.userRepository.findBy({ id: In(ids) });
  createdByNames = users.map(u => `${u.firstName} ${u.lastName || ''}`).join(', ');
}

if (filter.approvedBy) {
  const ids = toArray(filter.approvedBy);

  qb.andWhere('lastActionBy.id IN (:...ids)', { ids });

  const users = await this.userRepository.findBy({ id: In(ids) });
  approvedByNames = users.map(u => `${u.firstName} ${u.lastName || ''}`).join(', ');
}

if (filter.status) {
  const statuses = toArray(filter.status);

  qb.andWhere('doc.status IN (:...statuses)', { statuses });
}

  if (filter.startDate && filter.endDate) {
    qb.andWhere('ret.createdAt BETWEEN :start AND :end', {
      start: filter.startDate,
      end: filter.endDate,
    });
  }

  if (filter.company) {
    const ids = toArray(filter.company);
    qb.andWhere('company.id IN (:...comp)', { comp: ids });

    const data = await this.companyRepository.findBy({ id: In(ids) });
    companyNames = data.map(d => d.name).join(', ');
  }

  if (filter.deliverFromLocation) {
    const ids = toArray(filter.deliverFromLocation);
    qb.andWhere('branch.id IN (:...branch)', { branch: ids });

    const data = await this.branchesRepository.findBy({ id: In(ids) });
    locationNames = data.map(d => d.name).join(', ');
  }

  if (filter.customers) {
    const ids = toArray(filter.customers);
    qb.andWhere('customer.id IN (:...cust)', { cust: ids });

    const data = await this.customerRepo.findBy({ id: In(ids) });
    customerNames = data.map(d => d.organisationName).join(', ');
  }

  if (filter.product) {
    const ids = toArray(filter.product);
    qb.andWhere('product.id IN (:...p)', { p:ids });

    const data = await this.productRepository.findBy({ id: In(ids) });
    productNames = data.map(d => d.name).join(', ');
  }

  // if (filter.returnedQty && filter.operatorQty) {
  //   qb.andWhere(`item.returnedQty ${filter.operatorQty} :qty`, {
  //     qty: filter.returnedQty,
  //   });
  // }

  if (filter.returneQuantity !== undefined && filter.returneQuantityOperator) {
      const operator = filter.returneQuantityOperator;

      qb.andWhere(`item.returnedQty ${operator} :qty`, {
        qty: filter.returneQuantity,
      });
    }

  if (filter.returnedAmount && filter.returnedAmountOperator) {

    const operator = filter.returnedAmountOperator;

      qb.andWhere(`item.returnedQtyAmt ${operator} :amt`, {
        amt: filter.returnedAmount,
      });
  }

  if (filter.rejectedQuantity !== undefined && filter.rejectedQuantityOperator) {
    const operator = filter.rejectedQuantityOperator;
  qb.andWhere(`item.rejectedQty ${operator} :rqty`, {
    rqty: filter.rejectedQuantity,
  });

  if (filter.rejectedAmount !== undefined && filter.rejectedAmountOperator) {
    const operator = filter.rejectedAmountOperator;
  qb.andWhere(`item.rejectedQtyAmt ${operator} :ramt`, {
    ramt: filter.rejectedAmount,
  });
}

  
}

  const { entities, raw } = await qb.getRawAndEntities();

    const docMap: Record<string, any> = {};

  raw.forEach(r => {
    docMap[r.ret_id] = {
      status: r.doc_status,
      approvedBy: `${r.lastActionBy_firstName || ''} ${r.lastActionBy_lastName || ''}`.trim()
    };
  });

  const returns = entities;

  
  /*
  ==========================
  SUMMARY
  ==========================
  */

  let totalQty = 0;
  let totalAmt = 0;
  let totalRejectedQty = 0;
  let totalRejectedAmt = 0;

  returns.forEach(r => {
    r.returnedProducts?.forEach(i => {
      totalQty += Number(i.returnedQty || 0);
      totalAmt += Number(i.returnedQtyAmt || 0);
      totalRejectedQty += Number(i.rejectedQty || 0);
      totalRejectedAmt += Number(i.rejectedQtyAmt || 0);
    });
  });

  /*
  EXCEL
  ==========================
  */

  const workbook = new ExcelJS.Workbook();

  /*
  --------------------------
  SHEET 1 (SUMMARY)
  --------------------------
  */

  const sheet1 = workbook.addWorksheet('Return_Summary');

  sheet1.columns = [{ width: 30 }, { width: 40 }];

  sheet1.mergeCells('A1:B1');
  const title = sheet1.getCell('A1');

  title.value = 'Returned By Customer Detailed Report';

  title.font = {
      bold: true,
      size: 14,
      color: { argb: 'FFFFFFFF' },
    };

    title.alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };

    title.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00B050' },
    };

  

  sheet1.addRow([]);

  const reportDetails = [
      ['Company Name:', 'Prime Fresh Limited'],
      ['Generated By:', `${returns[0]?.createdBy?.firstName || ''} ${returns[0]?.createdBy?.lastName || ''}`.trim() || 'System'],
      ['Generated Date:', new Date().toLocaleDateString()],
    ];

    reportDetails.forEach((r) => {
      const row = sheet1.addRow(r);

      row.eachCell((cell, col) => {
        if (col === 1) cell.font = { bold: true };

        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        cell.alignment = {
          wrapText: true,
          vertical: 'middle',
        };
      });
    });

  sheet1.addRow([]);

  const filterHeader = sheet1.addRow(['Applied Filters']);
  sheet1.mergeCells(`A${filterHeader.number}:B${filterHeader.number}`);

  filterHeader.font = { bold: true };

    filterHeader.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E1F2' },
      };

      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

  const filters = [
  ['Start Date', formatDate(filter.startDate) || 'All'],
  ['End Date', formatDate(filter.endDate) || 'All'],

  [
    'Period',
    filter.startDate && filter.endDate
      ? `${formatDate(filter.startDate)} to ${formatDate(filter.endDate)}`
      : 'All',
  ],

  ['Referred Delivery Challan', challanNos],
  ['Company', companyNames],
  ['Returned To Location', locationNames],
  ['Customers', customerNames],
  ['Created By', createdByNames],
  ['Products', productNames],

  [
    'Returned Quantity',
    filter.returneQuantity !== undefined
      ? `${filter.returneQuantityOperator} ${filter.returneQuantity}`
      : 'All',
  ],

  [
    'Returned Amount',
    filter.returnedAmount !== undefined
      ? `${filter.returnedAmountOperator} ${filter.returnedAmount}`
      : 'All',
  ],

  ['Rejected Quantity', filter.rejectedQuantity !== undefined && filter.rejectedQuantityOperator
          ? `${filter.rejectedQuantityOperator} ${filter.rejectedQuantity}`
          : 'All'],
  ['Rejected Amount', filter.rejectedAmount !== undefined && filter.rejectedAmountOperator
          ? `${filter.rejectedAmountOperator} ${filter.rejectedAmount}`
          : 'All'],

  ['Approved By', approvedByNames],
  ['Status', filter.status || 'All'],
];

  filters.forEach((f) => {
      const row = sheet1.addRow(f);

      row.eachCell((cell, col) => {
        if (col === 1) cell.font = { bold: true };

        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        cell.alignment = {
          wrapText: true,
          vertical: 'middle',
        };
      });
    });

  sheet1.addRow([]);

  const summaryHeader = sheet1.addRow(['Summary']);
  sheet1.mergeCells(`A${summaryHeader.number}:B${summaryHeader.number}`);

  summaryHeader.font = { bold: true };

    summaryHeader.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E1F2' },
      };

      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

  
  

  const summaryRows = [
      ['Total Returned Records', returns.length],
      ['Total Returned Qty', totalQty],
      ['Total Returned Amount', totalAmt],
      ['Total Rejected Qty', totalRejectedQty],
      ['Total Rejected Amount', totalRejectedAmt]
    ];

    summaryRows.forEach((s) => {
      const row = sheet1.addRow(s);

      row.eachCell((cell, col) => {
        if (col === 1) cell.font = { bold: true };

        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    });

  /*
  --------------------------
  SHEET 2 (DATA)
  --------------------------
  */

  const sheet2 = workbook.addWorksheet('Return_Data');

  sheet2.columns = [
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Created By', key: 'createdBy', width: 12 },
    { header: 'Created Date', key: 'date', width: 12 },
    { header: 'Challan No', key: 'challan', width: 15 },
    { header: 'Return Date', key: 'retDate', width: 12 },
    { header: 'Company Name', key: 'company', width: 20 },
    { header: 'Location', key: 'location', width: 18 },
    { header: 'Customer Name', key: 'customer', width: 20 },
    

    { header: 'Product Name', key: 'product', width: 18 },
    { header: 'Variant', key: 'variant', width: 18 },
    { header: 'UOM', key: 'uom', width: 10 },
    { header: 'Unit Price', key: 'unitPrice', width: 10 },
    

    { header: 'Returned Qty', key: 'qty', width: 12 },
    { header: 'Returned Amount', key: 'amt', width: 15 },
    { header: 'Returned Gross Wt', key: 'grossWt', width: 15 },
    { header: 'Returned Net Wt', key: 'netWt', width: 15 },
    

    { header: 'Rejected Qty', key: 'rejQty', width: 12 },
    { header: 'Rejected Amount', key: 'rejAmt', width: 15 },
    { header: 'Reject Gross Wt', key: 'rejGrossWt', width: 15 },
    { header: 'Reject Net Wt', key: 'rejNetWt', width: 15 },

    { header: 'Remark', key: 'remark', width: 25 },
  ];


  const headerRow = sheet2.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFDE21' },
    };
    cell.font = { bold: true };
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };
  });

  /*
  DATA ROWS
  */

  const STATUS_MAP: Record<string, { label: string; color: string }> = {
      hold: { label: 'Hold', color: 'FFFF5700' },
      VERIFIED: { label: 'Verified', color: 'FF6A00FF' },
      approved: { label: 'Approved', color: 'FF40BF40' },
      FINALIZING: { label: 'Finalized', color: 'FF0063B1' },
      COMPLETE: { label: 'Complete', color: 'FF006600' },
      REJECT: { label: 'Reject', color: 'FFAF0606' },
    };


    const safe = (val: any) => (val === null || val === undefined ? '' : val);



  for (const r of returns) {
    const start = sheet2.rowCount + 1;
    const documentb = docMap[r.id]
    const statusValue = documentb?.status || '';
    // console.log("status"+statusValue+"--------------------");
    const statusInfo = STATUS_MAP[statusValue] || {
      label: statusValue,
      color: 'FFE7E6E6',
    };
    const approvedBy = documentb?.approvedBy || '';

    for (const i of r.returnedProducts || []) {
      const row = sheet2.addRow({
        status: statusInfo.label,
        createdBy: `${r.createdBy?.firstName || ''} ${r.createdBy?.lastName || ''}`.trim(),
        date: formatDate(r.createdAt),
        challan: r.deliveryChallanNo?.challanNo,
        company: r.companyName?.name,
        location: r.location?.name,
        customer: r.customerName?.organisationName,
        product: i.productName?.name,
        variant: i.variant?.variantName,
        uom: i.saleUoM?.unit,
        unitPrice: i.unitPrice,
        qty: i.returnedQty,
        amt: i.returnedQtyAmt,
        grossWt: i.returnedGrossWt,
        netWt: i.returnedNetWt,
        rejQty: i.rejectedQty,
        rejAmt: i.rejectedQtyAmt,
        rejGrossWt: i.rejectedGrossWt,
        rejNetWt: i.rejectedNetWt,
        remark: r.remark
      });

      row.getCell('retDate').value = r.date
        ? String(r.date).split(' ')[0]
        : '';

      const statusCell = row.getCell(1);
      statusCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: statusInfo.color },
      };
      statusCell.font = {
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      statusCell.alignment = {
        //   horizontal: 'center',
        vertical: 'middle',
      };

      row.alignment = {
        // horizontal: 'center',
        vertical: 'middle',
      };

      // Add black border to all cells in this row
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } },
        };
      });
    }

    const end = sheet2.rowCount;
    if (end > start) {
      const mergeCols = [15];
      mergeCols.forEach((col) => {
        sheet2.mergeCells(start, col, end, col);
      });
    }
  }

  this.autoAdjustColumnWidth(sheet2);

  const buffer = await workbook.xlsx.writeBuffer();

  return buffer as unknown as Buffer;
}


autoAdjustColumnWidth(sheet: ExcelJS.Worksheet) {
    sheet.columns?.forEach((column) => {
      let maxLength = 0;

      column.eachCell?.({ includeEmpty: true }, (cell) => {
        const cellValue = cell.value ? cell.value.toString() : '';
        maxLength = Math.max(maxLength, cellValue.length);
      });

      column.width = maxLength + 2; // padding
    });
  }
}
