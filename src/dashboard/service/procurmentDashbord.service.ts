import { inject, injectable } from "inversify";
import { TYPES } from "../../types";

import { ProductRepository } from "../../product/createproduct/repository/product.repository";
import { UOMRepository } from "../../uom/repository/uom.repository";
import { VendorService } from "../../vendor/createVendor/service/vendor.service";

import { FarmerService } from "../../farmer/service/farmer.service";

import { UserRepository } from "../../employee/repository/user.repository";

import { RequestsRepository } from "../../sse/requests.repository";

import { Between } from "typeorm";
import { GrnRepository } from "../../grn/repository/grn.repository";
import { GrnProductRepository } from "../../grn/repository/grnProduct.repository";
import { BranchessRepository } from "../../branch/repository/branches.repository";
import { NotificationService } from "../../notification/service/notification.service";
import { UserService } from "../../employee/service/user.service";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { LevelsRepository } from "../../levels/repository/levels.repository";
import { GRN } from "../../grn/entity/grn.entity";

interface SupplierCostReduction {
    category: string;
    amount: number;
    percentage: number;
  }
 
  

@injectable()
export class ProcurmentDashService {
 
  constructor(
    @inject(TYPES.GrnRepository) private readonly grnRepository: GrnRepository,
    @inject(TYPES.GrnProductRepository)
    private readonly grnProductRepository: GrnProductRepository,
    @inject(TYPES.BranchessRepository)
    private readonly branchesRepository: BranchessRepository,
    @inject(TYPES.ProductRepository)
    private readonly productRepository: ProductRepository,
    @inject(TYPES.UOMRepository)
    private readonly uomRepository: UOMRepository,
    @inject(TYPES.VendorService)
    private readonly vendorService: VendorService,

    @inject(TYPES.NotificationService)
    private readonly notificationService: NotificationService,
    @inject(TYPES.FarmerService)
    private readonly farmerService: FarmerService,
    @inject(TYPES.UserService)
    private readonly userService: UserService,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.UserRepository)
    private readonly userRepository: UserRepository,
    @inject(TYPES.LevelsRepository)
    private readonly levelsRepository: LevelsRepository,
    @inject(TYPES.RequestsRepository)
    private readonly requestsRepository: RequestsRepository
  ) {}
  


 

 
 
 

 

 


  

async getGrnrtvBasisQtyandAmount(): Promise<{ totalnetweight: number; totalamt: number }> {
    const result = await this.grnRepository
        .createQueryBuilder('grn')
        .innerJoin('grn.grnProducts', 'grnProducts') 
        .where('grnProducts.rtv = :rtv', { rtv: true })
        .select([
            "SUM(grnProducts.netWeight) AS totalnetweight",
            "SUM(grnProducts.amount) AS totalamt"
        ])
        .getRawOne(); 

    return result ;
}

async getGrnrtvBasisQtyandAmountfalse(): Promise<{ totalnetweight: number; totalamt: number }> {
    const result= await this.grnRepository
        .createQueryBuilder('grn')
        .innerJoin('grn.grnProducts', 'grnProducts') 
        .where('grnProducts.rtv = :rtv', { rtv: false })
        .select([
            "SUM(grnProducts.netWeight) AS totalnetweight",
            "SUM(grnProducts.amount) AS totalamt"
        ])
        .getRawOne(); 

        return result ;
}


async getGrnByCompanyName(companyName:string):Promise<any>{
const grn = await this.grnRepository.find({
  where:{companyName:{id:companyName}}
})
}



 
async getTotalQtyAndAmount(startDate: Date, endDate: Date): Promise<any> {
  const result = await this.grnProductRepository
    .createQueryBuilder("grnProduct") 
    .select("COALESCE(SUM(grnProduct.netWeight), 0)", "totalQuantityInKg") 
    .addSelect("COALESCE(SUM(grnProduct.netWeight * grnProduct.unitPrice), 0)", "totalAmount") 
    .innerJoin(GRN, "grn", "grn.id = grnProduct.grn") 
    .where("grn.createdAt BETWEEN :startDate AND :endDate", { startDate, endDate })
    .getRawOne();


  return {
    totalQuantityInKg: Number(result.totalQuantityInKg),
    totalAmount: Number(result.totalAmount),
  };
}


