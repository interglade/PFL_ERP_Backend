import { inject, injectable } from "inversify";
import { Between, DataSource, LessThanOrEqual, MoreThanOrEqual } from "typeorm";
import { CustomerRepository } from "../../customer/addcustomer/repository/customer.repository";
import { TYPES } from "../../types";
import { VendorRepository } from "../../vendor/createVendor/repository/vendor.repository";
import { DocumentbRepository } from "../../approvalFlow/repository/documentb.repository";
import { FarmerRepository } from "../../farmer/repository/farmer.repository";
import { GrnRepository } from "../../grn/repository/grn.repository";
import { DitemRepository } from "../../deliveryChallans/deliverychllan/repository/dItem.repository";
import { GrnProductRepository } from "../../grn/repository/grnProduct.repository";
import { Customer } from "../../customer/addcustomer/entity/customer.entity";
import { Status } from "../../utils/status.enum";
import { DocumentTypeEnum } from "../../approvalFlow/entity/docuemnt.entity";
import logger from "../../utils/logger";



@injectable()
export class UserReportService {
  private customerRepository: CustomerRepository;

  constructor(
    @inject(TYPES.VendorRepository)
    private readonly vendorRepository: VendorRepository,
    @inject(TYPES.DocumentbRepository)
        private documentbRepository: DocumentbRepository,
    @inject(TYPES.FarmerRepository)
    private readonly farmerRepository: FarmerRepository,
    @inject(TYPES.DataSource) private dataSource: DataSource,
    @inject(TYPES.GrnRepository) private readonly grnRepository: GrnRepository,
    @inject(TYPES.DitemRepository) private itemRepository: DitemRepository,
        @inject(TYPES.GrnProductRepository)
        private readonly grnProductRepository: GrnProductRepository,
  ) {
    this.customerRepository = this.dataSource.getRepository(
      Customer
    ) as CustomerRepository;
  }

