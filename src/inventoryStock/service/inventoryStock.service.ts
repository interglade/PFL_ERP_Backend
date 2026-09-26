import { inject, injectable } from 'inversify';
import { number } from 'zod';
import { randomUUID } from 'crypto';
import { TYPES } from '../../types';
import { InventoryStockRepository } from '../repository/inventoryStock.repository';
import { UserRepository } from '../../employee/repository/user.repository';
import { InwardProductRepository } from '../../inwardRegister/repository/inwardProduct.repository';
import { GrnProductRepository } from '../../grn/repository/grnProduct.repository';
import { DumpProductRepository } from '../../dumpRegister/repository/dumpProduct.repository';
import { GrnRepository } from '../../grn/repository/grn.repository';
import { DumpRegisterRepository } from '../../dumpRegister/repository/dumpRegister.repository';
import { CustomerDeliveryChallanRepository } from '../../deliveryChallans/customerDeliveryChllan/repository/customerDeliveryChallan.repository';
import { InwardRepository } from '../../inwardRegister/repository/inwardRegister.repository';
import { InvoiceRepository } from '../../invoice/repository/invoice.repository';
import { SecondSaleRepository } from '../../secondSale/repository/secondSale.repository';
import { StockTransferDeliveryChallanRepository } from '../../deliveryChallans/stockTransferDC/repository/stockTransferDeliveryChallan.repository';
import { PostReturnByCustomerRepository } from '../../returnByCustomer/repository/postReturnByCustomer.repository';
import { LabourPaymentVoucherRepository } from '../../vouchers/labourPaymentV/repository/labourPaymentVoucher.repository';
import { TPVoucherRepository } from '../../vouchers/tranportPaymentV/repository/transportPaymentV.repository';
import { PaginationOptions } from '../../utils/pagination';

// Helper function to generate UUID
function generateUUID(): string {
  return randomUUID();
}

@injectable()
export class InventoryStockService {
  constructor(
    @inject(TYPES.InventoryStockRepository)
    private readonly inventoryStockRepository: InventoryStockRepository,

    @inject(TYPES.UserRepository)
    private readonly userRepository: UserRepository,

    @inject(TYPES.InwardProductRepository)
    private readonly inwardProductRepository: InwardProductRepository,

    @inject(TYPES.GrnProductRepository)
    private readonly grnProductRepository: GrnProductRepository,

    @inject(TYPES.DumpProductRepository)
    private readonly dumpProductRepository: DumpProductRepository,

    @inject(TYPES.GrnRepository)
    private readonly grnRepository: GrnRepository,

    @inject(TYPES.DumpRegisterRepository)
    private readonly dumpRegisterRepository: DumpRegisterRepository,

    @inject(TYPES.CustomerDeliveryChallanRepository)
    private readonly customerDeliveryChallanRepository: CustomerDeliveryChallanRepository,

    @inject(TYPES.InwardRepository)
    private readonly inwardRepository: InwardRepository,

    @inject(TYPES.InvoiceRepository)
    private readonly invoiceRepository: InvoiceRepository,

    @inject(TYPES.SecondSaleRepository)
    private readonly secondSaleRepository: SecondSaleRepository,

    @inject(TYPES.StockTransferDeliveryChallanRepository)
    private readonly stockTransferDeliveryChallanRepository: StockTransferDeliveryChallanRepository,

    @inject(TYPES.PostReturnByCustomerRepository)
    private readonly postReturnByCustomerRepository: PostReturnByCustomerRepository,

    @inject(TYPES.LabourPaymentVoucherRepository)
    private readonly labourPaymentVoucherRepository: LabourPaymentVoucherRepository,

    @inject(TYPES.TPVoucherRepository)
    private readonly tpVoucherRepository: TPVoucherRepository,
  ) {}

















  async getStockReport(companyId?: string, locationId?: string, startDate?: string, endDate?: string) {

   
    const inwardData = await this.inwardProductRepository
      .createQueryBuilder("ip")
      .leftJoin("ip.inwardRegister", "ir")
      .leftJoin("ip.productName", "product")
      .leftJoin("ip.variant", "variant")
      .select([
        "product.id AS productId",
        "product.product_name AS productName",
        "variant.id AS variantId",
        "variant.variantName AS variantName",
        "SUM(ip.netWeight) AS inwardQty",
        "SUM(ip.amount) AS inwardAmt",
      ])
      .where("ir.company_id = :companyId", { companyId })
      .andWhere("ir.branch_id = :locationId", { locationId })
      .andWhere("ir.date BETWEEN :start AND :end", { start: startDate, end: endDate })
      .groupBy("product.id")
      .addGroupBy("variant.id")
      .getRawMany();

    
    const purchaseData = await this.grnProductRepository
      .createQueryBuilder("gp")
      .leftJoin("gp.grn", "grn")
      .leftJoin("gp.productName", "product")
      .leftJoin("gp.variant", "variant")
      .select([
        "product.id AS productId",
        "product.name AS productName",
        "variant.id AS variantId",
        "variant.variantName AS variantName",
        "SUM(gp.netWeight) AS purchaseQty",
        "SUM(gp.amount) AS purchaseAmt",
        `SUM(CASE WHEN gp.rtv = true THEN gp.netWeight ELSE 0 END) AS rtvQty`,
        `SUM(CASE WHEN gp.rtv = true THEN gp.amount ELSE 0 END) AS rtvAmt`,
        `SUM(CASE WHEN gp.rtv = false THEN gp.netWeight ELSE 0 END) AS nonRtvQty`,
        `SUM(CASE WHEN gp.rtv = false THEN gp.amount ELSE 0 END) AS nonRtvAmt`,
      ])
      .where("grn.company_id = :companyId", { companyId })
      .andWhere("grn.purchaseLocation = :locationId", { locationId })
      .andWhere("grn.createdAt BETWEEN :start AND :end", { start: startDate, end: endDate })
      .groupBy("product.id")
      .addGroupBy("variant.id")
      .getRawMany();

    //----------------------------------------------------
    // DUMP
    //----------------------------------------------------
    const dumpData = await this.dumpProductRepository
      .createQueryBuilder("dp")
      .leftJoin("dp.dumpRegister", "dump")
      .leftJoin("dp.productName", "product")
      .leftJoin("dp.variant", "variant")
      .select([
        "product.id AS productId",
        "product.name AS productName",
        "variant.id AS variantId",
        "variant.variantName AS variantName",
        "SUM(dp.netWeight) AS dumpQty",
        "SUM(dp.amount) AS dumpAmt",
      ])
      .where("dump.company_id = :companyId", { companyId })
      .andWhere("dump.branch_id = :locationId", { locationId })
      .andWhere("dump.date BETWEEN :start AND :end", { start: startDate, end: endDate })
      .groupBy("product.id")
      .addGroupBy("variant.id")
      .getRawMany();

    //----------------------------------------------------
    return {
      inwardData,
      purchaseData,
      dumpData,
    };
  }

  //-----------------------------------------------------------------------
  // ✔ Format helpers
  //-----------------------------------------------------------------------
  private formatInventoryStock(stock: any) {
    return {
      id: stock.id || null,
      location: stock.location?.name || null,
      companyName: stock.company?.name || null,
      product: stock.product?.name || null,
      variant: stock.variant?.variantName || null,
      inwardQty: Number(stock.inwardQty || 0),
      inwardAmt: Number(stock.inwardAmt || 0),
    };
  }

  private formatProductInventoryStock(stock: any) {
    return {
      companyName: stock.companyname,
      location: stock.locationname,
      product: stock.productname,
      inwardQty: parseFloat(stock.inwardqty || stock.inwardQty || 0),
      inwardAmt: parseFloat(stock.inwardamt || stock.inwardAmt || 0),
    };
  }

