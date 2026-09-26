import {
  controller,
  httpPost,
  request,
  response,
  next,
} from 'inversify-express-utils';

import { inject } from 'inversify';

import { Request, Response, NextFunction } from 'express';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';


import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { TYPES } from '../../types';
import { GrnReportService } from '../service/grnReport.service';
import { NotificationService } from '../../notification/service/notification.service';
import { s3 } from '../../middleware/spaces.config';
import { ControllerLogger } from '../../utils/controllerLogger';
import { IGrnReportDownloadRequest, IGrnReportFilters } from '../../interfaces/grn-report.interface';
import AppError from '../../utils/appError';

@controller('/grn-report', deserializeUser, requireUser)
export class GrnReportController {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(
    @inject(TYPES.GrnReportService)
    private readonly grnReportService: GrnReportService,
    @inject(TYPES.NotificationService)
    private readonly notificationService: NotificationService
  ) {
    this.s3Client = s3;
    this.bucketName = process.env.DO_SPACES_BUCKET || 'your-bucket-name';
  }

  @httpPost('/download')
  async downloadGrnReport(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const body: IGrnReportDownloadRequest = req.body;
      // Validate request
      this.validateRequest(body, req, res, next);

      // Transform request to filters
      const filters = this.transformToFilters(body);

      // Get logged-in user info
      const userId = res.locals.user?.id;
      const loggedInUser = userId ? res.locals.user : null;

      // Generate Excel report
      const excelBuffer = await this.grnReportService.generateGrnExcelReport(filters, loggedInUser);

      if (!excelBuffer) {
        ControllerLogger.logOperationFailed('Export', 'GRN Report', 'No data found for the given filters', req, res);
        return res.status(404).json({
          status: 'error',
          message: 'No data found for the given filters',
        });
      }

      // Upload to cloud and get URL
      const fileUrl = await this.uploadToCloud(excelBuffer);

      // Send notification
      await this.sendNotification(undefined, fileUrl, res);

      ControllerLogger.logSuccess('GRN report stored in DigitalOcean Spaces', fileUrl, req, res);

      res.status(200).json({
        status: 'success',
        message: 'GRN report generated and stored successfully',
        data: { fileUrl },
      });
    } catch (err) {
      ControllerLogger.logError('Export GRN Report', err, req, res);
      next(err);
    }
  }

  private validateRequest(
    body: IGrnReportDownloadRequest,
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const { startDate, endDate } = body;

    if (!startDate || !endDate) {
      ControllerLogger.logValidationError('Export GRN Report', 'Missing date range', req, res);
      throw new AppError(400, 'startDate and endDate are required');
    }
  }

  private transformToFilters(body: IGrnReportDownloadRequest): IGrnReportFilters {
    const {
      startDate,
      endDate,
      company,
      purchaseLocation,
      purchaseForSalesLocation,
      vendor,
      farmer,
      createdBy,
      product,
      grnType,
      locationType,
      purchaseType,
      source,
      paymentMode,
      paymentTerms,
      paymentDateFrom,
      paymentDateTo,
      dueDateFrom,
      dueDateTo,
      totalQuantity,
      totalQuantityOperator,
      totalAmount,
      totalAmountOperator,
      verifiedBy,
      approvedBy,
      status,
      billNo,
      grnNo,
      requestingDepartment,
      purchaseInstructionsBy,
      purchaseBy,
      vehicleNo,
      receivedThrough,
      deliveryReceivingPerson,
      securityPerson,
      rmn,
    } = body;

    // Handle typo: farmar -> farmer
    const farmerIds = farmer || (body as any).farmar;

    return {
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      company: this.toArray(company),
      purchaseLocation: this.toArray(purchaseLocation),
      purchaseForSalesLocation: this.toArray(purchaseForSalesLocation),
      vendor: this.toArray(vendor),
      farmer: this.toArray(farmerIds),
      createdBy: this.toArray(createdBy),
      product: this.toArray(product),
      grnType,
      locationType,
      purchaseType,
      source,
      paymentMode,
      paymentTerms,
      paymentDateFrom: paymentDateFrom ? new Date(paymentDateFrom) : undefined,
      paymentDateTo: paymentDateTo ? new Date(paymentDateTo) : undefined,
      dueDateFrom: dueDateFrom ? new Date(dueDateFrom) : undefined,
      dueDateTo: dueDateTo ? new Date(dueDateTo) : undefined,
      totalQuantity,
      totalQuantityOperator,
      totalAmount,
      totalAmountOperator,
      verifiedBy,
      approvedBy,
      status,
      billNo,
      grnNo,
      requestingDepartment,
      purchaseInstructionsBy,
      purchaseBy,
      vehicleNo,
      receivedThrough,
      deliveryReceivingPerson,
      securityPerson,
      rmn,
    };
  }

  private toArray(value: string | string[] | undefined): string[] | undefined {
    if (!value) return undefined;
    return Array.isArray(value) ? value : [value];
  }

  private async uploadToCloud(excelBuffer: Buffer): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `GRN_Report_${timestamp}.xlsx`;
    const s3Key = `reports/grn/${fileName}`;

    const uploadParams = {
      Bucket: this.bucketName,
      Key: s3Key,
      Body: excelBuffer,
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ContentDisposition: `attachment; filename="${fileName}"`,
      ACL: 'public-read' as const,
    };

    await this.s3Client.send(new PutObjectCommand(uploadParams));

    return `https://${this.bucketName}.sgp1.digitaloceanspaces.com/${s3Key}`;
  }

  private async sendNotification(employeeId: string | undefined, fileName: string, res: Response): Promise<void> {
    try {
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `GRN report stored in cloud: ${fileName}`,
          userId
        );
      }
    } catch (error) {
    }
  }
}
