import { inject, injectable } from 'inversify';
import { TYPES } from '../../types';
import { InwardRepository } from '../repository/inwardRegister.repository';
import { InwardRegister } from '../entity/inwardRegister.entity';
import AppError from '../../utils/appError';

import { LessThanOrEqual, DataSource, SelectQueryBuilder, In, IsNull, ILike, DeepPartial } from 'typeorm';

import { buildQuery, PaginationOptions } from '../../utils/pagination';

import { formatDateTime } from '../../utils/dateUtils';



import { ProductRepository } from '../../product/createproduct/repository/product.repository';
import { InventoryStockRepository } from '../../inventoryStock/repository/inventoryStock.repository';


import { DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { DocumentTypeEnum as DocDefEnum } from '../../documentDef/entity/documentdef.entity';
import { ApprovalFlowService } from '../../approvalFlow/service/approvalFlow.service';

import { InwardProductRepository } from '../repository/inwardProduct.repository';
import { ProductVarientRepository } from '../../product/productVarient/repository/varients.repository';

import { CacheService } from '../../global/cache.service';
import { createHash } from 'crypto';
import {
  CreateInwardRegisterInput,
  InwardRegisterViewDto,
  InwardViewAddressDto,
  InwardViewFarmerPartyDto,
  InwardViewVendorPartyDto,
  InwardViewProductDto,
  InwardRegisterUpdateDto,
  InwardUpdateProductDto,
  InwardRegisterListItemDto,
  InwardRegisterListResultDto,
  UpdateInwardRegisterDto,
} from '../../inwardRegister/dto/inwardRegister.dto';

import { BulkDeleteResultDto, DeleteResultDto } from '../../global/general.dto';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { DocumentbService, DocumentWithRelatedData } from '../../approvalFlow/service/documentb.service';
import { DocSingalApproverService } from '../../approvalFlow/service/DocSingalApproverService.service';
import { DocumentbRepository } from '../../approvalFlow/repository/documentb.repository';


function normalizeDateFormat(date: string | null | undefined): string | null | undefined {
  if (!date) return date;
  const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/;
  const match = date.match(ddmmyyyy);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return date;
}
@injectable()
export class InwardRegisterService {
  constructor(
    @inject(TYPES.InwardRepository)
    private readonly inwardRegisterRepo: InwardRepository,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,

     @inject(TYPES.ProductVarientRepository)
      private productVarientsRepository: ProductVarientRepository,
 

   
    @inject(TYPES.InventoryStockRepository)
    private readonly inventoryStockRepository: InventoryStockRepository,
 
   
     @inject(TYPES.DocSingalApproverService)
        private readonly docSingalApproverService: DocSingalApproverService,
        @inject(TYPES.DocumentbService)
        private readonly documentbService: DocumentbService,
        @inject(TYPES .DocumentbRepository) private documentbRepository: DocumentbRepository,
        @inject(TYPES.DataSource)
        private readonly dataSource: DataSource,
        @inject(TYPES.CacheService)
        private readonly cacheService: CacheService,
        @inject(TYPES.ApprovalFlowService)
        private readonly approvalFlowService: ApprovalFlowService,
  ) {}

  private readonly CACHE_PREFIX = 'iwr';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:recycle:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:all:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:filter:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${this.CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:update:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:get:${id}`),
      );
      // The view cache is keyed by Documentb id (+ userId), not by the inward
      // register id, so it can only be busted by pattern from here.
      tasks.push(this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:view:*`));
    }
    await Promise.all(tasks);
  }

 

  private async generateSerialNo(): Promise<string> {
      const now = new Date();
      const yyyy = now.getFullYear().toString();
      const mm = (now.getMonth() + 1).toString().padStart(2, '0');
      const dd = now.getDate().toString().padStart(2, '0');
      const datePrefix = `IWD${yyyy}${mm}${dd}`;

      // Count only records for today's prefix to get per-day sequence
      const count = await this.inwardRegisterRepo.count({
        where: { inwardNo: ILike(`${datePrefix}%`) },
      });

      const serialNo = `${datePrefix}${(count + 1).toString().padStart(4, '0')}`;
      return serialNo;
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

public async createInwardRegister(data: CreateInwardRegisterInput): Promise<any> {
  // Check if approval flow exists for the user
  await this.checkApprovalFlowExists(data.requestedBy, DocDefEnum.OPERATION);

  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // 1. Normalize variant IDs
    // let variantIds: string[] = [];
    // if (Array.isArray(data.variants)) {
    //   variantIds = data.variants;
    // } else if (data.variants) {
    //   variantIds = [data.variants];
    // }

    // // 2. Fetch variants with product relation
    // const variants = await queryRunner.manager.find(this.productVarientsRepository.target, {
    //   where: { id: In(variantIds) },
    //   relations: ['product'],
    // });

    // // 3. Extract product IDs from variants
    // const productIds = variants.map(v => v.product?.id).filter(Boolean);
const serialNo = await this.generateSerialNo();
    //  data.inwardNo = serialNo;

      const {
  requestedBy,
  variants,
  selectedParty,
  ...entityData
} = data;

      const inwardData: DeepPartial<InwardRegister> = {
  ...entityData,

  inwardNo: serialNo,

  grnNo: data.grnNo
    ? { id: data.grnNo }
    : undefined,

  deliveryChallanNo: data.deliveryChallanNo
    ? { id: data.deliveryChallanNo }
    : undefined,

  rbcNo: data.rbcNo
    ? { id: data.rbcNo }
    : undefined,

  companyName: {
    id: data.companyName,
  },

  location: {
    id: data.location,
  },

  fromLocation: data.fromLocation
    ? { id: data.fromLocation }
    : undefined,

  selectedVendor: data.selectedVendor
    ? { id: data.selectedVendor.id }
    : undefined,

  selectedFarmer: data.selectedFarmer
    ? { id: data.selectedFarmer.id }
    : undefined,

  customerName: data.customerName
    ? { id: data.customerName }
    : undefined,

  purchasedBy: data.purchasedBy
    ? { id: data.purchasedBy }
    : undefined,

  inwardBy: data.inwardBy
    ? { id: data.inwardBy }
    : undefined,

  inwardProducts: data.inwardProducts?.map(item => ({
    productName: item.productName
      ? { id: item.productName }
      : undefined,

    variant: item.variant
      ? { id: item.variant }
      : undefined,

    uom: item.uom
      ? { id: item.uom }
      : undefined,

    packingMaterialWeight: item.packingMaterialWeight,
    quantity: item.quantity,
    weight: item.weight,
    unitPrice: item.unitPrice,
    amount: item.amount,
    netWeight: item.netWeight,
    grossWeight: item.grossWeight,
  })),
};
    // 4. Create Inward Register
    // const inward = queryRunner.manager.create(this.inwardRegisterRepo.target, {
    //   ...entityData,
    //   inwardNo: serialNo,
    //   // variants: variants.map(v => ({ id: v.id })),
    //   // products: productIds.map(id => ({ id })),
    // });

    const inward = queryRunner.manager.create(
  this.inwardRegisterRepo.target,
  inwardData
);

    const savedInward = await queryRunner.manager.save(inward);

    // 5. Auto-create document
    const savedInwardId =
      Array.isArray(savedInward) ? (savedInward[0] as InwardRegister).id : (savedInward as InwardRegister).id;

    const document = await this.documentbService.createDocument({
      type: DocumentTypeEnum.INWARD_REGISTER,
      docDef: DocDefEnum.OPERATION,
      status: DocumentStatus.HOLD,
      remarks: 'Document auto-created with Inward Register',
      lastActionBy: { id: data.requestedBy },
      document_type_id: savedInwardId
    });

    // 6. Inventory is NOT touched here.
    //    Stock is added to inventory_stock only when this Inward Register's
    //    document reaches DocumentStatus.COMPLETE — see
    //    InventoryMovementService.applyInwardRegister().

    // Commit transaction - all operations succeeded
    await queryRunner.commitTransaction();

    // Start approval flow after commit so inward register is visible to other DB connections
    await this.documentbService.startApprovalFlow(document.id);
    await this.invalidateCache();

    return savedInward;

  } catch (error: any) {
    // Rollback transaction - undo all changes
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    // Release query runner
    await queryRunner.release();
  }
}