// async getdataforTilldate(): Promise<any[]> {
//   const result = await this.grnProductRepository
//     .createQueryBuilder("grnProduct")
//     .select("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')", "date") 
//     .addSelect("COALESCE(SUM(grnProduct.netWeight), 0)", "totalQuantityInKg")
//     .addSelect("COALESCE(SUM(grnProduct.netWeight * grnProduct.unitPrice), 0)", "totalAmount")
//     .innerJoin(GRN, "grn", "grn.id = grnProduct.grn")
//     .groupBy("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')") 
//     .orderBy("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')", "ASC") 
//     .getRawMany();

//   console.log(result);

//   return result.map((row) => ({
//     date: row.date, // Already formatted as YYYY-MM-DD
//     quantity: Number(row.totalQuantityInKg),
//     amount: Number(row.totalAmount),
//   }));
// }
public async getDataForTillDate(filterType?: string, filterValue?: string): Promise<any[]> {
  let query = this.grnProductRepository
    .createQueryBuilder("grnProduct")
    .select("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')", "date")
    .addSelect("COALESCE(SUM(grnProduct.netWeight), 0)", "totalQuantityInKg")
    .addSelect("COALESCE(SUM(grnProduct.amount), 0)", "totalAmount")
    .innerJoin(GRN, "grn", "grn.id = grnProduct.grn")
    .where("grn.grnType = :grnType", { grnType: "purchase" }) 
    .groupBy("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')")
    .orderBy("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')", "ASC");

  // Apply filters dynamically
  if (filterType && filterValue) {
    switch (filterType) {
      case "purchaseLocation":
        query = query.andWhere("grn.purchaseLocation = :filterValue", { filterValue });
        break;
      case "purchaseForSalesLocation":
        query = query.andWhere("grn.purchaseForSalesLocation = :filterValue", { filterValue });
        break;
      case "vendor":
        query = query.andWhere("grn.selectedVendor = :filterValue", { filterValue });
        break;
      case "farmer":
        query = query.andWhere("grn.selectedFarmer = :filterValue", { filterValue });
        break;
      case "source":
        query = query.andWhere("grn.source = :filterValue", { filterValue });
        break;
      case "productName":
        query = query.andWhere("grnProduct.productName = :filterValue", { filterValue });
        break;
        case "companyName":
        query = query.andWhere("grn.companyName = :filterValue", { filterValue });
        break;
      case "vendorCategory":
        query = query
          .innerJoin("Vendor", "vendor", "vendor.id = grn.selectedVendor")
          .andWhere("vendor.category = :filterValue", { filterValue });
        break;
      default:
        query = query
    }
  }

  const result = await query.getRawMany();

  return result.map((row) => ({
    date: row.date,
    quantity: Number(row.totalQuantityInKg),
    amount: Number(row.totalAmount),
  }));
}





public async getDataForDates(
  filterType?: string,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  let query = this.grnProductRepository
    .createQueryBuilder("grnProduct")
    .select("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')", "date")
    .addSelect("COALESCE(SUM(grnProduct.netWeight), 0)", "totalQuantityInKg")
    .addSelect("COALESCE(SUM(grnProduct.amount), 0)", "totalAmount")
    .innerJoin(GRN, "grn", "grn.id = grnProduct.grn")
    .where("grn.grnType = :grnType", { grnType: "purchase" }) 
    .groupBy("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')")
    .orderBy("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')", "ASC");

 
  const currentDate = new Date().toISOString().split("T")[0]; 

  switch (filterType) {
    case "tillDate":
      query = query.andWhere("grn.createdAt <= :currentDate", { currentDate });
      break;

    case "financialYear": {
      
      const today = new Date();
      const financialYearStart =
        today.getMonth() + 1 >= 4 
          ? `${today.getFullYear()}-04-01`
          : `${today.getFullYear() - 1}-04-01`;
      query = query.andWhere("grn.createdAt BETWEEN :start AND :end", {
        start: financialYearStart,
        end: currentDate,
      });
      break;
    }

    case "today":
      query = query.andWhere("TO_CHAR(grn.createdAt, 'YYYY-MM-DD') = :currentDate", {
        currentDate,
      });
      break;

    case "dateRange":
      if (startDate && endDate) {
        query = query.andWhere("grn.createdAt BETWEEN :start AND :end", {
          start: startDate,
          end: endDate,
        });
      }
      break;

    default:
      query=query
      break; 
  }

  const result = await query.getRawMany();

  return result.map((row) => ({
    date: row.date,
    quantity: Number(row.totalQuantityInKg),
    amount: Number(row.totalAmount),
  }));
}