  async countofregisteredusers(filters?: {
    createdBy?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<any> {
    const vendorCounts = await this.getStatusCounts(this.vendorRepository, filters);
    const farmerCounts = await this.getStatusCounts(this.farmerRepository, filters);
    const customerCounts = await this.getStatusCounts(this.customerRepository, filters);

    return {
      vendors: vendorCounts,
      farmers: farmerCounts,
      customers: customerCounts,
    };
  }

  private async getStatusCounts(repository: any, filters?: any) {
  const whereBase: any = {};

  
  if (filters?.createdBy) {
    whereBase.createdBy = { id: filters.createdBy };
  }

   // Filter by date range
  if (filters?.startDate && filters?.endDate) {
    const start = new Date(filters.startDate + 'T00:00:00');
    const end = new Date(filters.endDate + 'T23:59:59');
    whereBase.createdAt = Between(start, end);
  } else if (filters?.startDate) {
    const start = new Date(filters.startDate + 'T00:00:00');
    whereBase.createdAt = MoreThanOrEqual(start);
  } else if (filters?.endDate) {
    const end = new Date(filters.endDate + 'T23:59:59');
    whereBase.createdAt = LessThanOrEqual(end);
  }

 

  const approved = await repository.count({
    where: { ...whereBase, status: Status.APPROVED },
  });

  const pending = await repository.count({
    where: { ...whereBase, status: Status.PENDING },
  });

  const notApproved = await repository.count({
    where: { ...whereBase, status: Status.REJECTED },
  });

  const total = approved + pending + notApproved;

  return { total, approved, pending, notApproved };
}




async totalPurchase(filters?: {
  createdBy?: string;
  date?: string;
  month?: number;
  year?: number;
  startDate?: string;
  endDate?: string;
  productId?: string;
  source?: string;
  farmer?: string;
  vendor?: string;
  companyId?: string;
  fromLocationId?: string;
  page?: number;
  limit?: number;
}): Promise<{
  overallTotalQty: number;
  overallTotalAmount: number;
  dateWise: { date: string; totalQty: number; totalAmount: number }[];
  pagination: { totalRecords: number; totalPages: number; currentPage: number; limit: number };
}> {
  // 1️⃣ Get overall totals (no filters)
  const totalQb = this.grnProductRepository
    .createQueryBuilder('grnProduct')
    .leftJoin('grnProduct.grn', 'grn');

  totalQb
    .select('SUM(grnProduct.netWeight)', 'overallTotalQty')
    .addSelect('SUM(grnProduct.amount)', 'overallTotalAmount');
    if (filters?.createdBy) {
  totalQb.andWhere('grn.createdBy = :createdBy', { createdBy: filters.createdBy });
}

  const totalResult = await totalQb.getRawOne();

  // 2️⃣ Get date-wise totals (with filters)
  const qb = this.grnProductRepository
    .createQueryBuilder('grnProduct')
    .leftJoin('grnProduct.grn', 'grn')
    .leftJoin('grn.companyName', 'company')
    .leftJoin('grnProduct.productName', 'product')
    .leftJoin('grn.selectedFarmer', 'farmer')
    .leftJoin('grn.selectedVendor', 'vendor')
    .leftJoin('grn.purchaseLocation', 'location');

  qb.select("TO_CHAR(grn.createdAt, 'DD-MM-YYYY')", 'date')
    .addSelect('SUM(grnProduct.netWeight)', 'totalQty')
    .addSelect('SUM(grnProduct.amount)', 'totalAmount')
    .groupBy("TO_CHAR(grn.createdAt, 'DD-MM-YYYY')")
    .orderBy('MIN(grn.createdAt)', 'ASC');

  // 3️⃣ Apply filters
  qb.andWhere('grn.id IS NOT NULL'); // exclude orphaned grnProduct rows with no associated GRN
  if (filters?.createdBy) qb.andWhere('grn.createdBy = :createdBy', { createdBy: filters.createdBy });
  if (filters?.date) qb.andWhere('DATE(grn.createdAt) = :date', { date: filters.date });
  if (filters?.month) qb.andWhere('EXTRACT(MONTH FROM grn.createdAt) = :month', { month: filters.month });
  if (filters?.year) qb.andWhere('EXTRACT(YEAR FROM grn.createdAt) = :year', { year: filters.year });
  if (filters?.startDate && filters?.endDate)
    qb.andWhere('DATE(grn.createdAt) BETWEEN :startDate AND :endDate', {
      startDate: filters.startDate,
      endDate: filters.endDate,
    });
  if (filters?.productId) qb.andWhere('grnProduct.productName = :productId', { productId: filters.productId });
  if (filters?.source) qb.andWhere('grn.source = :source', { source: filters.source });
  if (filters?.companyId) qb.andWhere('grn.companyName = :companyId', { companyId: filters.companyId });
  if (filters?.farmer) qb.andWhere('grn.selectedFarmer = :farmer', { farmer: filters.farmer });
  if (filters?.vendor) qb.andWhere('grn.selectedVendor = :vendor', { vendor: filters.vendor });
  if (filters?.fromLocationId) qb.andWhere('grn.purchaseLocation = :fromLocationId', { fromLocationId: filters.fromLocationId });

  // 4️⃣ Handle pagination
  const page = filters?.page && filters.page > 0 ? filters.page : 1;
  const limit = filters?.limit && filters.limit > 0 ? filters.limit : 10;
  const offset = (page - 1) * limit;

  // Get total count for pagination
  const countQb = this.grnProductRepository
    .createQueryBuilder('grnProduct')
    .leftJoin('grnProduct.grn', 'grn')
    .select("COUNT(DISTINCT TO_CHAR(grn.createdAt, 'DD-MM-YYYY'))", 'count');

  // Apply same filters to count query
  countQb.andWhere('grn.id IS NOT NULL'); // exclude orphaned grnProduct rows with no associated GRN
  if (filters?.createdBy) countQb.andWhere('grn.createdBy = :createdBy', { createdBy: filters.createdBy });
  if (filters?.date) countQb.andWhere('DATE(grn.createdAt) = :date', { date: filters.date });
  if (filters?.month) countQb.andWhere('EXTRACT(MONTH FROM grn.createdAt) = :month', { month: filters.month });
  if (filters?.year) countQb.andWhere('EXTRACT(YEAR FROM grn.createdAt) = :year', { year: filters.year });
  if (filters?.startDate && filters?.endDate)
    countQb.andWhere('DATE(grn.createdAt) BETWEEN :startDate AND :endDate', {
      startDate: filters.startDate,
      endDate: filters.endDate,
    });
  if (filters?.productId) countQb.andWhere('grnProduct.productName = :productId', { productId: filters.productId });
  if (filters?.source) countQb.andWhere('grn.source = :source', { source: filters.source });
  if (filters?.companyId) countQb.andWhere('grn.companyName = :companyId', { companyId: filters.companyId });
  if (filters?.farmer) countQb.andWhere('grn.selectedFarmer = :farmer', { farmer: filters.farmer });
  if (filters?.vendor) countQb.andWhere('grn.selectedVendor = :vendor', { vendor: filters.vendor });
  if (filters?.fromLocationId) countQb.andWhere('grn.purchaseLocation = :fromLocationId', { fromLocationId: filters.fromLocationId });

  const countResult = await countQb.getRawOne();
  const totalRecords = Number(countResult?.count || 0);
  const totalPages = Math.ceil(totalRecords / limit);

  qb.offset(offset).limit(limit);

  // 5️⃣ Execute paginated query
  const dateWiseResult = await qb.getRawMany();

  // 6️⃣ Return final result
  return {
    overallTotalQty: Number(totalResult?.overallTotalQty || 0),
    overallTotalAmount: Number(totalResult?.overallTotalAmount || 0),
    dateWise: dateWiseResult
      .filter((row) => row.date !== null)
      .map((row) => ({
        date: row.date,
        totalQty: Number(row.totalQty || 0),
        totalAmount: Number(row.totalAmount || 0),
      })),
    pagination: {
      totalRecords,
      totalPages,
      currentPage: page,
      limit,
    },
  };
}async totalSale(filters?: {
  createdBy?: string;
  date?: string;
  month?: number;
  year?: number;
  startDate?: string;
  endDate?: string;
  productId?: string;
  customer?: string;
  companyId?: string;
  fromLocationId?: string;
  page?: number;
  limit?: number;
}): Promise<{
  overallTotalQty: number;
  overallTotalAmount: number;
  dateWise: { date: string; totalQty: number; totalAmount: number }[];
  pagination: { totalRecords: number; totalPages: number; currentPage: number; limit: number };
}> {
  // 1️⃣ Overall totals (no filters)
  const totalQb = this.itemRepository
    .createQueryBuilder('item')
    .leftJoin('item.deliveryChallan', 'challan')
    .where('challan.type = :type', { type: 'customer' });

  totalQb
    .select('SUM(item.netWeight)', 'overallTotalQty')
    .addSelect('SUM(item.amount)', 'overallTotalAmount')
if (filters?.createdBy) {
  totalQb.andWhere('challan.createdBy = :createdBy', { createdBy: filters.createdBy });
}

  const totalResult = await totalQb.getRawOne();

  // 2️⃣ Date-wise totals (with filters)
  const qb = this.itemRepository
    .createQueryBuilder('item')
    .leftJoin('item.deliveryChallan', 'challan')
    .leftJoin('challan.companyName', 'company')
    .leftJoin('item.productName', 'product')
    .leftJoin('challan.customerName', 'customer')
    .leftJoin('challan.fromLocation', 'fromLocation')
    .where('challan.type = :type', { type: 'customer' });

  qb.select("TO_CHAR(challan.createdAt, 'DD-MM-YYYY')", 'date')
    .addSelect('SUM(item.netWeight)', 'totalQty')
    .addSelect('SUM(item.amount)', 'totalAmount')
    .groupBy("TO_CHAR(challan.createdAt, 'DD-MM-YYYY')")
    .orderBy('MIN(challan.createdAt)', 'ASC');

  // 🔍 Apply filters
  qb.andWhere('challan.id IS NOT NULL'); // exclude orphaned item rows with no associated challan
  if (filters?.createdBy) qb.andWhere('challan.createdBy = :createdBy', { createdBy: filters.createdBy });
  if (filters?.date) qb.andWhere('DATE(challan.createdAt) = :date', { date: filters.date });
  if (filters?.month) qb.andWhere('EXTRACT(MONTH FROM challan.createdAt) = :month', { month: filters.month });
  if (filters?.year) qb.andWhere('EXTRACT(YEAR FROM challan.createdAt) = :year', { year: filters.year });
  if (filters?.startDate && filters?.endDate)
    qb.andWhere('DATE(challan.createdAt) BETWEEN :startDate AND :endDate', {
      startDate: filters.startDate,
      endDate: filters.endDate,
    });
  if (filters?.productId) qb.andWhere('item.productName = :productId', { productId: filters.productId });
  if (filters?.companyId) qb.andWhere('challan.companyName = :companyId', { companyId: filters.companyId });
  if (filters?.customer) qb.andWhere('challan.customerName = :customer', { customer: filters.customer });

  // 3️⃣ Handle pagination setup
  const page = filters?.page && filters.page > 0 ? filters.page : 1;
  const limit = filters?.limit && filters.limit > 0 ? filters.limit : 10;
  const offset = (page - 1) * limit;

  // 4️⃣ Count total distinct date groups for pagination
  const countQb = this.itemRepository
    .createQueryBuilder('item')
    .leftJoin('item.deliveryChallan', 'challan')
    .where('challan.type = :type', { type: 'customer' })
    .select("COUNT(DISTINCT TO_CHAR(challan.createdAt, 'DD-MM-YYYY'))", 'count');

  // Apply same filters to count query
  countQb.andWhere('challan.id IS NOT NULL'); // exclude orphaned item rows with no associated challan
  if (filters?.createdBy) countQb.andWhere('challan.createdBy = :createdBy', { createdBy: filters.createdBy });
  if (filters?.date) countQb.andWhere('DATE(challan.createdAt) = :date', { date: filters.date });
  if (filters?.month) countQb.andWhere('EXTRACT(MONTH FROM challan.createdAt) = :month', { month: filters.month });
  if (filters?.year) countQb.andWhere('EXTRACT(YEAR FROM challan.createdAt) = :year', { year: filters.year });
  if (filters?.startDate && filters?.endDate)
    countQb.andWhere('DATE(challan.createdAt) BETWEEN :startDate AND :endDate', {
      startDate: filters.startDate,
      endDate: filters.endDate,
    });
  if (filters?.productId) countQb.andWhere('item.productName = :productId', { productId: filters.productId });
  if (filters?.companyId) countQb.andWhere('challan.companyName = :companyId', { companyId: filters.companyId });
  if (filters?.customer) countQb.andWhere('challan.customerName = :customer', { customer: filters.customer });

  const countResult = await countQb.getRawOne();
  const totalRecords = Number(countResult?.count || 0);
  const totalPages = Math.ceil(totalRecords / limit);

  // 5️⃣ Apply pagination to main query
  qb.offset(offset).limit(limit);

  // 6️⃣ Execute paginated query
  const dateWiseResult = await qb.getRawMany();

  // 7️⃣ Return structured result
  return {
    overallTotalQty: Number(totalResult?.overallTotalQty || 0),
    overallTotalAmount: Number(totalResult?.overallTotalAmount || 0),
    dateWise: dateWiseResult
      .filter((row) => row.date !== null)
      .map((row) => ({
        date: row.date,
        totalQty: Number(row.totalQty || 0),
        totalAmount: Number(row.totalAmount || 0),
      })),
    pagination: {
      totalRecords,
      totalPages,
      currentPage: page,
      limit,
    },
  };
}









async getCountOfAllDocumentsByStatus(startDate?: Date, endDate?: Date): Promise<any> {
  try {
    const queryBuilder = this.documentbRepository
      .createQueryBuilder("doc")
      .select("doc.type", "type")
      .addSelect("doc.status", "status")
      .addSelect("COUNT(doc.id)", "count")
      .groupBy("doc.type")
      .addGroupBy("doc.status");

      if (startDate && endDate) {
      queryBuilder.where("doc.createdAt BETWEEN :start AND :end", { start: startDate, end: endDate });
    }

    const queryResult = await queryBuilder.getRawMany();

    // ✅ Build a map of counts by type and status
    const resultMap: Record<string, Record<string, number>> = {};
    queryResult.forEach(row => {
      if (!resultMap[row.type]) resultMap[row.type] = {};
      resultMap[row.type][row.status] = parseInt(row.count, 10);
    });

    const STATUSES = ["hold", "approved", "rejected", "COMPLETE"];

    // ✅ Convert type to camelCase
    const toCamelCase = (str: string): string => {
      return str
        .toLowerCase()
        .replace(/([-_][a-z])/g, group => group.toUpperCase().replace('-', '').replace('_', ''));
    };

    const finalResult: Record<string, Record<string, number>> = {};

    // ✅ Loop through all document types in Enum — even if they don’t exist in DB
    Object.values(DocumentTypeEnum).forEach(type => {
      const camelType = toCamelCase(type);
      const statusCounts: Record<string, number> = {};

      // Use DB result if present, else default to 0
      STATUSES.forEach(status => {
        statusCounts[status] = resultMap[type]?.[status] || 0;
      });

      const total = Object.values(statusCounts).reduce((sum, val) => sum + val, 0);
      finalResult[camelType] = { total, ...statusCounts };
    });

    return finalResult;
  } catch (error) {
    logger.error("Error fetching total count by status:", error);
    throw new Error("Failed to fetch document status counts");
  }
}





}


//TODO:Get Count of All Documents By It's Status In Given Date Range
// async getCountOfAllDocumentsByStatus(startDate?: Date, endDate?: Date): Promise<any> {
//   try {
    
//     const queryBuilder = await this.documentbRepository
//       .createQueryBuilder("doc")
//       .select("doc.type", "type")
//       .addSelect("doc.status", "status")
//       .addSelect("COUNT(doc.id)", "count")
//       .groupBy("doc.type")
//       .addGroupBy("doc.status");

//     if (startDate && endDate) {
//       queryBuilder.where("doc.createdAt BETWEEN :startDate AND :endDate", { startDate, endDate });
//     }

//     const queryResult = await queryBuilder.getRawMany();

//     const resultMap: Record<string, Record<string, number>> = {};
//     queryResult.forEach(row => {
//       if (!resultMap[row.type]) resultMap[row.type] = {};
//       resultMap[row.type][row.status] = parseInt(row.count, 10);
//     });
// let STATUSES = ["hold", "approved", "rejected","COMPLETE"];
//     const finalResult: Record<string, Record<string, number>> = {};
//     for (const type in resultMap) {
//       const statusCounts: Record<string, number> = {};
//       STATUSES.forEach(status => {
//         statusCounts[status] = resultMap[type][status] || 0;
//       });

//       // Calculate total
//       const total = Object.values(statusCounts).reduce((sum, val) => sum + val, 0);

//       // Insert total first, then other statuses
//       finalResult[type] = { total, ...statusCounts };
//     }

//     // Include types with no documents at all
//     const typesInDB = await this.documentbRepository
//       .createQueryBuilder("doc")
//       .select("DISTINCT doc.type", "type")
//       .getRawMany();

//     typesInDB.forEach(({ type }) => {
//       if (!finalResult[type]) {
//         const emptyStatuses: Record<string, number> = {};
//         STATUSES.forEach(status => (emptyStatuses[status] = 0));
//         finalResult[type] = { total: 0, ...emptyStatuses };
//       }
//     });

//     return finalResult;
//   } catch (error) {
//     console.error("Error fetching total count by status:", error);
//     throw new Error("Failed to fetch document status counts");
//   }
// }


// async totalPurchase(filters?: {
//   createdBy?: string;
//   date?: string;
//   month?: number;
//   year?: number;
//   startDate?: string;
//   endDate?: string;
//   productId?: string;
//   source?: string;
//   farmer?: string;
//   vendor?: string;
//   companyId?: string;
//   fromLocationId?: string;
//   page?: number;
//   limit?: number;
// }): Promise<{
//   overallTotalQty: number;
//   overallTotalAmount: number;
//   dateWise: { date: string; totalQty: number; totalAmount: number }[];
// }> {
//   // 1️⃣ Get overall totals (no filters)
//   const totalQb = this.grnProductRepository
//     .createQueryBuilder('grnProduct')
//     .leftJoin('grnProduct.grn', 'grn');

//   totalQb
//     .select('SUM(grnProduct.netWeight)', 'overallTotalQty')
//     .addSelect('SUM(grnProduct.amount)', 'overallTotalAmount');

//   const totalResult = await totalQb.getRawOne();

//   // 2️⃣ Get date-wise totals (with filters)
//   const qb = this.grnProductRepository
//     .createQueryBuilder('grnProduct')
//     .leftJoin('grnProduct.grn', 'grn')
//     .leftJoin('grn.companyName', 'company')
//     .leftJoin('grnProduct.productName', 'product')
//     .leftJoin('grn.selectedFarmer', 'farmer')
//     .leftJoin('grn.selectedVendor', 'vendor')
//     .leftJoin('grn.purchaseLocation', 'location');

//   qb.select("TO_CHAR(grn.createdAt, 'DD-MM-YYYY')", 'date')
//     .addSelect('SUM(grnProduct.netWeight)', 'totalQty')
//     .addSelect('SUM(grnProduct.amount)', 'totalAmount')
//     .groupBy("TO_CHAR(grn.createdAt, 'DD-MM-YYYY')")
//     .orderBy('MIN(grn.createdAt)', 'ASC');

//   // Apply filters for date-wise data
//   if (filters?.createdBy) {
//     qb.andWhere('grn.createdBy = :createdBy', { createdBy: filters.createdBy });
//   }

//   if (filters?.date) {
//     qb.andWhere('DATE(grn.createdAt) = :date', { date: filters.date });
//   }

//   if (filters?.month) {
//     qb.andWhere('EXTRACT(MONTH FROM grn.createdAt) = :month', { month: filters.month });
//   }

//   if (filters?.year) {
//     qb.andWhere('EXTRACT(YEAR FROM grn.createdAt) = :year', { year: filters.year });
//   }

//   if (filters?.startDate && filters?.endDate) {
//     qb.andWhere('DATE(grn.createdAt) BETWEEN :startDate AND :endDate', {
//       startDate: filters.startDate,
//       endDate: filters.endDate,
//     });
//   }

//   if (filters?.productId) {
//     qb.andWhere('grnProduct.productName = :productId', { productId: filters.productId });
//   }

//   if (filters?.source) {
//     qb.andWhere('grn.source = :source', { source: filters.source });
//   }

//   if (filters?.companyId) {
//     qb.andWhere('grn.companyName = :companyId', { companyId: filters.companyId });
//   }

//   if (filters?.farmer) {
//     qb.andWhere('grn.selectedFarmer = :farmer', { farmer: filters.farmer });
//   }

//   if (filters?.vendor) {
//     qb.andWhere('grn.selectedVendor = :vendor', { vendor: filters.vendor });
//   }

//   if (filters?.fromLocationId) {
//     qb.andWhere('grn.purchaseLocation = :fromLocationId', { fromLocationId: filters.fromLocationId });
//   }

//   const dateWiseResult = await qb.getRawMany();

//   return {
//     overallTotalQty: Number(totalResult?.overallTotalQty || 0),
//     overallTotalAmount: Number(totalResult?.overallTotalAmount || 0),
//     dateWise: dateWiseResult.map((row) => ({
//       date: row.date,
//       totalQty: Number(row.totalQty || 0),
//       totalAmount: Number(row.totalAmount || 0),
//     })),
//   };
// }

