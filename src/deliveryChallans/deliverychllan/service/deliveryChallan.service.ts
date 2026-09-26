import { injectable, inject } from 'inversify';
import { format } from 'date-fns';
import { DataSource } from 'typeorm';
import path from 'node:path';
import ejs from 'ejs';
import puppeteer from 'puppeteer';
import { TYPES } from '../../../types';
import { DeliveryChallanRepository } from '../repository/deliveryChallan.repository';
import { DitemRepository } from '../repository/dItem.repository';
import { CustomerRepository } from '../../../customer/addcustomer/repository/customer.repository';
import { AuditLogService } from '../../../employeeActivity/service/auditLog.service';
import { ProductVarientsRepository } from '../../../product/productVarient/repository/productVarients.repository';
import { InventoryStockRepository } from '../../../inventoryStock/repository/inventoryStock.repository';
import AppError from '../../../utils/appError';
import { DeliveryChallanPurchase } from '../entity/deliveryChallan.entity';
import { buildQuery, PaginationOptions } from '../../../utils/pagination';
import { formatDateTime } from '../../../utils/dateUtils';
import { DeleteResultDto } from '../../../global/general.dto';
import { DocumentTypeEnum as DocDefEnum } from '../../../documentDef/entity/documentdef.entity';
import { DocumentbRepository } from '../../../approvalFlow/repository/documentb.repository';

@injectable()
export class DeliveryChallanService {
  constructor(
    @inject(TYPES.DeliveryChallanRepository)
    private deliveryChallanRepo: DeliveryChallanRepository,
    @inject(TYPES.DitemRepository)
    private deliveryProductChallanRepo: DitemRepository,
    @inject(TYPES.CustomerRepository) private customerRepo: CustomerRepository,
    @inject(TYPES.DitemRepository) private itemRepo: DitemRepository,
    @inject(TYPES.AuditLogService) private auditLogService: AuditLogService,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
    @inject(TYPES.ProductVarientsRepository)
    private readonly variantRepository: ProductVarientsRepository,
    @inject(TYPES.InventoryStockRepository)
    private readonly inventoryStockRepository: InventoryStockRepository,
    @inject(TYPES.DocumentbRepository)
    private readonly documentbRepository: DocumentbRepository,
  ) {}

  

  //   public async createDeliveryChallan(deliveryChallanData: any): Promise<any> {
  
  //     deliveryChallanData.challanNo = await this.generateVoucherNo();
 

  //    if (deliveryChallanData.deliveryCType === "customer") {

  //     deliveryChallanData.customer = { id: deliveryChallanData.partyName };

  //     const customer2 = await this.customerRepo.findOne({
  //         where: { id: deliveryChallanData.partyName },
  //         relations: ["deliveryDetails", "deliveryDetails.deliveryAddress"]
  //     });

  //     deliveryChallanData.toLocationInput = customer2?.deliveryDetails?.deliveryAddress?.id || null;
  // }

  

  //     const deliveryChallan = this.deliveryChallanRepo.create(deliveryChallanData);
  //     return await this.deliveryChallanRepo.save(deliveryChallan);
  //   }

  // public async createDeliveryChallan(deliveryChallanData: any): Promise<any> {
  //   const queryRunner = this.dataSource.createQueryRunner();
  //   await queryRunner.connect();
  //   await queryRunner.startTransaction();

  //   try {
  //     deliveryChallanData.challanNo = await this.generateVoucherNo();

  //     if (deliveryChallanData.deliveryCType === 'customer') {
  //       deliveryChallanData.customer = { id: deliveryChallanData.partyName };

  //       const customer2 = await this.customerRepo.findOne({
  //         where: { id: deliveryChallanData.partyName },
  //         relations: ['deliveryDetails', 'deliveryDetails.deliveryAddress'],
  //       });

  //       deliveryChallanData.toLocationInput =
  //         customer2?.deliveryDetails?.deliveryAddress?.id || null;
  //     }

  //     // Save delivery challan inside the transaction
  //     const deliveryChallan = queryRunner.manager.create(
  //       this.deliveryChallanRepo.target,
  //       deliveryChallanData,
  //     );
  //     const savedChallan = await queryRunner.manager.save(deliveryChallan);

  //     for (const item of deliveryChallan.deliveryChallanProducts) {
  //       const {
  //         productName,
  //         count,
  //         size,
  //         variety,
  //         origin,
  //         netWeight,
  //         unitPrice,
  //         amount,
  //       } = item;

  //       const productId = productName;

  //       const variant = await this.variantRepository.findOne({
  //         where: {
  //           productTemplate: { id: productId.toString() },
  //           count: count ?? null,
  //           size: size ?? null,
  //           variety: variety ?? null,
  //           origin: origin ?? null,
  //         },
  //         relations: ['productTemplate'],
  //       });

  //       if (!variant)
  //         throw new Error(`Variant not found for product ${productName.name}`);

  //       const location = savedChallan.fromLocation?.id 

  //       const existingStock = await this.inventoryStockRepository.findOne({
  //         where: {
  //           companyName: { id: deliveryChallanData.companyName },
  //           location: { id: location },
  //           product: { id: variant.productTemplate.id },
  //           varients: { id: variant.id },
  //         },
  //         relations: ['product', 'varients', 'location', 'companyName'],
  //       });

  //       if (
  //         !existingStock ||
  //         Number(existingStock.onHandQty || 0) < Number(netWeight)
  //       ) {
  //         throw new AppError( 400, `Insufficient stock for product ${productName.name}`);
  //       }

