import { 
    controller, 
    httpPost, 
    httpGet, 
    httpPatch, 
    httpDelete, 
    request, 
    requestParam, 
    response, 
    next 
  } from "inversify-express-utils";
  import { inject } from "inversify";

  import { NextFunction, Request, Response } from "express";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { LaborRegisterService } from "../service/labourRegister.service";
import { NotificationService } from "../../notification/service/notification.service";
import logger from "../../utils/logger";
import { ControllerLogger } from "../../utils/controllerLogger";
import { PaginationOptions } from "../../utils/pagination";
import AppError from "../../utils/appError";
 
  
  @controller("/tempLabour",deserializeUser,requireUser)
  export class LaborRegisterController {
    constructor(
      @inject(TYPES.LaborRegisterService)
      private readonly laborRegisterService: LaborRegisterService,
      @inject(TYPES.NotificationService)
      private readonly notificationService: NotificationService
    ) {}
  
    /**
     * Create a new laborer
     */
    @httpPost("/")
    public async createLabor(
      @request() req: Request<{}, {}, any>, 
      @response() res: Response, 
      @next() next: NextFunction
    ) {
      try {
        logger.info("Attempting to create a new laborer", { requestedBy: res.locals.user?.id });
        const laborData = req.body;
        const labor = await this.laborRegisterService.createLabor(laborData);
        logger.info("Laborer created successfully", { laborId: labor.id });
        ControllerLogger.logSuccess('Labour Register created', labor.id, req, res);

        // Send notification for labour register creation
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Labour Register record created successfully`,
            userId
          );
        }
  
        res.status(201).json({
          status: "success",
          message: "Laborer created successfully",
          data: labor.id,
        });
      } catch (error) {
        logger.error("Error occurred while creating laborer", { error });
        ControllerLogger.logError('Labour Register creation', error, req, res);
        next(error);
      }
    }
  
    /**
     * Get All laborers 
     */
    @httpGet("/")
    public async findAllLaborers(@request() req: Request, @response() res: Response, @next() next: NextFunction): Promise<void> {
      try {
        logger.info("Fetching laborer details");
        const { page, limit, search, sort,labourId} = req.query;
          
      
            const queryOptions: PaginationOptions = {
              page: page ? Number(page) : undefined,  
              limit: limit ? Number(limit) : undefined,
              searchFields: ['labour.id'],
              filters: {},
              sort: sort as string || undefined, // Adjust this line to match your sorting requirements
              search: search as string|| '',
            };
        const laborers = await this.laborRegisterService.getAllLaborers(queryOptions);
  
        if (!laborers.data || laborers.data.length === 0) {
         logger.warn("Laborers not found");
          return next(new AppError(404, "Laborers not found"));
        }

        ControllerLogger.logList('Labour Register', req, res);

        // Send notification for labour register list access
        // const userId = res.locals.user?.id;
        // if (userId) {
        //   await this.notificationService.createNoti(
        //     'Labour Register records list accessed successfully',
        //     userId
        //   );
        // }
  
        res.status(200).json({
          status: "success",
          data: laborers.data,
          allRecords: laborers.meta.total,
          totalPages: laborers.meta.pages,
          page: laborers.meta.page,
        });
      } catch (error) {
       logger.error("Error occurred while fetching laborer details", { error });
       ControllerLogger.logError('Labour Register list retrieval', error, req, res);
        next(new AppError(500, "An error occurred while fetching laborer details"));
      }
    }
    /**
     * Get laborer by ID
     */
    @httpGet("/:id")
    public async getLaborById(
      @requestParam("id") id: string,
      @response() res: Response,
      @next() next: NextFunction
    ) {
      try {
        logger.info("Fetching laborer details by ID", { laborId: id });
        const labor = await this.laborRegisterService.getLaborById(id);
  
        if (!labor) {
          logger.warn("Laborer not found", { laborId: id });
          return next(new AppError(404, "Laborer not found"));
        }

        // Send notification for labour register view
        // const userId = res.locals.user?.id;
        // if (userId) {
        //   await this.notificationService.createNoti(
        //     `Labour Register record viewed: ${id}`,
        //     userId
        //   );
        // }
  
        res.status(200).json({
          status: "success",
          data: labor,
        });
      } catch (error) {
        logger.error("Error occurred while fetching laborer details", { laborId: id, error });
        next(error);
      }
    }
  
    /**
     * Update a laborer
     */
    @httpPatch("/:id")
    public async updateLabor(
      @requestParam("id") id: string,
      @request() req: Request<{}, {}, any>,
      @response() res: Response,
      @next() next: NextFunction
    ) {
      try {
        logger.info("Updating laborer details", { laborId: id });
        const updatedBy = res.locals.user?.id;
  
        const labor = await this.laborRegisterService.updateLabor(id, req.body,updatedBy);
  
        if (!labor) {
          logger.warn("Laborer not found or could not be updated", { laborId: id });
          return next(new AppError(404, "Laborer not found or could not be updated"));
        }

        // Send notification for labour register update
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Labour Register record updated successfully`,
            userId
          );
        }
  
        logger.info("Laborer updated successfully", { labor });
        res.status(200).json({
          status: "success",
          message: "Laborer updated successfully",
          data: labor,
        });
      } catch (error) {
        logger.error("Error occurred while updating laborer", { laborId: id, error });
        next(error);
      }
    }
  
    /**
     * Delete a laborer
     */
    @httpDelete("/:id")
    public async deleteLabor(
      @requestParam("id") id: string,
      @response() res: Response,
      @next() next: NextFunction
    ) {
      try {
        const result = await this.laborRegisterService.deleteLabor(id);
  
        if (!result) {
          return next(new AppError(404, "Labor not found or could not be deleted"));
        }

        // Send notification for labour register deletion
        // const userId = res.locals.user?.id;
        // if (userId) {
        //   await this.notificationService.createNoti(
        //     `Labour Register record deleted successfully`,
        //     userId
        //   );
        // }

  //res.status(204).send();
  res.status(200).json({
    status: "success",
    message: "Labor register deleted successfully",
    //data: updatedLabor,
  });
        //res.status(204).send();
      } catch (error) {
        logger.error("Error occurred while deleting laborer", { laborId: id, error });
        next(error);
      }
    }
  

    @httpDelete('/delete/multiple')
  public async deleteMultipleLabourRegister(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return next(new AppError(400, 'An array of Labour Register IDs is required'));
      }
      const result = await this.laborRegisterService.deleteMultipleLabourRegister(ids);
      res.status(200).json({
        message: result.message,
        success: result.success,
        failed: result.failed,
      });
    }
      catch (error) {
      logger.error('Error deleting multiple Labour Register', { error });
      next(error);
    }
  }

  }
  

      // /**
    //  * Check if a laborer exists by name, contact, and location
    //  */
    // @httpGet("/find")
    // public async findLabor(
    //   @request() req: Request,
    //   @response() res: Response,
    //   @next() next: NextFunction
    // ) {
    //   const { laborName, contactNo, location } = req.query;
    //   try {
    //     logger.info("Checking laborer existence", { laborName, contactNo, location });
  
    //     const labor = await this.laborRegisterService.findLaborByNameAndContact(
    //       String(laborName), 
    //       String(contactNo), 
         
    //     );
  
    //     if (labor) {
    //       return res.status(200).json({
    //         status: "success",
    //         data: labor,
    //       });
    //     } else {
    //       return res.status(404).json({
    //         status: "error",
    //         message: "Laborer not found.",
    //       });
    //     }
    //   } catch (error) {
    //     logger.error("Error occurred while checking laborer existence", { error });
    //     next(error);
    //   }
    // }

