import { injectable } from 'inversify';
import { AppDataSource } from '../../utils/data-source';

import * as ExcelJS from 'exceljs';
import logger from '../../utils/logger';
import { ReportFilters } from '../controller/report.controller';

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

@injectable()
export class ReportService {
  constructor() {}

  async generateReport(filters: ReportFilters): Promise<ReportData[]> {
    try {
      
      // Build date range based on period
      const dateRange = this.buildDateRange(filters);
      
      // Generate report based on reportBased type
      switch (filters.reportBased) {
        case 'employee':
          return await this.getEmployeeReport(filters, dateRange);
        case 'location':
          return await this.getLocationReport(filters, dateRange);
        case 'company':
          return await this.getCompanyReport(filters, dateRange);
        case 'source':
          return await this.getSourceReport(filters, dateRange);
        case 'vendor':
          return await this.getVendorReport(filters, dateRange);
        case 'farmer':
          return await this.getFarmerReport(filters, dateRange);
        case 'product':
          return await this.getProductReport(filters, dateRange);
        default:
          throw new Error(`Unsupported report type: ${filters.reportBased}`);
      }
    } catch (error) {
  logger.error('Error generating report:', error);
      throw error;
    }
  }

  async getReportSummary(filters: ReportFilters): Promise<ReportSummary> {
    try {
      const reportData = await this.generateReport(filters);
      
      const totalQuantity = reportData.reduce((sum, item) => sum + item.quantity, 0);
      const totalAmount = reportData.reduce((sum, item) => sum + item.amount, 0);
      const recordCount = reportData.length;
      const averageAmount = recordCount > 0 ? totalAmount / recordCount : 0;

      return {
        totalQuantity,
        totalAmount,
        recordCount,
        averageAmount: Math.round(averageAmount * 100) / 100, // Round to 2 decimal places
      };
    } catch (error) {
      logger.error('Error generating report summary:', error);
      throw error;
    }
  }

