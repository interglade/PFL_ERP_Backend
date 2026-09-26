import { inject, injectable } from "inversify";



const CACHE_PREFIX = 'dump';
const CACHE_TTL = 180;
const CACHE_TTL_DETAIL = 300;

import { DataSource, EntityManager, ILike, In, IsNull } from "typeorm";

import { sign } from "node:crypto";
import { TYPES } from "../../types";
import { DumpRegisterRepository } from "../repository/dumpRegister.repository";
import { DumpProductRepository } from "../repository/dumpProduct.repository";
import { ProductVarientRepository } from "../../product/productVarient/repository/varients.repository";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { DocumentbService, DocumentWithRelatedData } from "../../approvalFlow/service/documentb.service";
import { DocDoubleApproverService } from "../../approvalFlow/service/docDoubleApprover.service";
import { ApprovalFlowService } from "../../approvalFlow/service/approvalFlow.service";
import { InventoryStockRepository } from "../../inventoryStock/repository/inventoryStock.repository";
import { DocumentbRepository } from "../../approvalFlow/repository/documentb.repository";
import { CacheService } from "../../global/cache.service";
import { CreateDumpRegisterDto, DumpProductForUpdateDto, DumpProductViewDto, DumpRegisterForUpdateDto, DumpRegisterListItemDto, DumpRegisterListResultDto, DumpRegisterRecycleItemDto, DumpRegisterRecycleResultDto, DumpRegisterViewDto, UpdateDumpRegisterDto } from "../dto/dumpRegister.dto";
import { DocumentTypeEnum as DocDefEnum } from '../../documentDef/entity/documentdef.entity';
import { DocumentStatus, DocumentTypeEnum} from "../../approvalFlow/entity/docuemnt.entity";
import logger from "../../utils/logger";
import { PaginationOptions } from "../../utils/pagination";
import { formatDateTime } from "../../utils/dateUtils";
import { DumpRegister } from "../entity/dumpRegister.entity";
import { BulkDeleteResultDto, DeleteResultDto } from "../../global/general.dto";
import AppError from "../../utils/appError";




@injectable()
export class DumpRegisterService{

    constructor(
        @inject(TYPES.DumpRegisterRepository) private readonly dumpRegisterRepository: DumpRegisterRepository,
        @inject(TYPES.DumpProductRepository) private readonly dumpProductRepository: DumpProductRepository,

          @inject(TYPES.ProductVarientRepository)
        private productVarientsRepository: ProductVarientRepository,
       @inject(TYPES.AuditLogService) private readonly auditLogService: AuditLogService,
       @inject(TYPES.DocumentbService) private readonly documentService: DocumentbService, // Assuming you have a Document service for handling documents
      @inject(TYPES.DocDoubleApproverService) private readonly docDoubleApproverService: DocDoubleApproverService, // Assuming you have a service for double approval 
      @inject(TYPES.ApprovalFlowService)
    private approvalFlowService: ApprovalFlowService,
     @inject(TYPES.InventoryStockRepository)
                private readonly inventoryStockRepository: InventoryStockRepository,
    @inject(TYPES.DocumentbRepository)
    private documentbRepository: DocumentbRepository,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
    ) {}

