import { inject, injectable } from 'inversify';

import { TPVoucher } from '../entity/transportPaymentvoucher.entity';

import { TYPES } from '../../../types';

import { format } from 'date-fns';

import { PaginationOptions } from '../../../utils/pagination';
import { formatDateTime } from '../../../utils/dateUtils';

import { DocumentTypeEnum } from '../../../approvalFlow/entity/docuemnt.entity';
import { DocumentStatus } from '../../../approvalFlow/entity/docuemnt.entity';

import { ProductRepository } from '../../../product/createproduct/repository/product.repository';
import { In, DataSource } from 'typeorm';
import { DocumentTypeEnum as DocDefEnum } from '../../../documentDef/entity/documentdef.entity';

import { BulkDeleteResultDto, DeleteResultDto } from '../../../global/general.dto';
import AppError from '../../../utils/appError';
import { TPVoucherRepository } from '../repository/transportPaymentV.repository';
import { GrnRepository } from '../../../grn/repository/grn.repository';
import { AuditLogService } from '../../../employeeActivity/service/auditLog.service';
import { DocumentbRepository } from '../../../approvalFlow/repository/documentb.repository';
import { DocumentbService, DocumentWithRelatedData } from '../../../approvalFlow/service/documentb.service';
import { ApprovalFlowService } from '../../../approvalFlow/service/approvalFlow.service';
import { CacheService } from '../../../global/cache.service';
import { CreateTPVoucherDto, TPVoucherListResponseDto, TPVoucherUpdateFormDto, TPVoucherViewDto, UpdateTPVoucherDto } from '../dto/transportPaymentVoucher.dto';