public async getFilteredGRNs(filters: any): Promise<any[]> {
  const query = this.grnRepository.createQueryBuilder("grn")
    .leftJoinAndSelect("grn.selectedVendor", "selectedVendor")
    .leftJoinAndSelect("grn.selectedFarmer", "selectedFarmer")
    .leftJoinAndSelect("grn.purchaseLocation", "purchaseLocation")
    .leftJoinAndSelect("grn.purchaseForSalesLocation", "purchaseForSalesLocation")
    .leftJoinAndSelect("grn.companyName", "companyName")
    .leftJoinAndSelect("grn.dealSlipId", "dealSlipId")
    .leftJoinAndSelect("grn.grnProducts", "grnProducts")
    .leftJoinAndSelect('grnProducts.productName', 'productName')
    .leftJoinAndSelect("grnProducts.uom", "uom")
    .leftJoinAndSelect("grn.requestedBy", "requestedBy")
    .leftJoinAndSelect("grn.purchaseBy", "purchaseBy")
    .orderBy("grn.createdAt", "DESC");

  // Apply Filters
  if (filters.grnNo) {
    query.andWhere("grn.grnNo ILIKE :grnNo", { grnNo: `%${filters.grnNo}%` });
  }
  if (filters.source) {
    query.andWhere("grn.source = :source", { source: filters.source });
  }
  if (filters.purchaseInstructionsBy) {
    query.andWhere("grn.purchaseInstructionsBy ILIKE :purchaseInstructionsBy", {
      purchaseInstructionsBy: `%${filters.purchaseInstructionsBy}%`,
    });
  }
  if (filters.companyName) {
    query.andWhere("grn.companyName = :companyId", { companyId: filters.companyName });
  }
  if (filters.locationType) {
    query.andWhere("grn.locationType = :locationType", { locationType: filters.locationType });
  }
  if (filters.grnType) {
    query.andWhere("grn.grnType = :grnType", { grnType: filters.grnType });
  }
  if (filters.purchaseType) {
    query.andWhere("grn.purchaseType = :purchaseType", { purchaseType: filters.purchaseType });
  }
  if (filters.dealSlipId) {
    query.orWhere("dealSlipId.id = :dealSlipId", { dealSlipId: filters.dealSlipId });
  }
  if (filters.purchaseLocation) {
    query.andWhere("purchaseLocation.id = :purchaseLocation", { purchaseLocation: filters.purchaseLocation });
  }
  if (filters.vendorId) {
    query.andWhere("selectedVendor.id = :vendorId", { vendorId: filters.vendorId });
  }
  if (filters.farmerId) {
    query.andWhere("selectedFarmer.id = :farmerId", { farmerId: filters.farmerId });
  }
  if (filters.vendorcategoryId) {
    query.andWhere("selectedVendor.category = :categoryId", { categoryId: filters.vendorcategoryId });
  }
  if (filters.vendorsubcategoryId) {
    query.andWhere("selectedVendor.subcategory = :subcategoryId", { subcategoryId: filters.vendorsubcategoryId });
  }
  if (filters.productId) {
    query.andWhere("productName.id = :productId", { productId: filters.productId });
  }
  if (filters.productCategoryId) {
    query.andWhere("productName.category = :productCategoryId", { productCategoryId: filters.productCategoryId });
  }
  if (filters.productSubCategoryId) {
    query.andWhere("productName.subcategory = :productSubCategoryId", { productSubCategoryId: filters.productSubCategoryId });
  }
  if (filters.approvalStatus) {
    query.andWhere("grn.approvalStatus = :approvalStatus", { approvalStatus: filters.approvalStatus });
  }
  if (filters.dateFrom) {
    query.andWhere("grn.createdAt >= :dateFrom", { dateFrom: filters.dateFrom });
  }
  if (filters.dateTo) {
    query.andWhere("grn.createdAt <= :dateTo", { dateTo: filters.dateTo });
  }

  const grns = await query.getMany();

  // Transform Data to Match `getAllGrns` Format
  return grns.map((grn) => {
   
    const selectedParty =
  grn.source === "vendor"
    ? grn.selectedVendor?.companyName || null
    : grn.source === "farmer"
    ? `${grn.selectedFarmer?.farmerfName || ""}${grn.selectedFarmer?.farmermName || ""} ${grn.selectedFarmer?.farmerlName || ""}`.trim() || null
    : null;

  

    return {
      id: grn.id,
      companyName: grn.companyName?.name || null,
      grnNo: grn.grnNo.toUpperCase(),
      dealSlip:grn.dealSlipId?.dealSlipNo || null,
      purchaseLocation: grn.purchaseLocation?.name || null,
      purchaseForSalesLocation: grn.purchaseForSalesLocation?.name || null,
      otherPurchaseForSalesLoc: grn.otherPurchaseForSalesLoc || null,
      otherPurchaseLoc: grn.otherPurchaseLoc || null,
      purchaseInstructionsBy: grn.purchaseInstructionsBy,
      source: grn.source,
      billNo: grn.billNo,
      grnType: grn.grnType,
      locationType: grn.locationType,
      purchaseType: grn.purchaseType,
      subTotalAmt: grn.subTotalAmt,
      freight: grn.freight,
      otherCharges: grn.otherCharges,
      totalAmt: grn.totalAmt,
      amtWords: grn.amtWords,
      purchasedBy: grn.purchasedBy,
      receivedThrough: grn.receivedThrough,
      vehicleNo: grn.vehicleNo,
      timeIn: grn.timeIn,
      cratesIn: grn.cratesIn,
      deliveryReceivingPerson: grn.deliveryReceivingPerson,
      baseLocation: grn.baseLocation,
      approvalStatus: (grn as any).approvalStatus,
      approvalNote: grn.approvalNote,
      specialReq: grn.specialReq,
      securityPerson: grn.securityPerson,
      remark: grn.remark,
      createdAt: grn.createdAt,
     
      requestedBy: {
        firstName: (grn as any).requestedBy?.firstName || "",
        lastName: (grn as any).requestedBy?.lastName || "",
      },
      purchaseBy: {
        firstName: grn.purchaseBy?.firstName || "",
        lastName: grn.purchaseBy?.lastName || "",
      },
      selectedParty: selectedParty,
      grnProducts: grn.grnProducts.map((product) => ({
        id: product.id,
        quantity: product.quantity,
        unitPrice: product.unitPrice,
        productName: product.productName?.id,
        uom: product.uom?.id,
        
        amount: product.amount,
        rtv: product.rtv,
        purchaseDate: product.purchaseDate,
        dispatchDate: product.dispatchDate,
        deliveryDate: product.deliveryDate,
        expectedHarvestDate: product.expectedHarvestDate,
      }))
    };
  });
}



