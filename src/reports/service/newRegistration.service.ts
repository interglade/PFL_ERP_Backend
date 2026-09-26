import { injectable } from 'inversify';

import * as ExcelJS from 'exceljs';
import { AppDataSource } from '../../utils/data-source';

/**
 * NEW REGISTRATION REPORT SERVICE
 * 
 * Generates multi-sheet Excel reports for registrations with:
 * - Metadata sheet
 * - Registration Audit sheet (employee-wise summary)
 * - Individual sheets for Farmer, Vendor, Customer (based on selection)
 */

export interface NewRegistrationFilters {
  registrationType: 'farmer' | 'vendor' | 'customer' | 'all';
  period: 'custom' | 'previous_month' | 'current_month' | 'month_year' | 'quarterly';
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
  quarter?: 1 | 2 | 3 | 4;
  city?: string;
  state?: string;
  pincode?: string;
  employee?: string[];
  employees?: string[]; // frontend sends "employees" (plural)
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface RegistrationSummary {
  farmers: { total: number; pending: number; notApproved: number };
  vendors: { total: number; pending: number; notApproved: number };
  customers: { total: number; pending: number; notApproved: number };
}

export interface EmployeeAudit {
  employeeName: string;
  farmerRegistered: number;
  farmerPending: number;
  farmerNotApproved: number;
  vendorRegistered: number;
  vendorPending: number;
  vendorNotApproved: number;
  customerRegistered: number;
  customerPending: number;
  customerNotApproved: number;
}

@injectable()
export class NewRegistrationService {
  constructor() {}

  /**
   * Build date range from filters
   * Returns startDate at 00:00:00 and endDate at 23:59:59.999 of the specified end date
   */
  private buildDateRange(filters: NewRegistrationFilters): DateRange {
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
        
        // Validate dates
        if (isNaN(startDate.getTime())) {
          throw new Error(`Invalid startDate: ${filters.startDate}`);
        }
        if (isNaN(endDate.getTime())) {
          throw new Error(`Invalid endDate: ${filters.endDate}`);
        }
        
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;

      case 'current_month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;

      case 'previous_month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;

      case 'month_year':
        if (!filters.month || !filters.year) {
          throw new Error('month and year are required for month_year period');
        }
        startDate = new Date(filters.year, filters.month - 1, 1);
        endDate = new Date(filters.year, filters.month, 0);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;

      case 'quarterly':
        if (!filters.quarter) {
          throw new Error('quarter is required for quarterly period');
        }
        const quarterStartMonth = (filters.quarter - 1) * 3;
        startDate = new Date(filters.year || now.getFullYear(), quarterStartMonth, 1);
        endDate = new Date(filters.year || now.getFullYear(), quarterStartMonth + 3, 0);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;

      default:
        throw new Error(`Unsupported period: ${filters.period}`);
    }

    return { startDate, endDate };
  }

  /**
   * Get registration summary counts
   */
  async getRegistrationSummary(
    filters: NewRegistrationFilters,
    dateRange: DateRange,
  ): Promise<RegistrationSummary> {
    try {
      const summary: RegistrationSummary = {
        farmers: { total: 0, pending: 0, notApproved: 0 },
        vendors: { total: 0, pending: 0, notApproved: 0 },
        customers: { total: 0, pending: 0, notApproved: 0 },
      };

      // Build location filter
      const locationFilter = this.buildLocationFilter(filters);

      if (filters.registrationType === 'all' || filters.registrationType === 'farmer') {
        // Build employee filter for farmer
        const employeeFilter = this.buildEmployeeFilter(filters, 3 + locationFilter.params.length, 'f.created_by');
        
        const farmerQuery = `
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN f.status = 'pending' THEN 1 END) as pending,
            COUNT(CASE WHEN f.status = 'notapproved' THEN 1 END) as not_approved
          FROM farmer f
          LEFT JOIN addresses a ON f."residensialAddressId" = a.id
          WHERE f."createdAt" BETWEEN $1 AND $2
          ${locationFilter.filter}${employeeFilter.filter}
        `;
        const farmerResult = await AppDataSource.query(farmerQuery, [
          dateRange.startDate,
          dateRange.endDate,
          ...locationFilter.params,
          ...employeeFilter.params,
        ]);
        summary.farmers = {
          total: parseInt(farmerResult[0].total) || 0,
          pending: parseInt(farmerResult[0].pending) || 0,
          notApproved: parseInt(farmerResult[0].not_approved) || 0,
        };
      }

      if (filters.registrationType === 'all' || filters.registrationType === 'vendor') {
        // Build employee filter for vendor
        const employeeFilter = this.buildEmployeeFilter(filters, 3 + locationFilter.params.length, 'v.created_by');
        
        const vendorQuery = `
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN v.status = 'pending' THEN 1 END) as pending,
            COUNT(CASE WHEN v.status = 'notapproved' THEN 1 END) as not_approved
          FROM vendor v
          LEFT JOIN addresses a ON v.office_address_id = a.id
          WHERE v."createdAt" BETWEEN $1 AND $2
          ${locationFilter.filter}${employeeFilter.filter}
        `;
        const vendorResult = await AppDataSource.query(vendorQuery, [
          dateRange.startDate,
          dateRange.endDate,
          ...locationFilter.params,
          ...employeeFilter.params,
        ]);
        summary.vendors = {
          total: parseInt(vendorResult[0].total) || 0,
          pending: parseInt(vendorResult[0].pending) || 0,
          notApproved: parseInt(vendorResult[0].not_approved) || 0,
        };
      }

      if (filters.registrationType === 'all' || filters.registrationType === 'customer') {
        // Build employee filter for customer
        const employeeFilter = this.buildEmployeeFilter(filters, 3 + locationFilter.params.length, 'c.created_by');
        
        const customerQuery = `
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN c.status = 'pending' THEN 1 END) as pending,
            COUNT(CASE WHEN c.status = 'notapproved' THEN 1 END) as not_approved
          FROM customers c
          LEFT JOIN addresses a ON c."customerAddressId" = a.id
          WHERE c."createdAt" BETWEEN $1 AND $2
          ${locationFilter.filter}${employeeFilter.filter}
        `;
        const customerResult = await AppDataSource.query(customerQuery, [
          dateRange.startDate,
          dateRange.endDate,
          ...locationFilter.params,
          ...employeeFilter.params,
        ]);
        summary.customers = {
          total: parseInt(customerResult[0].total) || 0,
          pending: parseInt(customerResult[0].pending) || 0,
          notApproved: parseInt(customerResult[0].not_approved) || 0,
        };
      }

      return summary;
    } catch (error) {
      console.error('Error getting registration summary:', error);
      throw error;
    }
  }

