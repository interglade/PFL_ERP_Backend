import { inject, injectable } from 'inversify';

import { Repository } from 'typeorm';
import { TYPES } from '../../types';
import { UserRepository } from '../../employee/repository/user.repository';
import { ProductRepository } from '../../product/createproduct/repository/product.repository';
import { BranchessRepository } from '../../branch/repository/branches.repository';
import { GrnRepository } from '../../grn/repository/grn.repository';
import { FarmerRepository } from '../../farmer/repository/farmer.repository';
import { CustomerRepository } from '../../customer/addcustomer/repository/customer.repository';
import { VendorRepository } from '../../vendor/createVendor/repository/vendor.repository';
import { ApprovalFlowRepository } from '../../approvalFlow/repository/approvalFlow.repository';
import { InventoryStockRepository } from '../../inventoryStock/repository/inventoryStock.repository';
import { ActiveSessionRepository } from '../../auth/repository/activeSession.repository';
import { DocumentbRepository } from '../../approvalFlow/repository/documentb.repository';
import { CustomerDeliveryChallanRepository } from '../../deliveryChallans/customerDeliveryChllan/repository/customerDeliveryChallan.repository';
import { DitemRepository } from '../../deliveryChallans/deliverychllan/repository/dItem.repository';

@injectable()
export class AdminDashboardService{

    constructor(@inject(TYPES.UserRepository)
                private readonly userRepository:UserRepository,
                @inject(TYPES.ProductRepository)
                private readonly productRepo:ProductRepository,
                @inject(TYPES.BranchessRepository)
                private readonly branchRepo:BranchessRepository,
                @inject(TYPES.GrnRepository)
                private readonly grnRepository:GrnRepository,
                @inject(TYPES.FarmerRepository)
                private readonly farmerRepository:FarmerRepository,
                @inject(TYPES.CustomerRepository)
                private readonly customerRepository:CustomerRepository,
                @inject(TYPES.VendorRepository)
                private readonly vendorRepository:VendorRepository,
               @inject(TYPES.ApprovalFlowRepository)
                private readonly approvalFlowRepository:ApprovalFlowRepository,
                @inject(TYPES.InventoryStockRepository)
                private readonly inventoryRepository:InventoryStockRepository,
                @inject(TYPES.ActiveSessionRepository)
                private readonly activeSessionRepo:ActiveSessionRepository,
                @inject(TYPES.DocumentbRepository)
                private readonly documentRepository:DocumentbRepository,
                @inject(TYPES.CustomerDeliveryChallanRepository)
              private readonly challanRepository:CustomerDeliveryChallanRepository,
              @inject(TYPES.DitemRepository)
              private readonly itemRepository:DitemRepository
              )
                {}

//TODO:By Vaishali get total count of employee
   async getTotalEmployeeCount(): Promise<number> {
    return await this.userRepository.count();
  }

  //TODO:By Vaishali get total count of farmer 
   async getTotalFarmerCount(): Promise<number> {
    return await this.farmerRepository.count();
  }

   //TODO:By Vaishali get total customer count
    public async getCustomerStats(): Promise<any> {
      const totalCustomers = await this.customerRepository.count();
  
      // Group by CustomerType
      const typeCountsRaw = await this.customerRepository
        .createQueryBuilder('customer')
        .leftJoin('customer.customerTypes', 'type')
        .select('type.name', 'type')
        .addSelect('COUNT(customer.id)', 'count')
        .groupBy('type.name')
        .getRawMany();
  
      const customerTypeWiseCount: Record<string, number> = {};
      typeCountsRaw.forEach(row => {
        customerTypeWiseCount[row.type || 'Unknown'] = Number(row.count);
      });
  
      // Group by CustomerCategory
      const categoryCountsRaw = await this.customerRepository
        .createQueryBuilder('customer')
        .leftJoin('customer.customerCategory', 'category')
        .select('category.name', 'category')
        .addSelect('COUNT(customer.id)', 'count')
        .groupBy('category.name')
        .getRawMany();
  
      const customerCategoryWiseCount : Record<string, number> = {};
      categoryCountsRaw.forEach(row => {
        customerCategoryWiseCount[row.category || 'Unknown'] = Number(row.count);
      });
  
      return {
        customer: {
          totalCustomer: totalCustomers,
          typeCountsRaw,
          categoryCountsRaw
        }
      };
    }

