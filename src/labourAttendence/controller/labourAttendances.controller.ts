import { inject } from "inversify";
import {
  controller,
  httpGet,
  httpPost,
  httpPatch,
  httpDelete,
  request,
  response,
  requestParam,
  next,
} from "inversify-express-utils";
import { Request, Response, NextFunction } from "express";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { LaborAttendancesService } from "../service/labourAttendence.service";
import { TYPES } from "../../types";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { NotificationService } from "../../notification/service/notification.service";
import { PaginationOptions } from "../../utils/pagination";
import { ControllerLogger } from "../../utils/controllerLogger";
import AppError from "../../utils/appError";
import logger from "../../utils/logger";


@controller("/laborAttendances" ,deserializeUser,requireUser)
export class LaborAttendancesController {
  constructor(
    @inject(TYPES.LaborAttendancesService)
    private laborAttendancesService: LaborAttendancesService,
    @inject(TYPES.AuditLogService)
    private auditLogService: AuditLogService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService
  ) {}

  @httpGet("/")
  public async getAllAttendances(
    @request() req:Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { page, limit, search, sort,labourAttendenceId} = req.query;
                
            
                  const queryOptions: PaginationOptions = {
                    page: page ? Number(page) : undefined,  
                    limit: limit ? Number(limit) : undefined,
                    searchFields: ['labourAttendence.id'],
                    filters: {},
                    sort: sort as string || undefined, // Adjust this line to match your sorting requirements
                    search: search as string|| '',
                  };
      const attendances = await this.laborAttendancesService.getAllAttendances(queryOptions);
      ControllerLogger.logList('Labour Attendance', req, res);

      // Send notification for labour attendance list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Labour Attendance records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: attendances.data,
        allRecords: attendances.meta.total,
        totalPages: attendances.meta.pages, 
        page: attendances.meta.page,
      });
    } catch (error) {
      ControllerLogger.logError('Labour Attendance list retrieval', error, req, res);
      next(error);
    };
  }

  @httpGet("/:id")
  public async getAttendanceById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const attendance = await this.laborAttendancesService.getAttendanceById(id);
      if (!attendance) {
        return next(new AppError(404, "Attendance not found"));
      }
      ControllerLogger.logView('Labour Attendance', id, req, res);

      // Send notification for labour attendance view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Labour Attendance record viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: attendance,
      });
    } catch (error) {
      ControllerLogger.logError('Labour Attendance view', error, req, res);
      next(error);
    }
  }

  @httpPost("/")
  public async createAttendance(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
       req.body.checkedBy = res.locals.user?.id;
      const attendanceData = req.body;
     // Check each labor detail for empty outTime and set it to null if needed
     if (attendanceData.labourDetails && Array.isArray(attendanceData.labourDetails)) {
      attendanceData.labourDetails.forEach((labor: { outTime: string | null }) => {
        if (labor.outTime === '') {
          labor.outTime = null;
        }
      });
    }
      const attendance = await this.laborAttendancesService.createAttendance(attendanceData);
      logger.info("Labor record created successfully", { attendanceDataId: attendanceData.id });
      ControllerLogger.logSuccess('Labour Attendance created', attendance.id, req, res);

      // Send notification for labour attendance creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Labour Attendance record created successfully`,
          userId
        );
      }

      res.status(201).json({
        status: "success",
        message: "Attendance created successfully",
        data: attendance,
      });
    } catch (error) {
      ControllerLogger.logError('Labour Attendance creation', error, req, res);
      next(error);
    }
  }

  @httpPatch("/:id")
  public async updateAttendance(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const updatedBy = res.locals.user?.id; // Assuming the logged-in user ID is stored in res.locals
      const updatedAttendance = await this.laborAttendancesService.updateAttendance(
        id,
        req.body,
        updatedBy
      );
      if (!updatedAttendance) {
        return next(new AppError(404, "Attendance not found or could not be updated"));
      }
      ControllerLogger.logSuccess('Labour Attendance updated', id, req, res);

      // Send notification for labour attendance update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Labour Attendance record updated successfully`,
          userId
        );
      }

      res.status(200).json({
        status: "success",
        message: "Attendance updated successfully",
        data: updatedAttendance,
      });
    } catch (error) {
      ControllerLogger.logError('Labour Attendance update', error, req, res);
      next(error);
    }
  }

  @httpDelete("/:id")
  public async deleteAttendance(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Deleting labor Attendence record", { laborId: id });
      const result = await this.laborAttendancesService.deleteAttendance(id);
        if (!result) {
              return next(
                new AppError(404, "Labor record not found or could not be deleted")
              );
            }
      //res.status(204).send();
      ControllerLogger.logSuccess('Labour Attendance deleted', id, req, res);

      // Send notification for labour attendance deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Labour Attendance record deleted successfully`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        message: "Labor record deleted successfully",
        //data: updatedLabor,
      });
    } catch (error) {
      ControllerLogger.logError('Labour Attendance deletion', error, req, res);
      next(error);
    }
  }
}