  /**
   * Build location filter for queries
   */
  private buildLocationFilter(filters: NewRegistrationFilters): { filter: string; params: any[] } {
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 3; // Start from $3 since $1 and $2 are dates

      if (filters.city && filters.city.trim().length > 0) {
        conditions.push(`a.city = $${paramIndex}`);
        params.push(filters.city.trim());
        paramIndex++;
      }

      if (filters.state && filters.state.trim().length > 0) {
        conditions.push(`a.state = $${paramIndex}`);
        params.push(filters.state.trim());
        paramIndex++;
      }

      if (filters.pincode && filters.pincode.trim().length > 0) {
        conditions.push(`a.pincode = $${paramIndex}`);
        params.push(filters.pincode.trim());
        paramIndex++;
      }

      const filter = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
      return { filter, params };
    }

  /**
   * Build employee filter for queries
   */
  private buildEmployeeFilter(filters: NewRegistrationFilters, paramStartIndex: number, columnName: string = 'created_by'): { filter: string; params: any[] } {
    // Accept either "employees" (frontend) or "employee" (legacy) field
    const employeeIds = filters.employees ?? filters.employee ?? [];
    
    if (!employeeIds || employeeIds.length === 0) {
      return { filter: '', params: [] };
    }

    const cleanIds = employeeIds.map(id => id.trim()).filter(id => id.length > 0);
    if (cleanIds.length === 0) {
      return { filter: '', params: [] };
    }

    const placeholders = cleanIds.map((_, index) => `$${paramStartIndex + index}`).join(', ');
    const filter = ` AND ${columnName} IN (${placeholders})`;
    return { filter, params: cleanIds };
  }

  /**
   * Get employee names from employee IDs
   */
  private async getEmployeeNames(employeeIds: string[]): Promise<string[]> {
    try {
      if (!employeeIds || employeeIds.length === 0) {
        return [];
      }

      const cleanIds = employeeIds.map(id => id.trim()).filter(id => id.length > 0);
      if (cleanIds.length === 0) {
        return [];
      }

      const placeholders = cleanIds.map((_, index) => `$${index + 1}`).join(', ');
      const query = `
        SELECT CONCAT("firstName", ' ', COALESCE("middleName", ''), ' ', "lastName") as name
        FROM employees
        WHERE id IN (${placeholders})
        ORDER BY "firstName", "lastName"
      `;

      const result = await AppDataSource.query(query, cleanIds);
      return result.map((row: any) => row.name);
    } catch (error) {
      console.error('Error getting employee names:', error);
      return [];
    }
  }



