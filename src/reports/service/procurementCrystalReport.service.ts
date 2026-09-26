import { injectable, inject } from 'inversify';
import { Repository } from 'typeorm';

import { GrnProduct } from '../../grn/entity/grnProduct.entity';
import { AppDataSource } from '../../utils/data-source';
import { TYPES } from '../../types';
import { format } from 'date-fns';
import { GRN } from '../../grn/entity/grn.entity';
import { DocumentbRepository } from '../../approvalFlow/repository/documentb.repository';


export interface ProcurementReportFilters {
    startDate?: Date;
    endDate?: Date;
    vendorId?: string;
    farmerId?: string;
    branchId?: string;
    companyId?: string;
    grnType?: string;
    purchaseType?: string;
    productId?: string;
    source?: string;
}

export interface ProcurementDetailedReport {
    grnNo: string;
    grnDate: string;
    grnType: string;
    purchaseType: string;
    vendorName: string;
    vendorCode: string;
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
    approvalStatus: string;
    products: ProcurementProductDetail[];
}

export interface ProcurementProductDetail {
    productName: string;
    productCode: string;
    variantName: string;
    category: string;
    subCategory: string;
    netWeight: number;  // Primary quantity field
    grossWeight: number;
    packingMaterialWeight: number;
    unitPrice: number;
    revisedRate: number;
    amount: number;
    uom: string;
    purchaseDate: string;
    deliveryDate: string;
}

export interface ProcurementSummary {
    totalGRNs: number;
    totalAmount: number;
    totalNetWeight: number;  // Based on net weight
    totalGrossWeight: number;
    averageOrderValue: number;
    averageNetWeightPerGRN: number;
    topVendorsByValue: Array<{
        vendorName: string;
        vendorCode: string;
        totalAmount: number;
        totalNetWeight: number;
        grnCount: number;
        averageOrderValue: number;
    }>;
    topProductsByNetWeight: Array<{
        productName: string;
        productCode: string;
        totalNetWeight: number;
        totalAmount: number;
        averagePrice: number;
    }>;
    monthlyTrends: Array<{
        month: string;
        totalAmount: number;
        totalNetWeight: number;
        grnCount: number;
    }>;
    purchaseTypeBreakdown: Array<{
        purchaseType: string;
        totalAmount: number;
        totalNetWeight: number;
        grnCount: number;
    }>;
}

export interface VendorWiseProcurement {
    vendorName: string;
    vendorCode: string;
    vendorContact: string;
    vendorEmail: string;
    totalGRNs: number;
    totalAmount: number;
    totalNetWeight: number;
    totalGrossWeight: number;
    averageOrderValue: number;
    averageNetWeightPerOrder: number;
    firstPurchaseDate: string;
    lastPurchaseDate: string;
}

export interface ProductWiseProcurement {
    productName: string;
    productCode: string;
    category: string;
    subCategory: string;
    variantName: string;
    uomName: string;
    totalGRNs: number;
    totalNetWeight: number;
    totalGrossWeight: number;
    totalAmount: number;
    averagePrice: number;
    minPrice: number;
    maxPrice: number;
}

@injectable()
export class ProcurementCrystalReportService {
    private grnRepository: Repository<GRN>;
    private grnProductRepository: Repository<GrnProduct>;

    constructor(@inject(TYPES.DocumentbRepository) private documentbRepository: DocumentbRepository,) {
        this.grnRepository = AppDataSource.getRepository(GRN);
        this.grnProductRepository = AppDataSource.getRepository(GrnProduct);

    }

