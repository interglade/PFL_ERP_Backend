import { inject, injectable } from 'inversify';
import { TYPES } from '../../../types';
import { CashVoucher } from '../entity/mCashVoucher.entity';
import { DocumentTypeEnum as DocDefEnum } from '../../../documentDef/entity/documentdef.entity';
import { CreateMultiCashVoucherDto, UpdateMultiCashVoucherDto, MultiCashVoucherListItemDto, MultiCashVoucherDetailDto } from '../dto/multiCashVoucher.dto';

import { DeliveryChallanRepository } from '../../../deliveryChallans/deliverychllan/repository/deliveryChallan.repository';

import AppError from '../../../utils/appError';
import { PaginationOptions } from '../../../utils/pagination';
import { formatDateTime } from '../../../utils/dateUtils';
import { UserRepository } from '../../../employee/repository/user.repository';

import { PdfGeneratorService } from '../../../utils/pdfGenerator';

import { DocumentTypeEnum } from '../../../approvalFlow/entity/docuemnt.entity';
import { DocumentStatus } from '../../../approvalFlow/entity/docuemnt.entity';

import { In, DataSource } from 'typeorm';
import { format } from 'date-fns';

import { createHash } from 'crypto';
import { BulkDeleteResultDto, DeleteResultDto } from '../../../global/general.dto';
import { MultiCashVoucherRepository } from '../repository/multicashVoucher.repository';
import { GrnRepository } from '../../../grn/repository/grn.repository';
import { NotificationService } from '../../../notification/service/notification.service';
import { DocumentbRepository } from '../../../approvalFlow/repository/documentb.repository';
import { AuditLogService } from '../../../employeeActivity/service/auditLog.service';
import { DocumentbService, DocumentWithRelatedData } from '../../../approvalFlow/service/documentb.service';
import { ApprovalFlowService } from '../../../approvalFlow/service/approvalFlow.service';
import { CacheService } from '../../../global/cache.service';
// DTOs imported earlier