  /**
   * Get employee-wise registration audit
   */
  async getEmployeeAudit(
    filters: NewRegistrationFilters,
    dateRange: DateRange,
  ): Promise<EmployeeAudit[]> {
    try {
      const locationFilter = this.buildLocationFilter(filters);
      const employeeFilter = this.buildEmployeeFilter(filters, 3 + locationFilter.params.length, 'e.id');
      
      // Build location conditions for each entity type
      const farmerLocationCondition = locationFilter.filter ? locationFilter.filter.replace(/a\./g, 'fa.') : '';
      const vendorLocationCondition = locationFilter.filter ? locationFilter.filter.replace(/a\./g, 'va.') : '';
      const customerLocationCondition = locationFilter.filter ? locationFilter.filter.replace(/a\./g, 'ca.') : '';
      
      // Build WHERE clause for filtering which employees to show
      const whereConditions: string[] = [];
      
      if (filters.registrationType === 'all' || filters.registrationType === 'farmer') {
        whereConditions.push(`f.id IS NOT NULL`);
      }
      
      if (filters.registrationType === 'all' || filters.registrationType === 'vendor') {
        whereConditions.push(`v.id IS NOT NULL`);
      }
      
      if (filters.registrationType === 'all' || filters.registrationType === 'customer') {
        whereConditions.push(`c.id IS NOT NULL`);
      }
      
      const whereClause = whereConditions.length > 0 
        ? `WHERE (${whereConditions.join(' OR ')})${employeeFilter.filter}`
        : employeeFilter.filter ? `WHERE 1=1${employeeFilter.filter}` : '';
      
      const query = `
        SELECT 
          CONCAT(e."firstName", ' ', COALESCE(e."middleName", ''), ' ', e."lastName") as employee_name,
          COUNT(DISTINCT CASE WHEN f.id IS NOT NULL ${farmerLocationCondition} THEN f.id END) as farmer_registered,
          COUNT(DISTINCT CASE WHEN f.id IS NOT NULL AND f.status = 'pending' ${farmerLocationCondition} THEN f.id END) as farmer_pending,
          COUNT(DISTINCT CASE WHEN f.id IS NOT NULL AND f.status = 'notapproved' ${farmerLocationCondition} THEN f.id END) as farmer_not_approved,
          COUNT(DISTINCT CASE WHEN v.id IS NOT NULL ${vendorLocationCondition} THEN v.id END) as vendor_registered,
          COUNT(DISTINCT CASE WHEN v.id IS NOT NULL AND v.status = 'pending' ${vendorLocationCondition} THEN v.id END) as vendor_pending,
          COUNT(DISTINCT CASE WHEN v.id IS NOT NULL AND v.status = 'notapproved' ${vendorLocationCondition} THEN v.id END) as vendor_not_approved,
          COUNT(DISTINCT CASE WHEN c.id IS NOT NULL ${customerLocationCondition} THEN c.id END) as customer_registered,
          COUNT(DISTINCT CASE WHEN c.id IS NOT NULL AND c.status = 'pending' ${customerLocationCondition} THEN c.id END) as customer_pending,
          COUNT(DISTINCT CASE WHEN c.id IS NOT NULL AND c.status = 'notapproved' ${customerLocationCondition} THEN c.id END) as customer_not_approved
        FROM employees e
        LEFT JOIN farmer f ON e.id = f.created_by AND f."createdAt" BETWEEN $1 AND $2
        LEFT JOIN addresses fa ON f."residensialAddressId" = fa.id
        LEFT JOIN vendor v ON e.id = v.created_by AND v."createdAt" BETWEEN $1 AND $2
        LEFT JOIN addresses va ON v.office_address_id = va.id
        LEFT JOIN customers c ON e.id = c.created_by AND c."createdAt" BETWEEN $1 AND $2
        LEFT JOIN addresses ca ON c."customerAddressId" = ca.id
        ${whereClause}
        GROUP BY e.id, e."firstName", e."middleName", e."lastName"
        HAVING (
          COUNT(DISTINCT CASE WHEN f.id IS NOT NULL ${farmerLocationCondition} THEN f.id END) > 0 OR 
          COUNT(DISTINCT CASE WHEN v.id IS NOT NULL ${vendorLocationCondition} THEN v.id END) > 0 OR 
          COUNT(DISTINCT CASE WHEN c.id IS NOT NULL ${customerLocationCondition} THEN c.id END) > 0
        )
        ORDER BY employee_name
      `;

      // Build parameters array - location params are shared across all conditions
      const params: any[] = [dateRange.startDate, dateRange.endDate, ...locationFilter.params, ...employeeFilter.params];

      const result = await AppDataSource.query(query, params);

      return result.map((row: any) => ({
        employeeName: row.employee_name || 'Unknown',
        farmerRegistered: parseInt(row.farmer_registered) || 0,
        farmerPending: parseInt(row.farmer_pending) || 0,
        farmerNotApproved: parseInt(row.farmer_not_approved) || 0,
        vendorRegistered: parseInt(row.vendor_registered) || 0,
        vendorPending: parseInt(row.vendor_pending) || 0,
        vendorNotApproved: parseInt(row.vendor_not_approved) || 0,
        customerRegistered: parseInt(row.customer_registered) || 0,
        customerPending: parseInt(row.customer_pending) || 0,
        customerNotApproved: parseInt(row.customer_not_approved) || 0,
      }));
    } catch (error) {
      console.error('Error getting employee audit:', error);
      throw error;
    }
  }