    //TODO:By Vaishali Get total vender count
     async getVendorStats() {
        // Total count of all vendors
        const totalCount = await this.vendorRepository.count();
    
        // Count vendors grouped by category name
        const byCategoryRaw = await this.vendorRepository
          .createQueryBuilder('vendor')
          .leftJoin('vendor.category', 'category')
          .select('category.name', 'category')
          .addSelect('COUNT(*)', 'count')
          .groupBy('category.name')
          .getRawMany();
    
          console.log("byCategoryRaw",byCategoryRaw);
    
        // Convert raw result to object
        const byCategory: Record<string, number> = {};
        byCategoryRaw.forEach(row => {
          const categoryName = row.category || 'Uncategorized';
          byCategory[categoryName] = Number(row.count);
        });
    
        return {
          vendors: {
            totalCount,
            byCategoryRaw
          }
        };
      }
      
  //TODO:Get Total Product Count
  async getAllProductStats() {
    
    // Total products
    const totalCount = await this.productRepo.count();

    // By classification
    const byClassification = await this.productRepo.createQueryBuilder("product")
      .leftJoin("product.classification", "classification")
      .select("classification.name", "classification")
      .addSelect("COUNT(product.id)", "count")
      .groupBy("classification.name")
      .getRawMany();

    // By category
    const byCategory = await this.productRepo.createQueryBuilder("product")
      .leftJoin("product.category", "category")
      .select("category.name", "category")
      .addSelect("COUNT(product.id)", "count")
      .groupBy("category.name")
      .getRawMany();

    // By subcategory
    const bySubcategory = await this.productRepo.createQueryBuilder("product")
      .leftJoin("product.subcategory", "subcategory")
      .select("subcategory.name", "subcategory")
      .addSelect("COUNT(product.id)", "count")
      .groupBy("subcategory.name")
      .getRawMany();

    return {
    products:{
      totalCount,
      byClassification,
      byCategory,
      bySubcategory,
    }
    };
  }

  //TODO:Get Total Branch Count