    /**
     * Generate detailed procurement report with net weight calculations
     */
    async generateDetailedProcurementReport(
        filters: ProcurementReportFilters = {}
    ): Promise<ProcurementDetailedReport[]> {
        const queryBuilder = this.grnRepository
            .createQueryBuilder('grn')
            .leftJoinAndSelect('grn.selectedVendor', 'vendor')
            .leftJoinAndSelect('grn.selectedFarmer', 'farmer')
            .leftJoinAndSelect('grn.companyName', 'company')
            .leftJoinAndSelect('grn.location', 'branch')
            .leftJoinAndSelect('grn.purchaseLocation', 'purchaseLocation')
            .leftJoinAndSelect('grn.purchaseBy', 'purchaseBy')
            .leftJoinAndSelect('grn.createdBy', 'createdBy')
            .leftJoinAndSelect('grn.grnProducts', 'grnProducts')
            .leftJoinAndSelect('grnProducts.productName', 'product')
            .leftJoinAndSelect('product.category', 'category')
            .leftJoinAndSelect('product.subcategory', 'subcategory')
            .leftJoinAndSelect('grnProducts.variant', 'variant')
            .leftJoinAndSelect('grnProducts.uom', 'uom')
            .orderBy('grn.createdAt', 'DESC');

        this.applyFilters(queryBuilder, filters);

        const grns = await queryBuilder.getMany();
        return grns.map((grn) => this.mapGrnToDetailedReport(grn));
    }

    /**
     * Generate procurement summary with net weight focus
     */
    async generateProcurementSummary(
        filters: ProcurementReportFilters = {}
    ): Promise<ProcurementSummary> {
        const baseQuery = this.buildBaseQuery(filters);

        // Total statistics
        const totalStats = await baseQuery
            .select([
                'COUNT(DISTINCT grn.id) as totalGRNs',
                'COALESCE(SUM(grn.totalAmt), 0) as totalAmount',
                'COALESCE(SUM(grnProducts.netWeight), 0) as totalNetWeight',
                'COALESCE(SUM(grnProducts.grossWeight), 0) as totalGrossWeight',
            ])
            .getRawOne();

        // Top vendors by value
        const topVendorsByValue = await this.getTopVendorsByValue(filters);

        // Top products by net weight
        const topProductsByNetWeight = await this.getTopProductsByNetWeight(filters);

        // Monthly trends
        const monthlyTrends = await this.getMonthlyTrends(filters);

        // Purchase type breakdown
        const purchaseTypeBreakdown = await this.getPurchaseTypeBreakdown(filters);

        const totalGRNs = parseInt(totalStats.totalGRNs) || 0;
        const totalAmount = parseFloat(totalStats.totalAmount) || 0;
        const totalNetWeight = parseFloat(totalStats.totalNetWeight) || 0;

        return {
            totalGRNs,
            totalAmount,
            totalNetWeight,
            totalGrossWeight: parseFloat(totalStats.totalGrossWeight) || 0,
            averageOrderValue: totalGRNs > 0 ? totalAmount / totalGRNs : 0,
            averageNetWeightPerGRN: totalGRNs > 0 ? totalNetWeight / totalGRNs : 0,
            topVendorsByValue,
            topProductsByNetWeight,
            monthlyTrends,
            purchaseTypeBreakdown,
        };
    }

    /**
     * Generate vendor-wise procurement report
     */
    async generateVendorWiseProcurement(
        filters: ProcurementReportFilters = {}
    ): Promise<VendorWiseProcurement[]> {
        const queryBuilder = this.grnRepository
            .createQueryBuilder('grn')
            .leftJoin('grn.selectedVendor', 'vendor')
            .leftJoin('grn.grnProducts', 'grnProducts')
            .select([
                'vendor.name as vendorName',
                'vendor.vendorCode as vendorCode',
                'vendor.contactNumber as vendorContact',
                'vendor.email as vendorEmail',
                'COUNT(DISTINCT grn.id) as totalGRNs',
                'COALESCE(SUM(grn.totalAmt), 0) as totalAmount',
                'COALESCE(SUM(grnProducts.netWeight), 0) as totalNetWeight',
                'COALESCE(SUM(grnProducts.grossWeight), 0) as totalGrossWeight',
                'MIN(grn.createdAt) as firstPurchaseDate',
                'MAX(grn.createdAt) as lastPurchaseDate',
            ])
            .where('vendor.id IS NOT NULL')
            .groupBy('vendor.id, vendor.name, vendor.vendorCode, vendor.contactNumber, vendor.email')
            .orderBy('totalAmount', 'DESC');

        this.applyDateFilter(queryBuilder, filters);

        const results = await queryBuilder.getRawMany();

        return results.map((row) => {
            const totalGRNs = parseInt(row.totalGRNs) || 0;
            const totalAmount = parseFloat(row.totalAmount) || 0;
            const totalNetWeight = parseFloat(row.totalNetWeight) || 0;

            return {
                vendorName: row.vendorName || 'Unknown',
                vendorCode: row.vendorCode || 'N/A',
                vendorContact: row.vendorContact || 'N/A',
                vendorEmail: row.vendorEmail || 'N/A',
                totalGRNs,
                totalAmount,
                totalNetWeight,
                totalGrossWeight: parseFloat(row.totalGrossWeight) || 0,
                averageOrderValue: totalGRNs > 0 ? totalAmount / totalGRNs : 0,
                averageNetWeightPerOrder: totalGRNs > 0 ? totalNetWeight / totalGRNs : 0,
                firstPurchaseDate: row.firstPurchaseDate
                    ? format(new Date(row.firstPurchaseDate), 'dd-MM-yyyy')
                    : 'N/A',
                lastPurchaseDate: row.lastPurchaseDate
                    ? format(new Date(row.lastPurchaseDate), 'dd-MM-yyyy')
                    : 'N/A',
            };
        });
    }

