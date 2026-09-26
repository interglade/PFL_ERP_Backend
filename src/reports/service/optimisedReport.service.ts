import { injectable } from 'inversify';

import * as ExcelJS from 'exceljs';
import { ReportFilters } from '../controller/report.controller';
import { AppDataSource } from '../../utils/data-source';

// ==================== TYPES & INTERFACES ====================
export interface ReportData {
  name: string;
  quantity: number;
  amount: number;
}

export interface ReportSummary {
  totalQuantity: number;
  totalAmount: number;
  recordCount: number;
  averageAmount: number;
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

interface QueryBuilder {
  query: string;
  params: any[];
  paramIndex: number;
}

// ==================== CONSTANTS ====================
const UNIT_CONVERSION = {
  TONNES_DIVISOR: 1000,
} as const;

const QUARTER_NAMES = {
  1: '1st Quarter (Jan-Mar)',
  2: '2nd Quarter (Apr-Jun)',
  3: '3rd Quarter (Jul-Sep)',
  4: '4th Quarter (Oct-Dec)',
} as const;

const EXCEL_STYLES = {
  TITLE_BG: 'FFFF00',
  HEADER_BG: 'ADD8E6',
  DEFAULT_ROW_HEIGHT: 15,
  COLUMN_WIDTHS: [20, 50, 15],
} as const;

// ==================== OPTIMISED REPORT SERVICE ====================

@injectable()
export class OptimisedReportService {
  constructor() {}

  // ==================== PUBLIC METHODS ====================

  /**
   * Generate report based on filters
   * Optimisation: Single entry point with better error handling
   */
  async generateReport(filters: ReportFilters): Promise<ReportData[]> {
    const dateRange = this.buildDateRange(filters);
    const reportGenerator = this.getReportGenerator(filters.reportBased);
    return reportGenerator(filters, dateRange);
  }

  /**
   * Get report summary with aggregated statistics
   * Optimisation: Reuses generateReport to avoid duplicate queries
   */
  async getReportSummary(filters: ReportFilters): Promise<ReportSummary> {
    const reportData = await this.generateReport(filters);
    return this.calculateSummary(reportData);
  }

  /**
   * Generate Excel report
   * Optimisation: Separated concerns, better structure
   */
  async generateExcelReport(filters: ReportFilters): Promise<Buffer | null> {
    const reportData = await this.generateReport(filters);
    
    if (!reportData?.length) return null;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Procurement Report');
    
    this.setupWorksheetColumns(worksheet);
    await this.addReportHeader(worksheet, filters);
    this.addReportData(worksheet, reportData, filters);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // ==================== PRIVATE: REPORT GENERATORS ====================

  /**
   * Factory method to get appropriate report generator
   * Optimisation: Eliminates switch statement duplication
   */
  private getReportGenerator(reportType: string): (filters: ReportFilters, dateRange: DateRange) => Promise<ReportData[]> {
    const generators: Record<string, (filters: ReportFilters, dateRange: DateRange) => Promise<ReportData[]>> = {
      employee: this.getEmployeeReport.bind(this),
      location: this.getLocationReport.bind(this),
      company: this.getCompanyReport.bind(this),
      source: this.getSourceReport.bind(this),
      vendor: this.getVendorReport.bind(this),
      farmer: this.getFarmerReport.bind(this),
      product: this.getProductReport.bind(this),
    };

    const generator = generators[reportType];
    if (!generator) {
      throw new Error(`Unsupported report type: ${reportType}`);
    }
    return generator;
  }

  /**
   * Employee report with optimised query building
   */
  private async getEmployeeReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
    const qb = this.initQueryBuilder(filters.units);

    qb.query = `
      SELECT 
        CONCAT(u."firstName", ' ', COALESCE(u."middleName", ''), ' ', u."lastName") as name,
        COALESCE(SUM(${this.getWeightConversion(1)}), 0) as quantity,
        COALESCE(SUM(gp.amount), 0) as amount
      FROM employees u
      LEFT JOIN grns g ON u.id = g.createdby_id AND g."createdAt" BETWEEN $${qb.paramIndex + 1} AND $${qb.paramIndex + 2}
      LEFT JOIN grn_products gp ON g.id = gp.grn_id
      WHERE 1=1
    `;

    qb.params.push(dateRange.startDate, dateRange.endDate);
    qb.paramIndex += 2;

    this.applyEmployeeFilter(qb, filters);
    this.applyCompanyFilter(qb, filters, true);
    this.applyProductFilter(qb, filters, true);
    this.applySourceFilter(qb, filters, true);

    qb.query += `
      GROUP BY u.id, u."firstName", u."middleName", u."lastName"
      ORDER BY amount DESC
    `;

    return this.executeReportQuery(qb);
  }

