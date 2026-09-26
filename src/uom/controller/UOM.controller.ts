import { inject } from "inversify";
import {
  controller,
  httpDelete,
  httpGet,
  httpPost,
  requestBody,
  requestParam,
  request,
  response,
  next,
  httpPatch,
} from "inversify-express-utils";
import { Request, Response, NextFunction } from "express";
import { captureUser, deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { UOMService } from "../service/UOM.service";
import { NotificationService } from "../../notification/service/notification.service";
import { PaginationOptions } from "../../utils/pagination";
import { BulkDeleteUOMDto, CreateUOMDto, UOMDetailDto, UOMListResponseDto, UOMPartialDto, UpdateUOMDto } from "../dto/uom.dto";
import AppError from "../../utils/appError";
import { ControllerLogger } from "../../utils/controllerLogger";
import logger from "../../utils/logger";





@controller("/uoms" , deserializeUser, requireUser)
export class UOMController {
  constructor(
    @inject(TYPES.UOMService)
    private uomService: UOMService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService
  ) {}

  @httpGet("/")
  public async getAll(@response() res: Response, 
  @request() req:Request,
  @next() next: NextFunction) {
    try {
      const { page, limit, search, sort} = req.query;
          
      
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
        limit: limit ? Number(limit) : undefined,
        //searchFields: ['uom.id'],
        filters: {},
        sort: sort as string || undefined, // Adjust this line to match your sorting requirements
        search: search as string|| '',
      };
      const uoms: UOMListResponseDto = await this.uomService.getAll(queryOptions);
      if (!uoms.data.length) {
        ControllerLogger.logError('UOM list retrieval', new AppError(404, "No UOMs found"), req, res);
        return next(new AppError(404, "No UOMs found"));
      }

      ControllerLogger.logList('UOM', req, res);

      // Send notification for UOM list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'UOM records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: uoms.data,
        allRecords:  uoms.meta.total,
        totalPages:  uoms.meta.pages,
        page:  uoms.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('UOM list retrieval', err, req, res);
      next(err);
    }
  }


  @httpGet("/getAll/partialdata")
  public async getAllPartialData(@response() res: Response, 
  @request() req: Request,
  @next() next: NextFunction) {
    try {
      const uoms: UOMPartialDto[] = await this.uomService.getAllPartial();
      if (!uoms.length) {
        ControllerLogger.logError('UOM partial list retrieval', new AppError(404, "No UOMs found"), req, res);
        return next(new AppError(404, "No UOMs found"));
      }

      ControllerLogger.logList('UOM (partial)', req, res);
      res.status(200).json({
        status: "success",
        data: uoms,
      });
    } catch (err) {
      ControllerLogger.logError('UOM partial list retrieval', err, req, res);
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
      const uom: UOMDetailDto | null = await this.uomService.getById(id);
      if (!uom) {
        ControllerLogger.logError('UOM view', new AppError(404, "UOM not found"), req, res);
        return next(new AppError(404, "UOM not found"));
      }

      ControllerLogger.logView('UOM', id, req, res);

      // Send notification for UOM view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `UOM viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: uom,
      });
    } catch (err) {
      ControllerLogger.logError('UOM view', err, req, res);
      next(err);
    }
  }

  @httpPost("/")
  public async create(
    @requestBody() uomData: CreateUOMDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const uom = await this.uomService.create(uomData);
      ControllerLogger.logSuccess('UOM created', uom.id, req, res);

      // Send notification for UOM creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `UOM created successfully`,
          userId
        );
      }

      res.status(201).json({
        status: "success",
        message: "UOM created successfully",
        //data: uom,
      });
    } catch (err) {
      ControllerLogger.logError('UOM creation', err, req, res);
      next(err);
    }
  }

  @httpPatch("/:id",captureUser)
  public async update(
    @requestParam("id") id: string,
    @requestBody() uomData: UpdateUOMDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const updatedBy=res.locals.updatedBy
      const uom = await this.uomService.update(id, uomData,updatedBy);
      if (!uom) {
        ControllerLogger.logError('UOM update', new AppError(404, "UOM not found or update failed"), req, res);
        return next(new AppError(404, "UOM not found or update failed"));
      }

      ControllerLogger.logSuccess('UOM updated', id, req, res);

      // Send notification for UOM update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `UOM updated successfully`,
          userId
        );
      }

      res.status(200).json({
        status: "success",
        message: "UOM updated successfully",
        //data: uom,
      });
    } catch (err) {
      ControllerLogger.logError('UOM update', err, req, res);
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
        logger.warn("UOM ID not provided");
        ControllerLogger.logError('UOM deletion', new AppError(400, "UOM ID is required"), req, res);
        return next(new AppError(400, "UOM ID is required"));
      }
      const success = await this.uomService.delete(id);
      if (success) {
        ControllerLogger.logSuccess('UOM deleted', id, req, res);

        // Send notification for UOM deletion
        // const userId = res.locals.user?.id;
        // if (userId) {
        //   await this.notificationService.createNoti(
        //     `UOM deleted successfully`,
        //     userId
        //   );
        // }

        res.status(204).json({
          status: "success",
          message: "UOM deleted successfully"
        });
      } else {
        ControllerLogger.logError('UOM deletion', new AppError(404, "UOM not found"), req, res);
        return next(new AppError(404, "UOM not found"));
      }
    } catch (err) {
      ControllerLogger.logError('UOM deletion', err, req, res);
      next(err);
    }
  }

  @httpDelete("/multiple-delete/delete")
  public async multipleDelete(
    @requestBody() body: BulkDeleteUOMDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { ids }: BulkDeleteUOMDto = body;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        ControllerLogger.logError('UOM multiple deletion', new AppError(400, "Please provide an array of IDs"), req, res);
        return next(new AppError(400, "Please provide an array of IDs"));
      }

      const deleted = await this.uomService.multipledelete(ids);

      if (deleted === false) {
        ControllerLogger.logError('UOM multiple deletion', new AppError(404, "No records found for deletion"), req, res);
        return next(new AppError(404, "No records found for deletion"));
      }

      ControllerLogger.logSuccess('UOM multiple deletion', `${ids.length} records`, req, res);

      // Send notification for multiple UOM deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Multiple UOMs deleted successfully: ${ids.length} records`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        message: "Records deleted successfully",
      });
    } catch (err) {
      ControllerLogger.logError('UOM multiple deletion', err, req, res);
      next(err);
    }
  }

}

