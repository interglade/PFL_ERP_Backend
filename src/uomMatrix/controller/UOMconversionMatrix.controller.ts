import { inject } from "inversify";
import {
  controller,
  httpDelete,
  httpGet,
  httpPost,
  httpPatch,
  requestBody,
  requestParam,
  response,
  next,
  request,
} from "inversify-express-utils";


import { Request, Response, NextFunction } from "express";




import {
  CreateUOMConversionMatrixDto,
  UpdateUOMConversionMatrixDto,
  UOMConversionMatrixListResponseDto,
  UOMConversionMatrixDetailDto,
  UOMConversionMatrixUpdateFormDto,
  BulkDeleteUOMConversionMatrixDto,
} from "../dto/uomConversionMatrix.dto";
import { TYPES } from "../../types";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { UOMConversionMatrixService } from "../service/UOMconversionMatrix.service";
import { NotificationService } from "../../notification/service/notification.service";
import { PaginationOptions } from "../../utils/pagination";
import { ControllerLogger } from "../../utils/controllerLogger";
import AppError from "../../utils/appError";
import logger from "../../utils/logger";

@controller("/uom-conversion-matrix",deserializeUser,requireUser)
export class UOMConversionMatrixController {
  constructor(
    @inject(TYPES.UOMConversionMatrixService)
    private uomConversionMatrixService: UOMConversionMatrixService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService
  ) {}

