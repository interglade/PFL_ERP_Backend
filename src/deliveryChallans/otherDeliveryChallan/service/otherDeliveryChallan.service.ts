import { inject, injectable } from 'inversify';
import { TYPES } from '../../../types';
import { OtherDeliveryChallanRepository } from '../repository/otherDeliveryChallan.repository';
import logger from '../../../utils/logger';
import { buildQuery, PaginationOptions } from '../../../utils/pagination';
import { formatDateTime } from '../../../utils/dateUtils';
import { DataSource } from 'typeorm';

import { CustomerDeliveryChallanService } from '../../customerDeliveryChllan/service/customerDeliveryChallan.service';
import { DocumentStatus} from '../../../approvalFlow/entity/docuemnt.entity';
import { DocumentTypeEnum as DocDefEnum, DocumentTypeEnum } from '../../../documentDef/entity/documentdef.entity';
import { CacheService } from '../../../global/cache.service';
import { createHash } from 'crypto';



import { BulkDeleteResultDto, DeleteResultDto } from '../../../global/general.dto';
import { result } from 'lodash';
import AppError from '../../../utils/appError';
import { ApprovalFlowService } from '../../../approvalFlow/service/approvalFlow.service';
import { DocumentbService, DocumentWithRelatedData } from '../../../approvalFlow/service/documentb.service';
import { DocDoubleApproverService } from '../../../approvalFlow/service/docDoubleApprover.service';
import { DeliveryChallanService } from '../../deliverychllan/service/deliveryChallan.service';
import { DocumentbRepository } from '../../../approvalFlow/repository/documentb.repository';
import { CreateODCDto, ODCListResponseDto, ODCUpdateFormDto, ODCViewDto, UpdateODCDto } from '../dto/otherDeliveryChallan.dto';
import { OtherDeliveryChallan } from '../entity/otherDeliveryChallan.entity';


@injectable()
export class OtherDeliveryChallanService {
  constructor(
    @inject(TYPES.OtherDeliveryChallanRepository)
    private readonly challanRepository: OtherDeliveryChallanRepository,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
        @inject(TYPES.DocumentbService)
            private readonly documentbService: DocumentbService,
            @inject(TYPES.DocDoubleApproverService)
                private readonly docDoubleApproverService: DocDoubleApproverService,
                @inject(TYPES.DeliveryChallanService)
                private readonly deliveryChallanService: DeliveryChallanService,
                     @inject(TYPES.CustomerDeliveryChallanService)
    private readonly customerDeliveryChallanService:CustomerDeliveryChallanService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
    @inject(TYPES.DocumentbRepository)
    private readonly documentbRepository: DocumentbRepository,
    @inject(TYPES.ApprovalFlowService)
    private readonly approvalFlowService: ApprovalFlowService,
  ) {}

  private readonly CACHE_PREFIX = 'odc';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
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

  async create(data: CreateODCDto & Record<string, any>): Promise<any> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(data.createdBy, DocDefEnum.OPERATION);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      data.challanNo = await this.customerDeliveryChallanService.generateVoucherNo(data.type || 'O');

      const challanData: any = {
        challanNo: data.challanNo,
        type: 'other-delivery-challan',
        companyName: data.companyName ? { id: data.companyName } : undefined,
        offices: data.offices ? { id: data.offices } : undefined,
        grnNo: data.grnNo ? { id: data.grnNo } : undefined,
        fromLocation: data.fromLocation ? { id: data.fromLocation } : undefined,
        driverName: data.driverName,
        contactNo: data.contactNo,
        altContactNo: data.altContactNo,
        vehicleNo: data.vehicleNo,
        licenseNo: data.licenseNo,
        rmn: data.rmn,
        receiverName: data.receiverName,
        transitInsuranceNo: data.transitInsuranceNo || null,
        totalProductAmount: data.totalProductAmount,
        netProductWeight: data.netProductWeight,
        netPackagingMaterialWeight: data.netPackagingMaterialWeight,
        totalPackagingMaterialAmount: data.totalPackagingMaterialAmount,
        totalAmtInWords: data.totalAmtInWords,
        requestingDepartment: data.requestingDepartment,
        remark: data.remark,
        anyAttachment: data.anyAttachment,
        createdBy: data.createdBy ? { id: data.createdBy } : undefined,
        // OtherDeliveryChallan specific fields (varchar columns)
        customer: data.customerName || data.customer || null,
        customerContactNo: data.customerContactNo || null,
        customerEmail: data.customerEmail || null,
        deliveryChallanProducts: data.deliveryChallanProducts,
      };