@injectable()
export class MultiCashVoucherService {
  constructor(
    @inject(TYPES.MultiCashVoucherRepository)
    private cashVoucherRepository: MultiCashVoucherRepository,
    @inject(TYPES.GrnRepository) private grnRepository: GrnRepository,
    @inject(TYPES.UserRepository) private userRepository: UserRepository,
    @inject(TYPES.NotificationService)
    private readonly notificationService: NotificationService,
    @inject(TYPES.DeliveryChallanRepository)
    private deliverychllanRepository: DeliveryChallanRepository,
    @inject(TYPES.DocumentbRepository) private documentbRepository: DocumentbRepository,
    @inject(TYPES.PdfGeneratorService)
    private readonly pdfGeneratorService: PdfGeneratorService,
    @inject(TYPES.AuditLogService) private auditLogService: AuditLogService,
    @inject(TYPES.DocumentbService) private documentbService: DocumentbService, // Assuming DocumentbService is defined elsewhere
    @inject(TYPES.ApprovalFlowService)
    private approvalFlowService: ApprovalFlowService,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  private readonly CACHE_PREFIX = 'mcv';
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
  public async getAllVouchers(
    queryOptions: PaginationOptions, userId: string
  ): Promise<{ data: MultiCashVoucherListItemDto[]; meta: any }> {
    const hash = createHash('md5').update(`${userId}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:list:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { search } = queryOptions;
    const { data, meta } = await this.documentbService.getAllDocumentByUserId(
      userId,
      DocumentTypeEnum.MULTI_CASH_VOUCHER,
      queryOptions,
    );

    const activeDocuments = data as DocumentWithRelatedData[];
    const voucherIds = activeDocuments.map(d => d.document_type_id).filter(Boolean) as string[];

    const vouchers = voucherIds.length
      ? await this.cashVoucherRepository
          .createQueryBuilder('v')
          .leftJoinAndSelect('v.companyName', 'companyName')
          .leftJoinAndSelect('v.grnNo', 'grnNo')
          .leftJoinAndSelect('v.challanNo', 'challanNo')
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
          id: rd.id,
          companyName: rd.companyName?.name || null,
          grnNo: rd.grnNo?.grnNo || null,
          challanNo: rd.challanNo?.challanNo || null,
          debitCreditTo: rd.debitCreditTo,
          voucherNo: rd.voucherNo,
          payReceivedFrom: rd.payReceivedFrom,
          location: rd.location?.name || null,
          totalAmt: rd.totalAmt,
          amtWords: rd.amtWords,
          paymentMode: rd.paymentMode,
          receiverName: rd.receiverName,
          remark: rd.remark,
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

    const result = {
      data: relatedDataOnly as MultiCashVoucherListItemDto[],
      meta: { total: meta.total, page: meta.page, pages: meta.pages },
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }
      
        
      
              



  public async getVoucherByIdForUpdate(id: string): Promise<UpdateMultiCashVoucherDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const voucher = await this.cashVoucherRepository
      .createQueryBuilder('voucher')
      .leftJoinAndSelect('voucher.particulars', 'particulars')
      .leftJoinAndSelect('voucher.companyName', 'companyName')
      .leftJoinAndSelect('voucher.passBy', 'passBy')
      .leftJoinAndSelect('voucher.approveBy', 'approveBy')
      .leftJoinAndSelect('voucher.grnNo', 'grn')
      .leftJoinAndSelect('voucher.requestedBy', 'requestedBy')
      .leftJoinAndSelect('voucher.challanNo', 'deliveryChallan')
      .leftJoinAndSelect('voucher.location', 'location')
      .select([
        'voucher.id',
        'voucher.requestingDepartment',
        'companyName.id',
        'companyName.name',
        'voucher.debitCreditTo',
        'voucher.voucherNo',
        'voucher.payReceivedFrom',
        'location.id',
        'location.name',
        'voucher.totalAmt',
        'voucher.remark',
        'voucher.amtWords',
        'voucher.paymentMode',
        'voucher.anyAttachment',
        'voucher.approvalStatus',
        'voucher.createdAt',
        'voucher.receiverName',
        'particulars.id',
        'particulars.description',
        'particulars.amt',
        'requestedBy.id',
        'requestedBy.firstName',
        'requestedBy.lastName',
        'grn.id',
        'grn.grnNo',
        'deliveryChallan.id',
        'deliveryChallan.challanNo',
      ])
      .where('voucher.id = :id', { id })
      .getOne();

    if (!voucher) {
      return null;
    }
    const rawDate = voucher.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);

    const updateResult: UpdateMultiCashVoucherDto = {
      requestingDepartment: voucher.requestingDepartment,
      companyName: voucher.companyName?.id ?? undefined,
      grnNo: voucher.grnNo?.id || null,
      debitCreditTo: voucher.debitCreditTo,
      voucherNo: voucher.voucherNo,
      payReceivedFrom: voucher.payReceivedFrom,
      location: voucher.location?.id ?? null,
      particulars: voucher.particulars?.map(p => ({ id: p.id, description: p.description, amt: p.amt })) || [],
      challanNo: voucher.challanNo?.id || null,
      totalAmt: voucher.totalAmt,
      amtWords: voucher.amtWords,
      paymentMode: voucher.paymentMode,
      receiverName: voucher.receiverName,
      anyAttachment: (voucher as any).anyAttachment || null,
      approvalStatus: voucher.approvalStatus,
      requestedBy: voucher.requestedBy?.id ?? undefined,
      passBy: voucher.passBy?.id ?? undefined,
      approveBy: voucher.approveBy?.id ?? undefined,
      remark: voucher.remark,
    };
    await this.cacheService.set(cacheKey, updateResult, this.CACHE_TTL);
    return updateResult;
  }

  public async getVoucherByIdForView(docid: string): Promise<MultiCashVoucherDetailDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:view:${docid}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const document = await this.documentbService.getDocumentById(docid);
    const id = document.documentTypeId;
    if (!id) throw new AppError(404, `Voucher with ID ${id} not found`);

    const voucher = await this.cashVoucherRepository
      .createQueryBuilder('voucher')
      .leftJoinAndSelect('voucher.particulars', 'particulars')
      .leftJoinAndSelect('voucher.companyName', 'companyName')
      .leftJoinAndSelect('voucher.passBy', 'passBy')
      .leftJoinAndSelect('voucher.approveBy', 'approveBy')
      .leftJoinAndSelect('voucher.grnNo', 'grn')
      .leftJoinAndSelect('voucher.requestedBy', 'requestedBy')
      .leftJoinAndSelect('voucher.challanNo', 'deliveryChallan')
      .leftJoinAndSelect('voucher.location', 'location')
      .select([
        'voucher.id',
        'voucher.requestingDepartment',
        'companyName.id',
        'companyName.name',
        'voucher.debitCreditTo',
        'voucher.voucherNo',
        'voucher.payReceivedFrom',
        'location.id',
        'location.name',
        'voucher.totalAmt',
        'voucher.amtWords',
        'voucher.paymentMode',
        'voucher.anyAttachment',
        'voucher.approvalStatus',
        'voucher.createdAt',
        'voucher.receiverName',
        'voucher.remark',
        'particulars.id',
        'particulars.description',
        'particulars.amt',
        'requestedBy.id',
        'requestedBy.firstName',
        'requestedBy.lastName',
        'grn.id',
        'grn.grnNo',
        'deliveryChallan.id',
        'deliveryChallan.challanNo',
      ])
      .where('voucher.id = :id', { id })
      .getOne();

    if (!voucher) {
      return null;
    }
    const rawDate = voucher.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);

    const viewResult: MultiCashVoucherDetailDto = {
      id: voucher.id,
      voucherNo: voucher.voucherNo,
      debitCreditTo: voucher.debitCreditTo,
      payReceivedFrom: voucher.payReceivedFrom,
      location: voucher.location?.name || null,
      totalAmt: voucher.totalAmt,
      amtWords: voucher.amtWords,
      paymentMode: voucher.paymentMode,
      anyAttachment: voucher.anyAttachment,
      receiverName: voucher.receiverName,
      remark: voucher.remark,
      particulars: voucher.particulars,
      requestedBy: voucher.requestedBy
        ? { id: voucher.requestedBy.id || null, firstName: voucher.requestedBy.firstName || null, lastName: voucher.requestedBy.lastName || null }
        : null,
      companyName: voucher.companyName?.name || null,
      grnNo: voucher.grnNo?.grnNo || null,
      challanNo: voucher.challanNo?.challanNo || null,
      createdTime,
      createdDate,
      overAllStatus: document.overAllStatus,
      createdBy: document.createdBy,
      approvalSummary: document.approvalSummary ?? null,
      documentId: document.id,
    };
    await this.cacheService.set(cacheKey, viewResult, this.CACHE_TTL);
    return viewResult;
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

  public async createVoucher(voucherData: CreateMultiCashVoucherDto): Promise<any> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(voucherData.requestedBy, DocDefEnum.PROCUREMENT);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {

       const approvalFlowExit = this.approvalFlowService.findApprovalFlowForLoggedUser(voucherData.requestedBy, 'multi-cash-voucher')

      if (!approvalFlowExit) {
        throw new Error('Approval flow not found');
      }

      const voucherNo = await this.generateVoucherNo();
      voucherData.voucherNo = voucherNo;

      if (voucherData.grnNo) {
        const grn = await queryRunner.manager.findOne(this.grnRepository.target, {
          where: { id: voucherData.grnNo },
        });
        if (!grn) {
          throw new Error(`GRN with ID ${voucherData.grnNo} not found.`);
        }
        voucherData.grnNo = grn;
      } else {
        voucherData.grnNo = null;
      }

      if (voucherData.challanNo) {
        const challan = await queryRunner.manager.findOne(this.deliverychllanRepository.target, {
          where: { id: voucherData.challanNo },
        });
        if (!challan) {
          throw new Error(`Challan with ID ${voucherData.challanNo} not found.`);
        }
        voucherData.challanNo = challan;
      } else {
        voucherData.challanNo = null;
      }

      const cashVoucher = queryRunner.manager.create(this.cashVoucherRepository.target, voucherData as any);

      const voucher = await queryRunner.manager.save(cashVoucher) as CashVoucher | CashVoucher[];

      const document = await this.documentbService.createDocument({
              type: 'multi-cash-voucher',
              docDef: DocDefEnum.PROCUREMENT,
              totalAmt: Array.isArray(voucher) ? (voucher[0] as CashVoucher)?.totalAmt : (voucher as CashVoucher).totalAmt,
              status: DocumentStatus.HOLD,
              remarks: 'Document auto-created with GRN',
              lastActionBy: { id: voucherData.requestedBy },
              document_type_id : Array.isArray(voucher) ? (voucher[0] as CashVoucher)?.id : (voucher as CashVoucher).id
            }, );

      await queryRunner.commitTransaction();

      await this.documentbService.startApprovalFlow(document.id);
      await this.invalidateCache();

      return voucher;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

public async getAllRecycleBinVouchers(
    queryOptions: PaginationOptions, userId: string
  ): Promise<{ data: any[]; meta: any }> {
    const hash = createHash('md5').update(`${userId}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:recycle:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { search } = queryOptions;
    const { data, meta } = await this.documentbService.getAllDocumentByUserId(
      userId,
      DocumentTypeEnum.MULTI_CASH_VOUCHER,
      queryOptions,
      false,
      true,
    );

    const activeDocuments = data as DocumentWithRelatedData[];
    const voucherIds = activeDocuments.map(d => d.document_type_id).filter(Boolean) as string[];

    const vouchers = voucherIds.length
      ? await this.cashVoucherRepository
          .createQueryBuilder('v')
          .leftJoinAndSelect('v.companyName', 'companyName')
          .leftJoinAndSelect('v.grnNo', 'grnNo')
          .leftJoinAndSelect('v.challanNo', 'challanNo')
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
          challanNo: rd.challanNo?.challanNo || null,
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

  public async updateVoucher(
    id: string,
    updatedData: UpdateMultiCashVoucherDto,
    updatedBy: string,
  ): Promise<CashVoucher | null> {
    const voucher = await this.cashVoucherRepository.findOne({ where: { id } });
    if (!voucher) return null;

    const originalVoucher = { ...voucher };

    const grn = await this.grnRepository.findOne({ where: { grnNo: updatedData.grnNo } });
    if (grn) updatedData.grnNo = grn;

    Object.assign(voucher, updatedData);
    await this.cashVoucherRepository.save(voucher);

    await this.auditLogService.logChange('CashVoucher', voucher.id, originalVoucher, voucher, updatedBy);
    await this.invalidateCache(id);
    return voucher;
  }

  async deleteVoucher(id: string): Promise<DeleteResultDto | null> {
    const exists = await this.cashVoucherRepository.count({ where: { id } });
    if (!exists) throw new AppError(404, `Voucher with ID ${id} not found`);
    const voucher = await this.cashVoucherRepository.findOne({ where: { id } });
        if (!voucher) throw new AppError(404, `voucher with ID ${id} not found`);
    
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    await this.cashVoucherRepository.update({ id }, { deletionScheduledAt: sixMonthsFromNow } as any);
    await this.invalidateCache(id);
    return {No:voucher?.voucherNo};
  }

  public async generateVoucherNo(): Promise<string> {
    const today = new Date();
    const formattedDate = format(today, 'yyyyMMdd');

    const lastVoucher = await this.cashVoucherRepository
      .createQueryBuilder('cashVoucher')
      .where('cashVoucher.voucherNo LIKE :datePattern', {
        datePattern: `CV-${formattedDate}-%`,
      })
      .orderBy('cashVoucher.voucherNo', 'DESC')
      .getOne();

    let newSerialNumber = 1;

    if (lastVoucher) {
      const lastSerialNumber = parseInt(
        lastVoucher.voucherNo.split('-')[2],
        10,
      );
      newSerialNumber = lastSerialNumber + 1;
    }

    const voucherNo = `CV-${formattedDate}`;
    return voucherNo;
  }


  public async deleteMultipleMultiCashVoucher(ids: string[]): Promise<BulkDeleteResultDto> {
   // if (!ids.length) return { message: 'No IDs provided' };
     const success: { id: string; No: string }[] = [];
    const failed: { id: string; reason: string }[] = [];
    const [vouchers, relatedDocuments] = await Promise.all([
      this.cashVoucherRepository.find({ where: { id: In(ids) } }),
      this.documentbRepository
        .createQueryBuilder('doc')
        .select(['doc.id', 'doc.document_type_id'])
        .where('doc.document_type_id IN (:...ids)', { ids })
        .getMany(),
    ]);

    const foundIds = new Set(vouchers.map(v => v.id));
    const missingId = ids.find(id => !foundIds.has(id));
    if (missingId) throw new AppError(404, `MultiCashVoucher with ID ${missingId} not found`);

    const docIds = relatedDocuments.map(d => d.id);
    if (docIds.length) {
      await this.documentbRepository
        .createQueryBuilder()
        .update()
        .set({ isDeleted: true } as any)
        .whereInIds(docIds)
        .execute();
    }

    await this.cashVoucherRepository
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

    vouchers.map((v)=>{
      success.push({id:v.id,No:v.voucherNo});
    })

    return { success, failed, message: `Deletion completed. Success: ${success.length}, Failed: ${failed.length}` };
   // return { message: 'MultiCashVoucher records marked for deletion successfully' };
  }

}




  // async generateMultiCashVoucherPdf(id: string): Promise<string> {
  //   const voucher = await this.getVoucherByIdForView(id);

  //   //console.log('voucher is ', voucher);
  //   if (!voucher) throw new Error('Voucher not found');

  //   const s3Key = `multi-cash-vouchers/voucher-${voucher.voucherNo}.pdf`;

  //   //console.log('Voucher data passed to EJS:', voucher.companyName);

  //   const pdfUrl = await this.pdfGeneratorService.generatePdfFromTemplate(
  //     'multiCashVoucher',
  //     { voucher },
  //     s3Key,
  //   );

  //   return pdfUrl;
  // }




  // public async getVoucherById(id: string): Promise<any> {
  //   const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
  //   const cached = await this.cacheService.get<any>(cacheKey);
  //   if (cached) return cached;

  //   const voucher = await this.cashVoucherRepository
  //     .createQueryBuilder('voucher')
  //     .leftJoinAndSelect('voucher.particulars', 'particulars')

  //     .leftJoinAndSelect('voucher.companyName', 'companyName')
  //     .leftJoinAndSelect('voucher.passBy', 'passBy')
  //     .leftJoinAndSelect('voucher.approveBy', 'approveBy')
  //     .leftJoinAndSelect('voucher.grnNo', 'grn')
  //     .leftJoinAndSelect('voucher.requestedBy', 'requestedBy')
  //     .leftJoinAndSelect('voucher.challanNo', 'deliveryChallan')
  //     .select([
  //       'voucher.id',
  //       'voucher.requestingDepartment',
  //       'companyName.id',
  //       'companyName.name',
  //       'voucher.debitCreditTo',
  //       'voucher.voucherNo',
  //       'voucher.payReceivedFrom',
  //       'voucher.location',
  //       'voucher.totalAmt',
  //       'voucher.amtWords',
  //       'voucher.paymentMode',
  //       'voucher.anyAttachment',
  //       'voucher.approvalStatus',
  //       'voucher.createdAt',
  //       'voucher.receiverName',
  //       'voucher.remark',

  //       'particulars.id',
  //       'particulars.description',
  //       'particulars.amt',
  //       'requestedBy.id',
  //       'requestedBy.firstName',
  //       'requestedBy.lastName',
  //       'grn.id',
  //       'grn.grnNo',
  //       'deliveryChallan.id',
  //       'deliveryChallan.challanNo',
  //     ])
  //     .where('voucher.id = :id', { id })
  //     .getOne();

  //   if (!voucher) {
  //     return null;
  //   }
  //   const rawDate = voucher.createdAt;
  //   const { createdDate, createdTime } = formatDateTime(rawDate);

  //   const idResult = {
  //     ...voucher,
  //     grnNo: { id: voucher.grnNo?.id, grnNo: voucher.grnNo?.grnNo },
  //     challanNo: {
  //       id: voucher.challanNo?.id || null,
  //       challanNo: voucher.challanNo || null,
  //     },
  //     companyName: {
  //       id: voucher.companyName?.id || null,
  //       companyName: voucher.companyName?.name || null,
  //     },
  //     createdTime: createdTime,
  //     createdDate: createdDate,
  //   };
  //   await this.cacheService.set(cacheKey, idResult, this.CACHE_TTL);
  //   return idResult;
  // }