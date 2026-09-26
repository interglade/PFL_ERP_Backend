import {
  controller,
  httpPost,
  request,
  response,
  next,
  httpGet,
} from 'inversify-express-utils';

import { inject } from 'inversify';

import { Request, Response, NextFunction } from 'express';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { TYPES } from '../../types';
import { DeliveryChallanReportService } from '../service/deliveryChallanReport.service';
import { NotificationService } from '../../notification/service/notification.service';
import { s3 } from '../../middleware/spaces.config';
import { ControllerLogger } from '../../utils/controllerLogger';


@controller('/delivery-challan-report', deserializeUser, requireUser)
export class DeliveryChallanReportController {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(
    @inject(TYPES.DeliveryChallanReportService)
    private readonly deliveryChallanReportService: DeliveryChallanReportService,
    @inject(TYPES.NotificationService)
    private readonly notificationService: NotificationService
  ) {
    this.s3Client = s3;
    this.bucketName = process.env.DO_SPACES_BUCKET || 'your-bucket-name';
  }

@httpGet('/download')
  async exportReport(@request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,) {

      try{
        const buffer = await this.deliveryChallanReportService.generateDeliveryChallanReport(req.body);

      if (!buffer) {
        ControllerLogger.logOperationFailed('Export', 'Customer Deliver Challan Report', 'No data found for the given filters', req, res);
        return res.status(404).json({
          status: 'error',
          message: 'No data found for the given filters',
        });
      }

      // Upload to cloud and get URL
      const fileUrl = await this.uploadToCloud(buffer);

      // Send notification
      await this.sendNotification(undefined, fileUrl, res);

      ControllerLogger.logSuccess('Customer Delivery Challan report stored in DigitalOcean Spaces', fileUrl, req, res);

      res.status(200).json({
        status: 'success',
        message: 'Customer Delivery Challan report generated and stored successfully',
        data: { fileUrl },
      });
      }catch(err){
        ControllerLogger.logError('Export Excel to Spaces', err, req, res);
      next(err);
      }

    

  }
  private async uploadToCloud(excelBuffer: Buffer): Promise<string> {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `Customer_Delivery_Challan_Report_${timestamp}.xlsx`;
      const s3Key = `reports/customer_challan/${fileName}`;
  
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
            `Customer Delivery Challan report stored in cloud: ${fileName}`,
            userId
          );
        }
      } catch (error) {
      }
    }
}