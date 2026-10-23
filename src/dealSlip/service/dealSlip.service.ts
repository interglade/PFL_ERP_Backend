import { compactDate, nextDocumentNumber, SERIES } from '../../global/numbering/documentNumber';
import { inject, injectable } from "inversify";
import { CreatedWithApproval, withApproval } from "../../utils/approvalMessage";
import { TYPES } from "../../types";
import { DealSlipRepository } from "../repository/dealSlip.repository";

import { DeepPartial, In, SelectQueryBuilder, DataSource, EntityManager } from "typeorm";
import { Status } from "../../utils/status.enum";

import AppError from "../../utils/appError";
import { buildQueryFromArray, PaginationOptions } from "../../utils/pagination";
import { formatDateTime } from "../../utils/dateUtils";


import { Documentb, DocumentStatus, DocumentTypeEnum } from "../../approvalFlow/entity/docuemnt.entity";
import { DocumentTypeEnum as DocDefEnum } from '../../documentDef/entity/documentdef.entity';

import { ApprovalFlowRepository } from "../../approvalFlow/repository/approvalFlow.repository";
import { CacheService } from "../../global/cache.service";
import { RfpaRepository } from "../../rfpa/repository/rfpa.repository";
import { UserService } from "../../employee/service/user.service";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { DocumentbService, DocumentWithRelatedData } from "../../approvalFlow/service/documentb.service";
import { DocSingalApproverService } from "../../approvalFlow/service/DocSingalApproverService.service";
import { ApprovalFlowService } from "../../approvalFlow/service/approvalFlow.service";
import { DocumentbRepository } from "../../approvalFlow/repository/documentb.repository";
import { ApproveDealSlipResultDto, BulkDeleteDealSlipResultDto, CreateDealSlipDto, DealSlipDetailDto, DealSlipDocumentViewDto, DealSlipListResponseDto, DealSlipNumbersResponseDto, DealSlipRecycleBinResponseDto, UpdateDealSlipDto } from "../dto/dealSlip.dto";
import { DealSlip } from "../entity/dealSlip.entity";
import { DealSlipProduct } from "../entity/dealSlipProduct.entity";
import { PaymentInfoForRFPA } from "../../rfpa/entity/rfpaPayementInfo.entity";
import { dealSlipAvailableSql, liveGrnForDealSlipExistsSql } from "../dealSlipGrnLink";
import { isUuid, liveRowSql } from "../../grn/grnLinks.sql";


const CACHE_PREFIX = 'dealslip';
const CACHE_TTL = 180;
const CACHE_TTL_DETAIL = 300;

@injectable()
export class DealSlipService {

    constructor(
        @inject(TYPES.DealSlipRepository)
        private readonly dealSlipRepository: DealSlipRepository,
        @inject(TYPES.RfpaRepository)
        private readonly rfpaRepository: RfpaRepository,
       @inject(TYPES.UserService)
       private readonly userService:UserService,
       @inject(TYPES.AuditLogService)
       private readonly auditLogService:AuditLogService,
       @inject(TYPES.DocumentbService)
       private readonly documentbService: DocumentbService, // Adjust the type as per your DocumentbService
       @inject(TYPES.DocSingalApproverService)
       private readonly docSingalApproverService: DocSingalApproverService,
       @inject(TYPES.ApprovalFlowService)
    private approvalFlowService: ApprovalFlowService,
      @inject(TYPES.ApprovalFlowRepository)
    private approvalFlowRepository:ApprovalFlowRepository, 

    @inject(TYPES.DocumentbRepository)
    private readonly documentbRepository: DocumentbRepository,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
      ) {}

