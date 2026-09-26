import { inject, injectable } from "inversify";
import { DataSource, DeepPartial, ILike, In } from "typeorm";
import { TYPES } from "../../types";
import { SecondSaleRepository } from "../repository/secondSale.repository";
import { SecondSaleProductRepository } from "../repository/secondSaleProduct.repository";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { DocumentbRepository } from "../../approvalFlow/repository/documentb.repository";
import { ProductVarientRepository } from "../../product/productVarient/repository/varients.repository";
import { DocumentbService, DocumentWithRelatedData } from "../../approvalFlow/service/documentb.service";
import { ApprovalFlowService } from "../../approvalFlow/service/approvalFlow.service";
import { CacheService } from "../../global/cache.service";
import { DocDoubleApproverService } from "../../approvalFlow/service/docDoubleApprover.service";
import { CreateSecondSaleDto, SecondSaleDetailDto, SecondSaleListItemDto, SecondSaleListResponseDto, UpdateSecondSaleDto } from "../dto/secondSale.dto";
import { SecondSale } from "../entity/secondSale.entity";
import { DocumentStatus, DocumentTypeEnum } from "../../approvalFlow/entity/docuemnt.entity";
import { DocumentTypeEnum as DocDefEnum } from "../../documentDef/entity/documentdef.entity";
import { PaginationOptions } from "../../utils/pagination";
import { formatDateTime } from "../../utils/dateUtils";
import AppError from "../../utils/appError";
import { SecondSaleProduct } from "../entity/secondSaleProduct.entity";
import { BulkDeleteResultDto, DeleteResultDto } from "../../global/general.dto";





@injectable()
export class SecondSaleService {
  constructor(
    @inject(TYPES.SecondSaleRepository)
    private readonly secondSaleRepository: SecondSaleRepository,
    @inject(TYPES.SecondSaleProductRepository)
    private readonly secondSaleProductRepository: SecondSaleProductRepository,
    @inject(TYPES.AuditLogService) private auditLogService: AuditLogService,
    @inject(TYPES.DocumentbRepository) private documentbRepository: DocumentbRepository,
    @inject(TYPES.ProductVarientRepository)
    private productVarientsRepository: ProductVarientRepository,
    @inject(TYPES.DataSource)
    private readonly AppDataSource: DataSource,
    @inject(TYPES.DocumentbService)
    private readonly documentbService: DocumentbService,
    @inject(TYPES.DocDoubleApproverService) private readonly docDoubleApproverService: DocDoubleApproverService, // Assuming you have a service for double approval
    @inject(TYPES.ApprovalFlowService)
    private approvalFlowService: ApprovalFlowService,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) { }

  private readonly CACHE_PREFIX = 'secondSale';
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

  private async generateSerialNo(): Promise<string> {
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const datePrefix = `SSR${yyyy}${mm}${dd}`;

    const count = await this.secondSaleRepository.count({
      where: { secondSaleNo: ILike(`${datePrefix}%`) },
    });

    return `${datePrefix}${(count + 1).toString().padStart(5, '0')}`;
  }


  // Creating a document without a configured approval flow leaves it with no
  // approvers, so reject it up front — same guard as RFPA / Deal Slip.
  private async checkApprovalFlowExists(userId: string | null | undefined, documentType: DocDefEnum): Promise<void> {
    if (!userId) {
      throw new AppError(400, 'Creator is required to validate the approval flow before creating this document.');
    }
    const approvalFlow = await this.approvalFlowService.getApprovalFlowForUserAndDepartment(userId, documentType);

    if (!approvalFlow) {
      throw new AppError(400, `Approval flow not configured for user. Please configure approval flow for ${documentType} type documents before creating.`);
    }
  }

  public async createSecondSale(secondSaleData: CreateSecondSaleDto, requestedBy: string): Promise<any> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(requestedBy, DocDefEnum.SALE);

    const queryRunner = this.AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Check approval flow exists for logged user
      //const approvalFlowExit = await this.approvalFlowService.findApprovalFlowForLoggedUser(requestedBy, DocumentTypeEnum.SECOND_SALE);

      // if (!approvalFlowExit) {
      //   throw new Error('Approval flow not found');
      // }
console.log("secondsaledata.....................",secondSaleData);
      // 1. Normalize variant IDs
      let variantIds: string[] = [];
      const variants_raw = (secondSaleData as any).variants;
      if (Array.isArray(variants_raw)) {
        variantIds = variants_raw;
      } else if (variants_raw) {
        variantIds = [variants_raw];
      }

