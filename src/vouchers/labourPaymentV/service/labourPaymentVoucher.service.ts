import { inject, injectable } from 'inversify';
import { LPVoucher } from '../entity/labourPaymentVoucher.entity';

import { TYPES } from '../../../types';
import { format } from 'date-fns';

import AppError from '../../../utils/appError';
import { PaginationOptions } from '../../../utils/pagination';
import { formatDateTime } from '../../../utils/dateUtils';

import { DocumentStatus, DocumentTypeEnum } from '../../../approvalFlow/entity/docuemnt.entity';
import { DocumentTypeEnum as DocDefEnum } from '../../../documentDef/entity/documentdef.entity';

import { In, DataSource } from 'typeorm';

import { createHash } from 'crypto';

import { BulkDeleteResultDto, DeleteResultDto } from '../../../global/general.dto';
import { LabourPaymentVoucherRepository } from '../repository/labourPaymentVoucher.repository';
import { GrnRepository } from '../../../grn/repository/grn.repository';
import { AuditLogService } from '../../../employeeActivity/service/auditLog.service';
import { DocumentbService, DocumentWithRelatedData } from '../../../approvalFlow/service/documentb.service';
import { DocumentbRepository } from '../../../approvalFlow/repository/documentb.repository';
import { ApprovalFlowService } from '../../../approvalFlow/service/approvalFlow.service';
import { CacheService } from '../../../global/cache.service';
import { CreateLPVoucherDto, LPVoucherListResponseDto, LPVoucherUpdateFormDto, LPVoucherViewDto, UpdateLPVoucherDto } from '../dto/labourPaymentVoucher.dto';

@injectable()
export class LabourPaymentVoucherService {
  constructor(
    @inject(TYPES.LabourPaymentVoucherRepository)
    private lpVoucherRepository: LabourPaymentVoucherRepository,
    @inject(TYPES.GrnRepository) private grnRepository: GrnRepository,
    @inject(TYPES.AuditLogService) private auditLogService: AuditLogService,
    @inject(TYPES.DocumentbService) private documentbService: DocumentbService, // Assuming DocumentbService is defined elsewhere
    @inject(TYPES.DocumentbRepository) private documentbRepository: DocumentbRepository,
    @inject(TYPES.ApprovalFlowService)
    private approvalFlowService: ApprovalFlowService,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  private readonly CACHE_PREFIX = 'lpv';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:recycle:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${this.CACHE_PREFIX}:id:${id}`),
        // The view cache is keyed by the Documentb id (the /view/:docid route
        // param), not by this record's own id, so it can only be busted by
        // pattern from here.
        this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:view:*`),
        this.cacheService.del(`${this.CACHE_PREFIX}:update:${id}`),
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