async getDashboardMetrics(start: Date, end: Date) {
  const [metrics, trends, topVendors, topProducts] = await Promise.all([
    this.getBasicMetrics(start, end),
    this.getPurchaseTrends(start, end),
    this.getTopVendors(start, end),
    this.getTopProducts(start, end),
  ]);

  return { metrics, trends, topVendors, topProducts };
}

private async getBasicMetrics(start: Date, end: Date) {
  return await this.grnRepository
    .createQueryBuilder('grn')
    .leftJoin('grn.grnProducts', 'grnProduct') // Join with GrnProduct
    .select([
      'COUNT(DISTINCT grn.grnNo) AS "totalPurchases"',
      'SUM(grnProduct.amount) AS "totalAmount"', // Sum of grnProduct.amount
      'AVG(grnProduct.amount) AS "averageAmount"',
    ])
    .where('grn.createdAt BETWEEN :startDate AND :endDate', { 
      startDate: start.toISOString(), 
      endDate: end.toISOString() 
    })
    .andWhere('grn.grnType = :grnType', { grnType: 'purchase' })
    .getRawOne();
}




private async getPurchaseTrends(start: Date, end: Date) {
  

  const rawTrends = await this.grnRepository
    .createQueryBuilder('grn')
    .leftJoin('grn.grnProducts', 'grnProduct')
    .select([
      "DATE_TRUNC('month', grn.createdAt) AS month",
      'SUM(grnProduct.amount) AS "totalAmount"',
    ])
    .where('grn.createdAt BETWEEN :startDate AND :endDate', { startDate: start, endDate: end })
    .andWhere('grn.grnType = :grnType', { grnType: 'purchase' })
    .groupBy("DATE_TRUNC('month', grn.createdAt)")
    .orderBy("DATE_TRUNC('month', grn.createdAt)", 'ASC')
    .getRawMany();

  // Convert month to IST (India Standard Time)
  const trends = rawTrends.map((trend) => ({
    month: new Date(trend.month).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
    totalAmount: trend.totalAmount,
  }));
trends.forEach((trend) => {
  console.log(trend.month); // Log each trend object
}); 

  return trends;
}




