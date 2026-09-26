import { injectable, inject } from 'inversify';
import { Repository, Between, Like, In } from 'typeorm';

import { GrnProduct } from '../../grn/entity/grnProduct.entity';
import { AppDataSource } from '../../utils/data-source';
import { TYPES } from '../../types';

import { format } from 'date-fns';
import { GRN } from '../../grn/entity/grn.entity';
import { QueryOptimizerService } from '../../global/queryOptimizer.service';

export interface ProcurementReportFilters {
  startDate?: Date;
  endDate?: Date;
  vendorId?: string;
  farmerId?: string;
  branchId?: string;
  companyId?: string;
  grnType?: string;
  purchaseType?: string;
  approvalStatus?: string;
  productId?: string;
  source?: string;
}

export interface ProcurementReportData {
  grnNo: string;
  grnDate: string;
  grnType: string;
  purchaseType: string;
  vendorName: string;
  farmerName: string;
  companyName: string;
  branchName: string;
  purchaseLocation: string;
  billNo: string;
  vehicleNo: string;
  totalAmount: number;
  subTotalAmount: number;
  freight: number;
  otherCharges: number;
  purchasedBy: string;
  createdBy: string;
  source: string;
  products: ProcurementProductData[];
}

export interface ProcurementProductData {
  productName: string;
  variantName: string;
  quantity: number;
  revisedQuantity: number;
  unitPrice: number;
  revisedRate: number;
  amount: number;
  uom: string;
  grossWeight: number;
  netWeight: number;
  packingMaterialWeight: number;
  purchaseDate: string;
  deliveryDate: string;
}

export interface ProcurementSummaryData {
  totalGRNs: number;
  totalAmount: number;
  totalQuantity: number;
  averageOrderValue: number;
  topVendors: Array<{ name: string; totalAmount: number; grnCount: number }>;
  topProducts: Array<{ name: string; totalQuantity: number; totalAmount: number }>;
  monthlyTrends: Array<{ month: string; totalAmount: number; grnCount: number }>;
}

@injectable()
export class CrystalReportService {
  private grnRepository: Repository<GRN>;
  private grnProductRepository: Repository<GrnProduct>;

  constructor(
    @inject(TYPES.QueryOptimizerService) private queryOptimizer: QueryOptimizerService
  ) {
    this.grnRepository = AppDataSource.getRepository(GRN);
    this.grnProductRepository = AppDataSource.getRepository(GrnProduct);
  }

  /**
   * Generate detailed procurement report based on GRN data
   */
  async generateProcurementReport(filters: ProcurementReportFilters = {}): Promise<ProcurementReportData[]> {
    const queryBuilder = this.grnRepository.createQueryBuilder('grn')
      .leftJoinAndSelect('grn.selectedVendor', 'vendor')
      .leftJoinAndSelect('grn.selectedFarmer', 'farmer')
      .leftJoinAndSelect('grn.companyName', 'company')
      .leftJoinAndSelect('grn.location', 'branch')
      .leftJoinAndSelect('grn.purchaseLocation', 'purchaseLocation')
      .leftJoinAndSelect('grn.purchaseBy', 'purchaseBy')
      .leftJoinAndSelect('grn.createdBy', 'createdBy')
      .leftJoinAndSelect('grn.grnProducts', 'grnProducts')
      .leftJoinAndSelect('grnProducts.productName', 'product')
      .leftJoinAndSelect('grnProducts.variant', 'variant')
      .leftJoinAndSelect('grnProducts.uom', 'uom')
      .orderBy('grn.createdAt', 'DESC');

    // Apply filters
    if (filters.startDate && filters.endDate) {
      queryBuilder.andWhere('grn.createdAt BETWEEN :startDate AND :endDate', {
        startDate: filters.startDate,
        endDate: filters.endDate
      });
    }

    if (filters.vendorId) {
      queryBuilder.andWhere('vendor.id = :vendorId', { vendorId: filters.vendorId });
    }

    if (filters.farmerId) {
      queryBuilder.andWhere('farmer.id = :farmerId', { farmerId: filters.farmerId });
    }

    if (filters.branchId) {
      queryBuilder.andWhere('branch.id = :branchId', { branchId: filters.branchId });
    }

    if (filters.companyId) {
      queryBuilder.andWhere('company.id = :companyId', { companyId: filters.companyId });
    }

    if (filters.grnType) {
      queryBuilder.andWhere('grn.grnType = :grnType', { grnType: filters.grnType });
    }

    if (filters.purchaseType) {
      queryBuilder.andWhere('grn.purchaseType = :purchaseType', { purchaseType: filters.purchaseType });
    }

    if (filters.source) {
      queryBuilder.andWhere('grn.source = :source', { source: filters.source });
    }

    if (filters.productId) {
      queryBuilder.andWhere('product.id = :productId', { productId: filters.productId });
    }

    const grns = await queryBuilder.getMany();

    return grns.map(grn => this.mapGrnToReportData(grn));
  }

