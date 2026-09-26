import { inject, injectable } from 'inversify';
import { CustomerDeliveryChallanRepository } from '../repository/customerDeliveryChallan.repository';
import { TYPES } from '../../../types';
import logger from '../../../utils/logger';
import { buildQuery, PaginationOptions } from '../../../utils/pagination';
import { formatDateTime } from '../../../utils/dateUtils';
import AppError from '../../../utils/appError';
import { CustomerRepository } from '../../../customer/addcustomer/repository/customer.repository';

import { DocumentTypeEnum } from '../../../approvalFlow/entity/docuemnt.entity';
import { DocumentStatus } from '../../../approvalFlow/entity/docuemnt.entity';
import { DocumentTypeEnum as DocDefEnum } from '../../../documentDef/entity/documentdef.entity';

import { LessThanOrEqual, DataSource, In, IsNull } from 'typeorm';
import { InventoryStockRepository } from '../../../inventoryStock/repository/inventoryStock.repository';
import { DitemRepository } from '../../deliverychllan/repository/dItem.repository';
import { ProductVarientsRepository } from '../../../product/productVarient/repository/productVarients.repository';
import { ProductRepository } from '../../../product/createproduct/repository/product.repository';

import { ProductVarientRepository } from '../../../product/productVarient/repository/varients.repository';
;
import { format } from 'date-fns';
import { CacheService } from '../../../global/cache.service';
import { 
  CreateCustomerDeliveryChallanDto,
  
  CustomerDeliveryChallanListResponseDto,
  
  CustomerDeliveryChallanUpdateFormDto,
  
  CustomerDeliveryChallanViewDto,
  
  DeleteCustomerDeliveryChallanResultDto,
  
  UpdateCustomerDeliveryChallanDto,

} from '../dto/customerDeliveryChallan.dto';
import { BulkDeleteResultDto } from '../../../global/general.dto';
import { DocumentbService, DocumentWithRelatedData } from '../../../approvalFlow/service/documentb.service';
import { DocDoubleApproverService } from '../../../approvalFlow/service/docDoubleApprover.service';
import { DeliveryChallanService } from '../../deliverychllan/service/deliveryChallan.service';
import { ProductVarientService } from '../../../product/productVarient/service/productVarient.service';
import { ApprovalFlowService } from '../../../approvalFlow/service/approvalFlow.service';
import { DocumentbRepository } from '../../../approvalFlow/repository/documentb.repository';
import { CustomerDeliveryChallan } from '../entity/customerDeliveryChallan.entity';

const CACHE_PREFIX = 'cdc';
const CACHE_TTL = 180;
const CACHE_TTL_DETAIL = 300;

@injectable()
export class CustomerDeliveryChallanService {
  constructor(
    @inject(TYPES.CustomerDeliveryChallanRepository)
    private challanRepository: CustomerDeliveryChallanRepository,
    @inject(TYPES.CustomerRepository) private customerRepo: CustomerRepository,
    @inject(TYPES.DocumentbService)
    private readonly documentbService: DocumentbService,
    @inject(TYPES.ProductVarientRepository)
    private productVarientsRepository: ProductVarientRepository,
    @inject(TYPES.DocDoubleApproverService)
    private readonly docDoubleApproverService: DocDoubleApproverService,
    @inject(TYPES.DeliveryChallanService)
    private readonly deliveryChallanService: DeliveryChallanService,
    @inject(TYPES.ProductVarientsRepository)
    private readonly variantRepository: ProductVarientsRepository,
    @inject(TYPES.ProductVarientService)
    private readonly productVarientService: ProductVarientService,

    @inject(TYPES.ProductRepository)
    private readonly productRepository: ProductRepository,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
    @inject(TYPES.ApprovalFlowService)
    private approvalFlowService: ApprovalFlowService,
    @inject(TYPES.InventoryStockRepository)
    private readonly inventoryStockRepository: InventoryStockRepository,
    @inject(TYPES.DitemRepository)
    private readonly deliveryChallanProductRepository: DitemRepository,
     @inject(TYPES.DocumentbRepository)
    private readonly documentbRepository: DocumentbRepository,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) { }