private async getTopVendors(start: Date, end: Date) {
  return await this.grnRepository
    .createQueryBuilder('grn')
    .leftJoinAndSelect('grn.selectedVendor', 'vendor')
    .leftJoinAndSelect('grn.grnProducts', 'grnProduct') 
    .select(['vendor.id AS vendorId', 'vendor.companyName AS vendorName', 
      'SUM(grnProduct.amount) AS "totalPurchase"',
      ])
    .where('grn.createdAt BETWEEN :startDate AND :endDate', { startDate: start, endDate: end })
    .andWhere('grn.grnType = :grnType', { grnType: 'purchase' }) // Added filter
    .andWhere('vendor.id IS NOT NULL') // Ensure only valid vendors
    .groupBy('vendor.id, vendor.companyName') // Grouping by ID and Name
    .orderBy('SUM(grn.totalAmt)', 'DESC')
    .limit(5)
    .getRawMany();
}

private async getTopProducts(start: Date, end: Date, locationId?: string, companyName?: string) {
  const query = this.grnRepository
    .createQueryBuilder('grn')
    .leftJoinAndSelect("grn.grnProducts", "grnProducts")
    .leftJoinAndSelect("grnProducts.productName", "productName")
    .select([
      'COALESCE(productName.name, \'Unknown\') AS name', 
      'COALESCE(SUM(grnProducts.netWeight), 0) as totalQuantity'
    ])
    .where('grn.createdAt BETWEEN :startDate AND :endDate', { startDate: start, endDate: end })
    .andWhere('grn.grnType = :grnType', { grnType: 'purchase' });

  if (companyName) {
    query.andWhere('grn.companyName = :companyName', { companyName });
  }

  if (locationId) {
    query.andWhere('grn.purchaseLocation = :locationId', { locationId });
  }

  return await query
    .groupBy('productName.name')
    .orderBy('totalQuantity', 'DESC')
    .limit(5)
    .getRawMany();
}