  /**
   * Location report with optimised JOIN conditions
   */
  private async getLocationReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
    const qb = this.initQueryBuilder(filters.units);

    // Build JOIN conditions upfront for better performance
    const grnJoinConditions = this.buildGrnJoinConditions(filters, dateRange, qb);
    const productJoinConditions = this.buildProductJoinConditions(filters, qb);

    qb.query = `
      SELECT 
        b.name as name,
        COALESCE(SUM(${this.getWeightConversion(1)}), 0) as quantity,
        COALESCE(SUM(gp.amount), 0) as amount
      FROM branches b
      LEFT JOIN addresses a ON b."addressId" = a.id
      LEFT JOIN grns g ON ${grnJoinConditions}
      LEFT JOIN grn_products gp ON ${productJoinConditions}
      WHERE 1=1
    `;

    this.applyLocationFilter(qb, filters);

    qb.query += `
      GROUP BY b.name, b.id
      HAVING b.name IS NOT NULL
      ORDER BY amount DESC
    `;

    return this.executeReportQuery(qb);
  }

  /**
   * Company report
   */
  private async getCompanyReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
    const qb = this.initQueryBuilder(filters.units);

    qb.query = `
      SELECT 
        c.name as name,
        COALESCE(SUM(${this.getWeightConversion(1)}), 0) as quantity,
        COALESCE(SUM(gp.amount), 0) as amount
      FROM company c
      LEFT JOIN grns g ON c.id = g.company_id AND g."createdAt" BETWEEN $${qb.paramIndex + 1} AND $${qb.paramIndex + 2}
      LEFT JOIN grn_products gp ON g.id = gp.grn_id
      WHERE 1=1
    `;

    qb.params.push(dateRange.startDate, dateRange.endDate);
    qb.paramIndex += 2;

    this.applyCompanyFilter(qb, filters, false);
    this.applyProductFilter(qb, filters, true);
    this.applySourceFilter(qb, filters, true);

    qb.query += `
      GROUP BY c.id, c.name
      ORDER BY amount DESC
    `;