  //       existingStock.onHandQty =
  //         Number(existingStock.onHandQty || 0) - Number(netWeight);
  //       existingStock.amount =
  //         Number(existingStock.amount || 0) - Number(amount);

  //       await queryRunner.manager.save(existingStock);
  //     }

      
  //     await queryRunner.commitTransaction();
  //     return savedChallan;
  //   } catch (error) {
  //     await queryRunner.rollbackTransaction();
  //     throw error;
  //   } finally {
  //     await queryRunner.release();
  //   }
  // }

  public async getAll(): Promise<DeliveryChallanPurchase[]> {
    return await this.deliveryChallanRepo.find();
  }

  // public async getAllDeliveryChallans(
  //   queryOptions: PaginationOptions,
  // ): Promise<any> {
  //   const queryBuilder = this.deliveryChallanRepo
  //     .createQueryBuilder('deliveryChallan')
  //     .leftJoinAndSelect(
  //       'deliveryChallan.deliveryChallanProducts',
  //       'deliveryChallanProducts',
  //     )
  //     .leftJoinAndSelect('deliveryChallan.companyName', 'companyName')
  //     .leftJoinAndSelect('deliveryChallan.fromLocation', 'fromLocation')
  //     .leftJoinAndSelect('deliveryChallan.toLocation', 'toLocation')
  //     .leftJoinAndSelect('deliveryChallan.toLocationInput', 'toLocationInput')
  //     .leftJoinAndSelect(
  //       'deliveryChallan.fromLocationInput',
  //       'fromLocationInput',
  //     )
  //     .leftJoinAndSelect('deliveryChallanProducts.productName', 'productName')
  //     .leftJoinAndSelect(
  //       'deliveryChallanProducts.packagingMaterial',
  //       'packagingMaterial',
  //     )
  //     .leftJoinAndSelect(
  //       'deliveryChallanProducts.packagingMaterialUoM',
  //       'packagingMaterialUoM',
  //     )
  //     .leftJoinAndSelect('deliveryChallanProducts.saleUoM', 'saleUoM')
  //     .leftJoinAndSelect('deliveryChallan.grnNo', 'grn')
  //    // .leftJoinAndSelect('deliveryChallan.requestedBy', 'requestedBy');

  //   const deliveryChallans = await buildQuery(
  //     queryBuilder,
  //     queryOptions,
  //     'deliveryChallan',
  //   );

  //   return {
  //     data: deliveryChallans.data.map((challan) => {
  //       const rawDate = challan.createdAt;
  //       const { createdDate, createdTime } = formatDateTime(rawDate);

  //       return {
  //         id: challan.id,
  //         challanNo: challan.challanNo,
  //         partyName: challan.partyName,
  //         totalProductAmount: challan.totalProductAmount,
  //         toLocationInput: challan.toLocationInput
  //           ? {
  //               id: challan.toLocationInput.id,
  //               address1: challan.toLocationInput.address1,
  //               address2: challan.toLocationInput.address2,
  //               location: challan.toLocationInput.location,
  //               city: challan.toLocationInput.city,
  //               state: challan.toLocationInput.state,
  //               pincode: challan.toLocationInput.pincode,
  //             }
  //           : null,
  //         fromLocationInput: challan.fromLocationInput
  //           ? {
  //               id: challan.fromLocationInput.id,
  //               address1: challan.fromLocationInput.address1,
  //               address2: challan.fromLocationInput.address2,
  //               location: challan.fromLocationInput.location,
  //               city: challan.fromLocationInput.city,
  //               state: challan.fromLocationInput.state,
  //               pincode: challan.fromLocationInput.pincode,
  //             }
  //           : null,
  //         fromLocation: challan.fromLocation?.name || null,
  //         toLocation: challan.toLocation?.name || null,
  //         driverName: challan.driverName,
  //         contactNo: challan.contactNo,
  //         altContactNo: challan.altContactNo,
  //         vehicleNo: challan.vehicleNo,
  //         receiverName: challan.receiverName,
  //         deliveryCType: challan.deliveryCType,
  //         createdDate,
  //         createdTime,
  //         netProductWeight: challan.netProductWeight,
  //         netPackagingMaterialWeight: challan.netPackagingMaterialWeight,
  //         totalPackagingMaterialAmount: challan.totalPackagingMaterialAmount,

  //         totalAmtInWords: challan.totalAmtInWords,
  //         anyAttachment: challan.anyAttachment,
  //         requestingDepartment: challan.requestingDepartment,
  //         approvalStatus: challan.approvalStatus,
  //         companyName: challan.companyName?.name || null,
  //         deliveryChallanProducts: challan.deliveryChallanProducts.map(
  //           (product) => ({
  //             id: product.id,
  //             productName: product.productName.name,
  //             quantity: product.quantity,
  //             unitPrice: product.unitPrice,
  //             amount: product.amount,
  //             saleUoM: product.saleUoM?.unit || null,
  //             packingMaterial:
  //               product.packagingMaterial?.packagingMaterialName || null,
  //             packagingMaterialUoM: product.packagingMaterialUoM?.unit || null,
  //             packagingMaterialAmount: product.packagingMaterialAmount,
  //             packagingMaterialUnitPrice: product.packagingMaterialUnitPrice,
  //             packagingMaterialQuantity: product.packagingMaterialQuantity,
  //             packagingMaterialTotalWeight:
  //               product.packagingMaterialTotalWeight,
  //           }),
  //         ),
  //         // requestedBy: challan.requestedBy
  //         //   ? {
  //         //       firstName: challan.requestedBy.firstName,
  //         //       lastName: challan.requestedBy.lastName,
  //         //     }
  //         //   : null,
  //         grnNo: challan.grnNo?.grnNo || null,
  //       };
  //     }),
  //     meta: deliveryChallans.meta,
  //   };
  // }