@injectable()
export class TPVoucherService {
  constructor(
    @inject(TYPES.TPVoucherRepository)
    private readonly tpVoucherRepository: TPVoucherRepository,
    @inject(TYPES.GrnRepository) private grnRepository: GrnRepository,
    @inject(TYPES.AuditLogService) private auditLogService: AuditLogService,
    @inject(TYPES.ProductRepository) private productRepository: ProductRepository,
    @inject(TYPES.DocumentbRepository) private documentbRepository: DocumentbRepository,
    @inject(TYPES.DocumentbService)
        private readonly documentbService: DocumentbService,
        @inject(TYPES.ApprovalFlowService)
    private approvalFlowService: ApprovalFlowService,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  private readonly CACHE_PREFIX = 'tpVoucher';
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

  async createTPVoucher(tpvoucherData: CreateTPVoucherDto & Record<string, any>): Promise<TPVoucher> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(tpvoucherData.requestedBy, DocDefEnum.PROCUREMENT);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {

       const approvalFlowExit = this.approvalFlowService.findApprovalFlowForLoggedUser(tpvoucherData.requestedBy, 'transport-payment-voucher')

      if (!approvalFlowExit) {
        throw new Error('Approval flow not found');
      }

      tpvoucherData.voucherNo = await this.generateTransportPaymentVoucherNo();

      const currentDate = new Date();
      tpvoucherData.createdDate = currentDate;
      tpvoucherData.createdTime = currentDate.toLocaleTimeString();

      if (tpvoucherData.products && Array.isArray(tpvoucherData.products)) {
        const products = await queryRunner.manager.findBy(this.productRepository.target, {
          id: In(tpvoucherData.products),
        });
        (tpvoucherData as any).products = products;
      }

      
      const newVoucher = queryRunner.manager.create(this.tpVoucherRepository.target, tpvoucherData as any) as unknown as TPVoucher;
      const saveVoucher = await queryRunner.manager.save(newVoucher) as unknown as TPVoucher;
      const document = await this.documentbService.createDocument({
              type: DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER,
              docDef: DocDefEnum.PROCUREMENT,
              totalAmt: tpvoucherData.totalAmt,
              status: DocumentStatus.HOLD,
              remarks: 'Document auto-created with GRN',
              lastActionBy: { id: tpvoucherData.requestedBy },
              document_type_id : Array.isArray(saveVoucher) ? (saveVoucher[0] as TPVoucher)?.id : (saveVoucher as TPVoucher).id
            }, );
      
      await queryRunner.commitTransaction();

      await this.documentbService.startApprovalFlow(document.id);

      await this.invalidateCache();
      return saveVoucher;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
 public async getAllRecycleBinTPVouchers(
    queryOptions: PaginationOptions, userId: string,
  ): Promise<TPVoucherListResponseDto> {
    const cacheKey = `${this.CACHE_PREFIX}:recycle:${userId}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { search } = queryOptions;

    const { data, meta } = await this.documentbService.getAllDocumentByUserId(
      userId,
      DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER,
      queryOptions,
      false,
      true // includeDeleted for recycle bin
    );

    const typedDocuments = data as DocumentWithRelatedData[];
    const activeDocuments = typedDocuments;

    const voucherIds = activeDocuments
      .map(doc => doc.document_type_id)
      .filter(Boolean) as string[];

    const vouchers = voucherIds.length
      ? await this.tpVoucherRepository
          .createQueryBuilder('tpv')
          .leftJoinAndSelect('tpv.grnNo', 'grnNo')
          .leftJoinAndSelect('tpv.companyName', 'companyName')
          .leftJoinAndSelect('tpv.location', 'location')
          .where('tpv.id IN (:...ids)', { ids: voucherIds })
          .andWhere('tpv.isDeleted = true')
          .getMany()
      : [];

    const voucherMap = new Map(vouchers.map(v => [v.id, v]));
    const recycleDocCreatedAtMap = new Map(activeDocuments.map(d => [d.id, d.createdAt]));

    let relatedDataOnly = activeDocuments
      .filter(doc => doc.document_type_id && voucherMap.has(doc.document_type_id))
      .map((doc) => {
        const rd: any = voucherMap.get(doc.document_type_id!)!;
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
      meta: { total: meta.total, page: meta.page, pages: meta.pages },
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

          
            
          
                  
    

public async getAllTPVouchers(
    queryOptions: PaginationOptions, userId: string,
  ): Promise<TPVoucherListResponseDto> {
    const cacheKey = `${this.CACHE_PREFIX}:list:${userId}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { search } = queryOptions;

    const { data, meta } = await this.documentbService.getAllDocumentByUserId(
      userId,
      DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER,
      queryOptions,
    );

    const typedDocuments = data as DocumentWithRelatedData[];
    const activeDocuments = typedDocuments;

    const voucherIds = activeDocuments
      .map(doc => doc.document_type_id)
      .filter(Boolean) as string[];

    const vouchers = voucherIds.length
      ? await this.tpVoucherRepository
          .createQueryBuilder('tpv')
          .leftJoinAndSelect('tpv.grnNo', 'grnNo')
          .leftJoinAndSelect('tpv.companyName', 'companyName')
          .leftJoinAndSelect('tpv.location', 'location')
          .where('tpv.id IN (:...ids)', { ids: voucherIds })
          .andWhere('tpv.isDeleted = false')
          .andWhere('tpv.deletedAt IS NULL')
          .getMany()
      : [];

    const voucherMap = new Map(vouchers.map(v => [v.id, v]));
    const docCreatedAtMap = new Map(activeDocuments.map(d => [d.id, d.createdAt]));

    let relatedDataOnly = activeDocuments
      .filter(doc => doc.document_type_id && voucherMap.has(doc.document_type_id))
      .map((doc) => {
        const rd: any = voucherMap.get(doc.document_type_id!)!;
        const { createdDate, createdTime } = formatDateTime(doc.createdAt);
        return {
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: `${doc.lastActionBy?.firstName || ''} ${doc.lastActionBy?.lastName || ''}`.trim(),
          createdDate,
          createdTime,
          id: rd.id || null,
          companyName: rd.companyName?.name || null,
          grnNo: rd.grnNo?.grnNo || null,
          altContactNo: rd.altContactNo || null,
          amtWords: rd.amtWords || null,
          contactNo: rd.contactNo || null,
          debitCreditTo: rd.debitCreditTo || null,
          destinationLocation: rd.destinationLocation || null,
          dispatchLocation: rd.dispatchLocation || null,
          driverName: rd.driverName || null,
          kyc: rd.kyc || null,
          location: rd.location?.name || null,
          payReceivedFrom: rd.payReceivedFrom || null,
          paymentMode: rd.paymentMode || null,
          receiverName: rd.receiverName || null,
          remark: rd.remark || null,
          totalAmt: rd.totalPayableAmt || null,
          vehicleNo: rd.vehicleNo || null,
          voucherNo: rd.voucherNo || null,
          freightAmt: rd.freightAmt || null,
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
      meta: { total: meta.total, page: meta.page, pages: meta.pages },
    };

    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }



  public async getTPVoucherByIdForView(docid: string): Promise<TPVoucherViewDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:view:${docid}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const document = await this.documentbService.getDocumentById(docid);
    const id = document.documentTypeId;
    if (!id) throw new Error(`Document type ID not found for document: ${docid}`);

    const voucher = await this.tpVoucherRepository
      .createQueryBuilder('tpVoucher')
      .leftJoinAndSelect('tpVoucher.grnNo', 'grn')
      .leftJoinAndSelect('tpVoucher.requestedBy', 'requestedBy')
      .leftJoinAndSelect('tpVoucher.products', 'products')
      .leftJoinAndSelect('tpVoucher.companyName', 'companyName')
      .leftJoinAndSelect('tpVoucher.location', 'location')
      .where('tpVoucher.id = :id', { id })
      .getOne();
    if (!voucher) return null;
    const rawDate = voucher.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);
    const formatResponse = {
      id: voucher.id,
      debitCreditTo: voucher.debitCreditTo,
      payReceivedFrom: voucher.payReceivedFrom,
      location: voucher.location?.name || null,
      voucherNo: voucher.voucherNo,
      companyName: voucher.companyName?.name || null,
      remark: voucher.remark || null,
      requestingDepartment: voucher.requestingDepartment,
      driverName: voucher.driverName,
      contactNo: voucher.contactNo,
      altContactNo: voucher.altContactNo,
      vehicleNo: voucher.vehicleNo,
      products: voucher.products?.map(product => product?.name) || null,
      dispatchLocation: voucher.dispatchLocation,
      destinationLocation: voucher.destinationLocation,
      paymentMode: voucher.paymentMode,
      freightAmt: voucher.freightAmt,
      totalPayableAmt: voucher.totalPayableAmt,
      extraAmt: voucher.extraAmt,
      deductionAmt: voucher.deductionAmt,
      finalPayableAmt: voucher.finalPayableAmt,
      advanceAmt: voucher.advanceAmt,
      actualAmt: voucher.actualAmt,
      decidedAmt: voucher.decidedAmt,
      kyc: voucher.kyc,
      createdTime: createdTime,
      createdDate: createdDate,
      amtWords: voucher.amtWords,
      approvalStatus: voucher.approvalStatus,
      receiverName: voucher.receiverName,
      anyAttachment: voucher.anyAttachment,
      grnNo: voucher.grnNo?.grnNo || null,
      requestedBy: voucher.requestedBy
        ? voucher.requestedBy?.firstName + ' ' + voucher.requestedBy?.lastName
        : null,
      overAllStatus: document.overAllStatus,
      createdBy: document.createdBy,
      approvalSummary: document.approvalSummary ?? null,
      documentId: document.id,
    };

    await this.cacheService.set(cacheKey, formatResponse, this.CACHE_TTL);
    return formatResponse;
  }

  public async getTPVoucherByIdForUpdate(id: string): Promise<TPVoucherUpdateFormDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const voucher = await this.tpVoucherRepository
      .createQueryBuilder('tpVoucher')
      .leftJoinAndSelect('tpVoucher.grnNo', 'grn')
      .leftJoinAndSelect('tpVoucher.requestedBy', 'requestedBy')
      .leftJoinAndSelect('tpVoucher.products', 'products')
      .leftJoinAndSelect('tpVoucher.companyName', 'companyName')
      .leftJoinAndSelect('tpVoucher.location', 'location')
      .where('tpVoucher.id = :id', { id })
      .getOne();
    if (!voucher) return null;
    const rawDate = voucher.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);
    const formatResponse = {
      id: voucher.id,

      debitCreditTo: voucher.debitCreditTo,
      payReceivedFrom: voucher.payReceivedFrom,
      location: voucher.location?.id || null,
      voucherNo: voucher.voucherNo,
      companyName: voucher.companyName?.id || null,
      remark: voucher.remark || null,
      requestingDepartment: voucher.requestingDepartment,
      driverName: voucher.driverName,
      contactNo: voucher.contactNo,
      altContactNo: voucher.altContactNo,
      vehicleNo: voucher.vehicleNo,
      dispatchLocation: voucher.dispatchLocation,
      destinationLocation: voucher.destinationLocation,
       products: voucher.products?.map(product => product?.id) || null,
      paymentMode: voucher.paymentMode,
      freightAmt: voucher.freightAmt,
      totalPayableAmt: voucher.totalPayableAmt,   // ✅ or finalPayableAmt
     extraAmt: voucher.extraAmt,
     deductionAmt: voucher.deductionAmt,
     finalPayableAmt: voucher.finalPayableAmt,
     advanceAmt: voucher.advanceAmt,  
     actualAmt: voucher.actualAmt,
     decidedAmt: voucher.decidedAmt,
      kyc: voucher.kyc,
      createdTime: createdTime,
      createdDate: createdDate,
      amtWords: voucher.amtWords,
      approvalStatus: voucher.approvalStatus,
      receiverName: voucher.receiverName,
      anyAttachment: voucher.anyAttachment,
      grnNo: voucher.grnNo?.id || null,
      requestedBy: voucher.requestedBy?.id || null,
    };

    await this.cacheService.set(cacheKey, formatResponse, this.CACHE_TTL);
    return formatResponse;
  }

