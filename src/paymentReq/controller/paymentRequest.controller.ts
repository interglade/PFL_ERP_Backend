import { controller, httpDelete, httpGet, httpPatch, httpPost, next, request, response } from "inversify-express-utils";

import { inject } from "inversify";

import { NextFunction,Response,Request } from "express";
import { captureUser, deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { PaymentRequestService } from "../service/paymentRequest.service";
import { NotificationService } from "../../notification/service/notification.service";
import logger from "../../utils/logger";
import { ControllerLogger } from "../../utils/controllerLogger";



@controller("/paymentRequest",deserializeUser, requireUser)
export class PaymentRequestController {
  constructor(
    @inject(TYPES.PaymentRequestService) private paymentRequestService: PaymentRequestService,
    @inject(TYPES.NotificationService) private notificationService: NotificationService
  ) {}

  @httpGet("/")
  public async getAllPaymentRequests(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    logger.info("Fetching all payment requests");
    try {
      const paymentRequests = await this.paymentRequestService.getAllPaymentRequests();
  
      if (!paymentRequests) {
        logger.warn("No payment requests found");
        return res.status(404).json({
          status: "fail",
          message: "No payment requests found",
        });
      }
  
      logger.info("Successfully fetched all payment requests", { count: paymentRequests.length });
      
      ControllerLogger.logList("Payment Request", req, res);

      // Send notification for payment request list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Payment Request records list accessed successfully',
      //     userId
      //   );
      // }
      
      res.status(200).json({
        status: "success",
        data: paymentRequests,
      });
    } catch (err) {
      logger.error("Error fetching all payment requests", { err });
      ControllerLogger.logError('Payment Request list retrieval', err, req, res);
      next(err);
    }
  }
  
// Get a payment request by ID
@httpGet("/:id")
public async getPaymentRequestById(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const { id } = req.params;
    logger.info("Fetching payment request by ID", { id });
    const paymentRequest = await this.paymentRequestService.getPaymentRequestById(id);

    if (!paymentRequest) {
      logger.warn("Payment request not found", { id });
      return res.status(404).json({ status: "fail", message: "Payment Request not found" });
    }
    logger.info("Successfully fetched payment request", { id });
    
    ControllerLogger.logView("Payment Request", id, req, res);

    // Send notification for payment request view
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     `Payment Request viewed: ${id}`,
    //     userId
    //   );
    // }
    
    res.status(200).json({
      status: "success",
      data: paymentRequest,
    });
  } catch (err) {
    logger.error("Error fetching payment request by ID", { error: err });
    ControllerLogger.logError('Payment Request view', err, req, res);
    next(err);
  }
}

// Create a new payment request
@httpPost("/:id")
public async createPaymentRequest(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const paymentRequestData = req.body;
    paymentRequestData.requestedBy = res.locals.user.id;
    const id = req.params.id
    logger.info("Creating a new payment request", { id });
    const newPaymentRequest = await this.paymentRequestService.createPaymentRequest(paymentRequestData,id);
    logger.info("Payment request created successfully");
    
    ControllerLogger.logSuccess('Payment Request created', newPaymentRequest.id, req, res);

    // Send notification for payment request creation
    const userId = res.locals.user?.id;
    if (userId) {
      await this.notificationService.createNoti(
        `Payment Request created successfully`,
        userId
      );
    }
    
    res.status(201).json({
      status: "success",
      message: 'Payment Request created successfully',
      data: newPaymentRequest,
    });
  } catch (err) {
    logger.error("Error creating payment request", {  error: err });
    ControllerLogger.logError('Payment Request creation', err, req, res);
    next(err);
  }
}

// Update a payment request
@httpPatch("/:id",captureUser)
public async updatePaymentRequest(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    logger.info("Updating payment request");
    const updatedBy=res.locals.updatedBy
    const { id } = req.params;
    const updatedData: Partial<PaymentRequest> = req.body;
    const updatedPaymentRequest = await this.paymentRequestService.updatePaymentRequest(id, updatedData,updatedBy);

    if (!updatedPaymentRequest) {
      logger.warn("Payment request not found or update failed", { id });
      return res.status(404).json({ status: "fail", message: "Payment Request not found" });
    }
    logger.info("Payment request updated successfully", { id });
    
    ControllerLogger.logSuccess('Payment Request updated', id, req, res);

    // Send notification for payment request update
    const userId = res.locals.user?.id;
    if (userId) {
      await this.notificationService.createNoti(
        `Payment Request updated successfully`,
        userId
      );
    }
    
    res.status(200).json({
      status: "success",
      data: updatedPaymentRequest,
    });
  } catch (err) {
    logger.error("Error updating payment request", { error: err });
    ControllerLogger.logError('Payment Request update', err, req, res);
    next(err);
  }
}

// Delete a payment request
@httpDelete("/:id")
public async deletePaymentRequest(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const { id } = req.params;
    logger.info("Deleting payment request", { id });
    await this.paymentRequestService.deletePaymentRequest(id);
    logger.info("Payment request deleted successfully", { id });
    
    ControllerLogger.logSuccess('Payment Request deleted', id, req, res);

    // Send notification for payment request deletion
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     `Payment Request deleted successfully`,
    //     userId
    //   );
    // }
    
    res.status(200).json({ 
      status: "success", 
      message: "Payment Request deleted successfully" });
  } catch (err) {
    logger.error("Error deleting payment request", {error: err });
    ControllerLogger.logError('Payment Request deletion', err, req, res);
    next(err);
  }
}

}