    /**
     * Generate product-wise procurement report
     */
    async generateProductWiseProcurement(
        filters: ProcurementReportFilters = {}
    ): Promise<ProductWiseProcurement[]> {
        const queryBuilder = this.grnProductRepository
            .createQueryBuilder('grnProduct')
            .leftJoin('grnProduct.productName', 'product')
            .leftJoin('product.category', 'category')
            .leftJoin('product.subcategory', 'subcategory')
            .leftJoin('grnProduct.variant', 'variant')
            .leftJoin('grnProduct.uom', 'uom')
            .leftJoin('grnProduct.grn', 'grn')
            .select([
                'product.name as productName',
                'product.productCode as productCode',
                'category.name as category',
                'subcategory.name as subCategory',
                'variant.name as variantName',
                'uom.name as uomName',
                'COUNT(DISTINCT grn.id) as totalGRNs',
                'COALESCE(SUM(grnProduct.netWeight), 0) as totalNetWeight',
                'COALESCE(SUM(grnProduct.grossWeight), 0) as totalGrossWeight',
                'COALESCE(SUM(grnProduct.amount), 0) as totalAmount',
                'COALESCE(AVG(grnProduct.unitPrice), 0) as averagePrice',
                'COALESCE(MIN(grnProduct.unitPrice), 0) as minPrice',
                'COALESCE(MAX(grnProduct.unitPrice), 0) as maxPrice',
            ])
            .where('product.id IS NOT NULL')
            .groupBy(
                'product.id, product.name, product.productCode, category.name, subcategory.name, variant.id, variant.name, uom.id, uom.name'
            )
            .orderBy('totalNetWeight', 'DESC');

        this.applyDateFilter(queryBuilder, filters);

        const results = await queryBuilder.getRawMany();

        return results.map((row) => ({
            productName: row.productName || 'Unknown',
            productCode: row.productCode || 'N/A',
            category: row.category || 'N/A',
            subCategory: row.subCategory || 'N/A',
            variantName: row.variantName || 'N/A',
            uomName: row.uomName || 'N/A',
            totalGRNs: parseInt(row.totalGRNs) || 0,
            totalNetWeight: parseFloat(row.totalNetWeight) || 0,
            totalGrossWeight: parseFloat(row.totalGrossWeight) || 0,
            totalAmount: parseFloat(row.totalAmount) || 0,
            averagePrice: parseFloat(row.averagePrice) || 0,
            minPrice: parseFloat(row.minPrice) || 0,
            maxPrice: parseFloat(row.maxPrice) || 0,
        }));
    }

    // Helper methods
    private buildBaseQuery(filters: ProcurementReportFilters) {
        const queryBuilder = this.grnRepository
            .createQueryBuilder('grn')
            .leftJoin('grn.selectedVendor', 'vendor')
            .leftJoin('grn.grnProducts', 'grnProducts')
            .leftJoin('grnProducts.productName', 'product');

        this.applyFilters(queryBuilder, filters);
        return queryBuilder;
    }

