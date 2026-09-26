import { controller, httpGet, next, request, response } from "inversify-express-utils";

import { inject } from "inversify";

import { NextFunction ,Response,Request} from "express";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { NotificationService } from "../../notification/service/notification.service";
import { FinalInvoiceReportService } from "../service/finalInvoiceReport.service";
import { ControllerLogger } from "../../utils/controllerLogger";


@controller('/final-invoice-report', deserializeUser, requireUser)
export class FinalInvoiceReportController {
    private s3Client: S3Client;
  private bucketName: string;

  constructor(
   
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
     @inject(TYPES.FinalInvoiceReportService)
    private  finalInvoiceReportService:  FinalInvoiceReportService,
 
  ) {}

  @httpGet('/download')
async exportReport(@request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,) {

      try{
        const buffer = await this.finalInvoiceReportService.generateInvoiceReport(req.body);

        if (!buffer) {
        ControllerLogger.logOperationFailed('Export', 'Final Invoice Report', 'No data found for the given filters', req, res);
        return res.status(404).json({
          status: 'error',
          message: 'No data found for the given filters',
        });
      }

      // Upload to cloud and get URL
      const fileUrl = await this.uploadToCloud(buffer);

      // Send notification
      //await this.sendNotification(undefined, fileUrl, res);

      ControllerLogger.logSuccess('GRN report stored in DigitalOcean Spaces', fileUrl, req, res);

      res.status(200).json({
        status: 'success',
        message: 'Final Invoice report generated and stored successfully',
        data: { fileUrl },
      });

      }catch(err){
        ControllerLogger.logError('Export Excel to Spaces', err, req, res);
      next(err);
      }
  }

  private async uploadToCloud(excelBuffer: Buffer): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `Final_Invoice_Report_${timestamp}.xlsx`;
    const s3Key = `reports/invoice/${fileName}`;

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
          `Final Invoiced report stored in cloud: ${fileName}`,
          userId
        );
      }
    } catch (error) {
    }
  }
}