  // public async getByIdDeliveryChallan(id: string): Promise<any> {
  //   const challan = await this.deliveryChallanRepo
  //     .createQueryBuilder('deliveryChallan')
  //     .leftJoinAndSelect(
  //       'deliveryChallan.deliveryChallanProducts',
  //       'deliveryChallanProducts',
  //     )
  //     .leftJoinAndSelect('deliveryChallanProducts.productName', 'productName')
  //     .leftJoinAndSelect('deliveryChallan.companyName', 'companyName')
  //     .leftJoinAndSelect('deliveryChallan.offices', 'offices')
  //     .leftJoinAndSelect('deliveryChallan.customer', 'customer')
  //     .leftJoinAndSelect('deliveryChallan.fromLocation', 'fromLocation')
  //     .leftJoinAndSelect('deliveryChallan.toLocation', 'toLocation')
  //     .leftJoinAndSelect('deliveryChallan.toLocationInput', 'toLocationInput')
  //     .leftJoinAndSelect(
  //       'deliveryChallan.fromLocationInput',
  //       'fromLocationInput',
  //     )
  //     .leftJoinAndSelect('deliveryChallanProducts.uom', 'uom')
  //     .leftJoinAndSelect(
  //       'deliveryChallanProducts.packagingMaterial',
  //       'packagingMaterial',
  //     )
  //     .leftJoinAndSelect('deliveryChallanProducts.saleUoM', 'saleUoM')
  //     .leftJoinAndSelect('deliveryChallan.grnNo', 'grn')
  //     .leftJoinAndSelect(
  //       'deliveryChallanProducts.packagingMaterialUoM',
  //       'packagingMaterialUoM',
  //     )
  //    // .leftJoinAndSelect('deliveryChallan.requestedBy', 'requestedBy')
  //     .where('deliveryChallan.id = :id', { id })
  //     .getOne();

  //   if (!challan) {
  //     throw new AppError(404, 'Delivery Challan not found');
  //   }

  //   const rawDate = challan.createdAt;
  //   const { createdDate, createdTime } = formatDateTime(rawDate);

  //   let fromLocation = null;
  //   let toLocation = null;
  //   let fromLocationInput = null;
  //   let toLocationInput = null;
  //   let partyName = null;

  //   if (challan.deliveryCType === 'customer') {
  //     partyName = challan.partyName
  //       ? {
  //           id: challan.customer?.id,
  //           organizationName: challan.customer?.organisationName,
  //         }
  //       : null;
  //     fromLocation = challan.fromLocation
  //       ? { id: challan.fromLocation.id, name: challan.fromLocation.name }
  //       : null;
  //   } else if (
  //     challan.deliveryCType === DeliveryChallanType.STOCK_TRANSFER_INTERNAL ||
  //     challan.deliveryCType === DeliveryChallanType.DC_DC_STOCK_TRANSFER
  //   ) {
  //     partyName = challan.partyName || null;
  //     fromLocation = challan.fromLocation
  //       ? { id: challan.fromLocation.id, name: challan.fromLocation.name }
  //       : null;
  //     toLocation = challan.toLocation
  //       ? { id: challan.toLocation.id, name: challan.toLocation.name }
  //       : null;
  //   } else {
  //     fromLocationInput = challan.fromLocationInput
  //       ? {
  //           id: challan.fromLocationInput.id,
  //           address1: challan.fromLocationInput.address1,
  //           address2: challan.fromLocationInput.address2,
  //           location: challan.fromLocationInput.location,
  //           city: challan.fromLocationInput.city,
  //           state: challan.fromLocationInput.state,
  //           pincode: challan.fromLocationInput.pincode,
  //         }
  //       : null;

  //     toLocationInput = challan.toLocationInput
  //       ? {
  //           id: challan.toLocationInput.id,
  //           address1: challan.toLocationInput.address1,
  //           address2: challan.toLocationInput.address2,
  //           location: challan.toLocationInput.location,
  //           city: challan.toLocationInput.city,
  //           state: challan.toLocationInput.state,
  //           pincode: challan.toLocationInput.pincode,
  //         }
  //       : null;
  //     partyName = challan.partyName || null;
  //   }

  //   return {
  //     id: challan.id,
  //     challanNo: challan.challanNo?.toUpperCase() || null,
  //     partyName,
  //     totalProductAmount: challan.totalProductAmount || 0,
  //     offices: challan.offices
  //       ? {
  //           id: challan.offices.id,
  //           name: challan.offices.name,
  //         }
  //       : null,
  //     fromLocation,
  //     toLocation,
  //     driverName: challan.driverName || null,
  //     contactNo: challan.contactNo || null,
  //     rmn: challan.rmn,
  //     remark: challan.remark,
  //     altContactNo: challan.altContactNo || null,
  //     vehicleNo: challan.vehicleNo?.toUpperCase() || null,
  //     receiverName: challan.receiverName || null,
  //     deliveryCType: challan.deliveryCType || null,
  //     createdDate: createdDate || null,
  //     createdTime: createdTime || null,
  //     poNumber: challan.poNumber,
  //     licenseNo: challan.licenseNo,
  //     anyAttachment: challan.anyAttachment || null,
  //     requestingDepartment: challan.requestingDepartment || null,
  //     approvalStatus: challan.approvalStatus || null,
  //     companyName: challan.companyName
  //       ? {
  //           id: challan.companyName.id,
  //           companyName: challan.companyName.name,
  //         }
  //       : null,
  //     netProductWeight: challan.netProductWeight,
  //     netPackagingMaterialWeight: challan.netPackagingMaterialWeight,
  //     totalPackagingMaterialAmount: challan.totalPackagingMaterialAmount,

