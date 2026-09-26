import { inject } from "inversify";
import {
  controller,
  httpPost,
  httpGet,
  httpPatch,
  httpDelete,
  request,
  requestParam,
  response,
  next,
} from "inversify-express-utils";

import { Request, Response, NextFunction } from "express";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { SaleOrderService } from "../service/saleOrder.service";
import { NotificationService } from "../../notification/service/notification.service";
import logger from "../../utils/logger";
import { ControllerLogger } from "../../utils/controllerLogger";
import AppError from "../../utils/appError";


@controller('/saleOrders',deserializeUser,requireUser)
export class SaleOrderController {
  constructor(
    @inject(TYPES.SaleOrderService)
    private saleOrderService: SaleOrderService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService
  ) {}

  @httpPost("/")
  public async createSaleOrder(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Creating a new sale order");
      const saleOrderData = req.body;
      const saleOrder = await this.saleOrderService.createSaleOrder(saleOrderData);

      ControllerLogger.logSuccess('Sale Order created', saleOrder.id, req, res);

      // Send notification for sale order creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Sale Order created successfully`,
          userId
        );
      }

      res.status(201).json({
        status: "success",
        message: "Sale order created successfully",
        data: saleOrder,
      });
    } catch (err) {
      logger.error("Error occurred while creating sale order", { error: err });
      ControllerLogger.logError('Sale Order creation', err, req, res);
      next(err);
    }
  }

  @httpGet("/:id")
  public async getSaleOrderById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Fetching sale order by ID", { saleOrderId: id });
      const saleOrder = await this.saleOrderService.getSaleOrderById(id);

      if (!saleOrder) {
        logger.warn("Sale order not found", { saleOrderId: id });
        ControllerLogger.logError('Sale Order view', new AppError(404, "Sale order not found"), req, res);
        return next(new AppError(404, "Sale order not found"));
      }

      ControllerLogger.logView('Sale Order', id, req, res);

      // Send notification for sale order view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Sale Order viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: saleOrder,
      });
    } catch (err) {
      logger.error("Error occurred while fetching sale order", { error: err });
      ControllerLogger.logError('Sale Order view', err, req, res);
      next(err);
    }
  }

  @httpGet("/")
  public async getAllSaleOrders(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Fetching all sale orders");
      const saleOrders = await this.saleOrderService.getAllSaleOrders();

      ControllerLogger.logList('Sale Order', req, res);

      // Send notification for sale order list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Sale Order records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: saleOrders,
      });
    } catch (err) {
      logger.error("Error occurred while fetching all sale orders", { error: err });
      ControllerLogger.logError('Sale Order list retrieval', err, req, res);
      next(err);
    }
  }

  @httpPatch("/:id")
  public async updateSaleOrder(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Updating sale order", { saleOrderId: id });
      const updatedBy = res.locals.user?.id; // Assuming user info is available in res.locals
      const saleOrderData = req.body;

      const updatedSaleOrder = await this.saleOrderService.updateSaleOrder(id, saleOrderData, updatedBy);

      if (!updatedSaleOrder) {
        logger.warn("Sale order not found or could not be updated", { saleOrderId: id });
        ControllerLogger.logError('Sale Order update', new AppError(404, "Sale order not found or could not be updated"), req, res);
        return next(new AppError(404, "Sale order not found or could not be updated"));
      }

      ControllerLogger.logSuccess('Sale Order updated', id, req, res);

      // Send notification for sale order update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Sale Order updated successfully`,
          userId
        );
      }

      res.status(200).json({
        status: "success",
        message: "Sale order updated successfully",
        data: updatedSaleOrder,
      });
    } catch (err) {
      logger.error("Error occurred while updating sale order", { error: err });
      ControllerLogger.logError('Sale Order update', err, req, res);
      next(err);
    }
  }

  @httpDelete("/:id")
  public async deleteSaleOrder(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Deleting sale order", { saleOrderId: id });
      await this.saleOrderService.deleteSaleOrder(id);

      ControllerLogger.logSuccess('Sale Order deleted', id, req, res);

      // Send notification for sale order deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Sale Order deleted successfully`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        message: "Sale order deleted successfully",
      });
    } catch (err) {
      logger.error("Error occurred while deleting sale order", { error: err });
      ControllerLogger.logError('Sale Order deletion', err, req, res);
      next(err);
    }
  }
}
