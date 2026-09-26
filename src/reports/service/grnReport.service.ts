import { inject, injectable } from 'inversify';

import { In } from 'typeorm';

import { DataSource } from 'typeorm';

// ─── Filter Interface ────────────────────────────────────────────────────────

export interface IGrnReportFilters {
  startDate?: string;
  endDate?: string;
  company?: string[];
  purchaseLocation?: string[];
  purchaseForSalesLocation?: string[];
  vendor?: string[];
  farmer?: string[];
  createdBy?: string[];
  grnType?: string;
  locationType?: string;
  purchaseType?: string;
  source?: string;
  billNo?: string;
  grnNo?: string;
  requestingDepartment?: string;
  purchaseInstructionsBy?: string;
  purchaseBy?: string;
  vehicleNo?: string;
  receivedThrough?: string;
  deliveryReceivingPerson?: string;
  securityPerson?: string;
  rmn?: string;
  product?: string[];
  paymentMode?: string;
  paymentTerms?: string;
  paymentDateFrom?: string;
  paymentDateTo?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  totalQuantity?: number;
  totalQuantityOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  totalAmount?: number;
  totalAmountOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  verifiedBy?: string[];
  approvedBy?: string[];
  status?: string;
}
import { TYPES } from '../../types';
import { GrnRepository } from '../../grn/repository/grn.repository';

@injectable()
export class GrnReportService {
  constructor(
    @inject(TYPES.GrnRepository) private readonly grnRepository: GrnRepository,
    @inject(TYPES.DataSource) private readonly dataSource: DataSource
  ) {}

  public async getReport(filters: IGrnReportFilters): Promise<any> {
    const queryBuilder = this.grnRepository
      .createQueryBuilder('grn')
      .leftJoinAndSelect('grn.companyName', 'companyName')
      .leftJoinAndSelect('grn.selectedFarmer', 'selectedFarmer')
      .leftJoinAndSelect('grn.selectedVendor', 'selectedVendor')
      .leftJoinAndSelect('grn.dealSlipId', 'dealSlipId')
      .leftJoinAndSelect('grn.grnProducts', 'grnProducts')
      .leftJoinAndSelect('grnProducts.productName', 'productName')
      .leftJoinAndSelect('grnProducts.variant', 'variant')
      .leftJoinAndSelect('grnProducts.uom', 'uom')
      .leftJoinAndSelect('grn.purchaseForSalesLocation', 'purchaseForSalesLocation')
      .leftJoinAndSelect('grn.purchaseLocation', 'purchaseLocation')
      .leftJoinAndSelect('grn.purchaseBy', 'purchaseBy')
      .leftJoinAndSelect('grn.purchaseInstructionsBy', 'purchaseInstructionsBy')
      .leftJoinAndSelect('grn.paymentInfo', 'paymentInfo')
      .leftJoinAndSelect('grn.createdBy', 'createdBy')
      .leftJoin('documents', 'document', "document.document_type_id::uuid = grn.id AND document.type = 'grn'")
      .leftJoin('document.approvalInfo', 'approvalInfo')
      .leftJoin('approvalInfo.verified', 'verified')
      .leftJoin('approvalInfo.firstApproved', 'firstApproved')
      .leftJoin('approvalInfo.secondApproved', 'secondApproved')
      .leftJoin('approvalInfo.thirdApproved', 'thirdApproved')
      .addSelect('document.status', 'document_status')
      .addSelect('verified.userName', 'verified_by')
      .addSelect('firstApproved.userName', 'first_approved_by')
      .addSelect('secondApproved.userName', 'second_approved_by')
      .addSelect('thirdApproved.userName', 'third_approved_by')
      .where('grn.isDeleted = :isDeleted', { isDeleted: false });

    // Apply all filters
    this.applyFilters(queryBuilder, filters);

    queryBuilder.orderBy('grn.createdAt', 'DESC');

    const result = await queryBuilder.getRawAndEntities();

    let formattedData = this.formatGrnReport(result.entities, result.raw);

    // Apply totalQuantity filter in application layer (since it's a calculated field)
    if (filters.totalQuantity !== undefined && filters.totalQuantityOperator) {
      const operator = filters.totalQuantityOperator;
      const targetQty = filters.totalQuantity;
      
      formattedData = formattedData.filter((grn: any) => {
        const totalQty = parseFloat(grn.totalQty) || 0;
        if (operator === '>') return totalQty > targetQty;
        if (operator === '<') return totalQty < targetQty;
        if (operator === '=') return totalQty === targetQty;
        if (operator === '>=') return totalQty >= targetQty;
        if (operator === '<=') return totalQty <= targetQty;
        if (operator === '!=') return totalQty !== targetQty;
        return true;
      });
    }

    return formattedData;
  }

