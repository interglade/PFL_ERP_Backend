import { inject } from 'inversify';
import {
  controller,
  httpPost,
  request,
  response,
  next,
} from 'inversify-express-utils';

import { NextFunction, Request, Response } from 'express';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { TYPES } from '../../types';
import { ReportService } from '../service/report.service';
import { SalesReportService } from '../service/salesReport.service';
import { NotificationService } from '../../notification/service/notification.service';
import { s3 } from '../../middleware/spaces.config';
import { ControllerLogger } from '../../utils/controllerLogger';
import AppError from '../../utils/appError';


export interface ReportFilters {
  reportBased: 'employee' | 'location' | 'company' | 'source' | 'vendor' | 'farmer' | 'product';
  companyNames?: string[];
  locations?: string[];
  employees?: string[];
  source?: 'vendor' | 'farmer';
  vendors?: string[];
  farmers?: string[];
  units: 'kg' | 'tonnes';
  products?: string[];
  period: 'custom' | 'previous_month' | 'current_month' | 'month_year' | 'quarterly';
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
  quarter?: 1 | 2 | 3 | 4;
}

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

@controller('/reports', deserializeUser, requireUser)
export class ReportController {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(
    @inject(TYPES.ReportService)
    private reportService: ReportService,
    @inject(TYPES.SalesReportService)
    private salesReportService: SalesReportService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
  ) {
    this.s3Client = s3;
    this.bucketName = process.env.DO_SPACES_BUCKET || 'your-bucket-name';
  }