  private buildDateRange(filters: ReportFilters): DateRange {
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    switch (filters.period) {
      case 'custom':
        startDate = new Date(filters.startDate!);
        endDate = new Date(filters.endDate!);
        // Set start date to 11:59 PM (23:59:59.999) for custom period
        startDate.setHours(23, 59, 59, 999);
        break;

      case 'current_month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        // Set start date to 00:00 AM for month periods
        startDate.setHours(0, 0, 0, 0);
        break;

      case 'previous_month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        // Set start date to 00:00 AM for month periods
        startDate.setHours(0, 0, 0, 0);
        break;

      case 'month_year':
        startDate = new Date(filters.year!, filters.month! - 1, 1);
        endDate = new Date(filters.year!, filters.month!, 0);
        // Set start date to 00:00 AM for month periods
        startDate.setHours(0, 0, 0, 0);
        break;

      case 'quarterly':
        const quarterStartMonth = (filters.quarter! - 1) * 3;
        startDate = new Date(filters.year || now.getFullYear(), quarterStartMonth, 1);
        endDate = new Date(filters.year || now.getFullYear(), quarterStartMonth + 3, 0);
        // Set start date to 00:00 AM for quarterly periods
        startDate.setHours(0, 0, 0, 0);
        break;

      default:
        throw new Error(`Unsupported period: ${filters.period}`);
    }

    // Set end date to next day at 12:00 AM (00:00:00.000) for all periods
    endDate.setDate(endDate.getDate() + 1);
    endDate.setHours(0, 0, 0, 0);

    return { startDate, endDate };
  }

  
  convertUnits(quantityInKg: number, targetUnit: 'kg' | 'tonnes'): number {
    if (targetUnit === 'tonnes') {
      return quantityInKg / 1000;
    }
    return quantityInKg;
  }

 
  getQuarterName(quarter: number): string {
    const quarterNames = {
      1: '1st Quarter (Jan-Mar)',
      2: '2nd Quarter (Apr-Jun)',
      3: '3rd Quarter (Jul-Sep)',
      4: '4th Quarter (Oct-Dec)',
    };
    return quarterNames[quarter as keyof typeof quarterNames] || 'Unknown Quarter';
  }

  
  private async getEmployeeReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
      try {
        let paramIndex = 1;
        const params: any[] = [];

        // If specific employees are requested, ensure they all appear in results
        if (filters.employees && filters.employees.length > 0) {
          let query = `
            SELECT 
              CONCAT(u."firstName", ' ', COALESCE(u."middleName", ''), ' ', u."lastName") as name,
              COALESCE(SUM(
                CASE 
                  WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
                  ELSE gp."netWeight"
                END
              ), 0) as quantity,
              COALESCE(SUM(gp.amount), 0) as amount
            FROM employees u
            LEFT JOIN grns g ON u.id = g.createdby_id 
              AND g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
          `;

          params.push(filters.units, dateRange.startDate, dateRange.endDate);
          paramIndex += 3;

          // Add company filter to JOIN condition (companyNames are actually company IDs)
          if (filters.companyNames && filters.companyNames.length > 0) {
            query += ` AND g.company_id = ANY($${paramIndex})`;
            params.push(filters.companyNames);
            paramIndex++;
          }

          // Add source filter to JOIN condition
          const sourceFilter = this.buildSourceFilterWithParamsForGRN(filters, paramIndex);
          if (sourceFilter.filter) {
            query += ` ${sourceFilter.filter}`;
            params.push(...sourceFilter.params);
            paramIndex += sourceFilter.params.length;
          }

          query += `
            LEFT JOIN grn_products gp ON g.id = gp.grn_id
          `;

          // Add product filter to JOIN condition
          if (filters.products && filters.products.length > 0) {
            query += ` AND gp.product_id = ANY($${paramIndex})`;
            params.push(filters.products);
            paramIndex++;
          }

          // Filter by specific employees
          query += `
            WHERE u.id = ANY($${paramIndex})
            GROUP BY u.id, u."firstName", u."middleName", u."lastName"
            ORDER BY amount DESC
          `;
          params.push(filters.employees);

          const result = await AppDataSource.query(query, params);

          return result.map((row: any) => ({
            name: row.name,
            quantity: parseFloat(row.quantity) || 0,
            amount: parseFloat(row.amount) || 0,
          }));
        }

        // Original query for when no specific employees are requested
        let query = `
          SELECT 
            CONCAT(u."firstName", ' ', COALESCE(u."middleName", ''), ' ', u."lastName") as name,
            COALESCE(SUM(
              CASE 
                WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
                ELSE gp."netWeight"
              END
            ), 0) as quantity,
            COALESCE(SUM(gp.amount), 0) as amount
          FROM employees u
          LEFT JOIN grns g ON u.id = g.createdby_id
          LEFT JOIN grn_products gp ON g.id = gp.grn_id
          WHERE g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
        `;

        params.push(filters.units, dateRange.startDate, dateRange.endDate);
        paramIndex += 3;

        // Add company filter (companyNames are actually company IDs)
        if (filters.companyNames && filters.companyNames.length > 0) {
          query += ` AND g.company_id = ANY($${paramIndex})`;
          params.push(filters.companyNames);
          paramIndex++;
        }

        // Add product filter
        if (filters.products && filters.products.length > 0) {
          query += ` AND gp.product_id = ANY($${paramIndex})`;
          params.push(filters.products);
          paramIndex++;
        }

        // Add source filter
        const sourceFilter = this.buildSourceFilterWithParamsForGRN(filters, paramIndex);
        if (sourceFilter.filter) {
          query += ` ${sourceFilter.filter}`;
          params.push(...sourceFilter.params);
        }

        query += `
          GROUP BY u.id, u."firstName", u."middleName", u."lastName"
          HAVING SUM(gp."netWeight") > 0
          ORDER BY amount DESC
        `;

        const result = await AppDataSource.query(query, params);

        return result.map((row: any) => ({
          name: row.name,
          quantity: parseFloat(row.quantity) || 0,
          amount: parseFloat(row.amount) || 0,
        }));
      } catch (error) {
        logger.error('Error in getEmployeeReport:', error);
        throw error;
      }
    }


  private async getLocationReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
      try {
        let paramIndex = 1;
        const params: any[] = [];

        // If specific locations are requested, ensure they all appear in results
        if (filters.locations && filters.locations.length > 0) {
          let query = `
            SELECT 
              b.name as name,
              COALESCE(SUM(
                CASE 
                  WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
                  ELSE gp."netWeight"
                END
              ), 0) as quantity,
              COALESCE(SUM(gp.amount), 0) as amount
            FROM branches b
            LEFT JOIN addresses a ON b."addressId" = a.id
            LEFT JOIN grns g ON b.id = g.purchaselocation_id 
              AND g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
          `;

          params.push(filters.units, dateRange.startDate, dateRange.endDate);
          paramIndex += 3;

          // Add company filter to JOIN condition (companyNames are actually company IDs)
          if (filters.companyNames && filters.companyNames.length > 0) {
            query += ` AND g.company_id = ANY($${paramIndex})`;
            params.push(filters.companyNames);
            paramIndex++;
          }

          // Add source filter to JOIN condition
          const sourceFilter = this.buildSourceFilterWithParamsForGRN(filters, paramIndex);
          if (sourceFilter.filter) {
            query += ` ${sourceFilter.filter}`;
            params.push(...sourceFilter.params);
            paramIndex += sourceFilter.params.length;
          }

          query += `
            LEFT JOIN grn_products gp ON g.id = gp.grn_id
          `;

          // Add product filter to JOIN condition
          if (filters.products && filters.products.length > 0) {
            query += ` AND gp.product_id = ANY($${paramIndex})`;
            params.push(filters.products);
            paramIndex++;
          }

          // Filter by specific locations
          query += `
            WHERE b.id = ANY($${paramIndex})
            GROUP BY b.name, b.id
            HAVING b.name IS NOT NULL
            ORDER BY amount DESC
          `;
          params.push(filters.locations);

          const result = await AppDataSource.query(query, params);

          return result.map((row: any) => ({
            name: row.name || 'Unknown Location',
            quantity: parseFloat(row.quantity) || 0,
            amount: parseFloat(row.amount) || 0,
          }));
        }

        // Original query for when no specific locations are requested
        let query = `
          SELECT 
            b.name as name,
            COALESCE(SUM(
              CASE 
                WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
                ELSE gp."netWeight"
              END
            ), 0) as quantity,
            COALESCE(SUM(gp.amount), 0) as amount
          FROM branches b
          LEFT JOIN addresses a ON b."addressId" = a.id
          LEFT JOIN grns g ON b.id = g.purchaselocation_id
          LEFT JOIN grn_products gp ON g.id = gp.grn_id
          WHERE g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
        `;

        params.push(filters.units, dateRange.startDate, dateRange.endDate);
        paramIndex += 3;

        // Add company filter (companyNames are actually company IDs)
        if (filters.companyNames && filters.companyNames.length > 0) {
          query += ` AND g.company_id = ANY($${paramIndex})`;
          params.push(filters.companyNames);
          paramIndex++;
        }

        // Add product filter
        if (filters.products && filters.products.length > 0) {
          query += ` AND gp.product_id = ANY($${paramIndex})`;
          params.push(filters.products);
          paramIndex++;
        }

        // Add source filter
        const sourceFilter = this.buildSourceFilterWithParamsForGRN(filters, paramIndex);
        if (sourceFilter.filter) {
          query += ` ${sourceFilter.filter}`;
          params.push(...sourceFilter.params);
        }

        query += `
          GROUP BY b.name, b.id
          HAVING b.name IS NOT NULL AND SUM(gp."netWeight") > 0
          ORDER BY amount DESC
        `;

        const result = await AppDataSource.query(query, params);

        return result.map((row: any) => ({
          name: row.name || 'Unknown Location',
          quantity: parseFloat(row.quantity) || 0,
          amount: parseFloat(row.amount) || 0,
        }));
      } catch (error) {
    logger.error('Error in getLocationReport:', error);
        throw error;
      }
    }


  private async getCompanyReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
      try {
        let paramIndex = 1;
        const params: any[] = [];

        // If specific companies are requested, ensure they all appear in results
        if (filters.companyNames && filters.companyNames.length > 0) {
          let query = `
            SELECT 
              c.name as name,
              COALESCE(SUM(
                CASE 
                  WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
                  ELSE gp."netWeight"
                END
              ), 0) as quantity,
              COALESCE(SUM(gp.amount), 0) as amount
            FROM company c
            LEFT JOIN grns g ON c.id = g.company_id 
              AND g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
          `;

          params.push(filters.units, dateRange.startDate, dateRange.endDate);
          paramIndex += 3;

          // Add source filter to JOIN condition
          const sourceFilter = this.buildSourceFilterWithParamsForGRN(filters, paramIndex);
          if (sourceFilter.filter) {
            query += ` ${sourceFilter.filter}`;
            params.push(...sourceFilter.params);
            paramIndex += sourceFilter.params.length;
          }

          query += `
            LEFT JOIN grn_products gp ON g.id = gp.grn_id
          `;

          // Add product filter to JOIN condition
          if (filters.products && filters.products.length > 0) {
            query += ` AND gp.product_id = ANY($${paramIndex})`;
            params.push(filters.products);
            paramIndex++;
          }

          // Filter by specific companies (companyNames are actually company IDs)
          query += `
            WHERE c.id = ANY($${paramIndex})
            GROUP BY c.id, c.name
            ORDER BY amount DESC
          `;
          params.push(filters.companyNames);

          const result = await AppDataSource.query(query, params);

          return result.map((row: any) => ({
            name: row.name,
            quantity: parseFloat(row.quantity) || 0,
            amount: parseFloat(row.amount) || 0,
          }));
        }

        // Original query for when no specific companies are requested
        let query = `
          SELECT 
            c.name as name,
            COALESCE(SUM(
              CASE 
                WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
                ELSE gp."netWeight"
              END
            ), 0) as quantity,
            COALESCE(SUM(gp.amount), 0) as amount
          FROM company c
          LEFT JOIN grns g ON c.id = g.company_id
          LEFT JOIN grn_products gp ON g.id = gp.grn_id
          WHERE g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
        `;

        params.push(filters.units, dateRange.startDate, dateRange.endDate);
        paramIndex += 3;

        // Add product filter
        if (filters.products && filters.products.length > 0) {
          query += ` AND gp.product_id = ANY($${paramIndex})`;
          params.push(filters.products);
          paramIndex++;
        }

        // Add source filter
        const sourceFilter = this.buildSourceFilterWithParamsForGRN(filters, paramIndex);
        if (sourceFilter.filter) {
          query += ` ${sourceFilter.filter}`;
          params.push(...sourceFilter.params);
        }

        query += `
          GROUP BY c.id, c.name
          HAVING SUM(gp."netWeight") > 0
          ORDER BY amount DESC
        `;

        const result = await AppDataSource.query(query, params);

        return result.map((row: any) => ({
          name: row.name,
          quantity: parseFloat(row.quantity) || 0,
          amount: parseFloat(row.amount) || 0,
        }));
      } catch (error) {
        logger.error('Error in getCompanyReport:', error);
        throw error;
      }
    }


  private async getSourceReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
    try {
      let paramIndex = 1;
      const params: any[] = [];
      
      let query = `
        SELECT 
          CASE 
            WHEN g.vendor_id IS NOT NULL THEN 'Vendor'
            WHEN g.farmer_id IS NOT NULL THEN 'Farmer'
            ELSE 'Unknown'
          END as name,
          SUM(
            CASE 
              WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
              ELSE gp."netWeight"
            END
          ) as quantity,
          SUM(gp.amount) as amount
        FROM grns g
        LEFT JOIN grn_products gp ON g.id = gp.grn_id
        WHERE g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
      `;
      
      params.push(filters.units, dateRange.startDate, dateRange.endDate);
      paramIndex += 3;

      // Add company filter
      if (filters.companyNames && filters.companyNames.length > 0) {
        const companyParams = filters.companyNames.map(() => `$${paramIndex++}`).join(',');
        query += ` AND g.company_id IN (SELECT id FROM company WHERE name IN (${companyParams}))`;
        params.push(...filters.companyNames);
      }

      // Add product filter
      if (filters.products && filters.products.length > 0) {
        const productParams = filters.products.map(() => `$${paramIndex++}`).join(',');
        query += ` AND gp.product_id IN (${productParams})`;
        params.push(...filters.products);
      }

      // Add source filter
      const sourceFilter = this.buildSourceFilterWithParamsForGRN(filters, paramIndex);
      if (sourceFilter.filter) {
        query += ` ${sourceFilter.filter}`;
        params.push(...sourceFilter.params);
      }

      query += `
        GROUP BY source_type
        ORDER BY amount DESC
      `;

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        name: row.name,
        quantity: parseFloat(row.quantity) || 0,
        amount: parseFloat(row.amount) || 0,
      }));
    } catch (error) {
      logger.error('Error in getSourceReport:', error);
      throw error;
    }
  }

  private async getVendorReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
      try {
        let paramIndex = 1;
        const params: any[] = [];

        // If specific vendors are requested, ensure they all appear in results
        if (filters.vendors && filters.vendors.length > 0) {
          let query = `
            SELECT 
              v.company_name as name,
              COALESCE(SUM(
                CASE 
                  WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
                  ELSE gp."netWeight"
                END
              ), 0) as quantity,
              COALESCE(SUM(gp.amount), 0) as amount
            FROM vendor v
            LEFT JOIN grns g ON v.id = g.vendor_id 
              AND g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
          `;
          
          params.push(filters.units, dateRange.startDate, dateRange.endDate);
          paramIndex += 3;

          // Add company filter to JOIN condition (companyNames are actually company IDs)
          if (filters.companyNames && filters.companyNames.length > 0) {
            const companyParams = filters.companyNames.map(() => `$${paramIndex++}`).join(',');
            query += ` AND g.company_id IN (${companyParams})`;
            params.push(...filters.companyNames);
          }

          query += `
            LEFT JOIN grn_products gp ON g.id = gp.grn_id
          `;

          // Add product filter to JOIN condition
          if (filters.products && filters.products.length > 0) {
            const productParams = filters.products.map(() => `$${paramIndex++}`).join(',');
            query += ` AND gp.product_id IN (${productParams})`;
            params.push(...filters.products);
          }

          // Filter by specific vendors
          const vendorParams = filters.vendors.map(() => `$${paramIndex++}`).join(',');
          query += `
            WHERE v.id IN (${vendorParams})
            GROUP BY v.id, v.company_name
            ORDER BY amount DESC
          `;
          params.push(...filters.vendors);

          const result = await AppDataSource.query(query, params);

          return result.map((row: any) => ({
            name: row.name,
            quantity: parseFloat(row.quantity) || 0,
            amount: parseFloat(row.amount) || 0,
          }));
        }

        // Original query for when no specific vendors are requested
        let query = `
          SELECT 
            v.company_name as name,
            SUM(
              CASE 
                WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
                ELSE gp."netWeight"
              END
            ) as quantity,
            SUM(gp.amount) as amount
          FROM vendor v
          LEFT JOIN grns g ON v.id = g.vendor_id
          LEFT JOIN grn_products gp ON g.id = gp.grn_id
          WHERE g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
        `;

        params.push(filters.units, dateRange.startDate, dateRange.endDate);
        paramIndex += 3;

        // Add company filter (companyNames are actually company IDs)
        if (filters.companyNames && filters.companyNames.length > 0) {
          const companyParams = filters.companyNames.map(() => `$${paramIndex++}`).join(',');
          query += ` AND g.company_id IN (${companyParams})`;
          params.push(...filters.companyNames);
        }

        // Add product filter
        if (filters.products && filters.products.length > 0) {
          const productParams = filters.products.map(() => `$${paramIndex++}`).join(',');
          query += ` AND gp.product_id IN (${productParams})`;
          params.push(...filters.products);
        }

        query += `
          GROUP BY v.id, v.company_name
          HAVING SUM(gp."netWeight") > 0
          ORDER BY amount DESC
        `;

        const result = await AppDataSource.query(query, params);

        return result.map((row: any) => ({
          name: row.name,
          quantity: parseFloat(row.quantity) || 0,
          amount: parseFloat(row.amount) || 0,
        }));
      } catch (error) {
    logger.error('Error in getVendorReport:', error);
        throw error;
      }
    }


  private async getFarmerReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
      try {
        let paramIndex = 1;
        const params: any[] = [];

        // If specific farmers are requested, ensure they all appear in results
        if (filters.farmers && filters.farmers.length > 0) {
          let query = `
            SELECT 
              CONCAT(f."farmerfName", ' ', COALESCE(f."farmermName", ''), ' ', f."farmerlName") as name,
              COALESCE(SUM(
                CASE 
                  WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
                  ELSE gp."netWeight"
                END
              ), 0) as quantity,
              COALESCE(SUM(gp.amount), 0) as amount
            FROM farmer f
            LEFT JOIN grns g ON f.id = g.farmer_id 
              AND g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
          `;

          params.push(filters.units, dateRange.startDate, dateRange.endDate);
          paramIndex += 3;

          // Add company filter to JOIN condition (companyNames are actually company IDs)
          if (filters.companyNames && filters.companyNames.length > 0) {
            query += ` AND g.company_id = ANY($${paramIndex})`;
            params.push(filters.companyNames);
            paramIndex++;
          }

          query += `
            LEFT JOIN grn_products gp ON g.id = gp.grn_id
          `;

          // Add product filter to JOIN condition
          if (filters.products && filters.products.length > 0) {
            query += ` AND gp.product_id = ANY($${paramIndex})`;
            params.push(filters.products);
            paramIndex++;
          }

          // Filter by specific farmers
          query += `
            WHERE f.id = ANY($${paramIndex})
            GROUP BY f.id, f."farmerfName", f."farmermName", f."farmerlName"
            ORDER BY amount DESC
          `;
          params.push(filters.farmers);

          const result = await AppDataSource.query(query, params);

          return result.map((row: any) => ({
            name: row.name,
            quantity: parseFloat(row.quantity) || 0,
            amount: parseFloat(row.amount) || 0,
          }));
        }

        // Original query for when no specific farmers are requested
        let query = `
          SELECT 
            CONCAT(f."farmerfName", ' ', COALESCE(f."farmermName", ''), ' ', f."farmerlName") as name,
            COALESCE(SUM(
              CASE 
                WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
                ELSE gp."netWeight"
              END
            ), 0) as quantity,
            COALESCE(SUM(gp.amount), 0) as amount
          FROM farmer f
          LEFT JOIN grns g ON f.id = g.farmer_id
          LEFT JOIN grn_products gp ON g.id = gp.grn_id
          WHERE g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
        `;

        params.push(filters.units, dateRange.startDate, dateRange.endDate);
        paramIndex += 3;

        // Add company filter (companyNames are actually company IDs)
        if (filters.companyNames && filters.companyNames.length > 0) {
          query += ` AND g.company_id = ANY($${paramIndex})`;
          params.push(filters.companyNames);
          paramIndex++;
        }

        // Add product filter
        if (filters.products && filters.products.length > 0) {
          query += ` AND gp.product_id = ANY($${paramIndex})`;
          params.push(filters.products);
          paramIndex++;
        }

        query += `
          GROUP BY f.id, f."farmerfName", f."farmermName", f."farmerlName"
          HAVING SUM(gp."netWeight") > 0
          ORDER BY amount DESC
        `;

        const result = await AppDataSource.query(query, params);

        return result.map((row: any) => ({
          name: row.name,
          quantity: parseFloat(row.quantity) || 0,
          amount: parseFloat(row.amount) || 0,
        }));
      } catch (error) {
        logger.error('Error in getFarmerReport:', error);
        throw error;
      }
    }


  private async getProductReport(filters: ReportFilters, dateRange: DateRange): Promise<ReportData[]> {
      try {
        let paramIndex = 1;
        const params: any[] = [];

        // If specific products are requested, ensure they all appear in results
        if (filters.products && filters.products.length > 0) {
          let query = `
            SELECT 
              p.product_name as name,
              COALESCE(SUM(
                CASE 
                  WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
                  ELSE gp."netWeight"
                END
              ), 0) as quantity,
              COALESCE(SUM(gp.amount), 0) as amount
            FROM product p
            LEFT JOIN grn_products gp ON p.id = gp.product_id
            LEFT JOIN grns g ON gp.grn_id = g.id 
              AND g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
          `;

          params.push(filters.units, dateRange.startDate, dateRange.endDate);
          paramIndex += 3;

          // Add company filter to JOIN condition (companyNames are actually company IDs)
          if (filters.companyNames && filters.companyNames.length > 0) {
            query += ` AND g.company_id = ANY($${paramIndex})`;
            params.push(filters.companyNames);
            paramIndex++;
          }

          // Add source filter to JOIN condition
          const sourceFilter = this.buildSourceFilterWithParamsForGRN(filters, paramIndex);
          if (sourceFilter.filter) {
            query += ` ${sourceFilter.filter}`;
            params.push(...sourceFilter.params);
            paramIndex += sourceFilter.params.length;
          }

          // Filter by specific products
          query += `
            WHERE p.id = ANY($${paramIndex})
            GROUP BY p.id, p.product_name
            ORDER BY amount DESC
          `;
          params.push(filters.products);

          const result = await AppDataSource.query(query, params);

          return result.map((row: any) => ({
            name: row.name,
            quantity: parseFloat(row.quantity) || 0,
            amount: parseFloat(row.amount) || 0,
          }));
        }

        // Original query for when no specific products are requested
        let query = `
          SELECT 
            p.product_name as name,
            COALESCE(SUM(
              CASE 
                WHEN $${paramIndex} = 'tonnes' THEN gp."netWeight" / 1000
                ELSE gp."netWeight"
              END
            ), 0) as quantity,
            COALESCE(SUM(gp.amount), 0) as amount
          FROM product p
          LEFT JOIN grn_products gp ON p.id = gp.product_id
          LEFT JOIN grns g ON gp.grn_id = g.id
          WHERE g."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
        `;

        params.push(filters.units, dateRange.startDate, dateRange.endDate);
        paramIndex += 3;

        // Add company filter (companyNames are actually company IDs)
        if (filters.companyNames && filters.companyNames.length > 0) {
          query += ` AND g.company_id = ANY($${paramIndex})`;
          params.push(filters.companyNames);
          paramIndex++;
        }

        // Add source filter
        const sourceFilter = this.buildSourceFilterWithParamsForGRN(filters, paramIndex);
        if (sourceFilter.filter) {
          query += ` ${sourceFilter.filter}`;
          params.push(...sourceFilter.params);
        }

        query += `
          GROUP BY p.id, p.product_name
          HAVING SUM(gp."netWeight") > 0
          ORDER BY amount DESC
        `;

        const result = await AppDataSource.query(query, params);

        return result.map((row: any) => ({
          name: row.name,
          quantity: parseFloat(row.quantity) || 0,
          amount: parseFloat(row.amount) || 0,
        }));
      } catch (error) {
        logger.error('Error in getProductReport:', error);
        throw error;
      }
    }


  private buildSourceFilterWithParamsForGRN(filters: ReportFilters, startIndex: number): { filter: string; params: any[] } {
    let sourceFilter = '';
    const params: any[] = [];
    let paramIndex = startIndex;
    
    if (filters.source === 'vendor' && filters.vendors && filters.vendors.length > 0) {
      const vendorParams = filters.vendors.map(() => `$${paramIndex++}`).join(',');
      sourceFilter = `AND g.vendor_id IN (${vendorParams})`;
      params.push(...filters.vendors);
    } else if (filters.source === 'farmer' && filters.farmers && filters.farmers.length > 0) {
      const farmerParams = filters.farmers.map(() => `$${paramIndex++}`).join(',');
      sourceFilter = `AND g.farmer_id IN (${farmerParams})`;
      params.push(...filters.farmers);
    } else if (filters.source === 'vendor') {
      sourceFilter = 'AND g.vendor_id IS NOT NULL';
    } else if (filters.source === 'farmer') {
      sourceFilter = 'AND g.farmer_id IS NOT NULL';
    } else if (filters.vendors && filters.vendors.length > 0) {
      const vendorParams = filters.vendors.map(() => `$${paramIndex++}`).join(',');
      sourceFilter = `AND g.vendor_id IN (${vendorParams})`;
      params.push(...filters.vendors);
    } else if (filters.farmers && filters.farmers.length > 0) {
      const farmerParams = filters.farmers.map(() => `$${paramIndex++}`).join(',');
      sourceFilter = `AND g.farmer_id IN (${farmerParams})`;
      params.push(...filters.farmers);
    }
    
    return { filter: sourceFilter, params };
  }

  async generateExcelReport(filters: ReportFilters): Promise<Buffer | null> {
    try {
      // Get the report data
      const reportData = await this.generateReport(filters);
      
      if (!reportData || reportData.length === 0) {
        return null;
      }

      // Create a new workbook and worksheet
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Procurement Report');

      // Set column widths
      worksheet.columns = [
        { width: 20 }, // Column A - Labels
        { width: 50 }, // Column B - Values (increased for wrapped text)
        { width: 15 }, // Column C - Quantity/Amount
      ];

      // Enable automatic row height adjustment for wrapped text
      worksheet.properties.defaultRowHeight = 15;

      // Add title row
      const titleRow = worksheet.addRow(['Procurement Report']);
      
      titleRow.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFF00' } // Yellow background
      };
      titleRow.getCell(1).font = { bold: true, size: 16 };
      titleRow.getCell(1).alignment = { horizontal: 'center' };
      worksheet.mergeCells('A1:C1');

      // Add empty row
      worksheet.addRow([]);

      // Add filter information
      worksheet.addRow(['Report For:']);
      
      // Add company information
      const companyNames = await this.getCompanyNames(filters.companyNames);
      const companyRow = worksheet.addRow(['Companies:', companyNames]);
      companyRow.getCell(1).font = { bold: true };
      companyRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      // Add location information
      const locationNames = await this.getLocationNames(filters.locations);
      const locationRow = worksheet.addRow(['Locations:', locationNames]);
      locationRow.getCell(1).font = { bold: true };
      locationRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      // Add procurement source
      const sourceText = filters.source || 'All';
      const sourceRow = worksheet.addRow(['Procurement Source:', sourceText]);
      sourceRow.getCell(1).font = { bold: true };
      sourceRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      // Add vendor names
      const vendorNames = await this.getVendorNames(filters.vendors);
      const vendorRow = worksheet.addRow(['Vendor Names:', vendorNames]);
      vendorRow.getCell(1).font = { bold: true };
      vendorRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      // Add farmer names
      const farmerNames = await this.getFarmerNames(filters.farmers);
      const farmerRow = worksheet.addRow(['Farmer Names:', farmerNames]);
      farmerRow.getCell(1).font = { bold: true };
      farmerRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      // Add employee information
      const employeeNames = await this.getEmployeeNames(filters.employees);
      const employeeRow = worksheet.addRow(['Employees:', employeeNames]);
      employeeRow.getCell(1).font = { bold: true };
      employeeRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      // Add product information
      const productNames = await this.getProductNames(filters.products);
      const productRow = worksheet.addRow(['Products:', productNames]);
      productRow.getCell(1).font = { bold: true };
      productRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      // Add unit information
      const unitRow = worksheet.addRow(['Unit:', filters.units || 'kg']);
      unitRow.getCell(1).font = { bold: true };
      unitRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      // Add period information
      let periodText = '';
      if (filters.period === 'custom' && filters.startDate && filters.endDate) {
        const startDate = new Date(filters.startDate).toLocaleDateString('en-GB');
        const endDate = new Date(filters.endDate).toLocaleDateString('en-GB');
        periodText = `${startDate} To ${endDate}`;
      } else {
        periodText = filters.period;
      }
      const periodRow = worksheet.addRow(['Period:', periodText]);
      periodRow.getCell(1).font = { bold: true };
      periodRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      // Add generated at information
      const now = new Date();
      const generatedAtText = now.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      const generatedAtRow = worksheet.addRow(['Generated At:', generatedAtText]);
      generatedAtRow.getCell(1).font = { bold: true };
      generatedAtRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      // Add empty row before data table
      worksheet.addRow([]);

      // Add table headers
      const headerRow = worksheet.addRow([
        filters.reportBased === 'product' ? 'Product Name' : 
        filters.reportBased === 'vendor' ? 'Vendor Name' :
        filters.reportBased === 'farmer' ? 'Farmer Name' :
        filters.reportBased === 'employee' ? 'Employee Name' :
        filters.reportBased === 'location' ? 'Location' :
        filters.reportBased === 'company' ? 'Company Name' :
        'Source Name',
        'Quantity',
        'Amount'
      ]);

      // Style header row
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'ADD8E6' } // Light blue background
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

      // Add data rows
      reportData.forEach((item) => {
        const dataRow = worksheet.addRow([
          item.name,
          Math.round(item.quantity),
          Math.round(item.amount)
        ]);

        // Style data rows
        dataRow.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
          
          // Add text wrapping and alignment
          if (colNumber === 1) {
            // Name column - wrap text and align top
            cell.alignment = { wrapText: true, vertical: 'top' };
          } else {
            // Number columns - right align and top vertical align
            cell.alignment = { horizontal: 'right', vertical: 'top' };
          }
        });
      });

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);

    } catch (error) {
      logger.error('Error generating Excel report:', error);
      throw error;
    }
  }

  // Helper methods to get actual names or "All"
  private async getCompanyNames(companyIds?: string[]): Promise<string> {
    if (!companyIds || companyIds.length === 0) {
      return 'All';
    }
    
    try {
      const query = `SELECT name FROM company WHERE id = ANY($1)`;
      const result = await AppDataSource.query(query, [companyIds]);
      return result.map((row: any) => row.name).join(', ');
    } catch (error) {
      logger.error('Error fetching company names:', error);
      return 'Selected Companies';
    }
  }

  private async getLocationNames(locationIds?: string[]): Promise<string> {
    if (!locationIds || locationIds.length === 0) {
      return 'All';
    }
    
    try {
      const query = `
        SELECT b.name as location_name 
        FROM branches b
        WHERE b.id = ANY($1)
      `;
      const result = await AppDataSource.query(query, [locationIds]);
      return result.map((row: any) => row.location_name).join(', ');
    } catch (error) {
    logger.error('Error fetching location names:', error);
      return 'Selected Locations';
    }
  }

  private async getVendorNames(vendorIds?: string[]): Promise<string> {
    if (!vendorIds || vendorIds.length === 0) {
      return 'All';
    }
    
    try {
      const query = `SELECT company_name FROM vendor WHERE id = ANY($1)`;
      const result = await AppDataSource.query(query, [vendorIds]);
      return result.map((row: any) => row.company_name).join(', ');
    } catch (error) {
      logger.error('Error fetching vendor names:', error);
      return 'Selected Vendors';
    }
  }

  private async getFarmerNames(farmerIds?: string[]): Promise<string> {
    if (!farmerIds || farmerIds.length === 0) {
      return 'All';
    }
    
    try {
      const query = `
        SELECT CONCAT("farmerfName", ' ', COALESCE("farmermName", ''), ' ', "farmerlName") as farmer_name 
        FROM farmer 
        WHERE id = ANY($1)
      `;
      const result = await AppDataSource.query(query, [farmerIds]);
      return result.map((row: any) => row.farmer_name).join(', ');
    } catch (error) {
      logger.error('Error fetching farmer names:', error);
      return 'Selected Farmers';
    }
  }

  private async getEmployeeNames(employeeIds?: string[]): Promise<string> {
    if (!employeeIds || employeeIds.length === 0) {
      return 'All';
    }
    
    try {
      const query = `
        SELECT CONCAT("firstName", ' ', COALESCE("middleName", ''), ' ', "lastName") as employee_name 
        FROM employees 
        WHERE id = ANY($1)
      `;
      const result = await AppDataSource.query(query, [employeeIds]);
      return result.map((row: any) => row.employee_name).join(', ');
    } catch (error) {
      logger.error('Error fetching employee names:', error);
      return 'Selected Employees';
    }
  }

  private async getProductNames(productIds?: string[]): Promise<string> {
    if (!productIds || productIds.length === 0) {
      return 'All';
    }
    
    try {
      const query = `SELECT product_name FROM product WHERE id = ANY($1)`;
      const result = await AppDataSource.query(query, [productIds]);
      return result.map((row: any) => row.product_name).join(', ');
    } catch (error) {
      logger.error('Error fetching product names:', error);
      return 'Selected Products';
    }
  }

  // ==================== SALES REPORT METHODS ====================

  async generateSalesReport(filters: any): Promise<ReportData[]> {
    try {
   
      const dateRange = this.buildDateRange(filters);
      
      switch (filters.reportBased) {
        case 'employee':
          return await this.getSalesEmployeeReport(filters, dateRange);
        case 'location':
          return await this.getSalesLocationReport(filters, dateRange);
        case 'company':
          return await this.getSalesCompanyReport(filters, dateRange);
        case 'customer':
          return await this.getSalesCustomerReport(filters, dateRange);
        case 'product':
          return await this.getSalesProductReport(filters, dateRange);
        default:
          throw new Error(`Unsupported sales report type: ${filters.reportBased}`);
      }
    } catch (error) {
      logger.error('Error generating sales report:', error);
      throw error;
    }
  }

  private async getSalesEmployeeReport(filters: any, dateRange: DateRange): Promise<ReportData[]> {
    try {
      let paramIndex = 1;
      const params: any[] = [];
      
      let query = `
        SELECT 
          CONCAT(u."firstName", ' ', COALESCE(u."middleName", ''), ' ', u."lastName") as name,
          SUM(
            CASE 
              WHEN $${paramIndex} = 'tonnes' THEN i."netWeight" / 1000
              ELSE i."netWeight"
            END
          ) as quantity,
          SUM(i.amount) as amount
        FROM employees u
        LEFT JOIN delivery_challan_purchase dc ON u.id = dc.created_by
        LEFT JOIN d_items i ON dc.id = i."deliveryChallanId"
        WHERE dc.type = 'customer_delivery_challan'
          AND dc."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
      `;
      
      params.push(filters.units, dateRange.startDate, dateRange.endDate);
      paramIndex += 3;

      if (filters.employees && filters.employees.length > 0) {
        query += ` AND u.id = ANY($${paramIndex})`;
        params.push(filters.employees);
        paramIndex++;
      }

      if (filters.companyNames && filters.companyNames.length > 0) {
        query += ` AND dc.company_id IN (SELECT id FROM company WHERE name = ANY($${paramIndex}))`;
        params.push(filters.companyNames);
        paramIndex++;
      }

      if (filters.locations && filters.locations.length > 0) {
        query += ` AND dc.office_id = ANY($${paramIndex})`;
        params.push(filters.locations);
        paramIndex++;
      }

      if (filters.customers && filters.customers.length > 0) {
        query += ` AND dc.customer_id = ANY($${paramIndex})`;
        params.push(filters.customers);
        paramIndex++;
      }

      if (filters.products && filters.products.length > 0) {
        query += ` AND i.product_id = ANY($${paramIndex})`;
        params.push(filters.products);
        paramIndex++;
      }

      query += `
        GROUP BY u.id, u."firstName", u."middleName", u."lastName"
        HAVING SUM(i."netWeight") > 0
        ORDER BY amount DESC
      `;

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        name: row.name,
        quantity: parseFloat(row.quantity) || 0,
        amount: parseFloat(row.amount) || 0,
      }));
    } catch (error) {
      logger.error('Error in getSalesEmployeeReport:', error);
      throw error;
    }
  }

  private async getSalesLocationReport(filters: any, dateRange: DateRange): Promise<ReportData[]> {
    try {
      let paramIndex = 1;
      const params: any[] = [];
      
      let query = `
        SELECT 
          CONCAT(a.city, ', ', a.state) as name,
          SUM(
            CASE 
              WHEN $${paramIndex} = 'tonnes' THEN i."netWeight" / 1000
              ELSE i."netWeight"
            END
          ) as quantity,
          SUM(i.amount) as amount
        FROM addresses a
        LEFT JOIN offices_data od ON a.id = od."addressId"
        LEFT JOIN delivery_challan_purchase dc ON od.id = dc.office_id
        LEFT JOIN d_items i ON dc.id = i."deliveryChallanId"
        WHERE dc.type = 'customer_delivery_challan'
          AND dc."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
      `;
      
      params.push(filters.units, dateRange.startDate, dateRange.endDate);
      paramIndex += 3;

      if (filters.companyNames && filters.companyNames.length > 0) {
        query += ` AND dc.company_id IN (SELECT id FROM company WHERE name = ANY($${paramIndex}))`;
        params.push(filters.companyNames);
        paramIndex++;
      }

      if (filters.locations && filters.locations.length > 0) {
        query += ` AND od.id = ANY($${paramIndex})`;
        params.push(filters.locations);
        paramIndex++;
      }

      if (filters.customers && filters.customers.length > 0) {
        query += ` AND dc.customer_id = ANY($${paramIndex})`;
        params.push(filters.customers);
        paramIndex++;
      }

      if (filters.products && filters.products.length > 0) {
        query += ` AND i.product_id = ANY($${paramIndex})`;
        params.push(filters.products);
        paramIndex++;
      }

      query += `
        GROUP BY a.city, a.state
        HAVING SUM(i."netWeight") > 0
        ORDER BY amount DESC
      `;

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        name: row.name,
        quantity: parseFloat(row.quantity) || 0,
        amount: parseFloat(row.amount) || 0,
      }));
    } catch (error) {
      logger.error('Error in getSalesLocationReport:', error);
      throw error;
    }
  }

  private async getSalesCompanyReport(filters: any, dateRange: DateRange): Promise<ReportData[]> {
    try {
      let paramIndex = 1;
      const params: any[] = [];
      
      let query = `
        SELECT 
          c.name as name,
          SUM(
            CASE 
              WHEN $${paramIndex} = 'tonnes' THEN i."netWeight" / 1000
              ELSE i."netWeight"
            END
          ) as quantity,
          SUM(i.amount) as amount
        FROM company c
        LEFT JOIN delivery_challan_purchase dc ON c.id = dc.company_id
        LEFT JOIN d_items i ON dc.id = i."deliveryChallanId"
        WHERE dc.type = 'customer_delivery_challan'
          AND dc."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
      `;
      
      params.push(filters.units, dateRange.startDate, dateRange.endDate);
      paramIndex += 3;

      if (filters.companyNames && filters.companyNames.length > 0) {
        query += ` AND c.name = ANY($${paramIndex})`;
        params.push(filters.companyNames);
        paramIndex++;
      }

      if (filters.locations && filters.locations.length > 0) {
        query += ` AND dc.office_id = ANY($${paramIndex})`;
        params.push(filters.locations);
        paramIndex++;
      }

      if (filters.customers && filters.customers.length > 0) {
        query += ` AND dc.customer_id = ANY($${paramIndex})`;
        params.push(filters.customers);
        paramIndex++;
      }

      if (filters.products && filters.products.length > 0) {
        query += ` AND i.product_id = ANY($${paramIndex})`;
        params.push(filters.products);
        paramIndex++;
      }

      query += `
        GROUP BY c.id, c.name
        HAVING SUM(i."netWeight") > 0
        ORDER BY amount DESC
      `;

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        name: row.name,
        quantity: parseFloat(row.quantity) || 0,
        amount: parseFloat(row.amount) || 0,
      }));
    } catch (error) {
      logger.error('Error in getSalesCompanyReport:', error);
      throw error;
    }
  }

  private async getSalesCustomerReport(filters: any, dateRange: DateRange): Promise<ReportData[]> {
    try {
      let paramIndex = 1;
      const params: any[] = [];
      
      let query = `
        SELECT 
          cust.organisation_name as name,
          SUM(
            CASE 
              WHEN $${paramIndex} = 'tonnes' THEN i."netWeight" / 1000
              ELSE i."netWeight"
            END
          ) as quantity,
          SUM(i.amount) as amount
        FROM customers cust
        LEFT JOIN delivery_challan_purchase dc ON cust.id = dc.customer_id
        LEFT JOIN d_items i ON dc.id = i."deliveryChallanId"
        WHERE dc.type = 'customer_delivery_challan'
          AND dc."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
      `;
      
      params.push(filters.units, dateRange.startDate, dateRange.endDate);
      paramIndex += 3;

      if (filters.customers && filters.customers.length > 0) {
        query += ` AND cust.id = ANY($${paramIndex})`;
        params.push(filters.customers);
        paramIndex++;
      }

      if (filters.companyNames && filters.companyNames.length > 0) {
        query += ` AND dc.company_id IN (SELECT id FROM company WHERE name = ANY($${paramIndex}))`;
        params.push(filters.companyNames);
        paramIndex++;
      }

      if (filters.locations && filters.locations.length > 0) {
        query += ` AND dc.office_id = ANY($${paramIndex})`;
        params.push(filters.locations);
        paramIndex++;
      }

      if (filters.products && filters.products.length > 0) {
        query += ` AND i.product_id = ANY($${paramIndex})`;
        params.push(filters.products);
        paramIndex++;
      }

      query += `
        GROUP BY cust.id, cust.organisation_name
        HAVING SUM(i."netWeight") > 0
        ORDER BY amount DESC
      `;

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        name: row.name,
        quantity: parseFloat(row.quantity) || 0,
        amount: parseFloat(row.amount) || 0,
      }));
    } catch (error) {
    logger.error('Error in getSalesCustomerReport:', error);
      throw error;
    }
  }

  private async getSalesProductReport(filters: any, dateRange: DateRange): Promise<ReportData[]> {
    try {
      let paramIndex = 1;
      const params: any[] = [];
      
      let query = `
        SELECT 
          p.product_name as name,
          SUM(
            CASE 
              WHEN $${paramIndex} = 'tonnes' THEN i."netWeight" / 1000
              ELSE i."netWeight"
            END
          ) as quantity,
          SUM(i.amount) as amount
        FROM product p
        LEFT JOIN d_items i ON p.id = i.product_id
        LEFT JOIN delivery_challan_purchase dc ON i."deliveryChallanId" = dc.id
        WHERE dc.type = 'customer_delivery_challan'
          AND dc."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
      `;
      
      params.push(filters.units, dateRange.startDate, dateRange.endDate);
      paramIndex += 3;

      if (filters.products && filters.products.length > 0) {
        query += ` AND p.id = ANY($${paramIndex})`;
        params.push(filters.products);
        paramIndex++;
      }

      if (filters.companyNames && filters.companyNames.length > 0) {
        query += ` AND dc.company_id IN (SELECT id FROM company WHERE name = ANY($${paramIndex}))`;
        params.push(filters.companyNames);
        paramIndex++;
      }

      if (filters.locations && filters.locations.length > 0) {
        query += ` AND dc.office_id = ANY($${paramIndex})`;
        params.push(filters.locations);
        paramIndex++;
      }

      if (filters.customers && filters.customers.length > 0) {
        query += ` AND dc.customer_id = ANY($${paramIndex})`;
        params.push(filters.customers);
        paramIndex++;
      }

      query += `
        GROUP BY p.id, p.product_name
        HAVING SUM(i."netWeight") > 0
        ORDER BY amount DESC
      `;

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        name: row.name,
        quantity: parseFloat(row.quantity) || 0,
        amount: parseFloat(row.amount) || 0,
      }));
    } catch (error) {
  logger.error('Error in getSalesProductReport:', error);
      throw error;
    }
  }

}