      // 2. Fetch variants with product relation
      const variants = await queryRunner.manager.find(this.productVarientsRepository.target, {
        where: { id: In(variantIds) },
        relations: ['product'],
      });

      // 3. Extract product IDs from variants
      const productIds = variants.map(v => v.product?.id).filter(Boolean);

      // 4. Generate serial number and assign
      const serialNo = await this.generateSerialNo();

      // 5. Create second sale entity
      
      // 5. Create second sale entity
const secondSale = this.secondSaleRepository.create({
  secondSaleNo:       serialNo,
  saleDate:           secondSaleData.saleDate as string,
  customerName:       secondSaleData.customerName,
  customerContactNo:  secondSaleData.customerContactNo,
  customerEmail:      secondSaleData.customerEmail,
  reasonForSale:      secondSaleData.reasonForSale,
  totalNetWeight:     secondSaleData.totalNetWeight,
  totalGrossWeight:   secondSaleData.totalGrossWeight,
  totalAmt:           secondSaleData.totalAmt,
  totalAmtInWords:    secondSaleData.totalAmtInWords,
  paidAmount:         secondSaleData.paidAmount,
  paymentMode:        secondSaleData.paymentMode,
  pendingAmt:         secondSaleData.pendingAmt,
  remarks:            secondSaleData.remarks,
  companyName:        secondSaleData.companyName       ? { id: secondSaleData.companyName }       : null,
  location:           secondSaleData.location          ? { id: secondSaleData.location }          : null,
  deliveryChallanNo:  secondSaleData.deliveryChallanNo ? { id: secondSaleData.deliveryChallanNo } : null,
  customerAddress:    secondSaleData.customerAddress  ,
  secondSaleProducts: secondSaleData.secondSaleProducts ?? [],
} as DeepPartial<SecondSale>);

// Save through queryRunner so it's part of the transaction
const savedSecondSale = await queryRunner.manager.save(SecondSale, secondSale);
console.log("savedsecodsale...................",savedSecondSale);
      // 6. Create associated document
      const document = await this.documentbService.createDocument({
        type: DocumentTypeEnum.SECOND_SALE,
        docDef: DocDefEnum.SALE,
        status: DocumentStatus.HOLD,
        remarks: 'Document auto-created with SecondSale',
        lastActionBy: { id: requestedBy },
        document_type_id: Array.isArray(savedSecondSale)
          ? (savedSecondSale[0] as SecondSale)?.id
          : (savedSecondSale as SecondSale).id,
      });

      // 7. Commit transaction
      await queryRunner.commitTransaction();
console.log(document.id)
      // 8. Start approval flow after commit
      await this.documentbService.startApprovalFlow(document.id);