    return this.executeReportQuery(qb);
  }

  /**
   * Source report (Vendor/Farmer aggregation)
   */
  private async getSourceReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
    const qb = this.initQueryBuilder(filters.units);

    qb.query = `
      SELECT 
        CASE 
          WHEN g.vendor_id IS NOT NULL THEN 'Vendor'
          WHEN g.farmer_id IS NOT NULL THEN 'Farmer'
          ELSE 'Unknown'
        END as name,
        SUM(${this.getWeightConversion(1)}) as quantity,
        SUM(gp.amount) as amount
      FROM grns g
      LEFT JOIN grn_products gp ON g.id = gp.grn_id
      WHERE g."createdAt" BETWEEN $${qb.paramIndex + 1} AND $${qb.paramIndex + 2}
    `;

    qb.params.push(dateRange.startDate, dateRange.endDate);
    qb.paramIndex += 2;

    this.applyCompanyFilter(qb, filters, false);
    this.applyProductFilter(qb, filters, false);
    this.applySourceFilter(qb, filters, false);

    qb.query += `
      GROUP BY name
      ORDER BY amount DESC
    `;

    return this.executeReportQuery(qb);
  }

  /**
   * Vendor report
   */
  private async getVendorReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
    const qb = this.initQueryBuilder(filters.units);

    qb.query = `
      SELECT 
        v.company_name as name,
        SUM(${this.getWeightConversion(1)}) as quantity,
        SUM(gp.amount) as amount
      FROM vendor v
      LEFT JOIN grns g ON v.id = g.vendor_id
      LEFT JOIN grn_products gp ON g.id = gp.grn_id
      WHERE g."createdAt" BETWEEN $${qb.paramIndex + 1} AND $${qb.paramIndex + 2}
    `;

    qb.params.push(dateRange.startDate, dateRange.endDate);
    qb.paramIndex += 2;

    this.applyVendorFilter(qb, filters);
    this.applyCompanyFilter(qb, filters, false);
    this.applyProductFilter(qb, filters, false);

    qb.query += `
      GROUP BY v.id, v.company_name
      HAVING SUM(gp."netWeight") > 0
      ORDER BY amount DESC
    `;

    return this.executeReportQuery(qb);
  }

  /**
   * Farmer report
   */
  private async getFarmerReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
    const qb = this.initQueryBuilder(filters.units);

    qb.query = `
      SELECT 
        CONCAT(f."farmerfName", ' ', COALESCE(f."farmermName", ''), ' ', f."farmerlName") as name,
        COALESCE(SUM(${this.getWeightConversion(1)}), 0) as quantity,
        COALESCE(SUM(gp.amount), 0) as amount
      FROM farmer f
      LEFT JOIN grns g ON f.id = g.farmer_id AND g."createdAt" BETWEEN $${qb.paramIndex + 1} AND $${qb.paramIndex + 2}
      LEFT JOIN grn_products gp ON g.id = gp.grn_id
      WHERE 1=1
    `;

    qb.params.push(dateRange.startDate, dateRange.endDate);
    qb.paramIndex += 2;

    this.applyFarmerFilter(qb, filters);
    this.applyCompanyFilter(qb, filters, true);
    this.applyProductFilter(qb, filters, true);

    qb.query += `
      GROUP BY f.id, f."farmerfName", f."farmermName", f."farmerlName"
      ORDER BY amount DESC
    `;

    return this.executeReportQuery(qb);
  }

  /**
   * Product report
   */
  private async getProductReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
    const qb = this.initQueryBuilder(filters.units);

    qb.query = `
      SELECT 
        p.product_name as name,
        COALESCE(SUM(${this.getWeightConversion(1)}), 0) as quantity,
        COALESCE(SUM(gp.amount), 0) as amount
      FROM product p
      LEFT JOIN grn_products gp ON p.id = gp.product_id
      LEFT JOIN grns g ON gp.grn_id = g.id AND g."createdAt" BETWEEN $${qb.paramIndex + 1} AND $${qb.paramIndex + 2}
      WHERE 1=1
    `;

    qb.params.push(dateRange.startDate, dateRange.endDate);
    qb.paramIndex += 2;

    this.applyProductFilter(qb, filters, false);
    this.applyCompanyFilter(qb, filters, true);
    this.applySourceFilter(qb, filters, true);

    qb.query += `
      GROUP BY p.id, p.product_name
      ORDER BY amount DESC
    `;

    return this.executeReportQuery(qb);
  }

  // ==================== PRIVATE: QUERY BUILDING HELPERS ====================

  /**
   * Initialize query builder with unit parameter
   */
  private initQueryBuilder(units: 'kg' | 'tonnes'): QueryBuilder {
    return {
      query: '',
      params: [units],
      paramIndex: 1,
    };
  }

  /**
   * Get weight conversion SQL expression
   */
  private getWeightConversion(paramIndex: number): string {
    return `
      CASE 
        WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / ${UNIT_CONVERSION.TONNES_DIVISOR}
        ELSE gp."netWeight"
      END
    `.trim();
  }

  /**
   * Build GRN JOIN conditions with filters
   */
  private buildGrnJoinConditions(filters: ReportFilters, dateRange: DateRange, qb: QueryBuilder): string {
    let conditions = `b.id = g.purchaselocation_id AND g."createdAt" BETWEEN $${qb.paramIndex + 1} AND $${qb.paramIndex + 2}`;
    
    qb.params.push(dateRange.startDate, dateRange.endDate);
    qb.paramIndex += 2;

    if (filters.companyNames?.length) {
      conditions += ` AND g.company_id = ANY($${++qb.paramIndex})`;
      qb.params.push(filters.companyNames);
    }

    const sourceConditions = this.buildSourceConditions(filters, qb);
    if (sourceConditions) {
      conditions += ` ${sourceConditions}`;
    }

    return conditions;
  }

  /**
   * Build product JOIN conditions with filters
   */
  private buildProductJoinConditions(filters: ReportFilters, qb: QueryBuilder): string {
    let conditions = 'g.id = gp.grn_id';

    if (filters.products?.length) {
      conditions += ` AND gp.product_id = ANY($${++qb.paramIndex})`;
      qb.params.push(filters.products);
    }

    return conditions;
  }

  /**
   * Build source filter conditions (vendor/farmer)
   */
  private buildSourceConditions(filters: ReportFilters, qb: QueryBuilder): string {
    if (filters.source === 'vendor' && filters.vendors?.length) {
      qb.params.push(filters.vendors);
      return `AND g.vendor_id = ANY($${++qb.paramIndex})`;
    }
    
    if (filters.source === 'farmer' && filters.farmers?.length) {
      qb.params.push(filters.farmers);
      return `AND g.farmer_id = ANY($${++qb.paramIndex})`;
    }
    
    if (filters.source === 'vendor') {
      return 'AND g.vendor_id IS NOT NULL';
    }
    
    if (filters.source === 'farmer') {
      return 'AND g.farmer_id IS NOT NULL';
    }

    if (filters.vendors?.length) {
      qb.params.push(filters.vendors);
      return `AND g.vendor_id = ANY($${++qb.paramIndex})`;
    }
    
    if (filters.farmers?.length) {
      qb.params.push(filters.farmers);
      return `AND g.farmer_id = ANY($${++qb.paramIndex})`;
    }

    return '';
  }

  // ==================== PRIVATE: FILTER APPLICATORS ====================

  private applyEmployeeFilter(qb: QueryBuilder, filters: ReportFilters): void {
    if (filters.employees?.length) {
      qb.query += ` AND u.id = ANY($${++qb.paramIndex})`;
      qb.params.push(filters.employees);
    }
  }

  private applyLocationFilter(qb: QueryBuilder, filters: ReportFilters): void {
    if (filters.locations?.length) {
      qb.query += ` AND b.id = ANY($${++qb.paramIndex})`;
      qb.params.push(filters.locations);
    }
  }

  private applyCompanyFilter(qb: QueryBuilder, filters: ReportFilters, useNullCheck: boolean): void {
    if (filters.companyNames?.length) {
      if (useNullCheck) {
        qb.query += ` AND (g.company_id = ANY($${++qb.paramIndex}) OR g.id IS NULL)`;
      } else {
        qb.query += ` AND g.company_id = ANY($${++qb.paramIndex})`;
      }
      qb.params.push(filters.companyNames);
    }
  }

  private applyProductFilter(qb: QueryBuilder, filters: ReportFilters, useNullCheck: boolean): void {
    if (filters.products?.length) {
      if (useNullCheck) {
        qb.query += ` AND (gp.product_id = ANY($${++qb.paramIndex}) OR gp.id IS NULL)`;
      } else {
        qb.query += ` AND gp.product_id = ANY($${++qb.paramIndex})`;
      }
      qb.params.push(filters.products);
    }
  }

  private applyVendorFilter(qb: QueryBuilder, filters: ReportFilters): void {
    if (filters.vendors?.length) {
      qb.query += ` AND v.id = ANY($${++qb.paramIndex})`;
      qb.params.push(filters.vendors);
    }
  }

  private applyFarmerFilter(qb: QueryBuilder, filters: ReportFilters): void {
    if (filters.farmers?.length) {
      qb.query += ` AND f.id = ANY($${++qb.paramIndex})`;
      qb.params.push(filters.farmers);
    }
  }

  private applySourceFilter(qb: QueryBuilder, filters: ReportFilters, useNullCheck: boolean): void {
    const sourceConditions = this.buildSourceConditions(filters, qb);
    if (sourceConditions) {
      if (useNullCheck) {
        qb.query += ` ${sourceConditions.replace('AND g.', 'AND (g.')} OR g.id IS NULL)`;
      } else {
        qb.query += ` ${sourceConditions}`;
      }
    }
  }

  // ==================== PRIVATE: DATE RANGE BUILDER ====================

  /**
   * Build date range based on period type
   * Optimisation: Cleaner logic with early returns
   */
  private buildDateRange(filters: ReportFilters): DateRange {
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    switch (filters.period) {
      case 'custom':
        startDate = new Date(filters.startDate!);
        endDate = new Date(filters.endDate!);
        startDate.setHours(23, 59, 59, 999);
        break;

      case 'current_month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        startDate.setHours(0, 0, 0, 0);
        break;

      case 'previous_month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        startDate.setHours(0, 0, 0, 0);
        break;

      case 'month_year':
        startDate = new Date(filters.year!, filters.month! - 1, 1);
        endDate = new Date(filters.year!, filters.month!, 0);
        startDate.setHours(0, 0, 0, 0);
        break;

      case 'quarterly':
        const quarterStartMonth = (filters.quarter! - 1) * 3;
        startDate = new Date(filters.year || now.getFullYear(), quarterStartMonth, 1);
        endDate = new Date(filters.year || now.getFullYear(), quarterStartMonth + 3, 0);
        startDate.setHours(0, 0, 0, 0);
        break;

      default:
        throw new Error(`Unsupported period: ${filters.period}`);
    }

    endDate.setDate(endDate.getDate() + 1);
    endDate.setHours(0, 0, 0, 0);

    return { startDate, endDate };
  }

  // ==================== PRIVATE: QUERY EXECUTION ====================

  /**
   * Execute report query and map results
   * Optimisation: Centralized error handling and result mapping
   */
  private async executeReportQuery(qb: QueryBuilder): Promise<ReportData[]> {
    try {
      const result = await AppDataSource.query(qb.query, qb.params);
      return result.map((row: any) => ({
        name: row.name || 'Unknown',
        quantity: parseFloat(row.quantity) || 0,
        amount: parseFloat(row.amount) || 0,
      }));
    } catch (error) {
      console.error('Query execution error:', error);
      console.error('Query:', qb.query);
      console.error('Params:', qb.params);
      throw error;
    }
  }

  /**
   * Calculate summary statistics from report data
   */
  private calculateSummary(reportData: ReportData[]): ReportSummary {
    const totalQuantity = reportData.reduce((sum, item) => sum + item.quantity, 0);
    const totalAmount = reportData.reduce((sum, item) => sum + item.amount, 0);
    const recordCount = reportData.length;
    const averageAmount = recordCount > 0 ? totalAmount / recordCount : 0;

    return {
      totalQuantity,
      totalAmount,
      recordCount,
      averageAmount: Math.round(averageAmount * 100) / 100,
    };
  }

  // ==================== PRIVATE: EXCEL GENERATION ====================

  /**
   * Setup worksheet columns
   */
  private setupWorksheetColumns(worksheet: ExcelJS.Worksheet): void {
    worksheet.columns = EXCEL_STYLES.COLUMN_WIDTHS.map(width => ({ width }));
    worksheet.properties.defaultRowHeight = EXCEL_STYLES.DEFAULT_ROW_HEIGHT;
  }

  /**
   * Add report header with metadata
   */
  private async addReportHeader(worksheet: ExcelJS.Worksheet, filters: ReportFilters): Promise<void> {
    // Title
    const titleRow = worksheet.addRow(['Procurement Report']);
    titleRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: EXCEL_STYLES.TITLE_BG }
    };
    titleRow.getCell(1).font = { bold: true, size: 16 };
    titleRow.getCell(1).alignment = { horizontal: 'center' };
    worksheet.mergeCells('A1:C1');

    worksheet.addRow([]);
    worksheet.addRow(['Report For:']);

    // Metadata rows
    const metadata = await this.buildReportMetadata(filters);
    metadata.forEach(([label, value]) => {
      const row = worksheet.addRow([label, value]);
      row.getCell(1).font = { bold: true };
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    });

    worksheet.addRow([]);
  }

  /**
   * Build report metadata for Excel header
   */
  private async buildReportMetadata(filters: ReportFilters): Promise<[string, string][]> {
    const [companies, locations, vendors, farmers, employees, products] = await Promise.all([
      this.getCompanyNames(filters.companyNames),
      this.getLocationNames(filters.locations),
      this.getVendorNames(filters.vendors),
      this.getFarmerNames(filters.farmers),
      this.getEmployeeNames(filters.employees),
      this.getProductNames(filters.products),
    ]);

    const periodText = this.formatPeriodText(filters);
    const generatedAt = new Date().toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    return [
      ['Companies:', companies],
      ['Locations:', locations],
      ['Procurement Source:', filters.source || 'All'],
      ['Vendor Names:', vendors],
      ['Farmer Names:', farmers],
      ['Employees:', employees],
      ['Products:', products],
      ['Unit:', filters.units || 'kg'],
      ['Period:', periodText],
      ['Generated At:', generatedAt],
    ];
  }

  /**
   * Format period text for display
   */
  private formatPeriodText(filters: ReportFilters): string {
    if (filters.period === 'custom' && filters.startDate && filters.endDate) {
      const startDate = new Date(filters.startDate).toLocaleDateString('en-GB');
      const endDate = new Date(filters.endDate).toLocaleDateString('en-GB');
      return `${startDate} To ${endDate}`;
    }
    return filters.period;
  }

  /**
   * Add report data table to worksheet
   */
  private addReportData(worksheet: ExcelJS.Worksheet, reportData: ReportData[], filters: ReportFilters): void {
    // Header row
    const headerRow = worksheet.addRow([
      this.getColumnHeader(filters.reportBased),
      'Quantity',
      'Amount'
    ]);

    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: EXCEL_STYLES.HEADER_BG }
      };
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // Data rows
    reportData.forEach((item) => {
      const dataRow = worksheet.addRow([
        item.name,
        Math.round(item.quantity),
        Math.round(item.amount)
      ]);

      dataRow.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        
        if (colNumber === 1) {
          cell.alignment = { wrapText: true, vertical: 'top' };
        } else {
          cell.alignment = { horizontal: 'right', vertical: 'top' };
        }
      });
    });
  }

  /**
   * Get appropriate column header based on report type
   */
  private getColumnHeader(reportBased: string): string {
    const headers: Record<string, string> = {
      product: 'Product Name',
      vendor: 'Vendor Name',
      farmer: 'Farmer Name',
      employee: 'Employee Name',
      location: 'Location',
      company: 'Company Name',
      source: 'Source Name',
    };
    return headers[reportBased] || 'Name';
  }

  // ==================== PRIVATE: NAME FETCHERS ====================

  /**
   * Fetch company names by IDs
   * Optimisation: Consistent error handling, returns 'All' for empty
   */
  private async getCompanyNames(companyIds?: string[]): Promise<string> {
    if (!companyIds?.length) return 'All';
    
    try {
      const result = await AppDataSource.query(
        'SELECT name FROM company WHERE id = ANY($1)',
        [companyIds]
      );
      return result.map((row: any) => row.name).join(', ') || 'Selected Companies';
    } catch (error) {
      console.error('Error fetching company names:', error);
      return 'Selected Companies';
    }
  }

  private async getLocationNames(locationIds?: string[]): Promise<string> {
    if (!locationIds?.length) return 'All';
    
    try {
      const result = await AppDataSource.query(
        'SELECT b.name as location_name FROM branches b WHERE b.id = ANY($1)',
        [locationIds]
      );
      return result.map((row: any) => row.location_name).join(', ') || 'Selected Locations';
    } catch (error) {
      console.error('Error fetching location names:', error);
      return 'Selected Locations';
    }
  }

  private async getVendorNames(vendorIds?: string[]): Promise<string> {
    if (!vendorIds?.length) return 'All';
    
    try {
      const result = await AppDataSource.query(
        'SELECT company_name FROM vendor WHERE id = ANY($1)',
        [vendorIds]
      );
      return result.map((row: any) => row.company_name).join(', ') || 'Selected Vendors';
    } catch (error) {
      console.error('Error fetching vendor names:', error);
      return 'Selected Vendors';
    }
  }

  private async getFarmerNames(farmerIds?: string[]): Promise<string> {
    if (!farmerIds?.length) return 'All';
    
    try {
      const result = await AppDataSource.query(
        `SELECT CONCAT("farmerfName", ' ', COALESCE("farmermName", ''), ' ', "farmerlName") as farmer_name 
         FROM farmer WHERE id = ANY($1)`,
        [farmerIds]
      );
      return result.map((row: any) => row.farmer_name).join(', ') || 'Selected Farmers';
    } catch (error) {
      console.error('Error fetching farmer names:', error);
      return 'Selected Farmers';
    }
  }

  private async getEmployeeNames(employeeIds?: string[]): Promise<string> {
    if (!employeeIds?.length) return 'All';
    
    try {
      const result = await AppDataSource.query(
        `SELECT CONCAT("firstName", ' ', COALESCE("middleName", ''), ' ', "lastName") as employee_name 
         FROM employees WHERE id = ANY($1)`,
        [employeeIds]
      );
      return result.map((row: any) => row.employee_name).join(', ') || 'Selected Employees';
    } catch (error) {
      console.error('Error fetching employee names:', error);
      return 'Selected Employees';
    }
  }

  private async getProductNames(productIds?: string[]): Promise<string> {
    if (!productIds?.length) return 'All';
    
    try {
      const result = await AppDataSource.query(
        'SELECT product_name FROM product WHERE id = ANY($1)',
        [productIds]
      );
      return result.map((row: any) => row.product_name).join(', ') || 'Selected Products';
    } catch (error) {
      console.error('Error fetching product names:', error);
      return 'Selected Products';
    }
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Convert units (kg to tonnes)
   */
  convertUnits(quantityInKg: number, targetUnit: 'kg' | 'tonnes'): number {
    return targetUnit === 'tonnes' ? quantityInKg / UNIT_CONVERSION.TONNES_DIVISOR : quantityInKg;
  }

  /**
   * Get quarter name
   */
  getQuarterName(quarter: number): string {
    return QUARTER_NAMES[quarter as keyof typeof QUARTER_NAMES] || 'Unknown Quarter';
  }
}