  /**
   * Get farmer registrations
   */
  async getFarmerData(filters: NewRegistrationFilters, dateRange: DateRange): Promise<any[]> {
    try {
      const locationFilter = this.buildLocationFilter(filters);
      const employeeFilter = this.buildEmployeeFilter(filters, 3 + locationFilter.params.length, 'f.created_by');
      
      const query = `
        SELECT 
          f."farmerCode" as code,
          CONCAT(f."farmerfName", ' ', COALESCE(f."farmermName", ''), ' ', f."farmerlName") as name,
          CONCAT(COALESCE(ra.address1, ''), ' ', COALESCE(ra.address2, ''), ', ', COALESCE(ra.city, ''), ', ', COALESCE(ra.state, ''), ' - ', COALESCE(ra.pincode, '')) as residential_address,
          CONCAT(COALESCE(fa.address1, ''), ' ', COALESCE(fa.address2, ''), ', ', COALESCE(fa.city, ''), ', ', COALESCE(fa.state, ''), ' - ', COALESCE(fa.pincode, '')) as farm_address,
          f."primaryMobileNo" as contact_no,
          f.email,
          CONCAT(e."firstName", ' ', COALESCE(e."middleName", ''), ' ', e."lastName") as registered_by,
          f.status
        FROM farmer f
        LEFT JOIN addresses ra ON f."residensialAddressId" = ra.id
        LEFT JOIN addresses fa ON f."farmAddressId" = fa.id
        LEFT JOIN employees e ON f.created_by = e.id
        WHERE f."createdAt" BETWEEN $1 AND $2
        ${locationFilter.filter.replace(/a\./g, 'ra.')}${employeeFilter.filter}
        ORDER BY f."createdAt" DESC
      `;

      const result = await AppDataSource.query(query, [
        dateRange.startDate,
        dateRange.endDate,
        ...locationFilter.params,
        ...employeeFilter.params,
      ]);

      return result.map((row: any) => ({
        code: row.code || '',
        name: row.name || '',
        residentialAddress: row.residential_address || '',
        farmAddress: row.farm_address || '',
        contactNo: row.contact_no || '',
        email: row.email || '',
        registeredBy: row.registered_by || '',
        status: row.status === 'notapproved' ? 'Not Approved' : row.status === 'pending' ? 'Pending' : 'Approved',
      }));
    } catch (error) {
      console.error('Error getting farmer data:', error);
      throw error;
    }
  }

  /**
   * Get vendor registrations
   */
  async getVendorData(filters: NewRegistrationFilters, dateRange: DateRange): Promise<any[]> {
    try {
      const locationFilter = this.buildLocationFilter(filters);
      const employeeFilter = this.buildEmployeeFilter(filters, 3 + locationFilter.params.length, 'v.created_by');
      
      const query = `
        SELECT 
          v.vendor_code as code,
          v.company_name as vendor_name,
          v.classification,
          vc.name as category,
          vs.name as subcategory,
          CONCAT(COALESCE(a.address1, ''), ' ', COALESCE(a.address2, ''), ', ', COALESCE(a.city, ''), ', ', COALESCE(a.state, ''), ' - ', COALESCE(a.pincode, '')) as address,
          CONCAT(v.ref_one_first_name, ' ', COALESCE(v.ref_one_middle_name, ''), ' ', COALESCE(v.ref_one_last_name, '')) as sales_contact_person_name,
          v.office_contact_number as contact_no,
          v.email,
          CONCAT(e."firstName", ' ', COALESCE(e."middleName", ''), ' ', e."lastName") as registered_by,
          v.status
        FROM vendor v
        LEFT JOIN addresses a ON v.office_address_id = a.id
        LEFT JOIN vendor_category vc ON v.vendor_category_id = vc.id
        LEFT JOIN vendor_subcategory vs ON v.vendor_subcategory_id = vs.id
        LEFT JOIN employees e ON v.created_by = e.id
        WHERE v."createdAt" BETWEEN $1 AND $2
        ${locationFilter.filter}${employeeFilter.filter}
        ORDER BY v."createdAt" DESC
      `;

      const result = await AppDataSource.query(query, [
        dateRange.startDate,
        dateRange.endDate,
        ...locationFilter.params,
        ...employeeFilter.params,
      ]);

      return result.map((row: any) => ({
        code: row.code || '',
        vendorName: row.vendor_name || '',
        classification: row.classification || '',
        category: row.category || '',
        subcategory: row.subcategory || '',
        address: row.address || '',
        salesContactPersonName: row.sales_contact_person_name || '',
        contactNo: row.contact_no || '',
        email: row.email || '',
        registeredBy: row.registered_by || '',
        status: row.status === 'notapproved' ? 'Not Approved' : row.status === 'pending' ? 'Pending' : 'Approved',
      }));
    } catch (error) {
      console.error('Error getting vendor data:', error);
      throw error;
    }
  }

