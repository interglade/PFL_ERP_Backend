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
import { ControllerLogger } from '../../utils/controllerLogger';
import { RegistrationReportFilters, RegistrationReportService } from '../service/registrationReport.service';
import AppError from '../../utils/appError';
import { TYPES } from '../../types';
import { NotificationService } from '../../notification/service/notification.service';
import { s3 } from '../../middleware/spaces.config';


/**
 * REGISTRATION REPORT CONTROLLER
 * 
 * This controller handles HTTP requests for registration reports.
 * It provides endpoints for:
 * 1. Generating registration reports (list of registrations)
 * 2. Getting registration summaries (counts and statistics)
 * 3. Exporting registration reports to Excel and storing in cloud
 * 
 * All endpoints require authentication (deserializeUser, requireUser middleware)
 * 
 * ENDPOINTS:
 * - POST /registration-reports/generate - Get list of registrations
 * - POST /registration-reports/summary - Get registration counts/summary
 * - POST /registration-reports/download - Generate Excel and upload to cloud
 */

@controller('/registration-reports', deserializeUser, requireUser)
export class RegistrationReportsController {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(
    @inject(TYPES.RegistrationReportService)
    private registrationReportService: RegistrationReportService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
  ) {
    this.s3Client = s3;
    this.bucketName = process.env.DO_SPACES_BUCKET || 'your-bucket-name';
  }