  private applyFilters(queryBuilder: any, filters: IGrnReportFilters): void {
    // Date range filter
    if (filters.startDate && filters.endDate) {
      queryBuilder.andWhere('grn.createdAt BETWEEN :startDate AND :endDate', {
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
    }

    // GRN entity filters
    if (filters.company && filters.company.length > 0) {
      queryBuilder.andWhere('grn.companyName IN (:...companyIds)', { companyIds: filters.company });
    }

    if (filters.purchaseLocation && filters.purchaseLocation.length > 0) {
      queryBuilder.andWhere('grn.purchaseLocation IN (:...purchaseLocationIds)', { 
        purchaseLocationIds: filters.purchaseLocation 
      });
    }

    if (filters.purchaseForSalesLocation && filters.purchaseForSalesLocation.length > 0) {
      queryBuilder.andWhere('grn.purchaseForSalesLocation IN (:...purchaseForSalesLocationIds)', { 
        purchaseForSalesLocationIds: filters.purchaseForSalesLocation 
      });
    }

    // Vendor OR Farmer filter (either one matches)
    const hasVendor = filters.vendor && filters.vendor.length > 0;
    const hasFarmer = filters.farmer && filters.farmer.length > 0;
    
    if (hasVendor && hasFarmer) {
      // Both filters applied: show GRNs that match either vendor OR farmer
      queryBuilder.andWhere(
        '(grn.selectedVendor IN (:...vendorIds) OR grn.selectedFarmer IN (:...farmerIds))',
        { vendorIds: filters.vendor, farmerIds: filters.farmer }
      );
    } else if (hasVendor) {
      // Only vendor filter applied
      queryBuilder.andWhere('grn.selectedVendor IN (:...vendorIds)', { vendorIds: filters.vendor });
    } else if (hasFarmer) {
      // Only farmer filter applied
      queryBuilder.andWhere('grn.selectedFarmer IN (:...farmerIds)', { farmerIds: filters.farmer });
    }

    if (filters.createdBy && filters.createdBy.length > 0) {
      queryBuilder.andWhere('grn.createdBy IN (:...createdByIds)', { createdByIds: filters.createdBy });
    }

    if (filters.grnType) {
      queryBuilder.andWhere('grn.grnType = :grnType', { grnType: filters.grnType });
    }

    if (filters.locationType) {
      queryBuilder.andWhere('grn.locationType = :locationType', { locationType: filters.locationType });
    }

    if (filters.purchaseType) {
      queryBuilder.andWhere('grn.purchaseType = :purchaseType', { purchaseType: filters.purchaseType });
    }

    if (filters.source) {
      queryBuilder.andWhere('grn.source = :source', { source: filters.source });
    }

    if (filters.billNo) {
      queryBuilder.andWhere('grn.billNo ILIKE :billNo', { billNo: `%${filters.billNo}%` });
    }

    if (filters.grnNo) {
      queryBuilder.andWhere('grn.grnNo ILIKE :grnNo', { grnNo: `%${filters.grnNo}%` });
    }

    if (filters.requestingDepartment) {
      queryBuilder.andWhere('grn.requestingDepartment = :requestingDepartment', {
        requestingDepartment: filters.requestingDepartment,
      });
    }

    if (filters.purchaseInstructionsBy) {
      queryBuilder.andWhere('grn.purchaseInstructionsBy = :purchaseInstructionsBy', {
        purchaseInstructionsBy: filters.purchaseInstructionsBy,
      });
    }

    if (filters.purchaseBy) {
      queryBuilder.andWhere('grn.purchaseBy = :purchaseBy', { purchaseBy: filters.purchaseBy });
    }

    if (filters.vehicleNo) {
      queryBuilder.andWhere('grn.vehicleNo ILIKE :vehicleNo', { vehicleNo: `%${filters.vehicleNo}%` });
    }

    if (filters.receivedThrough) {
      queryBuilder.andWhere('grn.receivedThrough ILIKE :receivedThrough', {
        receivedThrough: `%${filters.receivedThrough}%`,
      });
    }

    if (filters.deliveryReceivingPerson) {
      queryBuilder.andWhere('grn.deliveryReceivingPerson ILIKE :deliveryReceivingPerson', {
        deliveryReceivingPerson: `%${filters.deliveryReceivingPerson}%`,
      });
    }

    if (filters.securityPerson) {
      queryBuilder.andWhere('grn.securityPerson ILIKE :securityPerson', {
        securityPerson: `%${filters.securityPerson}%`,
      });
    }

    if (filters.rmn) {
      queryBuilder.andWhere('grn.rmn ILIKE :rmn', { rmn: `%${filters.rmn}%` });
    }

    // GrnProduct filters
    if (filters.product && filters.product.length > 0) {
      queryBuilder.andWhere('grnProducts.productName IN (:...productIds)', { productIds: filters.product });
    }

    // PaymentInfo filters
    if (filters.paymentMode) {
      queryBuilder.andWhere('paymentInfo.paymentMode = :paymentMode', { paymentMode: filters.paymentMode });
    }

    if (filters.paymentTerms) {
      queryBuilder.andWhere('paymentInfo.paymentTerms ILIKE :paymentTerms', {
        paymentTerms: `%${filters.paymentTerms}%`,
      });
    }

    // Payment date range filters
    if (filters.paymentDateFrom && filters.paymentDateTo) {
      queryBuilder.andWhere('paymentInfo.paymentDate BETWEEN :paymentDateFrom AND :paymentDateTo', {
        paymentDateFrom: filters.paymentDateFrom,
        paymentDateTo: filters.paymentDateTo,
      });
    }

    // Due date range filters
    if (filters.dueDateFrom && filters.dueDateTo) {
      queryBuilder.andWhere('paymentInfo.dueDate BETWEEN :dueDateFrom AND :dueDateTo', {
        dueDateFrom: filters.dueDateFrom,
        dueDateTo: filters.dueDateTo,
      });
    }

    // Total quantity filter with operator
    // Note: totalQty is calculated from grnProducts, not a direct column
    // This filter is applied after data retrieval in the formatGrnReport method
    if (filters.totalQuantity !== undefined && filters.totalQuantityOperator) {
      // We'll filter this in the application layer since it's a calculated field
      // The filtering will happen in the formatGrnReport method
    }

    // Total amount filter with operator
    if (filters.totalAmount !== undefined && filters.totalAmountOperator) {
      const operator = filters.totalAmountOperator;
      const operatorMap: Record<string, string> = {
        '>': '>',
        '<': '<',
        '=': '=',
        '>=': '>=',
        '<=': '<=',
        '!=': '!=',
      };
      const sqlOp = operatorMap[operator];
      if (sqlOp) {
        queryBuilder.andWhere(`grn.totalAmt ${sqlOp} :totalAmount`, { totalAmount: filters.totalAmount });
      }
    }

    // Verified by filter - filter by userId in the verified approval stage
    if (filters.verifiedBy && filters.verifiedBy.length > 0) {
      queryBuilder.andWhere('verified.userId IN (:...verifiedByIds)', { verifiedByIds: filters.verifiedBy });
    }

    // Approved by filter - filter by userId in any of the approval stages
    if (filters.approvedBy && filters.approvedBy.length > 0) {
      queryBuilder.andWhere(
        '(firstApproved.userId IN (:...approvedByIds) OR secondApproved.userId IN (:...approvedByIds) OR thirdApproved.userId IN (:...approvedByIds))',
        { approvedByIds: filters.approvedBy }
      );
    }

    // Status filter - filter by document status
    if (filters.status) {
      queryBuilder.andWhere('document.status = :status', { status: filters.status });
    }
  }

  private formatGrnReport(grns: any[], rawData: any[]): any[] {
    return grns.map((grn, index) => {
      const raw = rawData[index] || {};
      const selectedParty =
        grn.source === 'vendor'
          ? grn.selectedVendor
          : grn.source === 'farmer'
          ? grn.selectedFarmer
          : null;

      // Calculate totals
      const productCount = grn.grnProducts?.length || 0;
      const totalQty = grn.grnProducts?.reduce((sum: number, p: any) => sum + (parseFloat(p.quantity) || 0), 0) || 0;
      const totalAmount = grn.totalAmt || 0;

      // Get approval information from raw data
      const documentStatus = raw.document_status || '';
      const verifiedBy = raw.verified_by || '';
      const approvedBy = [
        raw.first_approved_by,
        raw.second_approved_by,
        raw.third_approved_by
      ].filter(Boolean).join(', ');

      // Debug log to check what we're getting
      console.log('GRN Data:', {
        grnNo: grn.grnNo,
        createdAt: grn.createdAt,
        vehicleNo: grn.vehicleNo,
        receivedThrough: grn.receivedThrough,
        documentStatus,
        verifiedBy,
        approvedBy
      });

      return {
        grnNo: grn.grnNo ? grn.grnNo.toUpperCase() : null,
        vendorFarmer: selectedParty
          ? grn.source === 'vendor'
            ? selectedParty.companyName
            : `${selectedParty.farmerfName} ${selectedParty.farmermName} ${selectedParty.farmerlName}`.trim()
          : null,
        productCount,
        totalQty,
        totalAmount,
        
        // Additional fields for detailed view
        id: grn.id,
        companyName: grn.companyName?.name || null,
        requestingDepartment: grn.requestingDepartment,
        grnType: grn.grnType,
        locationType: grn.locationType,
        purchaseType: grn.purchaseType,
        source: grn.source,
        billNo: grn.billNo,
        billImage: grn.billImage,
        purchaseLocation: grn.purchaseLocation?.name || null,
        purchaseForSalesLocation: grn.purchaseForSalesLocation?.name || null,
        otherPurchaseLoc: grn.otherPurchaseLoc || null,
        otherPurchaseForSalesLoc: grn.otherPurchaseForSalesLoc || null,
        subTotalAmt: grn.subTotalAmt,
        freight: grn.freight,
        otherCharges: grn.otherCharges,
        amtWords: grn.amtWords,
        purchasedBy: grn.purchasedBy,
        receivedThrough: grn.receivedThrough || '',
        vehicleNo: grn.vehicleNo ? grn.vehicleNo.toUpperCase() : '',
        timeIn: grn.timeIn,
        cratesIn: grn.cratesIn,
        deliveryReceivingPerson: grn.deliveryReceivingPerson,
        rmn: grn.rmn,
        specialReq: grn.specialReq,
        securityPerson: grn.securityPerson,
        approvalNote: grn.approvalNote,
        remark: grn.remark,
        purchaseInstructionsBy: grn.purchaseInstructionsBy
          ? `${grn.purchaseInstructionsBy.firstName} ${grn.purchaseInstructionsBy.lastName}`
          : null,
        purchaseBy: grn.purchaseBy
          ? `${grn.purchaseBy.firstName} ${grn.purchaseBy.lastName}`
          : null,
        createdBy: grn.createdBy
          ? `${grn.createdBy.firstName} ${grn.createdBy.lastName}`
          : null,
        status: documentStatus,
        verifiedBy: verifiedBy,
        approvedBy: approvedBy,
        paymentInfo: grn.paymentInfo
          ? {
              paymentMode: grn.paymentInfo.paymentMode,
              paymentDate: grn.paymentInfo.paymentDate,
              paymentTerms: grn.paymentInfo.paymentTerms,
              creditPeriod: grn.paymentInfo.creditPeriod,
              dueDate: grn.paymentInfo.dueDate,
              advancePaidAmt: grn.paymentInfo.advancePaidAmt,
              remainingAmt: grn.paymentInfo.remainingAmt,
            }
          : null,
        grnProducts: grn.grnProducts?.map((product: any) => ({
          id: product.id,
          productName: product.productName?.name || null,
          variant: product.variant?.variantName || null,
          quantity: product.quantity,
          revisedQuantity: product.revisedQuantity,
          unitPrice: product.unitPrice,
          revisedRate: product.revisedRate,
          uom: product.uom?.unit || null,
          amount: product.amount,
          grossWeight: product.grossWeight,
          packingMaterialWeight: product.packingMaterialWeight,
          netWeight: product.netWeight,
          rtv: product.rtv,
          purchaseDate: product.purchaseDate,
          expectedHarvestDate: product.expectedHarvestDate,
          dispatchDate: product.dispatchDate,
          deliveryDate: product.deliveryDate,
        })) || [],
        createdAt: grn.createdAt,
        updatedAt: grn.updatedAt,
      };
    });
  }

  private async getFilterNames(filters: IGrnReportFilters): Promise<any> {
    const filterNames: any = {};

    // Fetch company names
    if (filters.company && filters.company.length > 0) {
      const companies = await this.dataSource.getRepository('company')
        .createQueryBuilder('c')
        .select(['c.id', 'c.name'])
        .where('c.id IN (:...ids)', { ids: filters.company })
        .getMany();
      filterNames.companies = companies.map((c: any) => c.name);
    }

    // Fetch purchase location names (Branches)
    if (filters.purchaseLocation && filters.purchaseLocation.length > 0) {
      const locations = await this.dataSource.getRepository('branches')
        .createQueryBuilder('b')
        .select(['b.id', 'b.name'])
        .where('b.id IN (:...ids)', { ids: filters.purchaseLocation })
        .getMany();
      filterNames.purchaseLocations = locations.map((l: any) => l.name);
    }

    // Fetch purchase for sales location names (Branches)
    if (filters.purchaseForSalesLocation && filters.purchaseForSalesLocation.length > 0) {
      const locations = await this.dataSource.getRepository('branches')
        .createQueryBuilder('b')
        .select(['b.id', 'b.name'])
        .where('b.id IN (:...ids)', { ids: filters.purchaseForSalesLocation })
        .getMany();
      filterNames.purchaseForSalesLocations = locations.map((l: any) => l.name);
    }

    // Fetch vendor names
    if (filters.vendor && filters.vendor.length > 0) {
      const vendors = await this.dataSource.getRepository('vendor')
        .createQueryBuilder('v')
        .select(['v.id', 'v.companyName'])
        .where('v.id IN (:...ids)', { ids: filters.vendor })
        .getMany();
      filterNames.vendors = vendors.map((v: any) => v.companyName);
    }

    // Fetch farmer names
    if (filters.farmer && filters.farmer.length > 0) {
      const farmers = await this.dataSource.getRepository('farmer')
        .createQueryBuilder('f')
        .select(['f.id', 'f.farmerfName', 'f.farmermName', 'f.farmerlName'])
        .where('f.id IN (:...ids)', { ids: filters.farmer })
        .getMany();
      filterNames.farmers = farmers.map((f: any) => 
        `${f.farmerfName} ${f.farmermName} ${f.farmerlName}`.trim()
      );
    }

    // Fetch created by user names
    if (filters.createdBy && filters.createdBy.length > 0) {
      const users = await this.dataSource.getRepository('employees')
        .createQueryBuilder('u')
        .select(['u.id', 'u.firstName', 'u.lastName'])
        .where('u.id IN (:...ids)', { ids: filters.createdBy })
        .getMany();
      filterNames.createdByUsers = users.map((u: any) => 
        `${u.firstName} ${u.lastName}`.trim()
      );
    }

    // Fetch product names
    if (filters.product && filters.product.length > 0) {
      const products = await this.dataSource.getRepository('product')
        .createQueryBuilder('p')
        .select(['p.id', 'p.name'])
        .where('p.id IN (:...ids)', { ids: filters.product })
        .getMany();
      filterNames.products = products.map((p: any) => p.name);
    }

    return filterNames;
  }

  async generateGrnExcelReport(filters: IGrnReportFilters, loggedInUser?: any): Promise<Buffer | null> {
    try {
      const reportData = await this.getReport(filters);

      if (!reportData || reportData.length === 0) {
        return null;
      }

      // Fetch filter names from database
      const filterNames = await this.getFilterNames(filters);

      // Helper function to get status color
      const getStatusColor = (status: string): string => {
        const statusLower = status?.toLowerCase() || '';
        switch (statusLower) {
          case 'hold':
            return 'FFFF5700'; // Orange
          case 'verified':
            return 'FF6A00FF'; // Indigo
          case 'approved':
            return 'FF40BF40'; // Light Green
          case 'finalizing':
            return 'FF0063B1'; // Blue
          case 'complete':
            return 'FF006600'; // Dark Green
          case 'reject':
            return 'FFAF0606'; // Red
          default:
            return 'FFFFFFFF'; // White (no color)
        }
      };

      // Helper function to safely format dates for display (DD/MM/YYYY)
      const formatDate = (dateValue: any): string => {
        if (!dateValue) return '';
        try {
          const date = new Date(dateValue);
          if (isNaN(date.getTime())) return '';
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const year = date.getFullYear();
          return `${day}/${month}/${year}`;
        } catch (error) {
          return '';
        }
      };

      // Helper function to convert to Excel date (returns Date object or null)
      const toExcelDate = (dateValue: any): Date | null => {
        if (!dateValue) return null;
        try {
          // Check if it's a DD-MM-YYYY string format
          if (typeof dateValue === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(dateValue)) {
            const [day, month, year] = dateValue.split('-').map(Number);
            const date = new Date(year, month - 1, day); // month is 0-indexed
            if (isNaN(date.getTime())) {
              //console.log('⚠️ Invalid DD-MM-YYYY date:', dateValue);
              return null;
            }
            //console.log('✅ Date converted (DD-MM-YYYY):', dateValue, '→', date.toISOString());
            return date;
          }
          
          // Try standard Date parsing for ISO dates
          const date = new Date(dateValue);
          if (isNaN(date.getTime())) {
            //console.log('⚠️ Invalid date value:', dateValue);
            return null;
          }
          //console.log('✅ Date converted:', dateValue, '→', date.toISOString());
          return date; // Return Date object for Excel
        } catch (error) {
          //console.log('❌ Date conversion error:', error, dateValue);
          return null;
        }
      };

      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();

      // ==================== SHEET 1: REPORT SUMMARY ====================
      const filterSheet = workbook.addWorksheet('Report_Summary');
      let filterRow = 1;

      // Title - GRN Detailed Procurement Report
      filterSheet.mergeCells(`A${filterRow}:B${filterRow}`);
      const titleCell = filterSheet.getCell(`A${filterRow}`);
      titleCell.value = 'GRN Detailed Procurement Report';
      titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF00B050' }, // Green background
      };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      filterRow++;

      // Helper function to add parameter row
      const addParameter = (label: string, value: any, isBold = false, alignment: 'left' | 'right' | 'center' = 'left') => {
        const labelCell = filterSheet.getCell(`A${filterRow}`);
        const valueCell = filterSheet.getCell(`B${filterRow}`);
        
        labelCell.value = label;
        labelCell.font = { bold: true, size: 11 };
        
        valueCell.value = value || 'All';
        valueCell.font = { bold: isBold, size: 11 };
        valueCell.alignment = { wrapText: true, horizontal: alignment };
        
        // Add borders
        labelCell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        valueCell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        
        filterRow++;
      };

      // Helper function to add section header
      const addSectionHeader = (title: string) => {
        filterSheet.mergeCells(`A${filterRow}:B${filterRow}`);
        const headerCell = filterSheet.getCell(`A${filterRow}`);
        headerCell.value = title;
        headerCell.font = { bold: true, size: 12 };
        headerCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD9E1F2' }, // Light blue background
        };
        headerCell.alignment = { horizontal: 'left', vertical: 'middle' };
        headerCell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        filterRow++;
      };

      // Report Header Information
      const companies = [...new Set(reportData.map((r: any) => r.companyName).filter(Boolean))];
      const companyName = companies.length > 0 ? companies[0] : 'All Companies';
      addParameter('Company Name:', companyName);
      
      const periodText = `${formatDate(filters.startDate)} to ${formatDate(filters.endDate)}`;
      addParameter('Reporting Period:', periodText);
      
      // Get logged-in user's full name
      const generatedByName = loggedInUser 
        ? `${loggedInUser.firstName || ''} ${loggedInUser.lastName || ''}`.trim() || 'Admin User'
        : 'Admin User';
      addParameter('Generated By:', generatedByName);
      
      const generatedDate = new Date().toLocaleDateString('en-GB', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric'
      });
      addParameter('Generated Date:', generatedDate);
      
      filterRow++; // Empty row

      // Applied Filters Section
      addSectionHeader('Applied Filters');
      
      addParameter('Start Date', formatDate(filters.startDate));
      addParameter('End Date', formatDate(filters.endDate));
      addParameter('Period', periodText);
      
      addParameter('Company', 
        filterNames.companies && filterNames.companies.length > 0 
          ? filterNames.companies.join(', ') 
          : 'All');
      
      addParameter('Purchase Location', 
        filterNames.purchaseLocations && filterNames.purchaseLocations.length > 0 
          ? filterNames.purchaseLocations.join(', ')
          : 'All');
      
      addParameter('Purchase For Sales Location', 
        filterNames.purchaseForSalesLocations && filterNames.purchaseForSalesLocations.length > 0 
          ? filterNames.purchaseForSalesLocations.join(', ')
          : 'All');
      
      addParameter('Vendor', 
        filterNames.vendors && filterNames.vendors.length > 0 
          ? filterNames.vendors.join(', ')
          : 'All');
      
      addParameter('Farmer', 
        filterNames.farmers && filterNames.farmers.length > 0 
          ? filterNames.farmers.join(', ')
          : 'All');
      
      addParameter('Created By', 
        filterNames.createdByUsers && filterNames.createdByUsers.length > 0 
          ? filterNames.createdByUsers.join(', ')
          : 'All');
      
      
      addParameter('Product', 
        filterNames.products && filterNames.products.length > 0 
          ? filterNames.products.join(', ')
          : 'All');

      addParameter('GRN Type', filters.grnType || 'All');
      addParameter('Location Type', filters.locationType || 'All');
      addParameter('Purchase Type', filters.purchaseType || 'All');
      addParameter('Source', filters.source || 'All');

      addParameter('Payment Mode', filters.paymentMode || 'All');
      addParameter('Payment Terms', filters.paymentTerms || 'All');
      
      if (filters.paymentDateFrom && filters.paymentDateTo) {
        addParameter('Payment Date Range', 
          `${formatDate(filters.paymentDateFrom)} to ${formatDate(filters.paymentDateTo)}`);
      } else {
        addParameter('Payment Date Range', 'All');
      }
      
      if (filters.dueDateFrom && filters.dueDateTo) {
        addParameter('Due Date Range', 
          `${formatDate(filters.dueDateFrom)} to ${formatDate(filters.dueDateTo)}`);
      } else {
        addParameter('Due Date Range', 'All');
      }

      if (filters.totalQuantity !== undefined && filters.totalQuantityOperator) {
        addParameter('Total Quantity', 
          `${filters.totalQuantityOperator} ${filters.totalQuantity}`);
      } else {
        addParameter('Total Quantity', 'All');
      }
      
      if (filters.totalAmount !== undefined && filters.totalAmountOperator) {
        addParameter('Total Amount', 
          `${filters.totalAmountOperator} ${filters.totalAmount}`);
      } else {
        addParameter('Total Amount', 'All');
      }

      const verifiers = [...new Set(reportData.map((r: any) => r.verifiedBy).filter(Boolean))];
      addParameter('Verified By', 
        (filters.verifiedBy && filters.verifiedBy.length > 0) ? verifiers.join(', ') : 'All');
      
      const approvers = [...new Set(reportData.map((r: any) => r.approvedBy).filter(Boolean))];
      addParameter('Approved By', 
        (filters.approvedBy && filters.approvedBy.length > 0) ? approvers.join(', ') : 'All');
      
      addParameter('Status', filters.status || 'All');

      addParameter('Bill No', filters.billNo || 'All');
      addParameter('GRN No', filters.grnNo || 'All');
      addParameter('Requesting Department', filters.requestingDepartment || 'All');
      addParameter('Purchase Instructions By', filters.purchaseInstructionsBy || 'All');
      addParameter('Purchase By', filters.purchaseBy || 'All');
      addParameter('Vehicle No', filters.vehicleNo || 'All');
      addParameter('Received Through', filters.receivedThrough || 'All');
      addParameter('Delivery Receiving Person', filters.deliveryReceivingPerson || 'All');
      addParameter('Security Person', filters.securityPerson || 'All');
      addParameter('RMN', filters.rmn || 'All');
      
      filterRow++; // Empty row

      // Summary Section
      addSectionHeader('Summary');
      
      // Calculate totals
      const totalGRNs = reportData.length;
      const totalQuantity = reportData.reduce((sum: number, r: any) => sum + (parseFloat(r.totalQty) || 0), 0);
      const totalAmount = reportData.reduce((sum: number, r: any) => sum + (parseFloat(r.totalAmount) || 0), 0);
      
      addParameter('Total GRNs', totalGRNs, false, 'left');
      addParameter('Total Quantity (KG)', totalQuantity.toFixed(2), false, 'left');
      addParameter('Total Procurement Amount (INR)', totalAmount.toFixed(2), false, 'left');

      // Set column widths for filter sheet
      filterSheet.getColumn(1).width = 40;
      filterSheet.getColumn(2).width = 25;

      // ==================== SHEET 2: REPORT DATA ====================
      const recordSheet = workbook.addWorksheet('Report_Data');
      let currentRow = 1;

      // Table Header Row
      const headerRow = currentRow;
      const headers = [
        'Date',
        'Status',
        'Supplier/Farmer Name',
        'Created By',
        'Source',
        'Purchase For Sales Location',
        'Purchase Location',
        'GRN No.',
        'Product Name',
        'Variant Name',
        'Uom',
        'Qty',
        'Unit Price',
        'Amount',
        'Dispatch Date',
        'Delivery Date',
        'Delivery Location',
        'RTV',
        'Total Quantity',
        'Total Amount',
        'Payment Terms',
        'Credit Period',
        'Payment Date',
        'Due Date',
        'Verified By',
        'Approved By',
        'Vehicle No.',
        'Received Through'
      ];

      headers.forEach((header, index) => {
        const cell = recordSheet.getCell(headerRow, index + 1);
        cell.value = header;
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFF00' }, // Yellow background
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      currentRow++;

      // Data Rows
      reportData.forEach((grn: any) => {
        const grnProducts = grn.grnProducts || [];
        
        if (grnProducts.length === 0) {
          // If no products, add one row with GRN info
          const row = recordSheet.getRow(currentRow);
          const createdAtDate = toExcelDate(grn.createdAt);
          const paymentDate = toExcelDate(grn.paymentInfo?.paymentDate);
          const dueDate = toExcelDate(grn.paymentInfo?.dueDate);
          
          row.getCell(1).value = createdAtDate;
          row.getCell(2).value = grn.status ? grn.status.toUpperCase() : '';
          row.getCell(3).value = grn.vendorFarmer || '';
          row.getCell(4).value = grn.createdBy || '';
          row.getCell(5).value = grn.source || '';
          row.getCell(6).value = grn.purchaseForSalesLocation || '';
          row.getCell(7).value = grn.purchaseLocation || '';
          row.getCell(8).value = grn.grnNo || '';
          row.getCell(9).value = '';
          row.getCell(10).value = '';
          row.getCell(11).value = '';
          row.getCell(12).value = '';
          row.getCell(13).value = '';
          row.getCell(14).value = '';
          row.getCell(15).value = '';
          row.getCell(16).value = '';
          row.getCell(17).value = '';
          row.getCell(18).value = '';
          row.getCell(19).value = grn.totalQty || 0;
          row.getCell(20).value = grn.totalAmount || 0;
          row.getCell(21).value = grn.paymentInfo?.paymentTerms || '';
          row.getCell(22).value = grn.paymentInfo?.creditPeriod || '';
          row.getCell(23).value = paymentDate;
          row.getCell(24).value = dueDate;
          row.getCell(25).value = grn.verifiedBy || '';
          row.getCell(26).value = grn.approvedBy || '';
          row.getCell(27).value = grn.vehicleNo || '';
          row.getCell(28).value = grn.receivedThrough || '';

          // Apply status color
          const statusColor = getStatusColor(grn.status);
          row.getCell(2).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: statusColor },
          };
          // Always use white text for colored backgrounds, black for no color
          row.getCell(2).font = {
            color: { argb: statusColor === 'FFFFFFFF' ? 'FF000000' : 'FFFFFFFF' },
            bold: true,
          };
          row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };

          // Format numbers
          row.getCell(12).numFmt = '#,##0.00';
          row.getCell(13).numFmt = '#,##0.00';
          row.getCell(14).numFmt = '#,##0.00';
          row.getCell(19).numFmt = '#,##0.00';
          row.getCell(20).numFmt = '#,##0.00';
          
          // Format dates - only if value is not null
          if (createdAtDate) row.getCell(1).numFmt = 'dd/mm/yyyy';
          if (paymentDate) row.getCell(23).numFmt = 'dd/mm/yyyy';
          if (dueDate) row.getCell(24).numFmt = 'dd/mm/yyyy';
          
          for (let i = 1; i <= 28; i++) {
            row.getCell(i).border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' },
            };
          }
          currentRow++;
        } else {
          const startRow = currentRow;
          const productCount = grnProducts.length;
          
          // Pre-convert dates once for the GRN
          const createdAtDate = toExcelDate(grn.createdAt);
          const paymentDate = toExcelDate(grn.paymentInfo?.paymentDate);
          const dueDate = toExcelDate(grn.paymentInfo?.dueDate);
          
          // Add a row for each product
          grnProducts.forEach((product: any, index: number) => {
            const row = recordSheet.getRow(currentRow);
            
            // Convert product dates
            const dispatchDate = toExcelDate(product.dispatchDate);
            const deliveryDate = toExcelDate(product.deliveryDate);
            
            // Set values for first row only (will be merged)
            if (index === 0) {
              row.getCell(1).value = createdAtDate;
              row.getCell(2).value = grn.status ? grn.status.toUpperCase() : '';
              row.getCell(3).value = grn.vendorFarmer || '';
              row.getCell(4).value = grn.createdBy || '';
              row.getCell(5).value = grn.source || '';
              row.getCell(6).value = grn.purchaseForSalesLocation || '';
              row.getCell(7).value = grn.purchaseLocation || '';
              row.getCell(8).value = grn.grnNo || '';
              row.getCell(19).value = grn.totalQty || 0;
              row.getCell(20).value = grn.totalAmount || 0;
              row.getCell(21).value = grn.paymentInfo?.paymentTerms || '';
              row.getCell(22).value = grn.paymentInfo?.creditPeriod || '';
              row.getCell(23).value = paymentDate;
              row.getCell(24).value = dueDate;
              row.getCell(25).value = grn.verifiedBy || '';
              row.getCell(26).value = grn.approvedBy || '';
              row.getCell(27).value = grn.vehicleNo || '';
              row.getCell(28).value = grn.receivedThrough || '';

              // Apply status color
              const statusColor = getStatusColor(grn.status);
              row.getCell(2).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: statusColor },
              };
              // Always use white text for colored backgrounds, black for no color
              row.getCell(2).font = {
                color: { argb: statusColor === 'FFFFFFFF' ? 'FF000000' : 'FFFFFFFF' },
                bold: true,
              };
              row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
            }

            // Product details (not merged)
            row.getCell(9).value = product.productName || '';
            row.getCell(10).value = product.variant || '';
            row.getCell(11).value = product.uom || '';
            row.getCell(12).value = parseFloat(product.quantity) || 0;
            row.getCell(13).value = parseFloat(product.unitPrice) || 0;
            row.getCell(14).value = parseFloat(product.amount) || 0;
            row.getCell(15).value = dispatchDate;
            row.getCell(16).value = deliveryDate;
            row.getCell(17).value = product.rtv || '';

            // Format numbers
            row.getCell(12).numFmt = '#,##0.00';
            row.getCell(13).numFmt = '#,##0.00';
            row.getCell(14).numFmt = '#,##0.00';
            row.getCell(18).numFmt = '#,##0.00';
            row.getCell(19).numFmt = '#,##0.00';

            // Format dates - only if value is not null
            if (createdAtDate) row.getCell(1).numFmt = 'dd/mm/yyyy';
            if (dispatchDate) row.getCell(15).numFmt = 'dd/mm/yyyy';
            if (deliveryDate) row.getCell(16).numFmt = 'dd/mm/yyyy';
            if (paymentDate) row.getCell(22).numFmt = 'dd/mm/yyyy';
            if (dueDate) row.getCell(23).numFmt = 'dd/mm/yyyy';

            // Add borders
            for (let i = 1; i <= 27; i++) {
              row.getCell(i).border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' },
              };
            }

            currentRow++;
          });

          // Merge cells for GRN info columns if multiple products
          if (productCount > 1) {
            const endRow = currentRow - 1;
            
            // Merge Date (column 1)
            recordSheet.mergeCells(startRow, 1, endRow, 1);
            recordSheet.getCell(startRow, 1).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Status (column 2)
            recordSheet.mergeCells(startRow, 2, endRow, 2);
            recordSheet.getCell(startRow, 2).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Supplier/Farmer Name (column 3)
            recordSheet.mergeCells(startRow, 3, endRow, 3);
            recordSheet.getCell(startRow, 3).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Created By (column 4)
            recordSheet.mergeCells(startRow, 4, endRow, 4);
            recordSheet.getCell(startRow, 4).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Source (column 5)
            recordSheet.mergeCells(startRow, 5, endRow, 5);
            recordSheet.getCell(startRow, 5).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Purchase For Sales Location (column 6)
            recordSheet.mergeCells(startRow, 6, endRow, 6);
            recordSheet.getCell(startRow, 6).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Purchase Location (column 7)
            recordSheet.mergeCells(startRow, 7, endRow, 7);
            recordSheet.getCell(startRow, 7).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge GRN No. (column 8)
            recordSheet.mergeCells(startRow, 8, endRow, 8);
            recordSheet.getCell(startRow, 8).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Total Quantity (column 19)
            recordSheet.mergeCells(startRow, 19, endRow, 19);
            recordSheet.getCell(startRow, 19).alignment = { vertical: 'middle', horizontal: 'right' };
            
            // Merge Total Amount (column 20)
            recordSheet.mergeCells(startRow, 20, endRow, 20);
            recordSheet.getCell(startRow, 20).alignment = { vertical: 'middle', horizontal: 'right' };
            
            // Merge Payment Terms (column 21)
            recordSheet.mergeCells(startRow, 21, endRow, 21);
            recordSheet.getCell(startRow, 21).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Credit Period (column 22)
            recordSheet.mergeCells(startRow, 22, endRow, 22);
            recordSheet.getCell(startRow, 22).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Payment Date (column 23)
            recordSheet.mergeCells(startRow, 23, endRow, 23);
            recordSheet.getCell(startRow, 23).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Due Date (column 24)
            recordSheet.mergeCells(startRow, 24, endRow, 24);
            recordSheet.getCell(startRow, 24).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Verified By (column 25)
            recordSheet.mergeCells(startRow, 25, endRow, 25);
            recordSheet.getCell(startRow, 25).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Approved By (column 26)
            recordSheet.mergeCells(startRow, 26, endRow, 26);
            recordSheet.getCell(startRow, 26).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Vehicle No. (column 27)
            recordSheet.mergeCells(startRow, 27, endRow, 27);
            recordSheet.getCell(startRow, 27).alignment = { vertical: 'middle', horizontal: 'left' };
            
            // Merge Received Through (column 28)
            recordSheet.mergeCells(startRow, 28, endRow, 28);
            recordSheet.getCell(startRow, 28).alignment = { vertical: 'middle', horizontal: 'left' };
          }
        }
      });

      // Set column widths
      recordSheet.getColumn(1).width = 12;  // Date
      recordSheet.getColumn(2).width = 12;  // Status
      recordSheet.getColumn(3).width = 25;  // Supplier/Farmer Name
      recordSheet.getColumn(4).width = 18;  // Created By
      recordSheet.getColumn(5).width = 12;  // Source
      recordSheet.getColumn(6).width = 22;  // Purchase For Sales Location
      recordSheet.getColumn(7).width = 20;  // Purchase Location
      recordSheet.getColumn(8).width = 15;  // GRN No.
      recordSheet.getColumn(9).width = 20;  // Product Name
      recordSheet.getColumn(10).width = 18; // Variant Name
      recordSheet.getColumn(11).width = 8;  // Uom
      recordSheet.getColumn(12).width = 10; // Qty
      recordSheet.getColumn(13).width = 12; // Unit Price
      recordSheet.getColumn(14).width = 12; // Amount
      recordSheet.getColumn(15).width = 12; // Dispatch Date
      recordSheet.getColumn(16).width = 12; // Delivery Date
      recordSheet.getColumn(17).width = 18; // Delivery Location
      recordSheet.getColumn(18).width = 8;  // RTV
      recordSheet.getColumn(19).width = 12; // Total Quantity
      recordSheet.getColumn(20).width = 12; // Total Amount
      recordSheet.getColumn(21).width = 15; // Payment Terms
      recordSheet.getColumn(22).width = 12; // Credit Period
      recordSheet.getColumn(23).width = 12; // Payment Date
      recordSheet.getColumn(24).width = 12; // Due Date
      recordSheet.getColumn(25).width = 18; // Verified By
      recordSheet.getColumn(26).width = 18; // Approved By
      recordSheet.getColumn(27).width = 15; // Vehicle No.
      recordSheet.getColumn(28).width = 18; // Received Through

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      console.error('Error generating GRN Excel report:', error);
      throw error;
    }
  }
}
