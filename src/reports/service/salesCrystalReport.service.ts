import { injectable, inject } from 'inversify';
import { Repository, Between, In } from 'typeorm';

import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { AppDataSource } from '../../utils/data-source';
import { CustomerDeliveryChallan } from '../../deliveryChallans/customerDeliveryChllan/entity/customerDeliveryChallan.entity';
import { Item } from '../../deliveryChallans/deliverychllan/entity/dItem.entity';
import { PostReturnByCustomer } from '../../returnByCustomer/entity/postReturnByCustomer.entity';
import { ReturnedProducts } from '../../returnByCustomer/entity/returnProduct.entity';

export interface SalesReportFilters {
    startDate?: Date;
    endDate?: Date;
    customerId?: string;
    productId?: string;
    productCategoryId?: string;
    productSubCategoryId?: string;
    branchId?: string;
    companyId?: string;
    fromLocationId?: string;
    toLocationId?: string;
    driverName?: string;
    vehicleNo?: string;
    approvalStatus?: string;
    challanNo?: string;
    grnNo?: string;
    poNumber?: string;

    // Custom trend grouping
    trendGroupBy?: 'day' | 'week' | 'month' | 'quarter' | 'year';

    // Numeric filters for amount
    amountEqual?: number;
    amountGreaterThan?: number;
    amountLessThan?: number;
    amountGreaterThanOrEqual?: number;
    amountLessThanOrEqual?: number;

    // Numeric filters for net weight
    netWeightEqual?: number;
    netWeightGreaterThan?: number;
    netWeightLessThan?: number;
    netWeightGreaterThanOrEqual?: number;
    netWeightLessThanOrEqual?: number;

    // Numeric filters for gross weight
    grossWeightEqual?: number;
    grossWeightGreaterThan?: number;
    grossWeightLessThan?: number;
    grossWeightGreaterThanOrEqual?: number;
    grossWeightLessThanOrEqual?: number;
}

export interface SalesDetailedReport {
    challanNo: string;
    challanDate: string;
    customerName: string;
    customerCode: string;
    customerType: string;
    companyName: string;
    fromLocation: string;
    billingAddress: string;
    deliveryAddress: string;
    poNumber: string;
    grnNo: string;
    driverName: string;
    driverContact: string;
    vehicleNo: string;
    licenseNo: string;
    totalProductAmount: number;
    totalPackagingAmount: number;
    netProductWeight: number;
    netPackagingWeight: number;
    totalAmountInWords: string;
    receiverName: string;
    rmn: string;
    approvalStatus: string;
    isReturned: boolean;
    createdBy: string;
    products: SalesProductDetail[];
}

export interface SalesProductDetail {
    productName: string;
    productCode: string;
    variantName: string;
    category: string;
    subCategory: string;
    netWeight: number;
    //grossWeight: number;
    packingMaterialWeight: number;
    unitPrice: number;
    amount: number;
    uom: string;
    //deliveryDate: string;
}

export interface SalesSummary {
    totalDeliveryChallans: number;
    totalSalesAmount: number;
    totalNetWeight: number;
    totalGrossWeight: number;
    averageOrderValue: number;
    averageNetWeightPerDC: number;

    topCustomersByValue: Array<{
        customerName: string;
        customerCode: string;
        totalAmount: number;
        totalNetWeight: number;
        dcCount: number;
        averageOrderValue: number;
    }>;

    topProductsByQuantity: Array<{
        productName: string;
        productCode: string;
        totalNetWeight: number;
        totalAmount: number;
        averagePrice: number;
    }>;

    dailyTrends: Array<{
        date: string;
        totalAmount: number;
        totalNetWeight: number;
        dcCount: number;
    }>;

    monthlyTrends: Array<{
        month: string;
        totalAmount: number;
        totalNetWeight: number;
        dcCount: number;
    }>;

    yearlyTrends: Array<{
        year: string;
        totalAmount: number;
        totalNetWeight: number;
        dcCount: number;
    }>;

    customTrends: Array<{
        period: string;
        totalAmount: number;
        totalNetWeight: number;
        dcCount: number;
        groupBy: string;
    }>;

    locationWiseBreakdown: Array<{
        locationName: string;
        totalAmount: number;
        totalNetWeight: number;
        dcCount: number;
    }>;

    driverPerformance: Array<{
        driverName: string;
        totalDeliveries: number;
        totalAmount: number;
        totalNetWeight: number;
        averageDeliveryValue: number;
    }>;
}