async getFarmerAnalytics(filters: { startDate?: string; endDate?: string }) {
  const query = this.grnRepository
    .createQueryBuilder('grn')
    .leftJoin('grn.selectedFarmer', 'farmer')
    .leftJoin('grn.grnProducts', 'grnProduct')
    .leftJoin('grnProduct.productName', 'product')
    .where('grn.source = :source', { source: 'farmer' })
    .andWhere('grn.grnType = :grnType', { grnType: 'purchase' });

  if (filters.startDate && filters.endDate) {
    query.andWhere('grn.createdAt BETWEEN :startDate AND :endDate', {
      startDate: filters.startDate,
      endDate: filters.endDate,
    });
  }
 


  const basicMetrics = await query.clone()
  .select([
    'COUNT(DISTINCT grn.id) as totalPurchases',
    'COALESCE(SUM(grn.totalAmt), 0) as totalAmount',
    'COALESCE(AVG(grn.totalAmt), 0) as averageAmount',
  ])
  .getRawOne();

    //console.log('Executing Query:', query.clone().getSql());


    const productBreakdown = await query.clone()
    .select([
      'product.name as productName',
      'SUM(grnProduct.netWeight) as totalQuantity',
      'SUM(grnProduct.amount) / NULLIF(SUM(grnProduct.netWeight), 0) as averagePricePerUnit',
    ])
    .groupBy('product.name')
    .getRawMany();
  

  const seasonalTrends = await query.clone()
    .select(["DATE_TRUNC('month', grn.createdAt) as month", 'SUM(grnProduct.netWeight) as quantity'])
    .groupBy("DATE_TRUNC('month', grn.createdAt)")
    .orderBy("DATE_TRUNC('month', grn.createdAt)", 'ASC')
    .getRawMany();

  return {
    totalPurchases: basicMetrics.totalPurchases || 0,
    totalAmount: basicMetrics.totalAmount || 0,
    averageAmount: basicMetrics.averageAmount || 0,
    productBreakdown,
    seasonalTrends,
    
  };
}

async getProcurementByMonth(start: Date, end: Date, locationId?: string, companyName?: string): Promise<{ purchases: number; monthly: string }[]> {
    const query = this.grnRepository
      .createQueryBuilder("grn")
      .select("COUNT(*)", "purchases")
      .addSelect(`TO_CHAR(DATE_TRUNC('month', grn.createdAt), 'Mon - YYYY')`, "monthly")
      .where("grn.grnType = :grnType", { grnType: "purchase" })
      .andWhere("grn.createdAt BETWEEN :start AND :end", { start, end });
  
    if (locationId) {
      query.andWhere("grn.purchaseLocation = :locationId", { locationId });
    }
  
    if (companyName) {
      query.andWhere("grn.companyName = :companyName", { companyName });
    }
  
    return await query.groupBy("monthly").orderBy("monthly", "ASC").limit(100).getRawMany();
  }
  


  async getProcurmentByCategoryandSubcategory(start: Date, end: Date, locationId?: string, companyName?: string): Promise<any> {
    const query = this.grnRepository
      .createQueryBuilder("grn")
      .leftJoin("grn.selectedVendor", "vendor")
      .leftJoin("vendor.category", "vendorCategory")
      .leftJoin("vendor.subcategory", "vendorSubCategory")
      .select("vendorCategory.name", "vendorCategory")
      .addSelect("vendorSubCategory.name", "vendorSubCategory")
      .addSelect("AVG(COALESCE(grn.totalAmt, 0))", "avgProcurementCost")
      .andWhere("grn.grnType = :grnType", { grnType: "purchase" })
      .where("grn.createdAt BETWEEN :start AND :end", { start, end });
  
    if (locationId) {
      query.andWhere("grn.purchaseLocation = :locationId", { locationId });
    }
  
    if (companyName) {
      query.andWhere("grn.companyName = :companyName", { companyName });
    }
  
    return await query
      .groupBy("vendorCategory.name, vendorSubCategory.name")
      .orderBy("vendorCategory.name", "ASC")
      .addOrderBy("vendorSubCategory.name", "ASC")
      .getRawMany();
  }
  async getProcurmentBySource(start: Date, end: Date, locationId?: string, companyName?: string): Promise<any> {
    const query = this.grnRepository
      .createQueryBuilder("grn")
      .select("grn.source", "source") // Select the source (vendor, farmer, etc.)
      .andWhere("grn.grnType = :grnType", { grnType: "purchase" })
      .addSelect("AVG(COALESCE(grn.totalAmt, 0))", "avgProcurementCost") // Calculate average procurement cost
      .where("grn.createdAt BETWEEN :start AND :end", { start, end });
  
    if (locationId) {
      query.andWhere("grn.purchaseLocation = :locationId", { locationId });
    }
  
    if (companyName) {
      query.andWhere("grn.companyName = :companyName", { companyName });
    }
  
    return await query
      .groupBy("grn.source") // Group by source (vendor, farmer, etc.)
      .orderBy("grn.source", "ASC") // Sort results by source name
      .getRawMany();
  }
  

  async getProcurmentbyproduct(start: Date, end: Date, locationId?: string, companyName?: string): Promise<any> {
    const query = this.grnProductRepository
      .createQueryBuilder("grnProduct")
      .select("SUM(grnProduct.amount)", "spend")
      .addSelect("product.name", "product")
      .innerJoin("grnProduct.productName", "product")
      .innerJoin("grnProduct.grn", "grn") 
      .andWhere("grn.grnType = :grnType", { grnType: "purchase" })
      .where("grn.createdAt BETWEEN :start AND :end", { start, end });
  
    if (locationId) {
      query.andWhere("grn.purchaseLocation = :locationId", { locationId });
    }
  
    if (companyName) {
      query.andWhere("grn.companyName = :companyName", { companyName });
    }
  
    return await query.groupBy("product.name").limit(100).getRawMany();
  }
  