  /**
   * Get customer registrations
   */
  /**
   * Get customer registrations
   */
  async getCustomerData(filters: NewRegistrationFilters, dateRange: DateRange): Promise<any[]> {
    try {
      const locationFilter = this.buildLocationFilter(filters);
      const employeeFilter = this.buildEmployeeFilter(filters, 3 + locationFilter.params.length, 'c.created_by');
      
      const query = `
        SELECT 
          c.customercode as code,
          c.organisation_name as customer_name,
          CONCAT(COALESCE(ba.address1, ''), ' ', COALESCE(ba.address2, ''), ', ', COALESCE(ba.city, ''), ', ', COALESCE(ba.state, ''), ' - ', COALESCE(ba.pincode, '')) as billing_address,
          CONCAT(COALESCE(da.address1, ''), ' ', COALESCE(da.address2, ''), ', ', COALESCE(da.city, ''), ', ', COALESCE(da.state, ''), ' - ', COALESCE(da.pincode, '')) as delivery_address,
          c.customer_primary_contact_number as contact_number,
          c.customer_email_primary as email,
          CONCAT(e."firstName", ' ', COALESCE(e."middleName", ''), ' ', e."lastName") as registered_by,
          c.status
        FROM customers c
        LEFT JOIN addresses ba ON c."customerAddressId" = ba.id
        LEFT JOIN customer_delivery_details dd ON c."deliveryDetailsId" = dd.id
        LEFT JOIN addresses da ON dd."deliveryAddressId" = da.id
        LEFT JOIN employees e ON c.created_by = e.id
        WHERE c."createdAt" BETWEEN $1 AND $2
        ${locationFilter.filter.replace(/a\./g, 'ba.')}${employeeFilter.filter}
        ORDER BY c."createdAt" DESC
      `;

      const result = await AppDataSource.query(query, [
        dateRange.startDate,
        dateRange.endDate,
        ...locationFilter.params,
        ...employeeFilter.params,
      ]);

      return result.map((row: any) => ({
        code: row.code || '',
        customerName: row.customer_name || '',
        billingAddress: row.billing_address || '',
        deliveryAddress: row.delivery_address || '',
        contactNumber: row.contact_number || '',
        email: row.email || '',
        registeredBy: row.registered_by || '',
        status: row.status === 'notapproved' ? 'Not Approved' : row.status === 'pending' ? 'Pending' : 'Approved',
      }));
    } catch (error) {
      console.error('Error getting customer data:', error);
      throw error;
    }
  }

  /**
   * Generate multi-sheet Excel report
   */
  async generateExcelReport(
    filters: NewRegistrationFilters,
    userName: string,
  ): Promise<Buffer | null> {
    try {
      const dateRange = this.buildDateRange(filters);
      
      // Get all data
      const summary = await this.getRegistrationSummary(filters, dateRange);
      const employeeAudit = await this.getEmployeeAudit(filters, dateRange);
      
      let farmerData: any[] = [];
      let vendorData: any[] = [];
      let customerData: any[] = [];

      if (filters.registrationType === 'all' || filters.registrationType === 'farmer') {
        farmerData = await this.getFarmerData(filters, dateRange);
      }
      if (filters.registrationType === 'all' || filters.registrationType === 'vendor') {
        vendorData = await this.getVendorData(filters, dateRange);
      }
      if (filters.registrationType === 'all' || filters.registrationType === 'customer') {
        customerData = await this.getCustomerData(filters, dateRange);
      }

      // Check if there's any data
      if (farmerData.length === 0 && vendorData.length === 0 && customerData.length === 0) {
        return null;
      }

      // Create workbook
      const workbook = new ExcelJS.Workbook();

      // Create sheets based on registration type
      await this.createMetadataSheet(workbook, filters, userName, dateRange);
      this.createRegistrationAuditSheet(workbook, employeeAudit, filters);
      
      if (filters.registrationType === 'all' || filters.registrationType === 'farmer') {
        this.createFarmerSheet(workbook, farmerData);
      }
      if (filters.registrationType === 'all' || filters.registrationType === 'vendor') {
        this.createVendorSheet(workbook, vendorData);
      }
      if (filters.registrationType === 'all' || filters.registrationType === 'customer') {
        this.createCustomerSheet(workbook, customerData);
      }

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      console.error('Error generating Excel report:', error);
      throw error;
    }
  }

  /**
   * Create Metadata Sheet
   */
  private async createMetadataSheet(
    workbook: ExcelJS.Workbook,
    filters: NewRegistrationFilters,
    userName: string,
    dateRange: DateRange,
  ): Promise<void> {
    const sheet = workbook.addWorksheet('Metadata');
    
    // Set column widths
    sheet.columns = [
      { width: 20 },  // Column A
      { width: 30 },  // Column B
      { width: 15 },  // Column C
      { width: 15 },  // Column D
      { width: 15 },  // Column E
    ];

    // Title row - "Registration Report" with yellow background
    const titleRow = sheet.addRow(['Registration Report']);
    titleRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFF00' } // Yellow
    };
    titleRow.getCell(1).font = { bold: true, size: 14 };
    titleRow.getCell(1).alignment = { vertical: 'middle' };
    sheet.mergeCells('A1:E1');
    titleRow.height = 25;

    // Empty row
    sheet.addRow([]);