  async getAllBranchStats(){
    // Total branches count
    const totalCount = await this.branchRepo.count();

    // Count by type
    const byType = await this.branchRepo.createQueryBuilder("branch")
      .select("branch.type", "type")
      .addSelect("COUNT(branch.id)", "count")
      .groupBy("branch.type")
      .getRawMany();

    return {
        Branches:{
      totalCount,
      byType
        }
      
    };
 
  }





public async getTop5Farmers(): Promise<any> {
    const topFarmers = await this.grnRepository
      .createQueryBuilder('grn')
      .leftJoin('grn.selectedFarmer', 'farmer')
      .select('farmer.id', 'id')
      .addSelect("CONCAT(farmer.farmerfName, ' ', farmer.farmermName, ' ', farmer.farmerlName)", 'farmerName')
      .addSelect('COALESCE(SUM(grnProducts.netWeight), 0)', 'totalQty')
      .leftJoin('grn.grnProducts', 'grnProducts')
      .groupBy('farmer.id')
      .orderBy('"totalQty"', 'DESC')
      .limit(5)
      .getRawMany();
    return topFarmers;
  }


async getTop5CustomersByNetProductWeight(limit = 5): Promise<any[]> {
  const rows = await this.challanRepository
    .createQueryBuilder('dc')
    .leftJoin('dc.customerName', 'customer')
   // .leftJoin('customer.bankDetails', 'bankDetails')
    .select('customer.id', 'customerId')
    .addSelect('customer.organisationName', 'customerName') // adjust if your field name differs
   // .addSelect('bankDetails.customer_bank_account_holder_fname', 'FName')
   // .addSelect('bankDetails.customer_bank_account_holder_lname', 'LName')
    .addSelect('SUM(dc.netProductWeight)', 'totalWeight')
    .where('dc.type = :type', { type: 'customer_delivery_challan' })
    .groupBy('customer.id')
    .addGroupBy('customer.organisationName')
   // .addGroupBy('bankDetails.customer_bank_account_holder_fname')
   // .addGroupBy('bankDetails.customer_bank_account_holder_lname')
    .orderBy('"totalWeight"', 'DESC') // ✅ fixed here
    .limit(limit)
    .getRawMany();

  return rows.map((r) => ({
    customerId: r.customerId,
    organization: r.customerName,
   // accountHolderName: `${r.FName || ''} ${r.LName || ''}`.trim(),
    totalWeight: Number(r.totalWeight) || 0,
  }));
}

public async getTop5Vendors(): Promise<any> {
  const topVendors = await this.grnRepository
    .createQueryBuilder('grn')
    .leftJoin('grn.selectedVendor', 'vendor')
    .leftJoin('grn.grnProducts', 'grnProducts')
    .select('vendor.id', 'vendorId')
    .addSelect('vendor.companyName', 'vendorName')
    .addSelect('COALESCE(SUM(grnProducts.netWeight), 0)', 'totalNetWeight')
    .groupBy('vendor.id')
    .addGroupBy('vendor.companyName')
    .orderBy('"totalNetWeight"', 'DESC')
    .getRawMany();

  return topVendors;
}
  public async getActiveUsers(): Promise<{
  totalUser: number;
  activeCount: number;
  inActiveCount: number;
  activeUsers: { id: string; username: string }[];
  inactiveUsers: { id: string; username: string }[];
}> {
  console.log("inside active user service");

  // Refresh token expiry in minutes (135 min = 2h 15m as per config)
  const REFRESH_TOKEN_EXPIRES_IN_MS = 135 * 60 * 1000;

  const allUsers = await this.userRepository.find({
    select: ['id', 'username'],
  });

  // Fetch all sessions marked as active
  const activeSessions = await this.activeSessionRepo.find({
    where: { is_active: true },
    select: ['user_id', 'login_time'],
  });

  const now = Date.now();

  // Separate truly active vs token-expired sessions
  const genuinelyActive: string[] = [];
  const tokenExpiredSessionUserIds: string[] = [];

  for (const session of activeSessions) {
    const loginTime = new Date(session.login_time).getTime();
    const sessionAge = now - loginTime;

    if (sessionAge > REFRESH_TOKEN_EXPIRES_IN_MS) {
      // Both tokens are expired — this user is effectively logged out
      tokenExpiredSessionUserIds.push(session.user_id);
    } else {
      genuinelyActive.push(session.user_id);
    }
  }

  // Auto-cleanup: mark expired sessions as inactive in DB (fire-and-forget)
  if (tokenExpiredSessionUserIds.length > 0) {
    this.activeSessionRepo
      .createQueryBuilder()
      .update()
      .set({ is_active: false })
      .where('user_id IN (:...ids) AND is_active = true', { ids: tokenExpiredSessionUserIds })
      .execute()
      .catch((err) => console.error('Failed to cleanup expired sessions:', err));
  }

  const activeUsers = allUsers
    .filter((u) => genuinelyActive.includes(u.id))
    .map((u) => ({ id: u.id, username: u.username }));

  const inactiveUsers = allUsers
    .filter((u) => !genuinelyActive.includes(u.id))
    .map((u) => ({ id: u.id, username: u.username }));

  return {
    totalUser: allUsers.length,
    activeCount: activeUsers.length,
    inActiveCount: inactiveUsers.length,
    activeUsers,
    inactiveUsers,
  };
}
async getTopProductsByWeight(limit = 5): Promise<any[]> {
  const CUSTOMER_DC_TYPE = 'customer_delivery_challan';

  const rows = await this.itemRepository
    .createQueryBuilder('item')
    .leftJoin('item.productName', 'product')
    .leftJoin('item.deliveryChallan', 'dc')
    .where('dc.type = :type', { type: CUSTOMER_DC_TYPE })
    .select('product.id', 'productId')
    .addSelect('product.name', 'productName') // adjust if your entity uses another property
    .addSelect('SUM(item.netWeight)', 'totalWeight')
    .groupBy('product.id')
    .addGroupBy('product.name')
    .orderBy('"totalWeight"', 'DESC') // ✅ quote alias properly
    .limit(limit)
    .getRawMany();

  return rows.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    totalWeight: Number(r.totalWeight) || 0,
  }));
}






}


  // async getDocumentStats(documentType: DocumentTypeEnum) {
  //   try {
  //     const [holdCount, approvedCount, rejectedCount] = await Promise.all([
  //       this.documentRepository.count({
  //         where: { type: documentType, status: DocumentStatus.HOLD },
  //       }),
  //       this.documentRepository.count({
  //         where: { type: documentType, status: DocumentStatus.APPROVED },
  //       }),
  //       this.documentRepository.count({
  //         where: { type: documentType, status: DocumentStatus.DISAPPROVED }, // or REJECT depending on your workflow
  //       }),
  //     ]);

  //     return {
  //       documentType,
  //       hold: holdCount,
  //       approved: approvedCount,
  //       rejected: rejectedCount,
  //     };
  //   } catch (error) {
  //     console.error("Error in getDocumentStats:", error);
  //     throw new Error("Failed to fetch document stats");
  //   }
  // }


  // // ---------- Registrations list (generic for entities) ----------
  // async listRegistrations(opts: {
  //   entity: "farmer" | "vendor" | "supplier" | "customer";
  //   from?: string;
  //   to?: string;
  //   search?: string;
  //   page?: number;
  //   limit?: number;
  // }) {
  //   const page = Math.max(1, opts.page || 1);
  //   const limit = Math.max(1, opts.limit || 20);
  //   const skip = (page - 1) * limit;

  //   let repo: Repository<any>;
  //   switch (opts.entity) {
  //     case "farmer":
  //       repo = this.farmerRepository;
  //       break;
  //     case "vendor":
  //       repo = this.vendorRepository;
  //       break;
     
  //     case "customer":
  //       repo = this.customerRepository;
  //       break;
  //     default:
  //       throw new Error("Invalid entity");
  //   }

  //   const qb = repo.createQueryBuilder(opts.entity[0]); // f/v/s/c

  //   if (opts.from) qb.andWhere(`DATE(${opts.entity[0]}.registerDate) >= :from`, { from: opts.from });
  //   if (opts.to) qb.andWhere(`DATE(${opts.entity[0]}.registerDate) <= :to`, { to: opts.to });

  //   if (opts.search) {
  //     // Search across some common fields — adjust per entity
  //     qb.andWhere(
  //       `(${opts.entity[0]}.farmerfName ILIKE :s OR ${opts.entity[0]}.farmerlName ILIKE :s OR ${opts.entity[0]}.primaryMobileNo ILIKE :s OR ${opts.entity[0]}.email ILIKE :s)`,
  //       { s: `%${opts.search}%` }
  //     ).cache(() => {}); // vendor/customer may have different column names; adjust per entity
  //   }

  //   qb.orderBy(`${opts.entity[0]}.registerDate`, "DESC")
  //     .skip(skip)
  //     .take(limit);

  //   const [data, total] = await qb.getManyAndCount();
  //   return {
  //     data,
  //     total,
  //     page,
  //     limit,
  //   };
  // }


  // // ---------- Summary KPIs ----------
  // async getSummary(): Promise<any> {
  //   // today counts
  //   const todayStart = new Date();
  //   todayStart.setHours(0, 0, 0, 0);
  //   const todayEnd = new Date();
  //   todayEnd.setHours(23, 59, 59, 999);

  //   const [
  //     farmersToday,
  //     vendorsToday,
      
  //     customersToday,
  //     //pendingApprovals,
  //     activeUsersCount,
  //     // lowStockCount,
  //   ] = await Promise.all([
  //     this.farmerRepository
  //       .createQueryBuilder("f")
  //       .where("DATE(f.createdAt) = CURRENT_DATE")
  //       .getCount(),
  //     this.vendorRepository
  //       .createQueryBuilder("v")
  //       .where("DATE(v.createdAt) = CURRENT_DATE")
  //       .getCount()
  //       .catch(() => 0), // in case vendor has different field/nullable
  //    this.customerRepository
  //       .createQueryBuilder("c")
  //       .where("DATE(c.createdAt) = CURRENT_DATE")
  //       .getCount()
  //       .catch(() => 0),
  //     // this.approvalFlowRepository
  //     //   .createQueryBuilder("af")
  //     //   .where("af.status = :status", { status: "PENDING" })
  //     //   .getCount(),
  //     this.userRepository
  //       .createQueryBuilder("u")
  //       // active definition: lastActivityAt within last 15 minutes OR isOnline flag
  //       .where("u.isOnline = true OR u.lastActivityAt > (NOW() - INTERVAL '15 minutes')")
  //       .getCount(),
  //     // this.inventoryRepository
  //     //   .createQueryBuilder("inv")
  //     //   .where("inv.quantity <= inv.reorderLevel") // fields assumed
  //     //   .getCount()
  //   ]);

  //   return {
  //     today: {
  //       farmers: farmersToday,
  //       vendors: vendorsToday,
       
  //       customers: customersToday,
  //     },
  //     //pendingApprovals,
  //     activeUsers: activeUsersCount,
     
  //   };
  // }


// public async getTop5Products(): Promise<any> {
//   const topProducts = await this.grnRepository
//     .createQueryBuilder('grn')
//     .leftJoin('grn.grnProducts', 'grnProducts')
//     .leftJoin('grnProducts.productName', 'productName')
//     .select('productName.id', 'id')
//     .addSelect('productName.name', 'productName')
//     .addSelect('COALESCE(SUM(grnProducts.netWeight), 0)', 'totalQty')
//     .groupBy('productName.id')
//     .addGroupBy('productName.name')
//     .orderBy('"totalQty"', 'DESC')
//     .limit(5)
//     .getRawMany();

//   return topProducts;
// }