  // ─── Cache Helpers ────────────────────────────────────────────────────────
  private async invalidateDumpCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:recycle:*`),
      this.cacheService.del(`${CACHE_PREFIX}:count`),
      this.cacheService.del(`${CACHE_PREFIX}:totalQty`),
      this.cacheService.del(`${CACHE_PREFIX}:totalCost`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${CACHE_PREFIX}:update:${id}`),
        // The view cache is keyed by the Documentb id (the /view/:docid route
        // param), not by this record's own id, so it can only be busted by
        // pattern from here.
        this.cacheService.invalidatePattern(`${CACHE_PREFIX}:view:*`),
      );
    }
    await Promise.all(tasks);
  }

  private async generateSerialNo(): Promise<string> {
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const datePrefix = `DPR${yyyy}${mm}${dd}`;

    const count = await this.dumpRegisterRepository.count({
      where: { dumpNo: ILike(`${datePrefix}%`) },
    });

    return `${datePrefix}${(count + 1).toString().padStart(5, '0')}`;
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

    async createDumpRegister(data: CreateDumpRegisterDto): Promise<any> {
       // Check if approval flow exists for the user
       await this.checkApprovalFlowExists(data.requestedBy, DocDefEnum.OPERATION);

       // 1. Validate approval flow exists before doing anything else
      // const approvalFlow = await this.approvalFlowService.findApprovalFlowForLoggedUser(data.requestedBy, DocDefEnum.OPERATION);

      // if (!approvalFlow) {
      //   throw new AppError(400, 'No approval flow configured for this user. Please contact the admin to create an approval flow before creating a Dump Register.');
      // }
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // console.log(data)
        // console.log("Creating Dump Register with data:", JSON.stringify(data, null, 2));

        // Expecting data.dumpProducts to be an array of { productId, variantId, uomId, quantity, unitPrice, amount }
        if (!data.dumpProducts || !Array.isArray(data.dumpProducts) || data.dumpProducts.length === 0) {
          throw new Error("dumpProducts array is required and must not be empty");
        }

        
        // Create the dump register header
        // Handle both companyId/companyName field names
        const companyId = data.companyId || data.companyName;
        const locationId = data.locationId || data.location;
        const grnId = data.grn || data.grnNo;
        const deliveryChallanId = data.deliveryChallanNo || data.deliveryChallan;
        const rbcId = data.rbcNo || data.rbc;
const serialNo = await this.generateSerialNo();

        const dumpRegister = queryRunner.manager.create(
          this.dumpRegisterRepository.target,
          {
            dumpNo: serialNo,
            companyName: companyId ? { id: companyId } : undefined,
            location: locationId ? { id: locationId } : undefined,
            grn: grnId ? { id: grnId } : undefined,
            deliveryChallanNo: deliveryChallanId ? { id: deliveryChallanId } : undefined,
            rbcNo: rbcId ? { id: rbcId } : undefined,
            requestedBy: data.requestedBy ? { id: data.requestedBy } : undefined,
            date: data.date,
            dumpType: data.dumpType || undefined,
            batchNo: data.batchNo,
            totalQty: data.totalQty,
            totalDumpCost: data.totalDumpCost,
            totalCostInWords: data.totalCostInWords,
            remark: data.remark,
          } as any,
        );

        
        const savedDumpRegister = await queryRunner.manager.save(dumpRegister);
        

       
        // Create document
        const document = await this.documentService.createDocument({
          type: DocumentTypeEnum.DUMP_REGISTER,
          docDef: DocDefEnum.OPERATION,
          status: DocumentStatus.HOLD,
          remarks: 'Document auto-created with Dump Register',
          lastActionBy: { id: data.requestedBy },
          document_type_id: savedDumpRegister.id,
        });

        

        
        // Create DumpProduct records
        for (const productData of data.dumpProducts) {
          
          // Handle both field name variations
          const productId = productData.productId || productData.productName;
          const variantId = productData.variantId || productData.variant;
          const uomId = productData.uomId || productData.uom;
          const quantity = productData.quantity;
          const unitPrice = productData.unitPrice;
          const amount = productData.amount;

          if (!productId) {
            throw new Error("Each dump product must have productId/productName");
          }

          const dumpQty = Number(quantity ?? 0);
          const dumpAmt = Number(amount ?? 0);

          if (dumpQty <= 0) continue;

          // Create DumpProduct record
          const dumpProductData: any = {
            dumpRegister: { id: savedDumpRegister.id },
            productName: { id: productId },
            quantity: dumpQty,
            unitPrice: Number(unitPrice ?? 0),
            amount: dumpAmt,
          };

          if (variantId) {
            dumpProductData.variant = { id: variantId };
          }

          if (uomId) {
            dumpProductData.uom = { id: uomId };
          }

          const dumpProduct = queryRunner.manager.create(this.dumpProductRepository.target, dumpProductData);
          await queryRunner.manager.save(dumpProduct);

          // Inventory is NOT touched here.
          // inwardQty/inwardAmt are reduced and dumpQty/dumpAmt increased only
          // when this Dump Register's document reaches DocumentStatus.COMPLETE
          // — see InventoryMovementService.applyDumpRegister().
        }

        // Commit transaction - all operations succeeded
        await queryRunner.commitTransaction();

        // Start approval flow after commit so dump register is visible to other DB connections
        await this.documentService.startApprovalFlow(document.id);
        await this.invalidateDumpCache();

        return savedDumpRegister;
      } catch (error) {
        // Rollback transaction - undo all changes
        await queryRunner.rollbackTransaction();
    logger.error('Error creating Dump Register:', error);
        // Re-throw the original error with more context
        if (error instanceof Error) {
          throw new Error(`Failed to create Dump Register: ${error.message}`);
        }
        throw error;
      } finally {
        // Release query runner
        await queryRunner.release();
      }
    }

  async getAllRecycleBinDumpRegisters(queryOptions:PaginationOptions, userId: string): Promise<DumpRegisterRecycleResultDto> {
    const key = `${CACHE_PREFIX}:recycle:${userId}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<DumpRegisterRecycleResultDto>(key);
    if (cached) return cached;

      const {data, meta} = await this.docDoubleApproverService.getAllDocumentByUserIdForDoubleApprover(
        userId,
        DocumentTypeEnum.DUMP_REGISTER,
        queryOptions,
        true // includeDeleted for recycle bin
      );
 const { search } = queryOptions;
     
      
      const typedDocuments = data as DocumentWithRelatedData[];
      const activeDocuments = typedDocuments;
          for (const doc of activeDocuments) {
            if (!doc.document_type_id) continue;
            try {
              doc.relatedData = await this.dumpRegisterRepository.findOne({
                where: { id: doc.document_type_id, isDeleted:true },
                relations: ['companyName', 'location', 'grn', 'deliveryChallanNo', 'rbcNo', 'dumpProducts', 'dumpProducts.productName', 'dumpProducts.uom'],
              });
      
            } catch {
              doc.relatedData = null;
            }
          }
      
          let relatedDataOnly: DumpRegisterRecycleItemDto[] = activeDocuments
            .filter((doc) => doc.relatedData)
            .map((doc): DumpRegisterRecycleItemDto => ({
              documentId: doc.id,
              overAllStatus: doc.status,
              createdBy: `${doc.lastActionBy?.firstName ?? ''} ${doc.lastActionBy?.lastName ?? ''}`.trim(),
              createdDate: formatDateTime(doc.createdAt).createdDate,
              createdTime: formatDateTime(doc.createdAt).createdTime,
              id: doc.relatedData.id,
              dumpNo: doc.relatedData.dumpNo,
              companyName: doc.relatedData?.companyName?.name ?? null,
              location: doc.relatedData?.location?.name ?? null,
              grn: doc.relatedData?.grn?.grnNo ?? null,
              deliveryChallanNo: doc.relatedData?.deliveryChallanNo?.challanNo ?? null,
              rbcNo: doc.relatedData?.rbcNo?.rbcNo ?? null,
              date: doc.relatedData.date,
              batchNo: doc.relatedData.batchNo,
              totalQty: doc.relatedData.totalQty,
              totalDumpCost: doc.relatedData.totalDumpCost,
              totalCostInWords: doc.relatedData.totalCostInWords,
              remark: doc.relatedData.remark,
              dumpType: doc.relatedData.dumpType ?? null,
            }));

             // 🔍 Deep search helper
  const objectToString = (obj: any): string => {
    if (obj == null) return '';
    if (typeof obj === 'object') {
      return Object.values(obj).map((v) => objectToString(v)).join(' ');
    }
    return String(obj);
  };

  // 🔍 Apply search filter
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
      
      const recycleResponse: DumpRegisterRecycleResultDto = {
        data: relatedDataOnly,
        meta: {
          total: meta.total,
          page: meta.page,
          pages: meta.pages,
        },
      };
      await this.cacheService.set(key, recycleResponse, CACHE_TTL);
      return recycleResponse;
    }
  


       async getDumpRegisterByIdforUpdate(id: string): Promise<DumpRegisterForUpdateDto | null> {
    const key = `${CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<DumpRegisterForUpdateDto>(key);
    if (cached) return cached;

    const dumpRegister = await this.dumpRegisterRepository
      .createQueryBuilder('dr')
      .leftJoin('dr.location', 'location')
      .leftJoin('dr.grn', 'grn')
      .leftJoin('dr.deliveryChallanNo', 'deliveryChallanNo')
      .leftJoin('dr.rbcNo', 'rbcNo')
      .leftJoin('dr.requestedBy', 'requestedBy')
      .leftJoin('dr.companyName', 'companyName')
      .leftJoin('dr.dumpProducts', 'dumpProducts')
      .leftJoin('dumpProducts.productName', 'productName')
      .leftJoin('dumpProducts.variant', 'variant')
      .leftJoin('dumpProducts.uom', 'uom')
      .select([
        'dr.id', 'dr.dumpType', 'dr.date', 'dr.batchNo', 'dr.remark',
        'dr.totalDumpCost', 'dr.totalCostInWords', 'dr.totalQty', 'dr.createdAt',
        'location.id', 'grn.id', 'deliveryChallanNo.id', 'rbcNo.id',
        'requestedBy.id', 'companyName.id',
        'dumpProducts.id', 'dumpProducts.quantity', 'dumpProducts.unitPrice', 'dumpProducts.amount',
        'productName.id', 'variant.id', 'uom.id',
      ])
      .where('dr.id = :id', { id })
      .getOne();

    if (!dumpRegister) throw new Error(`Dump Register with ID ${id} not found`);

    const { createdDate, createdTime } = formatDateTime(dumpRegister.createdAt);

    const updateResult: DumpRegisterForUpdateDto = {
      createdDate,
      createdTime,
      dumpType: dumpRegister.dumpType ?? null,
      location: dumpRegister.location?.id ?? null,
      companyName: dumpRegister.companyName?.id ?? null,
      date: dumpRegister.date,
      totalDumpCost: dumpRegister.totalDumpCost,
      totalCostInWords: dumpRegister.totalCostInWords,
      totalQty: dumpRegister.totalQty,
      batchNo: dumpRegister.batchNo,
      remark: dumpRegister.remark,
      grn: dumpRegister.grn?.id ?? null,
      deliveryChallanNo: dumpRegister.deliveryChallanNo?.id ?? null,
      rbcNo: dumpRegister.rbcNo?.id ?? null,
      requestedBy: dumpRegister.requestedBy?.id ?? null,
      dumpProducts: (dumpRegister.dumpProducts ?? []).map((p): DumpProductForUpdateDto => ({
        id: p.id,
        productName: p.productName?.id ?? null,
        variant: p.variant?.id ?? null,
        uom: p.uom?.id ?? null,
        quantity: p.quantity,
        amount: p.amount,
        unitPrice: p.unitPrice,
      })),
    };

    await this.cacheService.set(key, updateResult, CACHE_TTL_DETAIL);
    return updateResult;
  }

      //TODO: Get DumpRegister for View
       async getDumpRegisterByIdforView(docId: string): Promise<DumpRegisterViewDto | null> {
    const key = `${CACHE_PREFIX}:view:${docId}`;
    const cached = await this.cacheService.get<DumpRegisterViewDto>(key);
    if (cached) return cached;

    const document = await this.docDoubleApproverService.getDocumentById(docId);
    const id = document.documentTypeId;
    if (!id) return null;

    const dumpRegister = await this.dumpRegisterRepository
      .createQueryBuilder('dr')
      .leftJoin('dr.location', 'location')
      .leftJoin('dr.grn', 'grn')
      .leftJoin('dr.requestedBy', 'requestedBy')
      .leftJoin('dr.companyName', 'companyName')
      .leftJoin('dr.deliveryChallanNo', 'deliveryChallanNo')
      .leftJoin('dr.rbcNo', 'rbcNo')
      .leftJoin('dr.dumpProducts', 'dumpProducts')
      .leftJoin('dumpProducts.productName', 'productName')
      .leftJoin('dumpProducts.variant', 'variant')
      .leftJoin('dumpProducts.uom', 'uom')
      .select([
        'dr.id', 'dr.dumpNo', 'dr.dumpType', 'dr.date', 'dr.batchNo',
        'dr.totalDumpCost', 'dr.totalCostInWords', 'dr.totalQty', 'dr.remark', 'dr.createdAt',
        'location.name', 'grn.grnNo', 'deliveryChallanNo.challanNo', 'rbcNo.rbcNo',
        'companyName.name',
        'requestedBy.firstName', 'requestedBy.lastName',
        'dumpProducts.id', 'dumpProducts.quantity', 'dumpProducts.unitPrice', 'dumpProducts.amount',
        'productName.name', 'variant.variantName', 'uom.unit',
      ])
      .where('dr.id = :id', { id })
      .getOne();

    if (!dumpRegister) throw new Error(`Dump Register with ID ${id} not found`);

    const { createdDate, createdTime } = formatDateTime(dumpRegister.createdAt);

    const viewResult: DumpRegisterViewDto = {
      id: dumpRegister.id,
      documentId: document.documentId,
      overAllStatus: document.overAllStatus,
      createdBy: document.createdBy,
      approvalSummary: document.approvalSummary ?? null,
      dumpNo: dumpRegister.dumpNo ?? null,
      grn: dumpRegister.grn?.grnNo ?? null,
      deliveryChallanNo: dumpRegister.deliveryChallanNo?.challanNo ?? null,
      rbcNo: dumpRegister.rbcNo?.rbcNo ?? null,
      dumpType: dumpRegister.dumpType ?? null,
      companyName: dumpRegister.companyName?.name ?? null,
      location: dumpRegister.location?.name ?? null,
      date: dumpRegister.date,
      totalDumpCost: dumpRegister.totalDumpCost,
      totalCostInWords: dumpRegister.totalCostInWords,
      totalQty: dumpRegister.totalQty,
      batchNo: dumpRegister.batchNo,
      remark: dumpRegister.remark,
      requestedBy: dumpRegister.requestedBy
        ? `${dumpRegister.requestedBy.firstName} ${dumpRegister.requestedBy.lastName}`
        : null,
      createdDate,
      createdTime,
      dumpProducts: (dumpRegister.dumpProducts ?? []).map((p): DumpProductViewDto => ({
        id: p.id,
        productName: p.productName?.name ?? null,
        variant: p.variant?.variantName ?? null,
        uom: p.uom?.unit ?? null,
        quantity: p.quantity,
        amount: p.amount,
        unitPrice: p.unitPrice,
      })),
    };

    await this.cacheService.set(key, viewResult, CACHE_TTL_DETAIL);
    return viewResult;
  }

async getAllDumpRegisters(queryOptions: PaginationOptions, userId: string): Promise<DumpRegisterListResultDto> {
    const key = `${CACHE_PREFIX}:list:${userId}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<DumpRegisterListResultDto>(key);
    if (cached) return cached;

    const { data, meta } = await this.docDoubleApproverService.getAllDocumentByUserIdForDoubleApprover(
      userId,
      DocumentTypeEnum.DUMP_REGISTER,
      queryOptions,
    );
    const { search } = queryOptions;
    const typedDocuments = data as DocumentWithRelatedData[];

    const dumpIds = typedDocuments
      .map((doc) => doc.document_type_id)
      .filter(Boolean) as string[];

    let dumpMap = new Map<string, any>();
    if (dumpIds.length > 0) {
      const dumps = await this.dumpRegisterRepository
        .createQueryBuilder('dr')
        .leftJoin('dr.companyName', 'companyName')
        .leftJoin('dr.location', 'location')
        .leftJoin('dr.grn', 'grn')
        .leftJoin('dr.deliveryChallanNo', 'deliveryChallanNo')
        .leftJoin('dr.rbcNo', 'rbcNo')
        .select([
          'dr.id', 'dr.dumpNo', 'dr.date', 'dr.batchNo', 'dr.totalQty',
          'dr.totalDumpCost', 'dr.totalCostInWords', 'dr.remark', 'dr.dumpType',
          'companyName.name', 'location.name',
          'grn.grnNo', 'deliveryChallanNo.challanNo', 'rbcNo.rbcNo',
        ])
        .where('dr.id IN (:...ids)', { ids: dumpIds })
        .andWhere('dr.isDeleted = false')
        .andWhere('dr.deletedAt IS NULL')
        .getMany();

      dumpMap = new Map(dumps.map((d) => [d.id, d]));
    }

    let relatedDataOnly: (DumpRegisterListItemDto | null)[] = typedDocuments
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter((doc) => doc.document_type_id && dumpMap.has(doc.document_type_id))
      .map((doc): DumpRegisterListItemDto | null => {
        const rd = dumpMap.get(doc.document_type_id!);
        if (!rd) return null;
        const { createdDate, createdTime } = formatDateTime(doc.createdAt);
        return {
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: `${doc.lastActionBy?.firstName ?? ''} ${doc.lastActionBy?.lastName ?? ''}`.trim(),
          createdDate,
          createdTime,
          id: rd.id,
          dumpNo: rd.dumpNo ?? null,
          companyName: rd.companyName?.name ?? null,
          location: rd.location?.name ?? null,
          grn: rd.grn?.grnNo ?? null,
          deliveryChallanNo: rd.deliveryChallanNo?.challanNo ?? null,
          rbcNo: rd.rbcNo?.rbcNo ?? null,
          date: rd.date,
          batchNo: rd.batchNo ?? null,
          totalQty: rd.totalQty ?? null,
          totalDumpCost: rd.totalDumpCost ?? null,
          totalCostInWords: rd.totalCostInWords ?? null,
          remark: rd.remark ?? null,
          dumpType: rd.dumpType ?? null,
        };
      })
      .filter(Boolean);

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

    const listResponse: DumpRegisterListResultDto = {
      data: relatedDataOnly.filter((x): x is DumpRegisterListItemDto => x !== null),
      meta: { total: meta.total, page: meta.page, pages: meta.pages },
    };
    await this.cacheService.set(key, listResponse, CACHE_TTL);
    return listResponse;
  }
    
public async updateDumpRegister(
  id: string,
  data: UpdateDumpRegisterDto,
  updatedBy: string,
): Promise<DumpRegister | null> {
  
  const existingDumpRegister = await this.dumpRegisterRepository.findOne({
    where: { id },
    relations: ["dumpProducts"],
  });

  if (!existingDumpRegister) {
    throw new Error("DumpRegister entry not found");
  }

  
  const oldData = { ...existingDumpRegister };

 
  const { dumpProducts, ...updateData } = data;

  
  Object.assign(existingDumpRegister, updateData);

  
  if (dumpProducts && Array.isArray(dumpProducts)) {
    
    await this.dumpProductRepository.delete({ dumpRegister: { id } });

    // Accept the same field aliases the create path accepts. The edit form
    // posts back the create payload shape (productId/variantId/uomId); reading
    // only productName/variant/uom silently dropped the variant, which then
    // moved stock against a NULL-variant inventory_stock row.
    const newDumpProducts = dumpProducts.map(product => {
      const productId = product.productId || product.productName;
      const variantId = product.variantId || product.variant;
      const uomId = product.uomId || product.uom;

      return this.dumpProductRepository.create({
        dumpRegister: existingDumpRegister,
        productName: productId ? ({ id: productId } as any) : undefined,
        variant: variantId ? ({ id: variantId } as any) : undefined,
        uom: uomId ? ({ id: uomId } as any) : undefined,
        quantity: product.quantity ?? undefined,
        unitPrice: product.unitPrice ?? undefined,
        amount: product.amount ?? undefined,
      });
    });

    await this.dumpProductRepository.save(newDumpProducts as any);
    existingDumpRegister.dumpProducts = newDumpProducts;
  }

 
  const updatedDumpRegister = await this.dumpRegisterRepository.save(existingDumpRegister);


  await this.auditLogService.logChange(
    'DumpRegister',        
    id,                    
    oldData,               
    updatedDumpRegister,   
    updatedBy              
  );

  await this.invalidateDumpCache(id);
  return updatedDumpRegister;
}


    
     
async deleteDumpRegister(id: string): Promise<DeleteResultDto | null> {
  
  const dumpRegister = await this.dumpRegisterRepository.findOne({
    where: { id },
  });

  if (!dumpRegister) {
    throw new AppError(404, `Dump Register with ID ${id} not found`);
  }

 
  const now = new Date();
  const sixMonthsFromNow = new Date(now);
  sixMonthsFromNow.setMonth(now.getMonth() + 6); 
  sixMonthsFromNow.setHours(0, 0, 0, 0); 

  //console.log(`Dump Register with ID ${id} marked for deletion in 6 months at ${sixMonthsFromNow}`);

  
  dumpRegister.deletionScheduledAt = sixMonthsFromNow;

  
  await this.dumpRegisterRepository.save(dumpRegister);
  await this.invalidateDumpCache(id);

  //console.log(`Dump Register with ID ${id} marked for deletion in 6 months.`);
  return {No:dumpRegister.dumpNo};
}












public async deleteMultipleDumpRegisters(ids: string[]): Promise<BulkDeleteResultDto> {
  const success: { id: string; No: string }[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      const dumpRegister = await this.dumpRegisterRepository.findOne({
        where: { id },
      });
      if (!dumpRegister) {
        failed.push({ id, reason: 'Dump Register not found' });
        continue;
      }
      const relatedDocument = await this.documentbRepository.findOne({
        where: { document_type_id: dumpRegister.id }
      });

      if (!relatedDocument) {
        throw new Error(`Something went wrong`);
      }

      if (relatedDocument) {
        await this.documentbRepository.softDelete(relatedDocument.id);
        await this.documentbRepository.update(relatedDocument.id, { isDeleted: true } as any);
      }

      await this.dumpRegisterRepository.softDelete(dumpRegister.id);
      await this.dumpRegisterRepository.update(dumpRegister.id, { isDeleted: true } as any);
      success.push({id,No:dumpRegister.dumpNo});
    } catch (error: any) {
      failed.push({ id, reason: error.message || 'Unknown error' });
    }
  }
  // const message = `Deletion completed. Success: ${success.length}, Failed: ${failed.length}`;
  // return { success, failed, message };
  await this.invalidateDumpCache();
  return { success,failed,message: 'Dump records marked for deletion successfully' };
}

}


//     async getAllDumpRegisters(queryOptions:PaginationOptions, userId: string): Promise<any> {

//       const {data, meta} = await this.docDoubleApproverService.getAllDocumentByUserIdForDoubleApprover(
//         userId,
//         DocumentTypeEnum.DUMP_REGISTER,
//         queryOptions
//       );
//  const { search } = queryOptions;
//       // let queryBuilder = await this.dumpRegisterRepository
//       // .createQueryBuilder("dump_register") 
//       // .leftJoinAndSelect("dump_register.location", "location")
//       // .leftJoinAndSelect("dump_register.dumpProducts", "dumpProducts")
//       // .leftJoinAndSelect("dump_register.grn", "grn")
//       // .leftJoinAndSelect("dump_register.requestedBy", "requestedBy")
//       // .leftJoinAndSelect("dumpProducts.productName", "productName") 
//       // .leftJoinAndSelect("dumpProducts.uom", "uom")
//       // .leftJoinAndSelect("dump_register.companyName", "companyName")
//       // .orderBy("dump_register.createdAt", "DESC");
    
//       //   const { data, meta } = await buildQuery(queryBuilder, queryOptions, 'dump_register');
      
//       const typedDocuments = data as DocumentWithRelatedData[];
//           for (const doc of typedDocuments) {
//             if (!doc.document_type_id) continue;
//             try {
//               doc.relatedData = await this.dumpRegisterRepository.findOne({
//                 where: { id: doc.document_type_id },
//                 relations: ['companyName', 'location', 'dumpProducts', 'dumpProducts.productName', 'dumpProducts.uom'],
//               });
      
//             } catch {
//               doc.relatedData = null;
//             }
//           }
      
//           let relatedDataOnly = typedDocuments
//             .filter((doc) => doc.relatedData)
//             .map((doc) => ({
//               documentId: doc.id,
//               overAllStatus: doc.status, 
//               createdBy: doc.lastActionBy.firstName + ' ' + doc.lastActionBy.lastName,
//               createdDate: formatDateTime(doc.createdAt).createdDate,
//               createdTime: formatDateTime(doc.createdAt).createdTime,
//               ...doc.relatedData,
//               companyName: doc.relatedData.companyName.name || null,
//               location: doc.relatedData.location.name || null,
//             })
//             );

//              // 🔍 Deep search helper
//   const objectToString = (obj: any): string => {
//     if (obj == null) return '';
//     if (typeof obj === 'object') {
//       return Object.values(obj).map((v) => objectToString(v)).join(' ');
//     }
//     return String(obj);
//   };

//   // 🔍 Apply search filter
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
      
//              return {
//         data: relatedDataOnly,
//         meta: {
//           total: meta.total,
//           page: meta.page,
//           pages: meta.pages
//         }
//       };
      

//     //     return {
//     // data :data.map(dumpRegister => {
//     //   const rawDate = dumpRegister.createdAt;
//     //   const { createdDate, createdTime } = formatDateTime(rawDate);
//     //   return {
//     //     id: dumpRegister.id,
//     //     companyName: dumpRegister.companyName?.name || null,
//     //     location: dumpRegister.location ? dumpRegister.location.name : null,
//     //     createdDate: createdDate,
//     //     createdTime: createdTime,
//     //     date: dumpRegister.date,
//     //     batchNo: dumpRegister.batchNo,
//     //     remark: dumpRegister.remark,
//     //     grn: dumpRegister.grn
//     //       ? {
//     //           id: dumpRegister.grn.id || null,
//     //           grnNo: dumpRegister.grn.grnNo,
//     //         }
//     //       : null,
//     //     requestedBy: dumpRegister.requestedBy
//     //       ? {
//     //           id: dumpRegister.requestedBy.id || null,
//     //           firstName: dumpRegister.requestedBy.firstName,
//     //           lastName: dumpRegister.requestedBy.lastName,
//     //         }
//     //       : null,
//     //     dumpProducts: dumpRegister.dumpProducts.map((dumpProduct) => ({
//     //       id: dumpProduct.id,
//     //       product: dumpProduct.productName?.name || null,
//     //       uom: dumpProduct.uom.unit || null,
//     //       variety:dumpProduct.variety,
//     //       count:dumpProduct.count,
//     //       size:dumpProduct.size,
//     //       origin:dumpProduct.origin,
//     //       quantity: dumpProduct.quantity,
//     //       amount:dumpProduct.amount,
//     //       unitPrice:dumpProduct.unitPrice
//     //     })),
//     //   };
//     // }),
//     // meta,
//     //     }
// }


// public async getDumpDataForDates(
//   filterType?: string,
//   startDate?: string,
//   endDate?: string
// ): Promise<any[]> {
//   const key = `${CACHE_PREFIX}:datesData:${filterType}:${startDate}:${endDate}`;
//   const cached = await this.cacheService.get<any[]>(key);
//   if (cached) return cached;
//   let query = this.dumpProductRepository
//     .createQueryBuilder("dumpProducts")
//     .select("TO_CHAR(dumpRegister.date, 'YYYY-MM-DD')", "date")
//     .addSelect("COALESCE(SUM(dumpProducts.quantity), 0)", "totalQuantity")
//     .addSelect("COALESCE(SUM(dumpProducts.amount), 0)", "totalCost")
//     .innerJoin(DumpRegister, "dumpRegister", "dumpRegister.id = dumpProducts.dumpRegister") // Fixed alias here
//     .groupBy("TO_CHAR(dumpRegister.date, 'YYYY-MM-DD')")
//     .orderBy("TO_CHAR(dumpRegister.date, 'YYYY-MM-DD')", "ASC");

  
//   const currentDate = new Date().toISOString().split("T")[0]; 

//   switch (filterType) {
//     case "tillDate":
//       query = query.andWhere("dumpRegister.date <= :currentDate", { currentDate });
//       break;

//     case "financialYear": {
//       const today = new Date();
//       const financialYearStart =
//         today.getMonth() + 1 >= 4 
//           ? `${today.getFullYear()}-04-01`
//           : `${today.getFullYear() - 1}-04-01`;
//       query = query.andWhere("dumpRegister.date BETWEEN :start AND :end", {
//         start: financialYearStart,
//         end: currentDate,
//       });
//       break;
//     }

//     case "today":
//       query = query.andWhere("TO_CHAR(dumpRegister.date, 'YYYY-MM-DD') = :currentDate", {
//         currentDate,
//       });
//       break;

//     case "dateRange":
//       if (startDate && endDate) {
//         query = query.andWhere("dumpRegister.date BETWEEN :start AND :end", {
//           start: startDate,
//           end: endDate,
//         });
//       }
//       break;

//     default:
//       break; 
//   }

//   const rawResult = await query.getRawMany();

//   const mappedResult = rawResult.map((row) => ({
//     date: row.date,
//     quantity: Number(row.totalQuantity),
//     amount: Number(row.totalCost),
//   }));
//   await this.cacheService.set(key, mappedResult, CACHE_TTL);
//   return mappedResult;
// }


// async getDumpRegisterByCompanyName(companyName: string): Promise<any> {
//   const key = `${CACHE_PREFIX}:company:${companyName}`;
//   const cached = await this.cacheService.get<any>(key);
//   if (cached) return cached;
//   const total = await this.dumpRegisterRepository
//     .createQueryBuilder("dumpRegister")
//     .leftJoin("dumpRegister.companyName", "companyName")
//     .where("companyName.id = :companyName", { companyName: companyName })
//     .getMany();
//   await this.cacheService.set(key, total, CACHE_TTL);
//   return total; 
// }


// async getDumpRegisterlocation(location: string): Promise<any> { 
//   const key = `${CACHE_PREFIX}:location:${location}`;
//   const cached = await this.cacheService.get<any>(key);
//   if (cached) return cached;
//   const total = await this.dumpRegisterRepository
//   .createQueryBuilder("dumpRegister")
//   .leftJoin("dumpRegister.location", "location")
//   .where("location.id = :location", { location: location })
//   .getMany();
//   await this.cacheService.set(key, total, CACHE_TTL);
//   return total; 
// }


// async totalqunatityandtotaldumpcostfromstartdatetoenddate(startdate: Date, enddate: Date): Promise<any> {
//   const key = `${CACHE_PREFIX}:dateRange:${startdate}:${enddate}`;
//   const cached = await this.cacheService.get<any>(key);
//   if (cached) return cached;
//   const total = await this.dumpRegisterRepository
//     .createQueryBuilder("dumpRegister")
//     .leftJoin("dumpRegister.dumpProducts", "dumpProduct")
//     .select("SUM(dumpRegister.totalQty)", "totalQuantity")
//     .addSelect("SUM(dumpProduct.amount)", "totalCost")
//     .where("dumpRegister.date BETWEEN :startdate AND :enddate", { startdate: startdate, enddate: enddate })
//     .getRawOne();
 
//   await this.cacheService.set(key, total, CACHE_TTL);
//   return total;
// }


// async dumpcount():Promise<number>{
//   const key = `${CACHE_PREFIX}:count`;
//   const cached = await this.cacheService.get<number>(key);
//   if (cached !== null && cached !== undefined) return cached;
//   const count = await this.dumpRegisterRepository.count();
//   await this.cacheService.set(key, count, CACHE_TTL);
//   return count; 
// }


// async totaldumpquantity():Promise<number>{
//   const key = `${CACHE_PREFIX}:totalQty`;
//   const cached = await this.cacheService.get<number>(key);
//   if (cached !== null && cached !== undefined) return cached;
//   const total = await this.dumpRegisterRepository.createQueryBuilder("dumpRegister")
//   .select("SUM(dumpRegister.totalQty)", "total")
//   .getRawOne();
//   const result = total.total;
//   await this.cacheService.set(key, result, CACHE_TTL);
//   return result;
// }
// async totaldumpcost():Promise<number>{
//   const total = await this.dumpRegisterRepository.createQueryBuilder("dumpRegister")
//   .select("SUM(dumpRegister.totalCost)", "total")
//   .getRawOne();
//   return total.total;
// }

// async totaldumpcost(): Promise<number> {
//   const key = `${CACHE_PREFIX}:totalCost`;
//   const cached = await this.cacheService.get<number>(key);
//   if (cached !== null && cached !== undefined) return cached;
//   const total = await this.dumpRegisterRepository
//     .createQueryBuilder("dumpRegister")
//     .leftJoin("dumpRegister.dumpProducts", "dumpProduct")
//     .select("SUM(dumpProduct.amount)", "total")
//     .getRawOne();
//   const result = total.total ? Number(total.total) : 0;
//   await this.cacheService.set(key, result, CACHE_TTL);
//   return result;
// }


  // //TODO: Document for view
  //     async getDumpRegisterById(id: string): Promise<DumpRegisterByIdDto | null> {
  //       const key = `${CACHE_PREFIX}:id:${id}`;
  //       const cached = await this.cacheService.get<DumpRegisterByIdDto>(key);
  //       if (cached) return cached;

  //       const dumpRegister = await this.dumpRegisterRepository.findOne({
  //         where: { id },
  //         relations: ["location", "grn", "requestedBy", "dumpProducts", "dumpProducts.productName", "dumpProducts.uom","companyName","location"],
  //       });
      
  //       if (!dumpRegister) {
  //         throw new Error(`Dump Register with ID ${id} not found`);
  //       }

  //       const rawDate = dumpRegister.createdAt;
  //       const { createdDate, createdTime } = formatDateTime(rawDate);
      
  //       const result: DumpRegisterByIdDto = {
  //         id: dumpRegister.id,
  //         companyName: dumpRegister.companyName?.id ?? null,
  //         createdDate,
  //         createdTime,
  //         location: dumpRegister.location ? dumpRegister.location.id : null,
  //         date: dumpRegister.date,
  //         totalDumpCost: dumpRegister.totalDumpCost,
  //         totalCostInWords: dumpRegister.totalCostInWords,
  //         batchNo: dumpRegister.batchNo,
  //         remark: dumpRegister.remark,
  //         grn: dumpRegister.grn ? dumpRegister.grn.id : null,
  //         requestedBy: dumpRegister.requestedBy
  //           ? {
  //               id: dumpRegister.requestedBy.id,
  //               firstName: dumpRegister.requestedBy.firstName,
  //               lastName: dumpRegister.requestedBy.lastName,
  //             }
  //           : null,
  //         dumpProducts: dumpRegister.dumpProducts.map((dumpProduct) => ({
  //           id: dumpProduct.id,
  //           productName: dumpProduct.productName ? {
  //             id: dumpProduct.productName.id,
  //             productName: dumpProduct.productName.name,
  //           } : null,
  //           varient: dumpProduct.variant ? {
  //             id: dumpProduct.variant.id,
  //             productName: dumpProduct.variant.variantName ?? null,
  //           } : null,
  //           uom: dumpProduct.uom ? { id: dumpProduct.uom.id, unit: dumpProduct.uom.unit } : null,
  //           quantity: dumpProduct.quantity,
  //           amount: dumpProduct.amount,
  //           unitPrice: dumpProduct.unitPrice,
  //         })),
  //       };
  //       await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
  //       return result;
  //     }