public async getAllRecycleBinInwardRegisters(queryOptions: PaginationOptions, userId: string): Promise<any> {
    const hash = createHash('md5').update(`${userId}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:recycle:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const data = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(
      userId,
      DocumentTypeEnum.INWARD_REGISTER,
      true, // includeDeleted for recycle bin
    );
    const { search } = queryOptions;
  //  console.log('Fetched documents:', data);
  
    const typedDocuments = data as DocumentWithRelatedData[];
    // Exclude soft-deleted documents
  const activeDocuments = typedDocuments;
  
    // if (typedDocuments.length > 0) {
    //   console.log("doc.relatedData", typedDocuments[0].relatedData);
    // } else {
    //   console.log("No documents found for user.");
    // }
  
    for (const doc of activeDocuments) {
      console.log('doc_id', doc.document_type_id);
      
      if (!doc.document_type_id) continue;
  
      try {
        console.log('---------------------');
        
        doc.relatedData = await this.inwardRegisterRepo.findOne({
          where: { id: doc.document_type_id ,isDeleted:true},
        //  relations: ['grnNo', 'deliveryChallanNo', 'rbcNo', 'companyName', 'location', 'selectedVendor', 'selectedFarmer', 'purchasedBy', 'inwardBy', 'inwardProducts', 'inwardProducts.productName', 'inwardProducts.uom'],
        });
        console.log('Related data fetched for document:', doc.id, doc.relatedData);
        
      } catch (e) {
        console.log("in catch block", e);
        doc.relatedData = null;
      }
    }
 // console.log('Related data fetched for documents:', typedDocuments);
  
    let relatedDataOnly = activeDocuments.map((doc) => {
      const rd = doc.relatedData || {};
      return {
        documentId: doc.id,
        overAllStatus: doc.status,
        createdBy: `${doc.lastActionBy.firstName || null}  ${doc.lastActionBy.lastName || null}`,
        createdDate: formatDateTime(doc.createdAt).createdDate,
        createdTime: formatDateTime(doc.createdAt).createdTime,
        // From relatedData
      id: rd.id || null,
      batchNo: rd.batchNo || null,
      inwardType: rd.inwardType || null,
      remarks: rd.remarks || null,
      // purchasedQty: rd.purchasedQty || null,
      // inwardQtyInKg: rd.inwardQtyInKg || null,
      inwardCost: rd.inwardCost || null,
      totalWeightInKg: rd.totalWeightInKg || null,
      source: rd.source || null,
incomingGrossQty: rd.incomingGrossQty,
      incomingNetQty: rd.incomingNetQty,

      inwardGrossQty: rd.inwardGrossQty,
      inwardNetQty:rd.inwardNetQty,
      grnNo: rd.grnNo?.grnNo || null,
      deliveryChallanNo: rd.deliveryChallanNo?.challanNo || null,
      rbcNo: rd.rbcNo?.rbcNo || null,
      companyName: rd.companyName?.name || null,
      location: rd.location?.name || null,
      vendorName: rd.selectedVendor?.companyName || null,
      farmerName: rd.selectedFarmer?.farmerfName || null,
      purchasedBy: rd.purchasedBy?.name || null,
      inwardBy: rd.inwardBy?.name || null,

      // Products
      inwardProducts: rd.inwardProducts ? rd.inwardProducts.map((p: any) => ({
        productName: p.productName?.name || null,
        grade: p.grade || null,
        quantity: p.quantity || null,
        uom: p.uom?.unit || null,
        unitPrice: p.unitPrice || null,
        amount: p.amount || null,
        purchaseDate: p.purchaseDate || null,
        expectedHarvestDate: p.expectedHarvestDate || null,
        dispatchDate: p.dispatchDate || null,
        deliveryDate: p.deliveryDate || null,
        count: p.count || null,
        size: p.size || null,
        origin: p.origin || null,
        variety: p.variety || null,
      })) : [],
      };
    });
   // 🔍 Deep Search
  const objectToString = (obj: any): string => {
    if (obj == null) return '';
    if (typeof obj === 'object') {
      return Object.values(obj).map((v) => objectToString(v)).join(' ');
    }
    return String(obj);
  };

  if (search && search.trim()) {
    const term = search.toLowerCase();
    relatedDataOnly = relatedDataOnly.filter((item) =>
      objectToString(item).toLowerCase().includes(term)
    );
  }
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

      if (!isNaN(valA) && !isNaN(valB)) {
        return (Number(valA) - Number(valB)) * sortOrder;
      }
      return String(valA).localeCompare(String(valB)) * sortOrder;
    });
  }

    const recycleResult = {
      data: relatedDataOnly,
      meta: {
        total: relatedDataOnly.length,
        page: queryOptions.page || 1,
        pages: Math.ceil(relatedDataOnly.length / (queryOptions.limit || 10)),
      }
    };
    await this.cacheService.set(cacheKey, recycleResult, this.CACHE_TTL);
    return recycleResult;
  } 



      // Save Inward Product line
      // const inwardProduct = this.inwardProductRepository.create({
      //   count,
      //   size,
      //   variety,
      //   origin,
      //   quantity,
      //   unitPrice,
      //   netWeight,
      //   grossWeight,
      //   amount,
      //   product: variant.productTemplate,
      //   variant,
      //   inwardRegister: savedInward,
      // });

      // await queryRunner.manager.save(inwardProduct);
  // // Step 3: Save inward product line item
  // const inwardProduct = this.inwardProductRepository.create({
  //   ...rest,
  //   count,
  //   size,
  //   variety,
  //   origin,
  //   quantity,
  //   unitPrice,
  //   product: variant.productTemplate,
  //   variant,
  //   inwardRegister: savedInward1,
  // });
  // // Step 3: Save inward product line item
  // const inwardProduct = this.inwardProductRepository.create({
  //   ...rest,
  //   count,
  //   size,
  //   variety,
  //   origin,
  //   quantity,
  //   unitPrice,
  //   product: variant.productTemplate,
  //   variant,
  //   inwardRegister: savedInward1,
  // });

  // await queryRunner.manager.save(inwardProduct);




async getInwardidforupdate(id: string, userId: string): Promise<InwardRegisterUpdateDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<InwardRegisterUpdateDto>(cacheKey);
    if (cached) return cached;

    const inwardRegister = await this.inwardRegisterRepo
      .createQueryBuilder('ir')
      .leftJoin('ir.grnNo', 'grnNo')
      .leftJoin('ir.location', 'location')
      .leftJoin('ir.fromLocation', 'fromLocation')
      .leftJoin('ir.companyName', 'companyName')
      .leftJoin('ir.deliveryChallanNo', 'deliveryChallanNo')
      .leftJoin('ir.rbcNo', 'rbcNo')
      .leftJoin('ir.selectedVendor', 'selectedVendor')
      .leftJoin('ir.selectedFarmer', 'selectedFarmer')
      .leftJoin('ir.inwardBy', 'inwardBy')
      .leftJoin('ir.purchasedBy', 'purchasedBy')
      .leftJoin('ir.inwardProducts', 'inwardProducts')
      .leftJoin('inwardProducts.productName', 'productName')
      .leftJoin('inwardProducts.uom', 'uom')
      .leftJoin('inwardProducts.variant', 'variant')
      .leftJoin('ir.customerName','customer')
      .select([
        'ir.id', 'ir.inwardType', 'ir.batchNo', 'ir.source', 'ir.date',
        'ir.totalWeightInKg', 'ir.incomingGrossQty', 'ir.incomingNetQty',
        'ir.inwardGrossQty', 'ir.inwardNetQty', 'ir.inwardCost', 'ir.remarks', 'ir.createdAt',
        'grnNo.id', 'location.id', 'fromLocation.id', 'companyName.id',
        'deliveryChallanNo.id', 'rbcNo.id',
        'selectedVendor.id', 'selectedFarmer.id',
        'inwardBy.id', 'purchasedBy.id',
        'inwardProducts.id', 'inwardProducts.grossWeight', 'inwardProducts.netWeight',
        'inwardProducts.weight', 'inwardProducts.packingMaterialWeight',
        'inwardProducts.quantity', 'inwardProducts.unitPrice', 'inwardProducts.amount',
        'productName.id','productName.name','productName.productCode', 'uom.id', 'variant.id',
        'variant.variantName','variant.variantCode',
        'customer.id','customer.organisationName'
      ])
      .where('ir.id = :id', { id })
      .getOne();

    if (!inwardRegister) return null;

    const { createdDate, createdTime } = formatDateTime(inwardRegister.createdAt);

    const selectedParty = inwardRegister.source === 'farmer' && inwardRegister.selectedFarmer
      ? inwardRegister.selectedFarmer.id
      : inwardRegister.source === 'vendor' && inwardRegister.selectedVendor
      ? inwardRegister.selectedVendor.id
      : null;

    const transformedInwardRegister: InwardRegisterUpdateDto = {
      id: inwardRegister.id,
      createdDate,
      createdTime,
      inwardType: inwardRegister.inwardType,
      companyName: inwardRegister.companyName?.id ?? null,
      location: inwardRegister.location?.id ?? null,
      fromLocation: inwardRegister.fromLocation?.id ?? null,
      date: inwardRegister.date,
      batchNo: inwardRegister.batchNo,
      source: inwardRegister.source,
      totalWeightInKg: inwardRegister.totalWeightInKg,
      purchasedBy: inwardRegister.purchasedBy?.id ?? null,
      incomingGrossQty: inwardRegister.incomingGrossQty,
      incomingNetQty: inwardRegister.incomingNetQty,
      inwardGrossQty: inwardRegister.inwardGrossQty,
      inwardNetQty: inwardRegister.inwardNetQty,
      inwardCost: inwardRegister.inwardCost,
      remarks: inwardRegister.remarks,
      inwardBy: inwardRegister.inwardBy?.id ?? null,
      grnNo: inwardRegister.grnNo?.id ?? null,
      deliveryChallanNo: inwardRegister.deliveryChallanNo?.id ?? null,
      rbcNo: inwardRegister.rbcNo?.id ?? null,
      selectedParty,
      customer:inwardRegister.customerName?.organisationName ?? null,
      
      inwardProducts: (inwardRegister.inwardProducts ?? []).map(
        (p): InwardUpdateProductDto => ({
          id: p.id ?? null,
          productName: p.productName?.name ?? null,
          productCode:p.productName?.productCode??null,
          variant: p.variant?.id ?? null,
          variantName:p.variant?.variantName ?? null,
          variantCode:p.variant?.variantCode??null,
          uom: p.uom?.id ?? null,
          grossWeight: p.grossWeight,
          netWeight: p.netWeight,
          weight: p.weight,
          packingMaterialWeight: p.packingMaterialWeight,
          quantity: p.quantity,
          unitPrice: p.unitPrice,
          amount: p.amount,
        }),
      ),
    };
console.log(transformedInwardRegister)
    await this.cacheService.set(cacheKey, transformedInwardRegister, this.CACHE_TTL);
    return transformedInwardRegister;
  }


 
  async updateInwardRegister(
    id: string,
    data: UpdateInwardRegisterDto,
    updatedBy: string,
  ): Promise<InwardRegister> {
    const inwardRegister = await this.inwardRegisterRepo.findOne({
      where: { id },
    });

    if (!inwardRegister) {
      throw new AppError(404, `InwardRegister with ID ${id} not found`);
    }
 data.date= normalizeDateFormat(data.date);
    const oldData = { ...inwardRegister };

    Object.assign(inwardRegister, data);

    const updatedInwardRegister = await this.inwardRegisterRepo.save(
      inwardRegister,
    );

    await this.auditLogService.logChange(
      'InwardRegister',
      id,
      oldData,
      updatedInwardRegister,
      updatedBy,
    );

    await this.invalidateCache(id);
    return updatedInwardRegister;
  }

//   async updateInwardRegister(id: string, data: any, updatedBy: string): Promise<InwardRegister> {
//   const queryRunner = this.dataSource.createQueryRunner();
//   await queryRunner.connect();
//   await queryRunner.startTransaction();

//   try {
//     const inwardRegister = await queryRunner.manager.findOne(InwardRegister, { where: { id }, relations: ['inwardProducts'] });

//     if (!inwardRegister) {
//       throw new AppError(404, `InwardRegister with ID ${id} not found`);
//     }

//     const oldInwardProducts = inwardRegister.inwardProducts;

//     // Step 1: Revert previous stock effects
//     for (const oldItem of oldInwardProducts) {
//       const existingStock = await this.inventoryStockRepository.findOne({ /* same logic */ });

//       if (existingStock) {
//         existingStock.onHandQty -= Number(oldItem.netWeight || 0);
//         existingStock.amount -= Number(oldItem.amount || 0);
//         await queryRunner.manager.save(existingStock);
//       }
//     }

//     // Step 2: Delete old inward products (if applicable)
//     //await queryRunner.manager.delete(InwardProduct, { inwardRegister: { id } });

//     // Step 3: Update inwardRegister
//     Object.assign(inwardRegister, data);
//     const updatedInwardRegister = await queryRunner.manager.save(inwardRegister);

//     // Step 4: Insert new inwardProducts and update stock
//     for (const item of data.inwardProducts) {
//       // Same logic as in `createInwardRegister` — variant fetch/create + stock update
//     }

//     // Step 5: Commit
//     await queryRunner.commitTransaction();

//     await this.auditLogService.logChange(
//       'InwardRegister',
//       id,
//       inwardRegister,
//       updatedInwardRegister,
//       updatedBy,
//     );

//     return updatedInwardRegister;
//   } catch (error) {
//     await queryRunner.rollbackTransaction();
//     throw error;
//   } finally {
//     await queryRunner.release();
//   }
// }


  public async deleteInwardRegister(id: string): Promise<DeleteResultDto> {
    const inwardRegister = await this.inwardRegisterRepo.findOne({
      where: { id },
    });

    if (!inwardRegister) {
      throw new AppError(404, `InwardRegister with ID ${id} not found`);
    }

    const now = new Date();

    // Calculate the date 6 months ahead
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6); // Adds 6 months to the current date
    sixMonthsFromNow.setHours(0, 0, 0, 0); // Optionally, set the time to midnight (00:00:00)

    console.log(sixMonthsFromNow); // Log the calculated date

    inwardRegister.deletionScheduledAt = sixMonthsFromNow;
    console.log('in delete service', inwardRegister.deletionScheduledAt);
    await this.inwardRegisterRepo.save(inwardRegister);
    console.log(`InwardRegister with ID ${id} marked for deletion.`);
    await this.invalidateCache(id);
    return {No:inwardRegister.inwardNo};
  }






//Todo:Get All Inward Register..By Vaishali
//    public async getAllInwardRegisters(queryOptions: PaginationOptions, userId: string): Promise<any> {
//     const data = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(
//       userId,
//       DocumentTypeEnum.INWARD_REGISTER,
//     );
//     const { search } = queryOptions;
//   //  console.log('Fetched documents:', data);
  
//     const typedDocuments = data as DocumentWithRelatedData[];
  
//     // if (typedDocuments.length > 0) {
//     //   console.log("doc.relatedData", typedDocuments[0].relatedData);
//     // } else {
//     //   console.log("No documents found for user.");
//     // }
  
//     for (const doc of typedDocuments) {
//       console.log('doc_id', doc.document_type_id);
      
//       if (!doc.document_type_id) continue;
  
//       try {
//         console.log('---------------------');
        
//         doc.relatedData = await this.inwardRegisterRepo.findOne({
//           where: { id: doc.document_type_id },
//         //  relations: ['grnNo', 'deliveryChallanNo', 'rbcNo', 'companyName', 'location', 'selectedVendor', 'selectedFarmer', 'purchasedBy', 'inwardBy', 'inwardProducts', 'inwardProducts.productName', 'inwardProducts.uom'],
//         });
//         console.log('Related data fetched for document:', doc.id, doc.relatedData);
        
//       } catch (e) {
//         console.log("in catch block", e);
//         doc.relatedData = null;
//       }
//     }
//  // console.log('Related data fetched for documents:', typedDocuments);
  
//     let relatedDataOnly = typedDocuments.map((doc) => {
//       const rd = doc.relatedData || {};
//       return {
//         documentId: doc.id,
//         overAllStatus: doc.status,
//         createdBy: `${doc.lastActionBy.firstName || null}  ${doc.lastActionBy.lastName || null}`,
//         createdDate: formatDateTime(doc.createdAt).createdDate,
//         createdTime: formatDateTime(doc.createdAt).createdTime,
//         // From relatedData
//       id: rd.id || null,
//       batchNo: rd.batchNo || null,
//       inwardType: rd.inwardType || null,
//       remarks: rd.remarks || null,
//       purchasedQty: rd.purchasedQty || null,
//       inwardQtyInKg: rd.inwardQtyInKg || null,
//       inwardCost: rd.inwardCost || null,
//       totalWeightInKg: rd.totalWeightInKg || null,
//       source: rd.source || null,

//       grnNo: rd.grnNo?.grnNo || null,
//       deliveryChallanNo: rd.deliveryChallanNo?.challanNo || null,
     // rbcNo: rd.rbcNo?.rbcNo || null,
//       companyName: rd.companyName?.name || null,
//       location: rd.location?.name || null,
//       vendorName: rd.selectedVendor?.companyName || null,
//       farmerName: rd.selectedFarmer?.farmerfName || null,
//       purchasedBy: rd.purchasedBy?.name || null,
//       inwardBy: rd.inwardBy?.name || null,

//       // Products
//       inwardProducts: rd.inwardProducts ? rd.inwardProducts.map((p: any) => ({
//         productName: p.productName?.name || null,
//         grade: p.grade || null,
//         quantity: p.quantity || null,
//         uom: p.uom?.unit || null,
//         unitPrice: p.unitPrice || null,
//         amount: p.amount || null,
//         purchaseDate: p.purchaseDate || null,
//         expectedHarvestDate: p.expectedHarvestDate || null,
//         dispatchDate: p.dispatchDate || null,
//         deliveryDate: p.deliveryDate || null,
//         deliveryLocation: p.deliveryLocation || null,
//         count: p.count || null,
//         size: p.size || null,
//         origin: p.origin || null,
//         variety: p.variety || null,
//       })) : [],
//       };
//     });
//    // 🔍 Deep Search
//   const objectToString = (obj: any): string => {
//     if (obj == null) return '';
//     if (typeof obj === 'object') {
//       return Object.values(obj).map((v) => objectToString(v)).join(' ');
//     }
//     return String(obj);
//   };

//   if (search && search.trim()) {
//     const term = search.toLowerCase();
//     relatedDataOnly = relatedDataOnly.filter((item) =>
//       objectToString(item).toLowerCase().includes(term)
//     );
//   }
//    // 🔄 Sorting
//   if (queryOptions.sort) {
//     const [field, direction] = queryOptions.sort.split(':');
//     const sortOrder = direction?.toUpperCase() === 'DESC' ? -1 : 1;

//     const getNestedValue = (obj: any, path: string) =>
//       path.split('.').reduce((o, key) => (o ? o[key] : undefined), obj);

//     relatedDataOnly.sort((a, b) => {
//       const valA = getNestedValue(a, field);
//       const valB = getNestedValue(b, field);

//       if (valA == null && valB == null) return 0;
//       if (valA == null) return -1 * sortOrder;
//       if (valB == null) return 1 * sortOrder;

//       if (!isNaN(valA) && !isNaN(valB)) {
//         return (Number(valA) - Number(valB)) * sortOrder;
//       }
//       return String(valA).localeCompare(String(valB)) * sortOrder;
//     });
//   }

//     return {
//       data: relatedDataOnly,
//       meta: {
//         total: relatedDataOnly.length,
//         page: queryOptions.page || 1,
//         pages: Math.ceil(relatedDataOnly.length / (queryOptions.limit || 10)),
//       }
//     };
//   }
public async getAllInwardRegisters(queryOptions: PaginationOptions, userId: string): Promise<InwardRegisterListResultDto> {
    const hash = createHash('md5').update(`${userId}:${JSON.stringify(queryOptions)}`).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:all:${hash}`;
    const cached = await this.cacheService.get<InwardRegisterListResultDto>(cacheKey);
    if (cached) return cached;

    const data = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(
      userId,
      DocumentTypeEnum.INWARD_REGISTER,
      false,
      queryOptions,
    );
    const { search } = queryOptions;
    const typedDocuments = data as DocumentWithRelatedData[];

    const inwardIds = typedDocuments
      .map((doc) => doc.document_type_id)
      .filter(Boolean) as string[];

    let inwardMap = new Map<string, any>();
    if (inwardIds.length > 0) {
      const inwards = await this.inwardRegisterRepo
        .createQueryBuilder('ir')
        .leftJoin('ir.grnNo', 'grnNo')
        .leftJoin('ir.deliveryChallanNo', 'deliveryChallanNo')
        .leftJoin('ir.rbcNo', 'rbcNo')
        .leftJoin('ir.companyName', 'companyName')
        .leftJoin('ir.location', 'location')
        .leftJoin('ir.selectedVendor', 'selectedVendor')
        .leftJoin('ir.selectedFarmer', 'selectedFarmer')
        .leftJoin('ir.purchasedBy', 'purchasedBy')
        .leftJoin('ir.inwardBy', 'inwardBy')
        .select([
          'ir.id', 'ir.batchNo', 'ir.inwardType', 'ir.inwardNo', 'ir.source',
          'ir.inwardNetQty', 'ir.inwardGrossQty', 'ir.incomingNetQty', 'ir.incomingGrossQty',
          'ir.inwardCost', 'ir.totalWeightInKg', 'ir.remarks', 'ir.date',
          'grnNo.grnNo', 'deliveryChallanNo.challanNo', 'rbcNo.rbcNo',
          'companyName.name', 'location.name',
          'selectedVendor.companyName', 'selectedFarmer.farmerfName',
          'purchasedBy.firstName', 'inwardBy.firstName',
        ])
        .where('ir.id IN (:...ids)', { ids: inwardIds })
        .andWhere('ir.isDeleted = false')
        .andWhere('ir.deletedAt IS NULL')
        .getMany();

      inwardMap = new Map(inwards.map((i) => [i.id, i]));
    }

    let relatedDataOnly: InwardRegisterListItemDto[] = typedDocuments
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((doc): InwardRegisterListItemDto => {
        const rd = doc.document_type_id ? inwardMap.get(doc.document_type_id) : null;
        const { createdDate, createdTime } = formatDateTime(doc.createdAt);
        return {
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: `${doc.lastActionBy?.firstName ?? ''} ${doc.lastActionBy?.lastName ?? ''}`.trim(),
          createdDate,
          createdTime,
          id: rd?.id ?? null,
          batchNo: rd?.batchNo ?? null,
          inwardType: rd?.inwardType ?? null,
          inwardNo: rd?.inwardNo ?? null,
          source: rd?.source ?? null,
          inwardNetQty: rd?.inwardNetQty ?? null,
          inwardGrossQty: rd?.inwardGrossQty ?? null,
          incomingNetQty: rd?.incomingNetQty ?? null,
          incomingGrossQty: rd?.incomingGrossQty ?? null,
          inwardCost: rd?.inwardCost ?? null,
          totalWeightInKg: rd?.totalWeightInKg ?? null,
          remarks: rd?.remarks ?? null,
          date: rd?.date ?? null,
          grnNo: rd?.grnNo?.grnNo ?? null,
          deliveryChallanNo: rd?.deliveryChallanNo?.challanNo ?? null,
          rbcNo: rd?.rbcNo?.rbcNo ?? null,
          companyName: rd?.companyName?.name ?? null,
          location: rd?.location?.name ?? null,
          vendorName: rd?.selectedVendor?.companyName ?? null,
          farmerName: rd?.selectedFarmer?.farmerfName ?? null,
          purchasedBy: rd?.purchasedBy?.firstName ?? null,
          inwardBy: rd?.inwardBy?.firstName ?? null,
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
        objectToString(item).toLowerCase().includes(term),
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
    }

    const allResult: InwardRegisterListResultDto = {
      data: relatedDataOnly,
      meta: {
        total: relatedDataOnly.length,
        page: queryOptions.page || 1,
        pages: Math.ceil(relatedDataOnly.length / (queryOptions.limit || 10)),
      },
    };
    await this.cacheService.set(cacheKey, allResult, this.CACHE_TTL);
    return allResult;
  }


  //TODO:Get Inward Register By Id For View..By Vaishali
public async getInwardregisterByIdForView(docid: string, userId: string): Promise<InwardRegisterViewDto | null> {
    // Keyed by userId as well: access is checked per user (non creator/approver
    // gets null -> 403), so a shared key would serve the document to users who
    // are not allowed to see it.
    const cacheKey = `${this.CACHE_PREFIX}:view:${docid}:${userId}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const document = await this.docSingalApproverService.getSingleApprovalDocumentById(docid, userId);
    if (!document) return null;

    const id = document.documentTypeId;
    if (!id) return null;

    const inwardRegister = await this.inwardRegisterRepo
      .createQueryBuilder('ir')
      .leftJoin('ir.grnNo', 'grnNo')
      .leftJoin('ir.deliveryChallanNo', 'deliveryChallanNo')
      .leftJoin('ir.rbcNo', 'rbcNo')
      .leftJoin('ir.companyName', 'companyName')
      .leftJoin('ir.location', 'location')
      .leftJoin('ir.fromLocation', 'fromLocation')
      .leftJoin('ir.customerName', 'customerName')
      .leftJoin('ir.selectedVendor', 'selectedVendor')
      .leftJoin('selectedVendor.officeAddress', 'vendorOfficeAddress')
      .leftJoin('selectedVendor.category', 'vendorCategory')
      .leftJoin('selectedVendor.subcategory', 'vendorSubcategory')
      .leftJoin('selectedVendor.vendorSaleInfo', 'vendorSaleInfo')
      .leftJoin('ir.selectedFarmer', 'selectedFarmer')
      .leftJoin('selectedFarmer.farmAddress', 'farmAddress')
      .leftJoin('selectedFarmer.residensialAddress', 'residensialAddress')
      .leftJoin('ir.purchasedBy', 'purchasedBy')
      .leftJoin('ir.inwardBy', 'inwardBy')
      .leftJoin('ir.inwardProducts', 'inwardProducts')
      .leftJoin('inwardProducts.productName', 'productName')
      .leftJoin('inwardProducts.uom', 'uom')
      .leftJoin('inwardProducts.variant', 'variant')
      .select([
        'ir.id', 'ir.inwardType', 'ir.inwardNo', 'ir.batchNo', 'ir.remarks', 'ir.source',
        'ir.incomingGrossQty', 'ir.incomingNetQty', 'ir.inwardGrossQty', 'ir.inwardNetQty',
        'ir.inwardCost', 'ir.totalWeightInKg', 'ir.date', 'ir.createdAt',
        'grnNo.grnNo', 'deliveryChallanNo.challanNo', 'rbcNo.rbcNo',
        'companyName.name', 'location.name', 'fromLocation.name',
        'customerName.organisationName',
        'selectedVendor.companyName', 'selectedVendor.vendorCode',
        'vendorOfficeAddress.id', 'vendorOfficeAddress.address1', 'vendorOfficeAddress.address2',
        'vendorOfficeAddress.location', 'vendorOfficeAddress.city', 'vendorOfficeAddress.state', 'vendorOfficeAddress.pincode',
        'vendorCategory.name', 'vendorSubcategory.name',
        'vendorSaleInfo.contactFName', 'vendorSaleInfo.contactMName', 'vendorSaleInfo.contactLName',
        'selectedFarmer.farmerfName', 'selectedFarmer.farmermName', 'selectedFarmer.farmerlName',
        'selectedFarmer.primaryMobileNo', 'selectedFarmer.secondaryMobileNo',
        'selectedFarmer.farmerCode', 'selectedFarmer.email',
        'farmAddress.id', 'farmAddress.address1', 'farmAddress.address2',
        'farmAddress.location', 'farmAddress.city', 'farmAddress.state', 'farmAddress.pincode',
        'residensialAddress.id', 'residensialAddress.address1', 'residensialAddress.address2',
        'residensialAddress.location', 'residensialAddress.city', 'residensialAddress.state', 'residensialAddress.pincode',
        'purchasedBy.firstName', 'purchasedBy.lastName',
        'inwardBy.firstName', 'inwardBy.lastName',
        'inwardProducts.id', 'inwardProducts.packingMaterialWeight', 'inwardProducts.quantity',
        'inwardProducts.weight', 'inwardProducts.unitPrice', 'inwardProducts.amount',
        'inwardProducts.netWeight', 'inwardProducts.grossWeight',
        'productName.name', 'uom.unit', 'variant.variantName',
      ])
      .where('ir.id = :id', { id })
      .getOne();

    if (!inwardRegister) throw new Error('inwardRegister not found');

    const { createdDate, createdTime } = formatDateTime(inwardRegister.createdAt);

    const mapAddress = (addr: any): InwardViewAddressDto | null =>
      addr
        ? {
            id: addr.id,
            address1: addr.address1,
            address2: addr.address2,
            location: addr.location,
            city: addr.city,
            state: addr.state,
            pincode: addr.pincode,
          }
        : null;

    const sf = inwardRegister.selectedFarmer;
    const sv = inwardRegister.selectedVendor;

    const selectedParty: InwardViewFarmerPartyDto | InwardViewVendorPartyDto | null =
      inwardRegister.source === 'farmer' && sf
        ? ({
            fullname: `${sf.farmerfName ?? ''} ${sf.farmermName ?? ''} ${sf.farmerlName ?? ''}`.trim(),
            primaryMobileNo: sf.primaryMobileNo ?? null,
            secondaryMobileNo: sf.secondaryMobileNo ?? null,
            farmerCode: sf.farmerCode ?? null,
            email: sf.email ?? null,
            farmAddress: mapAddress(sf.farmAddress),
            residensialAddress: mapAddress(sf.residensialAddress),
          } satisfies InwardViewFarmerPartyDto)
        : inwardRegister.source === 'vendor' && sv
        ? ({
            companyName: sv.companyName ?? null,
            category: sv.category?.name ?? null,
            subcategory: sv.subcategory?.name ?? null,
            vendorCode: sv.vendorCode ?? null,
            contactPersonName: sv.vendorSaleInfo
              ? `${sv.vendorSaleInfo.contactFName ?? ''} ${sv.vendorSaleInfo.contactMName ?? ''} ${sv.vendorSaleInfo.contactLName ?? ''}`.trim()
              : null,
            officeAddress: mapAddress(sv.officeAddress),
          } satisfies InwardViewVendorPartyDto)
        : null;

    const result: InwardRegisterViewDto = {
      documentId: document.documentId,
      overAllStatus: document.status,
      createdBy: document.createdBy,
      createdDate,
      createdTime,
      approvalSummary: document.approvalSummary ?? null,
      selectedParty,
      id: inwardRegister.id,
      inwardType: inwardRegister.inwardType,
      inwardNo: inwardRegister.inwardNo,
      batchNo: inwardRegister.batchNo,
      remarks: inwardRegister.remarks,
      source: inwardRegister.source,
      incomingGrossQty: inwardRegister.incomingGrossQty,
      incomingNetQty: inwardRegister.incomingNetQty,
      inwardGrossQty: inwardRegister.inwardGrossQty,
      inwardNetQty: inwardRegister.inwardNetQty,
      inwardCost: inwardRegister.inwardCost,
      totalWeightInKg: inwardRegister.totalWeightInKg,
      grnNo: inwardRegister.grnNo?.grnNo ?? null,
      deliveryChallanNo: inwardRegister.deliveryChallanNo?.challanNo ?? null,
      rbcNo: inwardRegister.rbcNo?.rbcNo ?? null,
      companyName: inwardRegister.companyName?.name ?? null,
      location: inwardRegister.location?.name ?? null,
      fromLocation: inwardRegister.fromLocation?.name ?? null,
      customerName: inwardRegister.customerName?.organisationName ?? null,
      date: inwardRegister.date,
      purchasedBy: inwardRegister.purchasedBy
        ? `${inwardRegister.purchasedBy.firstName ?? ''} ${inwardRegister.purchasedBy.lastName ?? ''}`.trim()
        : null,
      inwardBy: inwardRegister.inwardBy
        ? `${inwardRegister.inwardBy.firstName ?? ''} ${inwardRegister.inwardBy.lastName ?? ''}`.trim()
        : null,
      inwardProducts: (inwardRegister.inwardProducts ?? []).map(
        (prod): InwardViewProductDto => ({
          id: prod.id,
          productName: prod.productName?.name ?? null,
          uom: prod.uom?.unit ?? null,
          variant: prod.variant?.variantName ?? null,
          packingMaterialWeight: prod.packingMaterialWeight,
          quantity: prod.quantity,
          weight: prod.weight,
          unitPrice: prod.unitPrice,
          amount: prod.amount,
          netWeight: prod.netWeight,
          grossWeight: prod.grossWeight,
        }),
      ),
    };

    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }


public async deleteMultipleInwardRegister(ids: string[]): Promise<BulkDeleteResultDto> {
  const success: { id: string; No: string }[] = [];
  const failed: { id: string; reason: string }[] = [];  
  for (const id of ids) {
      const inwardRegister = await this.inwardRegisterRepo.findOne({
        where: { id },
      });

      if (!inwardRegister) {
        failed.push({ id, reason: 'Inward Register not found' });
        continue;
      }

      const relatedDocument = await this.documentbRepository.findOne({
        where: { document_type_id: inwardRegister.id }
      });

      if (!relatedDocument) {
        throw new Error(`Something went wrong`);
      }

      await this.documentbRepository.softDelete(relatedDocument.id);
      await this.documentbRepository.update(relatedDocument.id, { isDeleted: true } as any);

      await this.inwardRegisterRepo.softDelete(inwardRegister.id);
      await this.inwardRegisterRepo.update(inwardRegister.id, { isDeleted: true } as any);
       success.push({ id, No: inwardRegister.inwardNo });
    }
    const message = `Deletion completed. Success: ${success.length}, Failed: ${failed.length}`;
    return { success, failed, message};

  }


}


  // public async getScheduledForDeletionRecords(): Promise<InwardRegister[]> {
  //   return this.inwardRegisterRepo.find({
  //     where: { deletionScheduledAt: LessThanOrEqual(new Date()) },
  //   });
  // }


  // async getInwardidforget(id: string): Promise<any> {
  //   const cacheKey = `${this.CACHE_PREFIX}:get:${id}`;
  //   const cached = await this.cacheService.get<any>(cacheKey);
  //   if (cached) return cached;

  //   console.log('in service', id);

  //   // Fetch the inward register with relations
  //   const inwardRegister = await this.inwardRegisterRepo.findOne({
  //     where: { id },
  //     relations: [
  //       'grnNo',
  //       'location',
  //       'companyName',
  //       'deliveryChallanNo',
  //       'selectedVendor',
  //       'selectedVendor.officeAddress',
  //       'selectedVendor.category',
  //       'selectedVendor.subcategory',
  //       'selectedVendor.vendorSaleInfo',
  //       'selectedFarmer',
  //       'selectedFarmer.farmAddress',
  //       'selectedFarmer.residensialAddress',
  //       'inwardProducts',
  //       'inwardBy',
  //       'purchasedBy',
  //       'inwardProducts.productName',
  //       'inwardProducts.uom',
  //     ],
  //   });

  //   if (!inwardRegister) {
  //     return null; // Handle null case appropriately
  //   }
  //   // Dynamically construct the selectedParty field
  //   // const selectedParty =
  //   //   inwardRegister.source === 'farmer' && inwardRegister.selectedFarmer
  //   //     ? inwardRegister.selectedFarmer.id
  //   //     : inwardRegister.source === 'vendor' && inwardRegister.selectedVendor
  //   //     ? inwardRegister.selectedVendor.id
  //   //     : null;
  //   const selectedParty =
  //     inwardRegister.source === 'farmer' && inwardRegister.selectedFarmer
  //       ? { 
  //         fullname:inwardRegister.selectedFarmer.farmerfName+' '+inwardRegister.selectedFarmer.farmermName+' '+inwardRegister.selectedFarmer.farmerlName,
  //         primaryMobileNo:inwardRegister.selectedFarmer.primaryMobileNo,
  //         secondaryMobileNo:inwardRegister.selectedFarmer.secondaryMobileNo,
  //         farmerCode:inwardRegister.selectedFarmer.farmerCode,
  //         email:inwardRegister.selectedFarmer.email,

  //          farmAddress:inwardRegister.selectedFarmer.farmAddress ? {
  //           id:inwardRegister.selectedFarmer.farmAddress.id,
  //           address1:inwardRegister.selectedFarmer.farmAddress.address1,
  //           address2:inwardRegister.selectedFarmer.farmAddress.address2,
  //           location:inwardRegister.selectedFarmer.farmAddress.location,
  //           city:inwardRegister.selectedFarmer.farmAddress.city,
  //           state:inwardRegister.selectedFarmer.farmAddress.state,
  //           pincode:inwardRegister.selectedFarmer.farmAddress.pincode

  //         }:null,

  //          residensialAddress:inwardRegister.selectedFarmer.residensialAddress ? {
  //           id:inwardRegister.selectedFarmer.residensialAddress.id,
  //           address1:inwardRegister.selectedFarmer.residensialAddress.address1,
  //           address2:inwardRegister.selectedFarmer.residensialAddress.address2,
  //           location:inwardRegister.selectedFarmer.residensialAddress.location,
  //           city:inwardRegister.selectedFarmer.residensialAddress.city,
  //           state:inwardRegister.selectedFarmer.residensialAddress.state,
  //           pincode:inwardRegister.selectedFarmer.residensialAddress.pincode

  //         }:null
          

  //       }
           
  //       : inwardRegister.source === 'vendor' && inwardRegister.selectedVendor
  //       ? {
  //         companyName:inwardRegister.selectedVendor.companyName,
  //         category:inwardRegister.selectedVendor.category?.name,
  //         subcategory:inwardRegister.selectedVendor.subcategory?.name,
  //         vendorCode:inwardRegister.selectedVendor?.vendorCode,
  //         contactPersonName:inwardRegister.selectedVendor.vendorSaleInfo.contactFName+' '+inwardRegister.selectedVendor.vendorSaleInfo?.contactMName+' '+inwardRegister.selectedVendor.vendorSaleInfo?.contactLName,
  //         officeAddress:inwardRegister.selectedVendor.officeAddress ? {
  //           id:inwardRegister.selectedVendor.officeAddress.id,
  //           address1:inwardRegister.selectedVendor.officeAddress.address1,
  //           address2:inwardRegister.selectedVendor.officeAddress.address2,
  //           location:inwardRegister.selectedVendor.officeAddress.location,
  //           city:inwardRegister.selectedVendor.officeAddress.city,
  //           state:inwardRegister.selectedVendor.officeAddress.state,
  //           pincode:inwardRegister.selectedVendor.officeAddress.pincode

  //         }:null
  //       }
  //       : null;
  //   const rawDate = inwardRegister.createdAt;
  //   const { createdDate, createdTime } = formatDateTime(rawDate);
  //   const transformedInwardRegister = {
  //     id: inwardRegister.id,
  //     createdDate: createdDate,
  //     createdTime: createdTime,

  //     inwardType: inwardRegister.inwardType,
  //     companyName: inwardRegister.companyName?.name||null,
        
  //     location: inwardRegister.location ? inwardRegister.location?.name : null,
  //     date: inwardRegister.date || null,
  //     batchNo: inwardRegister.batchNo,
  //     source: inwardRegister.source,
  //     totalWeightInKg: inwardRegister.totalWeightInKg,
  //     purchasedBy: inwardRegister.purchasedBy
  //       ? 
  //           inwardRegister.purchasedBy?.firstName+' '+inwardRegister.purchasedBy?.middleName+' '+inwardRegister.purchasedBy?.lastName
            
  //       : null,
  //    incomingGrossQty: inwardRegister.incomingGrossQty,
  //     incomingNetQty: inwardRegister.incomingNetQty,

  //     inwardGrossQty: inwardRegister.inwardGrossQty,
  //     inwardNetQty: inwardRegister.inwardNetQty,
  //     inwardCost: inwardRegister.inwardCost,
  //     remarks: inwardRegister.remarks,
  //     inwardBy: inwardRegister.inwardBy
  //       ?  inwardRegister.inwardBy?.firstName+' '+inwardRegister.inwardBy?.middleName+' '+inwardRegister.inwardBy?.lastName
            
  //       : null,
  //     grnNo: inwardRegister.grnNo
  //       ?  inwardRegister.grnNo.grnNo
           
  //       : null,
  //     deliveryChallanNo: inwardRegister.deliveryChallanNo
  //       ?  inwardRegister.deliveryChallanNo.challanNo
            
  //       : null,

  //     selectedParty: selectedParty,
  //     inwardProducts: inwardRegister.inwardProducts.map((product) => ({
  //       id: product?.id || null,
  //       productName: product.productName
  //         ?  product.productName.name
             
  //         : null,

  //      variant:product.variant ? product.variant.variantName:null,
  //       grossWeight: product.grossWeight,
  //       netWeight: product.netWeight,
  //       uom: product.uom
  //         ?  product.uom.unit
             
  //         : null,

  //       packingMaterialWeight: product.packingMaterialWeight,
  //       quantity: product.quantity,
  //       unitPrice: product.unitPrice,
  //       amount: product.amount,
  //     })),
  //   };

  //   await this.cacheService.set(cacheKey, transformedInwardRegister, this.CACHE_TTL);
  //   return transformedInwardRegister;
  // }


  // async getInwardRegisterById(id: string): Promise<any> {
  //   const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
  //   const cached = await this.cacheService.get<any>(cacheKey);
  //   if (cached) return cached;

  //   console.log('in service', id);

  //   // Fetch the inward register with relations
  //   const inwardRegister = await this.inwardRegisterRepo.findOne({
  //     where: { id },
  //     relations: [
  //       'grnNo',
  //       'location',
  //       'companyName',
  //       'deliveryChallanNo',
  //       'rbcNo',
  //       'selectedVendor',
  //       'selectedFarmer',
  //       'inwardProducts',
  //       'inwardBy',
  //       'purchasedBy',
  //       'inwardProducts.productName',
  //       'inwardProducts.uom',
  //     ],
  //   });

  //   if (!inwardRegister) {
  //     return null; // Handle null case appropriately
  //   }
  //   // Dynamically construct the selectedParty field
  //   // const selectedParty =
  //   //   inwardRegister.source === 'farmer' && inwardRegister.selectedFarmer
  //   //     ? inwardRegister.selectedFarmer.id
  //   //     : inwardRegister.source === 'vendor' && inwardRegister.selectedVendor
  //   //     ? inwardRegister.selectedVendor.id
  //   //     : null;
  //   const selectedParty =
  //     inwardRegister.source === 'farmer' && inwardRegister.selectedFarmer
  //       ? {
  //           id: inwardRegister.selectedFarmer.id,
  //           name:
  //             inwardRegister.selectedFarmer.farmerfName +
  //             ' ' +
  //             inwardRegister.selectedFarmer.farmermName +
  //             ' ' +
  //             inwardRegister.selectedFarmer.farmerlName,
  //         }
  //       : inwardRegister.source === 'vendor' && inwardRegister.selectedVendor
  //       ? {
  //           id: inwardRegister.selectedVendor.id,
  //           name: inwardRegister.selectedVendor.companyName,
  //         }
  //       : null;
  //   const rawDate = inwardRegister.createdAt;
  //   const { createdDate, createdTime } = formatDateTime(rawDate);
  //   const transformedInwardRegister = {
  //     id: inwardRegister.id,
  //     createdDate: createdDate,
  //     createdTime: createdTime,

  //     inwardType: inwardRegister.inwardType,
  //     companyName: inwardRegister.companyName
  //       ? inwardRegister.companyName?.id
  //       : null,
  //     location: inwardRegister.location ? inwardRegister.location?.id : null,
  //     date: inwardRegister.date || null,
  //     batchNo: inwardRegister.batchNo,
  //     source: inwardRegister.source,
  //     totalWeightInKg: inwardRegister.totalWeightInKg,
  //     purchasedBy: inwardRegister.purchasedBy
  //       ? {
  //           id: inwardRegister.purchasedBy.id,
  //           name:
  //             inwardRegister.purchasedBy?.firstName +
  //               ' ' +
  //               inwardRegister.purchasedBy?.middleName +
  //               ' ' +
  //               inwardRegister.purchasedBy?.lastName || null,
  //         }
  //       : null,
  //     incomingGrossQty: inwardRegister.incomingGrossQty,
  //     incomingNetQty: inwardRegister.incomingNetQty,

  //     inwardGrossQty: inwardRegister.inwardGrossQty,
  //     inwardNetQty: inwardRegister.inwardNetQty,

  //     inwardCost: inwardRegister.inwardCost,
  //     remarks: inwardRegister.remarks,
  //     inwardBy: inwardRegister.inwardBy
  //       ? {
  //           id: inwardRegister.inwardBy.id,
  //           name:
  //             inwardRegister.inwardBy?.firstName +
  //               ' ' +
  //               inwardRegister.inwardBy?.middleName +
  //               ' ' +
  //               inwardRegister.inwardBy?.lastName || null,
  //         }
  //       : null,
  //     grnNo: inwardRegister.grnNo
  //       ? {
  //           id: inwardRegister.grnNo.id,
  //           grnNo: inwardRegister.grnNo.grnNo,
  //         }
  //       : null,
  //     deliveryChallanNo: inwardRegister.deliveryChallanNo
  //       ? {
  //           id: inwardRegister.deliveryChallanNo.id,
  //           challanNo: inwardRegister.deliveryChallanNo.challanNo,
  //         }
  //       : null,

  //     selectedParty: selectedParty,
  //     inwardProducts: inwardRegister.inwardProducts.map((product) => ({
  //       id: product?.id || null,
  //       productName: product.productName
  //         ? {
  //             id: product.productName.id,
  //             name: product.productName.name,
  //           }
  //         : null,

  //      variant: product.variant
  //        ? {
  //            id: product.variant.id,
  //            name: product.variant.variantName,
  //          }
  //        : null,
  //       grossWeight: product.grossWeight,
  //       netWeight: product.netWeight,
  //       uom: product.uom
  //         ? {
  //             id: product.uom.id,
  //             unit: product.uom.unit,
  //           }
  //         : null,

  //       packingMaterialWeight: product.packingMaterialWeight,
  //       quantity: product.quantity,
  //       unitPrice: product.unitPrice,
  //       amount: product.amount,
  //     })),
  //   };

  //   await this.cacheService.set(cacheKey, transformedInwardRegister, this.CACHE_TTL);
  //   return transformedInwardRegister;
  // }


  // async getInwardRegisters(queryOptions: PaginationOptions): Promise<any> {
  //   const cacheKey = `${this.CACHE_PREFIX}:list:${JSON.stringify(queryOptions)}`;
  //   const cached = await this.cacheService.get<any>(cacheKey);
  //   if (cached) return cached;

  //   const queryBuilder = this.inwardRegisterRepo
  //     .createQueryBuilder('inwardRegister')
  //     .leftJoinAndSelect('inwardRegister.grnNo', 'grnNo')
  //     .leftJoinAndSelect('inwardRegister.companyName', 'companyName')
  //     .leftJoinAndSelect('inwardRegister.location', 'location')
  //     .leftJoinAndSelect(
  //       'inwardRegister.deliveryChallanNo',
  //       'deliveryChallanNo',
  //     )
  //     .leftJoinAndSelect('inwardRegister.selectedVendor', 'selectedVendor')
  //     .leftJoinAndSelect('inwardRegister.selectedFarmer', 'selectedFarmer')
  //     .leftJoinAndSelect('inwardRegister.inwardProducts', 'inwardProducts')
  //     .leftJoinAndSelect('inwardProducts.productName', 'productName')
  //     .leftJoinAndSelect('inwardProducts.uom', 'uom')
  //     .orderBy('inwardRegister.createdAt', 'DESC');

  //   // Apply pagination, search, filters, and sorting
  //   const result = await buildQuery(
  //     queryBuilder,
  //     queryOptions,
  //     'inwardRegister',
  //   );
  //   console.log(result);

  //   // Transform inward registers data to match the expected structure
  //   const transformedInwardRegisters = result.data.map((inwardRegister) => {
  //     const rawDate = inwardRegister.createdAt;
  //     const { createdDate, createdTime } = formatDateTime(rawDate);
  //     const selectedParty =
  //       inwardRegister.source === 'farmer' && inwardRegister.selectedFarmer
  //         ? inwardRegister.selectedFarmer.id
  //         : inwardRegister.source === 'vendor' && inwardRegister.selectedVendor
  //         ? inwardRegister.selectedVendor.id
  //         : null;
  //     return {
  //       id: inwardRegister.id,
  //       inwardType: inwardRegister.inwardType,
  //       companyName: inwardRegister.companyName?.name || null,
  //       location: inwardRegister.location ? inwardRegister.location.name : null,
  //       createdDate: createdDate,
  //       createdTime: createdTime,

  //       date: inwardRegister.date || null,
  //       batchNo: inwardRegister.batchNo,
  //       source: inwardRegister.source,
  //       purchasedBy: inwardRegister.purchasedBy,
  //       totalWeightInKg: inwardRegister.totalWeightInKg,
        
  //       inwardCost: inwardRegister.inwardCost,
  //       remarks: inwardRegister.remarks,
  //       inwardBy: inwardRegister.inwardBy,
  //       grnNo: inwardRegister.grnNo?.grnNo || null,
  //       deliveryChallanNo: inwardRegister.deliveryChallanNo?.challanNo || null,
  //       selectedParty: selectedParty,
  //       inwardProducts: inwardRegister.inwardProducts.map((product) => ({
  //         id: product?.id || null,
  //         productName: product?.productName?.id || null,
  //         variant: product?.variant?.variantName || null,
  //         grossWeight: product.grossWeight,
  //         netWeight: product.netWeight,
  //         uom: product.uom?.id || null,
  //         packingMaterialWeight: product.packingMaterialWeight,
  //         quantity: product.quantity,
  //         unitPrice: product.unitPrice,
  //         amount: product.amount,
  //       })),
  //     };
  //   });

  //   const listResult = {
  //     data: transformedInwardRegisters,
  //     meta: result.meta,
  //   };
  //   await this.cacheService.set(cacheKey, listResult, this.CACHE_TTL);
  //   return listResult;
  // }




// async filterInwardRegisters(
//   page: number,
//   limit: number,
//   filters: Record<string, any>
// ) {
//   const cacheKey = `${this.CACHE_PREFIX}:filter:${page}:${limit}:${JSON.stringify(filters)}`;
//   const cached = await this.cacheService.get<any>(cacheKey);
//   if (cached) return cached;

//   const queryBuilder: SelectQueryBuilder<InwardRegister> =
//     this.inwardRegisterRepo.createQueryBuilder("inwardRegister");

//   // ✅ Select all fields from InwardRegister
//   queryBuilder.select("inwardRegister");

//   // ✅ Join relations but select only specific fields
//   queryBuilder
//     .leftJoin("inwardRegister.deliveryChallanNo", "deliveryChallanNo")
//     .addSelect(["deliveryChallanNo.challanNo", "deliveryChallanNo.vehicleNo"])
//     .leftJoin("inwardRegister.companyName", "companyName")
//     .addSelect(["companyName.name"])
//     .leftJoin("inwardRegister.location", "location")
//     .addSelect(["location.name"])
//     .leftJoin("inwardRegister.selectedVendor", "selectedVendor")
//     .addSelect(["selectedVendor.companyName"])
//     .leftJoin("inwardRegister.selectedFarmer", "selectedFarmer")
//     .addSelect([
//       "selectedFarmer.farmerlName",
//       "selectedFarmer.farmermName",
//       "selectedFarmer.farmerfName",
//     ])
//     .leftJoinAndSelect("inwardRegister.inwardProducts", "inwardProducts")
//     .leftJoinAndSelect("inwardProducts.productName", "product")
//     .addSelect(["product.name"]);

//   // ✅ Apply dynamic filters (including deep relations)
//   Object.entries(filters).forEach(([key, value], index) => {
//     const paramKey = `param_${index}`; // avoid param conflicts

//     const parts = key.split(".");
//     if (parts.length > 1) {
//       // Example: inwardProducts.productName.name
//       const aliasPath = parts.slice(0, -1).join(".");
//       const field = parts[parts.length - 1];
//       const alias = parts[parts.length - 2]; // e.g. productName -> alias "product"

//       if (typeof value === "string" && isNaN(Number(value))) {
//         queryBuilder.andWhere(`${alias}.${field} ILIKE :${paramKey}`, {
//           [paramKey]: `%${value}%`,
//         });
//       } else {
//         queryBuilder.andWhere(`${alias}.${field} = :${paramKey}`, {
//           [paramKey]: value,
//         });
//       }
//     } else {
//       // Normal InwardRegister field filter
//       if (typeof value === "string" && isNaN(Number(value))) {
//         queryBuilder.andWhere(`inwardRegister.${key} ILIKE :${paramKey}`, {
//           [paramKey]: `%${value}%`,
//         });
//       } else {
//         queryBuilder.andWhere(`inwardRegister.${key} = :${paramKey}`, {
//           [paramKey]: value,
//         });
//       }
//     }
//   });
//   // ✅ Pagination
//   queryBuilder.skip((page - 1) * limit).take(limit);

//   const [data, total] = await queryBuilder.getManyAndCount();

//   const filterResult = {
//     data,
//     total,
//     page,
//     limit,
//     totalPages: Math.ceil(total / limit),
//   };
//   await this.cacheService.set(cacheKey, filterResult, this.CACHE_TTL);
//   return filterResult;
// }