    // Generated On
    const now = new Date();
    const generatedOnText = now.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).replace(',', '');
    const row3 = sheet.addRow(['Generated On :', generatedOnText]);
    row3.getCell(1).font = { bold: true };
    row3.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    row3.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

    // Generated By
    const row4 = sheet.addRow(['Generated By :', userName]);
    row4.getCell(1).font = { bold: true };
    row4.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    row4.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

    // Registration Type
    let regTypeText = '';
    if (filters.registrationType === 'all') {
      regTypeText = 'Customer, Vendor Farmer';
    } else {
      regTypeText = filters.registrationType.charAt(0).toUpperCase() + filters.registrationType.slice(1);
    }
    const row5 = sheet.addRow(['Registration Type :', regTypeText]);
    row5.getCell(1).font = { bold: true };
    row5.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    row5.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

    // Location
    const locationParts: string[] = [];
    if (filters.pincode && filters.pincode.trim().length > 0) {
      locationParts.push(filters.pincode.trim());
    }
    if (filters.city && filters.city.trim().length > 0) {
      locationParts.push(filters.city.trim());
    }
    if (filters.state && filters.state.trim().length > 0) {
      locationParts.push(filters.state.trim());
    }
    const locationText = locationParts.length > 0 ? locationParts.join(', ') : 'All';
    const row6 = sheet.addRow(['Location :', locationText]);
    row6.getCell(1).font = { bold: true };
    row6.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    row6.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    row6.getCell(2).alignment = { wrapText: true };

    // Period
    const startDateText = dateRange.startDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const endDateText = new Date(dateRange.endDate.getTime() - 86400000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const periodText = `${startDateText} To ${endDateText}`;
    const row7 = sheet.addRow(['Period :', periodText]);
    row7.getCell(1).font = { bold: true };
    row7.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    row7.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

    // Employee Names
    const employeeIdList = filters.employees ?? filters.employee ?? [];
    let employeeNamesText = 'All';
    if (employeeIdList.length > 0) {
      const employeeNames = await this.getEmployeeNames(employeeIdList);
      if (employeeNames.length > 0) {
        employeeNamesText = employeeNames.join(', ');
      }
    }
    const row8 = sheet.addRow(['Employee Names :', employeeNamesText]);
    row8.getCell(1).font = { bold: true };
    row8.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    row8.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    row8.getCell(2).alignment = { wrapText: true };

    // Empty row
    sheet.addRow([]);

    // Get summary data
    const summary = await this.getRegistrationSummary(filters, dateRange);

    // Summary title with gray background
    const summaryTitleRow = sheet.addRow(['Summary']);
    summaryTitleRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'D3D3D3' } // Gray
    };
    summaryTitleRow.getCell(1).font = { bold: true, size: 12 };
    summaryTitleRow.getCell(1).alignment = { vertical: 'middle' };
    sheet.mergeCells(`A${summaryTitleRow.number}:E${summaryTitleRow.number}`);
    summaryTitleRow.height = 20;

    // Empty row
    sheet.addRow([]);

    // Farmers section (if applicable)
    if (filters.registrationType === 'all' || filters.registrationType === 'farmer') {
      const farmerHeaderRow = sheet.addRow(['Farmers']);
      farmerHeaderRow.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '90EE90' } // Light green
      };
      farmerHeaderRow.getCell(1).font = { bold: true };
      farmerHeaderRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      farmerHeaderRow.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      sheet.mergeCells(`A${farmerHeaderRow.number}:B${farmerHeaderRow.number}`);

      const farmerRow1 = sheet.addRow(['Total Registered', summary.farmers.total]);
      farmerRow1.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      farmerRow1.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

      const farmerRow2 = sheet.addRow(['Total Pending', summary.farmers.pending]);
      farmerRow2.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      farmerRow2.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

      const farmerRow3 = sheet.addRow(['Total Not Approved', summary.farmers.notApproved]);
      farmerRow3.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      farmerRow3.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

      sheet.addRow([]);
    }

    // Vendors section (if applicable)
    if (filters.registrationType === 'all' || filters.registrationType === 'vendor') {
      const vendorHeaderRow = sheet.addRow(['Vendors']);
      vendorHeaderRow.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'ADD8E6' } // Light blue
      };
      vendorHeaderRow.getCell(1).font = { bold: true };
      vendorHeaderRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      vendorHeaderRow.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      sheet.mergeCells(`A${vendorHeaderRow.number}:B${vendorHeaderRow.number}`);

      const vendorRow1 = sheet.addRow(['Total Registered', summary.vendors.total]);
      vendorRow1.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      vendorRow1.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

      const vendorRow2 = sheet.addRow(['Total Pending', summary.vendors.pending]);
      vendorRow2.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      vendorRow2.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

      const vendorRow3 = sheet.addRow(['Total Not Approved', summary.vendors.notApproved]);
      vendorRow3.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      vendorRow3.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

      sheet.addRow([]);
    }

    // Customers section (if applicable)
    if (filters.registrationType === 'all' || filters.registrationType === 'customer') {
      const customerHeaderRow = sheet.addRow(['Customers']);
      customerHeaderRow.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFB6C1' } // Light pink
      };
      customerHeaderRow.getCell(1).font = { bold: true };
      customerHeaderRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      customerHeaderRow.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      sheet.mergeCells(`A${customerHeaderRow.number}:B${customerHeaderRow.number}`);

      const customerRow1 = sheet.addRow(['Total Registered', summary.customers.total]);
      customerRow1.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      customerRow1.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

      const customerRow2 = sheet.addRow(['Total Pending', summary.customers.pending]);
      customerRow2.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      customerRow2.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

      const customerRow3 = sheet.addRow(['Total Not Approved', summary.customers.notApproved]);
      customerRow3.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      customerRow3.getCell(2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    }
  }

  /**
   * Create Registration Audit Sheet (Employee-wise summary)
   */
  private createRegistrationAuditSheet(
    workbook: ExcelJS.Workbook,
    employeeAudit: EmployeeAudit[],
    filters: NewRegistrationFilters,
  ): void {
    const sheet = workbook.addWorksheet('Registration Audit');
    
    // Determine which columns to show based on registration type
    const showFarmer = filters.registrationType === 'all' || filters.registrationType === 'farmer';
    const showVendor = filters.registrationType === 'all' || filters.registrationType === 'vendor';
    const showCustomer = filters.registrationType === 'all' || filters.registrationType === 'customer';

    // Build header arrays dynamically
    const row1Headers = ['Employee Name'];
    const row2Headers = [''];  // Empty for Employee Name column in row 2
    const columnWidths = [30]; // Employee Name column width

    if (showFarmer) {
      row1Headers.push('Farmer', '', '');
      row2Headers.push('Registered', 'Pending Approval', 'Not Approved');
      columnWidths.push(12, 16, 14);
    }

    if (showVendor) {
      row1Headers.push('Vendor', '', '');
      row2Headers.push('Registered', 'Pending Approval', 'Not Approved');
      columnWidths.push(12, 16, 14);
    }

    if (showCustomer) {
      row1Headers.push('Customer', '', '');
      row2Headers.push('Registered', 'Pending Approval', 'Not Approved');
      columnWidths.push(12, 16, 14);
    }

    // Set column widths
    columnWidths.forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });

    // First header row - Category headers (Employee Name, Farmer, Vendor, Customer)
    const categoryRow = sheet.addRow(row1Headers);

    // Second header row - Sub-headers (Registered, Pending Approval, Not Approved)
    const subHeaderRow = sheet.addRow(row2Headers);

    // Merge Employee Name cell vertically (rows 1 and 2, column 1)
    sheet.mergeCells(1, 1, 2, 1);

    // Merge cells for category headers horizontally
    let colIndex = 2;
    if (showFarmer) {
      sheet.mergeCells(1, colIndex, 1, colIndex + 2); // Merge 3 columns for Farmer
      colIndex += 3;
    }
    if (showVendor) {
      sheet.mergeCells(1, colIndex, 1, colIndex + 2); // Merge 3 columns for Vendor
      colIndex += 3;
    }
    if (showCustomer) {
      sheet.mergeCells(1, colIndex, 1, colIndex + 2); // Merge 3 columns for Customer
      colIndex += 3;
    }

    // Style category row
    categoryRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };

      // Color code the categories based on what's shown
      let colorColIndex = 2;
      
      if (showFarmer) {
        if (colNumber >= colorColIndex && colNumber <= colorColIndex + 2) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '90EE90' }, // Light Green
          };
        }
        colorColIndex += 3;
      }
      
      if (showVendor) {
        if (colNumber >= colorColIndex && colNumber <= colorColIndex + 2) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'ADD8E6' }, // Light Blue
          };
        }
        colorColIndex += 3;
      }
      
      if (showCustomer) {
        if (colNumber >= colorColIndex && colNumber <= colorColIndex + 2) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFB6C1' }, // Light Pink
          };
        }
        colorColIndex += 3;
      }
    });

    // Style sub-header row
    subHeaderRow.eachCell((cell, colNumber) => {
      // Skip column 1 (Employee Name) as it's merged with row 1
      if (colNumber === 1) return;
      
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };

      // Apply same background colors as category row
      let colorColIndex = 2;
      
      if (showFarmer) {
        if (colNumber >= colorColIndex && colNumber <= colorColIndex + 2) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '90EE90' },
          };
        }
        colorColIndex += 3;
      }
      
      if (showVendor) {
        if (colNumber >= colorColIndex && colNumber <= colorColIndex + 2) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'ADD8E6' },
          };
        }
        colorColIndex += 3;
      }
      
      if (showCustomer) {
        if (colNumber >= colorColIndex && colNumber <= colorColIndex + 2) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFB6C1' },
          };
        }
        colorColIndex += 3;
      }
    });

    // Set row height for headers
    categoryRow.height = 20;
    subHeaderRow.height = 30;

    // Data rows - dynamically build based on registration type
    employeeAudit.forEach((emp) => {
      const rowData: any[] = [emp.employeeName];

      if (showFarmer) {
        rowData.push(emp.farmerRegistered, emp.farmerPending, emp.farmerNotApproved);
      }

      if (showVendor) {
        rowData.push(emp.vendorRegistered, emp.vendorPending, emp.vendorNotApproved);
      }

      if (showCustomer) {
        rowData.push(emp.customerRegistered, emp.customerPending, emp.customerNotApproved);
      }

      const dataRow = sheet.addRow(rowData);

      dataRow.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        
        if (colNumber === 1) {
          // Employee name - left align
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else {
          // Numbers - center align
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
    });
  }

  /**
   * Create Farmer Sheet
   */
  private createFarmerSheet(workbook: ExcelJS.Workbook, farmerData: any[]): void {
    const sheet = workbook.addWorksheet('Farmers');
    
    // Title
    const titleRow = sheet.addRow(['Farmers']);
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '90EE90' } };
    titleRow.getCell(1).font = { bold: true, size: 14 };
    sheet.mergeCells('A1:H1');

    sheet.addRow([]);

    // Header row
    const headerRow = sheet.addRow([
      'Code',
      'Name',
      'Residential Address',
      'Farm Address',
      'Contact No',
      'Email',
      'Registered By',
      'Status',
    ]);

    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'ADD8E6' } };
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    // Data rows
    farmerData.forEach((farmer) => {
      const dataRow = sheet.addRow([
        farmer.code,
        farmer.name,
        farmer.residentialAddress,
        farmer.farmAddress,
        farmer.contactNo,
        farmer.email,
        farmer.registeredBy,
        farmer.status,
      ]);

      dataRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    });

    // Set column widths
    sheet.getColumn(1).width = 15; // Code
    sheet.getColumn(2).width = 25; // Name
    sheet.getColumn(3).width = 35; // Residential Address
    sheet.getColumn(4).width = 35; // Farm Address
    sheet.getColumn(5).width = 15; // Contact No
    sheet.getColumn(6).width = 25; // Email
    sheet.getColumn(7).width = 20; // Registered By
    sheet.getColumn(8).width = 15; // Status
  }

  /**
   * Create Vendor Sheet
   */
  private createVendorSheet(workbook: ExcelJS.Workbook, vendorData: any[]): void {
    const sheet = workbook.addWorksheet('Vendors');
    
    // Title
    const titleRow = sheet.addRow(['Vendors']);
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'ADD8E6' } };
    titleRow.getCell(1).font = { bold: true, size: 14 };
    sheet.mergeCells('A1:K1');

    sheet.addRow([]);

    // Header row
    const headerRow = sheet.addRow([
      'Code',
      'Vendor Name',
      'Classification',
      'Category',
      'Subcategory',
      'Address',
      'Sales Contact Person Name',
      'Contact No',
      'Email',
      'Registered By',
      'Status',
    ]);

    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD700' } };
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    // Data rows
    vendorData.forEach((vendor) => {
      const dataRow = sheet.addRow([
        vendor.code,
        vendor.vendorName,
        vendor.classification,
        vendor.category,
        vendor.subcategory,
        vendor.address,
        vendor.salesContactPersonName,
        vendor.contactNo,
        vendor.email,
        vendor.registeredBy,
        vendor.status,
      ]);

      dataRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    });

    // Set column widths
    sheet.getColumn(1).width = 15; // Code
    sheet.getColumn(2).width = 25; // Vendor Name
    sheet.getColumn(3).width = 20; // Classification
    sheet.getColumn(4).width = 20; // Category
    sheet.getColumn(5).width = 20; // Subcategory
    sheet.getColumn(6).width = 35; // Address
    sheet.getColumn(7).width = 25; // Sales Contact Person Name
    sheet.getColumn(8).width = 15; // Contact No
    sheet.getColumn(9).width = 25; // Email
    sheet.getColumn(10).width = 20; // Registered By
    sheet.getColumn(11).width = 15; // Status
  }

  /**
   * Create Customer Sheet
   */
  private createCustomerSheet(workbook: ExcelJS.Workbook, customerData: any[]): void {
    const sheet = workbook.addWorksheet('Customers');
    
    // Title
    const titleRow = sheet.addRow(['Customers']);
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB6C1' } };
    titleRow.getCell(1).font = { bold: true, size: 14 };
    sheet.mergeCells('A1:H1');

    sheet.addRow([]);

    // Header row
    const headerRow = sheet.addRow([
      'Code',
      'Customer Name',
      'Billing Address',
      'Delivery Address',
      'Contact Number',
      'Email',
      'Registered By',
      'Status',
    ]);

    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA500' } };
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    // Data rows
    customerData.forEach((customer) => {
      const dataRow = sheet.addRow([
        customer.code,
        customer.customerName,
        customer.billingAddress,
        customer.deliveryAddress,
        customer.contactNumber,
        customer.email,
        customer.registeredBy,
        customer.status,
      ]);

      dataRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    });

    // Set column widths
    sheet.getColumn(1).width = 15; // Code
    sheet.getColumn(2).width = 30; // Customer Name
    sheet.getColumn(3).width = 35; // Billing Address
    sheet.getColumn(4).width = 35; // Delivery Address
    sheet.getColumn(5).width = 15; // Contact Number
    sheet.getColumn(6).width = 25; // Email
    sheet.getColumn(7).width = 20; // Registered By
    sheet.getColumn(8).width = 15; // Status
  }
}