  //     totalAmtInWords: challan.totalAmtInWords,

  //     toLocationInput,
  //     fromLocationInput,
  //     deliveryChallanProducts:
  //       challan.deliveryChallanProducts?.map((product) => ({
  //         id: product.id,
  //         productName: product.productName
  //           ? {
  //               id: product.productName.id,
  //               productName: product.productName.name,
  //             }
  //           : null,
  //         uom: product.uom
  //           ? { id: product.uom.id, unit: product.uom.unit }
  //           : null,
  //         quantity: product.quantity || 0,
  //         unitPrice: product.unitPrice || 0,
  //         count: product.count,
  //         size: product.size,
  //         amount: product.amount || 0,
  //         netWeight: product.netWeight,
  //         packingMaterialWeight: product.packingMaterialWeight,
  //         grossWeight: product.grossWeight,
  //         packagingMaterial: product.packagingMaterial
  //           ? {
  //               id: product.packagingMaterial.id,
  //               name: product.packagingMaterial.packagingMaterialName,
  //             }
  //           : null,
  //         packagingMaterialUoM: product.packagingMaterialUoM
  //           ? {
  //               id: product.packagingMaterialUoM.id,
  //               unit: product.packagingMaterialUoM.unit,
  //             }
  //           : null,
  //         saleUoM: product.saleUoM
  //           ? {
  //               id: product.saleUoM.id,
  //               unit: product.saleUoM.unit,
  //             }
  //           : null,
  //         packagingMaterialAmount: product.packagingMaterialAmount,
  //         packagingMaterialUnitPrice: product.packagingMaterialUnitPrice,
  //         packagingMaterialQuantity: product.packagingMaterialQuantity,
  //         packagingMaterialTotalWeight: product.packagingMaterialTotalWeight,
  //       })) || [],
  //     // requestedBy: challan.requestedBy
  //     //   ? {
  //     //       id: challan.requestedBy.id,
  //     //       firstName: challan.requestedBy.firstName,
  //     //       lastName: challan.requestedBy.lastName,
  //     //     }
  //     //   : null,
  //     grnNo: challan.grnNo
  //       ? {
  //           id: challan.grnNo.id,
  //           grnNo: challan.grnNo.grnNo,
  //         }
  //       : null,
  //   };
  // }

  // public async updateDeliveryChallan(
  //   id: string,
  //   updateData: Partial<DeliveryChallanPurchase>,
  //   updatedBy: string,
  // ): Promise<any> {
  //   const existingChallan = await this.deliveryChallanRepo.findOne({
  //     where: { id },
  //     relations: [
  //       'requestedBy',
  //       'grnNo',
  //       'deliveryChallanProducts',
  //       'deliveryChallanProducts.productName',
  //       'fromLocationInput',
  //       'toLocationInput',
  //       'toLocation',
  //       'fromLocation',
  //       'companyName',
  //       'deliveryChallanProducts.packagingMaterialUoM',
  //       'deliveryChallanProducts.packagingMaterial',
  //       'deliveryChallanProducts.uom',
  //       'deliveryChallanProducts.saleUoM',
  //     ],
  //   });
  
  //   if (!existingChallan) {
  //     throw new Error('Delivery Challan not found');
  //   }
  
  //   const originalChallan = { ...existingChallan };
  //   const originalItems = [...existingChallan.deliveryChallanProducts];
  //   if (updateData.deliveryCType === 'customer') {
  //     if (updateData.partyName) {
  //       const customer = await this.customerRepo.findOne({
  //         where: { id: updateData.partyName },
  //       });
  //       if (!customer) {
  //         throw new Error(`Customer with ID ${updateData.partyName} not found`);
  //       }
  //       updateData.customer = customer;
  //     }

  //     const customer2 = await this.customerRepo.findOne({
  //       where: { id: updateData.partyName },
  //       relations: ['deliveryDetails', 'deliveryDetails.deliveryAddress'],
  //     });

  //     updateData.toLocationInput = customer2?.deliveryDetails?.deliveryAddress || undefined;
  //   }

  //   // Apply changes using merge (handles nested fields too if cascade is set)
  //   const mergedChallan = this.deliveryChallanRepo.merge(existingChallan, {
  //     ...updateData,
  //      // assuming this is a direct field or needs to be tracked
  //   });
  
  //   // Save updated entity
  //   const savedChallan = await this.deliveryChallanRepo.save(mergedChallan);
  
  //   // Log changes
  //   await this.auditLogService.logChange(
  //     'DeliveryChallanPurchase',
  //     id,
  //     originalChallan,
  //     savedChallan,
  //     updatedBy,
  //   );
  
  //   return savedChallan;
  // }
  
  public async deleteDeliveryChallan(id: string): Promise<DeleteResultDto| null> {
    // Find the Delivery Challan by ID
    const deliveryChallan = await this.deliveryChallanRepo.findOne({
      where: { id },
    });

    if (!deliveryChallan) {
      throw new AppError(404, `Delivery Challan with ID ${id} not found`);
    }

    // Calculate the date 6 months ahead
    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6); // Adds 6 months to the current date
    sixMonthsFromNow.setHours(0, 0, 0, 0); // Optionally, set the time to midnight (00:00:00)

    // Log the scheduled deletion
   

    // Set the deletionScheduledAt field for the Delivery Challan
    deliveryChallan.deletionScheduledAt = sixMonthsFromNow;