  /**
   * ENDPOINT: Generate Registration Report
   * 
   * POST /registration-reports/generate
   * 
   * Request Body Example:
   * {
   *   "reportType": "vendor",  // or "farmer" or "customer"
   *   "period": "current_month",  // or "custom", "previous_month", "month_year", "quarterly"
   *   "status": "all",  // or "pending", "approved", "rejected"
   *   "startDate": "2024-01-01",  // Required if period is "custom"
   *   "endDate": "2024-01-31",  // Required if period is "custom"
   *   "month": 1,  // Required if period is "month_year"
   *   "year": 2024,  // Required if period is "month_year" or "quarterly"
   *   "quarter": 1,  // Required if period is "quarterly" (1-4)
   *   "createdByIds": ["uuid1", "uuid2"]  // Optional: filter by who registered
   * }
   * 
   * Response:
   * {
   *   "status": "success",
   *   "message": "Registration report generated successfully",
   *   "data": [
   *     {
   *       "id": "uuid",
   *       "name": "Company Name / Person Name",
   *       "code": "VEN001 / FAR001 / CUS001",
   *       "contactNumber": "1234567890",
   *       "email": "email@example.com",
   *       "address": "Full Address",
   *       "status": "approved",
   *       "createdBy": "Employee Name",
   *       "createdAt": "01/01/2024"
   *     }
   *   ],
   *   "count": 10
   * }
   */
  @httpPost('/generate')
  public async generateRegistrationReport(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const filters: RegistrationReportFilters = req.body;

      // Validate required fields
      if (!filters.reportType || !filters.period) {
        ControllerLogger.logValidationError(
          'Generate Registration Report',
          'Missing required fields',
          req,
          res,
        );
        return next(
          new AppError(400, 'reportType and period are required fields'),
        );
      }

      // Validate reportType
      if (!['vendor', 'farmer', 'customer'].includes(filters.reportType)) {
        ControllerLogger.logValidationError(
          'Generate Registration Report',
          'Invalid report type',
          req,
          res,
        );
        return next(
          new AppError(
            400,
            'reportType must be one of: vendor, farmer, customer',
          ),
        );
      }

      // Validate period-specific requirements
      if (
        filters.period === 'custom' &&
        (!filters.startDate || !filters.endDate)
      ) {
        ControllerLogger.logValidationError(
          'Generate Registration Report',
          'Custom period requires start and end dates',
          req,
          res,
        );
        return next(
          new AppError(
            400,
            'startDate and endDate are required for custom period',
          ),
        );
      }

      if (
        filters.period === 'month_year' &&
        (!filters.month || !filters.year)
      ) {
        ControllerLogger.logValidationError(
          'Generate Registration Report',
          'Month/year period requires month and year',
          req,
          res,
        );
        return next(
          new AppError(400, 'month and year are required for month_year period'),
        );
      }

      if (filters.period === 'quarterly' && !filters.quarter) {
        ControllerLogger.logValidationError(
          'Generate Registration Report',
          'Quarterly period requires quarter',
          req,
          res,
        );
        return next(
          new AppError(400, 'quarter is required for quarterly period'),
        );
      }

      // Generate the report
      const reportData =
        await this.registrationReportService.generateRegistrationReport(
          filters,
        );

      if (!reportData || reportData.length === 0) {
        ControllerLogger.logOperationFailed(
          'Generate',
          'Registration Report',
          'No data found for the given filters',
          req,
          res,
        );
        return res.status(404).json({
          status: 'error',
          message: 'No registration data found for the given filters',
        });
      }

      // Send notification for report generation
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `${filters.reportType} registration report generated successfully`,
            userId,
          );
        }
      } catch (notifError) {
      }

      ControllerLogger.logSuccess(
        'Registration report generated',
        `${filters.reportType}_registration_report`,
        req,
        res,
      );

      res.status(200).json({
        status: 'success',
        message: 'Registration report generated successfully',
        data: reportData,
        count: reportData.length,
        filters: filters,
      });
    } catch (err) {
      ControllerLogger.logError('Generate Registration Report', err, req, res);
      next(err);
    }
  }

  /**
   * ENDPOINT: Get Registration Summary
   * 
   * POST /registration-reports/summary
   * 
   * Request Body: Same as /generate endpoint
   * 
   * Response:
   * {
   *   "status": "success",
   *   "message": "Registration summary generated successfully",
   *   "data": {
   *     "totalCount": 100,
   *     "pendingCount": 20,
   *     "approvedCount": 70,
   *     "rejectedCount": 10
   *   }
   * }
   */
  @httpPost('/summary')
  public async getRegistrationSummary(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const filters: RegistrationReportFilters = req.body;

      // Validate required fields
      if (!filters.reportType || !filters.period) {
        ControllerLogger.logValidationError(
          'Get Registration Summary',
          'Missing required fields',
          req,
          res,
        );
        return next(
          new AppError(400, 'reportType and period are required fields'),
        );
      }

      // Validate reportType
      if (!['vendor', 'farmer', 'customer'].includes(filters.reportType)) {
        ControllerLogger.logValidationError(
          'Get Registration Summary',
          'Invalid report type',
          req,
          res,
        );
        return next(
          new AppError(
            400,
            'reportType must be one of: vendor, farmer, customer',
          ),
        );
      }

      // Generate the summary
      const summary =
        await this.registrationReportService.getRegistrationSummary(filters);

      if (!summary) {
        ControllerLogger.logOperationFailed(
          'Get',
          'Registration Summary',
          'No data found',
          req,
          res,
        );
        return res.status(404).json({
          status: 'error',
          message: 'No summary data found for the given filters',
        });
      }

      // Send notification for summary generation
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `${filters.reportType} registration summary generated`,
            userId,
          );
        }
      } catch (notifError) {
      }

      ControllerLogger.logSuccess(
        'Registration summary generated',
        `${filters.reportType}_registration_summary`,
        req,
        res,
      );

      res.status(200).json({
        status: 'success',
        message: 'Registration summary generated successfully',
        data: summary,
      });
    } catch (err) {
      ControllerLogger.logError('Get Registration Summary', err, req, res);
      next(err);
    }
  }

  /**
   * ENDPOINT: Download Registration Report (Excel)
   * 
   * POST /registration-reports/download
   * 
   * Request Body: Same as /generate endpoint
   * 
   * This endpoint:
   * 1. Generates an Excel file with registration data
   * 2. Uploads it to DigitalOcean Spaces (cloud storage)
   * 3. Returns a public URL to download the file
   * 
   * Response:
   * {
   *   "status": "success",
   *   "message": "Registration report Excel generated and stored successfully",
   *   "data": {
   *     "fileUrl": "https://bucket.sgp1.digitaloceanspaces.com/reports/registration/..."
   *   }
   * }
   */
  @httpPost('/download')
  public async downloadRegistrationReport(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const filters: RegistrationReportFilters = req.body;
      // Validate required fields
      if (!filters.reportType || !filters.period) {
        ControllerLogger.logValidationError(
          'Download Registration Report',
          'Missing required fields',
          req,
          res,
        );
        return next(
          new AppError(400, 'reportType and period are required fields'),
        );
      }

      // Validate reportType
      if (!['vendor', 'farmer', 'customer'].includes(filters.reportType)) {
        ControllerLogger.logValidationError(
          'Download Registration Report',
          'Invalid report type',
          req,
          res,
        );
        return next(
          new AppError(
            400,
            'reportType must be one of: vendor, farmer, customer',
          ),
        );
      }

      // Validate period-specific requirements
      if (
        filters.period === 'custom' &&
        (!filters.startDate || !filters.endDate)
      ) {
        ControllerLogger.logValidationError(
          'Download Registration Report',
          'Custom period requires start and end dates',
          req,
          res,
        );
        return next(
          new AppError(
            400,
            'startDate and endDate are required for custom period',
          ),
        );
      }

      // Generate Excel report
      const excelBuffer =
        await this.registrationReportService.generateExcelReport(filters);

      if (!excelBuffer) {
        ControllerLogger.logOperationFailed(
          'Download',
          'Registration Report Excel',
          'No data found for the given filters',
          req,
          res,
        );
        return res.status(404).json({
          status: 'error',
          message: 'No data found for the given filters',
        });
      }

      // Generate unique filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `Registration_Report_${filters.reportType}_${timestamp}.xlsx`;
      const s3Key = `reports/registration/${fileName}`;

      // Upload to DigitalOcean Spaces
      const uploadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: excelBuffer,
        ContentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ContentDisposition: `attachment; filename="${fileName}"`,
        ACL: 'public-read' as const, // Make file publicly accessible
      };

      await this.s3Client.send(new PutObjectCommand(uploadParams));

      // Generate file URL
      const fileUrl = `https://${this.bucketName}.sgp1.digitaloceanspaces.com/${s3Key}`;

      // Send notification for Excel export
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `${filters.reportType} registration report stored in cloud: ${fileName}`,
            userId,
          );
        }
      } catch (notifError) {
      }

      ControllerLogger.logSuccess(
        'Registration Excel report stored in DigitalOcean Spaces',
        fileName,
        req,
        res,
      );

      res.status(200).json({
        status: 'success',
        message: 'Registration report Excel generated and stored successfully',
        data: {
          fileUrl: fileUrl,
        },
      });
    } catch (err) {
      ControllerLogger.logError('Download Registration Report', err, req, res);
      next(err);
    }
  }
}