  //-----------------------------------------------------------------------
  // ✔ End of Day Report
  //-----------------------------------------------------------------------
  async getEndOfDayReport(companyId?: string, locationId?: string, startDate?: string, endDate?: string) {
    const whereConditions: any = {};
    
    if (companyId) whereConditions.companyId = companyId;
    if (locationId) whereConditions.locationId = locationId;

    // Date range setup - Add time to ensure full day coverage
    const dateFilter = startDate && endDate 
      ? { 
          start: `${startDate} 00:00:00`, 
          end: `${endDate} 23:59:59` 
        }
      : null;

    //----------------------------------------------------
    // 1. GRN DATA (Purchase)
    //----------------------------------------------------
    const grnQuery = this.grnRepository
      .createQueryBuilder('grn')
      .leftJoin('grn.companyName', 'company')
      .leftJoin('grn.purchaseLocation', 'location')
      .leftJoin('grn.grnProducts', 'grnProduct')
      .select('COUNT(DISTINCT grn.id)', 'totalGrnCount')
      .addSelect('COALESCE(SUM("grnProduct"."netWeight"), 0)', 'totalPurchaseQty')
      .addSelect('COALESCE(SUM("grnProduct"."amount"), 0)', 'totalPurchaseAmt')
      .addSelect('COALESCE(SUM(CASE WHEN "grnProduct"."rtv" = true THEN "grnProduct"."netWeight" ELSE 0 END), 0)', 'rtvQty')
      .addSelect('COALESCE(SUM(CASE WHEN "grnProduct"."rtv" = true THEN "grnProduct"."amount" ELSE 0 END), 0)', 'rtvAmt')
      .addSelect('COALESCE(SUM(CASE WHEN "grnProduct"."rtv" = false THEN "grnProduct"."netWeight" ELSE 0 END), 0)', 'nonRtvQty')
      .addSelect('COALESCE(SUM(CASE WHEN "grnProduct"."rtv" = false THEN "grnProduct"."amount" ELSE 0 END), 0)', 'nonRtvAmt')
      .addSelect('COALESCE(SUM(grn.freight), 0)', 'totalFreight')
      .addSelect('COALESCE(SUM(grn.otherCharges), 0)', 'totalOtherCharges');

    if (companyId) grnQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) grnQuery.andWhere('location.id = :locationId', { locationId });
    if (dateFilter) {
      grnQuery.andWhere('grn.createdAt BETWEEN :start AND :end', dateFilter);
    }

    const grnData = await grnQuery.getRawOne();
    console.log("GRN Data:", grnData);

    //----------------------------------------------------
    // 1B. CASH PURCHASE DATA (GRN with Cash Payment Mode)
    //----------------------------------------------------
    const cashPurchaseQuery = this.grnRepository
      .createQueryBuilder('grn')
      .leftJoin('grn.companyName', 'company')
      .leftJoin('grn.purchaseLocation', 'location')
      .leftJoin('grn.grnProducts', 'grnProduct')
      .leftJoin('grn.paymentInfo', 'paymentInfo')
      .select('COUNT(DISTINCT grn.id)', 'totalCashGrnCount')
      .addSelect('COALESCE(SUM("grnProduct"."netWeight"), 0)', 'totalCashPurchaseQty')
      .addSelect('COALESCE(SUM("grnProduct"."amount"), 0)', 'totalCashPurchaseAmt')
      .addSelect('COALESCE(SUM(grn.freight), 0)', 'totalCashFreight')
      .addSelect('COALESCE(SUM(grn.otherCharges), 0)', 'totalCashOtherCharges')
      .where('LOWER(paymentInfo.paymentMode) = :paymentMode', { paymentMode: 'cash' });