  // ─── Cache Helpers ────────────────────────────────────────────────────────
  // Public because other modules write delivery-challan data and must bust these
  // keys: Return By Customer updates the challan items' returned/rejected/accepted
  // quantities, which the view, update and list responses all carry.
  // `id` is the delivery challan id.
  public async invalidateCDCCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${CACHE_PREFIX}:update:${id}`),
        // The view cache is keyed by the Documentb id (the /view/:docid route
        // param), not by this record's own id, so it can only be busted by
        // pattern from here.
        this.cacheService.invalidatePattern(`${CACHE_PREFIX}:view:*`),
        this.cacheService.del(`${CACHE_PREFIX}:net:${id}`),
        this.cacheService.del(`${CACHE_PREFIX}:returnStatus:${id}`),
      );
    }
    await Promise.all(tasks);
  }


  public async generateVoucherNo(type: string = 'C'): Promise<string> {
    const today = new Date();
    const formattedDate = format(today, 'yyyyMMdd');
    const typeCode = type.toUpperCase();

    // Count all challans of this type to get next serial
    const count = await this.challanRepository
      .createQueryBuilder('deliveryChallan')
      .where('deliveryChallan.challanNo LIKE :pattern', {
        pattern: `CN%${typeCode}%`,
      })
      .getCount();

    const serialStr = (count + 1).toString().padStart(5, '0');
    return `CN${formattedDate}${typeCode}${serialStr}`;
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

  async create(data: CreateCustomerDeliveryChallanDto & Record<string, any>, requestedBy: string): Promise<CustomerDeliveryChallan> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(requestedBy, DocDefEnum.SALE);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Validate approval flow exists before doing anything else
      // const approvalFlow = await this.approvalFlowService.findApprovalFlowForLoggedUser(requestedBy, DocDefEnum.SALE);

      // if (!approvalFlow) {
      //   throw new AppError(400, 'No approval flow configured for this user. Please contact the admin to create an approval flow before creating a Customer Delivery Challan.');
      // }

      // 2. Fetch Customer
      const cus = await queryRunner.manager.findOne(this.customerRepo.target, {
        where: { id: data.partyName ?? undefined },
        relations: [
          'billingDetails.billingAddress',
          'deliveryDetails.deliveryAddress',
        ],
      });

      if (!cus) {
        throw new AppError(400, `Customer with id ${data.partyName} not found`);
      }

      // 2. Auto-set billing / delivery address
      if (!data.billingDetails || !data.deliveryDetails) {
        data.billingAddress = cus.billingDetails.billingAddress;
        data.deliveryAddress = cus.deliveryDetails.deliveryAddress;
      } else {
        data.billingAddress = data.billingDetails.billingAddress;
        data.deliveryAddress = data.deliveryDetails.deliveryAddress;
      }

      // 3. Generate Challan No
      data.challanNo = await this.generateVoucherNo(data.type || 'C');

      // 4. Normalize variants list
      let variantIds: string[] = [];
      if (Array.isArray(data.variants)) variantIds = data.variants;
      else if (data.variants) variantIds = [data.variants];

      // 5. Fetch variants
      const variants = await queryRunner.manager.find(this.productVarientsRepository.target, {
        where: { id: In(variantIds) },
        relations: ['product'],
      });

      // 6. Extract product IDs
      const productIds = variants.map(v => v.product?.id).filter((id): id is string => Boolean(id));

      // 7. VALIDATE STOCK BEFORE CREATING CHALLAN
      if (data.deliveryChallanProducts && data.deliveryChallanProducts.length > 0) {
        for (const item of data.deliveryChallanProducts) {
          const deliveredQty = Number(item.netWeight ?? 0);
          const variantId = typeof item.variant === 'object' && item.variant ? item.variant.id : (item.variant ?? null);
          const productId = typeof item.productName === 'object' && item.productName ? item.productName.id : (item.productName ?? null);

          if (!productId) {
            throw new AppError(400, `Product missing`);
          }

          let productInfo;
          
          // If variant exists, fetch variant with product
          if (variantId) {
            const variant = await queryRunner.manager.findOne(this.productVarientsRepository.target, {
              where: { id: variantId },
              relations: ['product'],
            });

            if (!variant) {
              throw new AppError(400, `Variant with id ${variantId} not found`);
            }
            
            productInfo = {
              productId: variant.product.id,
              productName: variant.product.name,
              variantId: variant.id,
              variantName: variant.variantName
            };
          } else {
            // No variant - fetch product directly
            const product = await queryRunner.manager.findOne(this.productRepository.target, {
              where: { id: productId }
            });

            if (!product) {
              throw new AppError(400, `Product with id ${productId} not found`);
            }

            productInfo = {
              productId: product.id,
              productName: product.name,
              variantId: null,
              variantName: null
            };
          }

          // Check existing inventory stock
          const stockWhere: any = {
            company: { id: typeof data.companyName === 'string' ? data.companyName : (data.companyName as any)?.id },
            location: { id: typeof data.fromLocation === 'string' ? data.fromLocation : (data.fromLocation as any)?.id },
            product: { id: productInfo.productId },
          };

          // Add variant condition only if variant exists
          if (productInfo.variantId) {
            stockWhere.variant = { id: productInfo.variantId };
          } else {
            stockWhere.variant = IsNull();
          }

          const existingStock = await queryRunner.manager.findOne(this.inventoryStockRepository.target, {
            where: stockWhere,
            relations: ['product', 'variant'],
          });

          if (!existingStock) {
            throw new AppError(
              400,
              `Insufficient stock: No inventory found for product "${productInfo.productName}" ${productInfo.variantName ? `(variant: ${productInfo.variantName})` : ''} at this location`
            );
          }

          // Check if sufficient quantity is available
          const availableQty = Number(existingStock.inwardQty || 0);
          if (availableQty < deliveredQty) {
            throw new AppError(
              400,
              `Insufficient stock: Required ${deliveredQty} units but only ${availableQty} units available for product "${productInfo.productName}" ${productInfo.variantName ? `(variant: ${productInfo.variantName})` : ''}`
            );
          }
        }
      }

      // 8. Create challan (only after stock validation passes)
      const challan = queryRunner.manager.create(this.challanRepository.target, {
        ...data,
        variants: variants.map(v => ({ id: v.id })),
        products: productIds.map(id => ({ id })),
      } as any) as unknown as CustomerDeliveryChallan;

      const savedChallan = await queryRunner.manager.save(challan);

      // 10. Auto-create document
      const actualChallan = Array.isArray(savedChallan) ? savedChallan[0] : savedChallan;

      const document = await this.documentbService.createDocument({
        type: DocumentTypeEnum.DC_TYPE_CUSTOMER,
        docDef: DocDefEnum.SALE,
        status: DocumentStatus.HOLD,
        remarks: 'Document auto-created with Customer-DC',
        lastActionBy: { id: requestedBy },
        document_type_id: actualChallan.id,
      });

      // 10. Inventory is NOT reduced here.
      //     The stock check above stays so the user gets an immediate 400 if the
      //     goods are not available, but the actual stock movement happens only
      //     when this challan's document reaches DocumentStatus.COMPLETE —
      //     see InventoryMovementService.applyCustomerDeliveryChallan(), which
      //     re-validates availability at that point.

      // Commit transaction - all operations succeeded
      await queryRunner.commitTransaction();

      // Start approval flow after commit so challan is visible to other DB connections
      await this.documentbService.startApprovalFlow(document.id);
      await this.invalidateCDCCache();

      return actualChallan;

    } catch (error: any) {
      // Rollback transaction - undo all changes
      await queryRunner.rollbackTransaction();
      logger.error('Error creating Delivery Challan:', error);
      // Re-throw AppError instances (like insufficient stock) to preserve the error message
      if (error instanceof AppError) {
        throw error;
      }
      throw error;
    } finally {
      // Release query runner
      await queryRunner.release();
    }
  }



  public async getByIdCustomerDeliveryChallanforUpdate(
    id: string,
  ): Promise<{ data: CustomerDeliveryChallanUpdateFormDto } | null> {
    const key = `${CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const challan = await this.challanRepository
      .createQueryBuilder('challan')
      .leftJoin('challan.deliveryChallanProducts', 'products')
      .leftJoin('challan.fromLocation', 'fromLocation')
      .leftJoin('products.productName', 'productName')
      .leftJoin('products.variant', 'variant')
      .leftJoin('products.packagingMaterial', 'packagingMaterial')
      .leftJoin('products.packagingMaterialUoM', 'packagingMaterialUoM')
      .leftJoin('products.saleUoM', 'saleUoM')
      .leftJoin('challan.customerName', 'customerName')
      .leftJoin('challan.billingAddress', 'billingAddress')
      .leftJoin('challan.deliveryAddress', 'deliveryAddress')
      .leftJoin('challan.currentShippingAddress','currentShippingAddress')
      .leftJoin('challan.companyName', 'companyName')
      .leftJoin('challan.offices', 'office')
      .leftJoin('challan.grnNo', 'grn')
      .select([
        'challan.id', 'challan.challanNo', 'challan.poNumber', 'challan.transitInsuranceNo',
        'challan.driverName', 'challan.contactNo', 'challan.altContactNo',
        'challan.vehicleNo', 'challan.licenseNo', 'challan.receiverName', 'challan.rmn',
        'challan.totalProductAmount', 'challan.netProductWeight',
        'challan.netPackagingMaterialWeight', 'challan.totalPackagingMaterialAmount',
        'challan.totalAmtInWords', 'challan.requestingDepartment',
        'challan.remark', 'challan.anyAttachment', 'challan.createdAt',
        'fromLocation.id', 'customerName.id',
        'billingAddress.id', 'billingAddress.address1', 'billingAddress.address2',
        'billingAddress.location', 'billingAddress.city', 'billingAddress.state', 'billingAddress.pincode',
        'deliveryAddress.id', 'deliveryAddress.address1', 'deliveryAddress.address2',
        'deliveryAddress.location', 'deliveryAddress.city', 'deliveryAddress.state', 'deliveryAddress.pincode',
        'currentShippingAddress.id', 'currentShippingAddress.address1', 'currentShippingAddress.address2',
        'currentShippingAddress.location', 'currentShippingAddress.city', 'currentShippingAddress.state', 'currentShippingAddress.pincode',
        'companyName.id', 'office.id', 'grn.id',
        'products.id', 'products.quantity', 'products.unitPrice', 'products.amount',
        'products.netWeight', 'products.grossWeight',
        'products.acceptedQty', 'products.rejectedQty', 'products.returnedQty',
        'products.changedQty', 'products.changedPrice',
        'products.packagingMaterialAmount', 'products.packagingMaterialUnitPrice',
        'products.packagingMaterialQuantity', 'products.packagingMaterialTotalWeight',
        'products.packingMaterialWeight',
        'productName.id', 'variant.id',
        'saleUoM.id', 'packagingMaterial.id', 'packagingMaterialUoM.id',
      ])
      .where('challan.id = :id', { id })
      .getOne();

    if (!challan) throw new AppError(400, `Delivery Challan with id ${id} not found`);

    const { createdDate, createdTime } = formatDateTime(challan.createdAt);
    const mapAddress = (addr: any) => addr ? {
      id: addr.id, address1: addr.address1, address2: addr.address2,
      location: addr.location, city: addr.city, state: addr.state, pincode: addr.pincode,
    } : null;

    const formattedChallan = {
      id: challan.id,
      challanNo: challan.challanNo,
      poNumber: challan.poNumber ?? null,
      customerName: challan.customerName?.id ?? null,
      fromLocation: challan.fromLocation?.id ?? null,
      transitInsuranceNo: challan.transitInsuranceNo ?? null,
      billingAddress: mapAddress(challan.billingAddress),
      deliveryAddress: mapAddress(challan.deliveryAddress),
      currentShippingAddress: mapAddress(challan.currentShippingAddress),
      companyName: challan.companyName?.id ?? null,
      office: challan.offices?.id ?? null,
      grnNo: challan.grnNo?.id ?? null,
      driverName: challan.driverName ?? null,
      contactNo: challan.contactNo ?? null,
      altContactNo: challan.altContactNo ?? null,
      vehicleNo: challan.vehicleNo ?? null,
      licenseNo: challan.licenseNo ?? null,
      receiverName: challan.receiverName ?? null,
      rmn: challan.rmn ?? null,
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
      deliveryChallanProducts: (challan.deliveryChallanProducts ?? []).map((p) => ({
        id: p.id,
        productName: p.productName?.id ?? null,
        variant: p.variant?.id ?? null,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        amount: p.amount,
        netWeight: p.netWeight,
        grossWeight: p.grossWeight,
        acceptedQty: p.acceptedQty,
        rejectedQty: p.rejectedQty,
        returnedQty: p.returnedQty ?? 0,
        changedQty: p.changedQty,
        changedPrice: p.changedPrice,
        saleUoM: p.saleUoM?.id ?? null,
        packagingMaterial: p.packagingMaterial?.id ?? null,
        packagingMaterialUoM: p.packagingMaterialUoM?.id ?? null,
        packagingMaterialAmount: p.packagingMaterialAmount,
        packingMaterialWeight: p.packingMaterialWeight ?? null,
        packagingMaterialUnitPrice: p.packagingMaterialUnitPrice,
        packagingMaterialQuantity: p.packagingMaterialQuantity,
        packagingMaterialTotalWeight: p.packagingMaterialTotalWeight,
      })),
    };

    const result = { data: formattedChallan };
    await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
    return result;
  }



  
  public async getByIdCustomerDeliveryChallanForView(
    docId: string,
  ): Promise<{ data: CustomerDeliveryChallanViewDto } | null> {
    const key = `${CACHE_PREFIX}:view:${docId}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const document = await this.docDoubleApproverService.getDocumentById(docId);
    const id = document.documentTypeId;
    if (!id) return null;

    const challan = await this.challanRepository
      .createQueryBuilder('challan')
      .leftJoin('challan.deliveryChallanProducts', 'products')
      .leftJoin('challan.fromLocation', 'fromLocation')
      .leftJoin('products.productName', 'productName')
      .leftJoin('products.packagingMaterial', 'packagingMaterial')
      .leftJoin('products.variant', 'variant')
      .leftJoin('products.packagingMaterialUoM', 'packagingMaterialUoM')
      .leftJoin('products.saleUoM', 'saleUoM')
      .leftJoin('challan.customerName', 'customerName')
      .leftJoin('challan.billingAddress', 'billingAddress')
      .leftJoin('challan.deliveryAddress', 'deliveryAddress')
      .leftJoin('challan.currentShippingAddress','currentShippingAddress')
      .leftJoin('challan.companyName', 'company')
      .leftJoin('challan.offices', 'office')
      .leftJoin('challan.grnNo', 'grn')
      .select([
        'challan.id', 'challan.challanNo', 'challan.poNumber', 'challan.transitInsuranceNo',
        'challan.driverName', 'challan.contactNo', 'challan.altContactNo',
        'challan.vehicleNo', 'challan.licenseNo', 'challan.receiverName',
        'challan.totalProductAmount', 'challan.netProductWeight',
        'challan.netPackagingMaterialWeight', 'challan.totalPackagingMaterialAmount',
        'challan.totalAmtInWords', 'challan.requestingDepartment',
        'challan.remark', 'challan.anyAttachment', 'challan.createdAt',
        'challan.isInvoiceCreated', 'challan.isReturned', 'challan.isReturnByCustomerCreated',
        'fromLocation.name',
        'customerName.organisationName',
        'billingAddress.id', 'billingAddress.address1', 'billingAddress.address2',
        'billingAddress.location', 'billingAddress.city', 'billingAddress.state', 'billingAddress.pincode',
        'deliveryAddress.id', 'deliveryAddress.address1', 'deliveryAddress.address2',
        'deliveryAddress.location', 'deliveryAddress.city', 'deliveryAddress.state', 'deliveryAddress.pincode',
         'currentShippingAddress.id', 'currentShippingAddress.address1', 'currentShippingAddress.address2',
        'currentShippingAddress.location', 'currentShippingAddress.city', 'currentShippingAddress.state', 'currentShippingAddress.pincode',
        'company.name', 'office.name', 'grn.grnNo',
        'products.id', 'products.quantity', 'products.unitPrice', 'products.amount',
        'products.netWeight', 'products.grossWeight',
        'products.acceptedQty', 'products.returnedQty', 'products.rejectedQty',
        'products.changedQty', 'products.changedPrice',
        'products.packagingMaterialAmount', 'products.packagingMaterialUnitPrice',
        'products.packagingMaterialQuantity', 'products.packagingMaterialTotalWeight',
        'productName.name', 'variant.variantName',
        'saleUoM.unit', 'packagingMaterial.packagingMaterialName', 'packagingMaterialUoM.unit',
      ])
      .where('challan.id = :id', { id })
      .getOne();

    if (!challan) throw new AppError(400, `Delivery Challan with id ${id} not found`);

    const { createdDate, createdTime } = formatDateTime(challan.createdAt);
    const mapAddress = (addr: any) => addr ? {
      id: addr.id, address1: addr.address1, address2: addr.address2,
      location: addr.location, city: addr.city, state: addr.state, pincode: addr.pincode,
    } : null;

    const formattedChallan = {
      id: challan.id,
      documentId: document.id,
      challanNo: challan.challanNo,
      poNumber: challan.poNumber ?? null,
      customerName: challan.customerName?.organisationName ?? null,
      transitInsuranceNo: challan.transitInsuranceNo ?? null,
      fromLocation: challan.fromLocation?.name ?? null,
      billingAddress: mapAddress(challan.billingAddress),
      deliveryAddress: mapAddress(challan.deliveryAddress),
      currentShippingAddress: mapAddress(challan.currentShippingAddress),
      companyName: challan.companyName?.name ?? null,
      office: challan.offices?.name ?? null,
      grnNo: challan.grnNo?.grnNo ?? null,
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
      isInvoiceCreated: challan.isInvoiceCreated ?? false,
      isReturned: challan.isReturned ?? false,
      isReturnByCustomerCreated: (challan as any).isReturnByCustomerCreated ?? false,
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
        acceptedQty: p.acceptedQty,
        returnedQty: p.returnedQty,
        rejectedQty: p.rejectedQty,
        changedQty: p.changedQty,
        changedPrice: p.changedPrice,
        saleUoM: p.saleUoM?.unit ?? null,
        packingMaterial: p.packagingMaterial?.packagingMaterialName ?? null,
        packagingMaterialUoM: p.packagingMaterialUoM?.unit ?? null,
        packagingMaterialAmount: p.packagingMaterialAmount,
        packagingMaterialUnitPrice: p.packagingMaterialUnitPrice,
        packagingMaterialQuantity: p.packagingMaterialQuantity,
        packagingMaterialTotalWeight: p.packagingMaterialTotalWeight,
      })),
    };

    const viewResult = { data: formattedChallan };
    await this.cacheService.set(key, viewResult, CACHE_TTL_DETAIL);
    return viewResult;
  }





  public async getAllCustomerDeliveryChallans(
    queryOptions: PaginationOptions,
    userId: string,
  ): Promise<CustomerDeliveryChallanListResponseDto> {
    const key = `${CACHE_PREFIX}:list:${userId}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const { data, meta } =
      await this.docDoubleApproverService.getAllDocumentByUserIdForDoubleApprover(
        userId,
        DocumentTypeEnum.DC_TYPE_CUSTOMER,
        queryOptions,
      );

    const typedDocuments = data as DocumentWithRelatedData[];

    const challanIds = typedDocuments
      .map((doc) => doc.document_type_id)
      .filter(Boolean);

    let challanMap = new Map<string, any>();
    if (challanIds.length > 0) {
      const challans = await this.challanRepository
        .createQueryBuilder('challan')
        .leftJoin('challan.customerName', 'customerName')
        .leftJoin('challan.fromLocation', 'fromLocation')
        .leftJoin('challan.billingAddress', 'billingAddress')
        .leftJoin('challan.deliveryAddress', 'deliveryAddress')
        .leftJoin('challan.currentShippingAddress','currentShippingAddress')
        .leftJoin('challan.companyName', 'company')
        .leftJoin('challan.offices', 'office')
        .leftJoin('challan.grnNo', 'grn')
        .leftJoin('challan.deliveryChallanProducts', 'products')
        .select([
          'challan.id', 'challan.challanNo', 'challan.poNumber', 'challan.transitInsuranceNo',
          'challan.isReturned', 'challan.totalProductAmount', 'challan.netProductWeight',
          'challan.netPackagingMaterialWeight', 'challan.totalPackagingMaterialAmount',
          'challan.totalAmtInWords', 'challan.driverName', 'challan.licenseNo',
          'challan.contactNo', 'challan.altContactNo', 'challan.vehicleNo',
          'challan.receiverName', 'challan.rmn', 'challan.remark', 'challan.anyAttachment',
          'customerName.organisationName',
          'fromLocation.id', 'fromLocation.name',
          'billingAddress.id', 'billingAddress.address1', 'billingAddress.address2',
          'billingAddress.location', 'billingAddress.city', 'billingAddress.state', 'billingAddress.pincode',
          'deliveryAddress.id', 'deliveryAddress.address1', 'deliveryAddress.address2',
          'deliveryAddress.location', 'deliveryAddress.city', 'deliveryAddress.state', 'deliveryAddress.pincode',
           'currentShippingAddress.id', 'currentShippingAddress.address1', 'currentShippingAddress.address2',
        'currentShippingAddress.location', 'currentShippingAddress.city', 'currentShippingAddress.state', 'currentShippingAddress.pincode',
          'company.id', 'company.name',
          'office.id', 'office.name',
          'grn.grnNo',
          'products.id',
          'products.packagingMaterialQuantity', 'products.packagingMaterialUnitPrice',
          'products.packagingMaterialAmount', 'products.packagingMaterialTotalWeight',
          'products.amount', 'products.unitPrice',
          'products.grossWeight', 'products.netWeight',
        ])
        .where('challan.id IN (:...ids)', { ids: challanIds })
        .andWhere('challan.isDeleted = false')
        .andWhere('challan.deletedAt IS NULL')
        .getMany();

      challanMap = new Map(challans.map((c) => [c.id, c]));
    }

    const mapAddress = (addr: any) => addr ? {
      id: addr.id, address1: addr.address1, address2: addr.address2,
      location: addr.location, city: addr.city, state: addr.state, pincode: addr.pincode,
    } : null;

    const relatedDataOnly = typedDocuments
      .filter((doc) => doc.document_type_id && challanMap.has(doc.document_type_id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((doc) => {
        const challan = challanMap.get(doc.document_type_id!);
        if (!challan) return null;
        const { createdDate, createdTime } = formatDateTime(doc.createdAt);
        return {
          id: challan.id,
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: `${doc.lastActionBy.firstName} ${doc.lastActionBy.lastName}`,
          createdDate,
          createdTime,
          challanNo: challan.challanNo,
          poNumber: challan.poNumber ?? null,
          customerName: challan.customerName?.organisationName ?? null,
          billingAddress: mapAddress(challan.billingAddress),
          deliveryAddress: mapAddress(challan.deliveryAddress),
          currentShippingAddress:mapAddress(challan.currentShippingAddress),
          fromLocation: challan.fromLocation ? { id: challan.fromLocation.id, name: challan.fromLocation.name } : null,
          transitInsuranceNo: challan.transitInsuranceNo ?? null,
          grnNo: challan.grnNo?.grnNo ?? null,
          companyName: challan.companyName ? { id: challan.companyName.id, name: challan.companyName.name } : null,
          office: challan.offices?.name ?? null,
          netProductWeight: challan.netProductWeight ?? null,
          netPackagingMaterialWeight: challan.netPackagingMaterialWeight ?? null,
          totalPackagingMaterialAmount: challan.totalPackagingMaterialAmount ?? null,
          totalProductAmount: challan.totalProductAmount ?? null,
          totalAmtInWords: challan.totalAmtInWords ?? null,
          driverName: challan.driverName ?? null,
          licenseNo: challan.licenseNo ?? null,
          contactNo: challan.contactNo ?? null,
          altContactNo: challan.altContactNo ?? null,
          vehicleNo: challan.vehicleNo ?? null,
          receiverName: challan.receiverName ?? null,
          rmn: challan.rmn ?? null,
          remark: challan.remark ?? null,
          anyAttachment: challan.anyAttachment ?? null,
          deliveryChallanProducts: (challan.deliveryChallanProducts ?? []).map((p: any) => ({
            id: p.id,
            packagingMaterialQuantity: p.packagingMaterialQuantity,
            packagingMaterialUnitPrice: p.packagingMaterialUnitPrice,
            packagingMaterialAmount: p.packagingMaterialAmount,
            packagingMaterialTotalWeight: p.packagingMaterialTotalWeight,
            amount: p.amount,
            unitPrice: p.unitPrice,
            grossWeight: p.grossWeight,
            netWeight: p.netWeight,
          })),
        };
      })
      .filter(Boolean);

    const listResponse = {
      data: relatedDataOnly as CustomerDeliveryChallanListResponseDto['data'],
      meta: { total: meta.total, page: meta.page, pages: meta.pages },
    };
    await this.cacheService.set(key, listResponse, CACHE_TTL);
    return listResponse;
  }


  async update(id: string, data: UpdateCustomerDeliveryChallanDto & Record<string, any>): Promise<CustomerDeliveryChallan | null> {
    try {
      const challan = await this.challanRepository.findOne({ where: { id } });

      if (!challan) return null;

      const updated = Object.assign(challan, data);
      const saved = await this.challanRepository.save(updated);
      await this.invalidateCDCCache(id);
      return saved;
    } catch (err) {
      logger.error(`Error updating delivery challan with ID: ${id}`, {
        error: err,
      });
      return null;
    }
  }

  async delete(id: string): Promise<DeleteCustomerDeliveryChallanResultDto | null> {
    try {
      const challan = await this.challanRepository.findOne({ where: { id }, select: ['id', 'challanNo'] });
      if (!challan) return null;

      const result = await this.challanRepository.delete(id);
      await this.invalidateCDCCache(id);
      return result.affected !== 0 ? { challanNo: challan.challanNo } : null;
    } catch (err) {
      logger.error(`Error deleting delivery challan with ID: ${id}`, {
        error: err,
      });
      return null;
    }
  }
  public async deleteMultipleCustomerDC(ids: string[]): Promise<BulkDeleteResultDto> {
     const success: { id: string; No: string }[] = [];

  const failed: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      const customerDC = await this.challanRepository.findOne({
        where: { id },
      });
      if (!customerDC) {
        failed.push({ id, reason: 'customerDC not found' });
        continue;
      }
      const relatedDocument = await this.documentbRepository.findOne({
        where: { document_type_id: customerDC.id }
      });

      if (!relatedDocument) {
        throw new Error(`Something went wrong`);
      }

      if (relatedDocument) {
        await this.documentbRepository.softDelete(relatedDocument.id);
        await this.documentbRepository.update(relatedDocument.id, { isDeleted: true } as any);
      }

      await this.challanRepository.softDelete(customerDC.id);
      await this.challanRepository.update(customerDC.id, { isDeleted: true } as any);
      success.push({id,No:customerDC.challanNo});
    } catch (error: any) {
      failed.push({ id, reason: error.message || 'Unknown error' });
    }
  }
  const message = `Deletion completed. Success: ${success.length}, Failed: ${failed.length}`;
  await this.invalidateCDCCache();
  return { success, failed, message };
}





 


}


  // /**
  //  * Check if Return By Customer has been created for a delivery challan
  //  * Returns the status and details
  //  */
  // async checkReturnByCustomerStatus(deliveryChallanId: string): Promise<any> {
  //   const key = `${CACHE_PREFIX}:returnStatus:${deliveryChallanId}`;
  //   const cached = await this.cacheService.get<any>(key);
  //   if (cached) return cached;

  //   const challan = await this.challanRepository.findOne({
  //     where: { id: deliveryChallanId },
  //     relations: ['returns'],
  //   });

  //   if (!challan) {
  //     throw new AppError(400, `Delivery Challan with id ${deliveryChallanId} not found`);
  //   }

  //   const result = {
  //     deliveryChallanId: challan.id,
  //     challanNo: challan.challanNo,
  //     isReturnByCustomerCreated: (challan as any).isReturnByCustomerCreated || false,
  //     isReturned: challan.isReturned,
  //     returnsCount: challan.returns?.length || 0,
  //     canCreateReturn: !(challan as any).isReturnByCustomerCreated,
  //   };
  //   await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
  //   return result;
  // }


 /**
   * Get delivery challan with net amounts (after deducting returns)
   * Useful for invoice generation
   */
  // async getDeliveryChallanWithNetAmounts(deliveryChallanId: string): Promise<any> {
  //   const key = `${CACHE_PREFIX}:net:${deliveryChallanId}`;
  //   const cached = await this.cacheService.get<any>(key);
  //   if (cached) return cached;

  //   // First update with latest return data
  //   await this.updateDeliveryChallanProductsWithReturns(deliveryChallanId);

  //   // Get updated challan
  //   const challan = await this.challanRepository.findOne({
  //     where: { id: deliveryChallanId },
  //     relations: [
  //       'deliveryChallanProducts',
  //       'deliveryChallanProducts.productName',
  //       'deliveryChallanProducts.variant',
  //       'deliveryChallanProducts.uom',
  //       'deliveryChallanProducts.saleUoM',
  //       'customerName',
  //       'fromLocation',
  //       'companyName',
  //       'billingAddress',
  //       'deliveryAddress',
  //     ],
  //   });

  //   if (!challan) {
  //     throw new AppError(400, `Delivery Challan with id ${deliveryChallanId} not found`);
  //   }

  //   // Calculate net amounts
  //   const productsWithNetAmounts = challan.deliveryChallanProducts.map((product) => {
  //     const originalQty = Number(product.changedQty || product.quantity || 0);
  //     const originalAmount = Number(product.amount || 0);
  //     const originalNetWeight = Number(product.netWeight || 0);

  //     const returnQty = Number(product.returnedQty || 0);


  //     return {
  //       ...product,
  //       originalQty,
  //       originalAmount,
  //       originalNetWeight,
  //       returnQty,

  //       netQty: originalQty - returnQty,

  //     };
  //   });

  //   // Calculate totals
  //   const totalOriginalAmount = productsWithNetAmounts.reduce(
  //     (sum, p) => sum + p.originalAmount,
  //     0
  //   );




  //   const netResult = {
  //     ...challan,
  //     deliveryChallanProducts: productsWithNetAmounts,
  //     summary: {
  //       totalOriginalAmount,
  //       hasReturns: challan.isReturned,
  //     },
  //   };
  //   await this.cacheService.set(key, netResult, CACHE_TTL_DETAIL);
  //   return netResult;
  // }


  // /**
  //  * Update delivery challan products with aggregated return data
  //  * This method calculates total returns per product and updates the delivery challan items
  //  */
  // async updateDeliveryChallanProductsWithReturns(deliveryChallanId: string): Promise<void> {
  //   try {
  //     // Get delivery challan with products and returns
  //     const challan = await this.challanRepository.findOne({
  //       where: { id: deliveryChallanId },
  //       relations: [
  //         'deliveryChallanProducts',
  //         'deliveryChallanProducts.productName',
  //         'deliveryChallanProducts.variant',
  //         'returns',
  //         'returns.returnedProducts',
  //         'returns.returnedProducts.productName',
  //         'returns.returnedProducts.variant',
  //       ],
  //     });

  //     if (!challan) {
  //       throw new AppError(400, `Delivery Challan with id ${deliveryChallanId} not found`);
  //     }

  //     // Aggregate returns by product and variant
  //     const returnsByProductVariant = new Map<string, {
  //       returnQty: number;
  //       returnAmount: number;
  //       returnNetWeight: number;
  //     }>();

  //     if (challan.returns && challan.returns.length > 0) {
  //       challan.returns.forEach((returnRecord) => {
  //         returnRecord.returnedProducts?.forEach((returnedProduct) => {
  //           const productId = returnedProduct.productName?.id;
  //           const variantId = returnedProduct.variant?.id || 'no-variant';
  //           const key = `${productId}_${variantId}`;

  //           const existing = returnsByProductVariant.get(key) || {
  //             returnQty: 0,
  //             returnAmount: 0,
  //             returnNetWeight: 0,
  //           };

  //           existing.returnQty += Number(returnedProduct.returnedQty || 0);
  //           existing.returnAmount += Number(returnedProduct.returnedQtyAmt || 0);
  //           existing.returnNetWeight += Number(returnedProduct.returnedNetWt || 0);

  //           returnsByProductVariant.set(key, existing);
  //         });
  //       });
  //     }

  //     // Update delivery challan products with return data
  //     let hasReturns = false;
  //     for (const product of challan.deliveryChallanProducts) {
  //       const productId = product.productName?.id;
  //       const variantId = product.variant?.id || 'no-variant';
  //       const key = `${productId}_${variantId}`;

  //       const returns = returnsByProductVariant.get(key);

  //       if (returns) {
  //         product.returnedQty = returns.returnQty;

  //         hasReturns = true;
  //       } else {
  //         // Reset to 0 if no returns
  //         product.returnedQty = 0;

  //       }
  //     }

  //     // Update isReturned flag
  //     challan.isReturned = hasReturns;

  //     // Save updated challan
  //     await this.challanRepository.save(challan);
  //     await this.invalidateCDCCache(deliveryChallanId);

      
  //   } catch (error) {
  //     logger.error('Error updating delivery challan with returns:', error);
  //     throw error;
  //   }
  // }