 @httpGet("/")
  public async getAll(@response() res: Response, @next() next: NextFunction,@request() req : Request) {
    try {
      const { page, limit, search, sort } = req.query;
      
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
        limit: limit ? Number(limit) : undefined,
        searchFields: ['uomConversionMatrix.id'],
        filters: {},
        sort: sort as string || undefined, // Adjust this line to match your sorting requirements
        search: search as string|| '',
      };
      const conversions: UOMConversionMatrixListResponseDto = await this.uomConversionMatrixService.getAll(queryOptions);
      if (!conversions.data.length) {
        ControllerLogger.logError('UOM Conversion Matrix list retrieval', new AppError(404, "No UOM conversion data found"), req, res);
        return next(new AppError(404, "No UOM conversion data found"));
      }

      ControllerLogger.logList('UOM Conversion Matrix', req, res);

      // Send notification for UOM conversion matrix list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'UOM Conversion Matrix records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: conversions.data,
        allRecords:  conversions.meta.total,  
        totalPages:  conversions.meta.pages,
        page:  conversions.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('UOM Conversion Matrix list retrieval', err, req, res);
      next(err);
    }
  }


  @httpGet("/:id")
  public async getById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const conversion: UOMConversionMatrixDetailDto | null = await this.uomConversionMatrixService.getById(id);
      if (!conversion) {
        ControllerLogger.logError('UOM Conversion Matrix view', new AppError(404, "UOM conversion data not found"), req, res);
        return next(new AppError(404, "UOM conversion data not found"));
      }

      ControllerLogger.logView('UOM Conversion Matrix', id, req, res);

      // Send notification for UOM conversion matrix view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `UOM Conversion Matrix viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: conversion,
      });
    } catch (err) {
      ControllerLogger.logError('UOM Conversion Matrix view', err, req, res);
      next(err);
    }
  }





  @httpPost("/")
  public async create(
    @requestBody() conversionData: CreateUOMConversionMatrixDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const conversion = await this.uomConversionMatrixService.create(
        conversionData
      );
      ControllerLogger.logSuccess('UOM Conversion Matrix created', conversion.id, req, res);

      // Send notification for UOM conversion matrix creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `UOM Conversion Matrix created successfully`,
          userId
        );
      }

      res.status(201).json({
        status: "success",
        //data: conversion,
        message: "UOM conversion data created successfully",
      });
    } catch (err) {
      ControllerLogger.logError('UOM Conversion Matrix creation', err, req, res);
      next(err);
    }
  }

  @httpPatch("/:id")
  public async update(
    @requestParam("id") id: string,
    @requestBody() conversionData: UpdateUOMConversionMatrixDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const updateBy = res.locals.user?.id
      const conversion = await this.uomConversionMatrixService.update(
        id,
        conversionData,
        updateBy
      );
      if (!conversion) {
        ControllerLogger.logError('UOM Conversion Matrix update', new AppError(404, "UOM conversion data not found or update failed"), req, res);
        return next(
          new AppError(404, "UOM conversion data not found or update failed")
        );
      }

      ControllerLogger.logSuccess('UOM Conversion Matrix updated', id, req, res);

      // Send notification for UOM conversion matrix update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `UOM Conversion Matrix updated successfully`,
          userId
        );
      }

      res.status(200).json({
        status: "success",
        //data: conversion,
        message: "UOM conversion data updated successfully",
      });
    } catch (err) {
      ControllerLogger.logError('UOM Conversion Matrix update', err, req, res);
      next(err);
    }
  }

  @httpDelete("/:id")
  public async delete(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      if (!id) {
        logger.warn("UOM Conversion Matrix ID not provided");
        ControllerLogger.logError('UOM Conversion Matrix deletion', new AppError(400, "UOM Conversion Matrix  ID is required"), req, res);
        return next(new AppError(400, "UOM Conversion Matrix  ID is required"));
      }
      const success = await this.uomConversionMatrixService.delete(id);
      if (success) {
        ControllerLogger.logSuccess('UOM Conversion Matrix deleted', id, req, res);

        // Send notification for UOM conversion matrix deletion
        // const userId = res.locals.user?.id;
        // if (userId) {
        //   await this.notificationService.createNoti(
        //     `UOM Conversion Matrix deleted successfully: ${id}`,
        //     userId
        //   );
        // }

        res.status(200).json({
          status: "success",
          message: "UOM conversion data deleted successfully"
        });
      } else {
        ControllerLogger.logError('UOM Conversion Matrix deletion', new AppError(404, "UOM conversion data not found"), req, res);
        return next(new AppError(404, "UOM conversion data not found"));
      }
    } catch (err) {
      ControllerLogger.logError('UOM Conversion Matrix deletion', err, req, res);
      next(err);
    }
  }
   @httpDelete("/delete/multiple")
  public async softDeleteMultipleUOMConversion(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
  
      const { ids }: BulkDeleteUOMConversionMatrixDto = req.body;
      const uomConversionIds=ids;
  
      if (!Array.isArray(uomConversionIds) || uomConversionIds.length === 0) {
        ControllerLogger.logError(
          "UOMConversion bulk deletion",
          new AppError(400, "uomConversionIds must be a non-empty array"),
          req,
          res
        );
        return next(new AppError(400, "uomConversionIds must be a non-empty array"));
      }
  
      const result = await this.uomConversionMatrixService.softDeleteConversion(uomConversionIds);
  
      ControllerLogger.logSuccess(
        "UOMConversion bulk soft deleted",
        uomConversionIds.join(","),
        req,
        res
      );
  
      // Send notification
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Multiple UOMConversion soft deleted: ${uomConversionIds.length}`,
      //     userId
      //   );
      // }
  
      return res.status(200).json({
        status: "success",
        message: "UOMConversion soft deleted successfully",
        affected: result.affected,
      });
  
    } catch (err) {
      ControllerLogger.logError("UOMConversion bulk deletion", err, req, res);
      next(err);
    }
  }
}


  // @httpGet("/getAllForUpate/:id")
  // public async getByIdForUpdate(
  //   @requestParam("id") id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const conversion: UOMConversionMatrixUpdateFormDto | null = await this.uomConversionMatrixService.getByIdForUpdate(id);
  //     if (!conversion) {
  //       ControllerLogger.logError('UOM Conversion Matrix retrieval for update', new AppError(404, "UOM conversion data not found"), req, res);
  //       return next(new AppError(404, "UOM conversion data not found"));
  //     }

  //     ControllerLogger.logView('UOM Conversion Matrix (for update)', id, req, res);
  //     res.status(200).json({
  //       status: "success",
  //       data: conversion,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('UOM Conversion Matrix retrieval for update', err, req, res);
  //     next(err);
  //   }
  // }

