import { inject } from "inversify";
import {
  controller,
  httpPost,
  httpGet,
  httpPatch,
  request,
  requestParam,
  response,
  next,
} from "inversify-express-utils";
import { Request, Response, NextFunction } from "express";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import AppError from "../../utils/appError";
import { StockCorrectionService } from "../service/stockCorrection.service";
import { TYPES } from "../../types";


@controller("/stock-correction", deserializeUser, requireUser)
export class StockCorrectionController {
  constructor(
    @inject(TYPES.StockCorrectionService)
    private readonly stockCorrectionService: StockCorrectionService,
  ) {}

  // POST /stock-correction — submit new correction (inward or dump)
  @httpPost("/")
  public async submit(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const userId = res.locals.user.id;
      const result = await this.stockCorrectionService.submitCorrection(req.body, userId);
      res.status(201).json({ status: "success", data: result });
    } catch (error) {
      if (error instanceof Error) return next(new AppError(400, error.message));
      next(error);
    }
  }

  // GET /stock-correction/pending — all pending corrections
  @httpGet("/pending")
  public async getPending(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const data = await this.stockCorrectionService.getPendingCorrections();
      res.status(200).json({ status: "success", data });
    } catch (error) {
      next(error);
    }
  }

  // GET /stock-correction/:id — single correction
  @httpGet("/:id")
  public async getById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const data = await this.stockCorrectionService.getById(id);
      res.status(200).json({ status: "success", data });
    } catch (error) {
      if (error instanceof Error) return next(new AppError(404, error.message));
      next(error);
    }
  }

  // GET /stock-correction/stock/:inventoryStockId — history for a stock record
  @httpGet("/stock/:inventoryStockId")
  public async getByStock(
    @requestParam("inventoryStockId") inventoryStockId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const data = await this.stockCorrectionService.getByInventoryStock(inventoryStockId);
      res.status(200).json({ status: "success", data });
    } catch (error) {
      if (error instanceof Error) return next(new AppError(404, error.message));
      next(error);
    }
  }

  // PATCH /stock-correction/:id/approve
  @httpPatch("/:id/approve")
  public async approve(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const approverId = res.locals.user.id;
      const result = await this.stockCorrectionService.approveCorrection(id, approverId, req.body);
      res.status(200).json({ status: "success", message: "Correction approved", data: result });
    } catch (error) {
      if (error instanceof Error) return next(new AppError(400, error.message));
      next(error);
    }
  }

  // PATCH /stock-correction/:id/reject
  @httpPatch("/:id/reject")
  public async reject(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const approverId = res.locals.user.id;
      const result = await this.stockCorrectionService.rejectCorrection(id, approverId, req.body);
      res.status(200).json({ status: "success", message: "Correction rejected", data: result });
    } catch (error) {
      if (error instanceof Error) return next(new AppError(400, error.message));
      next(error);
    }
  }
}