      // Handle customerAddress — create new if object, link if UUID string
      if (data.customerAddress && typeof data.customerAddress === 'object') {
        const newAddress = queryRunner.manager.create('Address', {
          address1: data.customerAddress.address1,
          address2: data.customerAddress.address2,
          location: data.customerAddress.location,
          city: data.customerAddress.city,
          state: data.customerAddress.state,
          pincode: data.customerAddress.pincode,
        });
        const savedAddress = await queryRunner.manager.save(newAddress) as any;
        challanData.customerAddress = { id: savedAddress.id };
      } else if (data.customerAddress && typeof data.customerAddress === 'string') {
        challanData.customerAddress = { id: data.customerAddress };
      }

      const challan = queryRunner.manager.create(this.challanRepository.target, challanData);
      const savedChallanArr = await queryRunner.manager.save(challan);
      const savedChallan = Array.isArray(savedChallanArr) ? savedChallanArr[0] : savedChallanArr;

      const document = await this.documentbService.createDocument({
        type: DocumentTypeEnum.DC_TYPE_OTHER,
        docDef: DocDefEnum.OPERATION,
        status: DocumentStatus.HOLD,
        remarks: 'Document auto-created with Other Delivery Challan',
        lastActionBy: { id: data.createdBy },
        document_type_id: savedChallan.id,
      });

      // Commit transaction - all operations succeeded
      await queryRunner.commitTransaction();

      // Start approval flow after commit so challan is visible to other DB connections
      await this.documentbService.startApprovalFlow(document.id);
      await this.invalidateCache();

