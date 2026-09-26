import { inject } from "inversify";
import {
  controller,
  httpDelete,
  httpGet,
  httpPatch,
  httpPost,
  next,
  request,
  requestParam,
  response,
} from "inversify-express-utils";
import { TYPES } from "../../types";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { NextFunction,Response,Request } from "express";
import AppError from "../../utils/appError";
import logger from "../../utils/logger";
import { PaginationOptions } from "../../utils/pagination";
import { LaborService } from "../service/labor.service";
import { NotificationService } from "../../notification/service/notification.service";


@controller("/labors",deserializeUser,requireUser)
export class LaborController {
  constructor(
    @inject(TYPES.LaborService) private readonly laborService: LaborService,
    @inject(TYPES.NotificationService) private readonly notificationService: NotificationService
  ) {}
  @httpPost("/")
  public async createLabor(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Attempting to create a new labor record");
      //console.log(req.body);
      const laborData = req.body;
      const labor = await this.laborService.createLabor(laborData);
      if (!labor) {
        return next(new AppError(400, "Labor record could not be created"));
      }

      logger.info("Labor record created successfully", { laborId: labor.id });
      
      // Send notification for labor creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Labor record created successfully`,
          userId
        );
      }
      
      res.status(201).json({
        status: "success",
        message: "Labor record created successfully",
        //data: labor,
      });
    } catch (error) {
      logger.error("Error occurred while creating labor record", { error });
      next(error);
    }
  }

  @httpGet("/:id")
  public async getLaborById(
    @requestParam("id") id: string,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Fetching labor record by ID", { laborId: id });
      const labor = await this.laborService.getLaborById(id);
      if (!labor) {
        return next(new AppError(404, "Labor record not found"));
      }

      // Send notification for labor view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Labor record viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: labor,
      });
    } catch (error) {
      logger.error("Error occurred while fetching labor record", { error });
      next(error);
    }
  }

  @httpGet("/")
  public async getAllLabors(
    @request() req:Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Fetching all labor records");
      const { page, limit, search, sort,labourId} = req.query;
          
      
            const queryOptions: PaginationOptions = {
              page: page ? Number(page) : undefined,  
              limit: limit ? Number(limit) : undefined,
              searchFields: ['labour.id'],
              filters: {},
              sort: sort as string || undefined, // Adjust this line to match your sorting requirements
              search: search as string|| '',
            };
      const labors = await this.laborService.getAllLabors(queryOptions);
      
      // Send notification for labor list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Labor records list accessed successfully',
      //     userId
      //   );
      // }
      
      res.status(200).json({
        status: "success",
        data: labors.data,

        allRecords: labors.meta.total,
        totalPages: labors.meta.pages,
        page: labors.meta.page,
      });
    } catch (error) {
      logger.error("Error occurred while fetching all labor records", {
        error,
      });
      next(error);
    }
  }

  @httpPatch("/:id")
  public async updateLabor(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const updatedBy=res.locals.user.id
      logger.info("Updating labor record", { laborId: id });
      const updatedLabor = await this.laborService.updateLabor(id, req.body,updatedBy);

      if (!updatedLabor) {
        return next(
          new AppError(404, "Labor record not found or could not be updated")
        );
      }

      // Send notification for labor update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Labor record updated successfully`,
          userId
        );
      }

      res.status(200).json({
        status: "success",
        message: "Labor record updated successfully",
        //data: updatedLabor,
      });
    } catch (error) {
      logger.error("Error occurred while updating labor record", { error });
      next(error);
    }
  }


  @httpDelete("/:id")
  public async deleteLabor(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      
      logger.info("Deleting labor record", { laborId: id });
      const deletedLabor = await this.laborService.deleteLabor(id);

      if (!deletedLabor) {
        return next(
          new AppError(404, "Labor record not found or could not be deleted")
        );
      }

      // Send notification for labor deletion
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Labor record deleted successfully`,
          userId
        );
      }

      res.status(200).json({
        status: "success",
        message: "Labor record deleted successfully",
        //data: updatedLabor,
      });
    } catch (error) {
      logger.error("Error occurred while updating labor record", { error });
      next(error);
    }
  }
}
