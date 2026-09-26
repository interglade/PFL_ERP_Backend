import { inject, injectable } from 'inversify';
import { TYPES } from '../../../types';
import { StockTransferDeliveryChallanRepository } from '../repository/stockTransferDeliveryChallan.repository';
import logger from '../../../utils/logger';
import { buildQuery, PaginationOptions } from '../../../utils/pagination';
import { formatDateTime } from '../../../utils/dateUtils';
import { DocumentTypeEnum } from '../../../approvalFlow/entity/docuemnt.entity';
import { DocumentStatus } from '../../../approvalFlow/entity/docuemnt.entity';

import { ProductVarientsRepository } from '../../../product/productVarient/repository/productVarients.repository';

import { ProductRepository } from '../../../product/createproduct/repository/product.repository';
import { InventoryStockRepository } from '../../../inventoryStock/repository/inventoryStock.repository';
import { DitemRepository } from '../../deliverychllan/repository/dItem.repository';
import { custom } from 'zod';
import { DocumentTypeEnum as DocDefEnum } from '../../../documentDef/entity/documentdef.entity';
import { DataSource, In } from 'typeorm';
import { CustomerDeliveryChallanService } from '../../customerDeliveryChllan/service/customerDeliveryChallan.service';
import { CacheService } from '../../../global/cache.service';

import { BulkDeleteResultDto, DeleteResultDto } from '../../../global/general.dto';
import { result } from 'lodash';
import AppError from '../../../utils/appError';
import { DocumentbService, DocumentWithRelatedData } from '../../../approvalFlow/service/documentb.service';
import { DocDoubleApproverService } from '../../../approvalFlow/service/docDoubleApprover.service';
import { DeliveryChallanService } from '../../deliverychllan/service/deliveryChallan.service';
import { ApprovalFlowService } from '../../../approvalFlow/service/approvalFlow.service';
import { ProductVarientService } from '../../../product/productVarient/service/productVarient.service';
import { DocumentbRepository } from '../../../approvalFlow/repository/documentb.repository';
import { CreateSTDeliveryChallanDto, STDeliveryChallanListResponseDto, STDeliveryChallanUpdateFormDto, STDeliveryChallanViewDto, UpdateSTDeliveryChallanDto } from '../dto/stockTransferDeliveryChallan.dto';
import { StockTransferDeliveryChallan } from '../entity/stockTransferdeliveryChallan.entity';


@injectable()
export class StockTransferDeliveryChallanService {
  constructor(
    @inject(TYPES.StockTransferDeliveryChallanRepository)
    private readonly challanRepository: StockTransferDeliveryChallanRepository,
    @inject(TYPES.DocumentbService)
            private readonly documentbService: DocumentbService,
            @inject(TYPES.DocDoubleApproverService)
                private readonly docDoubleApproverService: DocDoubleApproverService,
                @inject(TYPES.DeliveryChallanService)
                private readonly deliveryChallanService: DeliveryChallanService,
                @inject(TYPES.ApprovalFlowService)
    private approvalFlowService: ApprovalFlowService,
    @inject(TYPES.ProductVarientsRepository)
        private readonly variantRepository: ProductVarientsRepository,
        @inject(TYPES.ProductVarientService)
        private readonly productVarientService: ProductVarientService,
          @inject(TYPES.InventoryStockRepository)
            private readonly inventoryStockRepository: InventoryStockRepository,
            @inject(TYPES.DitemRepository)
            private readonly deliveryChallanProductRepository: DitemRepository,
            @inject(TYPES.DocumentbRepository)
            private readonly documentbRepository: DocumentbRepository,
        @inject(TYPES.CustomerDeliveryChallanService)
    private readonly customerDeliveryChallanService:CustomerDeliveryChallanService,
        @inject(TYPES.ProductRepository)
        private readonly productRepository: ProductRepository,
        @inject(TYPES.DataSource)
        private readonly dataSource: DataSource,
        @inject(TYPES.CacheService)
        private readonly cacheService: CacheService,
  ) {}

  private readonly CACHE_PREFIX = 'stockTransferChallan';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${this.CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:update:${id}`),
        // The view cache is keyed by the Documentb id (the /view/:docid route
        // param), not by this record's own id, so it can only be busted by
        // pattern from here.
        this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:view:*`),
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

