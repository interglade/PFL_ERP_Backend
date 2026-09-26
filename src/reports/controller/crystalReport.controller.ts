import { inject } from 'inversify';
import {
  controller,
  httpGet,
  httpPost,
  request,
  response,
  next,
  queryParam,
  requestBody
} from 'inversify-express-utils';
import { Request, Response, NextFunction } from 'express';



import * as ExcelJS from 'exceljs';
import { format } from 'date-fns';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { CrystalReportService, ProcurementReportFilters } from '../service/crystalReport.service';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';

@controller('/crystalreports', deserializeUser, requireUser)
export class CrystalReportController {
  constructor(
    @inject(TYPES.CrystalReportService) private crystalReportService: CrystalReportService
  ) {}

  /**
   * Generate detailed procurement report
   */
  @httpPost('/procurement/detailed')
  public async generateDetailedProcurementReport(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const filters: ProcurementReportFilters = req.body;
      
      // Convert string dates to Date objects
      if (filters.startDate) {
        filters.startDate = new Date(filters.startDate);
      }
      if (filters.endDate) {
        filters.endDate = new Date(filters.endDate);
      }

      const reportData = await this.crystalReportService.generateProcurementReport(filters);
      
     

      res.status(200).json({
        status: 'success',
        data: reportData,
        meta: {
          totalRecords: reportData.length,
          generatedAt: new Date().toISOString(),
          filters
        }
      });
    } catch (error) {
     
      next(new AppError(500, 'Failed to generate procurement report'));
    }
  }

  /**
   * Generate procurement summary report
   */
  @httpPost('/procurement/summary')
  public async generateProcurementSummary(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const filters: ProcurementReportFilters = req.body;
      
      if (filters.startDate) {
        filters.startDate = new Date(filters.startDate);
      }
      if (filters.endDate) {
        filters.endDate = new Date(filters.endDate);
      }

      const summaryData = await this.crystalReportService.generateProcurementSummary(filters);
      
      

      res.status(200).json({
        status: 'success',
        data: summaryData,
        meta: {
          generatedAt: new Date().toISOString(),
          filters
        }
      });
    } catch (error) {
      
      next(new AppError(500, 'Failed to generate procurement summary'));
    }
  }

  /**
   * Generate vendor-wise procurement report
   */
  @httpPost('/procurement/vendor-wise')
  public async generateVendorWiseProcurementReport(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const filters: ProcurementReportFilters = req.body;
      
      if (filters.startDate) {
        filters.startDate = new Date(filters.startDate);
      }
      if (filters.endDate) {
        filters.endDate = new Date(filters.endDate);
      }

      const reportData = await this.crystalReportService.generateVendorWiseProcurementReport(filters);
      
      

      res.status(200).json({
        status: 'success',
        data: reportData,
        meta: {
          totalRecords: reportData.length,
          generatedAt: new Date().toISOString(),
          filters
        }
      });
    } catch (error) {
      
      next(new AppError(500, 'Failed to generate vendor-wise procurement report'));
    }
  }

  /**
   * Generate product-wise procurement report
   */
  @httpPost('/procurement/product-wise')
  public async generateProductWiseProcurementReport(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const filters: ProcurementReportFilters = req.body;
      
      if (filters.startDate) {
        filters.startDate = new Date(filters.startDate);
      }
      if (filters.endDate) {
        filters.endDate = new Date(filters.endDate);
      }

      const reportData = await this.crystalReportService.generateProductWiseProcurementReport(filters);
      
      

      res.status(200).json({
        status: 'success',
        data: reportData,
        meta: {
          totalRecords: reportData.length,
          generatedAt: new Date().toISOString(),
          filters
        }
      });
    } catch (error) {
     
      next(new AppError(500, 'Failed to generate product-wise procurement report'));
    }
  }

  /**
   * Export detailed procurement report to Excel
   */
  @httpPost('/procurement/export/excel')
  public async exportProcurementReportToExcel(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const filters: ProcurementReportFilters = req.body;
      
      if (filters.startDate) {
        filters.startDate = new Date(filters.startDate);
      }
      if (filters.endDate) {
        filters.endDate = new Date(filters.endDate);
      }

      const reportData = await this.crystalReportService.generateProcurementReport(filters);
      
      // Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Procurement Report');

      // Add headers
      const headers = [
        'GRN No', 'GRN Date', 'GRN Type', 'Purchase Type', 'Vendor Name', 
        'Farmer Name', 'Company', 'Branch', 'Purchase Location', 'Bill No', 
        'Vehicle No', 'Total Amount', 'Sub Total', 'Freight', 'Other Charges',
        'Purchased By', 'Created By', 'Source', 'Product Name', 'Variant',
        'Quantity', 'Revised Quantity', 'Unit Price', 'Revised Rate', 'Amount',
        'UOM', 'Gross Weight', 'Net Weight', 'Packing Material Weight',
        'Purchase Date', 'Delivery Date', 'Delivery Location'
      ];

      worksheet.addRow(headers);

      // Style headers
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      // Add data rows
      reportData.forEach(grn => {
        if (grn.products && grn.products.length > 0) {
          grn.products.forEach(product => {
            worksheet.addRow([
              grn.grnNo, grn.grnDate, grn.grnType, grn.purchaseType,
              grn.vendorName, grn.farmerName, grn.companyName, grn.branchName,
              grn.purchaseLocation, grn.billNo, grn.vehicleNo, grn.totalAmount,
              grn.subTotalAmount, grn.freight, grn.otherCharges, grn.purchasedBy,
              grn.createdBy, grn.source, product.productName, product.variantName,
              product.quantity, product.revisedQuantity, product.unitPrice,
              product.revisedRate, product.amount, product.uom, product.grossWeight,
              product.netWeight, product.packingMaterialWeight, product.purchaseDate,
              product.deliveryDate
            ]);
          });
        } else {
          worksheet.addRow([
            grn.grnNo, grn.grnDate, grn.grnType, grn.purchaseType,
            grn.vendorName, grn.farmerName, grn.companyName, grn.branchName,
            grn.purchaseLocation, grn.billNo, grn.vehicleNo, grn.totalAmount,
            grn.subTotalAmount, grn.freight, grn.otherCharges, grn.purchasedBy,
            grn.createdBy, grn.source, '', '', '', '', '', '', '', '', '', '', '', '', '', ''
          ]);
        }
      });

      // Auto-fit columns
      worksheet.columns.forEach(column => {
        column.width = 15;
      });

      // Set response headers for Excel download
      const fileName = `Procurement_Report_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      // Write to response
      await workbook.xlsx.write(res);
      res.end();

     ;

    } catch (error) {
     
      next(new AppError(500, 'Failed to export procurement report to Excel'));
    }
  }

  /**
   * Get procurement report filters/options
   */
  @httpGet('/procurement/filters')
  public async getProcurementReportFilters(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      // This would typically fetch available filter options from the database
      const filterOptions = {
        grnTypes: ['transfer', 'purchase'],
        purchaseTypes: ['fixed price sales', 'consignment sales / bikri', 'mgp sales'],
        sources: ['vendor', 'farmer', 'market', 'direct'],
        locationTypes: ['cc', 'dc']
      };

      res.status(200).json({
        status: 'success',
        data: filterOptions
      });
    } catch (error) {
     
      next(new AppError(500, 'Failed to fetch report filters'));
    }
  }
}