  public async updateTPVoucher(
  id: string,
  updatedData: UpdateTPVoucherDto & Record<string, any>,
  updatedBy: string,
): Promise<TPVoucher | null> {
  const voucher = await this.tpVoucherRepository.findOne({
    where: { id },
    relations: ['products'], // load current products
  });

  if (!voucher) return null;

  const originalVoucher = { ...voucher, products: [...(voucher.products || [])] };

  const grnNo = updatedData.grnNo;
  if (grnNo) {
    const grn = await this.grnRepository.findOne({ where: { grnNo } });
    if (grn) voucher.grnNo = grn;
  }

  if (updatedData.products && Array.isArray(updatedData.products)) {
    const productEntities = await this.productRepository.find({ where: { id: In(updatedData.products) } });
    voucher.products = productEntities;
  }

  Object.assign(voucher, {
    ...updatedData,
    products: voucher.products, // keep updated relation
  });

  const savedVoucher = await this.tpVoucherRepository.save(voucher);

  await this.auditLogService.logChange(
    'TPVoucher',
    id,
    originalVoucher,
    voucher,
    updatedBy,
  );

  await this.invalidateCache(id);
  return savedVoucher;
}

  public async deleteTPVoucher(id: string): Promise<DeleteResultDto | null> {
    const exists = await this.tpVoucherRepository.count({ where: { id } });
   // if (!exists) return false;
    const voucher=await this.tpVoucherRepository.findOne({where:{id}});
    if(!voucher) throw new AppError(404,`Tp Vocuher with ID ${id} not found`);
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    await this.tpVoucherRepository.update({ id }, { deletionScheduledAt: sixMonthsFromNow } as any);
    await this.invalidateCache(id);
    return {No:voucher.voucherNo};
  }