 async create(data: CreateSTDeliveryChallanDto & Record<string, any>, requestedBy: string): Promise<StockTransferDeliveryChallan> {
  // Check if approval flow exists for the user
  await this.checkApprovalFlowExists(requestedBy, DocDefEnum.OPERATION);

  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // 1. Approval flow check
    // const approvalFlowExit =
    //   await this.approvalFlowService.findApprovalFlowForLoggedUser(
    //     requestedBy,
    //     'DC_TYPE_STOCK_TRANSFER'
    //   );

    // if (!approvalFlowExit) {
    //   throw new Error('Approval flow not found for user');
    // }

    data.challanNo = await this.customerDeliveryChallanService.generateVoucherNo(data.type || 'S');

    // 3. Save challan
    const challan = queryRunner.manager.create(this.challanRepository.target, data as any) as unknown as StockTransferDeliveryChallan;
    const savedChallanArr = await queryRunner.manager.save(challan);
    const savedChallan = Array.isArray(savedChallanArr)
      ? savedChallanArr[0]
      : savedChallanArr;

    // 4. Create document
    const document = await this.documentbService.createDocument({
      type: DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER,
      docDef: DocDefEnum.OPERATION,
      status: DocumentStatus.HOLD,
      remarks: 'Document auto-created with Stock Transfer Challan',
      lastActionBy: { id: requestedBy },
      document_type_id: savedChallan.id,
    });

    // -------------------------------------------------------------------
    // 5. Inventory is NOT touched here.
    //    Stock is reduced at the FROM location only when this challan's
    //    document reaches DocumentStatus.COMPLETE — see
    //    InventoryMovementService.applyStockTransferDeliveryChallan().
    //
    //    The TO-location increase is still out of scope: it comes from a
    //    separate Inward Register raised against this challan.
    // -------------------------------------------------------------------

    // Commit transaction - all operations succeeded
    await queryRunner.commitTransaction();

    // Start approval flow after commit so challan is visible to other DB connections
    await this.documentbService.startApprovalFlow(document.id);

    await this.invalidateCache();
    return savedChallan;
  } catch (error) {
    // Rollback transaction - undo all changes
    await queryRunner.rollbackTransaction();
    logger.error('Error creating Stock Transfer:', error);
    throw error;
  } finally {
    // Release query runner
    await queryRunner.release();
  }
}




  async getByIdChallanforUpdate(id: string): Promise<STDeliveryChallanUpdateFormDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    try {
      const challan = await this.challanRepository
        .createQueryBuilder('challan')
        .leftJoin('challan.deliveryChallanProducts', 'products')
        .leftJoin('products.productName', 'productName')
        .leftJoin('products.variant', 'variant')
        .leftJoin('products.uom', 'uom')
        .leftJoin('products.packagingMaterial', 'packagingMaterial')
        .leftJoin('products.packagingMaterialUoM', 'packagingMaterialUoM')
        .leftJoin('products.saleUoM', 'saleUoM')
        .leftJoin('challan.companyName', 'company')
        .leftJoin('challan.offices', 'office')
        .leftJoin('challan.grnNo', 'grn')
        .leftJoin('challan.fromLocation', 'fromLocation')
        .leftJoin('challan.toLocation', 'toLocation')
        .select([
          'challan.id', 'challan.challanNo', 'challan.stockTransferType', 'challan.transitInsuranceNo',
          'challan.driverName', 'challan.contactNo', 'challan.altContactNo',
          'challan.vehicleNo', 'challan.licenseNo', 'challan.receiverName', 'challan.rmn',
          'challan.totalProductAmount', 'challan.netProductWeight',
          'challan.netPackagingMaterialWeight', 'challan.totalPackagingMaterialAmount',
          'challan.totalAmtInWords', 'challan.requestingDepartment', 'challan.approvalStatus',
          'challan.remark', 'challan.anyAttachment', 'challan.createdAt',
          'company.id', 'office.id', 'grn.id', 'fromLocation.id', 'toLocation.id',
          'products.id', 'products.quantity', 'products.unitPrice', 'products.amount',
          'products.grossWeight', 'products.packingMaterialWeight', 'products.netWeight',
          'products.packagingMaterialAmount', 'products.packagingMaterialUnitPrice',
          'products.packagingMaterialQuantity', 'products.packagingMaterialTotalWeight',
          'productName.id', 'variant.id', 'uom.id',
          'saleUoM.id', 'packagingMaterial.id', 'packagingMaterialUoM.id',
        ])
        .where('challan.id = :id', { id })
        .getOne();

      if (!challan) {
        logger.warn(`No stock transfer challan found with ID: ${id}`);
        return null;
      }

      const { createdDate, createdTime } = formatDateTime(challan.createdAt);

      const formattedChallan = {
        id: challan.id,
        challanNo: challan.challanNo,
        stockTransferType: challan.stockTransferType ?? null,
        companyName: challan.companyName?.id ?? null,
        office: challan.offices?.id ?? null,
        grnNo: challan.grnNo?.id ?? null,
        fromLocation: challan.fromLocation?.id ?? null,
        toLocation: challan.toLocation?.id ?? null,
        driverName: challan.driverName ?? null,
        contactNo: challan.contactNo ?? null,
        altContactNo: challan.altContactNo ?? null,
        vehicleNo: challan.vehicleNo ?? null,
        licenseNo: challan.licenseNo ?? null,
        receiverName: challan.receiverName ?? null,
        totalProductAmount: challan.totalProductAmount ?? null,
        netProductWeight: challan.netProductWeight ?? null,
        netPackagingMaterialWeight: challan.netPackagingMaterialWeight ?? null,
        totalPackagingMaterialAmount: challan.totalPackagingMaterialAmount ?? null,
        totalAmtInWords: challan.totalAmtInWords ?? null,
        transitInsuranceNo: challan.transitInsuranceNo ?? null,
        rmn: challan.rmn ?? null,
        requestingDepartment: challan.requestingDepartment ?? null,
        approvalStatus: challan.approvalStatus ?? null,
        remark: challan.remark ?? null,
        anyAttachment: challan.anyAttachment ?? null,
        createdDate,
        createdTime,
        deliveryChallanProducts: (challan.deliveryChallanProducts ?? []).map((p) => ({
          id: p.id,
          productName: p.productName?.id ?? null,
          variant: p.variant?.id ?? null,
          uom: p.uom?.id ?? null,
          quantity: p.quantity,
          unitPrice: p.unitPrice,
          amount: p.amount,
          grossWeight: p.grossWeight,
          packingMaterialWeight: p.packingMaterialWeight ?? null,
          netWeight: p.netWeight,
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
    } catch (err) {
      logger.error(`Error fetching stock transfer challan for update by ID: ${id}`, { error: err });
      return null;
    }
  }

  
public async deleteMultipleDCForStockTransfer(ids: string[]): Promise<BulkDeleteResultDto> {
  const success: { id: string; No: string }[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      const dcForStockTransfer = await this.challanRepository.findOne({
        where: { id },
      });
      if (!dcForStockTransfer) {
        failed.push({ id, reason: 'DC for Stock Transfer not found' });
        continue;
      }
      const relatedDocument = await this.documentbRepository.findOne({
        where: { document_type_id: dcForStockTransfer.id }
      });

      if (relatedDocument) {
        await this.documentbRepository.softDelete(relatedDocument.id);
        await this.documentbRepository.update(relatedDocument.id, { isDeleted: true } as any);
      }

      await this.challanRepository.softDelete(dcForStockTransfer.id);
      await this.challanRepository.update(dcForStockTransfer.id, { isDeleted: true } as any);
      await this.invalidateCache(id);
      success.push({id,No:dcForStockTransfer.challanNo});
    } catch (error: any) {
      failed.push({ id, reason: error.message || 'Unknown error' });
    }
  }
  const message = `Deletion completed. Success: ${success.length}, Failed: ${failed.length}`;
  await this.invalidateCache();
  return { success, failed, message };
}


  async getByIdChallanforView(docId: string): Promise<STDeliveryChallanViewDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:view:${docId}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    try {
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
        .leftJoin('challan.offices', 'office')
        .leftJoin('challan.grnNo', 'grn')
        .leftJoin('challan.fromLocation', 'fromLocation')
        .leftJoin('challan.toLocation', 'toLocation')
        .select([
          'challan.id', 'challan.challanNo', 'challan.stockTransferType', 'challan.transitInsuranceNo',
          'challan.driverName', 'challan.contactNo', 'challan.altContactNo',
          'challan.vehicleNo', 'challan.licenseNo', 'challan.receiverName',
          'challan.totalProductAmount', 'challan.netProductWeight',
          'challan.netPackagingMaterialWeight', 'challan.totalPackagingMaterialAmount',
          'challan.totalAmtInWords', 'challan.requestingDepartment',
          'challan.remark', 'challan.anyAttachment', 'challan.createdAt',
          'company.name', 'office.name', 'grn.grnNo',
          'fromLocation.name', 'toLocation.name',
          'products.id', 'products.quantity', 'products.unitPrice', 'products.amount',
          'products.grossWeight', 'products.netWeight', 'products.packingMaterialWeight',
          'products.packagingMaterialAmount', 'products.packagingMaterialUnitPrice',
          'products.packagingMaterialQuantity', 'products.packagingMaterialTotalWeight',
          'productName.name', 'variant.variantName',
          'saleUoM.unit', 'packagingMaterial.packagingMaterialName', 'packagingMaterialUoM.unit',
        ])
        .where('challan.id = :id', { id })
        .getOne();

      if (!challan) {
        logger.warn(`No stock transfer challan found with ID: ${id}`);
        return null;
      }

      const { createdDate, createdTime } = formatDateTime(challan.createdAt);

      const formattedChallan = {
        id: challan.id,
        documentId: document.id,
        challanNo: challan.challanNo,
        stockTransferType: challan.stockTransferType ?? null,
        companyName: challan.companyName?.name ?? null,
        transitInsuranceNo: challan.transitInsuranceNo ?? null,
        office: challan.offices?.name ?? null,
        grnNo: challan.grnNo?.grnNo ?? null,
        fromLocation: challan.fromLocation?.name ?? null,
        toLocation: challan.toLocation?.name ?? null,
        driverName: challan.driverName ?? null,
        contactNo: challan.contactNo ?? null,
        altContactNo: challan.altContactNo ?? null,
        vehicleNo: challan.vehicleNo ?? null,
        licenseNo: challan.licenseNo ?? null,
        receiverName: challan.receiverName ?? null,
        totalProductAmount: challan.totalProductAmount ?? null,
        netProductWeight: challan.netProductWeight ?? null,
        netPackagingMaterialWeight: challan.netPackagingMaterialWeight ?? null,
        totalPackagingMaterialAmount: challan.totalPackagingMaterialAmount ?? null,
        totalAmtInWords: challan.totalAmtInWords ?? null,
        requestingDepartment: challan.requestingDepartment ?? null,
        remark: challan.remark ?? null,
        anyAttachment: challan.anyAttachment ?? null,
        createdDate,
        createdTime,
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
          grossWeight: p.grossWeight,
          netWeight: p.netWeight,
          packingMaterialWeight: p.packingMaterialWeight ?? null,
          saleUoM: p.saleUoM?.unit ?? null,
          packingMaterial: p.packagingMaterial?.packagingMaterialName ?? null,
          packagingMaterialUoM: p.packagingMaterialUoM?.unit ?? null,
          packagingMaterialAmount: p.packagingMaterialAmount,
          packagingMaterialUnitPrice: p.packagingMaterialUnitPrice,
          packagingMaterialQuantity: p.packagingMaterialQuantity,
          packagingMaterialTotalWeight: p.packagingMaterialTotalWeight,
        })),
      };

      await this.cacheService.set(cacheKey, formattedChallan, this.CACHE_TTL);
      return formattedChallan;
    } catch (err) {
      logger.error(`Error fetching stock transfer challan for view by ID: ${docId}`, { error: err });
      return null;
    }
  }

  async getAll(queryOptions: PaginationOptions, userId: string): Promise<STDeliveryChallanListResponseDto> {
    const cacheKey = `${this.CACHE_PREFIX}:list:${userId}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const { data, meta } = await this.docDoubleApproverService.getAllDocumentByUserIdForDoubleApprover(
      userId,
      DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER,
      queryOptions,
    );

    const typedDocuments = data as DocumentWithRelatedData[];
    const activeDocuments = typedDocuments
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // ---- Batch fetch: one query instead of N+1 ----
    const challanIds = activeDocuments
      .map(doc => doc.document_type_id)
      .filter(Boolean) as string[];

    const challans = challanIds.length
      ? await this.challanRepository
          .createQueryBuilder('challan')
          .leftJoin('challan.companyName', 'companyName')
          .leftJoin('challan.fromLocation', 'fromLocation')
          .leftJoin('challan.toLocation', 'toLocation')
          .select([
            'challan.id', 'challan.challanNo', 'challan.transitInsuranceNo',
            'challan.totalProductAmount', 'challan.netProductWeight',
            'challan.netPackagingMaterialWeight', 'challan.totalPackagingMaterialAmount',
            'challan.totalAmtInWords', 'challan.driverName', 'challan.contactNo',
            'challan.altContactNo', 'challan.vehicleNo', 'challan.licenseNo',
            'challan.rmn', 'challan.receiverName', 'challan.anyAttachment',
            'challan.remark', 'challan.requestingDepartment', 'challan.approvalStatus',
            'challan.stockTransferType',
            'companyName.name', 'fromLocation.name', 'toLocation.name',
          ])
          .where('challan.id IN (:...ids)', { ids: challanIds })
          .andWhere('challan.isDeleted = false')
          .andWhere('challan.deletedAt IS NULL')
          .getMany()
      : [];

    const challanMap = new Map(challans.map(c => [c.id, c]));

    const relatedDataOnly = activeDocuments
      .filter(doc => doc.document_type_id && challanMap.has(doc.document_type_id))
      .map((doc) => {
        const rd: any = challanMap.get(doc.document_type_id!)!;
        return {
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: `${doc.lastActionBy?.firstName ?? ''} ${doc.lastActionBy?.lastName ?? ''}`.trim(),
          createdDate: formatDateTime(doc.createdAt).createdDate,
          createdTime: formatDateTime(doc.createdAt).createdTime,
          id: rd.id,
          challanNo: rd.challanNo,
          transitInsuranceNo: rd.transitInsuranceNo ?? null,
          totalProductAmount: rd.totalProductAmount,
          netProductWeight: rd.netProductWeight,
          netPackagingMaterialWeight: rd.netPackagingMaterialWeight,
          totalPackagingMaterialAmount: rd.totalPackagingMaterialAmount,
          totalAmtInWords: rd.totalAmtInWords,
          driverName: rd.driverName,
          contactNo: rd.contactNo,
          altContactNo: rd.altContactNo ?? null,
          vehicleNo: rd.vehicleNo,
          licenseNo: rd.licenseNo,
          rmn: rd.rmn ?? null,
          receiverName: rd.receiverName,
          anyAttachment: rd.anyAttachment ?? null,
          remark: rd.remark ?? null,
          requestingDepartment: rd.requestingDepartment ?? null,
          approvalStatus: rd.approvalStatus ?? null,
          stockTransferType: rd.stockTransferType ?? null,
          companyName: rd.companyName?.name ?? null,
          fromLocation: rd.fromLocation?.name ?? null,
          toLocation: rd.toLocation?.name ?? null,
        };
      });

    // 🔄 Sorting
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
    }

    const result = {
      data: relatedDataOnly,
      meta: {
        total: meta.total,
        page: meta.page,
        totalPages: meta.pages,
      },
    };

    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  async update(id: string, data: UpdateSTDeliveryChallanDto & Record<string, any>): Promise<StockTransferDeliveryChallan | null> {
    try {
      const challan = await this.challanRepository.findOne({ where: { id } });
      if (!challan) return null;

      Object.assign(challan, data);
      const saved = await this.challanRepository.save(challan);
      await this.invalidateCache(id);
      return saved;
    } catch (err) {
      logger.error(`Error updating stock transfer challan with ID: ${id}`, {
        error: err,
      });
      return null;
    }
  }

  async delete(id: string): Promise<DeleteResultDto | null> {
   
   const stock=await this.challanRepository.findOne({where:{id}});
    if(!stock) throw new AppError(404,`Stock with Id ${id} not found`);
    try {
      const result = await this.challanRepository.delete(id);
      if (result.affected !== 0) await this.invalidateCache(id);
     // return result.affected !== 0;
    } catch (err) {
      logger.error(`Error deleting stock transfer challan with ID: ${id}`, {
        error: err,
      });
    }
     return {No:stock.challanNo};
  }
}


  // async getById(id: string): Promise<StockTransferDeliveryChallan | null> {
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
  //         'toLocation',
  //       ],
  //     });
  //     if (result) await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
  //     return result;
  //   } catch (err) {
  //     logger.error(`Error fetching stock transfer challan by ID: ${id}`, { error: err });
  //     return null;
  //   }
  // }