  async createLPVoucher(data: CreateLPVoucherDto & Record<string, any>): Promise<LPVoucher> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(data.requestedBy, DocDefEnum.PROCUREMENT);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {

      const voucherNo = await this.generateVoucherNo();
      data.voucherNo = voucherNo;

      const newLPVoucher = queryRunner.manager.create(this.lpVoucherRepository.target, data as any) as unknown as LPVoucher;

      const saveLPVoucher = await queryRunner.manager.save(newLPVoucher) as unknown as LPVoucher;

      await queryRunner.commitTransaction();

      const document = await this.documentbService.createDocument({
              type: DocumentTypeEnum.LABOR_PAYMENT_VOUCHER,
              docDef: DocDefEnum.PROCUREMENT,
              totalAmt: saveLPVoucher.totalAmt,
              status: DocumentStatus.HOLD,
              remarks: 'Document auto-created with LP Voucher',
              lastActionBy: { id: data.requestedBy },
              document_type_id: saveLPVoucher.id
            });

      await this.documentbService.startApprovalFlow(document.id);
      await this.invalidateCache();
            
      return saveLPVoucher;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

          
            
          
    

    

  public async getLPVouchers(queryOptions: PaginationOptions, userId: string): Promise<LPVoucherListResponseDto> {
    const hash = createHash('md5').update(`${userId}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:list:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { data, meta } = await this.documentbService.getAllDocumentByUserId(
      userId,
      DocumentTypeEnum.LABOR_PAYMENT_VOUCHER,
      queryOptions,
    );
    const { search } = queryOptions;
    const activeDocuments = data as DocumentWithRelatedData[];

    const voucherIds = activeDocuments.map(d => d.document_type_id).filter(Boolean) as string[];
    const vouchers = voucherIds.length
      ? await this.lpVoucherRepository
          .createQueryBuilder('v')
          .leftJoinAndSelect('v.companyName', 'companyName')
          .leftJoinAndSelect('v.grnNo', 'grnNo')
          .leftJoinAndSelect('v.location', 'location')
          .where('v.id IN (:...ids)', { ids: voucherIds })
          .andWhere('v.isDeleted = false')
          .andWhere('v.deletedAt IS NULL')
          .getMany()
      : [];
    const voucherMap = new Map(vouchers.map(v => [v.id, v]));
    const docCreatedAtMap = new Map(activeDocuments.map(d => [d.id, d.createdAt]));

    let relatedDataOnly = activeDocuments
      .filter(doc => doc.document_type_id && voucherMap.has(doc.document_type_id))
      .map((doc) => {
        const rd = voucherMap.get(doc.document_type_id!)!;
        const { createdDate, createdTime } = formatDateTime(doc.createdAt);
        return {
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: `${doc.lastActionBy?.firstName || ''} ${doc.lastActionBy?.lastName || ''}`.trim(),
          createdDate,
          createdTime,
          ...rd,
          id: rd.id,
          companyName: rd.companyName?.name || null,
          grnNo: rd.grnNo?.grnNo || null,
          location: rd.location?.name || null,
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

    const listResult = {
      data: relatedDataOnly,
      meta: { total: meta.total, page: meta.page, pages: meta.pages },
    };
    await this.cacheService.set(cacheKey, listResult, this.CACHE_TTL);
    return listResult;
  }



  public async getLPVoucherByIdForView(docid: string): Promise<LPVoucherViewDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:view:${docid}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const document = await this.documentbService.getDocumentById(docid);
    const id = document.documentTypeId;
    if (!id) throw new AppError(404, 'Document not found');

    const voucher = await this.lpVoucherRepository
      .createQueryBuilder('lpVoucher')
      .leftJoinAndSelect('lpVoucher.grnNo', 'grn')
      .leftJoinAndSelect('lpVoucher.companyName', 'companyName')
      .leftJoinAndSelect('lpVoucher.requestedBy', 'requestedBy')
      .leftJoinAndSelect('lpVoucher.location', 'location')
      .where('lpVoucher.id = :id', { id })
      .getOne();
    if (!voucher) {
      return null;
    }
    const rawDate = voucher.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);
    const formatResponse = {
      id: voucher.id,
      voucherNo: voucher.voucherNo,
      approvalStatus: voucher.approvalStatus,
      debitCreditTo: voucher.debitCreditTo,
      payReceivedFrom: voucher.payReceivedFrom,
      receiverName: voucher.receiverName,
      location: voucher.location?.name || null,
      noOfLabours: voucher.noOfLabours,
      loadingDate: voucher.loadingDate,

      contactNo: voucher.contactNo,
      altContactNo: voucher.altContactNo,
      products: voucher.products,
      kyc: voucher.kyc,

      paymentMode: voucher.paymentMode,
      ratePerLabour: voucher.ratePerLabour,
      totalAmt: voucher.totalAmt,

      amtWords: voucher.amtWords,
      anyAttachment: voucher.anyAttachment,
      requestingDepartment: voucher.requestingDepartment,
      grnNo: voucher.grnNo?.grnNo || null,
      companyName: voucher.companyName?.name || null,
remark:voucher.remark || null,
      createdTime: createdTime,
      createdDate: createdDate,
      overAllStatus: document.overAllStatus,
        createdBy: document.createdBy,
        approvalSummary: document.approvalSummary ?? null,
        documentId: document.id,
    };

    await this.cacheService.set(cacheKey, formatResponse, this.CACHE_TTL);
    return formatResponse;
  }

  public async getLPRecycleBinVouchers(queryOptions: PaginationOptions, userId: string): Promise<LPVoucherListResponseDto> {
    const hash = createHash('md5').update(`${userId}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:recycle:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { data, meta } = await this.documentbService.getAllDocumentByUserId(
      userId,
      DocumentTypeEnum.LABOR_PAYMENT_VOUCHER,
      queryOptions,
      false,
      true,
    );
    const { search } = queryOptions;
    const activeDocuments = (data as DocumentWithRelatedData[]);

    const voucherIds = activeDocuments.map(d => d.document_type_id).filter(Boolean) as string[];
    const vouchers = voucherIds.length
      ? await this.lpVoucherRepository
          .createQueryBuilder('v')
          .leftJoinAndSelect('v.companyName', 'companyName')
          .leftJoinAndSelect('v.grnNo', 'grnNo')
          .leftJoinAndSelect('v.location', 'location')
          .where('v.id IN (:...ids)', { ids: voucherIds })
          .andWhere('v.isDeleted = true')
          .getMany()
      : [];
    const voucherMap = new Map(vouchers.map(v => [v.id, v]));
    const recycleDocCreatedAtMap = new Map(activeDocuments.map(d => [d.id, d.createdAt]));

    let relatedDataOnly = activeDocuments
      .filter(doc => doc.document_type_id && voucherMap.has(doc.document_type_id))
      .map((doc) => {
        const rd = voucherMap.get(doc.document_type_id!)!;
        const { createdDate, createdTime } = formatDateTime(doc.createdAt);
        return {
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: `${doc.lastActionBy?.firstName || ''} ${doc.lastActionBy?.lastName || ''}`.trim(),
          createdDate,
          createdTime,
          ...rd,
          id: rd.id,
          companyName: rd.companyName?.name || null,
          grnNo: rd.grnNo?.grnNo || null,
          location: rd.location?.name || null,
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

    const recycleResult = {
      data: relatedDataOnly,
      meta: { total: meta.total, page: meta.page, pages: meta.pages },
    };
    await this.cacheService.set(cacheKey, recycleResult, this.CACHE_TTL);
    return recycleResult;
  }

   public async getLPVoucherByIdForUpdate(id: string): Promise<LPVoucherUpdateFormDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const voucher = await this.lpVoucherRepository
      .createQueryBuilder('lpVoucher')
      .leftJoinAndSelect('lpVoucher.grnNo', 'grn')
      .leftJoinAndSelect('lpVoucher.companyName', 'companyName')
      .leftJoinAndSelect('lpVoucher.requestedBy', 'requestedBy')
      .leftJoinAndSelect('lpVoucher.location', 'location')
      .where('lpVoucher.id = :id', { id })
      .getOne();
    if (!voucher) {
      return null;
    }
    const rawDate = voucher.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);
    const formatResponse = {
      id: voucher.id,
      voucherNo: voucher.voucherNo,
      approvalStatus: voucher.approvalStatus,
      debitCreditTo: voucher.debitCreditTo,
      payReceivedFrom: voucher.payReceivedFrom,
      receiverName: voucher.receiverName,
      location: voucher.location?.id || null,
      noOfLabours: voucher.noOfLabours,
      loadingDate: voucher.loadingDate,

      contactNo: voucher.contactNo,
      altContactNo: voucher.altContactNo,
      products: voucher.products,
      kyc: voucher.kyc,
remark : voucher.remark || null,
      paymentMode: voucher.paymentMode,
      ratePerLabour: voucher.ratePerLabour,
      totalAmt: voucher.totalAmt,

      amtWords: voucher.amtWords,
      anyAttachment: voucher.anyAttachment,
      requestingDepartment: voucher.requestingDepartment,
      grnNo: voucher.grnNo?.id || null,
      companyName: voucher.companyName?.id || null,

      createdTime: createdTime,
      createdDate: createdDate,
    };

    await this.cacheService.set(cacheKey, formatResponse, this.CACHE_TTL);
    return formatResponse;
  }

  public async updateLPVoucher(
    id: string,
    updatedData: UpdateLPVoucherDto & Record<string, any>,
    updatedBy: string,
  ): Promise<LPVoucher | null> {
    const voucher = await this.lpVoucherRepository.findOne({ where: { id } });
    if (!voucher) return null;

    const originalVoucher = { ...voucher };

    if (updatedData.grnNo) {
      const grn = await this.grnRepository.findOne({ where: { grnNo: updatedData.grnNo as string } });
      if (grn) voucher.grnNo = grn;
      delete updatedData.grnNo;
    }

    Object.assign(voucher, updatedData);
    const updatedVoucher = await this.lpVoucherRepository.save(voucher);

    await this.auditLogService.logChange('LPVoucher', voucher.id, originalVoucher, updatedVoucher, updatedBy);
    await this.invalidateCache(id);
    return updatedVoucher;
  }

  async deleteLPVoucher(id: string): Promise<DeleteResultDto | null> {
    const exists = await this.lpVoucherRepository.count({ where: { id } });
    if (!exists) throw new AppError(404, `LP Voucher with ID ${id} not found`);
    const voucher=await this.lpVoucherRepository.findOne({where:{id}});
    if(!voucher){
      throw new AppError(404,`Lp Voucher with ID ${id} not found`);
    }
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    await this.lpVoucherRepository.update({ id }, { deletionScheduledAt: sixMonthsFromNow } as any);
    await this.invalidateCache(id);
    return {No:voucher.voucherNo};
  }

  public async generateVoucherNo(): Promise<string> {
    const today = new Date();
    const formattedDate = format(today, 'yyyyMMdd');

    const lastVoucher = await this.lpVoucherRepository
      .createQueryBuilder('cashVoucher')
      .where('cashVoucher.voucherNo LIKE :datePattern', { datePattern: `CV-${formattedDate}-%` })
      .orderBy('cashVoucher.voucherNo', 'DESC')
      .getOne();

    let newSerialNumber = 1;
    if (lastVoucher) {
      const lastSerialNumber = parseInt(lastVoucher.voucherNo.split('-')[2], 10);
      newSerialNumber = lastSerialNumber + 1;
    }

    return `LV-${formattedDate}`;
  }

  public async deleteMultipleLPVoucher(ids: string[]): Promise<BulkDeleteResultDto> {
    //if (!ids.length) return { message: 'No IDs provided' };
    const success: { id: string; No: string }[] = [];
  const failed: { id: string; reason: string }[] = [];  

    const [lpVouchers, relatedDocuments] = await Promise.all([
      this.lpVoucherRepository.find({ where: { id: In(ids) } }),
      this.documentbRepository
        .createQueryBuilder('doc')
        .select(['doc.id', 'doc.document_type_id'])
        .where('doc.document_type_id IN (:...ids)', { ids })
        .getMany(),
    ]);

    const foundIds = new Set(lpVouchers.map(v => v.id));
    const missingId = ids.find(id => !foundIds.has(id));
    if (missingId) throw new AppError(404, `LP Voucher with ID ${missingId} not found`);

    const docIds = relatedDocuments.map(d => d.id);
    if (docIds.length) {
      await this.documentbRepository
        .createQueryBuilder()
        .update()
        .set({ isDeleted: true } as any)
        .whereInIds(docIds)
        .execute();
    }

    await this.lpVoucherRepository
      .createQueryBuilder()
      .update()
      .set({ isDeleted: true } as any)
      .whereInIds(ids)
      .execute();

    await Promise.all([
      ...ids.flatMap(id => [
        this.cacheService.del(`${this.CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:view:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:update:${id}`),
      ]),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:recycle:*`),
    ]);

    lpVouchers.map((v)=>{
      success.push({id:v.id,No:v.voucherNo});
    })

    return { success,failed,message: 'LP Voucher records marked for deletion successfully' };
  }

}




  // public async getLPVoucherById(id: string): Promise<LPVoucherDetailDto | null> {
  //   const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
  //   const cached = await this.cacheService.get<any>(cacheKey);
  //   if (cached) return cached;

  //   const voucher = await this.lpVoucherRepository
  //     .createQueryBuilder('lpVoucher')
  //     .leftJoinAndSelect('lpVoucher.grnNo', 'grn')
  //     .leftJoinAndSelect('lpVoucher.companyName', 'companyName')
  //     .leftJoinAndSelect('lpVoucher.requestedBy', 'requestedBy')

  //     .select([
  //       'lpVoucher.id',
  //       'lpVoucher.voucherNo',
  //       'lpVoucher.approvalStatus',
  //       'lpVoucher.debitCreditTo',
  //       'lpVoucher.payReceivedFrom',
  //       'lpVoucher.receiverName',
  //       'lpVoucher.location',
  //       'lpVoucher.noOfLabours',
  //       'lpVoucher.loadingDate',

  //       'lpVoucher.contactNo',
  //       'lpVoucher.altContactNo',
  //       'lpVoucher.products',
  //       'lpVoucher.kyc',

  //       'lpVoucher.paymentMode',
  //       'lpVoucher.ratePerLabour',
  //       'lpVoucher.totalAmt',
  //       'lpVoucher.createdAt',

  //       'lpVoucher.amtWords',
  //       'lpVoucher.anyAttachment',
  //       'lpVoucher.requestingDepartment',
  //       'companyName.id',
  //       'companyName.name',
  //       'grn.grnNo',
  //       'grn.id',
  //       'requestedBy.id',
  //       'requestedBy.firstName',
  //       'requestedBy.lastName',
  //     ])
  //     .where('lpVoucher.id = :id', { id })
  //     .getOne();
  //   if (!voucher) {
  //     return null;
  //   }
  //   const rawDate = voucher.createdAt;
  //   const { createdDate, createdTime } = formatDateTime(rawDate);
  //   if (voucher && voucher.grnNo) {
  //     const idResult = {
  //       ...voucher,
  //       grnNo: {
  //         id: voucher.grnNo?.id || null,
  //         grnNo: voucher.grnNo?.grnNo || null,
  //       },
  //       companyName: {
  //         id: voucher.companyName?.id || null,
  //         companyName: voucher.companyName?.name || null,
  //       },
  //       createdTime: createdTime,
  //       createdDate: createdDate,
  //     };
  //     await this.cacheService.set(cacheKey, idResult, this.CACHE_TTL);
  //     return idResult;
  //   }

  //   return voucher as unknown as LPVoucherDetailDto;
  // }