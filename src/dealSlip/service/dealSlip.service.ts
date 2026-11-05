import { refreshTransactionOf } from '../../transactions/transaction.core';
import { inject, injectable } from "inversify";
import { TYPES } from "../../types";
import { DealSlipRepository } from "../repository/dealSlip.repository";

import { DeepPartial, In, SelectQueryBuilder, DataSource, EntityManager } from "typeorm";

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
import { BulkDeleteDealSlipResultDto, DealSlipDetailDto, DealSlipDocumentViewDto, DealSlipUpdateFormDto, DealSlipListResponseDto, DealSlipNumbersResponseDto, DealSlipRecycleBinResponseDto, UpdateDealSlipDto } from "../dto/dealSlip.dto";
import { DealSlip } from "../entity/dealSlip.entity";
import { DealSlipProduct } from "../entity/dealSlipProduct.entity";
import { UOM } from "../../uom/entity/uom.entity";
import { assertDocumentEditable } from "../../approvalFlow/documentEditLock";
import { DetailMode, formatProcurementHeader, formatProcurementLine, PROCUREMENT_HEADER_RELATIONS, procurementLineRelations } from "../../procurement/procurementDetail";
import { DealSlipState, planDealSlipEdit, toDateOnly } from "../dealSlipEdit";
import { dealSlipApproverId } from "../dealSlipApprover";
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
          approvalStatus: dealSlip.approvalStatus,
          createdDate,
          createdTime,
          dealSlipNo: dealSlip.dealSlipNo,
          txnNo: dealSlip.txnNo ?? null,
        };
      });

      const response = { data: formattedDealSlips, total, page, totalPages: Math.ceil(total / limit) };
      await this.cacheService.set(key, response, CACHE_TTL);
      return response;
  }

  

  /** Relations needed to show everything the deal slip carries from its RFPA. */
  private static readonly DETAIL_RELATIONS = [
    'rfpa',
    ...PROCUREMENT_HEADER_RELATIONS,
    ...procurementLineRelations('dealSlipProducts'),
    'dealSlipProducts.rfpaProduct',
    'dealSlipProducts.rfpaProduct.uom',
  ];

  /**
   * The RFPA-derived part of a deal slip response, in the RFPA's shape (shared formatter). Each product
   * line carries the deal slip's agreed values plus the RFPA's, so the two can be compared.
   */
  private formatRfpaDetails(dealSlip: DealSlip, mode: DetailMode): Record<string, any> {
    const lines = [...(dealSlip.dealSlipProducts ?? [])].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    return {
      ...formatProcurementHeader(dealSlip, mode),
      dealSlipProducts: lines.map((p) => ({
        ...formatProcurementLine(p, mode),
        rfpaQuantity: p.rfpaProduct?.quantity ?? null,
        rfpaUnitPrice: p.rfpaProduct?.unitPrice ?? null,
        rfpaUom: p.rfpaProduct?.uom?.unit ?? null,
      })),
    };
  }

  /** The deal slip's approval document (status decides Draft / editable) with who approved it. */
  private findDealSlipDocument(id: string): Promise<Documentb | null> {
    return this.documentbRepository.findOne({
      where: { type: DocumentTypeEnum.DEAL_SLIP, document_type_id: id },
      relations: ['approvalInfo', 'approvalInfo.firstApproved'],
      order: { createdAt: 'DESC' },
    });
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
          approvalStatus: dealSlip.approvalStatus,
          createdDate,
          createdTime,
          dealSlipNo: dealSlip.dealSlipNo,
          txnNo: dealSlip.txnNo ?? null,
          rfpa: dealSlip.rfpa?.rfpaId || null,
          ...this.formatRfpaDetails(dealSlip, 'view'),
      };
      await this.cacheService.set(key, response, CACHE_TTL_DETAIL);
      return response;
  }

  /**
   * Edit form data: the RFPA update-form shape (relations as ids) plus the slip's own fields. The
   * document status is read fresh on every call (approvals change it without touching this cache).
   */
  async findDealSlipByIdforUpdate(id: string): Promise<DealSlipUpdateFormDto | null> {
      const key = `${CACHE_PREFIX}:update:${id}`;
      let response = await this.cacheService.get<any>(key);

      if (!response) {
        const dealSlip = await this.dealSlipRepository.findOne({
            where: { id },
            relations: DealSlipService.DETAIL_RELATIONS,
        });

        if (!dealSlip) return null;

        const { createdDate, createdTime } = formatDateTime(dealSlip.createdAt);
        response = {
            id: dealSlip.id,
            dealSlipNo: dealSlip.dealSlipNo,
            txnNo: dealSlip.txnNo ?? null,
            rfpa: dealSlip.rfpa?.rfpaId || null,
            lotNo: dealSlip.lotNo,
            loadingLocation: dealSlip.loadingLocation,
            specialRequest: dealSlip.specialRequest,
            remark: dealSlip.remark,
            createdDate,
            createdTime,
            ...this.formatRfpaDetails(dealSlip, 'form'),
        };
        await this.cacheService.set(key, response, CACHE_TTL_DETAIL);
      }

      const document = await this.findDealSlipDocument(id);
      return {
        ...response,
        documentId: document?.id ?? null,
        overAllStatus: document?.status ?? null,
        approvedBy: dealSlipApproverId(document),
      };
  }
    

  

    /** The values the edit rules look at, from a slip loaded with its product lines. */
    private static editState(dealSlip: DealSlip): DealSlipState {
      const lines = [...(dealSlip.dealSlipProducts ?? [])].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      return {
        source: dealSlip.source ?? null,
        lotNo: dealSlip.lotNo,
        loadingLocation: dealSlip.loadingLocation,
        specialRequest: dealSlip.specialRequest,
        remark: dealSlip.remark,
        lines: lines.map((line) => ({
          id: line.id,
          productName: line.productName?.id ?? null,
          variant: line.variant?.id ?? null,
          grade: line.grade ?? null,
          uom: line.uom?.id ?? null,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          purchaseDate: toDateOnly(line.purchaseDate),
          dispatchDate: toDateOnly(line.dispatchDate),
          deliveryDate: toDateOnly(line.deliveryDate),
          expectedHarvestDate: toDateOnly(line.expectedHarvestDate),
        })),
      };
    }

    /**
     * Saves a Deal Slip edit. Only the slip's own fields and the editable product line values may change
     * (rules in dealSlipEdit.ts). Saving a Draft is its submit: the slip moves to Hold and goes to the
     * approvers; until then approvers never see it. Approved or rejected slips are locked (409).
     */
    public async updateDealSlip(
      id: string,
      dealSlipData: UpdateDealSlipDto & Record<string, any>,
      updatedBy: string,
      actor?: { userId: string; isAdmin: boolean },
    ): Promise<{ dealSlip: DealSlip; submitted: boolean } | null> {
      const existingDealSlip = await this.dealSlipRepository.findOne({
        where: { id },
        relations: ['createdBy', 'dealSlipProducts', 'dealSlipProducts.productName', 'dealSlipProducts.variant', 'dealSlipProducts.uom'],
      });
      if (!existingDealSlip) {
        return null;
      }

      const document = await assertDocumentEditable(
        this.dataSource.manager,
        DocumentTypeEnum.DEAL_SLIP,
        id,
        `Deal Slip ${existingDealSlip.dealSlipNo ?? ''}`.trim(),
      );
      const wasDraft = document?.status === DocumentStatus.DRAFT;

      // A draft is the RFPA creator's to complete (admins can too); nobody else may touch it.
      if (wasDraft && actor && !actor.isAdmin && existingDealSlip.createdBy?.id !== actor.userId) {
        throw new AppError(403, 'Only the RFPA creator can edit this draft Deal Slip');
      }

      const plan = planDealSlipEdit(dealSlipData, DealSlipService.editState(existingDealSlip));

      if (plan.uomIds.length) {
        const found = await this.dataSource.manager.count(UOM, { where: { id: In(plan.uomIds) } });
        if (found !== plan.uomIds.length) throw new AppError(400, 'One or more selected units do not exist');
      }

      // A submitted slip must reach approvers: startApprovalFlow quietly does nothing without a flow.
      if (wasDraft) {
        const withFlow = await this.documentbRepository.findOne({ where: { id: document!.id }, relations: ['approvalFlow'] });
        if (!withFlow?.approvalFlow) {
          throw new AppError(400, 'No approval flow is configured for the Deal Slip creator; it cannot be submitted for approval');
        }
      }

      const originalDealSlip = { ...existingDealSlip };
      let submitted = false;

      await this.dataSource.transaction(async (manager) => {
        if (Object.keys(plan.header).length) {
          await manager.update(DealSlip, { id }, plan.header);
          Object.assign(existingDealSlip, plan.header);
        }
        for (const line of plan.lines) {
          await manager.update(DealSlipProduct, { id: line.id }, {
            uom: line.uom ? ({ id: line.uom } as UOM) : null,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            amount: parseFloat((line.quantity * line.unitPrice).toFixed(2)),
            purchaseDate: line.purchaseDate as any,
            dispatchDate: line.dispatchDate as any,
            deliveryDate: line.deliveryDate as any,
            expectedHarvestDate: line.expectedHarvestDate as any,
          } as any);
        }
        // Draft -> Hold with the edit, guarded on the status so a double submit releases only once.
        if (wasDraft) {
          const result = await manager.update(
            Documentb,
            { id: document!.id, status: DocumentStatus.DRAFT },
            { status: DocumentStatus.HOLD, remarks: 'Deal Slip submitted for approval' },
          );
          submitted = (result.affected ?? 0) > 0;
        }
      });

      if (submitted) {
        await this.startApprovalForSubmittedDraft(document!);
      }

      await this.auditLogService.logChange(
        'DealSlip',
        existingDealSlip.id,
        originalDealSlip,
        existingDealSlip,
        updatedBy
      );

      await this.invalidateDealSlipCache(id);
      return { dealSlip: existingDealSlip, submitted };
    }

    /** Assigns the approvers of a just-submitted draft; puts it back to Draft if that fails, so it can be resubmitted. */
    private async startApprovalForSubmittedDraft(document: Documentb): Promise<void> {
      try {
        await this.documentbService.startApprovalFlow(document.id);
      } catch (error) {
        await this.documentbRepository.update(
          { id: document.id },
          { status: DocumentStatus.DRAFT, remarks: 'Deal Slip auto-created as draft; waiting for lot no and loading location' },
        );
        throw error;
      } finally {
        await Promise.all([
          this.cacheService.del(`doc:byid:${document.id}`),
          this.cacheService.invalidatePattern(`singledoc:view:${document.id}:*`),
        ]);
      }
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
  await refreshTransactionOf(this.dataSource.manager, 'deal-slip', dealSlipId);
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
        txnNo: rd.txnNo ?? null,
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
        approvalStatus: rd.approvalStatus || null,
        dealSlipCreatedAt: rd.dealSlipCreatedAt || null,
        dealSlipApprovedAt: rd.dealSlipApprovedAt || null,
        dealSlipNo: rd.dealSlipNo || null,
        txnNo: rd.txnNo ?? null,
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
      approvalStatus: dealSlip.approvalStatus,
      dealSlipCreatedAt: dealSlip.dealSlipCreatedAt,
      dealSlipApprovedAt: dealSlip.dealSlipApprovedAt,
      dealSlipNo: dealSlip.dealSlipNo,
      txnNo: dealSlip.txnNo ?? null,
      rfpa: dealSlip.rfpa?.rfpaId || null,
      ...this.formatRfpaDetails(dealSlip, 'view'),
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

  for (const id of ids) await refreshTransactionOf(this.dataSource.manager, 'deal-slip', id);
 

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