  public async generateTransportPaymentVoucherNo(): Promise<string> {
    const today = new Date();
    const formattedDate = format(today, 'yyyyMMdd');

    const lastVoucher = await this.tpVoucherRepository
      .createQueryBuilder('tpVoucher')
      .where('tpVoucher.voucherNo LIKE :datePattern', { datePattern: `TPV-${formattedDate}-%` })
      .orderBy('tpVoucher.voucherNo', 'DESC')
      .getOne();

    let newSerialNumber = 1;
    if (lastVoucher) {
      const lastSerialNumber = parseInt(lastVoucher.voucherNo.split('-')[2], 10);
      newSerialNumber = lastSerialNumber + 1;
    }

    return `TPV-${formattedDate}`;
  }

  public async deleteMultipleTransportPaymentVoucher(ids: string[]): Promise<BulkDeleteResultDto> {
   // if (!ids.length) return { message: 'No IDs provided' };
    const success: { id: string; No: string }[] = [];
    const failed: { id: string; reason: string }[] = [];
    const [tpVouchers, relatedDocuments] = await Promise.all([
      this.tpVoucherRepository.find({ where: { id: In(ids) } }),
      this.documentbRepository
        .createQueryBuilder('doc')
        .select(['doc.id', 'doc.document_type_id'])
        .where('doc.document_type_id IN (:...ids)', { ids })
        .getMany(),
    ]);

    const foundIds = new Set(tpVouchers.map(v => v.id));
    const missingId = ids.find(id => !foundIds.has(id));
    if (missingId) throw new Error(`Transport Payment Voucher with ID ${missingId} not found`);

    const docIds = relatedDocuments.map(d => d.id);
    if (docIds.length) {
      await this.documentbRepository
        .createQueryBuilder()
        .update()
        .set({ isDeleted: true } as any)
        .whereInIds(docIds)
        .execute();
    }

    await this.tpVoucherRepository
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

    tpVouchers.map((v)=>{
      success.push({id:v.id,No:v.voucherNo})
    })

    return { success,failed,message: 'Transport Payment Voucher records marked for deletion successfully' };
  }
}