    if (companyId) cashPurchaseQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) cashPurchaseQuery.andWhere('location.id = :locationId', { locationId });
    if (dateFilter) {
      cashPurchaseQuery.andWhere('grn.createdAt BETWEEN :start AND :end', dateFilter);
    }

    const cashPurchaseData = await cashPurchaseQuery.getRawOne();
    console.log("Cash Purchase Data:", cashPurchaseData);

    //----------------------------------------------------
    // 1C. OTHER PURCHASE DATA (GRN without Cash Payment Mode)
    //----------------------------------------------------
    const otherPurchaseQuery = this.grnRepository
      .createQueryBuilder('grn')
      .leftJoin('grn.companyName', 'company')
      .leftJoin('grn.purchaseLocation', 'location')
      .leftJoin('grn.grnProducts', 'grnProduct')
      .leftJoin('grn.paymentInfo', 'paymentInfo')
      .select('COUNT(DISTINCT grn.id)', 'totalOtherGrnCount')
      .addSelect('COALESCE(SUM("grnProduct"."netWeight"), 0)', 'totalOtherPurchaseQty')
      .addSelect('COALESCE(SUM("grnProduct"."amount"), 0)', 'totalOtherPurchaseAmt')
      .addSelect('COALESCE(SUM(grn.freight), 0)', 'totalOtherFreight')
      .addSelect('COALESCE(SUM(grn.otherCharges), 0)', 'totalOtherOtherCharges')
      .where('(paymentInfo.paymentMode IS NULL OR LOWER(paymentInfo.paymentMode) != :paymentMode)', { paymentMode: 'cash' });

    if (companyId) otherPurchaseQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) otherPurchaseQuery.andWhere('location.id = :locationId', { locationId });
    if (dateFilter) {
      otherPurchaseQuery.andWhere('grn.createdAt BETWEEN :start AND :end', dateFilter);
    }

    const otherPurchaseData = await otherPurchaseQuery.getRawOne();
    console.log("Other Purchase Data:", otherPurchaseData);

    //----------------------------------------------------
    // 2. DUMP DATA
    //----------------------------------------------------
    const dumpQuery = this.dumpRegisterRepository
      .createQueryBuilder('dump')
      .leftJoin('dump.companyName', 'company')
      .leftJoin('dump.location', 'location')
      .leftJoin('dump.dumpProducts', 'dumpProduct')
      .select('COUNT(DISTINCT dump.id)', 'totalDumpCount')
      .addSelect('COALESCE(SUM("dumpProduct"."quantity"), 0)', 'totalDumpQty')
      .addSelect('COALESCE(SUM("dumpProduct"."amount"), 0)', 'totalDumpAmt');

    if (companyId) dumpQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) dumpQuery.andWhere('location.id = :locationId', { locationId });
    if (dateFilter) {
      dumpQuery.andWhere('dump.date BETWEEN :start AND :end', dateFilter);
    }

    const dumpData = await dumpQuery.getRawOne();
    console.log("Dump Data:", dumpData);

    //----------------------------------------------------
    // 3. CUSTOMER DELIVERY CHALLAN (Sales) - Enhanced
    //----------------------------------------------------
    const salesQuery = this.customerDeliveryChallanRepository
      .createQueryBuilder('dc')
      .leftJoin('dc.companyName', 'company')
      .leftJoin('dc.fromLocation', 'location')
      .leftJoin('dc.customerName', 'customer')
      .leftJoin('dc.deliveryChallanProducts', 'dcProduct')
      .select('COUNT(DISTINCT dc.id)', 'totalSalesCount')
      .addSelect('COUNT(DISTINCT customer.id)', 'uniqueCustomerCount')
      .addSelect('COALESCE(SUM("dcProduct"."netWeight"), 0)', 'totalSalesQty')
      .addSelect('COALESCE(SUM("dcProduct"."amount"), 0)', 'totalSalesAmt')
      .addSelect('COALESCE(SUM(dc.totalProductAmount), 0)', 'totalChallanAmount')
      .addSelect('COALESCE(SUM(dc.totalPackagingMaterialAmount), 0)', 'totalPackagingAmount')
      .addSelect('COALESCE(SUM("dcProduct"."returnedQty"), 0)', 'totalReturnedQty')
      .addSelect('COALESCE(AVG("dcProduct"."amount"), 0)', 'averageSaleAmount')
      .addSelect('COALESCE(AVG(dc.totalProductAmount), 0)', 'averageChallanAmount')
      .addSelect('COALESCE(AVG("dcProduct"."unitPrice"), 0)', 'averageUnitPrice');

    if (companyId) salesQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) salesQuery.andWhere('location.id = :locationId', { locationId });
    if (dateFilter) {
      salesQuery.andWhere('dc.createdAt BETWEEN :start AND :end', dateFilter);
    }

    const salesData = await salesQuery.getRawOne();
    console.log("Enhanced Sales Data:", salesData);

    //----------------------------------------------------
    // 4. INWARD REGISTER DATA (with CC/DC tracking)
    //----------------------------------------------------
    const inwardQuery = this.inwardRepository
      .createQueryBuilder('inward')
      .leftJoin('inward.companyName', 'company')
      .leftJoin('inward.location', 'location')
      .leftJoin('inward.inwardProducts', 'inwardProduct')
      .leftJoin('inward.deliveryChallanNo', 'deliveryChallan')
      .select('COUNT(DISTINCT inward.id)', 'totalInwardCount')
      .addSelect('COALESCE(SUM("inwardProduct"."netWeight"), 0)', 'totalInwardQty')
      .addSelect('COALESCE(SUM("inwardProduct"."amount"), 0)', 'totalInwardAmt')
      .addSelect('COUNT(DISTINCT CASE WHEN deliveryChallan.type = \'stock-transfer-delivery-challan\' THEN inward.id END)', 'inwardFromCcDcCount')
      .addSelect('COALESCE(SUM(CASE WHEN deliveryChallan.type = \'stock-transfer-delivery-challan\' THEN "inwardProduct"."netWeight" ELSE 0 END), 0)', 'inwardFromCcDcQty')
      .addSelect('COALESCE(SUM(CASE WHEN deliveryChallan.type = \'stock-transfer-delivery-challan\' THEN "inwardProduct"."amount" ELSE 0 END), 0)', 'inwardFromCcDcAmt');

    if (companyId) inwardQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) inwardQuery.andWhere('location.id = :locationId', { locationId });
    if (dateFilter) {
      inwardQuery.andWhere('inward.date BETWEEN :start AND :end', dateFilter);
    }

    const inwardData = await inwardQuery.getRawOne();
    console.log("Inward Data:", inwardData);

    //----------------------------------------------------
    // 5. OPENING STOCK (from inventory_stock table)
    //----------------------------------------------------
    const openingStockQuery = this.inventoryStockRepository
      .createQueryBuilder('stock')
      .leftJoin('stock.company', 'company')
      .leftJoin('stock.location', 'location')
      .select('COALESCE(SUM(stock.inwardQty), 0)', 'openingStockQty')
      .addSelect('COALESCE(SUM(stock.inwardAmt), 0)', 'openingStockAmt');

    if (companyId) openingStockQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) openingStockQuery.andWhere('location.id = :locationId', { locationId });

    const openingStock = await openingStockQuery.getRawOne();
    console.log("Opening Stock:", openingStock);

    //----------------------------------------------------
    // 6. INVOICE DATA (Enhanced - Total Number of Invoices Generated)
    //----------------------------------------------------
    const invoiceQuery = this.invoiceRepository
      .createQueryBuilder('invoice')
      .leftJoin('invoice.location', 'location')
      .leftJoin('invoice.deliveryChallan', 'dc')
      .leftJoin('dc.companyName', 'company')
      .select('COUNT(DISTINCT invoice.id)', 'totalInvoiceCount')
      .addSelect('COALESCE(SUM(invoice.totalAmount), 0)', 'totalInvoiceAmount')
      .addSelect('COALESCE(AVG(invoice.totalAmount), 0)', 'averageInvoiceAmount')
      .addSelect('COUNT(CASE WHEN invoice.type = \'final\' THEN 1 END)', 'finalInvoiceCount')
      .addSelect('COUNT(CASE WHEN invoice.type = \'proforma\' THEN 1 END)', 'proformaInvoiceCount')
      .addSelect('COALESCE(SUM(CASE WHEN invoice.type = \'final\' THEN invoice.totalAmount ELSE 0 END), 0)', 'finalInvoiceAmount')
      .addSelect('COALESCE(SUM(CASE WHEN invoice.type = \'proforma\' THEN invoice.totalAmount ELSE 0 END), 0)', 'proformaInvoiceAmount');

    if (companyId) invoiceQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) invoiceQuery.andWhere('location.id = :locationId', { locationId });
    if (dateFilter) {
      invoiceQuery.andWhere('invoice.createdAt BETWEEN :start AND :end', dateFilter);
    }

    const invoiceData = await invoiceQuery.getRawOne();
    console.log("Enhanced Invoice Data:", invoiceData);

    //----------------------------------------------------
    // 7. STOCK TRANSFER (Enhanced - Internal Transfer to DC)
    //----------------------------------------------------
    const stockTransferQuery = this.stockTransferDeliveryChallanRepository
      .createQueryBuilder('st')
      .leftJoin('st.companyName', 'company')
      .leftJoin('st.fromLocation', 'fromLoc')
      .leftJoin('st.toLocation', 'toLoc')
      .leftJoin('st.deliveryChallanProducts', 'stProduct')
      .leftJoin('stProduct.productName', 'product')
      .leftJoin('stProduct.variant', 'variant')
      .select('COUNT(DISTINCT st.id)', 'totalTransferCount')
      .addSelect('COUNT(DISTINCT fromLoc.id)', 'uniqueFromLocationCount')
      .addSelect('COUNT(DISTINCT toLoc.id)', 'uniqueToLocationCount')
      .addSelect('COUNT(DISTINCT product.id)', 'uniqueProductCount')
      .addSelect('COALESCE(SUM("stProduct"."netWeight"), 0)', 'totalTransferQty')
      .addSelect('COALESCE(SUM("stProduct"."amount"), 0)', 'totalTransferAmt')
      .addSelect('COALESCE(AVG("stProduct"."netWeight"), 0)', 'averageTransferQty')
      .addSelect('COALESCE(AVG("stProduct"."amount"), 0)', 'averageTransferAmt')
      .addSelect('COALESCE(AVG("stProduct"."unitPrice"), 0)', 'averageUnitPrice');

    if (companyId) stockTransferQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) stockTransferQuery.andWhere('fromLoc.id = :locationId', { locationId });
    if (dateFilter) {
      stockTransferQuery.andWhere('st.createdAt BETWEEN :start AND :end', dateFilter);
    }

    const stockTransferData = await stockTransferQuery.getRawOne();
    console.log("Enhanced Stock Transfer Data:", stockTransferData);

    //----------------------------------------------------
    // 8. SECOND SALE (Salvaged Second Sale for the day)
    //----------------------------------------------------
    const secondSaleQuery = this.secondSaleRepository
      .createQueryBuilder('ss')
      .leftJoin('ss.companyName', 'company')
      .leftJoin('ss.location', 'location')
      .select('COUNT(DISTINCT ss.id)', 'totalSecondSaleCount')
      .addSelect('COALESCE(SUM(ss.totalNetWeight), 0)', 'totalSecondSaleQty')
      .addSelect('COALESCE(SUM(ss.totalAmt), 0)', 'totalSecondSaleAmt')
      .addSelect('COALESCE(SUM(ss.paidAmount), 0)', 'totalCollections')
      .addSelect('COALESCE(SUM(ss.pendingAmt), 0)', 'totalOutstanding');

    if (companyId) secondSaleQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) secondSaleQuery.andWhere('location.id = :locationId', { locationId });
    if (dateFilter) {
      secondSaleQuery.andWhere('ss.saleDate BETWEEN :start AND :end', dateFilter);
    }

    const secondSaleData = await secondSaleQuery.getRawOne();

    //----------------------------------------------------
    // 9. CUSTOMER RETURNS (Returns Salvaged)
    //----------------------------------------------------
    const customerReturnQuery = this.postReturnByCustomerRepository
      .createQueryBuilder('cr')
      .leftJoin('cr.companyName', 'company')
      .leftJoin('cr.location', 'location')
      .leftJoin('cr.returnedProducts', 'returnProduct')
      .select('COUNT(DISTINCT cr.id)', 'totalReturnCount')
      .addSelect('COALESCE(SUM("returnProduct"."returnedNetWt"), 0)', 'totalReturnQty')
      .addSelect('COALESCE(SUM("returnProduct"."returnedQtyAmt"), 0)', 'totalReturnAmt')
      .addSelect('COALESCE(SUM("returnProduct"."rejectedNetWt"), 0)', 'totalRejectedQty')
      .addSelect('COALESCE(SUM("returnProduct"."rejectedQtyAmt"), 0)', 'totalRejectedAmt');

    if (companyId) customerReturnQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) customerReturnQuery.andWhere('location.id = :locationId', { locationId });
    if (dateFilter) {
      customerReturnQuery.andWhere('cr.date BETWEEN :start AND :end', dateFilter);
    }

    const customerReturnData = await customerReturnQuery.getRawOne();

    //----------------------------------------------------
    // 10. LABOR PAYMENT VOUCHER DATA
    //----------------------------------------------------
    const laborPaymentQuery = this.labourPaymentVoucherRepository
      .createQueryBuilder('lpv')
      .leftJoin('lpv.companyName', 'company')
      .select('COUNT(DISTINCT lpv.id)', 'totalLaborPaymentCount')
      .addSelect('COALESCE(SUM(lpv.totalAmt), 0)', 'totalLaborPaymentAmt')
      .addSelect('COALESCE(SUM(lpv.noOfLabours), 0)', 'totalLaborCount');

    if (companyId) laborPaymentQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) laborPaymentQuery.andWhere('lpv.location = :locationId', { locationId });
    if (dateFilter) {
      laborPaymentQuery.andWhere('lpv.createdAt BETWEEN :start AND :end', dateFilter);
    }

    const laborPaymentData = await laborPaymentQuery.getRawOne();
    console.log("Labor Payment Data:", laborPaymentData);

    //----------------------------------------------------
    // 11. TRANSPORT PAYMENT VOUCHER DATA
    //----------------------------------------------------
    const transportPaymentQuery = this.tpVoucherRepository
      .createQueryBuilder('tpv')
      .leftJoin('tpv.companyName', 'company')
      .select('COUNT(DISTINCT tpv.id)', 'totalTransportPaymentCount')
      .addSelect('COALESCE(SUM(tpv.finalPayableAmt), 0)', 'totalTransportPaymentAmt')
      .addSelect('COALESCE(SUM(tpv.freightAmt), 0)', 'totalFreightAmt')
      .addSelect('COALESCE(SUM(tpv.advanceAmt), 0)', 'totalAdvanceAmt')
      .addSelect('COALESCE(SUM(tpv.deductionAmt), 0)', 'totalDeductionAmt');

    if (companyId) transportPaymentQuery.andWhere('company.id = :companyId', { companyId });
    if (locationId) transportPaymentQuery.andWhere('tpv.location = :locationId', { locationId });
    if (dateFilter) {
      transportPaymentQuery.andWhere('tpv.createdAt BETWEEN :start AND :end', dateFilter);
    }

    const transportPaymentData = await transportPaymentQuery.getRawOne();
    console.log("Transport Payment Data:", transportPaymentData);

    //----------------------------------------------------
    // SIMPLIFIED EOD REPORT - Only 5 Key Sections
    //----------------------------------------------------
    
    return {
      reportDate: dateFilter ? `${startDate} to ${endDate}` : 'All Time',
      companyId,
      locationId,

      // 1. LABOR PAYMENT OF THE DAY
      laborPayment: {
        totalLaborPaymentCount: parseInt(laborPaymentData?.totalLaborPaymentCount || '0'),
        totalLaborPaymentAmount: parseFloat(laborPaymentData?.totalLaborPaymentAmt || 0),
        // totalLaborCount: parseInt(laborPaymentData?.totalLaborCount || '0'),
        // averagePaymentPerLabor: parseInt(laborPaymentData?.totalLaborCount || '0') > 0 
        //   ? parseFloat(laborPaymentData?.totalLaborPaymentAmt || 0) / parseInt(laborPaymentData?.totalLaborCount || '0')
        //   : 0,
      },

      // 2. TRANSPORTATION OF THE DAY
      transportation: {
        totalTransportPaymentCount: parseInt(transportPaymentData?.totalTransportPaymentCount || '0'),
        totalTransportPaymentAmount: parseFloat(transportPaymentData?.totalTransportPaymentAmt || 0),
        // totalFreightAmount: parseFloat(transportPaymentData?.totalFreightAmt || 0),
        // totalAdvanceAmount: parseFloat(transportPaymentData?.totalAdvanceAmt || 0),
        // totalDeductionAmount: parseFloat(transportPaymentData?.totalDeductionAmt || 0),
      },

      // 3. RTV BASIS PURCHASE
      rtvPurchase: {
        totalPurchaseQty: parseFloat(grnData?.totalPurchaseQty || 0),
        totalPurchaseAmt: parseFloat(grnData?.totalPurchaseAmt || 0),
        rtvQty: parseFloat(grnData?.rtvQty || 0),
        rtvAmt: parseFloat(grnData?.rtvAmt || 0),
        nonRtvQty: parseFloat(grnData?.nonRtvQty || 0),
        nonRtvAmt: parseFloat(grnData?.nonRtvAmt || 0),
        // rtvPercentage: parseFloat(grnData?.totalPurchaseQty || 0) > 0 
        //   ? (parseFloat(grnData?.rtvQty || 0) / parseFloat(grnData?.totalPurchaseQty || 0) * 100).toFixed(2) 
        //   : 0,
      },

      // 4. RECEIVED FROM CC/DC
      receivedFromCcDc: {
        totalInwardCount: parseInt(inwardData?.totalInwardCount || '0'),
        totalInwardQty: parseFloat(inwardData?.totalInwardQty || 0),
        totalInwardAmt: parseFloat(inwardData?.totalInwardAmt || 0),
        receivedFromCcDcCount: parseInt(inwardData?.inwardFromCcDcCount || '0'),
        receivedFromCcDcQty: parseFloat(inwardData?.inwardFromCcDcQty || 0),
        receivedFromCcDcAmt: parseFloat(inwardData?.inwardFromCcDcAmt || 0),
        // otherInwardQty: parseFloat(inwardData?.totalInwardQty || 0) - parseFloat(inwardData?.inwardFromCcDcQty || 0),
        // otherInwardAmt: parseFloat(inwardData?.totalInwardAmt || 0) - parseFloat(inwardData?.inwardFromCcDcAmt || 0),
      },

      // 5. TOTAL PURCHASE OF THE DAY
      totalPurchase: {
        totalGrnCount: parseInt(grnData?.totalGrnCount || '0'),
        totalPurchaseQty: parseFloat(grnData?.totalPurchaseQty || 0),
        totalPurchaseAmt: parseFloat(grnData?.totalPurchaseAmt || 0),
        // totalFreight: parseFloat(grnData?.totalFreight || 0),
        // totalOtherCharges: parseFloat(grnData?.totalOtherCharges || 0),
        // totalLandingCost: parseFloat(grnData?.totalPurchaseAmt || 0) + 
        //                  parseFloat(grnData?.totalFreight || 0) + 
        //                  parseFloat(grnData?.totalOtherCharges || 0),
        // averagePurchasePricePerUnit: parseFloat(grnData?.totalPurchaseQty || 0) > 0 
        //   ? parseFloat(grnData?.totalPurchaseAmt || 0) / parseFloat(grnData?.totalPurchaseQty || 0)
        //   : 0,
        // averageLandingCostPerUnit: parseFloat(grnData?.totalPurchaseQty || 0) > 0 
        //   ? (parseFloat(grnData?.totalPurchaseAmt || 0) + parseFloat(grnData?.totalFreight || 0) + parseFloat(grnData?.totalOtherCharges || 0)) / parseFloat(grnData?.totalPurchaseQty || 0)
        //   : 0,
      },

      // 6. TOTAL DUMP OF THE DAY
      totalDump: {
        totalDumpCount: parseInt(dumpData?.totalDumpCount || '0'),
        totalDumpQty: parseFloat(dumpData?.totalDumpQty || 0),
        totalDumpAmt: parseFloat(dumpData?.totalDumpAmt || 0),
        // averageDumpValuePerUnit: parseFloat(dumpData?.totalDumpQty || 0) > 0 
        //   ? parseFloat(dumpData?.totalDumpAmt || 0) / parseFloat(dumpData?.totalDumpQty || 0)
        //   : 0,
      },

      // 7. TOTAL RETURN BY CUSTOMER
      totalReturnByCustomer: {
        totalReturnCount: parseInt(customerReturnData?.totalReturnCount || '0'),
        totalReturnedQty: parseFloat(customerReturnData?.totalReturnQty || 0),
        totalReturnedAmt: parseFloat(customerReturnData?.totalReturnAmt || 0),
        // totalRejectedQty: parseFloat(customerReturnData?.totalRejectedQty || 0),
        // totalRejectedAmt: parseFloat(customerReturnData?.totalRejectedAmt || 0),
        // totalCombinedQty: parseFloat(customerReturnData?.totalReturnQty || 0) + parseFloat(customerReturnData?.totalRejectedQty || 0),
        // totalCombinedAmt: parseFloat(customerReturnData?.totalReturnAmt || 0) + parseFloat(customerReturnData?.totalRejectedAmt || 0),
        // averageReturnValuePerUnit: parseFloat(customerReturnData?.totalReturnQty || 0) > 0 
        //   ? parseFloat(customerReturnData?.totalReturnAmt || 0) / parseFloat(customerReturnData?.totalReturnQty || 0)
        //   : 0,
        // returnPercentageByValue: parseFloat(grnData?.totalPurchaseAmt || 0) > 0 
        //   ? ((parseFloat(customerReturnData?.totalReturnAmt || 0) + parseFloat(customerReturnData?.totalRejectedAmt || 0)) / parseFloat(grnData?.totalPurchaseAmt || 0) * 100).toFixed(2)
        //   : 0,
      },

      // 8. TOTAL INWARD OF THE DAY
      totalInward: {
        totalInwardCount: parseInt(inwardData?.totalInwardCount || '0'),
        totalInwardQty: parseFloat(inwardData?.totalInwardQty || 0),
        totalInwardAmt: parseFloat(inwardData?.totalInwardAmt || 0),
        // inwardFromCcDcCount: parseInt(inwardData?.inwardFromCcDcCount || '0'),
        // inwardFromCcDcQty: parseFloat(inwardData?.inwardFromCcDcQty || 0),
        // inwardFromCcDcAmt: parseFloat(inwardData?.inwardFromCcDcAmt || 0),
        // otherInwardCount: parseInt(inwardData?.totalInwardCount || '0') - parseInt(inwardData?.inwardFromCcDcCount || '0'),
        // otherInwardQty: parseFloat(inwardData?.totalInwardQty || 0) - parseFloat(inwardData?.inwardFromCcDcQty || 0),
        // otherInwardAmt: parseFloat(inwardData?.totalInwardAmt || 0) - parseFloat(inwardData?.inwardFromCcDcAmt || 0),
        // averageInwardValuePerUnit: parseFloat(inwardData?.totalInwardQty || 0) > 0 
        //   ? parseFloat(inwardData?.totalInwardAmt || 0) / parseFloat(inwardData?.totalInwardQty || 0)
        //   : 0,
        // ccDcPercentageByQty: parseFloat(inwardData?.totalInwardQty || 0) > 0 
        //   ? (parseFloat(inwardData?.inwardFromCcDcQty || 0) / parseFloat(inwardData?.totalInwardQty || 0) * 100).toFixed(2)
        //   : 0,
      },

      // 9. CASH PURCHASE OF THE DAY
      cashPurchase: {
        totalCashGrnCount: parseInt(cashPurchaseData?.totalCashGrnCount || '0'),
        totalCashPurchaseQty: parseFloat(cashPurchaseData?.totalCashPurchaseQty || 0),
        totalCashPurchaseAmt: parseFloat(cashPurchaseData?.totalCashPurchaseAmt || 0),
        // totalCashFreight: parseFloat(cashPurchaseData?.totalCashFreight || 0),
        // totalCashOtherCharges: parseFloat(cashPurchaseData?.totalCashOtherCharges || 0),
        // totalCashLandingCost: parseFloat(cashPurchaseData?.totalCashPurchaseAmt || 0) + 
        //                      parseFloat(cashPurchaseData?.totalCashFreight || 0) + 
        //                      parseFloat(cashPurchaseData?.totalCashOtherCharges || 0),
        // averageCashPricePerUnit: parseFloat(cashPurchaseData?.totalCashPurchaseQty || 0) > 0 
        //   ? parseFloat(cashPurchaseData?.totalCashPurchaseAmt || 0) / parseFloat(cashPurchaseData?.totalCashPurchaseQty || 0)
        //   : 0,
        // cashPercentageOfTotalPurchase: parseFloat(grnData?.totalPurchaseAmt || 0) > 0 
        //   ? (parseFloat(cashPurchaseData?.totalCashPurchaseAmt || 0) / parseFloat(grnData?.totalPurchaseAmt || 0) * 100).toFixed(2)
        //   : 0,
      },

      // 10. OTHER PURCHASE OF THE DAY (Credit/Cheque/Online/etc.)
      otherPurchase: {
        totalOtherGrnCount: parseInt(otherPurchaseData?.totalOtherGrnCount || '0'),
        totalOtherPurchaseQty: parseFloat(otherPurchaseData?.totalOtherPurchaseQty || 0),
        totalOtherPurchaseAmt: parseFloat(otherPurchaseData?.totalOtherPurchaseAmt || 0),
        // totalOtherFreight: parseFloat(otherPurchaseData?.totalOtherFreight || 0),
        // totalOtherOtherCharges: parseFloat(otherPurchaseData?.totalOtherOtherCharges || 0),
        // totalOtherLandingCost: parseFloat(otherPurchaseData?.totalOtherPurchaseAmt || 0) + 
        //                       parseFloat(otherPurchaseData?.totalOtherFreight || 0) + 
        //                       parseFloat(otherPurchaseData?.totalOtherOtherCharges || 0),
        // averageOtherPricePerUnit: parseFloat(otherPurchaseData?.totalOtherPurchaseQty || 0) > 0 
        //   ? parseFloat(otherPurchaseData?.totalOtherPurchaseAmt || 0) / parseFloat(otherPurchaseData?.totalOtherPurchaseQty || 0)
        //   : 0,
        //otherPercentageOfTotalPurchase: parseFloat(grnData?.totalPurchaseAmt || 0) > 0 
        //   ? (parseFloat(otherPurchaseData?.totalOtherPurchaseAmt || 0) / parseFloat(grnData?.totalPurchaseAmt || 0) * 100).toFixed(2)
        //   : 0,
        // paymentModes: 'Credit, Cheque, Online, Bank Transfer, etc. (All non-cash)',
      },

      // 11. SALE OF DAY (Based on Customer Delivery Challan)
      saleOfDay: {
        totalSalesCount: parseInt(salesData?.totalSalesCount || '0'),
        uniqueCustomerCount: parseInt(salesData?.uniqueCustomerCount || '0'),
        totalSalesQty: parseFloat(salesData?.totalSalesQty || 0),
        totalSalesAmount: parseFloat(salesData?.totalSalesAmt || 0),
        // totalChallanAmount: parseFloat(salesData?.totalChallanAmount || 0),
        // totalPackagingAmount: parseFloat(salesData?.totalPackagingAmount || 0),
        // totalReturnedQty: parseFloat(salesData?.totalReturnedQty || 0),
        // netSalesQty: parseFloat(salesData?.totalSalesQty || 0) - parseFloat(salesData?.totalReturnedQty || 0),
        // averageSaleAmount: parseFloat(salesData?.averageSaleAmount || 0),
        // averageChallanAmount: parseFloat(salesData?.averageChallanAmount || 0),
        // averageUnitPrice: parseFloat(salesData?.averageUnitPrice || 0),
        // averageSalePerCustomer: parseInt(salesData?.uniqueCustomerCount || '0') > 0 
        //   ? parseFloat(salesData?.totalSalesAmt || 0) / parseInt(salesData?.uniqueCustomerCount || '0')
        //   : 0,
        // averageSalePerChallan: parseInt(salesData?.totalSalesCount || '0') > 0 
        //   ? parseFloat(salesData?.totalSalesAmt || 0) / parseInt(salesData?.totalSalesCount || '0')
        //   : 0,
        // returnQtyPercentage: parseFloat(salesData?.totalSalesQty || 0) > 0 
        //   ? (parseFloat(salesData?.totalReturnedQty || 0) / parseFloat(salesData?.totalSalesQty || 0) * 100).toFixed(2)
        //   : 0,
        // salesEfficiency: parseFloat(grnData?.totalPurchaseAmt || 0) > 0 
        //   ? (parseFloat(salesData?.totalSalesAmt || 0) / parseFloat(grnData?.totalPurchaseAmt || 0) * 100).toFixed(2)
        //   : 0,
        // salesToPurchaseRatio: parseFloat(grnData?.totalPurchaseQty || 0) > 0 
        //   ? (parseFloat(salesData?.totalSalesQty || 0) / parseFloat(grnData?.totalPurchaseQty || 0) * 100).toFixed(2)
        //   : 0,
      },

      // 12. TOTAL INVOICES GENERATED
      totalInvoicesGenerated: {
        // totalInvoiceCount: parseInt(invoiceData?.totalInvoiceCount || '0'),
        // totalInvoiceAmount: parseFloat(invoiceData?.totalInvoiceAmount || 0),
        //averageInvoiceAmount: parseFloat(invoiceData?.averageInvoiceAmount || 0),
        finalInvoiceCount: parseInt(invoiceData?.finalInvoiceCount || '0'),
        //proformaInvoiceCount: parseInt(invoiceData?.proformaInvoiceCount || '0'),
        finalInvoiceAmount: parseFloat(invoiceData?.finalInvoiceAmount || 0),
        // proformaInvoiceAmount: parseFloat(invoiceData?.proformaInvoiceAmount || 0),
        // invoiceToSalesRatio: parseInt(salesData?.totalSalesCount || '0') > 0 
        //   ? (parseInt(invoiceData?.totalInvoiceCount || '0') / parseInt(salesData?.totalSalesCount || '0') * 100).toFixed(2)
        //   : 0,
        // finalInvoicePercentage: parseInt(invoiceData?.totalInvoiceCount || '0') > 0 
        //   ? (parseInt(invoiceData?.finalInvoiceCount || '0') / parseInt(invoiceData?.totalInvoiceCount || '0') * 100).toFixed(2)
        //   : 0,
        // proformaInvoicePercentage: parseInt(invoiceData?.totalInvoiceCount || '0') > 0 
        //   ? (parseInt(invoiceData?.proformaInvoiceCount || '0') / parseInt(invoiceData?.totalInvoiceCount || '0') * 100).toFixed(2)
        //   : 0,
        // averageFinalInvoiceAmount: parseInt(invoiceData?.finalInvoiceCount || '0') > 0 
        //   ? parseFloat(invoiceData?.finalInvoiceAmount || 0) / parseInt(invoiceData?.finalInvoiceCount || '0')
        //   : 0,
        // averageProformaInvoiceAmount: parseInt(invoiceData?.proformaInvoiceCount || '0') > 0 
        //   ? parseFloat(invoiceData?.proformaInvoiceAmount || 0) / parseInt(invoiceData?.proformaInvoiceCount || '0')
        //   : 0,
      },

      // 13. SECOND SALE OF THE DAY (Salvaged Second Sale)
      secondSaleOfDay: {
        totalSecondSaleCount: parseInt(secondSaleData?.totalSecondSaleCount || '0'),
        totalSecondSaleQty: parseFloat(secondSaleData?.totalSecondSaleQty || 0),
        totalSecondSaleAmount: parseFloat(secondSaleData?.totalSecondSaleAmt || 0),
        // totalCollections: parseFloat(secondSaleData?.totalCollections || 0),
        // totalOutstanding: parseFloat(secondSaleData?.totalOutstanding || 0),
        // collectionPercentage: parseFloat(secondSaleData?.totalSecondSaleAmt || 0) > 0 
        //   ? (parseFloat(secondSaleData?.totalCollections || 0) / parseFloat(secondSaleData?.totalSecondSaleAmt || 0) * 100).toFixed(2)
        //   : 0,
        // outstandingPercentage: parseFloat(secondSaleData?.totalSecondSaleAmt || 0) > 0 
        //   ? (parseFloat(secondSaleData?.totalOutstanding || 0) / parseFloat(secondSaleData?.totalSecondSaleAmt || 0) * 100).toFixed(2)
        //   : 0,
        // averageSecondSaleAmount: parseInt(secondSaleData?.totalSecondSaleCount || '0') > 0 
        //   ? parseFloat(secondSaleData?.totalSecondSaleAmt || 0) / parseInt(secondSaleData?.totalSecondSaleCount || '0')
        //   : 0,
        // averageSecondSaleQty: parseInt(secondSaleData?.totalSecondSaleCount || '0') > 0 
        //   ? parseFloat(secondSaleData?.totalSecondSaleQty || 0) / parseInt(secondSaleData?.totalSecondSaleCount || '0')
        //   : 0,
        // averageCollectionPerSale: parseInt(secondSaleData?.totalSecondSaleCount || '0') > 0 
        //   ? parseFloat(secondSaleData?.totalCollections || 0) / parseInt(secondSaleData?.totalSecondSaleCount || '0')
        //   : 0,
        // averageOutstandingPerSale: parseInt(secondSaleData?.totalSecondSaleCount || '0') > 0 
        //   ? parseFloat(secondSaleData?.totalOutstanding || 0) / parseInt(secondSaleData?.totalSecondSaleCount || '0')
        //   : 0,
        // secondSaleToMainSaleRatio: parseInt(salesData?.totalSalesCount || '0') > 0 
        //   ? (parseInt(secondSaleData?.totalSecondSaleCount || '0') / parseInt(salesData?.totalSalesCount || '0') * 100).toFixed(2)
        //   : 0,
        // secondSaleAmountToMainSaleRatio: parseFloat(salesData?.totalSalesAmt || 0) > 0 
        //   ? (parseFloat(secondSaleData?.totalSecondSaleAmt || 0) / parseFloat(salesData?.totalSalesAmt || 0) * 100).toFixed(2)
        //   : 0,
      },

      // 14. INTERNAL STOCK TRANSFER OF THE DAY
      internalStockTransferOfDay: {
        totalTransferCount: parseInt(stockTransferData?.totalTransferCount || '0'),
        uniqueFromLocationCount: parseInt(stockTransferData?.uniqueFromLocationCount || '0'),
        uniqueToLocationCount: parseInt(stockTransferData?.uniqueToLocationCount || '0'),
        uniqueProductCount: parseInt(stockTransferData?.uniqueProductCount || '0'),
        totalTransferQty: parseFloat(stockTransferData?.totalTransferQty || 0),
        totalTransferAmount: parseFloat(stockTransferData?.totalTransferAmt || 0),
        // averageTransferQty: parseFloat(stockTransferData?.averageTransferQty || 0),
        // averageTransferAmount: parseFloat(stockTransferData?.averageTransferAmt || 0),
        // averageUnitPrice: parseFloat(stockTransferData?.averageUnitPrice || 0),
        // averageTransferPerLocation: parseInt(stockTransferData?.uniqueFromLocationCount || '0') > 0 
        //   ? parseInt(stockTransferData?.totalTransferCount || '0') / parseInt(stockTransferData?.uniqueFromLocationCount || '0')
        //   : 0,
        // averageQtyPerTransfer: parseInt(stockTransferData?.totalTransferCount || '0') > 0 
        //   ? parseFloat(stockTransferData?.totalTransferQty || 0) / parseInt(stockTransferData?.totalTransferCount || '0')
        //   : 0,
        // averageAmountPerTransfer: parseInt(stockTransferData?.totalTransferCount || '0') > 0 
        //   ? parseFloat(stockTransferData?.totalTransferAmt || 0) / parseInt(stockTransferData?.totalTransferCount || '0')
        //   : 0,
        // transferToSalesRatio: parseInt(salesData?.totalSalesCount || '0') > 0 
        //   ? (parseInt(stockTransferData?.totalTransferCount || '0') / parseInt(salesData?.totalSalesCount || '0') * 100).toFixed(2)
        //   : 0,
        // transferAmountToSalesRatio: parseFloat(salesData?.totalSalesAmt || 0) > 0 
        //   ? (parseFloat(stockTransferData?.totalTransferAmt || 0) / parseFloat(salesData?.totalSalesAmt || 0) * 100).toFixed(2)
        //   : 0,
        // transferToPurchaseRatio: parseInt(grnData?.totalGrnCount || '0') > 0 
        //   ? (parseInt(stockTransferData?.totalTransferCount || '0') / parseInt(grnData?.totalGrnCount || '0') * 100).toFixed(2)
        //   : 0,
        // transferAmountToPurchaseRatio: parseFloat(grnData?.totalPurchaseAmt || 0) > 0 
        //   ? (parseFloat(stockTransferData?.totalTransferAmt || 0) / parseFloat(grnData?.totalPurchaseAmt || 0) * 100).toFixed(2)
        //   : 0,
        // locationDistributionEfficiency: parseInt(stockTransferData?.uniqueFromLocationCount || '0') > 0 && parseInt(stockTransferData?.uniqueToLocationCount || '0') > 0
        //   ? (parseInt(stockTransferData?.uniqueToLocationCount || '0') / parseInt(stockTransferData?.uniqueFromLocationCount || '0')).toFixed(2)
        //   : 0,
      },

      
    
    };

  }