  @httpPost('/generate')
  public async generateReport(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const filters: ReportFilters = req.body;
      
      // Validate required fields
      if (!filters.reportBased || !filters.units || !filters.period) {
        ControllerLogger.logValidationError('Generate Report', 'Missing required fields', req, res);
        return next(new AppError(400, 'reportBased, units, and period are required fields'));
      }

      // Validate period-specific requirements
      if (filters.period === 'custom' && (!filters.startDate || !filters.endDate)) {
        ControllerLogger.logValidationError('Generate Report', 'Custom period requires start and end dates', req, res);
        return next(new AppError(400, 'startDate and endDate are required for custom period'));
      }

      if (filters.period === 'month_year' && (!filters.month || !filters.year)) {
        ControllerLogger.logValidationError('Generate Report', 'Month/year period requires month and year', req, res);
        return next(new AppError(400, 'month and year are required for month_year period'));
      }

      if (filters.period === 'quarterly' && !filters.quarter) {
        ControllerLogger.logValidationError('Generate Report', 'Quarterly period requires quarter', req, res);
        return next(new AppError(400, 'quarter is required for quarterly period'));
      }

      // Validate source-specific requirements
      if (filters.source === 'vendor' && (!filters.vendors || filters.vendors.length === 0)) {
        ControllerLogger.logValidationError('Generate Report', 'Vendor source requires vendor IDs', req, res);
        return next(new AppError(400, 'vendors array is required when source is vendor'));
      }

      if (filters.source === 'farmer' && (!filters.farmers || filters.farmers.length === 0)) {
        ControllerLogger.logValidationError('Generate Report', 'Farmer source requires farmer IDs', req, res);
        return next(new AppError(400, 'farmers array is required when source is farmer'));
      }

      const reportData = await this.reportService.generateReport(filters);
      if (!reportData) {
        ControllerLogger.logOperationFailed('Generate', 'Report', 'No data found for the given filters', req, res);
        return res.status(404).json({
          status: 'error',
          message: 'No data found for the given filters',
        });
      }

      // Send notification for report generation
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Report generated successfully for ${filters.reportBased}`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Report generation notification error:', notifError);
      // }

      ControllerLogger.logSuccess('Report generated', `${filters.reportBased}_report`, req, res);

      res.status(200).json({
        status: 'success',
        message: 'Report generated successfully',
        data: reportData,
        filters: filters,
      });
    } catch (err) {
      ControllerLogger.logError('Generate Report', err, req, res);
      next(err);
    }
  }

  @httpPost('/summary')
  public async getReportSummary(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const filters: ReportFilters = req.body;
      
      if (!filters.reportBased || !filters.units || !filters.period) {
        ControllerLogger.logValidationError('Get Report Summary', 'Missing required fields', req, res);
        return next(new AppError(400, 'reportBased, units, and period are required fields'));
      }

      const summary = await this.reportService.getReportSummary(filters);

      if (!summary) {
        ControllerLogger.logOperationFailed('Get', 'Report Summary', 'No data found', req, res);
        return res.status(404).json({
          status: 'error',
          message: 'No summary data found for the given filters',
        });
      }

      // Send notification for summary generation
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Report summary generated for ${filters.reportBased}`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Report summary notification error:', notifError);
      // }

      ControllerLogger.logSuccess('Report summary generated', `${filters.reportBased}_summary`, req, res);

      res.status(200).json({
        status: 'success',
        message: 'Report summary generated successfully',
        data: summary,
      });
    } catch (err) {
      ControllerLogger.logError('Get Report Summary', err, req, res);
      next(err);
    }
  }

  @httpPost('/export-excel')
  public async exportToExcel(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const filters: ReportFilters = req.body;
      
      // Validate required fields
      if (!filters.reportBased || !filters.units || !filters.period) {
        ControllerLogger.logValidationError('Export Excel Report', 'Missing required fields', req, res);
        return next(new AppError(400, 'reportBased, units, and period are required fields'));
      }

      // Validate period-specific requirements
      if (filters.period === 'custom' && (!filters.startDate || !filters.endDate)) {
        ControllerLogger.logValidationError('Export Excel Report', 'Custom period requires start and end dates', req, res);
        return next(new AppError(400, 'startDate and endDate are required for custom period'));
      }

      const excelBuffer = await this.reportService.generateExcelReport(filters);
      
      if (!excelBuffer) {
        ControllerLogger.logOperationFailed('Export', 'Excel Report', 'No data found for the given filters', req, res);
        return res.status(404).json({
          status: 'error',
          message: 'No data found for the given filters',
        });
      }

      // Send notification for Excel export
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Excel report exported successfully for ${filters.reportBased}`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Excel export notification error:', notifError);
      // }

      // Set headers for Excel file download
      const fileName = `Procurement_Report_${filters.reportBased}_${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', excelBuffer.length);

      ControllerLogger.logSuccess('Excel report exported', fileName, req, res);

      res.send(excelBuffer);
    } catch (err) {
      ControllerLogger.logError('Export Excel Report', err, req, res);
      next(err);
    }
  }

  @httpPost('/download/procurementReport')
  public async exportToExcelAndStore(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const filters: ReportFilters = req.body;
      
      // Validate required fields
      if (!filters.reportBased || !filters.units || !filters.period) {
        ControllerLogger.logValidationError('Export Excel to Spaces', 'Missing required fields', req, res);
        return next(new AppError(400, 'reportBased, units, and period are required fields'));
      }

      // Validate period-specific requirements
      if (filters.period === 'custom' && (!filters.startDate || !filters.endDate)) {
        ControllerLogger.logValidationError('Export Excel to Spaces', 'Custom period requires start and end dates', req, res);
        return next(new AppError(400, 'startDate and endDate are required for custom period'));
      }

      const excelBuffer = await this.reportService.generateExcelReport(filters);
      
      if (!excelBuffer) {
        ControllerLogger.logOperationFailed('Export', 'Excel to Spaces', 'No data found for the given filters', req, res);
        return res.status(404).json({
          status: 'error',
          message: 'No data found for the given filters',
        });
      }

      // Generate unique filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `Procurement_Report_${filters.reportBased}_${timestamp}.xlsx`;
      const s3Key = `reports/excel/${fileName}`;

      // Upload to DigitalOcean Spaces
      const uploadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: excelBuffer,
        ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ContentDisposition: `attachment; filename="${fileName}"`,
        ACL: 'public-read' as const, // Make file publicly accessible
      };

      await this.s3Client.send(new PutObjectCommand(uploadParams));

      // Generate file URL
      const fileUrl = `https://${this.bucketName}.sgp1.digitaloceanspaces.com/${s3Key}`;

      // Send notification for Excel export
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Excel report stored in cloud for ${filters.reportBased}: ${fileName}`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Excel export notification error:', notifError);
      // }

      ControllerLogger.logSuccess('Excel report stored in DigitalOcean Spaces', fileName, req, res);

      res.status(200).json({
        status: 'success',
        message: 'Excel report generated and stored successfully',
        data: {
          //fileName: fileName,
          fileUrl: fileUrl,
          // fileSize: excelBuffer.length,
          // uploadedAt: new Date().toISOString(),
          // filters: filters,
        },
      });
    } catch (err) {
      ControllerLogger.logError('Export Excel to Spaces', err, req, res);
      next(err);
    }
  }

  @httpPost('/download/salesReport')
  public async exportSalesReportToExcelAndStore(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const filters: SalesReportFilters = req.body;
      
      // Normalize field names: handle both singular and plural forms
      if (req.body.customer && !filters.customers) {
        filters.customers = req.body.customer;
      }
      
      // Validate required fields
      if (!filters.reportBased || !filters.units || !filters.period) {
        ControllerLogger.logValidationError('Export Sales Excel to Spaces', 'Missing required fields', req, res);
        return next(new AppError(400, 'reportBased, units, and period are required fields'));
      }

      // Validate period-specific requirements
      if (filters.period === 'custom' && (!filters.startDate || !filters.endDate)) {
        ControllerLogger.logValidationError('Export Sales Excel to Spaces', 'Custom period requires start and end dates', req, res);
        return next(new AppError(400, 'startDate and endDate are required for custom period'));
      }

      if (filters.period === 'month_year' && (!filters.month || !filters.year)) {
        ControllerLogger.logValidationError('Export Sales Excel to Spaces', 'Month/year period requires month and year', req, res);
        return next(new AppError(400, 'month and year are required for month_year period'));
      }

      if (filters.period === 'quarterly' && !filters.quarter) {
        ControllerLogger.logValidationError('Export Sales Excel to Spaces', 'Quarterly period requires quarter', req, res);
        return next(new AppError(400, 'quarter is required for quarterly period'));
      }

      const excelBuffer = await this.salesReportService.generateSalesExcelReport(filters);
      
      if (!excelBuffer) {
        ControllerLogger.logOperationFailed('Export', 'Sales Excel to Spaces', 'No data found for the given filters', req, res);
        return res.status(404).json({
          status: 'error',
          message: 'No data found for the given filters',
        });
      }

      // Generate unique filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `Sales_Report_${filters.reportBased}_${timestamp}.xlsx`;
      const s3Key = `reports/excel/${fileName}`;

      // Upload to DigitalOcean Spaces
      const uploadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: excelBuffer,
        ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ContentDisposition: `attachment; filename="${fileName}"`,
        ACL: 'public-read' as const,
      };

      await this.s3Client.send(new PutObjectCommand(uploadParams));

      // Generate file URL
      const fileUrl = `https://${this.bucketName}.sgp1.digitaloceanspaces.com/${s3Key}`;

      // Send notification for Excel export
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Sales report stored in cloud for ${filters.reportBased}: ${fileName}`,
            userId
          );
        }
      } catch (notifError) {
      }

      ControllerLogger.logSuccess('Sales Excel report stored in DigitalOcean Spaces', fileName, req, res);

      res.status(200).json({
        status: 'success',
        message: 'Sales Excel report generated and stored successfully',
        data: {
          fileUrl: fileUrl,
        },
      });
    } catch (err) {
      ControllerLogger.logError('Export Sales Excel to Spaces', err, req, res);
      next(err);
    }
  }
}