//   public async getTPVoucherById(id: string): Promise<TPVoucherDetailDto | null> {
//     const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
//     const cached = await this.cacheService.get<any>(cacheKey);
//     if (cached) return cached;

//     const voucher = await this.tpVoucherRepository
//       .createQueryBuilder('tpVoucher')
//       .leftJoinAndSelect('tpVoucher.grnNo', 'grn')
//       .leftJoinAndSelect('tpVoucher.requestedBy', 'requestedBy')
//       .leftJoinAndSelect('tpVoucher.companyName', 'companyName')

//       .select([
//   'tpVoucher.id',
//   'tpVoucher.debitCreditTo',
//   'tpVoucher.payReceivedFrom',
//   'tpVoucher.location',
//   'tpVoucher.voucherNo',
//   'companyName.id',
//   'companyName.name',
//   'tpVoucher.requestingDepartment',
//   'tpVoucher.driverName',
//   'tpVoucher.contactNo',
//   'tpVoucher.altContactNo',
//   'tpVoucher.vehicleNo',
//   'tpVoucher.dispatchLocation',
//   'tpVoucher.destinationLocation',
//   'tpVoucher.products',
//   'tpVoucher.paymentMode',
//   'tpVoucher.freightAmt',
//   'tpVoucher.totalPayableAmt',   // ✅ or finalPayableAmt
//   'tpVoucher.kyc',
//   'tpVoucher.remark',
//   'tpVoucher.amtWords',
//   'tpVoucher.approvalStatus',
//   'tpVoucher.receiverName',
//   'tpVoucher.anyAttachment',
//   'tpVoucher.createdAt',
//   'grn.id',
//   'grn.grnNo',
//   'requestedBy.id',
//   'requestedBy.firstName',
//   'requestedBy.lastName',
// ])

//       .where('tpVoucher.id = :id', { id })
//       .getOne();
//     if (!voucher) return null;
//     const rawDate = voucher.createdAt;
//     const { createdDate, createdTime } = formatDateTime(rawDate);
//     if (voucher && voucher.grnNo) {
//       const result = {
//         ...voucher,
//         grnNo: { id: voucher.grnNo?.id, grnNo: voucher.grnNo?.grnNo },
//         companyName: { id: voucher.companyName?.id || null, companyName: voucher.companyName?.name || null },
//         createdTime: createdTime,
//         createdDate: createdDate,
//       };
//       await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
//       return result;
//     }

//     await this.cacheService.set(cacheKey, voucher, this.CACHE_TTL);
//     return voucher as unknown as TPVoucherDetailDto;
//   }