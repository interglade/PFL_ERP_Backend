import { id, inject, injectable } from 'inversify';

import { PMPVoucher } from '../entity/packingMaterialVoucher.entity';
import { TYPES } from '../../../types';
import { format } from 'date-fns';

import AppError from '../../../utils/appError';
import { PaginationOptions } from '../../../utils/pagination';
import { formatDateTime } from '../../../utils/dateUtils';
import { DocumentTypeEnum as DocDefEnum } from '../../../documentDef/entity/documentdef.entity';
import { DocumentStatus, DocumentTypeEnum } from '../../../approvalFlow/entity/docuemnt.entity';

import { In, DataSource } from 'typeorm';

import { createHash } from 'crypto';
import { CreatePMPVoucherDto, PMPVoucherListItemDto, PMPVoucherDetailDto, UpdatePMPVoucherDto } from '../dto/pmpVoucher.dto';
import { formatAddress } from '../../../utils/addressFormate.utils';
import { BulkDeleteResultDto, DeleteResultDto } from '../../../global/general.dto';
import { string } from 'zod';
import { PMPVoucherRepository } from '../repository/pmpvoucher.repository';
import { GrnRepository } from '../../../grn/repository/grn.repository';
import { AuditLogService } from '../../../employeeActivity/service/auditLog.service';
import { DocumentbService, DocumentWithRelatedData } from '../../../approvalFlow/service/documentb.service';
import { DocumentbRepository } from '../../../approvalFlow/repository/documentb.repository';
import { ApprovalFlowService } from '../../../approvalFlow/service/approvalFlow.service';
import { CacheService } from '../../../global/cache.service';

