import { controller, httpGet, httpPatch, request, response, requestParam } from "inversify-express-utils";

import { inject } from "inversify";

import { Request, Response } from "express";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { TYPES } from "../../types";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { NotificationService } from "../service/notification.service";
import { s3 } from "../../middleware/spaces.config";


@controller('/notification', deserializeUser, requireUser)
export class NotificationController {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(
    @inject(TYPES.NotificationService)
    private readonly notificationService: NotificationService,
  ) {
    this.s3Client = s3;
    this.bucketName = process.env.DO_SPACES_BUCKET || 'your-bucket-name';
  }



  @httpGet("/getallNotification")
  public async getAllNotification(@request() req: Request, @response() res: Response): Promise<void> {
    const data = await this.notificationService.getAllNoti();
    res.status(200).json({ data });
  }

  //Todo:Get Notifications BY User
  @httpGet("/getbyuserid")
  public async getNotiByUserId(@request() req: Request, @response() res: Response): Promise<void> {
    const userId = res.locals.user.id;
    const data = await this.notificationService.getNotiByUserId(userId);
    res.status(200).json({ data });
  }


  @httpPatch("/mark-all-read")
  public async markAllAsRead(@request() req: Request, @response() res: Response): Promise<void> {
    const userId = res.locals.user.id;
    await this.notificationService.markAllAsRead(userId);
    res.status(200).json({ message: 'All notifications marked as read' });
  }

  @httpGet("/export-excel")
  public async exportExcel(@request() req: Request, @response() res: Response): Promise<void> {
    try {
      const excelBuffer = await this.notificationService.exportToExcel();
      const fileUrl = await this.uploadToS3(excelBuffer);

      res.status(200).json({
        status: 'success',
        message: 'Notification report generated and stored successfully',
        data: { fileUrl },
      });
    } catch (err) {
      res.status(500).json({ status: 'error', message: 'Failed to export notifications' });
    }
  }

  private async uploadToS3(excelBuffer: Buffer): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `Notifications_${timestamp}.xlsx`;
    const s3Key = `reports/notifications/${fileName}`;

    await this.s3Client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      Body: excelBuffer,
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ContentDisposition: `attachment; filename="${fileName}"`,
      ACL: 'public-read',
    }));

    return `https://${this.bucketName}.sgp1.digitaloceanspaces.com/${s3Key}`;
  }
}


  // @httpPatch("/mark-read/:id")
  // public async markAsRead(@requestParam('id') id: string, @request() req: Request, @response() res: Response): Promise<void> {
  //   const userId = res.locals.user.id;
  //   await this.notificationService.markAsRead(id, userId);
  //   res.status(200).json({ message: 'Notification marked as read' });
  // }


   /* @httpPost("/testNotification")
  public async testNotification(@request() req: Request, @response() res: Response): Promise<void> {
// const userId=res.locals.id;
// console.log(userId)
    const {userId,message } = req.body;
    if (!userId || !message) {
        res.status(400).json({ success: false, message: "userId and message are required" });
        return;
      }
    // Emit notification event to the specific user's room
    this.io.to(userId).emit("newNotification", { message, userId });

    // Respond back to confirm
    res.status(200).json({ success: true, message: "Notification sent to frontend" });
  }*/