  /**
   * Generate procurement summary report
   */
  async generateProcurementSummary(filters: ProcurementReportFilters = {}): Promise<ProcurementSummaryData> {
    const baseQuery = this.grnRepository.createQueryBuilder('grn')
      .leftJoin('grn.selectedVendor', 'vendor')
      .leftJoin('grn.grnProducts', 'grnProducts')
      .leftJoin('grnProducts.productName', 'product');

    // Apply date filter if provided
    if (filters.startDate && filters.endDate) {
      baseQuery.andWhere('grn.createdAt BETWEEN :startDate AND :endDate', {
        startDate: filters.startDate,
        endDate: filters.endDate
      });
    }

    // Total GRNs and Amount
    const totalStats = await baseQuery
      .select([
        'COUNT(grn.id) as totalGRNs',
        'COALESCE(SUM(grn.totalAmt), 0) as totalAmount',
        'COALESCE(SUM(grnProducts.quantity), 0) as totalQuantity'
      ])
      .getRawOne();

    // Top Vendors
    const topVendors = await this.grnRepository.createQueryBuilder('grn')
      .leftJoin('grn.selectedVendor', 'vendor')
      .select([
        'vendor.name as name',
        'COALESCE(SUM(grn.totalAmt), 0) as totalAmount',
        'COUNT(grn.id) as grnCount'
      ])
      .where('vendor.id IS NOT NULL')
      .groupBy('vendor.id, vendor.name')
      .orderBy('totalAmount', 'DESC')
      .limit(5)
      .getRawMany();

    // Top Products
    const topProducts = await this.grnProductRepository.createQueryBuilder('grnProduct')
      .leftJoin('grnProduct.productName', 'product')
      .leftJoin('grnProduct.grn', 'grn')
      .select([
        'product.name as name',
        'COALESCE(SUM(grnProduct.quantity), 0) as totalQuantity',
        'COALESCE(SUM(grnProduct.amount), 0) as totalAmount'
      ])
      .where('product.id IS NOT NULL')
      .groupBy('product.id, product.name')
      .orderBy('totalQuantity', 'DESC')
      .limit(5)
      .getRawMany();

    // Monthly Trends (last 12 months)
    const monthlyTrends = await this.grnRepository.createQueryBuilder('grn')
      .select([
        "TO_CHAR(grn.createdAt, 'YYYY-MM') as month",
        'COALESCE(SUM(grn.totalAmt), 0) as totalAmount',
        'COUNT(grn.id) as grnCount'
      ])
      .where('grn.createdAt >= :startDate', { 
        startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) 
      })
      .groupBy("TO_CHAR(grn.createdAt, 'YYYY-MM')")
      .orderBy('month', 'ASC')
      .getRawMany();