    // Save the updated Delivery Challan with the scheduled deletion date
    await this.deliveryChallanRepo.save(deliveryChallan);

   
    return {No:deliveryChallan.challanNo};
  }

  public async generateVoucherNo(): Promise<string> {
    const today = new Date();
    const formattedDate = format(today, 'yyyyMMdd'); // e.g., 20241017

    // Query to get the last delivery challan voucher for the current date
    const lastVoucher = await this.deliveryChallanRepo
      .createQueryBuilder('deliveryChallan')
      .where('deliveryChallan.challanNo LIKE :datePattern', {
        datePattern: `CN-${formattedDate}-%`,
      })
      .orderBy('deliveryChallan.challanNo', 'DESC')
      .getOne();

    let newSerialNumber = 1; // Default to 1 if no vouchers exist for the current date

    if (lastVoucher) {
      // Extract the serial number from the last voucher
      const lastSerialNumber = parseInt(
        lastVoucher.challanNo.split('-')[2],
        10,
      );
      newSerialNumber = lastSerialNumber + 1; // Increment the serial number
    }

    // Create the voucher number in the format CV-yyyyMMdd-serialNumber
    const voucherNo = `CN-${formattedDate}`;
    return voucherNo;
  }
  public async getAllDealSlipNumbers(): Promise<
    { id: string; challanNo: string }[]
  > {
    const challanNumbers = await this.deliveryChallanRepo.find({
      select: ['id', 'challanNo'], // Select only the id and challanNo fields
    });
    return challanNumbers;
  }
  // public async getAllDealSlipNumbers(): Promise<
  //   { id: string; challanNo: string }[]
  // > {
  //   const challanNumbers = await this.deliveryChallanRepo.find({
  //     select: ['id', 'challanNo'], // Select only the id and challanNo fields
  //   });
  //   return challanNumbers;
  // }

  public async getDcTypeNumbers(
    dcType: string,
    page?: number,
    limit?: number,
    search?: string,
    isReturnByCustomerCreated?: boolean,
    overAllStatus?: string,
  ): Promise<any> {
    const typeMap: Record<string, string> = {
      'stock-transfer': 'stock-transfer-delivery-challan',
      'other': 'other-delivery-challan',
      'customer': 'customer_delivery_challan',
    };

    const type = typeMap[dcType];
    if (!type) throw new AppError(400, `Invalid dcType: ${dcType}. Use 'stock-transfer', 'other', or 'customer'`);

    // 1. Fetch all DCs of the given type
    const whereCondition: any = { type, isDeleted: false };
    if (typeof isReturnByCustomerCreated === 'boolean') {
      whereCondition.isReturnByCustomerCreated = isReturnByCustomerCreated;
    }

    const challans = await this.deliveryChallanRepo.find({
      select: ['id', 'challanNo'],
      where: whereCondition,
      order: { createdAt: 'DESC' },
    });

    const validChallans = challans.filter(c => c.id && c.challanNo);
    if (!validChallans.length) {
      return { data: [], total: 0, page: page || 1, totalPages: 0 };
    }

    // 2. Fetch matching documents (same pattern as RFPA)
    const challanIds = validChallans.map(c => c.id);
    const documents = await this.documentbRepository
      .createQueryBuilder('doc')
      .select(['doc.id', 'doc.status', 'doc.document_type_id'])
      .where('doc.document_type_id IN (:...ids)', { ids: challanIds })
      .getMany();

    const docMap = new Map(documents.map(d => [d.document_type_id, d]));

    // 3. Filter by overAllStatus + search (same pattern as RFPA)
    let filteredResults: { id: string; challanNo: string; documentId: string | null; overAllStatus: string | null }[] = [];

    for (const challan of validChallans) {
      const doc = docMap.get(challan.id);
      const documentId = doc?.id || null;
      const documentStatus = doc?.status || null;

      // overAllStatus filter — case-insensitive like RFPA
      const matchesStatus = !overAllStatus ||
        (documentStatus?.toLowerCase() === overAllStatus.toLowerCase());

      if (matchesStatus) {
        filteredResults.push({
          id: challan.id,
          challanNo: challan.challanNo,
          documentId,
          overAllStatus: documentStatus,
        });
      }
    }

    // 4. Search filter
    if (search?.trim()) {
      const term = search.trim().toLowerCase();
      filteredResults = filteredResults.filter(item =>
        item.challanNo.toLowerCase().includes(term) ||
        item.id.toLowerCase() === term,
      );
    }

    // 5. Paginate
    const currentPage = page || 1;
    const currentLimit = limit || 10;
    const paginated = filteredResults.slice((currentPage - 1) * currentLimit, currentPage * currentLimit);

    return {
      data: paginated,
      total: filteredResults.length,
      page: currentPage,
      totalPages: Math.ceil(filteredResults.length / currentLimit),
    };
  }

  // public async getDataForTillDate(
  //   filterType?: string,
  //   filterValue?: string,
  // ): Promise<any[]> {
  //   let query = this.deliveryProductChallanRepo
  //     .createQueryBuilder('dcProduct')
  //     .select("TO_CHAR(dc.createdAt, 'YYYY-MM-DD')", 'date')
  //     .addSelect('COALESCE(SUM(dcProduct.netWeight), 0)', 'totalQuantityInKg')
  //     .addSelect('COALESCE(SUM(dcProduct.amount), 0)', 'totalAmount')
  //     .innerJoin(
  //       DeliveryChallanPurchase,
  //       'dc',
  //       'dc.id = dcProduct.deliveryChallanId',
  //     )
  //     .where('dc.deliveryCType = :dcType', {
  //       dcType: DeliveryChallanType.CUSTOMER,
  //     }) // Use Enum
  //     .groupBy("TO_CHAR(dc.createdAt, 'YYYY-MM-DD')")
  //     .orderBy("TO_CHAR(dc.createdAt, 'YYYY-MM-DD')", 'ASC');

  //   // Apply filters dynamically
  //   if (filterType && filterValue) {
  //     switch (filterType) {
  //       case 'fromLocation':
  //         query = query.andWhere('dc.fromLocation.id = :filterValue', {
  //           filterValue,
  //         });
  //         break;
  //       case 'toLocation':
  //         query = query.andWhere('dc.toLocation.id = :filterValue', {
  //           filterValue,
  //         });
  //         break;
  //       case 'customer':
  //         query = query.andWhere('dc.customer.id = :filterValue', {
  //           filterValue,
  //         });
  //         break;
  //       case 'productName':
  //         query = query.andWhere('dcProduct.productName.id = :filterValue', {
  //           filterValue,
  //         });
  //         break;
  //       case 'companyName':
  //         query = query.andWhere('dc.companyName.id = :filterValue', {
  //           filterValue,
  //         });
  //         break;
  //       case 'customerTypes':
  //         query = query
  //           .innerJoin(Customer, 'customer', 'customer.id = dc.customer_id')
  //           .andWhere('customer.customerTypes = :filterValue', { filterValue });

  //         break;
  //       default:
  //         break;
  //     }
  //   }

  //   const result = await query.getRawMany();

  //   return result.map((row) => ({
  //     date: row.date,
  //     quantity: Number(row.totalQuantityInKg),
  //     amount: Number(row.totalAmount),
  //   }));
  // }

  // public async getDataForDates(
  //   filterType?: string,
  //   startDate?: string,
  //   endDate?: string,
  // ): Promise<any[]> {
  //   let query = this.deliveryProductChallanRepo
  //     .createQueryBuilder('dcProduct')
  //     .select("TO_CHAR(dc.createdAt, 'YYYY-MM-DD')", 'date')
  //     .addSelect('COALESCE(SUM(dcProduct.netWeight), 0)', 'totalQuantityInKg')
  //     .addSelect('COALESCE(SUM(dcProduct.amount), 0)', 'totalAmount')
  //     .innerJoin(
  //       DeliveryChallanPurchase,
  //       'dc',
  //       'dc.id = dcProduct.deliveryChallanId',
  //     )
  //     .where('dc.deliveryCType = :dcType', {
  //       dcType: DeliveryChallanType.CUSTOMER,
  //     })
  //     .groupBy("TO_CHAR(dc.createdAt, 'YYYY-MM-DD')")
  //     .orderBy("TO_CHAR(dc.createdAt, 'YYYY-MM-DD')", 'ASC');

  //   const currentDate = new Date();

  //   switch (filterType) {
  //     case 'tillDate':
  //       query = query.andWhere('dc.createdAt <= :currentDate', { currentDate });
  //       break;

  //     case 'financialYear': {
  //       const today = new Date();
  //       const financialYearStart =
  //         today.getMonth() + 1 >= 4
  //           ? `${today.getFullYear()}-04-01`
  //           : `${today.getFullYear() - 1}-04-01`;
  //       query = query.andWhere('dc.createdAt BETWEEN :start AND :end', {
  //         start: financialYearStart,
  //         end: currentDate,
  //       });
  //       break;
  //     }

  //     case 'today':
  //       query = query.andWhere(
  //         "TO_CHAR(dc.createdAt, 'YYYY-MM-DD') = TO_CHAR(:currentDate, 'YYYY-MM-DD')",
  //         {
  //           currentDate,
  //         },
  //       );
  //       break;

  //     case 'dateRange':
  //       if (startDate && endDate) {
  //         query = query.andWhere('dc.createdAt BETWEEN :start AND :end', {
  //           start: startDate,
  //           end: endDate,
  //         });
  //       }
  //       break;

  //     default:
  //       break;
  //   }

  //   const result = await query.getRawMany();

  //   return result.map((row) => ({
  //     date: row.date,
  //     quantity: Number(row.totalQuantityInKg),
  //     amount: Number(row.totalAmount),
  //   }));
  // }

  // public async getFilteredSales(filters: any): Promise<any[]> {
  //   const query = this.deliveryChallanRepo
  //     .createQueryBuilder('dc')
  //     .leftJoinAndSelect('dc.customer', 'customer')
  //     .leftJoinAndSelect('dc.companyName', 'company')
  //     .leftJoinAndSelect('dc.grnNo', 'grnNo')
  //     .leftJoinAndSelect('dc.fromLocation', 'fromLocation')
  //     .leftJoinAndSelect('dc.deliveryChallanProducts', 'dcProducts')
  //     .leftJoinAndSelect('dcProducts.productName', 'productName')
  //     .leftJoinAndSelect('dcProducts.uom', 'uom')
  //     //.leftJoinAndSelect('dc.requestedBy', 'requestedBy')
  //     .leftJoinAndSelect('dc.offices', 'offices')
  //     .where('dc.deliveryCType = :deliveryCType', { deliveryCType: 'customer' }) // Filter only customer sales
  //     .orderBy('dc.createdAt', 'DESC');

  //   // Apply Filters
  //   if (filters.challanNo) {
  //     query.andWhere('dc.challanNo ILIKE :challanNo', {
  //       challanNo: `%${filters.challanNo}%`,
  //     });
  //   }
  //   if (filters.customerId) {
  //     query.andWhere('customer.id = :customerId', {
  //       customerId: filters.customerId,
  //     });
  //   }
  //   if (filters.companyName) {
  //     query.andWhere('company.id = :companyId', {
  //       companyId: filters.companyName,
  //     });
  //   }
  //   if (filters.driverName) {
  //     query.andWhere('dc.driverName = :driverName', {
  //       driverName: filters.driverName,
  //     });
  //   }
  //   if (filters.vehicleNo) {
  //     query.andWhere('dc.vehicleNo = :vehicleNo', {
  //       vehicleNo: filters.vehicleNo,
  //     });
  //   }
  //   if (filters.licenseNo) {
  //     query.andWhere('dc.licenseNo = :licenseNo', {
  //       licenseNo: filters.licenseNo,
  //     });
  //   }
  //   if (filters.contactNo) {
  //     query.andWhere('dc.contactNo = :contactNo', {
  //       contactNo: filters.contactNo,
  //     });
  //   }
  //   if (filters.altContactNo) {
  //     query.andWhere('dc.altContactNo = :altContactNo', {
  //       altContactNo: filters.altContactNo,
  //     });
  //   }
  //   if (filters.fromLocation) {
  //     query.andWhere('fromLocation.id = :location', {
  //       location: filters.fromLocation,
  //     });
  //   }
  //   if (filters.productId) {
  //     query.andWhere('productName.id = :productId', {
  //       productId: filters.productId,
  //     });
  //   }
  //   if (filters.productCategoryId) {
  //     query.andWhere('productName.category = :productCategoryId', {
  //       productCategoryId: filters.productCategoryId,
  //     });
  //   }
  //   if (filters.productSubCategoryId) {
  //     query.andWhere('productName.subcategory = :productSubCategoryId', {
  //       productSubCategoryId: filters.productSubCategoryId,
  //     });
  //   }
  //   if (filters.receiverName) {
  //     query.andWhere('dc.receiverName = :receiverName', {
  //       receiverName: filters.receiverName,
  //     });
  //   }
  //   if (filters.approvalStatus) {
  //     query.andWhere('dc.approvalStatus = :approvalStatus', {
  //       approvalStatus: filters.approvalStatus,
  //     });
  //   }
  //   if (filters.dateFrom) {
  //     query.andWhere('dc.createdAt>= :dateFrom', {
  //       dateFrom: filters.dateFrom,
  //     });
  //   }
  //   if (filters.dateTo) {
  //     query.andWhere('dc.createdAt <= :dateTo', { dateTo: filters.dateTo });
  //   }

  //   if (filters.totalAmtFrom) {
  //     query.andWhere('dc.totalAmt > :totalAmtFrom', {
  //       totalAmtFrom: filters.totalAmtFrom,
  //     });
  //   }
  //   if (filters.totalAmtTo) {
  //     query.andWhere('dc.totalAmt <= :totalAmtTo', {
  //       totalAmtTo: filters.totalAmtTo,
  //     });
  //   }

  //   const sales = await query.getMany();

  //   // Transform Data to Match Required Format
  //   return sales.map((dc) => ({
  //     id: dc.id,
  //     challanNo: dc.challanNo,
  //     companyName: dc.companyName?.name || null,
  //     customerName: dc.customer?.organisationName || null,

  //     grnNo: dc.grnNo?.grnNo || null,
  //     driverName: dc.driverName,
  //     vehicleNo: dc.vehicleNo,
  //     poNumber: dc.poNumber,
  //     receiverName: dc.receiverName,
  //     rmn: dc.rmn,
  //     licenseNo: dc.licenseNo,
  //     contactNo: dc.contactNo,
  //     toLocation: dc.toLocation,
  //     altContactNo: dc.altContactNo,
  //     totalProductAmount: dc.totalProductAmount,
  //     amtWords: dc.totalAmtInWords,
  //     approvalStatus: dc.approvalStatus,
  //     createdDate: dc.createdAt,
  //     // requestedBy: {
  //     //   firstName: dc.requestedBy?.firstName || '',
  //     //   lastName: dc.requestedBy?.lastName || '',
  //     // },
  //     deliveryChallanProducts: dc.deliveryChallanProducts.map((product) => ({
  //       id: product.id,
  //       quantity: product.quantity,
  //       unitPrice: product.unitPrice,
  //       productName: product.productName?.id,
  //       uom: product.uom?.id,
  //       count: product.count,
  //       amount: product.amount,
  //     })),
  //   }));
  // }

  public async getFilteredSalesbyCustomer(filters: any): Promise<any> {
    const query = this.deliveryChallanRepo
      .createQueryBuilder('dc')
      .leftJoinAndSelect('dc.customer', 'customer')
      .leftJoinAndSelect('dc.location', 'location')
      .leftJoinAndSelect('dc.companyName', 'company')
      .leftJoinAndSelect('dc.deliveryChallanProducts', 'dcProducts')
      .leftJoinAndSelect('dcProducts.productName', 'productName')
      .leftJoinAndSelect('dcProducts.uom', 'uom')
      .leftJoinAndSelect('dc.requestedBy', 'requestedBy')
      .leftJoinAndSelect('dc.offices', 'offices')
      .where('dc.deliveryCType = :deliveryCType', { deliveryCType: 'customer' })
      .orderBy('dc.createdAt', 'DESC');

    // Apply Filters
    if (filters.challanNo) {
      query.andWhere('dc.challanNo ILIKE :challanNo', {
        challanNo: `%${filters.challanNo}%`,
      });
    }
    if (filters.customerId) {
      query.andWhere('customer.id = :customerId', {
        customerId: filters.customerId,
      });
    }
    if (filters.companyName) {
      query.andWhere('company.id = :companyId', {
        companyId: filters.companyName,
      });
    }
    if (filters.location) {
      query.andWhere('location.id = :location', { location: filters.location });
    }
    if (filters.productId) {
      query.andWhere('productName.id = :productId', {
        productId: filters.productId,
      });
    }
    if (filters.productCategoryId) {
      query.andWhere('productName.category = :productCategoryId', {
        productCategoryId: filters.productCategoryId,
      });
    }
    if (filters.startDate && filters.endDate) {
      query.andWhere('dc.createdAt BETWEEN :startDate AND :endDate', {
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
    }

    // Fetch filtered results
    const filteredSales = await query.getMany();

    // Compute totals for the filtered data
    const totalSaleAmount = filteredSales.reduce(
      (acc, item) => acc + (item.totalProductAmount || 0),
      0,
    );
    const totalNetWeight = filteredSales.reduce(
      (acc, item) =>
        acc +
        item.deliveryChallanProducts.reduce(
          (sum, product) => sum + (product.netWeight || 0),
          0,
        ),
      0,
    );

    // **Date-wise Calculation**
    const salesByDate: Record<
      string,
      { totalSaleAmount: number; totalNetWeight: number }
    > = {};

    filteredSales.forEach((sale) => {
      const rawDate = sale.createdAt;
      const { createdDate, createdTime } = formatDateTime(rawDate);
      const dateKey = createdDate; // Convert Date to string
      if (dateKey) {
        if (!salesByDate[dateKey]) {
          salesByDate[dateKey] = { totalSaleAmount: 0, totalNetWeight: 0 };
        }
        salesByDate[dateKey].totalSaleAmount += sale.totalProductAmount || 0;
        salesByDate[dateKey].totalNetWeight +=
          sale.deliveryChallanProducts.reduce(
            (sum, product) => sum + (product.netWeight || 0),
            0,
          );
      }
    });

    // **Till Date Calculation (All sales up to now)**
    const tillDateQuery = this.deliveryChallanRepo
      .createQueryBuilder('dc')
      .leftJoinAndSelect('dc.deliveryChallanProducts', 'dcProducts')
      .where('dc.deliveryCType = :deliveryCType', { deliveryCType: 'customer' })
      .andWhere('dc.createdAt <= :today', { today: new Date() });

    const tillDateSales = await tillDateQuery.getMany();

    const totalSaleAmountTillDate = tillDateSales.reduce(
      (acc, item) => acc + (item.totalProductAmount || 0),
      0,
    );
    const totalNetWeightTillDate = tillDateSales.reduce(
      (acc, item) =>
        acc +
        item.deliveryChallanProducts.reduce(
          (sum, product) => sum + (product.netWeight || 0),
          0,
        ),
      0,
    );

    return {
      sales: filteredSales,
      totalSaleAmount,
      totalNetWeight,
      salesByDate, // Date-wise sales summary
      totalSaleAmountTillDate,
      totalNetWeightTillDate,
    };
  }

  public async getByIdDeliveryChallanForPdf(id: string): Promise<any> {
    const challan = await this.deliveryChallanRepo
      .createQueryBuilder('deliveryChallan')
      .leftJoinAndSelect('deliveryChallan.deliveryChallanProducts', 'deliveryChallanProducts')
      .leftJoinAndSelect('deliveryChallanProducts.productName', 'productName')
      .leftJoinAndSelect('deliveryChallanProducts.uom', 'uom')
      .leftJoinAndSelect('deliveryChallanProducts.saleUoM', 'saleUoM')
      .leftJoinAndSelect('deliveryChallanProducts.packagingMaterialUoM', 'packagingMaterialUoM')
      .leftJoinAndSelect('deliveryChallanProducts.packagingMaterial','packagingMaterial')
      .leftJoinAndSelect('deliveryChallan.companyName', 'companyName')
      .leftJoinAndSelect('deliveryChallan.offices', 'offices') 
      .leftJoinAndSelect('offices.address', 'officeAddress') 
      .leftJoinAndSelect('deliveryChallan.customer', 'customer')
      .leftJoinAndSelect('customer.deliveryDetails','deliveryDetails')
      .leftJoinAndSelect('deliveryDetails.deliveryAddress','deliveryAddress')
      .leftJoinAndSelect('deliveryChallan.grnNo','grnNo')
      .leftJoinAndSelect('deliveryChallan.toLocationInput','toLocationInput')
      .leftJoinAndSelect('deliveryChallan.fromLocationInput','fromLocationInput')
      .leftJoinAndSelect('deliveryChallan.requestedBy', 'requestedBy') 
      .leftJoinAndSelect('deliveryChallan.fromLocation', 'fromLocation')
      .leftJoinAndSelect('deliveryChallan.toLocation', 'toLocation') 
      .where('deliveryChallan.id = :id', { id })
      .getOne();
  
    if (!challan) {
      throw new Error('Delivery Challan not found');
    }
    const rawDate = challan.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);
    return {
      ...challan,
      createdDate,
      createdTime,
    };
  }
  
  public async generateDeliveryChallanPdf(id: string): Promise<Buffer> {
    const challanData = await this.getByIdDeliveryChallanForPdf(id);
    
    
  
    if (!challanData) {
      throw new Error('Delivery Challan not found');
    }
  
    const filePath = path.join(__dirname, '../templates/deliveryChallan.ejs');
   
    const html: string = await ejs.renderFile(filePath, { deliveryChallan: challanData });

  
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
  
    const pdfBuffer = await page.pdf({ format: 'A4' });
  
    await browser.close();
  
    return Buffer.from(pdfBuffer);
  }
  
}