      await this.invalidateCache();
      return savedSecondSale;

    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }


  // public async createSecondSale(secondSaleData: any, requestedBy: any): Promise<any> {
  //   const queryRunner = this.AppDataSource.createQueryRunner();
  //   await queryRunner.connect();
  //   await queryRunner.startTransaction();

  //   try {
  //     //TODO: Check approval flow is exit or not for logged user

  //     const approvalFlowExit = this.approvalFlowService.findApprovalFlowForLoggedUser(requestedBy, 'second-sale')

  //     if (!approvalFlowExit) {
  //       throw new Error('Approval flow not found');
  //     }
  //     // 1. Normalize variant IDs
  //     let variantIds: string[] = [];
  //     if (Array.isArray(secondSaleData.variants)) {
  //       variantIds = secondSaleData.variants;
  //     } else if (secondSaleData.variants) {
  //       variantIds = [secondSaleData.variants];
  //     }

  //     // 2. Fetch variants with product relation
  //     const variants = await queryRunner.manager.find(this.productVarientsRepository.target, {
  //       where: { id: In(variantIds) },
  //       relations: ['product'],
  //     });

  //     // 3. Extract product IDs from variants
  //     const productIds = variants.map(v => v.product?.id).filter(Boolean);
  //     const serialNo = await this.generateSerialNo();
  //     secondSaleData.secondSaleNo = serialNo;
  //     const secondSale = queryRunner.manager.create(this.secondSaleRepository.target, {
  //       ...secondSaleData,
  //       variants: variants.map(v => ({ id: v.id })), // only IDs
  //       products: productIds.map(id => ({ id })),   // only IDs
  //     });
  //     const savedSecondSale = await queryRunner.manager.save(secondSale);

  //     const document = await this.documentbService.createDocument({
  //       type: DocumentTypeEnum.SECOND_SALE,
  //       docDef: DocDefEnum.SALE,
  //       // totalAmt: rfpaData.totalAmt,
  //       status: DocumentStatus.HOLD,
  //       remarks: 'Document auto-created with SecondSale',
  //       lastActionBy: { id: requestedBy },
  //       document_type_id: Array.isArray(savedSecondSale) ? (savedSecondSale[0] as SecondSale)?.id : (savedSecondSale as SecondSale).id
  //     },);

  //     // Commit transaction - all operations succeeded
  //     await queryRunner.commitTransaction();

  //     // Start approval flow after commit so second sale is visible to other DB connections
  //     await this.documentbService.startApprovalFlow(document.id);

  //     await this.invalidateCache();
  //     return savedSecondSale;
  //   } catch (error: any) {
  //     // Rollback transaction - undo all changes
  //     await queryRunner.rollbackTransaction();
  //     throw error;
  //   } finally {
  //     // Release query runner
  //     await queryRunner.release();
  //   }
  // }

  // public async getAllSecondSales(queryOptions: PaginationOptions, userId: string): Promise<any> {
  //   try {
  //     const cacheKey = `${this.CACHE_PREFIX}:list:${userId}:${JSON.stringify(queryOptions)}`;
  //     const cached = await this.cacheService.get<any>(cacheKey);
  //     if (cached) return cached;

  //     const { data, meta } = await this.docDoubleApproverService.getAllDocumentByUserIdForDoubleApprover(
  //       userId,
  //       DocumentTypeEnum.SECOND_SALE,
  //       queryOptions,
  //     );
  //     const { search } = queryOptions;
  //     const typedDocuments = data as DocumentWithRelatedData[];

  //     const saleIds = typedDocuments
  //       .map((doc) => doc.document_type_id)
  //       .filter(Boolean) as string[];

  //     let saleMap = new Map<string, any>();
  //     if (saleIds.length > 0) {
  //       const sales = await this.secondSaleRepository
  //         .createQueryBuilder('ss')
  //         .leftJoin('ss.companyName', 'companyName')
  //         .leftJoin('ss.location', 'location')
  //         .select([
  //           'ss.id', 'ss.secondSaleNo', 'ss.saleDate', 'ss.customerName',
  //           'ss.customerContactNo', 'ss.customerEmail', 'ss.reasonForSale',
  //           'ss.totalNetWeight', 'ss.totalGrossWeight', 'ss.totalAmt',
  //           'ss.totalAmtInWords', 'ss.paidAmount', 'ss.paymentMode',
  //           'ss.pendingAmt', 'ss.remarks',
  //           'companyName.name', 'location.name',
  //         ])
  //         .where('ss.id IN (:...ids)', { ids: saleIds })
  //         .andWhere('ss.isDeleted = false')
  //         .andWhere('ss.deletedAt IS NULL')
  //         .getMany();

  //       saleMap = new Map(sales.map((s) => [s.id, s]));
  //     }

  //     let relatedDataOnly = typedDocuments
  //       .filter((doc) => doc.document_type_id && saleMap.has(doc.document_type_id))
  //       .map((doc) => {
  //         const rd = saleMap.get(doc.document_type_id!);
  //         if (!rd) return null;
  //         const { createdDate, createdTime } = formatDateTime(doc.createdAt);
  //         return {
  //           documentId: doc.id,
  //           overAllStatus: doc.status,
  //           createdBy: `${doc.lastActionBy?.firstName ?? ''} ${doc.lastActionBy?.lastName ?? ''}`.trim(),
  //           createdDate,
  //           createdTime,
  //           id: rd.id,
  //           secondSaleNo: rd.secondSaleNo ?? null,
  //           saleDate: rd.saleDate ?? null,
  //           customerName: rd.customerName ?? null,
  //           customerContactNo: rd.customerContactNo ?? null,
  //           customerEmail: rd.customerEmail ?? null,
  //           reasonForSale: rd.reasonForSale ?? null,
  //           totalNetWeight: rd.totalNetWeight ?? null,
  //           totalGrossWeight: rd.totalGrossWeight ?? null,
  //           totalAmt: rd.totalAmt ?? null,
  //           totalAmtInWords: rd.totalAmtInWords ?? null,
  //           paidAmount: rd.paidAmount ?? null,
  //           paymentMode: rd.paymentMode ?? null,
  //           pendingAmt: rd.pendingAmt ?? null,
  //           remarks: rd.remarks ?? null,
  //           companyName: rd.companyName?.name ?? null,
  //           location: rd.location?.name ?? null,
  //         };
  //       })
  //       .filter(Boolean);

  //     const objectToString = (obj: any): string => {
  //       if (obj == null) return '';
  //       if (typeof obj === 'object') return Object.values(obj).map((v) => objectToString(v)).join(' ');
  //       return String(obj);
  //     };

  //     if (search && search.trim()) {
  //       const term = search.toLowerCase();
  //       relatedDataOnly = relatedDataOnly.filter((item) =>
  //         objectToString(item).toLowerCase().includes(term),
  //       );
  //     }

  //     if (queryOptions.sort) {
  //       const [field, direction] = queryOptions.sort.split(':');
  //       const sortOrder = direction?.toUpperCase() === 'DESC' ? -1 : 1;
  //       const getNestedValue = (obj: any, path: string) =>
  //         path.split('.').reduce((o, key) => (o ? o[key] : undefined), obj);

  //       relatedDataOnly.sort((a, b) => {
  //         const valA = getNestedValue(a, field);
  //         const valB = getNestedValue(b, field);
  //         if (valA == null && valB == null) return 0;
  //         if (valA == null) return -1 * sortOrder;
  //         if (valB == null) return 1 * sortOrder;
  //         if (!isNaN(valA) && !isNaN(valB)) return (Number(valA) - Number(valB)) * sortOrder;
  //         return String(valA).localeCompare(String(valB)) * sortOrder;
  //       });
  //     }

  //     const result = {
  //       data: relatedDataOnly,
  //       meta: { total: meta.total, page: meta.page, pages: meta.pages },
  //     };

  //     await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
  //     return result;
  //   } catch (error) {
  //     throw error;
  //   }
  // }

  public async getAllSecondSales(queryOptions: PaginationOptions, userId: string): Promise<SecondSaleListResponseDto> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}:list:${userId}:${JSON.stringify(queryOptions)}`;
      const cached = await this.cacheService.get<SecondSaleListResponseDto>(cacheKey);
      if (cached) return cached;

      const { data, meta } = await this.docDoubleApproverService.getAllDocumentByUserIdForDoubleApprover(
        userId,
        DocumentTypeEnum.SECOND_SALE,
        queryOptions,
      );
      const { search } = queryOptions;
      const typedDocuments = data as DocumentWithRelatedData[];

      const saleIds = typedDocuments
        .map((doc) => doc.document_type_id)
        .filter(Boolean) as string[];

      let saleMap = new Map<string, any>();
      if (saleIds.length > 0) {
        const sales = await this.secondSaleRepository
          .createQueryBuilder('ss')
          .leftJoin('ss.companyName', 'companyName')
          .leftJoin('ss.location', 'location')
          .select([
            'ss.id', 'ss.secondSaleNo', 'ss.saleDate', 'ss.customerName',
            'ss.customerContactNo', 'ss.customerEmail', 'ss.reasonForSale',
            'ss.totalNetWeight', 'ss.totalGrossWeight', 'ss.totalAmt',
            'ss.totalAmtInWords', 'ss.paidAmount', 'ss.paymentMode',
            'ss.pendingAmt', 'ss.remarks',
            'companyName.name', 'location.name',
          ])
          .where('ss.id IN (:...ids)', { ids: saleIds })
          .andWhere('ss.isDeleted = false')
          .andWhere('ss.deletedAt IS NULL')
          .getMany();

        saleMap = new Map(sales.map((s) => [s.id, s]));
      }

      let relatedDataOnly: SecondSaleListItemDto[] = typedDocuments
        .filter((doc) => doc.document_type_id && saleMap.has(doc.document_type_id))
        .map((doc): SecondSaleListItemDto | null => {
          const rd = saleMap.get(doc.document_type_id!);
          if (!rd) return null;

          const { createdDate, createdTime } = formatDateTime(doc.createdAt);

          return {
            id:               rd.id,
            documentId:       doc.id,
            overAllStatus:    doc.status,
            createdBy:        `${doc.lastActionBy?.firstName ?? ''} ${doc.lastActionBy?.lastName ?? ''}`.trim(),
            createdDate:      createdDate ?? null,
            createdTime:      createdTime ?? null,
            secondSaleNo:     rd.secondSaleNo ?? null,
            saleDate:         rd.saleDate ?? null,
            customerName:     rd.customerName ?? null,
            customerContactNo: rd.customerContactNo ?? null,
            customerEmail:    rd.customerEmail ?? null,
            reasonForSale:    rd.reasonForSale ?? null,
            totalNetWeight:   rd.totalNetWeight ?? null,
            totalGrossWeight: rd.totalGrossWeight ?? null,
            totalAmt:         rd.totalAmt ?? null,
            totalAmtInWords:  rd.totalAmtInWords ?? null,
            paidAmount:       rd.paidAmount ?? null,
            paymentMode:      rd.paymentMode ?? null,
            pendingAmt:       rd.pendingAmt ?? null,
            remarks:          rd.remarks ?? null,
            companyName:      rd.companyName?.name ?? null,
            location:         rd.location?.name ?? null,
          };
        })
        .filter((item): item is SecondSaleListItemDto => item !== null);

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

      const result: SecondSaleListResponseDto = {
        data: relatedDataOnly,
        meta: { total: meta.total, page: meta.page, pages: meta.pages },
      };

      await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
      return result;
    } catch (error) {
      throw error;
    }
  }



  public async getSecondSaleByIdForView(docId: string): Promise<SecondSaleDetailDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:view:${docId}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const document = await this.docDoubleApproverService.getDocumentById(docId);
    const id = document.documentTypeId;
    if (!id) return null;

    const secondSale = await this.secondSaleRepository
      .createQueryBuilder('secondSale')
      .leftJoin('secondSale.secondSaleProducts', 'secondSaleProducts')
      .leftJoin('secondSale.companyName', 'companyName')
      .leftJoin('secondSale.deliveryChallanNo', 'deliveryChallanNo')
      .leftJoin('secondSale.location', 'location')
      .leftJoin('secondSale.customerAddress', 'customerAddress')
      .leftJoin('secondSaleProducts.productName', 'product')
      .leftJoin('secondSaleProducts.variant', 'variant')
      .leftJoin('secondSaleProducts.saleUoM', 'saleUoM')
      .leftJoin('secondSaleProducts.packagingMaterialUoM', 'packagingMaterialUoM')
      .leftJoin('secondSaleProducts.packagingMaterial', 'packagingMaterial')
      .select([
        'secondSale.id', 'secondSale.saleDate', 'secondSale.customerName',
        'secondSale.customerContactNo', 'secondSale.customerEmail',
        'secondSale.reasonForSale', 'secondSale.secondSaleNo',
        'secondSale.totalNetWeight', 'secondSale.totalGrossWeight', 'secondSale.totalAmt',
        'secondSale.totalAmtInWords', 'secondSale.paidAmount', 'secondSale.paymentMode',
        'secondSale.pendingAmt', 'secondSale.remarks', 'secondSale.createdAt',
        'companyName.name', 'location.name', 'deliveryChallanNo.challanNo',
        'customerAddress.id', 'customerAddress.address1', 'customerAddress.address2',
        'customerAddress.city', 'customerAddress.state', 'customerAddress.location', 'customerAddress.pincode',
        'secondSaleProducts.id', 'secondSaleProducts.quantity', 'secondSaleProducts.unitPrice',
        'secondSaleProducts.amount', 'secondSaleProducts.grossWeight',
        'secondSaleProducts.packagingMaterialWeight', 'secondSaleProducts.netWeight',
        'secondSaleProducts.packagingMaterialQuantity', 'secondSaleProducts.packagingMaterialUnitPrice',
        'secondSaleProducts.packagingMaterialAmount', 'secondSaleProducts.packagingMaterialTotalWeight',
        'product.name', 'variant.variantName',
        'saleUoM.unit', 'packagingMaterialUoM.unit', 'packagingMaterial.packagingMaterialName',
      ])
      .where('secondSale.id = :id', { id })
      .getOne();

    if (!secondSale) throw new AppError(404, 'Second Sale not found');

    const { createdDate, createdTime } = formatDateTime(secondSale.createdAt);
    const addr = secondSale.customerAddress;

    const result:SecondSaleDetailDto = {
      id: secondSale.id,
      documentId: document.id,
      overAllStatus: document.overAllStatus,
      createdBy: document.createdBy,
      approvalSummary: document.approvalSummary ?? null,
      companyName: secondSale.companyName?.name ?? null,
      location: secondSale.location?.name ?? null,
      deliveryChallanNo: secondSale.deliveryChallanNo?.challanNo ?? null,
      saleDate: secondSale.saleDate ?? null,
      // createdDate,
      // createdTime,
      customerName: secondSale.customerName ?? null,
      customerContactNo: secondSale.customerContactNo ?? null,
      customerEmail: secondSale.customerEmail ?? null,
      customerAddress: addr ? {
        id: addr.id, address1: addr.address1, address2: addr.address2,
        city: addr.city, state: addr.state, location: addr.location, pincode: addr.pincode,
      } : null,
      reasonForSale: secondSale.reasonForSale ?? null,
      secondSaleNo: secondSale.secondSaleNo ?? null,
      totalNetWeight: secondSale.totalNetWeight ?? null,
      totalGrossWeight: secondSale.totalGrossWeight ?? null,
      totalAmt: secondSale.totalAmt ?? null,
      totalAmtInWords: secondSale.totalAmtInWords ?? null,
      paidAmount: secondSale.paidAmount ?? null,
      paymentMode: secondSale.paymentMode ?? null,
      pendingAmt: secondSale.pendingAmt ?? null,
      remarks: secondSale.remarks ?? null,
      secondSaleProducts: (secondSale.secondSaleProducts ?? []).map((p: any) => ({
        id: p.id,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        amount: p.amount,
        grossWeight: p.grossWeight,
        packagingMaterialWeight: p.packagingMaterialWeight,
        netWeight: p.netWeight,
        packagingMaterialQuantity: p.packagingMaterialQuantity,
        packagingMaterialUnitPrice: p.packagingMaterialUnitPrice,
        packagingMaterialAmount: p.packagingMaterialAmount,
        packagingMaterialTotalWeight: p.packagingMaterialTotalWeight,
        productName: p.productName?.name ?? null,
        variant: p.variant?.variantName ?? null,
        saleUoM: p.saleUoM?.unit ?? null,
        packagingMaterialUoM: p.packagingMaterialUoM?.unit ?? null,
        packagingMaterial: p.packagingMaterial?.packagingMaterialName ?? null,
      })),
    };

    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }
  



  public async getSecondSaleByIdForUpdate(id: string): Promise<SecondSaleDetailDto> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<SecondSaleDetailDto>(cacheKey);
    if (cached) return cached;

    const secondSale = await this.secondSaleRepository
      .createQueryBuilder('secondSale')
      .leftJoin('secondSale.secondSaleProducts', 'secondSaleProducts')
      .leftJoin('secondSale.companyName', 'companyName')
      .leftJoin('secondSale.deliveryChallanNo', 'deliveryChallanNo')
      .leftJoin('secondSale.location', 'location')
      .leftJoin('secondSale.customerAddress', 'customerAddress')
      .leftJoin('secondSaleProducts.productName', 'product')
      .leftJoin('secondSaleProducts.variant', 'variant')
      .leftJoin('secondSaleProducts.saleUoM', 'saleUoM')
      .leftJoin('secondSaleProducts.packagingMaterialUoM', 'packagingMaterialUoM')
      .leftJoin('secondSaleProducts.packagingMaterial', 'packagingMaterial')
      .select([
        'secondSale.id', 'secondSale.saleDate', 'secondSale.customerName',
        'secondSale.customerContactNo', 'secondSale.customerEmail',
        'secondSale.reasonForSale', 'secondSale.secondSaleNo',
        'secondSale.totalNetWeight', 'secondSale.totalGrossWeight', 'secondSale.totalAmt',
        'secondSale.totalAmtInWords', 'secondSale.paidAmount', 'secondSale.paymentMode',
        'secondSale.pendingAmt', 'secondSale.remarks', 'secondSale.createdAt',
        'companyName.id', 'location.id', 'deliveryChallanNo.id',
        'customerAddress.id', 'customerAddress.address1', 'customerAddress.address2',
        'customerAddress.city', 'customerAddress.state', 'customerAddress.location', 'customerAddress.pincode',
        'secondSaleProducts.id', 'secondSaleProducts.quantity', 'secondSaleProducts.unitPrice',
        'secondSaleProducts.amount', 'secondSaleProducts.grossWeight',
        'secondSaleProducts.packagingMaterialWeight', 'secondSaleProducts.netWeight',
        'secondSaleProducts.packagingMaterialQuantity', 'secondSaleProducts.packagingMaterialUnitPrice',
        'secondSaleProducts.packagingMaterialAmount', 'secondSaleProducts.packagingMaterialTotalWeight',
        'product.id', 'variant.id', 'saleUoM.id', 'packagingMaterialUoM.id', 'packagingMaterial.id',
      ])
      .where('secondSale.id = :id', { id })
      .getOne();

    if (!secondSale) throw new AppError(404, 'Second Sale not found');

    const { createdDate, createdTime } = formatDateTime(secondSale.createdAt);
    const addr = secondSale.customerAddress;

    const formatResponse:SecondSaleDetailDto = {
      id: secondSale.id,
      companyName: secondSale.companyName?.id ?? null,
      location: secondSale.location?.id ?? null,
      deliveryChallanNo: secondSale.deliveryChallanNo?.id ?? null,
      saleDate: secondSale.saleDate ?? null,
      // createdDate,
      // createdTime,
      customerName: secondSale.customerName ?? null,
      customerContactNo: secondSale.customerContactNo ?? null,
      customerEmail: secondSale.customerEmail ?? null,
      reasonForSale: secondSale.reasonForSale ?? null,
      secondSaleNo: secondSale.secondSaleNo ?? null,
      customerAddress: addr ? {
        id: addr.id, address1: addr.address1, address2: addr.address2,
        city: addr.city, state: addr.state, location: addr.location, pincode: addr.pincode,
      } : null,
      totalNetWeight: secondSale.totalNetWeight ?? null,
      totalGrossWeight: secondSale.totalGrossWeight ?? null,
      totalAmt: secondSale.totalAmt ?? null,
      totalAmtInWords: secondSale.totalAmtInWords ?? null,
      paidAmount: secondSale.paidAmount ?? null,
      paymentMode: secondSale.paymentMode ?? null,
      pendingAmt: secondSale.pendingAmt ?? null,
      remarks: secondSale.remarks ?? null,
      secondSaleProducts: (secondSale.secondSaleProducts ?? []).map((p: SecondSaleProduct) => ({
        id: p.id,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        amount: p.amount,
        grossWeight: p.grossWeight,
        packagingMaterialWeight: p.packagingMaterialWeight,
        netWeight: p.netWeight,
        packagingMaterialQuantity: p.packagingMaterialQuantity,
        packagingMaterialUnitPrice: p.packagingMaterialUnitPrice,
        packagingMaterialAmount: p.packagingMaterialAmount,
        packagingMaterialTotalWeight: p.packagingMaterialTotalWeight,
        productName: p.productName?.id ?? null,
        variant: p.variant?.id ?? null,
        saleUoM: p.saleUoM?.id ?? null,
        packagingMaterialUoM: p.packagingMaterialUoM?.id ?? null,
        packagingMaterial: p.packagingMaterial?.id ?? null,
      })),
    };

    await this.cacheService.set(cacheKey, formatResponse, this.CACHE_TTL);
    return formatResponse;
  }


  public async updateSecondSale(
    id: string,
    secondSaleData: UpdateSecondSaleDto,
    updatedBy: string
  ): Promise<any> {

    const secondSale = await this.secondSaleRepository.findOne({
      where: { id },
    });
    
    if (!secondSale) {
      return null;
    }
 
    const oldData = { ...secondSale }; // Save old data for audit log

    // Update the Second Sale entity
    Object.assign(secondSale, secondSaleData);
    const updatedSecondSale = await this.secondSaleRepository.save(secondSale);

    await this.auditLogService.logChange(
      "SecondSale",
      id,
      oldData,
      updatedSecondSale,
      updatedBy,
    );

    await this.invalidateCache(id);
    return updatedSecondSale;
  }

  // Method to delete a Second Sale document (schedule deletion 6 months later)
  public async deleteSecondSale(id: string): Promise<DeleteResultDto | null> {
    // Step 1: Find the Second Sale by ID
    const secondSale = await this.secondSaleRepository.findOne({
      where: { id },
    });

    // Step 2: If the Second Sale doesn't exist, return false
    if (!secondSale) {
      throw new Error("Second sale not exits");
       new AppError;
    }

    // Step 3: Calculate the date 6 months ahead
    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6); // Adds 6 months to the current date
    sixMonthsFromNow.setHours(0, 0, 0, 0); // Optionally, set the time to midnight (00:00:00)

    // Log the scheduled deletion
    
    secondSale.deletionScheduledAt = sixMonthsFromNow;
    await this.secondSaleRepository.save(secondSale);
    await this.invalidateCache(id);

    if(!secondSale.secondSaleNo){
         return null;
    }
     return {No:secondSale.secondSaleNo}; 
  }

  public async deleteMultipleSecondSale(ids: string[]): Promise<BulkDeleteResultDto> {
    const success:{id: string; No: string }[] = [];
    const failed: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const secondSale = await this.secondSaleRepository.findOne({
        where: { id },
      });

      if (!secondSale) {
        failed.push({ id, reason: 'Second Sale not found' });
        continue;
      }

      const relatedDocument = await this.documentbRepository.findOne({
        where: { document_type_id: secondSale.id }
      });

      if (!relatedDocument) {
        throw new Error(`Something went wrong`);
      }

      await this.documentbRepository.softDelete(relatedDocument.id);
      await this.documentbRepository.update(relatedDocument.id, { isDeleted: true } as any);

      await this.secondSaleRepository.softDelete(secondSale.id);
      await this.secondSaleRepository.update(secondSale.id, { isDeleted: true } as any);

      if(secondSale.secondSaleNo)
      success.push({id,No:secondSale.secondSaleNo})
    }
    const message = `Deletion completed. Success: ${success.length}, Failed: ${failed.length}`;
    await this.invalidateCache();
    
    return { success, failed, message };

  }
}


  // public async getSecondSaleById(id: string): Promise<SecondSale | null> {
  //   const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
  //   const cached = await this.cacheService.get<SecondSale>(cacheKey);
  //   if (cached) return cached;

  //   try {
  //     const secondSale = await this.secondSaleRepository
  //       .createQueryBuilder("secondSale")
  //       .leftJoinAndSelect("secondSale.secondSaleProducts", "secondSaleProducts")
  //       .leftJoinAndSelect("secondSale.companyName", "companyName")
  //       .leftJoinAndSelect("secondSale.deliveryChallanNo", "deliveryChallanNo")
  //       .leftJoinAndSelect("secondSale.location", "location")
  //       .leftJoinAndSelect("secondSale.customerAddress", "customerAddress")
  //       .leftJoinAndSelect("secondSaleProducts.productName", "product")
  //       .leftJoinAndSelect("secondSaleProducts.variant", "variant")
  //       .leftJoinAndSelect("secondSaleProducts.saleUoM", "saleUoM")
  //       .leftJoinAndSelect("secondSaleProducts.packagingMaterial", "packagingMaterial")
  //       .select([
  //         "secondSale",
  //         "secondSaleProducts.id",
  //         "secondSaleProducts.quantity",
  //         "secondSaleProducts.unitPrice",
  //         "secondSaleProducts.amount",
  //         "secondSaleProducts.grossWeight",
  //         "secondSaleProducts.packingMaterialWeight",
  //         "secondSaleProducts.netWeight",
  //         "secondSaleProducts.packagingMaterialQuantity",
  //         "secondSaleProducts.packagingMaterialUnitPrice",
  //         "secondSaleProducts.packagingMaterialAmount",
  //         "location.id",
  //         "location.name",
  //         "companyName.id",
  //         "companyName.name",
  //         "deliveryChallanNo.id",
  //         "deliveryChallanNo.challanNo",
  //         "customerAddress.id",
  //         "product.id",
  //         "product.name",
  //         "variant.id",
  //         "variant.name",
  //         "saleUoM.id",
  //         "saleUoM.unit",
  //         "packagingMaterial.id",
  //         "packagingMaterial.name",
  //       ])
  //       .where("secondSale.id = :id", { id })
  //       .getOne();
  //     if (secondSale) await this.cacheService.set(cacheKey, secondSale, this.CACHE_TTL);
  //     return secondSale || null;
  //   } catch (error) {
  //     logger.error("Error fetching SecondSale by ID:", error);
  //     throw error;
  //   }
  // }