  private async invalidateDealSlipCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:recycle:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:all:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:nos:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:filter:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${CACHE_PREFIX}:view:${id}`),
        this.cacheService.del(`${CACHE_PREFIX}:update:${id}`),
        // docview is keyed by the Documentb id, not by the deal slip id.
        this.cacheService.invalidatePattern(`${CACHE_PREFIX}:docview:*`),
      );
    }
    await Promise.all(tasks);
  }

   
            
               
                
    
                

  async findAllDealSlip(queryOptions: PaginationOptions): Promise<{ data: any[]; total: number; page: number; totalPages: number }> {
      const key = `${CACHE_PREFIX}:all:${JSON.stringify(queryOptions)}`;
      const cached = await this.cacheService.get<any>(key);
      if (cached) return cached;

      const page = queryOptions.page ?? 1;
      const limit = queryOptions.limit ?? 10;
      const search = queryOptions.search;

      const queryBuilder = this.dealSlipRepository
          .createQueryBuilder("dealSlip")
          .where("dealSlip.isDeleted = false")
          .andWhere("dealSlip.deletedAt IS NULL")
          .orderBy("dealSlip.createdAt", "DESC");

      if (search) {
          queryBuilder.andWhere("dealSlip.dealSlipNo ILIKE :search", { search: `%${search}%` });
      }

      const [dealSlips, total] = await queryBuilder.skip((page - 1) * limit).take(limit).getManyAndCount();

      const formattedDealSlips = dealSlips.map((dealSlip) => {
        const { createdDate, createdTime } = formatDateTime(dealSlip.createdAt);
        return {
          id: dealSlip.id,
          lotNo: dealSlip.lotNo,
          approvalNote: dealSlip.approvalNote,
          loadingLocation: dealSlip.loadingLocation,
          remark: dealSlip.remark,
          specialRequest: dealSlip.specialRequest,
          requestingDepartment: dealSlip.requestingDepartment,
          approvalStatus: dealSlip.approvalStatus,
          createdDate,
          createdTime,
          dealSlipNo: dealSlip.dealSlipNo,
        };
      });

      const response = { data: formattedDealSlips, total, page, totalPages: Math.ceil(total / limit) };
      await this.cacheService.set(key, response, CACHE_TTL);
      return response;
  }

  

  /** Relations needed to show everything the deal slip carries from its RFPA. */
  private static readonly DETAIL_RELATIONS = [
    'rfpa',
    'companyName',
    'purchaseLocation',
    'purchaseForSalesLocation',
    'selectedVendor',
    'selectedVendor.officeAddress',
    'selectedVendor.vendorSaleInfo',
    'selectedFarmer',
    'selectedFarmer.residensialAddress',
    'selectedFarmer.farmAddress',
    'paymentInfo',
    'dealSlipProducts',
    'dealSlipProducts.productName',
    'dealSlipProducts.variant',
    'dealSlipProducts.uom',
    'dealSlipProducts.rfpaProduct',
  ];

  /**
   * The RFPA-derived part of a deal slip response (same shape the RFPA view uses). Each product
   * line carries the deal slip's quantity / price plus the RFPA's, so the two can be compared.
   */
  private formatRfpaDetails(dealSlip: DealSlip): Record<string, any> {
    const vendor: any = dealSlip.selectedVendor;
    const farmer: any = dealSlip.selectedFarmer;
    const payment: any = dealSlip.paymentInfo;

    const vendorInfo = vendor ? {
      companyName: vendor.companyName || null,
      vendorCode: vendor.vendorCode || null,
      contactPersonName: `${vendor.vendorSaleInfo?.contactFName ?? ''} ${vendor.vendorSaleInfo?.contactLName ?? ''}`.trim() || null,
      officeContactNo: vendor.officeContactNo || null,
      officeEmail: vendor.officeEmail || null,
      officeAddress: vendor.officeAddress || null,
    } : null;

    const farmerInfo = farmer ? {
      fullName: `${farmer.farmerfName ?? ''} ${farmer.farmermName ?? ''} ${farmer.farmerlName ?? ''}`.trim(),
      primaryMobileNo: farmer.primaryMobileNo || null,
      email: farmer.email || null,
      farmerCode: farmer.farmerCode || null,
      residensialAddress: farmer.residensialAddress || null,
      farmAddress: farmer.farmAddress || null,
    } : null;

    return {
      source: dealSlip.source || null,
      companyName: dealSlip.companyName?.name || null,
      purchaseLocation: dealSlip.purchaseLocation?.name || null,
      purchaseForSalesLocation: dealSlip.purchaseForSalesLocation?.name || null,
      otherPurchaseLoc: dealSlip.otherPurchaseLoc || null,
      otherPurchaseForSalesLoc: dealSlip.otherPurchaseForSalesLoc || null,
      deliveryReceivingPerson: dealSlip.deliveryReceivingPerson || null,
      packingInstruction: dealSlip.packingInstruction || null,
      selectedParty: dealSlip.source === 'vendor' ? vendorInfo : farmerInfo,
      paymentInfo: payment ? {
        paymentMode: payment.paymentMode || null,
        paymentDate: payment.paymentDate || null,
        advancePaidAmt: payment.advancePaidAmt || null,
        paymentTerms: payment.paymentTerms || null,
        dueDate: payment.dueDate || null,
        creditPeriod: payment.creditPeriod || null,
        validityOfQuote: payment.validityOfQuote || null,
      } : null,
      dealSlipProducts: (dealSlip.dealSlipProducts ?? []).map((p) => ({
        id: p.id,
        productName: p.productName?.name || null,
        variant: (p.variant as any)?.variantName || null,
        grade: p.grade || null,
        quantity: p.quantity,
        rfpaQuantity: p.rfpaProduct?.quantity ?? null,
        uom: (p.uom as any)?.unit || null,
        unitPrice: p.unitPrice,
        rfpaUnitPrice: p.rfpaProduct?.unitPrice ?? null,
        amount: p.amount,
        count: p.count || null,
        size: p.size || null,
        origin: p.origin || null,
        variety: p.variety || null,
        purchaseDate: p.purchaseDate || null,
        expectedHarvestDate: p.expectedHarvestDate || null,
        dispatchDate: p.dispatchDate || null,
        deliveryDate: p.deliveryDate || null,
      })),
    };
  }

  async findDealSlipByIdforView(id: string): Promise<DealSlipDetailDto | null> {
      const key = `${CACHE_PREFIX}:view:${id}`;
      const cached = await this.cacheService.get<any>(key);
      if (cached) return cached;

      const dealSlip = await this.dealSlipRepository.findOne({
          where: { id },
          relations: DealSlipService.DETAIL_RELATIONS,
      });

      if (!dealSlip) return null;

      const { createdDate, createdTime } = formatDateTime(dealSlip.createdAt);
      const response: any = {
          id: dealSlip.id,
          lotNo: dealSlip.lotNo,
          approvalNote: dealSlip.approvalNote,
          loadingLocation: dealSlip.loadingLocation,
          remark: dealSlip.remark,
          specialRequest: dealSlip.specialRequest,
          requestingDepartment: dealSlip.requestingDepartment,
          approvalStatus: dealSlip.approvalStatus,
          createdDate,
          createdTime,
          dealSlipNo: dealSlip.dealSlipNo,
          rfpa: dealSlip.rfpa?.rfpaId || null,
          ...this.formatRfpaDetails(dealSlip),
      };
      await this.cacheService.set(key, response, CACHE_TTL_DETAIL);
      return response;
  }

  async findDealSlipByIdforUpdate(id: string): Promise<DealSlipDetailDto | null> {
      const key = `${CACHE_PREFIX}:update:${id}`;
      const cached = await this.cacheService.get<any>(key);
      if (cached) return cached;

      const dealSlip = await this.dealSlipRepository.findOne({
          where: { id },
          relations: DealSlipService.DETAIL_RELATIONS,
      });

      if (!dealSlip) return null;

      const { createdDate, createdTime } = formatDateTime(dealSlip.createdAt);
      const response: any = {
          id: dealSlip.id,
          lotNo: dealSlip.lotNo,
          approvalNote: dealSlip.approvalNote,
          loadingLocation: dealSlip.loadingLocation,
          remark: dealSlip.remark,
          specialRequest: dealSlip.specialRequest,
          requestingDepartment: dealSlip.requestingDepartment,
          approvalStatus: dealSlip.approvalStatus,
          createdDate,
          createdTime,
          dealSlipNo: dealSlip.dealSlipNo,
          rfpa: dealSlip.rfpa?.id || null,
          ...this.formatRfpaDetails(dealSlip),
      };
      await this.cacheService.set(key, response, CACHE_TTL_DETAIL);
      return response;
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

  async createDealSlip(dealSlipData: CreateDealSlipDto & Record<string, any>): Promise<CreatedWithApproval<DealSlip>> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(dealSlipData.requestedBy, DocDefEnum.PROCUREMENT);

      // const approvalFlow = await this.approvalFlowService.findApprovalFlowForLoggedUser(dealSlipData.requestedBy, DocDefEnum.PROCUREMENT);

      // if (!approvalFlow) {
      //   throw new AppError(400, 'No approval flow configured for this user. Please contact the admin to create an approval flow before creating a Deal Slip.');
      // }
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
              const rfpaId=dealSlipData.rfpa

              if(!rfpaId)
              {
                throw new Error("id not found")
              }

          const rfpa = await queryRunner.manager.findOne(this.rfpaRepository.target, { where: { id: rfpaId } }); 

              if (!rfpa) {
                  throw new Error('RFPA not found');
              }

              if (rfpa.isDealSlipCreated) {
                  throw new AppError(409, 'Deal slip already created for this RFPA. Please check existing deal slips.');
              }

              const dealSlipId = await this.generateDealSlipId();
              dealSlipData.dealSlipNo = dealSlipId;

              const dealSlip = queryRunner.manager.create(this.dealSlipRepository.target, {
                  ...dealSlipData,
                  rfpa
              } as any) as unknown as DealSlip;

              const savedDealSlip= await queryRunner.manager.save(dealSlip);

              rfpa.isDealSlipCreated = true;
              await queryRunner.manager.save(rfpa);

                     const document = await this.documentbService.createDocument({
                            type: DocumentTypeEnum.DEAL_SLIP,
                            docDef: DocDefEnum.PROCUREMENT,
                            status: DocumentStatus.HOLD,
                            remarks: 'Document auto-created with Deal Slip',
                            lastActionBy: { id: dealSlipData.requestedBy },
                            document_type_id: Array.isArray(savedDealSlip) ? (savedDealSlip[0] as DealSlip)?.id : (savedDealSlip as DealSlip).id
                          });

          await queryRunner.commitTransaction();

          const assignment = await this.documentbService.startApprovalFlow(document.id);
          await this.invalidateDealSlipCache();

                          return withApproval(savedDealSlip, assignment);
        } catch (error: any) {
          await queryRunner.rollbackTransaction();
          throw error;
        } finally {
          await queryRunner.release();
        }
      }

    
    

      /** Next number of the day; issued by the shared sequence (no COUNT / MAX race, never reused). */
      async generateDealSlipId(): Promise<string> {
        return nextDocumentNumber(this.dealSlipRepository.manager, SERIES.dealSlip, `DL${compactDate()}`, 5);
      }

  
  public async approveDealSlip(dealSlipId: string, userId: string, data: { approvalStatus: string; approvalNote?: string }): Promise<ApproveDealSlipResultDto> {
  const dealSlip = await this.dealSlipRepository.findOne({ where: { id: dealSlipId } });

  if (!dealSlip) {
    throw new Error('Deal Slip not found');
  }

  if (data.approvalStatus !== Status.APPROVED && data.approvalStatus !== Status.REJECTED) {
    throw new Error('Invalid approval status. It must be either APPROVED or REJECTED.');
  }

  dealSlip.approvalStatus = data.approvalStatus;
  dealSlip.approvalNote = data.approvalNote || '';
  dealSlip.dealSlipApprovedAt = new Date();

  await this.dealSlipRepository.save(dealSlip);
  await this.invalidateDealSlipCache(dealSlipId);

  const user = await this.userService.findUserById(userId) as any;
  if (!user) throw new Error('User not found');

  return {
    message: `Deal Slip status updated to ${data.approvalStatus}`,
    approvalStatus: dealSlip.approvalStatus,
    approvalNote: dealSlip.approvalNote,
    user: {
      name: `${user.firstName} ${user.lastName}`,
      department: user.selectDepartment,
    },
  };
}

    /**
     * Every Deal Slip data field the update endpoint accepts; the frontend decides which of them
     * a user may actually change. Not accepted: identity / workflow fields (id, dealSlipNo, the
     * rfpa link, createdBy, approvalStatus, approvalNote, dealSlipApprovedAt, isGrnCreated,
     * isDeleted, timestamps) - those are set by the system and the approval flow.
     */
    private static readonly SCALAR_FIELDS = [
      'lotNo', 'loadingLocation', 'specialRequest', 'remark', 'requestingDepartment',
      'otherPurchaseLoc', 'otherPurchaseForSalesLoc', 'deliveryReceivingPerson', 'packingInstruction', 'source',
    ] as const;

    /** Many-to-one fields, sent as an id (or { id }); null / '' clears them. */
    private static readonly RELATION_FIELDS = [
      'companyName', 'purchaseLocation', 'purchaseForSalesLocation', 'selectedVendor', 'selectedFarmer',
    ] as const;

    private static readonly PAYMENT_FIELDS = [
      'paymentMode', 'paymentDate', 'advancePaidAmt', 'paymentTerms', 'dueDate', 'creditPeriod', 'validityOfQuote',
    ] as const;

    private static readonly PRODUCT_SCALAR_FIELDS = [
      'grade', 'count', 'size', 'origin', 'variety',
      'purchaseDate', 'expectedHarvestDate', 'dispatchDate', 'deliveryDate',
    ] as const;

    private static readonly PRODUCT_RELATION_FIELDS = ['productName', 'variant', 'uom'] as const;

    private static toRef(value: any): { id: string } | null {
      if (value === null || value === undefined || value === '') return null;
      const id = typeof value === 'object' ? value.id : value;
      return id ? { id } : null;
    }

    public async updateDealSlip(
      id: string,
      dealSlipData: UpdateDealSlipDto & Record<string, any>,
      updatedBy: string,
      actor?: { userId: string; isAdmin: boolean },
    ): Promise<DealSlip | null> {
      const existingDealSlip = await this.dealSlipRepository.findOne({ where: { id }, relations: ['createdBy', 'paymentInfo'] });
      if (!existingDealSlip) {
        return null;
      }

      const document = await this.documentbRepository.findOne({
        where: { type: DocumentTypeEnum.DEAL_SLIP, document_type_id: id },
      });
      const wasDraft = document?.status === DocumentStatus.DRAFT;

      // A draft is the RFPA creator's to complete (admins can too); nobody else may touch it.
      if (wasDraft && actor && !actor.isAdmin && existingDealSlip.createdBy?.id !== actor.userId) {
        throw new AppError(403, 'Only the RFPA creator can edit this draft Deal Slip');
      }

      const originalDealSlip = { ...existingDealSlip };

      for (const field of DealSlipService.SCALAR_FIELDS) {
        if (dealSlipData[field] !== undefined) {
          (existingDealSlip as any)[field] = dealSlipData[field];
        }
      }
      for (const field of DealSlipService.RELATION_FIELDS) {
        if (dealSlipData[field] !== undefined) {
          (existingDealSlip as any)[field] = DealSlipService.toRef(dealSlipData[field]);
        }
      }

      await this.dataSource.transaction(async (manager) => {
        if (dealSlipData.paymentInfo && typeof dealSlipData.paymentInfo === 'object') {
          existingDealSlip.paymentInfo = await this.savePaymentInfo(manager, existingDealSlip.paymentInfo, dealSlipData.paymentInfo);
        }
        await manager.save(existingDealSlip);
        await this.updateProducts(manager, existingDealSlip, dealSlipData);
      });

      await this.auditLogService.logChange(
        'DealSlip',
        existingDealSlip.id,
        originalDealSlip,
        existingDealSlip,
        updatedBy
      );

      // Draft -> Hold: once lot no and loading location are both filled in, the slip is sent to
      // the approvers. Only ever fires from DRAFT, so it happens exactly once.
      if (document && wasDraft && existingDealSlip.lotNo?.trim() && existingDealSlip.loadingLocation?.trim()) {
        await this.releaseDraftToApprovers(document);
      }

      await this.invalidateDealSlipCache(id);
      return existingDealSlip;
    }

    /**
     * Updates the deal slip's own copy of the payment info (never the RFPA's row). Creates the
     * row when the deal slip has none yet.
     */
    private async savePaymentInfo(
      manager: EntityManager,
      current: PaymentInfoForRFPA | null | undefined,
      edits: Record<string, any>,
    ): Promise<PaymentInfoForRFPA> {
      const payment = current ?? manager.create(PaymentInfoForRFPA, {});
      for (const field of DealSlipService.PAYMENT_FIELDS) {
        if (edits[field] !== undefined) {
          (payment as any)[field] = edits[field];
        }
      }
      return manager.save(payment);
    }

    /**
     * Applies product line changes from the request:
     *  - dealSlipProducts[] with an id  -> updates that line (any product field)
     *  - dealSlipProducts[] without id  -> adds a new line (quantity and unitPrice required)
     *  - deletedDealSlipProductIds[]    -> removes those lines
     * `amount` is always recomputed here as quantity x unitPrice; the client's value is ignored.
     */
    private async updateProducts(
      manager: EntityManager,
      dealSlip: DealSlip,
      body: { dealSlipProducts?: Record<string, any>[]; deletedDealSlipProductIds?: string[] },
    ): Promise<void> {
      const deletedIds = Array.isArray(body.deletedDealSlipProductIds) ? body.deletedDealSlipProductIds : [];
      if (deletedIds.length) {
        const owned = await manager.count(DealSlipProduct, { where: { id: In(deletedIds), dealSlip: { id: dealSlip.id } } });
        if (owned !== deletedIds.length) {
          throw new AppError(400, 'One or more product lines to remove do not belong to this Deal Slip');
        }
        await manager.delete(DealSlipProduct, { id: In(deletedIds) });
      }

      const edits = Array.isArray(body.dealSlipProducts) ? body.dealSlipProducts : [];
      for (const edit of edits) {
        let product: DealSlipProduct;
        if (edit.id) {
          const existing = await manager.findOne(DealSlipProduct, { where: { id: edit.id, dealSlip: { id: dealSlip.id } } });
          if (!existing) {
            throw new AppError(400, `Product line ${edit.id} does not belong to this Deal Slip`);
          }
          product = existing;
        } else {
          if (edit.quantity === undefined || edit.unitPrice === undefined) {
            throw new AppError(400, 'A new product line needs quantity and unitPrice');
          }
          product = manager.create(DealSlipProduct, { dealSlip });
        }

        for (const field of DealSlipService.PRODUCT_SCALAR_FIELDS) {
          if (edit[field] !== undefined) (product as any)[field] = edit[field];
        }
        for (const field of DealSlipService.PRODUCT_RELATION_FIELDS) {
          if (edit[field] !== undefined) (product as any)[field] = DealSlipService.toRef(edit[field]);
        }

        const quantity = edit.quantity !== undefined ? Number(edit.quantity) : Number(product.quantity);
        const unitPrice = edit.unitPrice !== undefined ? Number(edit.unitPrice) : Number(product.unitPrice);
        if (!Number.isInteger(quantity) || quantity < 0) {
          throw new AppError(400, 'Quantity must be a non-negative whole number');
        }
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new AppError(400, 'Unit price must be a non-negative number');
        }

        product.quantity = quantity;
        product.unitPrice = unitPrice;
        product.amount = parseFloat((quantity * unitPrice).toFixed(2));
        await manager.save(product);
      }
    }

    /** DRAFT -> HOLD and assign the approvers. Rolls the status back if the approvers cannot be assigned. */
    private async releaseDraftToApprovers(document: Documentb): Promise<void> {
      document.status = DocumentStatus.HOLD;
      document.remarks = 'Deal Slip completed; sent for approval';
      await this.documentbRepository.save(document);

      try {
        await this.documentbService.startApprovalFlow(document.id);
      } catch (error) {
        document.status = DocumentStatus.DRAFT;
        document.remarks = 'Deal Slip auto-created as draft; waiting for lot no and loading location';
        await this.documentbRepository.save(document);
        throw error;
      }

      await Promise.all([
        this.cacheService.del(`doc:byid:${document.id}`),
        this.cacheService.invalidatePattern(`singledoc:view:${document.id}:*`),
      ]);
    }

public async getAllDealSlipsNo(
  filter: {
    overAllStatus?: string;
    isGrnCreated?: boolean;
    employeeBaseHirechey?: boolean;
    page?: number;
    limit?: number;
    search?: string;
    /** GRN picker (D-6): only approved deal slips not used by a live, non-rejected GRN. */
    available?: boolean;
    /** GRN picker: always list this deal slip (the GRN being edited keeps its own slip). */
    includeId?: string;
  },
  loginUserId: string
): Promise<DealSlipNumbersResponseDto> {
  if (filter?.available) {
    return this.getAvailableDealSlipNumbers(filter);
  }

  const key = `${CACHE_PREFIX}:nos:${loginUserId}:${JSON.stringify(filter)}`;
  const cached = await this.cacheService.get<any>(key);
  if (cached) return cached;

  const where: any = { isDeleted: false };

  const dealSlips = await this.dealSlipRepository.find({
    select: ["id", "dealSlipNo"],
    where,
    relations: ["createdBy", "rfpa"],
    order: { createdAt: "DESC" }
  });

  let validDealSlips = dealSlips.filter(d => d.id && d.dealSlipNo);
  // D-6: "GRN created" is derived (a live, non-rejected GRN references the slip); the column is not read.
  if (typeof filter?.isGrnCreated === "boolean" && validDealSlips.length) {
    const usedRows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT ds.id FROM deal_slips ds WHERE ds.id = ANY($1::uuid[]) AND ${liveGrnForDealSlipExistsSql('ds.id')}`,
      [validDealSlips.map(d => d.id)],
    );
    const usedIds = new Set(usedRows.map(r => r.id));
    validDealSlips = validDealSlips.filter(d => usedIds.has(d.id) === filter.isGrnCreated);
  }
  if (!validDealSlips.length) {
    const empty = { data: [], pagination: { total: 0, page: filter.page || 1, limit: filter.limit || 10, totalPages: 0 } };
    await this.cacheService.set(key, empty, CACHE_TTL);
    return empty;
  }

  const dsIds = validDealSlips.map(d => d.id);
  const documents = await this.documentbRepository
    .createQueryBuilder('doc')
    .select(['doc.id', 'doc.status', 'doc.document_type_id'])
    .where('doc.document_type_id IN (:...ids)', { ids: dsIds })
    .getMany();
  const docMap = new Map(documents.map(d => [d.document_type_id, d]));

  let approvalFlowMap = new Map<string, any>();
  if (filter?.employeeBaseHirechey) {
    const creatorIds = [...new Set(validDealSlips.map(d => d.createdBy?.id).filter(Boolean))] as string[];
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

  const filteredResults: { id: string; dealSlipNo: string; documentId: string | null; rfpaId: string | null }[] = [];

  for (const dealSlip of validDealSlips) {
    const doc = docMap.get(dealSlip.id);
    const documentId = doc?.id || null;
    const documentStatus = doc?.status;

    if (filter?.employeeBaseHirechey) {
      const approvalFlow = approvalFlowMap.get(dealSlip.createdBy?.id);
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
      if (hierarchy === 1 && dealSlip.createdBy?.id !== loginUserId) continue;
    }

    const matchesStatus = !filter?.overAllStatus || documentStatus === filter.overAllStatus;

    if (matchesStatus) {
      filteredResults.push({ id: dealSlip.id, dealSlipNo: dealSlip.dealSlipNo, documentId, rfpaId: (dealSlip as any).rfpa?.id || null });
    }
  }

  let searchedResults = filteredResults;
  if (filter?.search) {
    const term = filter.search.toLowerCase().trim();
    searchedResults = filteredResults.filter(item =>
      item.dealSlipNo.toLowerCase().includes(term) ||
      item.id.toLowerCase() === term  // exact ID match
    );
  }

  const page = filter.page || 1;
  const limit = filter.limit || 10;
  const paginatedResults = searchedResults.slice((page - 1) * limit, page * limit);

  const nosResponse = {
    data: paginatedResults,
    pagination: {
    total: searchedResults.length,
    page,
    limit,
    totalPages: Math.ceil(searchedResults.length / limit)
    }
  };
  await this.cacheService.set(key, nosResponse, CACHE_TTL);
  return nosResponse;
}

