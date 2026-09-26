import { injectable } from 'inversify';

import * as ExcelJS from 'exceljs';
import logger from '../../utils/logger';
import { AppDataSource } from '../../utils/data-source';


/**
 * REGISTRATION REPORT SERVICE
 * 
 * This service handles registration reports for Vendors, Farmers, and Customers.
 * It provides functionality to:
 * 1. Generate registration data based on filters (date range, status, etc.)
 * 2. Get registration counts and summaries
 * 3. Export registration data to Excel format
 * 
 * The service follows the same pattern as the sales/procurement reports
 * but focuses on registration data instead of transaction data.
 */

// Interface for registration filters sent from frontend
export interface RegistrationReportFilters {
  reportType: 'vendor' | 'farmer' | 'customer'; // Which entity to report on
  period: 'custom' | 'previous_month' | 'current_month' | 'month_year' | 'quarterly';
  startDate?: string; // For custom period
  endDate?: string; // For custom period
  month?: number; // For month_year period (1-12)
  year?: number; // For month_year and quarterly periods
  quarter?: 1 | 2 | 3 | 4; // For quarterly period
  status?: 'pending' | 'approved' | 'rejected' | 'all'; // Filter by approval status (frontend sends 'rejected', we convert to 'notapproved')
  companyIds?: string[]; // Optional: filter by specific companies
  createdByIds?: string[]; // Optional: filter by who registered them
  cities?: string[]; // Optional: filter by city
  states?: string[]; // Optional: filter by state
  pincodes?: string[]; // Optional: filter by pincode
}

// Interface for registration data returned
export interface RegistrationData {
  id: string;
  name: string; // Full name or company name
  code: string; // Vendor/Farmer/Customer code
  contactNumber: string;
  email: string;
  address: string;
  status: string;
  createdBy: string; // Who registered this entity
  createdAt: string; // Registration date
}

// Interface for registration summary
export interface RegistrationSummary {
  totalCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  registrationsByMonth?: { month: string; count: number }[];
}

// Interface for date range
export interface DateRange {
  startDate: Date;
  endDate: Date;
}

@injectable()
export class RegistrationReportService {
  constructor() {}

  /**
   * MAIN METHOD: Generate Registration Report
   * 
   * This method routes to the appropriate report generator based on reportType
   * @param filters - Filter criteria from frontend
   * @returns Array of registration data
   */
  async generateRegistrationReport(
    filters: RegistrationReportFilters,
  ): Promise<RegistrationData[]> {
    try {
      
      // Build date range based on period
      const dateRange = this.buildDateRange(filters);

      // Route to appropriate report generator
      switch (filters.reportType) {
        case 'vendor':
          return await this.getVendorRegistrationReport(filters, dateRange);
        case 'farmer':
          return await this.getFarmerRegistrationReport(filters, dateRange);
        case 'customer':
          return await this.getCustomerRegistrationReport(filters, dateRange);
        default:
          throw new Error(`Unsupported report type: ${filters.reportType}`);
      }
    } catch (error) {
      logger.error('Error generating registration report:', error);
      throw error;
    }
  }

  /**
   * Get Registration Summary with Counts
   * 
   * Returns aggregated statistics about registrations
   * @param filters - Filter criteria
   * @returns Summary object with counts
   */
  async getRegistrationSummary(
    filters: RegistrationReportFilters,
  ): Promise<RegistrationSummary> {
    try {
      const dateRange = this.buildDateRange(filters);
      let tableName: string;
      let statusColumn = 'status';

      // Determine which table to query
      switch (filters.reportType) {
        case 'vendor':
          tableName = 'vendor';
          break;
        case 'farmer':
          tableName = 'farmer';
          break;
        case 'customer':
          tableName = 'customers';
          break;
        default:
          throw new Error(`Unsupported report type: ${filters.reportType}`);
      }

      // Convert 'rejected' to 'notapproved' for database query
      const dbStatus = filters.status === 'rejected' ? 'notapproved' : filters.status;

      // Build query for summary counts
      let query = `
        SELECT 
          COUNT(*) as total_count,
          COUNT(CASE WHEN ${statusColumn} = 'pending' THEN 1 END) as pending_count,
          COUNT(CASE WHEN ${statusColumn} = 'approved' THEN 1 END) as approved_count,
          COUNT(CASE WHEN ${statusColumn} = 'notapproved' THEN 1 END) as rejected_count
        FROM ${tableName}
        WHERE "createdAt" BETWEEN $1 AND $2
      `;

      const params: any[] = [dateRange.startDate, dateRange.endDate];

      // Add status filter if specified
      if (dbStatus && dbStatus !== 'all') {
        query += ` AND ${statusColumn} = $3`;
        params.push(dbStatus);
      }

      const result = await AppDataSource.query(query, params);

      return {
        totalCount: parseInt(result[0].total_count) || 0,
        pendingCount: parseInt(result[0].pending_count) || 0,
        approvedCount: parseInt(result[0].approved_count) || 0,
        rejectedCount: parseInt(result[0].rejected_count) || 0,
      };
    } catch (error) {
      console.error('Error generating registration summary:', error);
      throw error;
    }
  }

