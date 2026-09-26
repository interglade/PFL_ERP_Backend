import { inject, injectable } from 'inversify';
import { TYPES } from '../../types';
import { GrnRepository } from '../../grn/repository/grn.repository';
import { GrnProductRepository } from '../../grn/repository/grnProduct.repository';
import { DeliveryChallanRepository } from '../../deliveryChallans/deliverychllan/repository/deliveryChallan.repository';
import { DitemRepository } from '../../deliveryChallans/deliverychllan/repository/dItem.repository';
import { SecondSaleProductRepository } from '../../secondSale/repository/secondSaleProduct.repository';
import { SecondSaleRepository } from '../../secondSale/repository/secondSale.repository';
import { DumpRegisterRepository } from '../../dumpRegister/repository/dumpRegister.repository';
import { DumpProductRepository } from '../../dumpRegister/repository/dumpProduct.repository';
import { ReturnedProductsRepository } from '../../returnByCustomer/repository/returnProduct.repository';
import { GRN } from '../../grn/entity/grn.entity';
import { DeliveryChallanPurchase } from '../../deliveryChallans/deliverychllan/entity/deliveryChallan.entity';
import { DumpRegister } from '../../dumpRegister/entity/dumpRegister.entity';
import { PostReturnByCustomer } from '../../returnByCustomer/entity/postReturnByCustomer.entity';



@injectable()
export class ManagementDashService {
  constructor(
    @inject(TYPES.GrnRepository) private readonly grnRepository: GrnRepository,
    @inject(TYPES.GrnProductRepository) private readonly grnProductRepository: GrnProductRepository,
    @inject(TYPES.DeliveryChallanRepository) private readonly deliveryChallanRepository: DeliveryChallanRepository,
    @inject(TYPES.DitemRepository) private readonly deliveryChallanProductRepository: DitemRepository,
    @inject(TYPES.SecondSaleRepository) private readonly secondSaleRepository: SecondSaleRepository,
    @inject(TYPES.SecondSaleProductRepository) private readonly secondSaleProductRepository: SecondSaleProductRepository,
    @inject(TYPES.DumpRegisterRepository) private readonly dumpRegisterRepository: DumpRegisterRepository,
    @inject(TYPES.DumpProductRepository) private readonly dumpProductRepository: DumpProductRepository,
    @inject(TYPES.ReturnedProductsRepository) private readonly returnedProductRepository: ReturnedProductsRepository
  ) {}

