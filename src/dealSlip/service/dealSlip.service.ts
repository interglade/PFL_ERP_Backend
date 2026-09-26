import { inject, injectable } from "inversify";
import { TYPES } from "../../types";
import { DealSlipRepository } from "../repository/dealSlip.repository";

import { DeepPartial, In, SelectQueryBuilder, DataSource } from "typeorm";
import { Status } from "../../utils/status.enum";

import AppError from "../../utils/appError";
import { buildQueryFromArray, PaginationOptions } from "../../utils/pagination";
import { formatDateTime } from "../../utils/dateUtils";


import { DocumentStatus, DocumentTypeEnum } from "../../approvalFlow/entity/docuemnt.entity";
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

  

  async findDealSlipByIdforView(id: string): Promise<DealSlipDetailDto | null> {
      const key = `${CACHE_PREFIX}:view:${id}`;
      const cached = await this.cacheService.get<any>(key);
      if (cached) return cached;

      const dealSlip = await this.dealSlipRepository.findOne({
          where: { id },
          relations: ['rfpa'],
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
          relations: ['rfpa'],
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

  async createDealSlip(dealSlipData: CreateDealSlipDto & Record<string, any>): Promise<DealSlip> {
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

          await this.documentbService.startApprovalFlow(document.id);
          await this.invalidateDealSlipCache();

                          return savedDealSlip;
        } catch (error: any) {
          await queryRunner.rollbackTransaction();
          throw error;
        } finally {
          await queryRunner.release();
        }
      }

    
    

      async generateDealSlipId(): Promise<string> {
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const datePrefix = `DL${yyyy}${mm}${dd}`;

    const result = await this.dealSlipRepository
      .createQueryBuilder('ds')
      .select('MAX(ds.dealSlipNo)', 'maxId')
      .where('ds.dealSlipNo LIKE :prefix', { prefix: `${datePrefix}%` })
      .getRawOne();

    let nextSeq = 1;
    if (result?.maxId) {
      const parsed = parseInt(result.maxId.replace(datePrefix, ''), 10);
      if (!isNaN(parsed)) nextSeq = parsed + 1;
    }

    return `${datePrefix}${nextSeq.toString().padStart(5, '0')}`;
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

    public async updateDealSlip(id: string, dealSlipData: UpdateDealSlipDto & Record<string, any>, updatedBy: string): Promise<DealSlip | null> {
      const existingDealSlip = await this.dealSlipRepository.findOneBy({ id });
      if (!existingDealSlip) {
        return null;
      }
     
  const originalDealSlip = { ...existingDealSlip };
    
      
  Object.assign(existingDealSlip, dealSlipData);

 
  await this.dealSlipRepository.save(existingDealSlip);

 
  await this.auditLogService.logChange(
    'DealSlip',
    existingDealSlip.id,
    originalDealSlip,
    existingDealSlip,
    updatedBy
  );

  await this.invalidateDealSlipCache(id);
  return existingDealSlip;
}

public async getAllDealSlipsNo(
  filter: {
    overAllStatus?: string;
    isGrnCreated?: boolean;
    employeeBaseHirechey?: boolean;
    page?: number;
    limit?: number;
    search?: string;
  },
  loginUserId: string
): Promise<DealSlipNumbersResponseDto> {
  const key = `${CACHE_PREFIX}:nos:${loginUserId}:${JSON.stringify(filter)}`;
  const cached = await this.cacheService.get<any>(key);
  if (cached) return cached;

  const where: any = { isDeleted: false };
  if (typeof filter?.isGrnCreated === "boolean") {
    where.isGrnCreated = filter.isGrnCreated;
  }

  const dealSlips = await this.dealSlipRepository.find({
    select: ["id", "dealSlipNo", "isGrnCreated"],
    where,
    relations: ["createdBy", "rfpa"],
    order: { createdAt: "DESC" }
  });

  const validDealSlips = dealSlips.filter(d => d.id && d.dealSlipNo);
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
    const matchesGrn = typeof filter?.isGrnCreated !== 'boolean' || dealSlip.isGrnCreated === filter.isGrnCreated;

    if (matchesStatus && matchesGrn) {
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

 public async getAllDealSlips(queryOptions: PaginationOptions, userId: string): Promise<DealSlipListResponseDto> {
  const key = `${CACHE_PREFIX}:list:${userId}:${JSON.stringify(queryOptions)}`;
  const cached = await this.cacheService.get<any>(key);
  if (cached) return cached;

  const data = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(
    userId,
    DocumentTypeEnum.DEAL_SLIP,
    false,
    queryOptions,
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
public async getDealSlipByIdForView(docid: string, userId: string): Promise<DealSlipDocumentViewDto | null> {
    const key = `${CACHE_PREFIX}:docview:${docid}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const document = await this.docSingalApproverService.getSingleApprovalDocumentById(docid, userId);
    if (!document) return null;

    const id = document.documentTypeId;
    if (!id) throw new Error('Document type ID not found.');

    const dealSlip = await this.dealSlipRepository.findOne({
      where: { id },
      relations: ['rfpa'],
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
      this.cacheService.del(`${CACHE_PREFIX}:docview:${id}`),
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