@injectable()
export class PMPVoucherService {
  constructor(
    @inject(TYPES.PMPVoucherRepository)
    private pmpVoucherRepository: PMPVoucherRepository,
    @inject(TYPES.GrnRepository) private grnRepository: GrnRepository,
    @inject(TYPES.AuditLogService) private auditLogService: AuditLogService,
        @inject(TYPES.DocumentbService) private documentbService: DocumentbService, // Assuming DocumentbService is defined elsewhere
        @inject(TYPES.DocumentbRepository) private documentbRepository : DocumentbRepository,
        @inject(TYPES.ApprovalFlowService)
    private approvalFlowService: ApprovalFlowService,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  private readonly CACHE_PREFIX = 'pmpv';
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

  public async getAllVouchers(queryOptions: PaginationOptions, userId: string): Promise<{ data: PMPVoucherListItemDto[]; meta: { total: number; page: number; pages: number } }> {
    const hash = createHash('md5').update(`${userId}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:list:${hash}`;
    const cached = await this.cacheService.get<{ data: PMPVoucherListItemDto[]; meta: { total: number; page: number; pages: number } }>(cacheKey);
    if (cached) return cached;

    const { search } = queryOptions;
    const { data, meta } = await this.documentbService.getAllDocumentByUserId(
      userId,
      DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER,
      queryOptions,
    );

    const activeDocuments = data as DocumentWithRelatedData[];
    const voucherIds = activeDocuments.map(d => d.document_type_id).filter(Boolean) as string[];

    const vouchers = voucherIds.length
      ? await this.pmpVoucherRepository
          .createQueryBuilder('v')
          //.leftJoinAndSelect('v.address','address')
          .leftJoinAndSelect('v.companyName', 'companyName')
          .leftJoinAndSelect('v.grnNo', 'grnNo')
          .leftJoinAndSelect('v.materials', 'materials')
          .leftJoinAndSelect('materials.itemUom', 'itemUom')
          .leftJoinAndSelect('v.address', 'address')
          .leftJoinAndSelect('v.requestedBy', 'requestedBy')
          .leftJoinAndSelect('v.location', 'location')
          .where('v.id IN (:...ids)', { ids: voucherIds })
          .andWhere('v.isDeleted = false')
          .andWhere('v.deletedAt IS NULL')
          .getMany()
      : [];
    const voucherMap = new Map(vouchers.map(v => [v.id, v]));
    const docCreatedAtMap = new Map(activeDocuments.map(d => [d.id, d.createdAt]));

    let relatedDataOnly: PMPVoucherListItemDto[] = activeDocuments
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
          kyc:rd.kyc,
          purpose:rd.purpose || null,
          altContactNo:rd.altContactNo || null,
          contactNo:rd.contactNo || null,
          voucherNo: rd.voucherNo || null,
          approvalStatus: rd.approvalStatus || null,
          debitCreditTo: rd.debitCreditTo || null,
          payReceivedFrom: rd.payReceivedFrom || null,
          location: rd.location || null,
          sellerName: rd.sellerName || null,
         //address:rd.address ? formatAddress(rd.address) : '',
         address:{
            address1:rd.address?.address1,
            address2:rd.address?.address2,
            location:rd.address?.location,
            city:rd.address?.city,
            state:rd.address?.state,
            pincode:rd.address?.pincode
         },
          companyName: rd.companyName?.name || null,
          grnNo: rd.grnNo?.grnNo || null,
          totalAmt: rd.totalAmt ?? null,
          amtWords: rd.amtWords || null,
          paymentMode: rd.paymentMode || null,
          receiverName: rd.receiverName || null,
          remark: rd.remark || null,
          requestingDepartment: rd.requestingDepartment || null,
          location: rd.location ? rd.location.name : null,
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
        const docA = docCreatedAtMap.get(a.documentId ?? '') ?? 0;
        const docB = docCreatedAtMap.get(b.documentId ?? '') ?? 0;
        const tA = new Date(docA).getTime();
        const tB = new Date(docB).getTime();
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
public async getAllRecycleBinVouchers(queryOptions: PaginationOptions, userId: string): Promise<any> {
    const hash = createHash('md5').update(`${userId}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:recycle:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { search } = queryOptions;
    const { data, meta } = await this.documentbService.getAllDocumentByUserId(
      userId,
      DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER,
      queryOptions,
      false,
      true,
    );

    const activeDocuments = data as DocumentWithRelatedData[];
    const voucherIds = activeDocuments.map(d => d.document_type_id).filter(Boolean) as string[];

    const vouchers = voucherIds.length
      ? await this.pmpVoucherRepository
          .createQueryBuilder('v')
          .leftJoinAndSelect('v.companyName', 'companyName')
          .leftJoinAndSelect('v.grnNo', 'grnNo')
          .leftJoinAndSelect('v.materials', 'materials')
          .leftJoinAndSelect('materials.itemUom', 'itemUom')
          .leftJoinAndSelect('v.address', 'address')
          .leftJoinAndSelect('v.requestedBy', 'requestedBy')
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



  public async getVoucherByIdforView(docid: string): Promise<PMPVoucherDetailDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:view:${docid}`;
    const cached = await this.cacheService.get<PMPVoucherDetailDto>(cacheKey);
    if (cached) return cached;

    const document = await this.documentbService.getDocumentById(docid);
    const id = document.documentTypeId;
    if (!id) throw new AppError(404, 'Document not found');
    const voucher = await this.pmpVoucherRepository
      .createQueryBuilder('pmpVoucher')
      .leftJoinAndSelect('pmpVoucher.materials', 'materials')
      .leftJoinAndSelect('materials.itemUom', 'itemUom')
      .leftJoinAndSelect('pmpVoucher.address', 'address')
      .leftJoinAndSelect('pmpVoucher.requestedBy', 'requestedBy')
      .leftJoinAndSelect('pmpVoucher.companyName', 'company')
      .leftJoinAndSelect('pmpVoucher.grnNo', 'grn')
      .leftJoinAndSelect('pmpVoucher.passBy', 'passBy')
      .leftJoinAndSelect('pmpVoucher.approveBy', 'approveBy')
      .leftJoinAndSelect('pmpVoucher.location', 'location')
      .where('pmpVoucher.id = :id', { id })
      .getOne();
    if (!voucher) return null;
    const rawDate = voucher.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);
    const formatResponse: PMPVoucherDetailDto = {
      id: voucher.id,
      voucherNo: voucher.voucherNo,
      debitCreditTo: voucher.debitCreditTo,
      payReceivedFrom: voucher.payReceivedFrom,
      location: voucher.location,
      sellerName: voucher.sellerName,

       address:{
      address1: voucher?.address?.address1,
      address2: voucher?.address?.address2,
      location:voucher?.address?.location,
      city:voucher?.address?.city,
      state:voucher?.address?.state,
      pincode:voucher?.address?.pincode,

      } ,
      contactNo: voucher.contactNo,
      altContactNo: voucher.altContactNo,
      purpose: voucher.purpose,
      paymentMode: voucher.paymentMode,
      totalAmt: voucher.totalAmt,
      amtWords: voucher.amtWords,
      companyName: voucher.companyName?.name ?? null,
      requestedBy: voucher.requestedBy
        ? `${voucher.requestedBy.firstName ?? ''} ${voucher.requestedBy.lastName ?? ''}`.trim()
        : null,
      passBy: voucher.passBy
        ? `${voucher.passBy.firstName ?? ''} ${voucher.passBy.lastName ?? ''}`.trim()
        : null,
      approveBy: voucher.approveBy
        ? `${voucher.approveBy.firstName ?? ''} ${voucher.approveBy.lastName ?? ''}`.trim()
        : null,
      approvalStatus: voucher.approvalStatus ?? null,
      grnNo: voucher.grnNo?.grnNo ?? null,
      createdTime: createdTime,
      remark: voucher.remark,
      createdDate: createdDate,
      receiverName: voucher.receiverName,
      anyAttachment: voucher.anyAttachment,
      requestingDepartment: voucher.requestingDepartment,
      kyc: voucher.kyc,
      materials: voucher.materials.map((material) => ({
        id: material.id,
        itemName: material.itemName,
        itemQty: material.itemQty,
        rate: material.rate,
        amt: material.amt,
        itemUom: material.itemUom?.unit ?? null,

      })),
      overAllStatus: document.overAllStatus,
        createdBy: document.createdBy,
        approvalSummary: document.approvalSummary ?? null,
        documentId: document.id,
        location: voucher.location ? voucher.location.name : null,
    }
    await this.cacheService.set(cacheKey, formatResponse, this.CACHE_TTL);
    return formatResponse;
  }

  public async getVoucherByIdForUpdate(id: string): Promise<UpdatePMPVoucherDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<UpdatePMPVoucherDto>(cacheKey);
    if (cached) return cached;

    const voucher = await this.pmpVoucherRepository
      .createQueryBuilder('pmpVoucher')
      .leftJoinAndSelect('pmpVoucher.materials', 'materials')
      .leftJoinAndSelect('materials.itemUom', 'itemUom')
      .leftJoinAndSelect('pmpVoucher.address', 'address')
      .leftJoinAndSelect('pmpVoucher.requestedBy', 'requestedBy')
      .leftJoinAndSelect('pmpVoucher.companyName', 'company') 
      .leftJoinAndSelect('pmpVoucher.grnNo', 'grn') 
      .leftJoinAndSelect('pmpVoucher.location', 'location')
      .where('pmpVoucher.id = :id', { id })
      .getOne();
    if (!voucher) return null;
    const rawDate = voucher.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);

    const formatResponse: UpdatePMPVoucherDto = {
      //id: voucher.id,
      voucherNo: voucher.voucherNo,
      approvalStatus: voucher.approvalStatus,
      debitCreditTo: voucher.debitCreditTo,
      payReceivedFrom: voucher.payReceivedFrom,
      location: voucher.location,
      sellerName: voucher.sellerName,
      contactNo: voucher.contactNo,
      altContactNo: voucher.altContactNo,
      purpose: voucher.purpose,
      paymentMode: voucher.paymentMode,
      totalAmt: voucher.totalAmt,
      remark: voucher.remark,
      amtWords: voucher.amtWords,
      address: voucher.address
        ? {
            id: voucher.address.id ?? null,
            address1: voucher.address.address1 ?? null,
            address2: voucher.address.address2 ?? null,
            location: voucher.address.location ?? null,
            city: voucher.address.city ?? null,
            state: voucher.address.state ?? null,
            pincode: voucher.address.pincode ?? null,
          }
        : null,
      // companyName: voucher.companyName
      //   ? {
      //       id: voucher.companyName.id ?? null,
      //       companyName: voucher.companyName.name ?? null,
      //     }
      //   : null,
      companyName: voucher.companyName?.id ?? undefined,
      grnNo: voucher.grnNo?.id || null,
      requestedBy: `${voucher.requestedBy.firstName} ${voucher.requestedBy.lastName}`,
        // ? {
        //     id: voucher.requestedBy.id ?? null,
        //     firstName: voucher.requestedBy.firstName ?? null,
        //     lastName: voucher.requestedBy.lastName ?? null,
        //   }
        // : null,
      // grnNo: voucher.grnNo
      //   ? {
      //       id: voucher.grnNo.id ?? null,
      //       grnNo: voucher.grnNo.grnNo ?? null,
      //     }
      //   : null,
      // createdTime,
      // createdDate,
      receiverName: voucher.receiverName,
      anyAttachment: voucher.anyAttachment ?? null,
      requestingDepartment: voucher.requestingDepartment ?? null,
      kyc: voucher.kyc ?? null,
      materials: voucher.materials.map((material) => ({
        id: material.id,
        itemName: material.itemName,
        itemQty: material.itemQty,
        rate: material.rate,
        amt: material.amt,
        itemUom: material.itemUom?.id ?? null,
      })),
      location: voucher.location?.id ?? null,
    };

    await this.cacheService.set(cacheKey, formatResponse, this.CACHE_TTL);
    return formatResponse;
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

  public async createVoucher(voucherData: CreatePMPVoucherDto): Promise<any> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(voucherData.requestedBy, DocDefEnum.PROCUREMENT);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {

      //  const approvalFlowExit = await this.approvalFlowService.findApprovalFlowForLoggedUser(voucherData.requestedBy, DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER)

      // if (!approvalFlowExit) {
      //   throw new Error('Approval flow not found');
      // }

      voucherData.voucherNo = await this.generatePMPVoucherNo();

      const pmpvoucher = queryRunner.manager.create(this.pmpVoucherRepository.target, voucherData as any);
      const savePmpVoucher =  await queryRunner.manager.save(pmpvoucher);

      const document = await this.documentbService.createDocument({
              type: DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER,
              docDef: DocDefEnum.PROCUREMENT,
              totalAmt: Array.isArray(savePmpVoucher) ? (savePmpVoucher[0] as PMPVoucher)?.totalAmt : (savePmpVoucher as PMPVoucher).totalAmt,
              status: DocumentStatus.HOLD,
              remarks: 'Document auto-created with GRN',
              lastActionBy: { id: voucherData.requestedBy },
              document_type_id: Array.isArray(savePmpVoucher) ? (savePmpVoucher[0] as PMPVoucher)?.id : (savePmpVoucher as PMPVoucher).id
            }, );

      await queryRunner.commitTransaction();

      await this.documentbService.startApprovalFlow(document.id);
      await this.invalidateCache();

      return savePmpVoucher;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  public async updateVoucher(
    id: string,
    updatedData: UpdatePMPVoucherDto,
    updatedBy: string,
  ): Promise<PMPVoucher | null> {
    const voucher = await this.pmpVoucherRepository.findOne({
      where: { id },
    });

    if (!voucher) {
      return null;
    }

    const originalVoucher = { ...voucher };

    const dataToUpdate = { ...updatedData } as any;
    const grnNo = dataToUpdate.grnNo;
    if (typeof grnNo === 'string' && grnNo.trim()) {
      const grn = await this.grnRepository.findOne({ where: { grnNo } });
      if (grn) dataToUpdate.grnNo = grn;
    }

    Object.assign(voucher, dataToUpdate);

    const savedVoucher = await this.pmpVoucherRepository.save(voucher);

    await this.auditLogService.logChange(
      'PMPVoucher',
      id,
      originalVoucher,
      voucher,
      updatedBy,
    );

    await this.invalidateCache(id);
    return savedVoucher;
  }

  async deleteVoucher(id: string): Promise<DeleteResultDto | null> {
    const exists = await this.pmpVoucherRepository.count({ where: { id } });
    if (!exists) throw new AppError(404, `Voucher with ID ${id} not found`);
    const pmpVoucher=await this.pmpVoucherRepository.findOne({where:{id}});
    if(!pmpVoucher){
      throw new AppError(404,`PMP_VOUCHER with ID ${id} not found`)
    }
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    await this.pmpVoucherRepository.update({ id }, { deletionScheduledAt: sixMonthsFromNow } as any);
    await this.invalidateCache(id);
    return {No:pmpVoucher.voucherNo};
  }

  public async generatePMPVoucherNo(): Promise<string> {
    const today = new Date();
    const formattedDate = format(today, 'yyyyMMdd');

    const lastVoucher = await this.pmpVoucherRepository
      .createQueryBuilder('pmpVoucher')
      .where('pmpVoucher.voucherNo LIKE :datePattern', { datePattern: `PMPV-${formattedDate}-%` })
      .orderBy('pmpVoucher.voucherNo', 'DESC')
      .getOne();

    let newSerialNumber = 1;
    if (lastVoucher) {
      const lastSerialNumber = parseInt(lastVoucher.voucherNo.split('-')[2], 10);
      newSerialNumber = lastSerialNumber + 1;
    }

    return `PMPV-${formattedDate}`;
  }

  public async deleteMultiplePMPVoucher(ids: string[]): Promise<BulkDeleteResultDto> {
   // if (!ids.length) return { message: 'No IDs provided' };
    const success: { id: string; No: string }[] = [];
    const failed: { id: string; reason: string }[] = [];

    const [pmpVouchers, relatedDocuments] = await Promise.all([
      this.pmpVoucherRepository.find({ where: { id: In(ids) } }),
      this.documentbRepository
        .createQueryBuilder('doc')
        .select(['doc.id', 'doc.document_type_id'])
        .where('doc.document_type_id IN (:...ids)', { ids })
        .getMany(),
    ]);

    const foundIds = new Set(pmpVouchers.map(v => v.id));
    const missingId = ids.find(id => !foundIds.has(id));
    if (missingId) throw new AppError(404, `PMPVoucher with ID ${missingId} not found`);

    const docIds = relatedDocuments.map(d => d.id);
    if (docIds.length) {
      await this.documentbRepository
        .createQueryBuilder()
        .update()
        .set({ isDeleted: true } as any)
        .whereInIds(docIds)
        .execute();
    }

    await this.pmpVoucherRepository
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
    pmpVouchers.map((v)=>{
      success.push({id:v.id,No:v.voucherNo});
    })
    return {success,failed,message:'Deleted Successfully'};
  }

}




  // public async getVoucherById(id: string): Promise<any> {
  //   const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
  //   const cached = await this.cacheService.get<any>(cacheKey);
  //   if (cached) return cached;

  //   const voucher = await this.pmpVoucherRepository
  //     .createQueryBuilder('pmpVoucher')
  //     .leftJoinAndSelect('pmpVoucher.materials', 'materials')
  //     .leftJoinAndSelect('materials.itemUom', 'itemUom')
  //     .leftJoinAndSelect('pmpVoucher.address', 'address')
  //     .leftJoinAndSelect('pmpVoucher.requestedBy', 'requestedBy')
  //     .leftJoinAndSelect('pmpVoucher.companyName', 'company') // Renamed alias to "company"
  //     .leftJoinAndSelect('pmpVoucher.grnNo', 'grn') // Join with GRN entity
  //     .select([
  //       'pmpVoucher.id',
  //       'pmpVoucher.voucherNo',
  //       'pmpVoucher.approvalStatus',
  //       'pmpVoucher.debitCreditTo',
  //       'pmpVoucher.payReceivedFrom',
  //       'pmpVoucher.location',
  //       'pmpVoucher.sellerName',
  //       'pmpVoucher.contactNo',
  //       'pmpVoucher.altContactNo',
  //       'pmpVoucher.purpose',
  //       'pmpVoucher.paymentMode',
  //       'pmpVoucher.totalAmt',
  //       'pmpVoucher.amtWords',
  //       'pmpVoucher.createdAt',

  //       'pmpVoucher.receiverName',
  //       'pmpVoucher.anyAttachment',
  //       'pmpVoucher.requestingDepartment',
  //       'pmpVoucher.kyc',

  //       'materials.id',
  //       'materials.itemName',
  //       'materials.itemQty',
  //       'materials.rate',
  //       'materials.amt',
  //       'itemUom.id',
  //       'itemUom.unit',

  //       'company.id',
  //       'company.name',

  //       'address',

  //       'requestedBy.id',
  //       'requestedBy.firstName',
  //       'requestedBy.lastName',

  //       'grn.id',
  //       'grn.grnNo',
  //     ])
  //     .where('pmpVoucher.id = :id', { id })
  //     .getOne();
  //   if (!voucher) return null;
  //   const rawDate = voucher.createdAt;
  //   const { createdDate, createdTime } = formatDateTime(rawDate);
  //   if (voucher) {
  //     const idResult = {
  //       ...voucher,

  //       grnNo: voucher.grnNo
  //         ? {
  //             id: voucher.grnNo.id || null,
  //             grnNo: voucher.grnNo.grnNo || null,
  //           }
  //         : null,

  //       companyName: voucher.companyName
  //         ? {
  //             id: voucher.companyName.id || null,
  //             companyName: voucher.companyName.name || null,
  //           }
  //         : null,

  //       createdTime: createdTime,
  //       createdDate: createdDate,
  //     };
  //     await this.cacheService.set(cacheKey, idResult, this.CACHE_TTL);
  //     return idResult;
  //   }

  //   return voucher;
  // }