  private async getTotalQtyAndAmount(
    startDate: Date,
    endDate: Date,
    source?: string,
    locationId?: string,
    companyName?: string
  ): Promise<any> {
    try {
      let baseQuery = this.grnProductRepository
        .createQueryBuilder('grnProduct')
        .select('COALESCE(SUM(grnProduct.netWeight), 0)', 'totalQuantityInKg')
        .addSelect('COALESCE(SUM(grnProduct.netWeight * grnProduct.unitPrice), 0)', 'totalAmount')
        .innerJoin(GRN, 'grn', 'grn.id = grnProduct.grn')
        .where('grn.grnType = :grnType', { grnType: 'purchase' })
        .where('grn.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

      if (source) {
        baseQuery = baseQuery.andWhere('grn.source = :source', { source });
      }

      if (locationId) {
        baseQuery = baseQuery.andWhere('grn.purchaseLocation = :locationId', { locationId });
      }

      if (companyName) {
        baseQuery = baseQuery.andWhere('grn.companyName = :companyName', { companyName });
      }

      const result = await baseQuery.getRawOne();

      return {
        totalQuantityInKg: Number(result?.totalQuantityInKg || 0),
        totalAmount: Number(result?.totalAmount || 0),
      };
    } catch (error) {
      console.error('Error fetching total quantity and amount:', error);
      throw new Error('Failed to fetch total quantity and amount');
    }
  }

  async getProcurementDataByVendor(vendorId: string): Promise<any> {
    try {
      console.log('Vendor Id: ', vendorId);
      let baseQuery = await this.grnRepository
        .createQueryBuilder('grn')
        .leftJoin('grn.grnProducts', 'grnProduct')
        .where('grn.selectedVendor = :vendorId', { vendorId })
        .select("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')", 'date')
        .addSelect('SUM(grnProduct.quantity)', 'totalQuantity')
        .addSelect('SUM(grnProduct.amount)', 'totalAmount')
        .groupBy("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')")
        .orderBy("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')", 'ASC')
        .getRawMany();
      console.log('Vendor Procurement Data,', baseQuery);
      return baseQuery.map((row) => ({
        date: row.date,
        totalQuantity: parseFloat(row.totalQuantity || 0),
        totalAmount: parseFloat(row.totalAmount || 0),
      }));
    } catch (error) {
      console.error('Error fetching total quantity and amount:', error);
      throw new Error('Failed to fetch total quantity and amount');
    }
  }

   //TODO:For Farmer
  async getProcurementDataByFarmer(farmerId: string): Promise<any> {
    try {
      console.log('Farmer Id: ', farmerId);
      let baseQuery = await this.grnRepository
        .createQueryBuilder('grn')
        .leftJoin('grn.grnProducts', 'grnProduct')
        .where('grn.selectedFarmer = :farmerId', { farmerId })
        .select("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')", 'date')
        .addSelect('SUM(grnProduct.quantity)', 'totalQuantity')
        .addSelect('SUM(grnProduct.amount)', 'totalAmount')
        .groupBy("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')")
        .orderBy("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')", 'ASC')
        .getRawMany();
      console.log('Faemer Procurement Data,', baseQuery);
      return baseQuery.map((row) => ({
        date: row.date,
        totalQuantity: parseFloat(row.totalQuantity || 0),
        totalAmount: parseFloat(row.totalAmount || 0),
      }));
    } catch (error) {
      console.error('Error fetching total quantity and amount:', error);
      throw new Error('Failed to fetch total quantity and amount');
    }
  }

  //TODO:By Product
  async getTotalAmountAndQuantityByProduct(productId: string): Promise<any> {
    try {
      console.log('Product Id: ', productId);
      let baseQuery = await this.grnRepository
        .createQueryBuilder('grn')
        .leftJoin('grn.grnProducts', 'grnProduct')
        .where('grnProduct.product_id = :productId', { productId })
        .select("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')", 'date')
        .addSelect('SUM(grnProduct.quantity)', 'totalQuantity')
        .addSelect('SUM(grnProduct.amount)', 'totalAmount')
        .groupBy("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')")
        .orderBy("TO_CHAR(grn.createdAt, 'YYYY-MM-DD')", 'ASC')
        .getRawMany();
      //console.log('Faemer Procurement Data,', baseQuery);
      return baseQuery.map((row) => ({
        date: row.date,
        totalQuantity: parseFloat(row.totalQuantity || 0),
        totalAmount: parseFloat(row.totalAmount || 0),
      }));
    } catch (error) {
      console.error('Error fetching total quantity and amount:', error);
      throw new Error('Failed to fetch total quantity and amount');
    }
  }

  private async getDateWiseTotalQtyAndAmount(
    startDate: Date,
    endDate: Date,
   
    locationId?: string,
    companyName?: string
  ): Promise<any> {
    try {
      let baseQuery = this.grnProductRepository
        .createQueryBuilder('grnProduct')
        .select("DATE(grn.createdAt)", "date")
        .addSelect("COALESCE(SUM(grnProduct.netWeight), 0)", "totalQuantityInKg")
        .addSelect("COALESCE(SUM(grnProduct.netWeight * grnProduct.unitPrice), 0)", "totalAmount")
        .innerJoin(GRN, 'grn', 'grn.id = grnProduct.grn')
        .where('grn.grnType = :grnType', { grnType: 'purchase' })
        .where("grn.createdAt BETWEEN :startDate AND :endDate", { startDate, endDate })
        .groupBy("DATE(grn.createdAt)")
        .orderBy("DATE(grn.createdAt)", "ASC");
  
     
  
      if (locationId) {
        baseQuery = baseQuery.andWhere("grn.purchaseLocation = :locationId", { locationId });
      }
  
      if (companyName) {
        baseQuery = baseQuery.andWhere("grn.companyName = :companyName", { companyName });
      }
  
      const result = await baseQuery.getRawMany();
  
      return result.map((item) => ({
        date: item.date,
        totalQuantityInKg: Number(item.totalQuantityInKg || 0),
        totalAmount: Number(item.totalAmount || 0),
      }));
    } catch (error) {
      console.error("Error fetching date-wise total quantity and amount:", error);
      throw new Error("Failed to fetch date-wise total quantity and amount");
    }
  }
  
  private async getTotalQtyAndAmountForAllVendors(
    startDate: Date,
    endDate: Date,
    locationId?: string,
    companyName?: string
  ): Promise<any[]> {
    try {
      let baseQuery = this.grnProductRepository
        .createQueryBuilder('grnProduct')
        .select('vendorCategory.name', 'vendorCategoryName')
        .addSelect('vendorSubCategory.name', 'vendorSubCategoryName')
        .addSelect('COALESCE(SUM(grnProduct.netWeight), 0)', 'totalQuantityInKg')
        .addSelect('COALESCE(SUM(grnProduct.netWeight * grnProduct.unitPrice), 0)', 'totalAmount')
        .innerJoin(GRN, 'grn', 'grn.id = grnProduct.grn')
        .innerJoin('grn.selectedVendor', 'vendor')
        .innerJoin('vendor.category', 'vendorCategory')
        .innerJoin('vendor.subcategory', 'vendorSubCategory')
        .where('grn.grnType = :grnType', { grnType: 'purchase' })
        .where('grn.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
        .groupBy('vendorCategory.name')
        .addGroupBy('vendorSubCategory.name');
  
      if (locationId) {
        baseQuery = baseQuery.andWhere('grn.purchaseLocation = :locationId', { locationId });
      }
  
      if (companyName) {
        baseQuery = baseQuery.andWhere('grn.companyName = :companyName', { companyName });
      }
  
      const result = await baseQuery.getRawMany();
  
      return result.map((item) => ({
        vendorCategoryName: item.vendorCategoryName,
        vendorSubCategoryName: item.vendorSubCategoryName,
        totalQuantityInKg: Number(item.totalQuantityInKg || 0),
        totalAmount: Number(item.totalAmount || 0),
      }));
    } catch (error) {
      console.error('Error fetching vendor categories and subcategories:', error);
      throw new Error('Failed to fetch vendor data');
    }
  }
  
  // private getDateRange(filterType: string, currentDate: Date, startDate?: Date, endDate?: Date, specificDate?: Date) {
  //   let start: Date;
  //   let end: Date;

  //   switch (filterType) {
  //     case 'tillDate':
  //       start = new Date(0);
  //       end = currentDate;
  //       break;
  //     case 'year':
  //       start = new Date(currentDate.getFullYear(), 0, 1);
  //       end = currentDate;
  //       break;
  //     case 'month':
  //       start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  //       end = currentDate;
  //       break;
  //     case 'dateRange':
  //       start = startDate ?? new Date(currentDate.getFullYear(), 0, 1);
  //       end = endDate ?? currentDate;
  //       break;
  //       case 'specificDate':
  //         if (!specificDate || isNaN(specificDate.getTime())) {
  //             throw new Error("Invalid or missing specific date for 'specificDate' filter.");
  //         }
  //         start = new Date(specificDate);
  //         start.setHours(0, 0, 0, 0);
  //         end = new Date(specificDate);
  //         end.setHours(23, 59, 59, 999);
  //         break;
      
  //     default:
  //       throw new Error('Invalid filter type.');
  //   }

  //   return { start, end };
  // }

  private getDateRange(filterType: string, currentDate: Date, startDate?: Date, endDate?: Date, specificDate?: Date) {
    let start: Date;
    let end: Date;

    // Convert currentDate to IST manually
    const nowIST = new Date(currentDate.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

    switch (filterType) {
        case 'tillDate':
            start = new Date(0); // 1970-01-01
            start.setHours(0, 0, 0, 0);
            end = new Date(nowIST);
            end.setHours(23, 59, 59, 999);
            break;
        case 'year':
            start = new Date(nowIST.getFullYear(), 0, 1);
            start.setHours(0, 0, 0, 0);
            end = new Date(nowIST);
            end.setHours(23, 59, 59, 999);
            break;
        case 'month':
            start = new Date(nowIST.getFullYear(), nowIST.getMonth(), 1);
            start.setHours(0, 0, 0, 0);
            end = new Date(nowIST);
            end.setHours(23, 59, 59, 999);
            break;
        case 'dateRange':
            start = startDate ? new Date(startDate) : new Date(nowIST.getFullYear(), 0, 1);
            start.setHours(0, 0, 0, 0);
            end = endDate ? new Date(endDate) : new Date(nowIST);
            end.setHours(23, 59, 59, 999);
            break;
        case 'specificDate':
            if (!specificDate || isNaN(specificDate.getTime())) {
                throw new Error("Invalid or missing specific date for 'specificDate' filter.");
            }
            start = new Date(specificDate);
            start.setHours(0, 0, 0, 0);
            end = new Date(specificDate);
            end.setHours(23, 59, 59, 999);
            break;
        default:
            throw new Error('Invalid filter type.');
    }

    return { start, end };
}


  async getManagementDashboard(
    filterType: string = 'tillDate',
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
        .createQueryBuilder('grn')
        .leftJoinAndSelect('grn.grnProducts', 'grnProducts')
        .leftJoinAndSelect('grn.selectedVendor', 'vendor')
        .where('grn.grnType = :grnType', { grnType: 'purchase' })
        .andWhere('grn.createdAt BETWEEN :start AND :end', { start, end });
      if (locationId) {
        baseQuery = baseQuery.andWhere('grn.purchaseLocation = :locationId', { locationId });
      }

      if (companyName) {
        baseQuery = baseQuery.andWhere('grn.companyName = :companyName', { companyName });
      }

      const [grns, count, totalPurchase, totalPurchaseByFarmer,totalpurchaseByVendor,totalPurchaseByvendorCategoryandsubcategory,getDateWiseTotalQtyAndAmount] = await Promise.all([
        baseQuery.getMany(),
        baseQuery.getCount(),
        this.getTotalQtyAndAmount(start, end, undefined, locationId, companyName),
        this.getTotalQtyAndAmount(start, end, 'farmer', locationId, companyName),
        this.getTotalQtyAndAmount(start,end,"vendor",locationId,companyName),
        this.getTotalQtyAndAmountForAllVendors(start, end, locationId, companyName),
        this.getDateWiseTotalQtyAndAmount(start, end,locationId,companyName)

      ]);

      const totalExpenditure = grns.reduce((acc, grn) => acc + Number(grn.totalAmt), 0);

      return {
        filterType,
        totalGRNs: count,
        totalPurchase,
        totalExpenditure,
        totalPurchaseByFarmer,
        totalpurchaseByVendor,
       totalPurchaseByvendorCategoryandsubcategory,
       getDateWiseTotalQtyAndAmount
      };
    } catch (error) {
      console.error('Error in getManagementDashboard:', error);
      throw new Error('Failed to fetch management dashboard data');
    }
  }
  private async getTotalQtyAndAmountForDeliveryChallan(
    startDate: Date,
    endDate: Date,
    locationId?: string,
    companyName?: string
  ): Promise<any> {
    try {
      let baseQuery = this.deliveryChallanProductRepository
        .createQueryBuilder('deliveryChallanProducts')
        .select('COALESCE(SUM(deliveryChallanProducts.netWeight), 0)', 'totalQuantityInKg')
        .addSelect('COALESCE(SUM(deliveryChallanProducts.amount), 0)', 'totalAmount')
        .innerJoin(DeliveryChallanPurchase, 'deliveryChallan', 'deliveryChallan.id = deliveryChallanProducts.deliveryChallan')
        .where('deliveryChallan.deliveryCType = :challanType', { challanType: 'customer' })
        .andWhere('deliveryChallan.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });
  
      if (locationId) {
        baseQuery = baseQuery.andWhere('deliveryChallan.location = :locationId', { locationId });
      }
  
      if (companyName) {
        baseQuery = baseQuery.andWhere('deliveryChallan.companyName = :companyName', { companyName });
      }
  
      const result = await baseQuery.getRawOne();
  
      return {
        totalQuantityInKg: Number(result?.totalQuantityInKg || 0),
        totalAmount: Number(result?.totalAmount || 0),
      };
    } catch (error) {
      console.error('Error fetching total quantity and amount for delivery challan:', error);
      throw new Error('Failed to fetch delivery challan data');
    }
  }
  
  async getManagementDashboardForDeliveryChallan(
    filterType: string = 'tillDate',
    startDate?: Date,
    endDate?: Date,
    specificDate?: Date,
    locationId?: string,
    companyName?: string
  ): Promise<any> {
    try {
      const currentDate = new Date();
      const { start, end } = this.getDateRange(filterType, currentDate, startDate, endDate, specificDate);
  
      let baseQuery = this.deliveryChallanRepository
        .createQueryBuilder('challan')
        .leftJoinAndSelect('challan.deliveryChallanProducts', 'challanProducts')
        .leftJoinAndSelect('challan.fromLocation', 'fromLocation')
        .leftJoinAndSelect('challan.customer', 'customer')
        .where('challan.deliveryCType = :challanType', { challanType: 'customer' })
        .andWhere('challan.createdAt BETWEEN :start AND :end', { start, end });
  
      if (locationId) {
        baseQuery = baseQuery.andWhere('challan.fromLocation = :locationId', { locationId });
      }
  
      if (companyName) {
        baseQuery = baseQuery.andWhere('challan.companyName = :companyName', { companyName });
      }
  
      const [challans, count, totalSaleQtyAndAmount,totalSaleQtyAndAmountforCustomerCategory,getQtyAndAmountForSecondSale] = await Promise.all([
        baseQuery.getMany(),
        baseQuery.getCount(),
        this.getTotalQtyAndAmountForDeliveryChallan(start, end, locationId, companyName),
        this.getTotalQtyAndAmountForAllCustomers(start, end, locationId, companyName),
        this.getTotalQtyAndAmountForSecondSale(start, end, locationId, companyName),
        this.getDateWiseTotalQtyAndAmount(start, end),  
      ]);
  
      const totalExpenditure = challans.reduce((acc, challan) => acc + Number(challan.totalProductAmount || 0), 0);
  
      return {
        filterType,
        totalChallans: count,
        totalSaleQtyAndAmount,
        totalExpenditure,
        totalSaleQtyAndAmountforCustomerCategory,
        getQtyAndAmountForSecondSale
      };
    } catch (error) {
      console.error('Error in getManagementDashboardForDeliveryChallan:', error);
      throw new Error('Failed to fetch management dashboard data for delivery challan');
    }
  }
  
  private async getTotalQtyAndAmountForAllCustomers(
    startDate: Date,
    endDate: Date,
    locationId?: string,
    companyName?: string
  ): Promise<any[]> {
    try {
      let baseQuery = this.deliveryChallanProductRepository
  .createQueryBuilder('deliveryChallanProduct')
  .select('customerCategory.name', 'customerCategoryName')
  .addSelect('customerSubCategory.name', 'customerSubCategoryName')
  .addSelect('COALESCE(SUM(deliveryChallanProduct.netWeight), 0)', 'totalQuantityInKg')
  .addSelect('COALESCE(SUM(deliveryChallanProduct.netWeight * deliveryChallanProduct.unitPrice), 0)', 'totalAmount')
  .innerJoin('deliveryChallanProduct.deliveryChallan', 'deliveryChallan')
  .innerJoin('deliveryChallan.customer', 'customer')
  .innerJoin('customer.customerCategory', 'customerCategory')
  .innerJoin('customer.customerTypes', 'customerSubCategory')
  .where('deliveryChallan.deliveryCType = :challanType AND deliveryChallan.createdAt BETWEEN :startDate AND :endDate', {
    challanType: 'customer',
    startDate,
    endDate
  })
  .groupBy('customerCategory.name')
  .addGroupBy('customerSubCategory.name');

if (locationId) {
  baseQuery = baseQuery.andWhere('deliveryChallan.fromLocation = :locationId', { locationId });
}

if (companyName) {
  baseQuery = baseQuery.andWhere('deliveryChallan.companyName = :companyName', { companyName });
}

      const result = await baseQuery.getRawMany();
  console.log(result) 
      return result.map((item) => ({
        customerCategoryName: item.customerCategoryName,
        customerSubCategoryName: item.customerSubCategoryName,
        totalQuantityInKg: Number(item.totalQuantityInKg || 0),
        totalAmount: Number(item.totalAmount || 0),
      }));
    } catch (error) {
      console.error('Error fetching customer categories and subcategories:', error);
      throw new Error('Failed to fetch customer data');
    }
  }
  // private async getTotalQtyAndAmountForSecondSale(
  //   startDate: Date,
  //   endDate: Date,
  //   locationId?: string,
  //   companyName?: string
  // ): Promise<any> {
  //   try {
  //     let baseQuery = this.secondSaleProductRepository
  //       .createQueryBuilder('secondSaleProducts')
  //       .select('COALESCE(SUM(secondSaleProducts.qty), 0)', 'totalQuantity')
  //       .addSelect('COALESCE(SUM(secondSaleProducts.amount), 0)', 'totalAmount')
  //       .innerJoin(SecondSale, 'secondSale', 'secondSale.id = secondSaleProducts.secondSaleRegister')
  //       .where('secondSale.saleDate BETWEEN :startDate AND :endDate', { startDate, endDate });
  
  //     if (locationId) {
  //       baseQuery = baseQuery.andWhere('secondSale.location = :locationId', { locationId });
  //     }
  
  //     if (companyName) {
  //       baseQuery = baseQuery.andWhere('secondSale.companyName = :companyName', { companyName });
  //     }
  
  //     const result = await baseQuery.getRawOne();
  
  //     return {
  //       totalQuantity: Number(result?.totalQuantity || 0),
  //       totalAmount: Number(result?.totalAmount || 0),
  //     };
  //   } catch (error) {
  //     console.error('Error fetching total quantity and amount for second sale:', error);
  //     throw new Error('Failed to fetch second sale data');
  //   }
  // }

  private async getTotalQtyAndAmountForSecondSale(
    startDate: Date,
    endDate: Date,
    locationId?: string,
    companyName?: string
  ): Promise<any> {
    try {
      console.log("Input Params:", startDate, endDate, locationId, companyName);
  
      let baseQuery = this.secondSaleProductRepository
        .createQueryBuilder('secondSaleProducts')
        .select('COALESCE(SUM(CAST(secondSaleProducts.netWeight AS DECIMAL)), 0)', 'totalQuantity')
        .addSelect('COALESCE(SUM(CAST(secondSaleProducts.amount AS DECIMAL)), 0)', 'totalAmount')
        .innerJoin('secondSaleProducts.secondSaleRegister', 'secondSale')
        .where('secondSale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });
  
      if (locationId) {
        baseQuery = baseQuery.andWhere('secondSale.location = :locationId', { locationId });
      }
  
      if (companyName) {
        baseQuery = baseQuery.andWhere('secondSale.companyName = :companyName', { companyName });
      }
  
      const queryString = baseQuery.getSql();
      console.log("Generated SQL Query:", queryString);
  
      const result = await baseQuery.getRawOne();
      console.log("Query Result:", result);
  
      return {
        totalQuantity: Number(result?.totalQuantity || 0),
        totalAmount: Number(result?.totalAmount || 0),
      };
    } catch (error) {
      console.error('Error fetching total quantity and amount for second sale:', error);
      throw new Error('Failed to fetch second sale data');
    }
  }
  
  

  async getTotalQtyAndAmountForDump(
    filterType: string = 'tillDate',
    specificDate?: Date,
    startDate?: Date,
    endDate?: Date,
    locationId?: string,
    companyName?: string
  ): Promise<any> {
    try {

      const currentDate = new Date();
      const { start, end } = this.getDateRange(filterType, currentDate, startDate, endDate, specificDate);
      let baseQuery = this.dumpProductRepository
        .createQueryBuilder('dumpProducts')
        .select('COALESCE(SUM(dumpProducts.quantity), 0)', 'totalQuantity')
        .addSelect('COALESCE(SUM(dumpProducts.amount), 0)', 'totalAmount')
        .innerJoin(DumpRegister, 'dumpRegister', 'dumpRegister.id = dumpProducts.dumpRegister')
        .where('dumpRegister.date BETWEEN :start AND :end', { start, end });
  
      if (locationId) {
        baseQuery = baseQuery.andWhere('dumpRegister.location = :locationId', { locationId });
      }
  
      if (companyName) {
        baseQuery = baseQuery.andWhere('dumpRegister.companyName = :companyName', { companyName });
      }
  
      const result = await baseQuery.getRawOne();

      
  
      return {
        totalQuantity: Number(result?.totalQuantity || 0),
        totalAmount: Number(result?.totalAmount || 0),
      };
    } catch (error) {
      console.error('Error fetching total quantity and amount for dump:', error);
      console.log(error)
      throw new Error('Failed to fetch dump data');
    }
  }
   async getTotalQtyAndAmountForReturnByCustomer(
    filterType: string = 'tillDate',
    specificDate?: Date,
    startDate?: Date,
    endDate?: Date,
    locationId?: string,
    companyName?: string
  ): Promise<any> {
    try {
      const currentDate = new Date();
      const { start, end } = this.getDateRange(filterType, currentDate, startDate, endDate, specificDate);
      let baseQuery = this.returnedProductRepository
        .createQueryBuilder('returnedProducts')
        .select('COALESCE(SUM(CAST(returnedProducts.netWeight AS DECIMAL)), 0)', 'totalQuantity')
        .addSelect('COALESCE(SUM(CAST(returnedProducts.amount AS DECIMAL)), 0)', 'totalAmount')
        .innerJoin(PostReturnByCustomer, 'postReturn', 'postReturn.id = returnedProducts.postReturn')
        .innerJoin('postReturn.deliveryChallanNo', 'deliveryChallan')
        .where('postReturn.date BETWEEN :start AND :end', { start, end });
  
      if (locationId) {
        baseQuery = baseQuery.andWhere('deliveryChallan.fromLocation = :locationId', { locationId });
      }
  
      if (companyName) {
        baseQuery = baseQuery.andWhere('postReturn.companyName = :companyName', { companyName });
      }
  
      const result = await baseQuery.getRawOne();
  
      return {
        totalQuantity: Number(result?.totalQuantity || 0),
        totalAmount: Number(result?.totalAmount || 0),
      };
    } catch (error) {
      console.error('Error fetching total quantity and amount for return by customer:', error);
      throw new Error('Failed to fetch return by customer data');
    }
  }
}