  /**
   * VENDOR REGISTRATION REPORT
   * 
   * Fetches all vendor registrations based on filters
   * Returns vendor details including company name, contact info, status, etc.
   */
  private async getVendorRegistrationReport(
    filters: RegistrationReportFilters,
    dateRange: DateRange,
  ): Promise<RegistrationData[]> {
    try {
      let paramIndex = 1;
      const params: any[] = [];

      // SQL Query to fetch vendor registration data
      let query = `
        SELECT 
          v.id,
          v.company_name as name,
          v.vendor_code as code,
          v.office_contact_number as contact_number,
          v.email as email,
          CONCAT(
            COALESCE(a.address1, ''), ' ',
            COALESCE(a.address2, ''), ', ',
            COALESCE(a.city, ''), ', ',
            COALESCE(a.state, ''), ' - ',
            COALESCE(a.pincode, '')
          ) as address,
          v.status,
          CONCAT(
            u."firstName", ' ',
            COALESCE(u."middleName", ''), ' ',
            u."lastName"
          ) as created_by,
          v."createdAt" as created_at
        FROM vendor v
        LEFT JOIN addresses a ON v.office_address_id = a.id
        LEFT JOIN employees u ON v.created_by = u.id
        WHERE v."createdAt" BETWEEN $${paramIndex} AND $${paramIndex + 1}
      `;

      params.push(dateRange.startDate, dateRange.endDate);
      paramIndex += 2;

      // Add status filter (convert 'rejected' to 'notapproved')
      if (filters.status && filters.status !== 'all') {
        const dbStatus = filters.status === 'rejected' ? 'notapproved' : filters.status;
        query += ` AND v.status = $${paramIndex}`;
        params.push(dbStatus);
        paramIndex++;
      }

      // Add created by filter
      if (filters.createdByIds && filters.createdByIds.length > 0) {
        query += ` AND v.created_by = ANY($${paramIndex})`;
        params.push(filters.createdByIds);
        paramIndex++;
      }

      // Add city filter
      if (filters.cities && filters.cities.length > 0) {
        query += ` AND a.city = ANY($${paramIndex})`;
        params.push(filters.cities);
        paramIndex++;
      }

      // Add state filter
      if (filters.states && filters.states.length > 0) {
        query += ` AND a.state = ANY($${paramIndex})`;
        params.push(filters.states);
        paramIndex++;
      }

      // Add pincode filter
      if (filters.pincodes && filters.pincodes.length > 0) {
        query += ` AND a.pincode = ANY($${paramIndex})`;
        params.push(filters.pincodes);
        paramIndex++;
      }

      query += ` ORDER BY v."createdAt" DESC`;

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        id: row.id,
        name: row.name || 'N/A',
        code: row.code || 'N/A',
        contactNumber: row.contact_number || 'N/A',
        email: row.email || 'N/A',
        address: row.address || 'N/A',
        status: row.status === 'notapproved' ? 'rejected' : row.status || 'pending',
        createdBy: row.created_by || 'N/A',
        createdAt: row.created_at
          ? new Date(row.created_at).toLocaleDateString('en-GB')
          : 'N/A',
      }));
    } catch (error) {
      console.error('Error in getVendorRegistrationReport:', error);
      throw error;
    }
  }

  /**
   * FARMER REGISTRATION REPORT
   * 
   * Fetches all farmer registrations based on filters
   * Returns farmer details including full name, contact info, status, etc.
   */
  private async getFarmerRegistrationReport(
    filters: RegistrationReportFilters,
    dateRange: DateRange,
  ): Promise<RegistrationData[]> {
    try {
      let paramIndex = 1;
      const params: any[] = [];

      // SQL Query to fetch farmer registration data
      let query = `
        SELECT 
          f.id,
          CONCAT(
            f."farmerfName", ' ',
            COALESCE(f."farmermName", ''), ' ',
            f."farmerlName"
          ) as name,
          f."farmerCode" as code,
          f."primaryMobileNo" as contact_number,
          f.email as email,
          CONCAT(
            COALESCE(a.address1, ''), ' ',
            COALESCE(a.address2, ''), ', ',
            COALESCE(a.city, ''), ', ',
            COALESCE(a.state, ''), ' - ',
            COALESCE(a.pincode, '')
          ) as address,
          f.status,
          CONCAT(
            u."firstName", ' ',
            COALESCE(u."middleName", ''), ' ',
            u."lastName"
          ) as created_by,
          f."createdAt" as created_at
        FROM farmer f
        LEFT JOIN addresses a ON f."residensialAddressId" = a.id
        LEFT JOIN employees u ON f.created_by = u.id
        WHERE f."createdAt" BETWEEN $${paramIndex} AND $${paramIndex + 1}
      `;

      params.push(dateRange.startDate, dateRange.endDate);
      paramIndex += 2;

      // Add status filter (convert 'rejected' to 'notapproved')
      if (filters.status && filters.status !== 'all') {
        const dbStatus = filters.status === 'rejected' ? 'notapproved' : filters.status;
        query += ` AND f.status = $${paramIndex}`;
        params.push(dbStatus);
        paramIndex++;
      }

      // Add created by filter
      if (filters.createdByIds && filters.createdByIds.length > 0) {
        query += ` AND f.created_by = ANY($${paramIndex})`;
        params.push(filters.createdByIds);
        paramIndex++;
      }

      // Add city filter
      if (filters.cities && filters.cities.length > 0) {
        query += ` AND a.city = ANY($${paramIndex})`;
        params.push(filters.cities);
        paramIndex++;
      }

      // Add state filter
      if (filters.states && filters.states.length > 0) {
        query += ` AND a.state = ANY($${paramIndex})`;
        params.push(filters.states);
        paramIndex++;
      }

      // Add pincode filter
      if (filters.pincodes && filters.pincodes.length > 0) {
        query += ` AND a.pincode = ANY($${paramIndex})`;
        params.push(filters.pincodes);
        paramIndex++;
      }

      query += ` ORDER BY f."createdAt" DESC`;

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        id: row.id,
        name: row.name || 'N/A',
        code: row.code || 'N/A',
        contactNumber: row.contact_number || 'N/A',
        email: row.email || 'N/A',
        address: row.address || 'N/A',
        status: row.status === 'notapproved' ? 'rejected' : row.status || 'pending',
        createdBy: row.created_by || 'N/A',
        createdAt: row.created_at
          ? new Date(row.created_at).toLocaleDateString('en-GB')
          : 'N/A',
      }));
    } catch (error) {
      console.error('Error in getFarmerRegistrationReport:', error);
      throw error;
    }
  }

  /**
   * CUSTOMER REGISTRATION REPORT
   * 
   * Fetches all customer registrations based on filters
   * Returns customer details including organization name, contact info, status, etc.
   */
  private async getCustomerRegistrationReport(
    filters: RegistrationReportFilters,
    dateRange: DateRange,
  ): Promise<RegistrationData[]> {
    try {
      let paramIndex = 1;
      const params: any[] = [];

      // SQL Query to fetch customer registration data
      let query = `
        SELECT 
          c.id,
          c.organisation_name as name,
          c.customercode as code,
          c.customer_primary_contact_number as contact_number,
          c.customer_email_primary as email,
          CONCAT(
            COALESCE(a.address1, ''), ' ',
            COALESCE(a.address2, ''), ', ',
            COALESCE(a.city, ''), ', ',
            COALESCE(a.state, ''), ' - ',
            COALESCE(a.pincode, '')
          ) as address,
          c.status,
          CONCAT(
            u."firstName", ' ',
            COALESCE(u."middleName", ''), ' ',
            u."lastName"
          ) as created_by,
          c."createdAt" as created_at
        FROM customers c
        LEFT JOIN addresses a ON c."customerAddressId" = a.id
        LEFT JOIN employees u ON c.created_by = u.id
        WHERE c."createdAt" BETWEEN $${paramIndex} AND $${paramIndex + 1}
      `;

      params.push(dateRange.startDate, dateRange.endDate);
      paramIndex += 2;

      // Add status filter (convert 'rejected' to 'notapproved')
      if (filters.status && filters.status !== 'all') {
        const dbStatus = filters.status === 'rejected' ? 'notapproved' : filters.status;
        query += ` AND c.status = $${paramIndex}`;
        params.push(dbStatus);
        paramIndex++;
      }

      // Add created by filter
      if (filters.createdByIds && filters.createdByIds.length > 0) {
        query += ` AND c.created_by = ANY($${paramIndex})`;
        params.push(filters.createdByIds);
        paramIndex++;
      }

      // Add city filter
      if (filters.cities && filters.cities.length > 0) {
        query += ` AND a.city = ANY($${paramIndex})`;
        params.push(filters.cities);
        paramIndex++;
      }

      // Add state filter
      if (filters.states && filters.states.length > 0) {
        query += ` AND a.state = ANY($${paramIndex})`;
        params.push(filters.states);
        paramIndex++;
      }

      // Add pincode filter
      if (filters.pincodes && filters.pincodes.length > 0) {
        query += ` AND a.pincode = ANY($${paramIndex})`;
        params.push(filters.pincodes);
        paramIndex++;
      }

      query += ` ORDER BY c."createdAt" DESC`;

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        id: row.id,
        name: row.name || 'N/A',
        code: row.code || 'N/A',
        contactNumber: row.contact_number || 'N/A',
        email: row.email || 'N/A',
        address: row.address || 'N/A',
        status: row.status === 'notapproved' ? 'rejected' : row.status || 'pending',
        createdBy: row.created_by || 'N/A',
        createdAt: row.created_at
          ? new Date(row.created_at).toLocaleDateString('en-GB')
          : 'N/A',
      }));
    } catch (error) {
      console.error('Error in getCustomerRegistrationReport:', error);
      throw error;
    }
  }

  /**
   * BUILD DATE RANGE
   * 
   * Converts period filters into actual start and end dates
   * Supports: custom, current_month, previous_month, month_year, quarterly
   */
  private buildDateRange(filters: RegistrationReportFilters): DateRange {
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    switch (filters.period) {
      case 'custom':
        if (!filters.startDate || !filters.endDate) {
          throw new Error('startDate and endDate are required for custom period');
        }
        startDate = new Date(filters.startDate);
        endDate = new Date(filters.endDate);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          throw new Error('Invalid date format for startDate or endDate');
        }
        if (startDate > endDate) {
          throw new Error('startDate must be before endDate');
        }
        startDate.setHours(0, 0, 0, 0);
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
        startDate = new Date(
          filters.year || now.getFullYear(),
          quarterStartMonth,
          1,
        );
        endDate = new Date(
          filters.year || now.getFullYear(),
          quarterStartMonth + 3,
          0,
        );
        startDate.setHours(0, 0, 0, 0);
        break;

      default:
        throw new Error(`Unsupported period: ${filters.period}`);
    }

    // Set end date to next day at 00:00:00 for inclusive range
    endDate.setDate(endDate.getDate() + 1);
    endDate.setHours(0, 0, 0, 0);

    return { startDate, endDate };
  }

  /**
   * GENERATE EXCEL REPORT
   * 
   * Creates an Excel file with registration data
   * Includes:
   * - Report header with filters
   * - Summary information
   * - Detailed registration list
   * 
   * @param filters - Filter criteria
   * @returns Excel file as Buffer
   */
  async generateExcelReport(
    filters: RegistrationReportFilters,
  ): Promise<Buffer | null> {
    try {
      // Get the registration data
      const registrationData = await this.generateRegistrationReport(filters);

      if (!registrationData || registrationData.length === 0) {
        return null;
      }

      // Get summary data
      const summary = await this.getRegistrationSummary(filters);

      // Create a new workbook and worksheet
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Registration Report');

      // Set column widths
      worksheet.columns = [
        { width: 20 }, // Column A
        { width: 30 }, // Column B
        { width: 20 }, // Column C
        { width: 20 }, // Column D
        { width: 25 }, // Column E
        { width: 40 }, // Column F
        { width: 15 }, // Column G
        { width: 20 }, // Column H
      ];

      // Add title row
      const titleRow = worksheet.addRow([
        `${filters.reportType.toUpperCase()} Registration Report`,
      ]);
      titleRow.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFF00' }, // Yellow background
      };
      titleRow.getCell(1).font = { bold: true, size: 16 };
      titleRow.getCell(1).alignment = { horizontal: 'center' };
      worksheet.mergeCells('A1:H1');

      // Add empty row
      worksheet.addRow([]);

      // Add filter information
      worksheet.addRow(['Report Filters:']);

      // Add report type
      const reportTypeRow = worksheet.addRow([
        'Report Type:',
        filters.reportType.toUpperCase(),
      ]);
      reportTypeRow.getCell(1).font = { bold: true };

      // Add period information
      let periodText = '';
      if (filters.period === 'custom' && filters.startDate && filters.endDate) {
        const startDate = new Date(filters.startDate).toLocaleDateString(
          'en-GB',
        );
        const endDate = new Date(filters.endDate).toLocaleDateString('en-GB');
        periodText = `${startDate} To ${endDate}`;
      } else if (filters.period === 'month_year') {
        periodText = `${filters.month}/${filters.year}`;
      } else if (filters.period === 'quarterly') {
        periodText = `Q${filters.quarter} ${filters.year}`;
      } else {
        periodText = filters.period.replace('_', ' ').toUpperCase();
      }
      const periodRow = worksheet.addRow(['Period:', periodText]);
      periodRow.getCell(1).font = { bold: true };

      // Add status filter
      const statusRow = worksheet.addRow([
        'Status Filter:',
        filters.status || 'All',
      ]);
      statusRow.getCell(1).font = { bold: true };

      // Add city filter
      if (filters.cities && filters.cities.length > 0) {
        const cityRow = worksheet.addRow([
          'Cities:',
          filters.cities.join(', '),
        ]);
        cityRow.getCell(1).font = { bold: true };
        cityRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      }

      // Add state filter
      if (filters.states && filters.states.length > 0) {
        const stateRow = worksheet.addRow([
          'States:',
          filters.states.join(', '),
        ]);
        stateRow.getCell(1).font = { bold: true };
        stateRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      }

      // Add pincode filter
      if (filters.pincodes && filters.pincodes.length > 0) {
        const pincodeRow = worksheet.addRow([
          'Pincodes:',
          filters.pincodes.join(', '),
        ]);
        pincodeRow.getCell(1).font = { bold: true };
        pincodeRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      }

      // Add generated at information
      const now = new Date();
      const generatedAtText = now.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
      const generatedAtRow = worksheet.addRow(['Generated At:', generatedAtText]);
      generatedAtRow.getCell(1).font = { bold: true };

      // Add empty row
      worksheet.addRow([]);

      // Add summary section
      const summaryTitleRow = worksheet.addRow(['Summary:']);
      summaryTitleRow.getCell(1).font = { bold: true, size: 14 };
      summaryTitleRow.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'E0E0E0' },
      };

      const totalRow = worksheet.addRow(['Total Registrations:', summary.totalCount]);
      totalRow.getCell(1).font = { bold: true };

      const pendingRow = worksheet.addRow(['Pending:', summary.pendingCount]);
      pendingRow.getCell(1).font = { bold: true };

      const approvedRow = worksheet.addRow(['Approved:', summary.approvedCount]);
      approvedRow.getCell(1).font = { bold: true };

      const rejectedRow = worksheet.addRow(['Rejected:', summary.rejectedCount]);
      rejectedRow.getCell(1).font = { bold: true };

      // Add empty row before data table
      worksheet.addRow([]);

      // Add table headers
      const headerRow = worksheet.addRow([
        'S.No',
        'Name',
        'Code',
        'Contact Number',
        'Email',
        'Address',
        'Status',
        'Registered By',
        'Registration Date',
      ]);

      // Style header row
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'ADD8E6' }, // Light blue background
        };
        cell.font = { bold: true };
        cell.alignment = {
          horizontal: 'center',
          vertical: 'middle',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      // Add data rows
      registrationData.forEach((item, index) => {
        const dataRow = worksheet.addRow([
          index + 1,
          item.name,
          item.code,
          item.contactNumber,
          item.email,
          item.address,
          item.status.toUpperCase(),
          item.createdBy,
          item.createdAt,
        ]);

        // Style data rows
        dataRow.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };

          // Add text wrapping and alignment
          if (colNumber === 1) {
            // Serial number - center align
            cell.alignment = { horizontal: 'center', vertical: 'top' };
          } else if (colNumber === 6) {
            // Address column - wrap text
            cell.alignment = { wrapText: true, vertical: 'top' };
          } else {
            // Other columns - top align
            cell.alignment = { vertical: 'top' };
          }

          // Color code status
          if (colNumber === 7) {
            // Status column
            const displayStatus = item.status.toUpperCase();
            cell.value = displayStatus;
            
            if (item.status === 'approved') {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'C6EFCE' }, // Light green
              };
            } else if (item.status === 'rejected') {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFC7CE' }, // Light red
              };
            } else if (item.status === 'pending') {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFEB9C' }, // Light yellow
              };
            }
          }
        });
      });

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      console.error('Error generating Excel report:', error);
      throw error;
    }
  }
}
