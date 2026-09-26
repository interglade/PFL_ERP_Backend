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
import { NewRegistrationFilters, NewRegistrationService } from '../service/newRegistration.service';
import { NotificationService } from '../../notification/service/notification.service';
import { ControllerLogger } from '../../utils/controllerLogger';
import { TYPES } from '../../types';
import { s3 } from '../../middleware/spaces.config';
import AppError from '../../utils/appError';


/**
 * NEW REGISTRATION REPORT CONTROLLER
 * 
 * Handles multi-sheet Excel registration reports
 * 
 * Endpoint: POST /new-registration-reports/download
 * 
 * Request Body:
 * {
 *   "registrationType": "all" | "farmer" | "vendor" | "customer",
 *   "period": "custom" | "current_month" | "previous_month" | "month_year" | "quarterly",
 *   "startDate": "2024-01-01",  // Required if period is "custom"
 *   "endDate": "2024-01-31",    // Required if period is "custom"
 *   "month": 1,                 // Required if period is "month_year"
 *   "year": 2024,               // Required if period is "month_year" or "quarterly"
 *   "quarter": 1,               // Required if period is "quarterly"
 *   "city": "Mumbai",           // Optional - single city string
 *   "state": "Maharashtra",     // Optional - single state string
 *   "pincode": "411052",        // Optional - single pincode string
 *   "employee": ["emp-id-1", "emp-id-2"]  // Optional - array of employee IDs
 * }
 */

@controller('/new-registration-reports', deserializeUser, requireUser)
export class NewRegistrationController {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(
    @inject(TYPES.NewRegistrationService)
    private newRegistrationService: NewRegistrationService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
  ) {
    this.s3Client = s3;
    this.bucketName = process.env.DO_SPACES_BUCKET || 'your-bucket-name';
  }

  @httpPost('/download')
  public async downloadRegistrationReport(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const filters: NewRegistrationFilters = req.body;

      // Log request body to understand frontend data structure

      // Normalize employee field (frontend sends 'employee', we use 'employees' internally)
      if (filters.employee && Array.isArray(filters.employee)) {
        (filters as any).employees = filters.employee;
      }

      // Validate required fields
      if (!filters.registrationType || !filters.period) {
        ControllerLogger.logValidationError(
          'Download New Registration Report',
          'Missing required fields',
          req,
          res,
        );
        return next(
          new AppError(400, 'registrationType and period are required fields'),
        );
      }

      // Validate registrationType
      if (!['farmer', 'vendor', 'customer', 'all'].includes(filters.registrationType)) {
        ControllerLogger.logValidationError(
          'Download New Registration Report',
          'Invalid registration type',
          req,
          res,
        );
        return next(
          new AppError(
            400,
            'registrationType must be one of: farmer, vendor, customer, all',
          ),
        );
      }

      // Validate period-specific requirements
      if (
        filters.period === 'custom' &&
        (!filters.startDate || !filters.endDate)
      ) {
        ControllerLogger.logValidationError(
          'Download New Registration Report',
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
          'Download New Registration Report',
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
          'Download New Registration Report',
          'Quarterly period requires quarter',
          req,
          res,
        );
        return next(
          new AppError(400, 'quarter is required for quarterly period'),
        );
      }

      // Get user name
      const userName = res.locals.user?.firstName 
        ? `${res.locals.user.firstName} ${res.locals.user.lastName || ''}`.trim()
        : 'Employee Name';

      // Generate Excel report
      const excelBuffer =
        await this.newRegistrationService.generateExcelReport(filters, userName);

      if (!excelBuffer) {
        ControllerLogger.logOperationFailed(
          'Download',
          'New Registration Report Excel',
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
      const fileName = `New_Registration_Report_${filters.registrationType}_${timestamp}.xlsx`;
      const s3Key = `reports/registration/${fileName}`;

      // Upload to DigitalOcean Spaces
      const uploadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: excelBuffer,
        ContentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ContentDisposition: `attachment; filename="${fileName}"`,
        ACL: 'public-read' as const,
      };

      await this.s3Client.send(new PutObjectCommand(uploadParams));

      // Generate file URL
      const fileUrl = `https://${this.bucketName}.sgp1.digitaloceanspaces.com/${s3Key}`;

      // Send notification
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `New registration report generated for ${filters.registrationType}: ${fileName}`,
            userId,
          );
        }
      } catch (notifError) {
      }

      ControllerLogger.logSuccess(
        'New Registration Excel report stored in DigitalOcean Spaces',
        fileName,
        req,
        res,
      );

      res.status(200).json({
        status: 'success',
        message: 'New registration report Excel generated and stored successfully',
        data: {
          fileUrl: fileUrl,
        },
      });
    } catch (err) {
      ControllerLogger.logError('Download New Registration Report', err, req, res);
      next(err);
    }
  }
}