    private applyFilters(queryBuilder: any, filters: ProcurementReportFilters) {
        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('grn.createdAt BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        if (filters.vendorId) {
            queryBuilder.andWhere('vendor.id = :vendorId', { vendorId: filters.vendorId });
        }

        if (filters.farmerId) {
            queryBuilder.andWhere('grn.selectedFarmer = :farmerId', { farmerId: filters.farmerId });
        }

        if (filters.branchId) {
            queryBuilder.andWhere('grn.location = :branchId', { branchId: filters.branchId });
        }

        if (filters.companyId) {
            queryBuilder.andWhere('grn.companyName = :companyId', { companyId: filters.companyId });
        }

        if (filters.grnType) {
            queryBuilder.andWhere('grn.grnType = :grnType', { grnType: filters.grnType });
        }

        if (filters.purchaseType) {
            queryBuilder.andWhere('grn.purchaseType = :purchaseType', {
                purchaseType: filters.purchaseType,
            });
        }

        if (filters.source) {
            queryBuilder.andWhere('grn.source = :source', { source: filters.source });
        }

        if (filters.productId) {
            queryBuilder.andWhere('product.id = :productId', { productId: filters.productId });
        }
    }

    private applyDateFilter(queryBuilder: any, filters: ProcurementReportFilters) {
        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('grn.createdAt BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }
    }

    private async getTopVendorsByValue(filters: ProcurementReportFilters) {
        const queryBuilder = this.grnRepository
            .createQueryBuilder('grn')
            .leftJoin('grn.selectedVendor', 'vendor')
            .leftJoin('grn.grnProducts', 'grnProducts')
            .select([
                'vendor.name as vendorName',
                'vendor.vendorCode as vendorCode',
                'COALESCE(SUM(grn.totalAmt), 0) as totalAmount',
                'COALESCE(SUM(grnProducts.netWeight), 0) as totalNetWeight',
                'COUNT(DISTINCT grn.id) as grnCount',
            ])
            .where('vendor.id IS NOT NULL')
            .groupBy('vendor.id, vendor.name, vendor.vendorCode')
            .orderBy('totalAmount', 'DESC')
            .limit(10);

        this.applyDateFilter(queryBuilder, filters);

        const results = await queryBuilder.getRawMany();

        return results.map((row) => {
            const grnCount = parseInt(row.grnCount) || 0;
            const totalAmount = parseFloat(row.totalAmount) || 0;

            return {
                vendorName: row.vendorName || 'Unknown',
                vendorCode: row.vendorCode || 'N/A',
                totalAmount,
                totalNetWeight: parseFloat(row.totalNetWeight) || 0,
                grnCount,
                averageOrderValue: grnCount > 0 ? totalAmount / grnCount : 0,
            };
        });
    }

    private async getTopProductsByNetWeight(filters: ProcurementReportFilters) {
        const queryBuilder = this.grnProductRepository
            .createQueryBuilder('grnProduct')
            .leftJoin('grnProduct.productName', 'product')
            .leftJoin('grnProduct.grn', 'grn')
            .select([
                'product.name as productName',
                'product.productCode as productCode',
                'COALESCE(SUM(grnProduct.netWeight), 0) as totalNetWeight',
                'COALESCE(SUM(grnProduct.amount), 0) as totalAmount',
                'COALESCE(AVG(grnProduct.unitPrice), 0) as averagePrice',
            ])
            .where('product.id IS NOT NULL')
            .groupBy('product.id, product.name, product.productCode')
            .orderBy('totalNetWeight', 'DESC')
            .limit(10);

        this.applyDateFilter(queryBuilder, filters);

        const results = await queryBuilder.getRawMany();

        return results.map((row) => ({
            productName: row.productName || 'Unknown',
            productCode: row.productCode || 'N/A',
            totalNetWeight: parseFloat(row.totalNetWeight) || 0,
            totalAmount: parseFloat(row.totalAmount) || 0,
            averagePrice: parseFloat(row.averagePrice) || 0,
        }));
    }

    private async getMonthlyTrends(filters: ProcurementReportFilters) {
        const queryBuilder = this.grnRepository
            .createQueryBuilder('grn')
            .leftJoin('grn.grnProducts', 'grnProducts')
            .select([
                "TO_CHAR(grn.createdAt, 'YYYY-MM') as month",
                'COALESCE(SUM(grn.totalAmt), 0) as totalAmount',
                'COALESCE(SUM(grnProducts.netWeight), 0) as totalNetWeight',
                'COUNT(DISTINCT grn.id) as grnCount',
            ])
            .where('grn.createdAt >= :startDate', {
                startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
            })
            .groupBy("TO_CHAR(grn.createdAt, 'YYYY-MM')")
            .orderBy('month', 'ASC');

        const results = await queryBuilder.getRawMany();

        return results.map((row) => ({
            month: row.month,
            totalAmount: parseFloat(row.totalAmount) || 0,
            totalNetWeight: parseFloat(row.totalNetWeight) || 0,
            grnCount: parseInt(row.grnCount) || 0,
        }));
    }

    private async getPurchaseTypeBreakdown(filters: ProcurementReportFilters) {
        const queryBuilder = this.grnRepository
            .createQueryBuilder('grn')
            .leftJoin('grn.grnProducts', 'grnProducts')

            .select([
                'grn.purchaseType as purchaseType',
                'COALESCE(SUM(grn.totalAmt), 0) as totalAmount',
                'COALESCE(SUM(grnProducts.netWeight), 0) as totalNetWeight',
                'COUNT(DISTINCT grn.id) as grnCount',
            ])
            .where('grn.purchaseType IS NOT NULL')
            .groupBy('grn.purchaseType')
            .orderBy('totalAmount', 'DESC');

        this.applyDateFilter(queryBuilder, filters);

        const results = await queryBuilder.getRawMany();

        return results.map((row) => ({
            purchaseType: row.purchaseType || 'Unknown',
            totalAmount: parseFloat(row.totalAmount) || 0,
            totalNetWeight: parseFloat(row.totalNetWeight) || 0,
            grnCount: parseInt(row.grnCount) || 0,
        }));
    }


    private mapGrnToDetailedReport(grn: GRN): ProcurementDetailedReport {
        return {
            grnNo: grn.grnNo || '',
            grnDate: grn.createdAt ? format(new Date(grn.createdAt), 'dd-MM-yyyy HH:mm') : '',
            grnType: grn.grnType || '',
            purchaseType: grn.purchaseType || '',
            vendorName: grn.selectedVendor?.companyName || '',
            vendorCode: grn.selectedVendor?.vendorCode || '',
            farmerName: grn.selectedFarmer?.farmerfName
                ? `${grn.selectedFarmer.farmerfName} ${grn.selectedFarmer.farmerlName || ''}`.trim()
                : '',
            companyName: grn.companyName?.name || '',
            branchName: grn.location?.name || '',
            purchaseLocation: grn.purchaseLocation?.name || grn.otherPurchaseLoc || '',
            billNo: grn.billNo || '',
            vehicleNo: grn.vehicleNo || '',
            totalAmount: grn.totalAmt || 0,
            subTotalAmount: grn.subTotalAmt || 0,
            freight: grn.freight || 0,
            otherCharges: grn.otherCharges || 0,
            purchasedBy:
                grn.purchaseBy
                    ? `${grn.purchaseBy.firstName || ''} ${grn.purchaseBy.lastName || ''}`.trim()
                    : '',
            createdBy:
                grn.createdBy
                    ? `${grn.createdBy.firstName || ''} ${grn.createdBy.lastName || ''}`.trim()
                    : '',
            source: grn.source || '',
            approvalStatus: 'Pending',
            products:
                grn.grnProducts?.map((product) => ({
                    productName: product.productName?.name || '',
                    productCode: product.productName?.productCode || '',
                    variantName: product.variant?.variantName || '',
                    category: product.productName?.category?.name || '',
                    subCategory: product.productName?.subcategory?.name || '',
                    netWeight: product.netWeight || 0, // Primary quantity
                    grossWeight: product.grossWeight || 0,
                    packingMaterialWeight: product.packingMaterialWeight || 0,
                    unitPrice: product.unitPrice || 0,
                    revisedRate: product.revisedRate || 0,
                    amount: product.amount || 0,
                    uom: product.uom?.unit || '',
                    purchaseDate: product.purchaseDate
                        ? format(new Date(product.purchaseDate), 'dd-MM-yyyy')
                        : '',
                    deliveryDate: product.deliveryDate
                        ? format(new Date(product.deliveryDate), 'dd-MM-yyyy')
                        : '',
                })) || [],
        };
    }
}