export interface CustomerReturnsReport {
    returnId: string;
    returnDate: string;
    customerName: string;
    customerCode: string;
    deliveryChallanNo: string;
    companyName: string;
    location: string;
    remark: string;
    totalReturnedAmount: number;
    totalReturnedNetWeight: number;
    totalReturnedGrossWeight: number;
    totalRejectedAmount: number;
    totalRejectedNetWeight: number;
    totalRejectedGrossWeight: number;
    returnedProducts: Array<{
        productName: string;
        productCode: string;
        variantName: string;
        returnedQty: number;
        returnedNetWt: number;
        returnedGrossWt: number;
        returnedPackingMaterialWt: number;
        returnedQtyAmt: number;
        rejectedQty: number;
        rejectedNetWt: number;
        rejectedGrossWt: number;
        rejectedPackingMaterialWt: number;
        rejectedQtyAmt: number;
        unitPrice: number;
        uom: string;
    }>;
}

export interface CustomerReturnsSummary {
    totalReturns: number;
    totalReturnedAmount: number;
    totalReturnedNetWeight: number;
    totalReturnedGrossWeight: number;
    totalRejectedAmount: number;
    totalRejectedNetWeight: number;
    totalRejectedGrossWeight: number;

    topCustomersByReturns: Array<{
        customerName: string;
        customerCode: string;
        totalReturns: number;
        totalReturnedAmount: number;
        totalReturnedNetWeight: number;
    }>;

    topReturnedProducts: Array<{
        productName: string;
        productCode: string;
        totalReturnedQty: number;
        totalReturnedNetWeight: number;
        totalReturnedAmount: number;
    }>;

    monthlyReturnTrends: Array<{
        month: string;
        totalReturns: number;
        totalReturnedAmount: number;
        totalReturnedNetWeight: number;
    }>;
}

@injectable()
export class SalesCrystalReportService {
    private dcRepository: Repository<CustomerDeliveryChallan>;
    private itemRepository: Repository<Item>;
    private returnRepository: Repository<PostReturnByCustomer>;
    private returnedProductsRepository: Repository<ReturnedProducts>;

    constructor() {
        this.dcRepository = AppDataSource.getRepository(CustomerDeliveryChallan);
        this.itemRepository = AppDataSource.getRepository(Item);
        this.returnRepository = AppDataSource.getRepository(PostReturnByCustomer);
        this.returnedProductsRepository = AppDataSource.getRepository(ReturnedProducts);
    }