private getDateRange(filterType: string, currentDate: Date, startDate?: Date, endDate?: Date, specificDate?: Date): { start: Date; end: Date } {
  let start: Date;
  let end: Date;

  switch (filterType) {
    case "tillDate":
      start = new Date(0);
      end = currentDate;
      break;
    case "year":
      start = new Date(currentDate.getFullYear(), 0, 1);
      end = currentDate;
      break;
    case "month":
      start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      end = currentDate;
      break;
    case "dateRange":
      start = startDate ?? new Date(currentDate.getFullYear(), 0, 1);
      end = endDate ?? currentDate;
      break;
    case "specificDate":
      if (!specificDate) {
        throw new Error("Specific date is required for 'specificDate' filter.");
      }
      start = new Date(specificDate);
      start.setHours(0, 0, 0, 0);
      end = new Date(specificDate);
      end.setHours(23, 59, 59, 999);
      break;
    default:
      throw new Error("Invalid filter type.");
  }
  
  return { start, end };
}

async getProcurementDashboard(
  filterType: string = "tillDate",
  startDate?: Date,
  endDate?: Date,
  specificDate?: Date,
  locationId?: string,
  companyName?: string,
): Promise<any> {
  try {
    const currentDate = new Date();
    
    const { start, end } = this.getDateRange(filterType, currentDate, startDate, endDate, specificDate);

    let baseQuery = this.grnRepository
      .createQueryBuilder("grn")
      .leftJoinAndSelect("grn.grnProducts", "grnProducts")
      .leftJoinAndSelect("grn.selectedVendor", "vendor")
      .andWhere("grn.grnType = :grnType", { grnType: "purchase" })
      .where("grn.createdAt BETWEEN :start AND :end", { start, end });

    if (locationId) {
      baseQuery = baseQuery.andWhere("grn.purchaseLocation = :locationId", { locationId });
    }

    if (companyName) {
      baseQuery = baseQuery.andWhere("grn.companyName = :companyName", { companyName });
    }

    const [grns, count, procurementByMonth, procurementByCategory, procurementByProduct, procurementBySource, procurementOfTopProduct] = await Promise.all([
      baseQuery.getMany(),
      baseQuery.getCount(),
      this.getProcurementByMonth(start, end, locationId, companyName),
      this.getProcurmentByCategoryandSubcategory(start, end, locationId, companyName),
      this.getProcurmentbyproduct(start, end, locationId, companyName),
      this.getProcurmentBySource(start, end, locationId, companyName),
      this.getTopProducts(start, end, locationId, companyName),
    ]);

    const totalExpenditure = grns.reduce((acc, grn) => acc + Number(grn.totalAmt), 0);

    return {
      filterType,
      totalGRNs: count,
      totalExpenditure,
      procurementByMonth,
      procurementByCategory,
      procurementByProduct,
      procurementBySource,
      procurementOfTopProduct,
      grns,
    };
  } catch (error) {
    console.error("Error in getProcurementDashboard:", error);
    throw new Error("Failed to fetch procurement dashboard data");
  }
}


  }

  

  

  

  


  
