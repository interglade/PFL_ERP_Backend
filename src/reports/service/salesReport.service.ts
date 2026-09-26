import { injectable } from 'inversify';

import * as ExcelJS from 'exceljs';
import { AppDataSource } from '../../utils/data-source';

export interface SalesReportFilters {
  reportBased: 'employee' | 'location' | 'company' | 'customer' | 'product';
  companyNames?: string[];
  locations?: string[];
  employees?: string[];
  customers?: string[];
  units: 'kg' | 'tonnes';
  products?: string[];
  period: 'custom' | 'previous_month' | 'current_month' | 'month_year' | 'quarterly';
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
  quarter?: 1 | 2 | 3 | 4;
}

export interface SalesReportData {
  name: string;
  quantity: number;
  amount: number;
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

@injectable()
export class SalesReportService {
  constructor() {}

  async generateSalesReport(filters: SalesReportFilters): Promise<SalesReportData[]> {
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
      console.error('Error generating sales report:', error);
      throw error;
    }
  }

  private buildDateRange(filters: SalesReportFilters): DateRange {
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

    console.log('📅 Date Range Built:', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      period: filters.period
    });

    return { startDate, endDate };
  }

  private async getSalesEmployeeReport(filters: SalesReportFilters, dateRange: DateRange): Promise<SalesReportData[]> {
        try {
          let paramIndex = 1;
          const params: any[] = [];

          let query = `
            SELECT 
              CONCAT(u."firstName", ' ', COALESCE(u."middleName", ''), ' ', u."lastName") as name,
              COALESCE(SUM(
                CASE 
                  WHEN $${paramIndex} = 'tonnes' THEN i."netWeight" / 1000
                  ELSE i."netWeight"
                END
              ), 0) as quantity,
              COALESCE(SUM(i.amount), 0) as amount
            FROM employees u
            LEFT JOIN delivery_challan_purchase dc ON u.id = dc.created_by 
              AND dc.type = 'customer_delivery_challan' 
              AND dc."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
          `;

          params.push(filters.units, dateRange.startDate, dateRange.endDate);
          paramIndex += 3;

          // Add company filter to the JOIN condition if specified
          if (filters.companyNames && filters.companyNames.length > 0) {
            query += ` AND dc.company_id = ANY($${paramIndex})`;
            params.push(filters.companyNames);
            paramIndex++;
          }

          // Add location filter to the JOIN condition if specified
          if (filters.locations && filters.locations.length > 0) {
            query += ` AND dc.office_id = ANY($${paramIndex})`;
            params.push(filters.locations);
            paramIndex++;
          }

          // Add customer filter to the JOIN condition if specified
          if (filters.customers && filters.customers.length > 0) {
            query += ` AND dc.customer_id = ANY($${paramIndex})`;
            params.push(filters.customers);
            paramIndex++;
          }

          query += `
            LEFT JOIN item i ON dc.id = i."deliveryChallanId"
          `;

          // Add product filter to the JOIN condition if specified
          if (filters.products && filters.products.length > 0) {
            query += ` AND i.product_id = ANY($${paramIndex})`;
            params.push(filters.products);
            paramIndex++;
          }

          query += ` WHERE 1=1`;

          // Filter employees in WHERE clause to ensure all requested employees appear
          if (filters.employees && filters.employees.length > 0) {
            query += ` AND u.id = ANY($${paramIndex})`;
            params.push(filters.employees);
            paramIndex++;
          }

          query += `
            GROUP BY u.id, u."firstName", u."middleName", u."lastName"
            ORDER BY amount DESC
          `;

          console.log('=== EMPLOYEE REPORT DEBUG ===');
          console.log('Query:', query);
          console.log('Params:', params);
          console.log('Employee IDs requested:', filters.employees);
          console.log('Date range:', dateRange);
          console.log('============================');

          const result = await AppDataSource.query(query, params);

          console.log('=== QUERY RESULT ===');
          console.log('Rows returned:', result.length);
          console.log('Results:', result);
          console.log('====================');

          return result.map((row: any) => ({
            name: row.name,
            quantity: parseFloat(row.quantity) || 0,
            amount: parseFloat(row.amount) || 0,
          }));
        } catch (error) {
          console.error('Error in getSalesEmployeeReport:', error);
          throw error;
        }
      }



  private async getSalesLocationReport(filters: SalesReportFilters, dateRange: DateRange): Promise<SalesReportData[]> {
    try {
      let paramIndex = 1;
      const params: any[] = [];
      
      let query = `
        SELECT 
          CONCAT(a.city, ', ', a.state) as name,
          COALESCE(SUM(
            CASE 
              WHEN $${paramIndex} = 'tonnes' THEN i."netWeight" / 1000
              ELSE i."netWeight"
            END
          ), 0) as quantity,
          COALESCE(SUM(i.amount), 0) as amount
        FROM addresses a
        LEFT JOIN offices od ON a.id = od."addressId"
        LEFT JOIN delivery_challan_purchase dc ON od.id = dc.office_id AND dc.type = 'customer_delivery_challan' AND dc."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
        LEFT JOIN item i ON dc.id = i."deliveryChallanId"
        WHERE 1=1
      `;
      
      params.push(filters.units, dateRange.startDate, dateRange.endDate);
      paramIndex += 3;

      if (filters.companyNames && filters.companyNames.length > 0) {
        query += ` AND (dc.company_id IN (SELECT id FROM company WHERE name = ANY($${paramIndex})) OR dc.id IS NULL)`;
        params.push(filters.companyNames);
        paramIndex++;
      }

      if (filters.locations && filters.locations.length > 0) {
        query += ` AND od.id = ANY($${paramIndex})`;
        params.push(filters.locations);
        paramIndex++;
      }

      if (filters.customers && filters.customers.length > 0) {
        query += ` AND (dc.customer_id = ANY($${paramIndex}) OR dc.id IS NULL)`;
        params.push(filters.customers);
        paramIndex++;
      }

      if (filters.products && filters.products.length > 0) {
        query += ` AND (i.product_id = ANY($${paramIndex}) OR i.id IS NULL)`;
        params.push(filters.products);
        paramIndex++;
      }

      query += `
        GROUP BY a.city, a.state
        ORDER BY amount DESC
      `;

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        name: row.name,
        quantity: parseFloat(row.quantity) || 0,
        amount: parseFloat(row.amount) || 0,
      }));
    } catch (error) {
      console.error('Error in getSalesLocationReport:', error);
      throw error;
    }
  }

  private async getSalesCompanyReport(filters: SalesReportFilters, dateRange: DateRange): Promise<SalesReportData[]> {
    try {
      let paramIndex = 1;
      const params: any[] = [];
      
      let query = `
        SELECT 
          c.name as name,
          COALESCE(SUM(
            CASE 
              WHEN $${paramIndex} = 'tonnes' THEN i."netWeight" / 1000
              ELSE i."netWeight"
            END
          ), 0) as quantity,
          COALESCE(SUM(i.amount), 0) as amount
        FROM company c
        LEFT JOIN delivery_challan_purchase dc ON c.id = dc.company_id AND dc.type = 'customer_delivery_challan' AND dc."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
        LEFT JOIN item i ON dc.id = i."deliveryChallanId"
        WHERE 1=1
      `;
      
      params.push(filters.units, dateRange.startDate, dateRange.endDate);
      paramIndex += 3;

      if (filters.companyNames && filters.companyNames.length > 0) {
        query += ` AND c.id = ANY($${paramIndex})`;
        params.push(filters.companyNames);
        paramIndex++;
      }

      if (filters.locations && filters.locations.length > 0) {
        query += ` AND (dc.office_id = ANY($${paramIndex}) OR dc.id IS NULL)`;
        params.push(filters.locations);
        paramIndex++;
      }

      if (filters.customers && filters.customers.length > 0) {
        query += ` AND (dc.customer_id = ANY($${paramIndex}) OR dc.id IS NULL)`;
        params.push(filters.customers);
        paramIndex++;
      }

      if (filters.products && filters.products.length > 0) {
        query += ` AND (i.product_id = ANY($${paramIndex}) OR i.id IS NULL)`;
        params.push(filters.products);
        paramIndex++;
      }

      query += `
        GROUP BY c.id, c.name
        ORDER BY amount DESC
      `;

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        name: row.name,
        quantity: parseFloat(row.quantity) || 0,
        amount: parseFloat(row.amount) || 0,
      }));
    } catch (error) {
      console.error('Error in getSalesCompanyReport:', error);
      throw error;
    }
  }

  private async getSalesCustomerReport(filters: SalesReportFilters, dateRange: DateRange): Promise<SalesReportData[]> {
      try {
        let paramIndex = 1;
        const params: any[] = [];

        // Build the base query with proper LEFT JOIN conditions
        let query = `
          SELECT 
            cust.organisation_name as name,
            COALESCE(SUM(
              CASE 
                WHEN $${paramIndex} = 'tonnes' THEN i."netWeight" / 1000
                ELSE i."netWeight"
              END
            ), 0) as quantity,
            COALESCE(SUM(i.amount), 0) as amount
          FROM customers cust
          LEFT JOIN delivery_challan_purchase dc ON cust.id = dc.customer_id 
            AND dc.type = 'customer_delivery_challan' 
            AND dc."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
        `;

        params.push(filters.units, dateRange.startDate, dateRange.endDate);
        paramIndex += 3;

        // Add company filter to JOIN condition if provided
        if (filters.companyNames && filters.companyNames.length > 0) {
          query += ` AND dc.company_id = ANY($${paramIndex})`;
          params.push(filters.companyNames);
          paramIndex++;
        }

        // Add location filter to JOIN condition if provided
        if (filters.locations && filters.locations.length > 0) {
          query += ` AND dc.office_id = ANY($${paramIndex})`;
          params.push(filters.locations);
          paramIndex++;
        }

        // Complete the LEFT JOIN for items
        query += `
          LEFT JOIN item i ON dc.id = i."deliveryChallanId"
        `;

        // Add product filter to JOIN condition if provided
        if (filters.products && filters.products.length > 0) {
          query += ` AND i.product_id = ANY($${paramIndex})`;
          params.push(filters.products);
          paramIndex++;
        }

        // Add WHERE clause only for customer filter
        query += ` WHERE 1=1`;

        if (filters.customers && filters.customers.length > 0) {
          query += ` AND cust.id = ANY($${paramIndex})`;
          params.push(filters.customers);
          paramIndex++;
        }

        query += `
          GROUP BY cust.id, cust.organisation_name
          ORDER BY amount DESC
        `;

        const result = await AppDataSource.query(query, params);

        return result.map((row: any) => ({
          name: row.name,
          quantity: parseFloat(row.quantity) || 0,
          amount: parseFloat(row.amount) || 0,
        }));
      } catch (error) {
        console.error('Error in getSalesCustomerReport:', error);
        throw error;
      }
    }


  private async getSalesProductReport(filters: SalesReportFilters, dateRange: DateRange): Promise<SalesReportData[]> {
    try {
      let paramIndex = 1;
      const params: any[] = [];
      
      let query = `
        SELECT 
          p.product_name as name,
          COALESCE(SUM(
            CASE 
              WHEN $${paramIndex} = 'tonnes' THEN i."netWeight" / 1000
              ELSE i."netWeight"
            END
          ), 0) as quantity,
          COALESCE(SUM(i.amount), 0) as amount
        FROM product p
        LEFT JOIN item i ON p.id = i.product_id
        LEFT JOIN delivery_challan_purchase dc ON i."deliveryChallanId" = dc.id AND dc.type = 'customer_delivery_challan' AND dc."createdAt" BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}
        WHERE 1=1
      `;
      
      params.push(filters.units, dateRange.startDate, dateRange.endDate);
      paramIndex += 3;

      if (filters.products && filters.products.length > 0) {
        query += ` AND p.id = ANY($${paramIndex})`;
        params.push(filters.products);
        paramIndex++;
      }

      if (filters.companyNames && filters.companyNames.length > 0) {
        query += ` AND (dc.company_id IN (SELECT id FROM company WHERE name = ANY($${paramIndex})) OR dc.id IS NULL)`;
        params.push(filters.companyNames);
        paramIndex++;
      }

      if (filters.locations && filters.locations.length > 0) {
        query += ` AND (dc.office_id = ANY($${paramIndex}) OR dc.id IS NULL)`;
        params.push(filters.locations);
        paramIndex++;
      }

      if (filters.customers && filters.customers.length > 0) {
        query += ` AND (dc.customer_id = ANY($${paramIndex}) OR dc.id IS NULL)`;
        params.push(filters.customers);
        paramIndex++;
      }

      query += `
        GROUP BY p.id, p.product_name
        ORDER BY amount DESC
      `;

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        name: row.name,
        quantity: parseFloat(row.quantity) || 0,
        amount: parseFloat(row.amount) || 0,
      }));
    } catch (error) {
      console.error('Error in getSalesProductReport:', error);
      throw error;
    }
  }

  async generateSalesExcelReport(filters: SalesReportFilters): Promise<Buffer | null> {
    try {
      const reportData = await this.generateSalesReport(filters);
      
      if (!reportData || reportData.length === 0) {
        return null;
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Sales Report');

      worksheet.columns = [
        { width: 20 },
        { width: 50 },
        { width: 15 },
      ];

      worksheet.properties.defaultRowHeight = 15;

      const titleRow = worksheet.addRow(['Sales Report']);
      titleRow.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFF00' }
      };
      titleRow.getCell(1).font = { bold: true, size: 16 };
      titleRow.getCell(1).alignment = { horizontal: 'center' };
      worksheet.mergeCells('A1:C1');

      worksheet.addRow([]);
      worksheet.addRow(['Report For:']);
      
      const companyNames = await this.getCompanyNames(filters.companyNames);
      const companyRow = worksheet.addRow(['Companies:', companyNames]);
      companyRow.getCell(1).font = { bold: true };
      companyRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      const locationNames = await this.getLocationNames(filters.locations);
      const locationRow = worksheet.addRow(['Locations:', locationNames]);
      locationRow.getCell(1).font = { bold: true };
      locationRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      const customerNames = await this.getCustomerNames(filters.customers);
      const customerRow = worksheet.addRow(['Customer Names:', customerNames]);
      customerRow.getCell(1).font = { bold: true };
      customerRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      const employeeNames = await this.getEmployeeNames(filters.employees);
      const employeeRow = worksheet.addRow(['Employees:', employeeNames]);
      employeeRow.getCell(1).font = { bold: true };
      employeeRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      const productNames = await this.getProductNames(filters.products);
      const productRow = worksheet.addRow(['Products:', productNames]);
      productRow.getCell(1).font = { bold: true };
      productRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

      const unitRow = worksheet.addRow(['Unit:', filters.units || 'kg']);
      unitRow.getCell(1).font = { bold: true };
      unitRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };

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

      worksheet.addRow([]);

      const headerRow = worksheet.addRow([
        filters.reportBased === 'product' ? 'Product Name' : 
        filters.reportBased === 'customer' ? 'Customer Name' :
        filters.reportBased === 'employee' ? 'Employee Name' :
        filters.reportBased === 'location' ? 'Location' :
        filters.reportBased === 'company' ? 'Company Name' :
        'Name',
        'Quantity',
        'Amount'
      ]);

      headerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'ADD8E6' }
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

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);

    } catch (error) {
      console.error('Error generating Sales Excel report:', error);
      throw error;
    }
  }

  private async getCompanyNames(companyIds?: string[]): Promise<string> {
    if (!companyIds || companyIds.length === 0) {
      return 'All';
    }
    
    try {
      const query = `SELECT name FROM company WHERE id = ANY($1)`;
      const result = await AppDataSource.query(query, [companyIds]);
      return result.map((row: any) => row.name).join(', ');
    } catch (error) {
      console.error('Error fetching company names:', error);
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
      console.error('Error fetching location names:', error);
      return 'Selected Locations';
    }
  }

  private async getCustomerNames(customerIds?: string[]): Promise<string> {
    if (!customerIds || customerIds.length === 0) {
      return 'All';
    }
    
    try {
      const query = `SELECT organisation_name FROM customers WHERE id = ANY($1)`;
      const result = await AppDataSource.query(query, [customerIds]);
      return result.map((row: any) => row.organisation_name).join(', ');
    } catch (error) {
      console.error('Error fetching customer names:', error);
      return 'Selected Customers';
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
      console.error('Error fetching employee names:', error);
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
      console.error('Error fetching product names:', error);
      return 'Selected Products';
    }
  }
}