/**
 * Deal slip picker of the GRN form (D-6), all in SQL: live deal slips whose
 * latest document is COMPLETE and that no live, non-rejected GRN references;
 * `includeId` is always listed when live (edit mode). `search` matches
 * `dealSlipNo` (ILIKE) or the exact id. Not cached: the list changes the
 * moment a GRN is created, rejected or deleted.
 */
private async getAvailableDealSlipNumbers(filter: {
  page?: number;
  limit?: number;
  search?: string;
  includeId?: string;
}): Promise<DealSlipNumbersResponseDto> {
  const page = Math.max(1, Number(filter.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(filter.limit) || 10));
  const params: unknown[] = [];
  const conditions: string[] = [];

  const includeId = typeof filter.includeId === 'string' && isUuid(filter.includeId.trim()) ? filter.includeId.trim() : null;
  let orderBy = `ds."createdAt" DESC`;
  if (includeId) {
    params.push(includeId);
    conditions.push(`((${dealSlipAvailableSql('ds')}) OR (ds.id = $${params.length}::uuid AND ${liveRowSql('ds')}))`);
    // The included slip comes first so the edit form always finds it.
    orderBy = `(ds.id = $${params.length}::uuid) DESC, ${orderBy}`;
  } else {
    conditions.push(`(${dealSlipAvailableSql('ds')})`);
  }
  if (filter.search && String(filter.search).trim()) {
    const term = String(filter.search).trim();
    params.push(`%${term}%`, term);
    conditions.push(`(ds."dealSlipNo" ILIKE $${params.length - 1} OR ds.id::text = $${params.length})`);
  }
  conditions.push(`ds."dealSlipNo" IS NOT NULL`);
  const where = conditions.join(' AND ');

  const countRows: Array<{ total: string }> = await this.dataSource.query(
    `SELECT COUNT(*)::text AS total FROM deal_slips ds WHERE ${where}`,
    params,
  );
  const total = Number(countRows[0]?.total ?? 0);

  params.push(limit, (page - 1) * limit);
  const rows: Array<{ id: string; dealSlipNo: string; rfpaId: string | null; documentId: string | null }> = await this.dataSource.query(
    `SELECT ds.id, ds."dealSlipNo" AS "dealSlipNo", ds.rfpa_id AS "rfpaId",
            (SELECT d.id::text FROM documents d
              WHERE d.document_type_id = ds.id::text AND d.type::text = $${params.length + 1} AND d."deletedAt" IS NULL
              ORDER BY d."createdAt" DESC LIMIT 1) AS "documentId"
       FROM deal_slips ds
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    [...params, DocumentTypeEnum.DEAL_SLIP],
  );

  return {
    data: rows.map(r => ({ id: r.id, dealSlipNo: r.dealSlipNo, documentId: r.documentId ?? null, rfpaId: r.rfpaId ?? null })),
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

public async deleteDealSlip(dealSlipId: string): Promise<{ dealSlipNo: string } | null> {
  const dealSlip = await this.dealSlipRepository.findOne({ where: { id: dealSlipId }, select: ['id', 'dealSlipNo'] });
  if (!dealSlip) {
    throw new AppError(404, `Deal Slip with ID ${dealSlipId} not found`);
  }

  const sixMonthsFromNow = new Date();
  sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
  sixMonthsFromNow.setHours(0, 0, 0, 0);

  await this.dealSlipRepository.update({ id: dealSlipId }, { deletionScheduledAt: sixMonthsFromNow } as any);
  await this.invalidateDealSlipCache(dealSlipId);
  return { dealSlipNo: dealSlip.dealSlipNo };
}

 public async getAllDealSlips(queryOptions: PaginationOptions, userId: string, isAdmin: boolean = false): Promise<DealSlipListResponseDto> {
  const key = `${CACHE_PREFIX}:list:${userId}:${isAdmin ? 'admin' : 'user'}:${JSON.stringify(queryOptions)}`;
  const cached = await this.cacheService.get<any>(key);
  if (cached) return cached;

  const data = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(
    userId,
    DocumentTypeEnum.DEAL_SLIP,
    false,
    queryOptions,
    isAdmin,
  );
  const data1 = await buildQueryFromArray(data, queryOptions);
  const { search } = queryOptions;

  const activeDocuments = data1.data as DocumentWithRelatedData[];

  const dsIds = activeDocuments.map(d => d.document_type_id).filter(Boolean) as string[];
  const dealSlips = dsIds.length
    ? await this.dealSlipRepository
        .createQueryBuilder('ds')
        .leftJoinAndSelect('ds.rfpa', 'rfpa')
        .where('ds.id IN (:...ids)', { ids: dsIds })
        .andWhere('ds.isDeleted = false')
        .andWhere('ds.deletedAt IS NULL')
        .getMany()
    : [];
  const dsMap = new Map(dealSlips.map(d => [d.id, d]));
  const docCreatedAtMap = new Map(activeDocuments.map(d => [d.id, d.createdAt]));

  let relatedDataOnly = activeDocuments
    .filter(doc => doc.document_type_id && dsMap.has(doc.document_type_id))
    .map((doc) => {
      const rd = dsMap.get(doc.document_type_id!)!;
      const { createdDate, createdTime } = formatDateTime(doc.createdAt);
      return {
        documentId: doc.id,
        overAllStatus: doc.status,
        createdBy: `${doc.lastActionBy?.firstName || ''} ${doc.lastActionBy?.lastName || ''}`.trim(),
        createdDate,
        createdTime,
        id: rd.id,
        rfpa: rd.rfpa?.rfpaId || null,
        lotNo: rd.lotNo || null,
        loadingLocation: rd.loadingLocation || null,
        remark: rd.remark || null,
        specialRequest: rd.specialRequest || null,
        dealSlipNo: rd.dealSlipNo || null,
      };
    });

  const objectToString = (obj: any): string => {
    if (obj == null) return '';
    if (typeof obj === 'object') return Object.values(obj).map((v) => objectToString(v)).join(' ');
    return String(obj);
  };

  if (search && search.trim()) {
    const term = search.toLowerCase();
    relatedDataOnly = relatedDataOnly.filter(item => objectToString(item).toLowerCase().includes(term));
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

  const listResponse = {
    data: relatedDataOnly,
    meta: { total: data1.meta.total, page: data1.meta.page, pages: data1.meta.pages },
  };
  await this.cacheService.set(key, listResponse, CACHE_TTL);
  return listResponse;
}

public async getRecycleBinDealSlips(queryOptions: PaginationOptions, userId: string): Promise<DealSlipRecycleBinResponseDto> {
  const recycleKey = `${CACHE_PREFIX}:recycle:${userId}:${JSON.stringify(queryOptions)}`;
  const recycleCached = await this.cacheService.get<any>(recycleKey);
  if (recycleCached) return recycleCached;

  const data = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(
    userId,
    DocumentTypeEnum.DEAL_SLIP,
    true,
  );
  const data1 = await buildQueryFromArray(data, queryOptions);
  const { search } = queryOptions;

  const activeDocuments = data1.data as DocumentWithRelatedData[];

  const dsIds = activeDocuments.map(d => d.document_type_id).filter(Boolean) as string[];
  const dealSlips = dsIds.length
    ? await this.dealSlipRepository
        .createQueryBuilder('ds')
        .where('ds.id IN (:...ids)', { ids: dsIds })
        .andWhere('ds.isDeleted = true')
        .getMany()
    : [];
  const dsMap = new Map(dealSlips.map(d => [d.id, d]));
  const recycleDocCreatedAtMap = new Map(activeDocuments.map(d => [d.id, d.createdAt]));

  let relatedDataOnly = activeDocuments
    .filter(doc => doc.document_type_id && dsMap.has(doc.document_type_id))
    .map((doc) => {
      const rd = dsMap.get(doc.document_type_id!)!;
      const { createdDate, createdTime } = formatDateTime(doc.createdAt);
      return {
        documentId: doc.id,
        overAllStatus: doc.status,
        createdBy: doc.lastActionBy,
        createdDate,
        createdTime,
        id: rd.id,
        lotNo: rd.lotNo || null,
        approvalNote: rd.approvalNote || null,
        loadingLocation: rd.loadingLocation || null,
        remark: rd.remark || null,
        specialRequest: rd.specialRequest || null,
        requestingDepartment: rd.requestingDepartment || null,
        approvalStatus: rd.approvalStatus || null,
        dealSlipCreatedAt: rd.dealSlipCreatedAt || null,
        dealSlipApprovedAt: rd.dealSlipApprovedAt || null,
        dealSlipNo: rd.dealSlipNo || null,
      };
    });

  const objectToString = (obj: any): string => {
    if (obj == null) return '';
    if (typeof obj === 'object') return Object.values(obj).map((v) => objectToString(v)).join(' ');
    return String(obj);
  };

  if (search && search.trim()) {
    const term = search.toLowerCase();
    relatedDataOnly = relatedDataOnly.filter(item => objectToString(item).toLowerCase().includes(term));
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

  const recycleResponse = {
    data: relatedDataOnly,
    meta: { total: data1.meta.total, page: data1.meta.page, pages: data1.meta.pages },
  };
  await this.cacheService.set(recycleKey, recycleResponse, CACHE_TTL);
  return recycleResponse;
}
public async getDealSlipByIdForView(docid: string, userId: string, isAdmin: boolean = false): Promise<DealSlipDocumentViewDto | null> {
    // Keyed by userId as well: access is checked per user, so a shared key would
    // serve the document to users who are not allowed to see it.
    const key = `${CACHE_PREFIX}:docview:${docid}:${userId}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const document = await this.docSingalApproverService.getSingleApprovalDocumentById(docid, userId, isAdmin);
    if (!document) return null;

    const id = document.documentTypeId;
    if (!id) throw new Error('Document type ID not found.');

    const dealSlip = await this.dealSlipRepository.findOne({
      where: { id },
      relations: DealSlipService.DETAIL_RELATIONS,
    });

    if (!dealSlip) throw new Error('dealSlip not found');

    const { createdDate, createdTime } = formatDateTime(dealSlip.createdAt);
    const viewResult = {
      documentId: document.documentId,
      overAllStatus: document.status,
      createdBy: document.createdBy,
      createdDate,
      createdTime,
      approvalSummary: document.approvalSummary ?? null,
      id: dealSlip.id,
      lotNo: dealSlip.lotNo,
      approvalNote: dealSlip.approvalNote,
      loadingLocation: dealSlip.loadingLocation,
      remark: dealSlip.remark,
      specialRequest: dealSlip.specialRequest,
      requestingDepartment: dealSlip.requestingDepartment,
      approvalStatus: dealSlip.approvalStatus,
      dealSlipCreatedAt: dealSlip.dealSlipCreatedAt,
      dealSlipApprovedAt: dealSlip.dealSlipApprovedAt,
      dealSlipNo: dealSlip.dealSlipNo,
      rfpa: dealSlip.rfpa?.rfpaId || null,
      ...this.formatRfpaDetails(dealSlip),
    };
    await this.cacheService.set(key, viewResult, CACHE_TTL_DETAIL);
    return viewResult;
}


public async deleteMultipleDealSlips(ids: string[]): Promise<BulkDeleteDealSlipResultDto & { deletedNos: string[] }> {
  if (!ids.length) return { message: 'No IDs provided', deletedNos: [] };

  const [dealSlips, relatedDocuments] = await Promise.all([
    this.dealSlipRepository.find({ where: { id: In(ids) } }),
    this.documentbRepository
      .createQueryBuilder('doc')
      .select(['doc.id', 'doc.document_type_id'])
      .where('doc.document_type_id IN (:...ids)', { ids })
      .getMany(),
  ]);

  const foundIds = new Set(dealSlips.map(d => d.id));
  const missingId = ids.find(id => !foundIds.has(id));
  if (missingId) throw new AppError(404, `Deal Slip with ID ${missingId} not found`);

  const deletedNos = dealSlips.map(d => d.dealSlipNo).filter(Boolean) as string[];

  const docIds = relatedDocuments.map(d => d.id);
 
  if (docIds.length) {
    const docResult = await this.documentbRepository
      .createQueryBuilder()
      .update()
      .set({ isDeleted: true } as any)
      .whereInIds(docIds)
      .execute();
  }

  const dsResult = await this.dealSlipRepository
    .createQueryBuilder()
    .update()
    .set({ isDeleted: true } as any)
    .whereInIds(ids)
    .execute();
 

  await Promise.all([
    ...ids.flatMap(id => [
      this.cacheService.del(`${CACHE_PREFIX}:id:${id}`),
      this.cacheService.del(`${CACHE_PREFIX}:view:${id}`),
      this.cacheService.del(`${CACHE_PREFIX}:update:${id}`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:docview:${id}:*`),
    ]),
    this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
    this.cacheService.invalidatePattern(`${CACHE_PREFIX}:recycle:*`),
    this.cacheService.invalidatePattern(`${CACHE_PREFIX}:all:*`),
    this.cacheService.invalidatePattern(`${CACHE_PREFIX}:nos:*`),
    this.cacheService.invalidatePattern(`${CACHE_PREFIX}:filter:*`),
  ]);

  return { message: 'dealSlip records marked for deletion successfully', deletedNos };
}
 
}



//  async filterDealSlips(
//   page: number,
//   limit: number,
//   filters: Record<string, any>
// ) {
//   const filterKey = `${CACHE_PREFIX}:filter:${page}:${limit}:${JSON.stringify(filters)}`;
//   const filterCached = await this.cacheService.get<any>(filterKey);
//   if (filterCached) return filterCached;

//   const queryBuilder: SelectQueryBuilder<DealSlip> =
//     this.dealSlipRepository.createQueryBuilder("dealSlip");

//   queryBuilder.select("dealSlip");

//   queryBuilder
//     .where("dealSlip.isDeleted = false")
//     .andWhere("dealSlip.deletedAt IS NULL");

//   queryBuilder
//     .leftJoin("dealSlip.rfpa", "rfpa")
//     .addSelect("rfpa.rfpaId");

//   Object.entries(filters).forEach(([key, value]) => {
//     if (key.includes(".")) {
//       const [alias, field] = key.split(".");
//       queryBuilder.andWhere(`${alias}.${field} ILIKE :${field}`, {
//         [field]: `%${value}%`,
//       });
//     } else {
//       if (typeof value === "string" && isNaN(Number(value))) {
//         queryBuilder.andWhere(`dealSlip.${key} ILIKE :${key}`, {
//           [key]: `%${value}%`,
//         });
//       } else {
//         queryBuilder.andWhere(`dealSlip.${key} = :${key}`, { [key]: value });
//       }
//     }
//   });

//   queryBuilder.skip((page - 1) * limit).take(limit);

//   const [data, total] = await queryBuilder.getManyAndCount();

//   const filterResult = {
//     data,
//     total,
//     page,
//     limit,
//     totalPages: Math.ceil(total / limit),
//   };
//   await this.cacheService.set(filterKey, filterResult, CACHE_TTL);
//   return filterResult;
// }


  // async findDealSlipById(id: string): Promise<DealSlipDetailDto | null> {
  //     const key = `${CACHE_PREFIX}:id:${id}`;
  //     const cached = await this.cacheService.get<any>(key);
  //     if (cached) return cached;

  //     const dealSlip = await this.dealSlipRepository.findOne({
  //         where: { id },
  //         relations: ['rfpa'],
  //     });

  //     if (!dealSlip) return null;

  //     const { createdDate, createdTime } = formatDateTime(dealSlip.createdAt);
  //     const response: any = {
  //         id: dealSlip.id,
  //         lotNo: dealSlip.lotNo,
  //         approvalNote: dealSlip.approvalNote,
  //         loadingLocation: dealSlip.loadingLocation,
  //         remark: dealSlip.remark,
  //         specialRequest: dealSlip.specialRequest,
  //         requestingDepartment: dealSlip.requestingDepartment,
  //         approvalStatus: dealSlip.approvalStatus,
  //         createdDate,
  //         createdTime,
  //         dealSlipNo: dealSlip.dealSlipNo,
  //         rfpa: dealSlip.rfpa?.id || null,
  //     };
  //     await this.cacheService.set(key, response, CACHE_TTL_DETAIL);
  //     return response;
  // }