    /**
     * Get detailed sales report with all filters
     */
    async getDetailedSalesReport(
        filters: SalesReportFilters,
        page: number = 1,
        limit: number = 50
    ): Promise<{ data: SalesDetailedReport[]; total: number; pages: number }> {
        const queryBuilder = this.dcRepository
            .createQueryBuilder('dc')
            .leftJoinAndSelect('dc.deliveryChallanProducts', 'items')
            .leftJoinAndSelect('items.productName', 'product')  // Changed from 'items.product' to 'items.productName'
            .leftJoinAndSelect('product.category', 'category')
            .leftJoinAndSelect('product.subcategory', 'subCategory')
            .leftJoinAndSelect('items.variant', 'variant')
            .leftJoinAndSelect('items.uom', 'uom')  // Added this line to load UOM
            .leftJoinAndSelect('dc.companyName', 'company')
            .leftJoinAndSelect('dc.customerName', 'customer')
            .leftJoinAndSelect('dc.fromLocation', 'fromLocation')
            .leftJoinAndSelect('dc.billingAddress', 'billingAddress')
            .leftJoinAndSelect('dc.deliveryAddress', 'deliveryAddress')
            .leftJoinAndSelect('dc.createdBy', 'creator')
            .leftJoinAndSelect('dc.grnNo', 'grn');

        // Apply filters
        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('dc.createdAt BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        if (filters.customerId) {
            queryBuilder.andWhere('dc.customerName = :customerId', {
                customerId: filters.customerId,
            });
        }

        if (filters.productId) {
            queryBuilder.andWhere('items.productName = :productId', {
                productId: filters.productId,
            });
        }

        if (filters.productCategoryId) {
            queryBuilder.andWhere('product.category = :categoryId', {
                categoryId: filters.productCategoryId,
            });
        }

        if (filters.companyId) {
            queryBuilder.andWhere('dc.companyName = :companyId', {
                companyId: filters.companyId,
            });
        }

        if (filters.driverName) {
            queryBuilder.andWhere('dc.driverName LIKE :driverName', {
                driverName: `%${filters.driverName}%`,
            });
        }

        if (filters.vehicleNo) {
            queryBuilder.andWhere('dc.vehicleNo = :vehicleNo', {
                vehicleNo: filters.vehicleNo,
            });
        }

        if (filters.approvalStatus) {
            queryBuilder.andWhere('dc.approvalStatus = :approvalStatus', {
                approvalStatus: filters.approvalStatus,
            });
        }

        if (filters.challanNo) {
            queryBuilder.andWhere('dc.challanNo LIKE :challanNo', {
                challanNo: `%${filters.challanNo}%`,
            });
        }

        if (filters.poNumber) {
            queryBuilder.andWhere('dc.poNumber LIKE :poNumber', {
                poNumber: `%${filters.poNumber}%`,
            });
        }

        // Numeric filters for amount
        if (filters.amountEqual !== undefined) {
            queryBuilder.andWhere('dc.totalProductAmount = :amountEqual', {
                amountEqual: filters.amountEqual,
            });
        }
        if (filters.amountGreaterThan !== undefined) {
            queryBuilder.andWhere('dc.totalProductAmount > :amountGreaterThan', {
                amountGreaterThan: filters.amountGreaterThan,
            });
        }
        if (filters.amountLessThan !== undefined) {
            queryBuilder.andWhere('dc.totalProductAmount < :amountLessThan', {
                amountLessThan: filters.amountLessThan,
            });
        }
        if (filters.amountGreaterThanOrEqual !== undefined) {
            queryBuilder.andWhere('dc.totalProductAmount >= :amountGreaterThanOrEqual', {
                amountGreaterThanOrEqual: filters.amountGreaterThanOrEqual,
            });
        }
        if (filters.amountLessThanOrEqual !== undefined) {
            queryBuilder.andWhere('dc.totalProductAmount <= :amountLessThanOrEqual', {
                amountLessThanOrEqual: filters.amountLessThanOrEqual,
            });
        }

        // Numeric filters for net weight
        if (filters.netWeightEqual !== undefined) {
            queryBuilder.andWhere('dc.netProductWeight = :netWeightEqual', {
                netWeightEqual: filters.netWeightEqual,
            });
        }
        if (filters.netWeightGreaterThan !== undefined) {
            queryBuilder.andWhere('dc.netProductWeight > :netWeightGreaterThan', {
                netWeightGreaterThan: filters.netWeightGreaterThan,
            });
        }
        if (filters.netWeightLessThan !== undefined) {
            queryBuilder.andWhere('dc.netProductWeight < :netWeightLessThan', {
                netWeightLessThan: filters.netWeightLessThan,
            });
        }
        if (filters.netWeightGreaterThanOrEqual !== undefined) {
            queryBuilder.andWhere('dc.netProductWeight >= :netWeightGreaterThanOrEqual', {
                netWeightGreaterThanOrEqual: filters.netWeightGreaterThanOrEqual,
            });
        }
        if (filters.netWeightLessThanOrEqual !== undefined) {
            queryBuilder.andWhere('dc.netProductWeight <= :netWeightLessThanOrEqual', {
                netWeightLessThanOrEqual: filters.netWeightLessThanOrEqual,
            });
        }

        // Numeric filters for gross weight (net + packaging)
        if (filters.grossWeightEqual !== undefined) {
            queryBuilder.andWhere('(dc.netProductWeight + dc.netPackagingMaterialWeight) = :grossWeightEqual', {
                grossWeightEqual: filters.grossWeightEqual,
            });
        }
        if (filters.grossWeightGreaterThan !== undefined) {
            queryBuilder.andWhere('(dc.netProductWeight + dc.netPackagingMaterialWeight) > :grossWeightGreaterThan', {
                grossWeightGreaterThan: filters.grossWeightGreaterThan,
            });
        }
        if (filters.grossWeightLessThan !== undefined) {
            queryBuilder.andWhere('(dc.netProductWeight + dc.netPackagingMaterialWeight) < :grossWeightLessThan', {
                grossWeightLessThan: filters.grossWeightLessThan,
            });
        }
        if (filters.grossWeightGreaterThanOrEqual !== undefined) {
            queryBuilder.andWhere('(dc.netProductWeight + dc.netPackagingMaterialWeight) >= :grossWeightGreaterThanOrEqual', {
                grossWeightGreaterThanOrEqual: filters.grossWeightGreaterThanOrEqual,
            });
        }
        if (filters.grossWeightLessThanOrEqual !== undefined) {
            queryBuilder.andWhere('(dc.netProductWeight + dc.netPackagingMaterialWeight) <= :grossWeightLessThanOrEqual', {
                grossWeightLessThanOrEqual: filters.grossWeightLessThanOrEqual,
            });
        }

        // Get total count
        const total = await queryBuilder.getCount();

        // Apply pagination
        queryBuilder
            .orderBy('dc.createdAt', 'DESC')
            .skip((page - 1) * limit)
            .take(limit);

        const deliveryChallans = await queryBuilder.getMany();

        // Transform to report format
        const reportData:SalesDetailedReport[] = deliveryChallans.map((dc) => ({
            challanNo: dc.challanNo || '',
            challanDate: format(new Date(dc.createdAt), 'yyyy-MM-dd'),
            customerName: dc.customerName?.organisationName || '',
            customerCode: dc.customerName?.customerCode || '',
            customerType: dc.customerName?.customerTypes?.name || '',  // Added optional chaining
            companyName: dc.companyName?.name || '',
            fromLocation: dc.fromLocation?.name || '',
            billingAddress: dc.billingAddress ?
                `${dc.billingAddress?.address1 || ''}, ${dc.billingAddress?.location || ''}, ${dc.billingAddress?.state || ''} ${dc.billingAddress?.pincode || ''}`.trim() : '',
            deliveryAddress: dc.deliveryAddress ?
                `${dc.deliveryAddress?.address1 || ''}, ${dc.deliveryAddress?.location || ''}, ${dc.deliveryAddress?.state || ''} ${dc.deliveryAddress?.pincode || ''}`.trim() : '',
            poNumber: dc.poNumber || '',
            grnNo: dc.grnNo?.grnNo || '',
            driverName: dc.driverName || '',
            driverContact: dc.contactNo || '',
            vehicleNo: dc.vehicleNo || '',
            licenseNo: dc.licenseNo || '',
            totalProductAmount: Number(dc.totalProductAmount) || 0,
            totalPackagingAmount: Number(dc.totalPackagingMaterialAmount) || 0,
            netProductWeight: Number(dc.netProductWeight) || 0,
            netPackagingWeight: Number(dc.netPackagingMaterialWeight) || 0,
            totalAmountInWords: dc.totalAmtInWords || '',
            receiverName: dc.receiverName || '',
            rmn: dc.rmn || '',
            approvalStatus: dc.approvalStatus || '',
            isReturned: dc.isReturned || false,
            createdBy: dc.createdBy ? `${dc.createdBy?.firstName} ${dc.createdBy?.lastName}` : '',
            products: (dc.deliveryChallanProducts || [])
                .filter(item => !!item)
                .map((item) => {
                    const product = item.productName || {};
                    const category = product.category || {};
                    const subCategory = product.subcategory || {};
                    const variant = item.variant || {};
                    const uom = item.uom || {};  // This will now work because we loaded it

                    return {
                        productName: product.name ?? '',
                        productCode: product.productCode ?? '',
                        variantName: variant.variantName ?? '',
                        category: (category as any)?.name ?? '',
                        subCategory: (subCategory as any)?.name ?? '',
                        netWeight: Number(item.netWeight) || 0,
                        packingMaterialWeight: Number(item.packingMaterialWeight) || 0,
                        unitPrice: Number(item.unitPrice) || 0,
                        amount: Number(item.amount) || 0,
                        uom: uom.abbreviation ?? '',
                    };
                }),
        }));

        return {
            data: reportData,
            total,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Get sales summary report
     */
    async getSalesSummary(filters: SalesReportFilters): Promise<SalesSummary> {
        const queryBuilder = this.dcRepository
            .createQueryBuilder('dc')
            .leftJoinAndSelect('dc.deliveryChallanProducts', 'items')
            .leftJoinAndSelect('items.productName', 'product');

        // Apply date filters
        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('dc.createdAt BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const deliveryChallans = await queryBuilder.getMany();

        // Calculate totals
        const totalDeliveryChallans = deliveryChallans.length;
        const totalSalesAmount = deliveryChallans.reduce(
            (sum, dc) => sum + (Number(dc.totalProductAmount) || 0),
            0
        );
        const totalNetWeight = deliveryChallans.reduce(
            (sum, dc) => sum + (Number(dc.netProductWeight) || 0),
            0
        );
        const totalGrossWeight = deliveryChallans.reduce(
            (sum, dc) => sum + (Number(dc.netProductWeight) || 0) + (Number(dc.netPackagingMaterialWeight) || 0),
            0
        );

        const averageOrderValue = totalDeliveryChallans > 0 ? totalSalesAmount / totalDeliveryChallans : 0;
        const averageNetWeightPerDC = totalDeliveryChallans > 0 ? totalNetWeight / totalDeliveryChallans : 0;

        // Top customers (would need customer relation)
        const topCustomersByValue = await this.getTopCustomers(filters);

        // Top products
        const topProductsByQuantity = await this.getTopProducts(filters);

        // Daily trends (last 30 days)
        const dailyTrends = await this.getDailyTrends(filters);

        // Monthly trends (last 12 months)
        const monthlyTrends = await this.getMonthlyTrends(filters);

        // Yearly trends
        const yearlyTrends = await this.getYearlyTrends(filters);

        // Custom trends based on user-specified grouping
        const customTrends = await this.getCustomTrends(filters);

        // Location-wise breakdown
        const locationWiseBreakdown = await this.getLocationBreakdown(filters);

        // Driver performance
        const driverPerformance = await this.getDriverPerformance(filters);

        return {
            totalDeliveryChallans,
            totalSalesAmount,
            totalNetWeight,
            totalGrossWeight,
            averageOrderValue,
            averageNetWeightPerDC,
            topCustomersByValue,
            topProductsByQuantity,
            dailyTrends,
            monthlyTrends,
            yearlyTrends,
            customTrends,
            locationWiseBreakdown,
            driverPerformance,
        };
    }

    /**
     * Get top customers by value
     */
    private async getTopCustomers(filters: SalesReportFilters, limit: number = 10) {
        const queryBuilder = this.dcRepository
            .createQueryBuilder('dc')
            .select('customer.organisationName', 'organisationName')
            .addSelect('customer.customerCode', 'customerCode')
            .addSelect('SUM(dc.totalProductAmount)', 'totalAmount')
            .addSelect('SUM(dc.netProductWeight)', 'totalNetWeight')
            .addSelect('COUNT(dc.id)', 'dcCount')
            .addSelect('AVG(dc.totalProductAmount)', 'averageOrderValue')
            .leftJoin('dc.customerName', 'customer')
            .groupBy('customer.id')
            .orderBy('SUM(dc.totalProductAmount)', 'DESC')
            .limit(limit);

        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('dc.createdAt BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const results = await queryBuilder.getRawMany();

        return results.map((r) => ({
            customerName: r.customerName || 'Unknown',
            customerCode: r.customerCode || '',
            totalAmount: Number(r.totalAmount) || 0,
            totalNetWeight: Number(r.totalNetWeight) || 0,
            dcCount: Number(r.dcCount) || 0,
            averageOrderValue: Number(r.averageOrderValue) || 0,
        }));
    }

    /**
     * Get top products by quantity
     */
    private async getTopProducts(filters: SalesReportFilters, limit: number = 10) {
        const queryBuilder = this.itemRepository
            .createQueryBuilder('item')
            .select('product.name', 'name')
            .addSelect('product.productCode', 'productCode')
            .addSelect('SUM(item.netWeight)', 'totalNetWeight')
            .addSelect('SUM(item.amount)', 'totalAmount')
            .addSelect('AVG(item.unitPrice)', 'averagePrice')
            .leftJoin('item.productName', 'product')
            .leftJoin('item.deliveryChallan', 'dc')
            .groupBy('product.id')
            .orderBy('SUM(item.netWeight)', 'DESC')
            .limit(limit);

        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('dc.createdAt BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const results = await queryBuilder.getRawMany();

        return results.map((r) => ({
            productName: r.name || 'Unknown',
            productCode: r.productCode || '',
            totalNetWeight: Number(r.totalNetWeight) || 0,
            totalAmount: Number(r.totalAmount) || 0,
            averagePrice: Number(r.averagePrice) || 0,
        }));
    }

    /**
     * Get daily trends (last 30 days)
     */
    private async getDailyTrends(filters: SalesReportFilters) {
        const queryBuilder = this.dcRepository
            .createQueryBuilder('dc')
            .select("TO_CHAR(dc.createdAt, 'YYYY-MM-DD')", 'date')
            .addSelect('SUM(dc.totalProductAmount)', 'totalAmount')
            .addSelect('SUM(dc.netProductWeight)', 'totalNetWeight')
            .addSelect('COUNT(dc.id)', 'dcCount')
            .groupBy('date')
            .orderBy('date', 'DESC')
            .limit(30);

        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('dc.createdAt BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const results = await queryBuilder.getRawMany();

        return results.map((r) => ({
            date: r.date,
            totalAmount: Number(r.totalAmount) || 0,
            totalNetWeight: Number(r.totalNetWeight) || 0,
            dcCount: Number(r.dcCount) || 0,
        }));
    }

    /**
     * Get monthly trends (last 12 months)
     */
    private async getMonthlyTrends(filters: SalesReportFilters) {
        const queryBuilder = this.dcRepository
            .createQueryBuilder('dc')
            .select("TO_CHAR(dc.createdAt, 'YYYY-MM')", 'month')
            .addSelect('SUM(dc.totalProductAmount)', 'totalAmount')
            .addSelect('SUM(dc.netProductWeight)', 'totalNetWeight')
            .addSelect('COUNT(dc.id)', 'dcCount')
            .groupBy('month')
            .orderBy('month', 'DESC')
            .limit(12);

        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('dc.createdAt BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const results = await queryBuilder.getRawMany();

        return results.map((r) => ({
            month: r.month,
            totalAmount: Number(r.totalAmount) || 0,
            totalNetWeight: Number(r.totalNetWeight) || 0,
            dcCount: Number(r.dcCount) || 0,
        }));
    }

    /**
     * Get yearly trends
     */
    private async getYearlyTrends(filters: SalesReportFilters) {
        const queryBuilder = this.dcRepository
            .createQueryBuilder('dc')
            .select("TO_CHAR(dc.createdAt, 'YYYY')", 'year')
            .addSelect('SUM(dc.totalProductAmount)', 'totalAmount')
            .addSelect('SUM(dc.netProductWeight)', 'totalNetWeight')
            .addSelect('COUNT(dc.id)', 'dcCount')
            .groupBy('year')
            .orderBy('year', 'DESC');

        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('dc.createdAt BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const results = await queryBuilder.getRawMany();

        return results.map((r) => ({
            year: r.year,
            totalAmount: Number(r.totalAmount) || 0,
            totalNetWeight: Number(r.totalNetWeight) || 0,
            dcCount: Number(r.dcCount) || 0,
        }));
    }

    /**
     * Get custom trends based on user-specified grouping
     */
    private async getCustomTrends(filters: SalesReportFilters) {
        const groupBy = filters.trendGroupBy || 'month';
        let dateFormat: string;
        let groupByClause: string;

        // Determine date format and grouping based on user selection
        switch (groupBy) {
            case 'day':
                dateFormat = 'YYYY-MM-DD';
                groupByClause = 'period';
                break;
            case 'week':
                // Week number with year (e.g., "2025-W02")
                dateFormat = 'IYYY-"W"IW';
                groupByClause = 'period';
                break;
            case 'month':
                dateFormat = 'YYYY-MM';
                groupByClause = 'period';
                break;
            case 'quarter':
                // Quarter with year (e.g., "2025-Q1")
                dateFormat = 'YYYY-"Q"Q';
                groupByClause = 'period';
                break;
            case 'year':
                dateFormat = 'YYYY';
                groupByClause = 'period';
                break;
            default:
                dateFormat = 'YYYY-MM';
                groupByClause = 'period';
        }

        const queryBuilder = this.dcRepository
            .createQueryBuilder('dc')
            .select(`TO_CHAR(dc.createdAt, '${dateFormat}')`, 'period')
            .addSelect('SUM(dc.totalProductAmount)', 'totalAmount')
            .addSelect('SUM(dc.netProductWeight)', 'totalNetWeight')
            .addSelect('COUNT(dc.id)', 'dcCount')
            .groupBy(groupByClause)
            .orderBy('period', 'DESC')
            .limit(100); // Limit to prevent too much data

        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('dc.createdAt BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const results = await queryBuilder.getRawMany();

        return results.map((r) => ({
            period: r.period,
            totalAmount: Number(r.totalAmount) || 0,
            totalNetWeight: Number(r.totalNetWeight) || 0,
            dcCount: Number(r.dcCount) || 0,
            groupBy: groupBy,
        }));
    }

    /**
     * Get location-wise breakdown
     */
    private async getLocationBreakdown(filters: SalesReportFilters) {
        const queryBuilder = this.dcRepository
            .createQueryBuilder('dc')
            .select('location.name', 'name')
            .addSelect('SUM(dc.totalProductAmount)', 'totalAmount')
            .addSelect('SUM(dc.netProductWeight)', 'totalNetWeight')
            .addSelect('COUNT(dc.id)', 'dcCount')
            .leftJoin('dc.fromLocation', 'location')
            .groupBy('location.id')
            .orderBy('SUM(dc.totalProductAmount)', 'DESC')


        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('dc.createdAt BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const results = await queryBuilder.getRawMany();

        return results.map((r) => ({
            locationName: r.name || 'Unknown',
            totalAmount: Number(r.totalAmount) || 0,
            totalNetWeight: Number(r.totalNetWeight) || 0,
            dcCount: Number(r.dcCount) || 0,
        }));
    }

    /**
     * Get driver performance
     */
    private async getDriverPerformance(filters: SalesReportFilters, limit: number = 10) {
        const queryBuilder = this.dcRepository
            .createQueryBuilder('dc')
            .select('dc.driverName', 'driverName')
            .addSelect('COUNT(dc.id)', 'totalDeliveries')
            .addSelect('SUM(dc.totalProductAmount)', 'totalAmount')
            .addSelect('SUM(dc.netProductWeight)', 'totalNetWeight')
            .addSelect('AVG(dc.totalProductAmount)', 'averageDeliveryValue')
            .where('dc.driverName IS NOT NULL')
            .groupBy('dc.driverName')
            .orderBy('SUM(dc.totalProductAmount)', 'DESC')
            .limit(limit);

        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('dc.createdAt BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const results = await queryBuilder.getRawMany();

        return results.map((r) => ({
            driverName: r.driverName || 'Unknown',
            totalDeliveries: Number(r.totalDeliveries) || 0,
            totalAmount: Number(r.totalAmount) || 0,
            totalNetWeight: Number(r.totalNetWeight) || 0,
            averageDeliveryValue: Number(r.averageDeliveryValue) || 0,
        }));
    }

    /**
     * Get customer drill-down report
     */
    async getCustomerDrillDown(customerId: string, filters: SalesReportFilters) {
        return this.getDetailedSalesReport({ ...filters, customerId }, 1, 1000);
    }

    /**
     * Get product drill-down report
     */
    async getProductDrillDown(productId: string, filters: SalesReportFilters) {
        return this.getDetailedSalesReport({ ...filters, productId }, 1, 1000);
    }

    /**
     * Get detailed customer returns report
     */
    async getCustomerReturnsReport(
        filters: SalesReportFilters,
        page: number = 1,
        limit: number = 50
    ): Promise<{ data: CustomerReturnsReport[]; total: number; pages: number }> {
        const queryBuilder = this.returnRepository
            .createQueryBuilder('return')
            .leftJoinAndSelect('return.returnedProducts', 'products')
            .leftJoinAndSelect('products.productName', 'product')
            .leftJoinAndSelect('products.variant', 'variant')
            .leftJoinAndSelect('products.saleUoM', 'uom')
            .leftJoinAndSelect('return.customerName', 'customer')
            .leftJoinAndSelect('return.deliveryChallanNo', 'dc')
            .leftJoinAndSelect('return.companyName', 'company')
            .leftJoinAndSelect('return.location', 'location');

        // Apply filters
        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('return.date BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        if (filters.customerId) {
            queryBuilder.andWhere('return.customerName = :customerId', {
                customerId: filters.customerId,
            });
        }

        if (filters.companyId) {
            queryBuilder.andWhere('return.companyName = :companyId', {
                companyId: filters.companyId,
            });
        }

        if (filters.branchId) {
            queryBuilder.andWhere('return.location = :branchId', {
                branchId: filters.branchId,
            });
        }

        // Get total count
        const total = await queryBuilder.getCount();

        // Apply pagination
        queryBuilder
            .orderBy('return.date', 'DESC')
            .skip((page - 1) * limit)
            .take(limit);

        const returns = await queryBuilder.getMany();

        // Transform to report format
        const reportData: CustomerReturnsReport[] = returns.map((ret) => {
            const returnedProducts = (ret.returnedProducts || []).map((prod) => ({
                productName: prod.productName?.name || '',
                productCode: prod.productName?.productCode || '',
                variantName: prod.variant?.variantName || '',
                returnedQty: Number(prod.returnedQty) || 0,
                returnedNetWt: Number(prod.returnedNetWt) || 0,
                returnedGrossWt: Number(prod.returnedGrossWt) || 0,
                returnedPackingMaterialWt: Number(prod.returnedPackingMaterialWt) || 0,
                returnedQtyAmt: Number(prod.returnedQtyAmt) || 0,
                rejectedQty: Number(prod.rejectedQty) || 0,
                rejectedNetWt: Number(prod.rejectedNetWt) || 0,
                rejectedGrossWt: Number(prod.rejectedGrossWt) || 0,
                rejectedPackingMaterialWt: Number(prod.rejectedPackingMaterialWt) || 0,
                rejectedQtyAmt: Number(prod.rejectedQtyAmt) || 0,
                unitPrice: Number(prod.unitPrice) || 0,
                uom: prod.saleUoM?.abbreviation || '',
            }));

            const totalReturnedAmount = returnedProducts.reduce((sum, p) => sum + p.returnedQtyAmt, 0);
            const totalReturnedNetWeight = returnedProducts.reduce((sum, p) => sum + p.returnedNetWt, 0);
            const totalReturnedGrossWeight = returnedProducts.reduce((sum, p) => sum + p.returnedGrossWt, 0);
            const totalRejectedAmount = returnedProducts.reduce((sum, p) => sum + p.rejectedQtyAmt, 0);
            const totalRejectedNetWeight = returnedProducts.reduce((sum, p) => sum + p.rejectedNetWt, 0);
            const totalRejectedGrossWeight = returnedProducts.reduce((sum, p) => sum + p.rejectedGrossWt, 0);

            return {
                returnId: ret.id,
                returnDate: ret.date ? format(new Date(ret.date), 'yyyy-MM-dd') : '',
                customerName: ret.customerName?.organisationName || '',
                customerCode: ret.customerName?.customerCode || '',
                deliveryChallanNo: ret.deliveryChallanNo?.challanNo || '',
                companyName: ret.companyName?.name || '',
                location: ret.location?.name || '',
                remark: ret.remark || '',
                totalReturnedAmount,
                totalReturnedNetWeight,
                totalReturnedGrossWeight,
                totalRejectedAmount,
                totalRejectedNetWeight,
                totalRejectedGrossWeight,
                returnedProducts,
            };
        });

        return {
            data: reportData,
            total,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Get customer returns summary
     */
    async getCustomerReturnsSummary(filters: SalesReportFilters): Promise<CustomerReturnsSummary> {
        const queryBuilder = this.returnRepository
            .createQueryBuilder('return')
            .leftJoinAndSelect('return.returnedProducts', 'products')
            .leftJoinAndSelect('return.customerName', 'customer');

        // Apply date filters
        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('return.date BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const returns = await queryBuilder.getMany();

        // Calculate totals
        const totalReturns = returns.length;
        let totalReturnedAmount = 0;
        let totalReturnedNetWeight = 0;
        let totalReturnedGrossWeight = 0;
        let totalRejectedAmount = 0;
        let totalRejectedNetWeight = 0;
        let totalRejectedGrossWeight = 0;

        returns.forEach((ret) => {
            ret.returnedProducts?.forEach((prod) => {
                totalReturnedAmount += Number(prod.returnedQtyAmt) || 0;
                totalReturnedNetWeight += Number(prod.returnedNetWt) || 0;
                totalReturnedGrossWeight += Number(prod.returnedGrossWt) || 0;
                totalRejectedAmount += Number(prod.rejectedQtyAmt) || 0;
                totalRejectedNetWeight += Number(prod.rejectedNetWt) || 0;
                totalRejectedGrossWeight += Number(prod.rejectedGrossWt) || 0;
            });
        });

        // Top customers by returns
        const topCustomersByReturns = await this.getTopCustomersByReturns(filters);

        // Top returned products
        const topReturnedProducts = await this.getTopReturnedProducts(filters);

        // Monthly return trends
        const monthlyReturnTrends = await this.getMonthlyReturnTrends(filters);

        return {
            totalReturns,
            totalReturnedAmount,
            totalReturnedNetWeight,
            totalReturnedGrossWeight,
            totalRejectedAmount,
            totalRejectedNetWeight,
            totalRejectedGrossWeight,
            topCustomersByReturns,
            topReturnedProducts,
            monthlyReturnTrends,
        };
    }

    /**
     * Get top customers by returns
     */
    private async getTopCustomersByReturns(filters: SalesReportFilters, limit: number = 10) {
        const queryBuilder = this.returnRepository
            .createQueryBuilder('return')
            .select('customer.organisationName', 'customerName')
            .addSelect('customer.customerCode', 'customerCode')
            .addSelect('COUNT(return.id)', 'totalReturns')
            .leftJoin('return.customerName', 'customer')
            .leftJoin('return.returnedProducts', 'products')
            .addSelect('SUM(products.returnedQtyAmt)', 'totalReturnedAmount')
            .addSelect('SUM(products.returnedNetWt)', 'totalReturnedNetWeight')
            .groupBy('customer.id')
            .orderBy('totalReturns', 'DESC')
            .limit(limit);

        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('return.date BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const results = await queryBuilder.getRawMany();

        return results.map((r) => ({
            customerName: r.customerName || 'Unknown',
            customerCode: r.customerCode || '',
            totalReturns: Number(r.totalReturns) || 0,
            totalReturnedAmount: Number(r.totalReturnedAmount) || 0,
            totalReturnedNetWeight: Number(r.totalReturnedNetWeight) || 0,
        }));
    }

    /**
     * Get top returned products
     */
    private async getTopReturnedProducts(filters: SalesReportFilters, limit: number = 10) {
        const queryBuilder = this.returnedProductsRepository
            .createQueryBuilder('product')
            .select('prod.productName', 'productName')
            .addSelect('prod.productCode', 'productCode')
            .addSelect('SUM(product.returnedQty)', 'totalReturnedQty')
            .addSelect('SUM(product.returnedNetWt)', 'totalReturnedNetWeight')
            .addSelect('SUM(product.returnedQtyAmt)', 'totalReturnedAmount')
            .leftJoin('product.productName', 'prod')
            .leftJoin('product.postReturn', 'return')
            .groupBy('prod.id')
            .orderBy('totalReturnedQty', 'DESC')
            .limit(limit);

        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('return.date BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const results = await queryBuilder.getRawMany();

        return results.map((r) => ({
            productName: r.productName || 'Unknown',
            productCode: r.productCode || '',
            totalReturnedQty: Number(r.totalReturnedQty) || 0,
            totalReturnedNetWeight: Number(r.totalReturnedNetWeight) || 0,
            totalReturnedAmount: Number(r.totalReturnedAmount) || 0,
        }));
    }

    /**
     * Get monthly return trends
     */
    private async getMonthlyReturnTrends(filters: SalesReportFilters) {
        const queryBuilder = this.returnRepository
            .createQueryBuilder('return')
            .select("TO_CHAR(return.date, 'YYYY-MM')", 'month')
            .addSelect('COUNT(return.id)', 'totalReturns')
            .leftJoin('return.returnedProducts', 'products')
            .addSelect('SUM(products.returnedQtyAmt)', 'totalReturnedAmount')
            .addSelect('SUM(products.returnedNetWt)', 'totalReturnedNetWeight')
            .groupBy('month')
            .orderBy('month', 'DESC')
            .limit(12);

        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('return.date BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        }

        const results = await queryBuilder.getRawMany();

        return results.map((r) => ({
            month: r.month,
            totalReturns: Number(r.totalReturns) || 0,
            totalReturnedAmount: Number(r.totalReturnedAmount) || 0,
            totalReturnedNetWeight: Number(r.totalReturnedNetWeight) || 0,
        }));
    }
}
