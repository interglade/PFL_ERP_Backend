import { controller, httpDelete, httpGet, httpPatch, httpPost, next, request, requestParam, response } from "inversify-express-utils";

import { inject } from "inversify";

import { NextFunction ,Request,Response} from "express";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { LevelsService } from "../service/levels.service";
import { NotificationService } from "../../notification/service/notification.service";
import { TYPES } from "../../types";
import logger from "../../utils/logger";
import { ControllerLogger } from "../../utils/controllerLogger";
import AppError from "../../utils/appError";


@controller('/levels',deserializeUser,requireUser)
export class  LevelsController {
    constructor(
        @inject(TYPES.LevelsService) 
        private levelsService: LevelsService,
        @inject(TYPES.NotificationService)
        private notificationService: NotificationService
      ) {}
    
      @httpPost("/")
      public async createLevel(
        @request() req: Request<{}, {}, any>, 
        @response() res: Response, 
        @next() next: NextFunction
      ) {
        try {
          logger.info("Attempting to create a new level", { requestedBy: res.locals.user.id });
          const levelData = req.body;
          const level = await this.levelsService.createLevel(levelData);
          // if (!level) {
          //   logger.error("Failed to create level", { levelData });
          //   return next(new AppError(400, "Level could not be created"));
          // }
    
          logger.info("Level created successfully", { levelId: level.id });
          ControllerLogger.logSuccess('Level created', level.id, req, res);

          // Send notification for level creation
          const userId = res.locals.user?.id;
          if (userId) {
            await this.notificationService.createNoti(
              `Level created successfully`,
              userId
            );
          }

          res.status(201).json({
            status: "success",
            message: "Level created successfully",
            data: level,
          });
        } catch (err) {
          logger.error("Error occurred while creating level", { error: err });
          ControllerLogger.logError('Level creation', err, req, res);
          next(err);
        }
      }
    
      @httpPatch("/:id")
      public async updateLevel(
        @requestParam("id") id: string,
        @request() req: Request<{}, {}, any>, 
        @response() res: Response, 
        @next() next: NextFunction
      ) {
        try {
          const updatedBy = res.locals.user?.id
          logger.info("Attempting to update level", { levelId: id });
          const level = await this.levelsService.updateLevel(id, req.body,updatedBy);
    
          if (!level) {
            logger.warn("Level not found or could not be updated", { levelId: id });
            return next(new AppError(404, "Level not found or could not be updated"));
          }
    
          logger.info("Level updated successfully", { levelId: id });
          ControllerLogger.logSuccess('Level updated', id, req, res);

          // Send notification for level update
          const userId = res.locals.user?.id;
          if (userId) {
            await this.notificationService.createNoti(
              `Level updated successfully`,
              userId
            );
          }

          res.status(200).json({
            status: "success",
            message: "Level updated successfully",
            data: level,
          });
        } catch (err) {
          logger.error("Error occurred while updating level", { levelId: id, error: err });
          ControllerLogger.logError('Level update', err, req, res);
          next(err);
        }
      }
    
      @httpDelete("/:id")
      public async deleteLevel(
        @requestParam("id") id: string,
        @request() req: Request,
        @response() res: Response, 
        @next() next: NextFunction
      ) {
        try {
         const levels= await this.levelsService.deleteLevel(id);
           if (!levels) {
                   return next(new AppError(404, "Level not found or could not be deleted"));
                 }

                 ControllerLogger.logSuccess('Level deleted', id, req, res);

                 // Send notification for level deletion
                //  const userId = res.locals.user?.id;
                //  if (userId) {
                //    await this.notificationService.createNoti(
                //      `Level deleted successfully`,
                //      userId
                //    );
                //  }

                 res.status(200).json({ 
                  status: "success", 
                  message: "Level deleted successfully" });
          //res.status(204).send();
        } catch (err) {
          logger.error("Error occurred while deleting level", { levelId: id, error: err });
          ControllerLogger.logError('Level deletion', err, req, res);
          next(err);
        }
      }
    
      @httpGet("/:id")
      public async getLevelById(
        @requestParam("id") id: string,
        @request() req: Request, 
        @response() res: Response, 
        @next() next: NextFunction
      ) {
        try {
          logger.info("Fetching level details by ID", { levelId: id });
          const level = await this.levelsService.getLevelById(id);
    
          if (!level) {
            logger.warn("Level not found", { levelId: id });
            return next(new AppError(404, "Level not found"));
          }

          ControllerLogger.logView('Level', id, req, res);

          // Send notification for level view
          // const userId = res.locals.user?.id;
          // if (userId) {
          //   await this.notificationService.createNoti(
          //     `Level viewed: ${id}`,
          //     userId
          //   );
          // }
    
          res.status(200).json({
            status: "success",
            data: level,
          });
        } catch (err) {
          logger.error("Error occurred while fetching level", { levelId: id, error: err });
          ControllerLogger.logError('Level view', err, req, res);
          next(err);
        }
      }
    
      @httpGet("/")
      public async getAllLevels(
        @request() req: Request,
        @response() res: Response, 
        @next() next: NextFunction
      ) {
        try {
          logger.info("Fetching all levels");
          const levels = await this.levelsService.getAllLevels();
    
          if (!levels || levels.length === 0) {
            logger.error("No levels found");
            return next(new AppError(404, "No levels found"));
          }

          ControllerLogger.logList('Level', req, res);

          // Send notification for levels list access
          // const userId = res.locals.user?.id;
          // if (userId) {
          //   await this.notificationService.createNoti(
          //     'Levels list accessed successfully',
          //     userId
          //   );
          // }
    
          res.status(200).json({
            status: "success",
            data: levels,
          });
        } catch (err) {
          logger.error("Error occurred while fetching all levels", { error: err });
          ControllerLogger.logError('Level list retrieval', err, req, res);
          next(err);
        }
      }

}