      return savedChallan;
    } catch (error: any) {
      // Rollback transaction - undo all changes
      await queryRunner.rollbackTransaction();
      console.error('Error creating GRN:', error);
      throw new Error('Failed to create GRN');
    } finally {
      // Release query runner
      await queryRunner.release();
    }
  }
  catch(err: any) {
    logger.error('Error creating other delivery challan', { error: err });
    return null;
  }



  async getByIdChallanforView(docId: string): Promise<ODCViewDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:view:${docId}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const document = await this.docDoubleApproverService.getDocumentById(docId);
    const id = document.documentTypeId;
    if (!id) return null;

    const challan = await this.challanRepository
      .createQueryBuilder('challan')
      .leftJoin('challan.deliveryChallanProducts', 'products')
      .leftJoin('products.productName', 'productName')
      .leftJoin('products.variant', 'variant')
      .leftJoin('products.packagingMaterial', 'packagingMaterial')
      .leftJoin('products.packagingMaterialUoM', 'packagingMaterialUoM')
      .leftJoin('products.saleUoM', 'saleUoM')
      .leftJoin('challan.companyName', 'company')
      .leftJoin('challan.customerAddress', 'customerAddress')
      .leftJoin('challan.offices', 'office')
      .leftJoin('challan.grnNo', 'grn')
      .leftJoin('challan.fromLocation', 'fromLocation')
      .select([
        'challan.id', 'challan.challanNo', 'challan.transitInsuranceNo', 'challan.rmn',
        'challan.driverName', 'challan.contactNo', 'challan.altContactNo',
        'challan.vehicleNo', 'challan.licenseNo', 'challan.receiverName',
        'challan.totalProductAmount', 'challan.netProductWeight',
        'challan.netPackagingMaterialWeight', 'challan.totalPackagingMaterialAmount',
        'challan.totalAmtInWords', 'challan.remark', 'challan.anyAttachment', 'challan.createdAt',
        'challan.customer', 'challan.customerContactNo', 'challan.customerEmail',
        'company.name', 'office.name', 'grn.grnNo', 'fromLocation.name',
        'customerAddress.address1', 'customerAddress.address2', 'customerAddress.location',
        'customerAddress.city', 'customerAddress.state', 'customerAddress.pincode',
        'products.id', 'products.quantity', 'products.unitPrice', 'products.amount',
        'products.netWeight', 'products.grossWeight', 'products.packingMaterialWeight',
        'products.packagingMaterialAmount', 'products.packagingMaterialUnitPrice',
        'products.packagingMaterialQuantity', 'products.packagingMaterialTotalWeight',
        'productName.name', 'variant.variantName',
        'saleUoM.unit', 'packagingMaterial.packagingMaterialName', 'packagingMaterialUoM.unit',
      ])
      .where('challan.id = :id', { id })
      .getOne();

    if (!challan) return null;

    const { createdDate, createdTime } = formatDateTime(challan.createdAt);
    const addr = (challan as any).customerAddress;

    const formattedChallan = {
      id: challan.id,
      documentId: document.documentId,
      challanNo: challan.challanNo,
      companyName: challan.companyName?.name ?? null,
      office: challan.offices?.name ?? null,
      grnNo: challan.grnNo?.grnNo ?? null,
      fromLocation: challan.fromLocation?.name ?? null,
      driverName: challan.driverName ?? null,
      contactNo: challan.contactNo ?? null,
      altContactNo: challan.altContactNo ?? null,
      vehicleNo: challan.vehicleNo ?? null,
      licenseNo: challan.licenseNo ?? null,
      receiverName: challan.receiverName ?? null,
      rmn: challan.rmn ?? null,
      transitInsuranceNo: challan.transitInsuranceNo ?? null,
      totalProductAmount: challan.totalProductAmount ?? null,
      netProductWeight: challan.netProductWeight ?? null,
      netPackagingMaterialWeight: challan.netPackagingMaterialWeight ?? null,
      totalPackagingMaterialAmount: challan.totalPackagingMaterialAmount ?? null,
      totalAmtInWords: challan.totalAmtInWords ?? null,
      remark: challan.remark ?? null,
      anyAttachment: challan.anyAttachment ?? null,
      createdDate,
      createdTime,
      customer: (challan as any).customer ?? null,
      customerContactNo: (challan as any).customerContactNo ?? null,
      customerEmail: (challan as any).customerEmail ?? null,
      customerAddress: addr
        ? [addr.address1, addr.address2, addr.location, addr.city, addr.state, addr.pincode]
            .filter(Boolean).join(' ')
        : null,
      overAllStatus: document.overAllStatus,
      createdBy: document.createdBy,
      approvalSummary: document.approvalSummary ?? null,
      deliveryChallanProducts: (challan.deliveryChallanProducts ?? []).map((p) => ({
        id: p.id,
        productName: p.productName?.name ?? null,
        variant: p.variant?.variantName ?? null,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        amount: p.amount,
        netWeight: p.netWeight,
        grossWeight: p.grossWeight,
        packingMaterialWeight: p.packingMaterialWeight ?? null,
        saleUoM: p.saleUoM?.unit ?? null,
        packagingMaterial: p.packagingMaterial?.packagingMaterialName ?? null,
        packagingMaterialUoM: p.packagingMaterialUoM?.unit ?? null,
        packagingMaterialAmount: p.packagingMaterialAmount,
        packagingMaterialUnitPrice: p.packagingMaterialUnitPrice,
        packagingMaterialQuantity: p.packagingMaterialQuantity,
        packagingMaterialTotalWeight: p.packagingMaterialTotalWeight,
      })),
    };

    await this.cacheService.set(cacheKey, formattedChallan, this.CACHE_TTL);
    return formattedChallan;
  }

  

  async getByIdChallanforUpdate(id: string): Promise<ODCUpdateFormDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const challan = await this.challanRepository
      .createQueryBuilder('challan')
      .leftJoin('challan.deliveryChallanProducts', 'products')
      .leftJoin('products.productName', 'productName')
      .leftJoin('products.variant', 'variant')
      .leftJoin('products.packagingMaterial', 'packagingMaterial')
      .leftJoin('products.packagingMaterialUoM', 'packagingMaterialUoM')
      .leftJoin('products.saleUoM', 'saleUoM')
      .leftJoin('challan.companyName', 'company')
      .leftJoin('challan.customerAddress', 'customerAddress')
      .leftJoin('challan.offices', 'office')
      .leftJoin('challan.grnNo', 'grn')
      .leftJoin('challan.fromLocation', 'fromLocation')
      .select([
        'challan.id', 'challan.challanNo', 'challan.transitInsuranceNo', 'challan.rmn',
        'challan.driverName', 'challan.contactNo', 'challan.altContactNo',
        'challan.vehicleNo', 'challan.licenseNo', 'challan.receiverName',
        'challan.totalProductAmount', 'challan.netProductWeight',
        'challan.netPackagingMaterialWeight', 'challan.totalPackagingMaterialAmount',
        'challan.totalAmtInWords', 'challan.requestingDepartment', 'challan.approvalStatus',
        'challan.remark', 'challan.anyAttachment', 'challan.createdAt',
        'challan.customer', 'challan.customerContactNo', 'challan.customerEmail',
        'company.id', 'office.id', 'grn.id', 'fromLocation.id',
        'customerAddress.id', 'customerAddress.address1', 'customerAddress.address2',
        'customerAddress.location', 'customerAddress.city', 'customerAddress.state', 'customerAddress.pincode',
        'products.id', 'products.quantity', 'products.unitPrice', 'products.amount',
        'products.netWeight', 'products.grossWeight', 'products.packingMaterialWeight',
        'products.packagingMaterialAmount', 'products.packagingMaterialUnitPrice',
        'products.packagingMaterialQuantity', 'products.packagingMaterialTotalWeight',
        'productName.id', 'variant.id',
        'saleUoM.id', 'packagingMaterial.id', 'packagingMaterialUoM.id',
      ])
      .where('challan.id = :id', { id })
      .getOne();

    if (!challan) return null;

    const { createdDate, createdTime } = formatDateTime(challan.createdAt);
    const addr = (challan as any).customerAddress;

    const formattedChallan = {
      id: challan.id,
      challanNo: challan.challanNo,
      companyName: challan.companyName?.id ?? null,
      office: challan.offices?.id ?? null,
      grnNo: challan.grnNo?.id ?? null,
      fromLocation: challan.fromLocation?.id ?? null,
      rmn: challan.rmn ?? null,
      driverName: challan.driverName ?? null,
      contactNo: challan.contactNo ?? null,
      altContactNo: challan.altContactNo ?? null,
      vehicleNo: challan.vehicleNo ?? null,
      licenseNo: challan.licenseNo ?? null,
      receiverName: challan.receiverName ?? null,
      transitInsuranceNo: challan.transitInsuranceNo ?? null,
      totalProductAmount: challan.totalProductAmount ?? null,
      netProductWeight: challan.netProductWeight ?? null,
      netPackagingMaterialWeight: challan.netPackagingMaterialWeight ?? null,
      totalPackagingMaterialAmount: challan.totalPackagingMaterialAmount ?? null,
      totalAmtInWords: challan.totalAmtInWords ?? null,
      requestingDepartment: challan.requestingDepartment ?? null,
      approvalStatus: challan.approvalStatus ?? null,
      remark: challan.remark ?? null,
      anyAttachment: challan.anyAttachment ?? null,
      createdDate,
      createdTime,
      customer: (challan as any).customer ?? null,
      customerContactNo: (challan as any).customerContactNo ?? null,
      customerEmail: (challan as any).customerEmail ?? null,
      customerAddress: addr ? {
        id: addr.id, address1: addr.address1, address2: addr.address2,
        location: addr.location, city: addr.city, state: addr.state, pincode: addr.pincode,
      } : null,
      deliveryChallanProducts: (challan.deliveryChallanProducts ?? []).map((p) => ({
        id: p.id,
        productName: p.productName?.id ?? null,
        variant: p.variant?.id ?? null,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        amount: p.amount,
        netWeight: p.netWeight,
        grossWeight: p.grossWeight,
        packingMaterialWeight: p.packingMaterialWeight ?? null,
        saleUoM: p.saleUoM?.id ?? null,
        packagingMaterial: p.packagingMaterial?.id ?? null,
        packagingMaterialUoM: p.packagingMaterialUoM?.id ?? null,
        packagingMaterialAmount: p.packagingMaterialAmount,
        packagingMaterialUnitPrice: p.packagingMaterialUnitPrice,
        packagingMaterialQuantity: p.packagingMaterialQuantity,
        packagingMaterialTotalWeight: p.packagingMaterialTotalWeight,
      })),
    };

    await this.cacheService.set(cacheKey, formattedChallan, this.CACHE_TTL);
    return formattedChallan;
  }


  
  async getAll(queryOptions: PaginationOptions, userId: string): Promise<ODCListResponseDto> {
    const hash = createHash('md5').update(`${userId}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:list:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { data, meta } = await this.docDoubleApproverService.getAllDocumentByUserIdForDoubleApprover(
      userId,
      DocumentTypeEnum.DC_TYPE_OTHER,
      queryOptions,
    );

    const typedDocuments = data as DocumentWithRelatedData[];

    const challanIds = typedDocuments
      .map((doc) => doc.document_type_id)
      .filter(Boolean) as string[];

    let challanMap = new Map<string, any>();
    if (challanIds.length > 0) {
      const challans = await this.challanRepository
        .createQueryBuilder('challan')
        .leftJoin('challan.companyName', 'company')
        .leftJoin('challan.offices', 'office')
        .leftJoin('challan.grnNo', 'grn')
        .leftJoin('challan.fromLocation', 'fromLocation')
        .leftJoin('challan.customerAddress', 'customerAddress')
        .select([
          'challan.id', 'challan.challanNo', 'challan.transitInsuranceNo', 'challan.rmn',
          'challan.driverName', 'challan.contactNo', 'challan.altContactNo',
          'challan.vehicleNo', 'challan.licenseNo', 'challan.receiverName',
          'challan.totalProductAmount', 'challan.netProductWeight',
          'challan.netPackagingMaterialWeight', 'challan.totalPackagingMaterialAmount',
          'challan.totalAmtInWords', 'challan.requestingDepartment', 'challan.approvalStatus',
          'challan.remark', 'challan.anyAttachment',
          'challan.customer', 'challan.customerContactNo', 'challan.customerEmail',
          'company.name', 'office.name', 'grn.grnNo', 'fromLocation.name',
          'customerAddress.address1', 'customerAddress.address2', 'customerAddress.location',
          'customerAddress.city', 'customerAddress.state', 'customerAddress.pincode',
        ])
        .where('challan.id IN (:...ids)', { ids: challanIds })
        .andWhere('challan.isDeleted = false')
        .andWhere('challan.deletedAt IS NULL')
        .getMany();

      challanMap = new Map(challans.map((c) => [c.id, c]));
    }

    const relatedDataOnly = typedDocuments
      .filter((doc) => doc.document_type_id && challanMap.has(doc.document_type_id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((doc) => {
        const rd = challanMap.get(doc.document_type_id!);
        if (!rd) return null;
        const { createdDate, createdTime } = formatDateTime(doc.createdAt);
        const addr = (rd as any).customerAddress;
        return {
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: `${doc.lastActionBy?.firstName ?? ''} ${doc.lastActionBy?.lastName ?? ''}`.trim(),
          createdDate,
          createdTime,
          id: rd.id,
          challanNo: rd.challanNo,
          companyName: rd.companyName?.name ?? null,
          office: rd.offices?.name ?? null,
          grnNo: rd.grnNo?.grnNo ?? null,
          fromLocation: rd.fromLocation?.name ?? null,
          customer: (rd as any).customer ?? null,
          customerContactNo: (rd as any).customerContactNo ?? null,
          customerEmail: (rd as any).customerEmail ?? null,
          rmn: rd.rmn ?? null,
          customerAddress: addr
            ? [addr.address1, addr.address2, addr.location, addr.city, addr.state, addr.pincode]
                .filter(Boolean).join(' ')
            : null,
          driverName: rd.driverName ?? null,
          contactNo: rd.contactNo ?? null,
          altContactNo: rd.altContactNo ?? null,
          vehicleNo: rd.vehicleNo ?? null,
          licenseNo: rd.licenseNo ?? null,
          receiverName: rd.receiverName ?? null,
          transitInsuranceNo: rd.transitInsuranceNo ?? null,
          totalProductAmount: rd.totalProductAmount ?? null,
          netProductWeight: rd.netProductWeight ?? null,
          netPackagingMaterialWeight: rd.netPackagingMaterialWeight ?? null,
          totalPackagingMaterialAmount: rd.totalPackagingMaterialAmount ?? null,
          totalAmtInWords: rd.totalAmtInWords ?? null,
          requestingDepartment: rd.requestingDepartment ?? null,
          approvalStatus: rd.approvalStatus ?? null,
          remark: rd.remark ?? null,
          anyAttachment: rd.anyAttachment ?? null,
        };
      })
      .filter(Boolean);

    const result = {
      data: relatedDataOnly as ODCListResponseDto['data'],
      meta: { total: meta.total, page: meta.page, pages: meta.pages },
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  async update(id: string, data: UpdateODCDto & Record<string, any>): Promise<OtherDeliveryChallan | null> {
    try {
      const challan = await this.challanRepository.findOne({ where: { id } });
      if (!challan) return null;

      Object.assign(challan, data);
      const saved = await this.challanRepository.save(challan);
      await this.invalidateCache(id);
      return saved;
    } catch (err) {
      logger.error(`Error updating other delivery challan with ID: ${id}`, {
        error: err,
      });
      return null;
    }
  }

  async delete(id: string): Promise<DeleteResultDto | null> {
   const chalan=await this.challanRepository.findOne({where:{id}});
   if (!chalan) throw new AppError(404, `AQR with ID ${id} not found`);
    try {
      const result = await this.challanRepository.softDelete(id);
      await this.challanRepository.update(id, { isDeleted: true } as any);
      if (result.affected !== 0) await this.invalidateCache(id);
      //return result.affected !== 0;
    } catch (err) {
      logger.error(`Error deleting other delivery challan with ID: ${id}`, {
        error: err,
      });
      
    }
    return {No:chalan.challanNo};
  }

  public async deleteMultipleOtherDeliveryChallans(ids: string[]): Promise<BulkDeleteResultDto> {
     const success: { id: string; No: string }[] = [];
    const failed: { id: string; reason: string }[] = [];

    for (const id of ids) {
      try {
        const challan = await this.challanRepository.findOne({ where: { id } });
        if (!challan) {
          failed.push({ id, reason: 'Other Delivery Challan not found' });
          continue;
        }

        // Soft delete related document
        const relatedDocument = await this.documentbRepository.findOne({
          where: { document_type_id: challan.id },
        });
        if (relatedDocument) {
          await this.documentbRepository.softDelete(relatedDocument.id);
          await this.documentbRepository.update(relatedDocument.id, { isDeleted: true } as any);
        }

        // Soft delete challan
        await this.challanRepository.softDelete(challan.id);
        await this.challanRepository.update(challan.id, { isDeleted: true } as any);

        await this.invalidateCache(id);
        success.push({id,No:challan.challanNo});
      } catch (error: any) {
        failed.push({ id, reason: error.message || 'Unknown error' });
      }
    }

    const message = `Deletion completed. Success: ${success.length}, Failed: ${failed.length}`;
    return { success, failed, message };
  }
}


  // async getById(id: string): Promise<{ data: any } | null> {
  //   const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
  //   const cached = await this.cacheService.get<any>(cacheKey);
  //   if (cached) return cached;

  //   try {
  //     const result = await this.challanRepository.findOne({
  //       where: { id },
  //       relations: [
  //         'deliveryChallanProducts',
  //         'deliveryChallanProducts.productName',
  //         'deliveryChallanProducts.packagingMaterial',
  //         'deliveryChallanProducts.packagingMaterialUoM',
  //         'deliveryChallanProducts.saleUoM',
  //         'companyName',
  //         'offices',
  //         'grnNo',
  //         'fromLocation',
  //       ],
  //     });
  //     if (!result) return null;
  //     const wrapped = { data: result };
  //     await this.cacheService.set(cacheKey, wrapped, this.CACHE_TTL);
  //     return wrapped;
  //   } catch (err) {
  //     logger.error(`Error fetching other delivery challan by ID: ${id}`, {
  //       error: err,
  //     });
  //     return null;
  //   }
  // }