    return {
      totalGRNs: parseInt(totalStats.totalGRNs) || 0,
      totalAmount: parseFloat(totalStats.totalAmount) || 0,
      totalQuantity: parseFloat(totalStats.totalQuantity) || 0,
      averageOrderValue: totalStats.totalGRNs > 0 
        ? parseFloat(totalStats.totalAmount) / parseInt(totalStats.totalGRNs) 
        : 0,
      topVendors: topVendors.map(v => ({
        name: v.name || 'Unknown',
        totalAmount: parseFloat(v.totalAmount) || 0,
        grnCount: parseInt(v.grnCount) || 0
      })),
      topProducts: topProducts.map(p => ({
        name: p.name || 'Unknown',
        totalQuantity: parseFloat(p.totalQuantity) || 0,
        totalAmount: parseFloat(p.totalAmount) || 0
      })),
      monthlyTrends: monthlyTrends.map(m => ({
        month: m.month,
        totalAmount: parseFloat(m.totalAmount) || 0,
        grnCount: parseInt(m.grnCount) || 0
      }))
    };
  }

  /**
   * Generate vendor-wise procurement report
   */
  async generateVendorWiseProcurementReport(filters: ProcurementReportFilters = {}): Promise<any[]> {
    const queryBuilder = this.grnRepository.createQueryBuilder('grn')
      .leftJoin('grn.selectedVendor', 'vendor')
      .leftJoin('grn.grnProducts', 'grnProducts')
      .select([
        'vendor.name as vendorName',
        'vendor.contactNumber as vendorContact',
        'vendor.email as vendorEmail',
        'COUNT(grn.id) as totalGRNs',
        'COALESCE(SUM(grn.totalAmt), 0) as totalAmount',
        'COALESCE(SUM(grnProducts.quantity), 0) as totalQuantity',
        'COALESCE(AVG(grn.totalAmt), 0) as averageOrderValue'
      ])
      .where('vendor.id IS NOT NULL')
      .groupBy('vendor.id, vendor.name, vendor.contactNumber, vendor.email')
      .orderBy('totalAmount', 'DESC');

    if (filters.startDate && filters.endDate) {
      queryBuilder.andWhere('grn.createdAt BETWEEN :startDate AND :endDate', {
        startDate: filters.startDate,
        endDate: filters.endDate
      });
    }

    return await queryBuilder.getRawMany();
  }

  /**
   * Generate product-wise procurement report
   */
  async generateProductWiseProcurementReport(filters: ProcurementReportFilters = {}): Promise<any[]> {
    const queryBuilder = this.grnProductRepository.createQueryBuilder('grnProduct')
      .leftJoin('grnProduct.productName', 'product')
      .leftJoin('grnProduct.variant', 'variant')
      .leftJoin('grnProduct.uom', 'uom')
      .leftJoin('grnProduct.grn', 'grn')
      .select([
        'product.name as productName',
        'variant.name as variantName',
        'uom.name as uomName',
        'COUNT(DISTINCT grn.id) as totalGRNs',
        'COALESCE(SUM(grnProduct.quantity), 0) as totalQuantity',
        'COALESCE(SUM(grnProduct.amount), 0) as totalAmount',
        'COALESCE(AVG(grnProduct.unitPrice), 0) as averagePrice'
      ])
      .where('product.id IS NOT NULL')
      .groupBy('product.id, product.name, variant.id, variant.name, uom.id, uom.name')
      .orderBy('totalAmount', 'DESC');

    if (filters.startDate && filters.endDate) {
      queryBuilder.andWhere('grn.createdAt BETWEEN :startDate AND :endDate', {
        startDate: filters.startDate,
        endDate: filters.endDate
      });
    }

    return await queryBuilder.getRawMany();
  }

  private mapGrnToReportData(grn: GRN): ProcurementReportData {
    return {
      grnNo: grn.grnNo || '',
      grnDate: grn.createdAt ? format(new Date(grn.createdAt), 'dd-MM-yyyy') : '',
      grnType: grn.grnType || '',
      purchaseType: grn.purchaseType || '',
      vendorName: grn.selectedVendor?.companyName || '',
      farmerName: grn.selectedFarmer?.farmerfName|| '',
      companyName: grn.companyName?.name || '',
      branchName: grn.location?.name || '',
      purchaseLocation: grn.purchaseLocation?.name || grn.otherPurchaseLoc || '',
      billNo: grn.billNo || '',
      vehicleNo: grn.vehicleNo || '',
      totalAmount: grn.totalAmt || 0,
      subTotalAmount: grn.subTotalAmt || 0,
      freight: grn.freight || 0,
      otherCharges: grn.otherCharges || 0,
      purchasedBy: grn.purchaseBy?.firstName + ' ' + grn.purchaseBy?.lastName || '',
      createdBy: grn.createdBy?.firstName + ' ' + grn.createdBy?.lastName || '',
      source: grn.source || '',
      products: grn.grnProducts?.map(product => ({
        productName: product.productName?.name || '',
        variantName: product.variant?.variantName|| '',
        quantity: product.quantity || 0,
        revisedQuantity: product.revisedQuantity || 0,
        unitPrice: product.unitPrice || 0,
        revisedRate: product.revisedRate || 0,
        amount: product.amount || 0,
        uom: product.uom?.unit || '',
        grossWeight: product.grossWeight || 0,
        netWeight: product.netWeight || 0,
        packingMaterialWeight: product.packingMaterialWeight || 0,
        purchaseDate: product.purchaseDate ? format(new Date(product.purchaseDate), 'dd-MM-yyyy') : '',
        deliveryDate: product.deliveryDate ? format(new Date(product.deliveryDate), 'dd-MM-yyyy') : '',
      })) || []
    };
  }
}