async getlocationcompanywisestock(
  queryOptions: PaginationOptions,
  company?: string,
  location?: string,
  search?: string
) {

  const qb = this.inventoryStockRepository
    .createQueryBuilder('stock')
    .leftJoin('stock.company', 'company')
    .leftJoin('stock.location', 'location')
    .leftJoin('stock.product', 'product')

    .select([
      'product.id AS productid',
      'product.name AS productname',
    ])

    // ✅ Aggregations - sum across all companies and locations
    .addSelect('COALESCE(SUM(stock."inwardQty"), 0)', 'inwardqty')
    .addSelect('COALESCE(SUM(stock."inwardAmt"), 0)', 'inwardamt')
    .addSelect('COALESCE(SUM(stock."dumpQty"), 0)', 'dumpqty')
    .addSelect('COALESCE(SUM(stock."dumpAmt"), 0)', 'dumpamt')

    // ✅ Group only by product to get unique products
    .groupBy('product.id')
    .addGroupBy('product.name');

  // ✅ Filters
  if (company) {
    qb.andWhere('company.id = :company', { company });
  }

  if (location) {
    qb.andWhere('location.id = :location', { location });
  }

  // ✅ Search filter - search across product, company, and location names
  if (search) {
    qb.andWhere(
      '(LOWER(product.name) LIKE LOWER(:search) OR LOWER(company.name) LIKE LOWER(:search) OR LOWER(location.name) LIKE LOWER(:search))',
      { search: `%${search}%` }
    );
  }

  // 🔎 Debug SQL
  console.log('🔍 SQL Query:', qb.getSql());
  console.log('🔍 Parameters:', qb.getParameters());

  // ✅ Pagination Setup
  const page = queryOptions.page || 1;
  const limit = queryOptions.limit || 10;
  const skip = (page - 1) * limit;

  // ✅ Get total count - count distinct products
  const countQb = this.inventoryStockRepository
    .createQueryBuilder('stock')
    .leftJoin('stock.company', 'company')
    .leftJoin('stock.location', 'location')
    .leftJoin('stock.product', 'product')
    .select('COUNT(DISTINCT product.id)', 'total');

  if (company) countQb.andWhere('company.id = :company', { company });
  if (location) countQb.andWhere('location.id = :location', { location });

  // ✅ Apply search filter to count query as well
  if (search) {
    countQb.andWhere(
      '(LOWER(product.name) LIKE LOWER(:search) OR LOWER(company.name) LIKE LOWER(:search) OR LOWER(location.name) LIKE LOWER(:search))',
      { search: `%${search}%` }
    );
  }

  const totalResult = await countQb.getRawOne();
  const totalCount = Number(totalResult?.total || 0);

  // ✅ Apply pagination to main query
  qb.offset(skip).limit(limit);

  const data = await qb.getRawMany();

  console.log('🔍 Sample Raw:', data[0]);

  // ✅ Mapping Result
  const mappedData = data.map(r => ({
    id: r.productid,
    product: r.productname,
    inwardQty: Number(r.inwardqty || 0),
    inwardAmt: Number(r.inwardamt || 0),
    dumpQty: Number(r.dumpqty || 0),
    dumpAmt: Number(r.dumpamt || 0),

  }));

  return {
    data: mappedData,
    meta: {
      total: totalCount,
      page,
      pages: Math.ceil(totalCount / limit),
      limit,
    },
  };
}




 async getlocationcompanyproductwisestock(
  queryOptions: PaginationOptions,
  company?: string,
  location?: string,
  product?: string
) {
  // When product is provided, use aggregation to get unique product-variant combinations
  if (product) {
    const qb = this.inventoryStockRepository
      .createQueryBuilder('stock')
      .leftJoin('stock.company', 'company')
      .leftJoin('stock.location', 'location')
      .leftJoin('stock.product', 'product')
      .leftJoin('stock.variant', 'variant')
      .select([
        'product.id AS productid',
        'product.name AS productname',
        'variant.id AS variantid',
        'variant.variantName AS variantname',
      ])
      .addSelect('COALESCE(SUM(stock."inwardQty"), 0)', 'inwardqty')
      .addSelect('COALESCE(SUM(stock."inwardAmt"), 0)', 'inwardamt')
      .addSelect('COALESCE(SUM(stock."dumpQty"), 0)', 'dumpqty')
      .addSelect('COALESCE(SUM(stock."dumpAmt"), 0)', 'dumpamt')
      .where('product.id = :product', { product })
      .groupBy('product.id')
      .addGroupBy('product.name')
      .addGroupBy('variant.id')
      .addGroupBy('variant.variantName')
      // OFFSET/LIMIT without an ORDER BY leaves row order undefined, so pages
      // could repeat or skip variants. Un-varianted stock sorts last.
      .orderBy('variant."variantName"', 'ASC', 'NULLS LAST')
      .addOrderBy('variant.id', 'ASC', 'NULLS LAST');

    // Apply additional filters
    if (company) {
      qb.andWhere('company.id = :company', { company });
    }

    if (location) {
      qb.andWhere('location.id = :location', { location });
    }

    // Pagination
    const page = queryOptions.page || 1;
    const limit = queryOptions.limit || 10;
    const skip = (page - 1) * limit;

    // Count query
    const countQb = this.inventoryStockRepository
      .createQueryBuilder('stock')
      .leftJoin('stock.company', 'company')
      .leftJoin('stock.location', 'location')
      .leftJoin('stock.product', 'product')
      .leftJoin('stock.variant', 'variant')
      .select('COUNT(DISTINCT(product.id, variant.id))', 'total')
      .where('product.id = :product', { product });

    if (company) countQb.andWhere('company.id = :company', { company });
    if (location) countQb.andWhere('location.id = :location', { location });

    const totalResult = await countQb.getRawOne();
    const totalCount = Number(totalResult?.total || 0);

    // Apply pagination
    qb.offset(skip).limit(limit);

    const data = await qb.getRawMany();

    // A stock row with no variant is a real bucket (e.g. a dump booked against
    // the product without picking a variant), so it is reported rather than
    // hidden — but it is labelled instead of coming back as a bare null.
    // For the no-variant row, use productId as the id so the frontend always
    // gets a non-null, stable unique key per row.
    const mappedData = data.map((r: any) => ({
      id: r.variantid ?? r.productid ?? null,
      variant: r.variantname ?? 'No Variant',
      inwardQty: Number(r.inwardqty || 0),
      inwardAmt: Number(r.inwardamt || 0),
      dumpQty: Number(r.dumpqty || 0),
      dumpAmt: Number(r.dumpamt || 0),
    }));

    return {
      data: mappedData,
      meta: {
        total: totalCount,
        page,
        pages: Math.ceil(totalCount / limit),
        limit,
      },
    };
  }

  // Original logic when no product is provided
  const queryBuilder = this.inventoryStockRepository
    .createQueryBuilder('stock')
    .leftJoinAndSelect('stock.company', 'company')
    .leftJoinAndSelect('stock.location', 'location')
    .leftJoinAndSelect('stock.product', 'product')
    .leftJoinAndSelect('stock.variant', 'variant');

  if (company) {
    queryBuilder.andWhere('company.id = :company', { company });
  }

  if (location) {
    queryBuilder.andWhere('location.id = :location', { location });
  }

  const page = queryOptions.page;
  const limit = queryOptions.limit;
  const isPaginationRequested = page && limit;

  let data;
  let totalCount;

  if (isPaginationRequested) {
    const skip = (page - 1) * limit;

    const totalQuery = queryBuilder.clone();
    totalCount = await totalQuery.getCount();

    queryBuilder.skip(skip).take(limit);
    data = await queryBuilder.getMany();
  } else {
    data = await queryBuilder.getMany();
    totalCount = data.length;
  }

  const mappedData = data.map((item: any) => ({
    id: item.id,
    company: item.company?.name,
    location: item.location?.name,
    product: item.product?.name,
    variant: item.variant?.variantName,
    inwardQty: item.inwardQty || 0,
    inwardAmt: item.inwardAmt || 0,
    dumpQty: item.dumpQty || 0,
    dumpAmt: item.dumpAmt || 0,
  }));

  return {
    data: mappedData,
    meta: {
      total: totalCount,
      page: page || 1,
      pages: isPaginationRequested ? Math.ceil(totalCount / limit) : 1,
      limit: limit || totalCount,
    },
  };
}

}



  // //-----------------------------------------------------------------------
  // // ✔ Get Variant Grouped Inventory Stock
  // //-----------------------------------------------------------------------
  // async getVariantGroupedInventoryStock(locationName?: string, companyName?: string, productName?: string) {
  //   const query = this.inventoryStockRepository
  //     .createQueryBuilder('stock')
  //     .leftJoin('stock.company', 'company')
  //     .leftJoin('stock.location', 'location')
  //     .leftJoin('stock.product', 'product')
  //     .leftJoin('stock.variant', 'variant')
  //     .select([
  //       'company.name AS companyName',
  //       'location.name AS locationName',
  //       'product.name AS productName',
  //       'variant.variantName AS variantName',
  //     ])
  //     .addSelect('SUM(stock.inwardQty)', 'inwardQty')
  //     .addSelect('SUM(stock.inwardAmt)', 'inwardAmt')
  //     .groupBy('company.name')
  //     .addGroupBy('location.name')
  //     .addGroupBy('product.name')
  //     .addGroupBy('variant.variantName');

  //   if (locationName)
  //     query.andWhere('location.name ILIKE :loc', { loc: `%${locationName}%` });

  //   if (companyName)
  //     query.andWhere('company.name ILIKE :com', { com: `%${companyName}%` });

  //   if (productName)
  //     query.andWhere('product.name ILIKE :prod', { prod: `%${productName}%` });

  //   const stock = await query.getRawMany();

  //   if (!stock.length) throw new Error("Stock not found");

  //   return stock;
  // }


  // //-----------------------------------------------------------------------
  // // ✔ Get Stock Grouped by Location/Company/Product
  // //-----------------------------------------------------------------------
  // async getProductGroupedInventoryStock(locationName?: string, companyName?: string) {
  //   const query = this.inventoryStockRepository
  //     .createQueryBuilder('stock')
  //     .leftJoin('stock.company', 'company')
  //     .leftJoin('stock.location', 'location')
  //     .leftJoin('stock.product', 'product')
  //     .select([
  //       'company.name AS companyName',
  //       'location.name AS locationName',
  //       'product.name AS productName',
  //     ])
  //     .addSelect('SUM(stock.inwardQty)', 'inwardQty')
  //     .addSelect('SUM(stock.inwardAmt)', 'inwardAmt')
  //     .groupBy('company.name')
  //     .addGroupBy('location.name')
  //     .addGroupBy('product.name');

  //   if (locationName)
  //     query.andWhere('location.name ILIKE :loc', { loc: `%${locationName}%` });

  //   if (companyName)
  //     query.andWhere('company.name ILIKE :com', { com: `%${companyName}%` });

  //   const stock = await query.getRawMany();

  //   if (!stock.length) throw new Error("Stock not found");

  //   return stock.map(this.formatProductInventoryStock);
  // }


  // //-----------------------------------------------------------------------
  // // ✔ Get Product by Access Location
  // //-----------------------------------------------------------------------
  // async getProductByAccessLocation(location?: string, userId?: string) {
  //   const user = await this.userRepository.findOne({
  //     where: { id: userId },
  //     relations: ['accessLocation'],
  //   });

  //   const accessLocationIds = user?.accessLocation?.map(l => l.id) || [];

  //   const query = this.inventoryStockRepository
  //     .createQueryBuilder('stock')
  //     .leftJoin('stock.company', 'company')
  //     .leftJoin('stock.location', 'location')
  //     .leftJoin('stock.product', 'product')
  //     .leftJoin('stock.variant', 'variant')
  //     .select([
  //       'company.id AS companyId',
  //       'company.name AS companyName',
  //       'location.id AS locationId',
  //       'location.name AS locationName',
  //       'product.id AS productId',
  //       'product.name AS productName',
  //       'variant.id AS variantId',
  //       'variant.variantName AS variantName',
  //     ])
  //     .addSelect('SUM(stock.inwardQty)', 'inwardQty')
  //     .addSelect('SUM(stock.inwardAmt)', 'inwardAmt')
  //     .where('location.id IN (:...accessLocationIds)', { accessLocationIds });

  //   if (location) {
  //     query.andWhere('location.id = :location', { location });
  //   }

  //   const stock = await query
  //     .groupBy('company.id')
  //     .addGroupBy('location.id')
  //     .addGroupBy('product.id')
  //     .addGroupBy('variant.id')
  //     .getRawMany();

  //   return stock;
  // }


  // //-----------------------------------------------------------------------
  // // ✔ Get Stock based on user's Access Location
  // //-----------------------------------------------------------------------
  // async getInventoryStockbyuserAccesslocation(id: string) {
  //   const user = await this.userRepository.findOne({
  //     where: { id },
  //     relations: ['accessLocation'],
  //   });

  //   const accessLocationIds = user?.accessLocation?.map(l => l.id) || [];

  //   const data = await this.inventoryStockRepository
  //     .createQueryBuilder('stock')
  //     .leftJoin('stock.company', 'company')
  //     .leftJoin('stock.location', 'location')
  //     .leftJoin('stock.product', 'product')
  //     .select([
  //       'company.id AS companyId',
  //       'company.name AS companyName',
  //       'location.id AS locationId',
  //       'location.name AS locationName',
  //     ])
  //     .addSelect('SUM(stock.inwardQty)', 'inwardQty')
  //     .addSelect('SUM(stock.inwardAmt)', 'inwardAmt')
  //     .where('location.id IN (:...accessLocationIds)', { accessLocationIds })
  //     .groupBy('company.id')
  //     .addGroupBy('location.id')
  //     .getRawMany();

  //   return data;
  // }


  // //-----------------------------------------------------------------------
  // // ✔ Get Grouped Inventory Stock (Location/Company)
  // //-----------------------------------------------------------------------
  // async getGroupedInventoryStock() {
  //   const stock = await this.inventoryStockRepository
  //     .createQueryBuilder('stock')
  //     .leftJoin('stock.company', 'company')
  //     .leftJoin('stock.location', 'location')
  //     .select([
  //       'company.id AS companyId',
  //       'company.name AS companyName',
  //       'location.id AS locationId',
  //       'location.name AS locationName',
  //     ])
  //     .addSelect('SUM(stock.inwardQty)', 'inwardQty')
  //     .addSelect('SUM(stock.inwardAmt)', 'inwardAmt')
  //     .groupBy('company.id')
  //     .addGroupBy('location.id')
  //     .getRawMany();

  //   if (!stock.length) throw new Error("Stock not found");

  //   return stock;
  // }


  // //-----------------------------------------------------------------------
  // // ✔ Filter Stock (Your main filter API)
  // //-----------------------------------------------------------------------
  // async filterStock(data: any) {
  //   console.log("Filters:", data);

  //   const qb = this.inventoryStockRepository
  //     .createQueryBuilder("inventory")
  //     .leftJoinAndSelect("inventory.location", "location")
  //     .leftJoinAndSelect("inventory.product", "product")
  //     .leftJoinAndSelect("inventory.variant", "variant")
  //     .leftJoinAndSelect("inventory.company", "company");

  //   if (data.id)
  //     qb.andWhere("inventory.id = :id", { id: data.id });

  //   if (data.location)
  //     qb.andWhere("location.id = :location", { location: data.location });

  //   if (data.product)
  //     qb.andWhere("product.id = :product", { product: data.product });

  //   if (data.companyName)
  //     qb.andWhere("company.id = :company", { company: data.companyName });

  //   if (data.varientId)
  //     qb.andWhere("variant.id = :variantId", { variantId: data.varientId });

  //   if (data.origin)
  //     qb.andWhere("LOWER(variant.origin) LIKE LOWER(:origin)", { origin: `%${data.origin}%` });

  //   if (data.size)
  //     qb.andWhere("LOWER(variant.size) LIKE LOWER(:size)", { size: `%${data.size}%` });

  //   if (data.count)
  //     qb.andWhere("LOWER(variant.count) LIKE LOWER(:count)", { count: `%${data.count}%` });

  //   if (data.variety)
  //     qb.andWhere("LOWER(variant.variety) LIKE LOWER(:variety)", { variety: `%${data.variety}%` });

  //   const stock = await qb.getMany();

  //   if (!stock.length)
  //     throw new Error("Stock not found with given filters");

  //   let totalqty = 0;
  //   let totalamount = 0;

  //   stock.forEach((s) => {
  //     s.inwardQty = Number(s.inwardQty || 0);
  //     s.inwardAmt = Number(s.inwardAmt || 0);

  //     totalqty += s.inwardQty;
  //     totalamount += s.inwardAmt;
  //   });

  //   return {
  //     stock: stock.map((s) => this.formatInventoryStock(s)),
  //     totalqty,
  //     totalamount,
  //   };
  // }


  // //-----------------------------------------------------------------------
  // // ✔ Search stock (ID + filters)
  // //-----------------------------------------------------------------------
  // async searchStock(id?: string, varientId?: string, productId?: string, locationId?: string, companyId?: string) {
  //   const qb = this.inventoryStockRepository
  //     .createQueryBuilder('inventory')
  //     .leftJoinAndSelect('inventory.location', 'location')
  //     .leftJoinAndSelect('inventory.product', 'product')
  //     .leftJoinAndSelect('inventory.variant', 'variant')
  //     .leftJoinAndSelect('inventory.company', 'company')
  //     .where('inventory.id = :id', { id });

  //   if (locationId) qb.andWhere('location.id = :locationId', { locationId });
  //   if (productId) qb.andWhere('product.id = :productId', { productId });
  //   if (companyId) qb.andWhere('company.id = :companyId', { companyId });
  //   if (varientId) qb.andWhere('variant.id = :varientId', { varientId });

  //   const stock = await qb.getOne();

  //   if (!stock) throw new Error('Stock not found with given filters');

  //   return this.formatInventoryStock(stock);
  // }


  // //-----------------------------------------------------------------------
  // // ✔ Get Stock By ID
  // //-----------------------------------------------------------------------
  // async getInventoryStockById(id: string) {
  //   const stock = await this.inventoryStockRepository.findOne({
  //     where: { id },
  //     relations: ['location', 'product', 'variant', 'company'],
  //   });

  //   if (!stock) throw new Error('Inventory Stock not found');

  //   return this.formatInventoryStock(stock);
  // }



  // //-----------------------------------------------------------------------
  // // ✔ Get All Inventory Stock
  // //-----------------------------------------------------------------------
  // async getAllInventoryStocks(queryOptions: PaginationOptions) {
  //   // First, let's check what's actually in the database with a raw query
  //   const rawData = await this.inventoryStockRepository.query(`
  //     SELECT * FROM inventory_stock LIMIT 1
  //   `);
  //   console.log('🔍 RAW DATABASE DATA:', rawData[0]);
    
  //   const qb = this.inventoryStockRepository
  //     .createQueryBuilder('inventory')
  //     .leftJoinAndSelect('inventory.location', 'location')
  //     .leftJoinAndSelect('inventory.product', 'product')
  //     .leftJoinAndSelect('inventory.variant', 'variant')
  //     .leftJoinAndSelect('inventory.company', 'company')
  //     .orderBy(
  //       'inventory.createdAt',
  //       queryOptions.sort?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  //     );

  //   // Check if pagination is requested
  //   const page = queryOptions.page;
  //   const limit = queryOptions.limit;
  //   const isPaginationRequested = page && limit;

  //   let data;
  //   let totalCount;

  //   if (isPaginationRequested) {
  //     // Apply pagination
  //     const skip = (page - 1) * limit;
      
  //     // Get total count for pagination metadata
  //     totalCount = await qb.getCount();

  //     // Apply pagination
  //     qb.skip(skip).take(limit);
  //     data = await qb.getMany();
  //   } else {
  //     // Return all results without pagination
  //     data = await qb.getMany();
  //     totalCount = data.length;
  //   }

  //   // Debug logging
  //   if (data.length > 0) {
  //     console.log('🔍 Sample stock data:', {
  //       id: data[0].id,
  //       inwardQty: data[0].inwardQty,
  //       inwardAmt: data[0].inwardAmt,
  //       rawKeys: Object.keys(data[0])
  //     });
  //   }

  //   const mappedData = data.map((s: any) => this.formatInventoryStock(s));

  //   // Debug logging for mapped data
  //   if (mappedData.length > 0) {
  //     console.log('🔍 Sample mapped data:', mappedData[0]);
  //   }

  //   return { 
  //     data: mappedData, 
  //     meta: {
  //       total: totalCount,
  //       page: page || 1,
  //       pages: isPaginationRequested ? Math.ceil(totalCount / limit) : 1,
  //       limit: limit || totalCount,
  //     }
  //   };
  // }

