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
import { TYPES } from "../../types";
import { Request, Response, NextFunction } from "express";
import AppError from "../../utils/appError";

import { deserializeUser, requireUser, captureUser } from "../../middleware/deserializeUser";
import { ControllerLogger } from "../../utils/controllerLogger";
import { PaginationOptions } from "../../utils/pagination";
import {
  CreateDumpRegisterDto,
  UpdateDumpRegisterDto,
} from "../dto/dumpRegister.dto";
import { UserActivityLogService } from "../../employeeActivity/service/userActivityLog.service";
import { DumpRegisterService } from "../service/dumpRegister.service";
import { NotificationService } from "../../notification/service/notification.service";
import { ActivityAction, ActivityModule } from "../../employeeActivity/entity/userActivityLog.entity";
import { DocumentExportService } from '../../excel/export/documentExport.service';
import { DUMP_REGISTER_EXPORT } from '../excel/dumpRegister.export';
import { applyDocumentListFilters } from '../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../approvalFlow/entity/docuemnt.entity';


@controller("/dumpRegister", deserializeUser, requireUser)
export class DumpRegisterController {
  constructor(
    @inject(TYPES.DumpRegisterService) private readonly dumpRegisterService: DumpRegisterService,
    @inject(TYPES.NotificationService) private readonly notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService) private readonly activityLogService: UserActivityLogService,
    @inject(TYPES.DocumentExportService)
    private readonly documentExportService: DocumentExportService,
  ) {}

  @httpPost("/")
  public async createDumpRegister(
    @request() req: Request<{}, {}, CreateDumpRegisterDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const dumpRegisterData = req.body;
      const requestedBy = res.locals.user.id;
      dumpRegisterData.requestedBy = requestedBy;
     
      const dumpRegister = await this.dumpRegisterService.createDumpRegister(dumpRegisterData);
      
      if (!dumpRegister) {
        ControllerLogger.logOperationFailed('Create', 'Dump Register', 'Creation failed', req, res);
        return next(new AppError(400, "Dump register could not be created"));
      }

      await this.notificationService.createNoti(
        `New dump register created`,
        res.locals.user.id
      );

      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.CREATE,
        module: ActivityModule.DUMP_REGISTER,
        entityName: 'DumpRegister',
        entityId: dumpRegister.id,
        description: `${userName} has created Dump Register ${dumpRegister.dumpNo||dumpRegister.id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 201,
      }).catch(() => {});

      ControllerLogger.logSuccess('Dump Register created', dumpRegister.id, req, res);
      res.status(201).json({
        status: "success",
        message: "Dump register created successfully",
        data: dumpRegister.id,
      });
    } catch (error) {
      ControllerLogger.logError('Create Dump Register', error, req, res);
       if (error instanceof Error) {
         return next(new AppError(400, error.message)); // ← sends 400 with real message
       }
      next(error);
    }
  }



  @httpGet("/recyclebin")
  public async getAllRecycleBinDumpRegisters(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { page, limit, search, sort } = req.query;
      const userId = res.locals.user.id;
      
      if(!userId) {
        ControllerLogger.logValidationError('Get Recycle Bin Dump Registers', 'Unauthorized access', req, res);
        return next(new AppError(401, "Unauthorized access"));
      }
      
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
        limit: limit ? Number(limit) : undefined,
        searchFields: ['dumpRegister.id'],
        filters: {},
        sort: sort as string || undefined,
        search: search as string|| '',
      };
      
      const dumpRegisters = await this.dumpRegisterService.getAllRecycleBinDumpRegisters(queryOptions, userId);
      
      if (!dumpRegisters) {
        ControllerLogger.logOperationFailed('Get All', 'Dump Registers (Recycle Bin)', 'No records found', req, res);
        return next(new AppError(404, "No dump registers found"));
      }

      ControllerLogger.logGetAllRecords('Dump Registers (Recycle Bin)', req, res);
      res.status(200).json({
        status: "success",
        data: dumpRegisters.data,
        allRecords: dumpRegisters.meta.total,
        totalPages: dumpRegisters.meta.pages,
        page: dumpRegisters.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Get Recycle Bin Dump Registers', err, req, res);
      next(err);
    }
  }

  @httpGet("/update/:id")
  public async getDumpRegisterByIdforupate(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const dumpRegister = await this.dumpRegisterService.getDumpRegisterByIdforUpdate(id);
      
      if (!dumpRegister) {
        ControllerLogger.logNotFound('Dump Register', id, req, res);
        return next(new AppError(404, "Dump register not found"));
      }

      ControllerLogger.logView('Dump Register (for update)', id, req, res);
      res.status(200).json({
        status: "success",
        data: dumpRegister,
      });
    } catch (err) {
      ControllerLogger.logError('Get Dump Register for update', err, req, res);
      next(err);
    }
  }

  @httpGet("/view/:id")
  public async getDumpRegisterByIdforView(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const dumpRegister = await this.dumpRegisterService.getDumpRegisterByIdforView(id);
      
      if (!dumpRegister) {
        ControllerLogger.logNotFound('Dump Register', id, req, res);
        return next(new AppError(404, "Dump register not found"));
      }

      ControllerLogger.logView('Dump Register', id, req, res);
      res.status(200).json({
        status: "success",
        data: dumpRegister,
      });
    } catch (err) {
      ControllerLogger.logError('Get Dump Register for view', err, req, res);
      next(err);
    }
  }

  /**
   * GET export/excel - every Dump Register the user can see in the list, as an .xlsx.
   * Accepts exactly the same filter parameters as the Get All list (startDate, endDate,
   * status, search, module filters, ...); page and limit are ignored.
   */
  @httpGet('/export/excel')
  public async exportToExcel(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    return this.documentExportService.export(req, res, next, {
      entityName: 'Dump Register',
      definition: DUMP_REGISTER_EXPORT,
      list: { documentType: FilterDocumentType.DUMP_REGISTER, searchFields: ['dumpRegister.id'] },
      fetchList: (queryOptions, userId) => this.dumpRegisterService.getAllDumpRegisters(queryOptions, userId),
    });
  }

  @httpGet("/")
  public async getAllDumpRegisters(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { page, limit, search, sort } = req.query;
      const userId = res.locals.user.id;
      
      if(!userId) {
        ControllerLogger.logValidationError('Get All Dump Registers', 'Unauthorized access', req, res);
        return next(new AppError(401, "Unauthorized access"));
      }
      
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
        limit: limit ? Number(limit) : undefined,
        searchFields: ['dumpRegister.id'],
        filters: {},
        sort: sort as string || undefined,
        search: search as string|| '',
      };
      
      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.DUMP_REGISTER);
      const dumpRegisters = await this.dumpRegisterService.getAllDumpRegisters(queryOptions, userId);
      
      if (!dumpRegisters) {
        ControllerLogger.logOperationFailed('Get All', 'Dump Registers', 'No records found', req, res);
        return next(new AppError(404, "No dump registers found"));
      }

      // 🔔 Send notification for get all dump registers
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Retrieved ${dumpRegisters.meta.total} dump registers`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Get all dump registers notification error:', notifError);
      // }

      ControllerLogger.logGetAllRecords('Dump Registers', req, res);
      res.status(200).json({
        status: "success",
        data: dumpRegisters.data,
        allRecords: dumpRegisters.meta.total,
        totalPages: dumpRegisters.meta.pages,
        page: dumpRegisters.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Get All Dump Registers', err, req, res);
      next(err);
    }
  }

  @httpPatch("/:id", captureUser)
  public async updateDumpRegister(
    @requestParam("id") id: string,
    @request() req: Request<{ id: string }, {}, UpdateDumpRegisterDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const updatedBy = res.locals.user.id;

      const dumpRegister = await this.dumpRegisterService.updateDumpRegister(id, req.body, updatedBy);
      
      if (!dumpRegister) {
        ControllerLogger.logNotFound('Dump Register', id, req, res);
        return next(new AppError(404, "Dump register not found or could not be updated"));
      }

      await this.notificationService.createNoti(
        `Dump register updated`,
        res.locals.user.id
      );

      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.DUMP_REGISTER,
        entityName: 'DumpRegister',
        entityId: id,
        description: `${userName} has updated Dump Register ${dumpRegister.dumpNo||id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      ControllerLogger.logSuccess('Dump Register updated', id, req, res);
      res.status(200).json({
        status: "success",
        message: "Dump register updated successfully",
        data: dumpRegister,
      });
    } catch (err) {
      ControllerLogger.logError('Update Dump Register', err, req, res);
      next(err);
    }
  }

  @httpDelete("/:id")
  public async deleteDumpRegister(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const result = await this.dumpRegisterService.deleteDumpRegister(id);
      
      if (!result) {
        ControllerLogger.logNotFound('Dump Register', id, req, res);
        return next(new AppError(404, "Dump register not found or could not be deleted"));
      }

      // 🔔 Send notification for dump register deletion
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Dump register deleted successfully`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Dump register deletion notification error:', notifError);
      // }

      ControllerLogger.logSuccess('Dump Register deleted', id, req, res);

      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.DUMP_REGISTER,
        entityName: 'DumpRegister',
        entityId: id,
        description: `${userName} has deleted Dump Register ${result.No||id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      res.status(200).send();
    } catch (err) {
      ControllerLogger.logError('Delete Dump Register', err, req, res);
      next(err);
    }
  }












  @httpDelete("/delete/multiple/dumpRegisters")
  public async deleteMultipleDumpRegisters(
    @request() req: Request<{}, {}, { ids: string[] }>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { ids } = req.body;
      
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        ControllerLogger.logValidationError('Delete Multiple Dump Registers', 'Invalid ids array', req, res);
        return next(new AppError(400, "Invalid request. 'ids' must be a non-empty array."));
      }
      
      const result = await this.dumpRegisterService.deleteMultipleDumpRegisters(ids);
      const deletedNos = result.success.map(s => s.No || s.id).join(', ');

      // 🔔 Send notification for multiple dump registers deletion
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `${ids.length} dump registers deleted successfully`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Multiple dump registers deletion notification error:', notifError);
      // }
      
      ControllerLogger.logSuccess('Multiple Dump Registers deleted', `${ids.length} items`, req, res);

      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.DUMP_REGISTER,
        entityName: 'DumpRegister',
        description: `${userName} has bulk deleted ${result.success.length} Dump Register(s): ${deletedNos}`,
        metadata: { ids, count: ids.length },
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      res.status(200).json({
        message: result.message,
      });
    } catch (error) {
      ControllerLogger.logError('Delete Multiple Dump Registers', error, req, res);
      next(error);
    }
  }
}


  // @httpGet("/calculations/dates")
  // public async getDumpData(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const { filterType, startDate, endDate } = req.query;
 
  //     const data = await this.dumpRegisterService.getDumpDataForDates(
  //       filterType as string | undefined,
  //       startDate as string | undefined,
  //       endDate as string | undefined
  //     );
      
  //     const overallTotal = data.reduce(
  //       (acc, row) => {
  //         acc.quantity += Number(row.quantity);
  //         acc.amount += Number(row.amount);
  //         return acc;
  //       },
  //       { quantity: 0, amount: 0 }
  //     );
      
  //     ControllerLogger.logList('Dump Calculations by Dates', req, res);
  //     res.status(200).json({
  //       message: "Dump calculations fetched successfully.",
  //       data: overallTotal,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get Dump Calculations by Dates', err, req, res);
  //     next(err);
  //   }
  // }


  // @httpGet("/getDump/companyName/:companyName")
  // public async getDumpRegisterByCompanyName(
  //   @requestParam("companyName") location: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const dumpRegister = await this.dumpRegisterService.getDumpRegisterByCompanyName(location);
      
  //     if (!dumpRegister) {
  //       ControllerLogger.logOperationFailed('Get', 'Dump Register by Company', 'No records found', req, res);
  //       return next(new AppError(404, "No dump registers found"));
  //     }

  //     ControllerLogger.logList('Dump Register by Company Name', req, res);
  //     res.status(200).json({
  //       status: "success",
  //       data: dumpRegister,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get Dump Register by Company Name', err, req, res);
  //     next(err);
  //   }
  // }



  // @httpGet("/getDump/location/:location")
  // public async getDumpRegisterByLocation(
  //   @requestParam("location") location: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const dumpRegister = await this.dumpRegisterService.getDumpRegisterlocation(location);
      
  //     if (!dumpRegister) {
  //       ControllerLogger.logOperationFailed('Get', 'Dump Register by Location', 'No records found', req, res);
  //       return next(new AppError(404, "No dump registers found"));
  //     }

  //     ControllerLogger.logList('Dump Register by Location', req, res);
  //     res.status(200).json({
  //       status: "success",
  //       data: dumpRegister,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get Dump Register by Location', err, req, res);
  //     next(err);
  //   }
  // }


  // @httpGet("/getDump/:startdate/and/:enddate")
  // public async getDumpRegisterByDate(
  //   @requestParam("startdate") startdate: string,
  //   @requestParam("enddate") enddate: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const startDateObj = new Date(startdate);
  //     const endDateObj = new Date(enddate);
      
  //     const dumpRegister = await this.dumpRegisterService.totalqunatityandtotaldumpcostfromstartdatetoenddate(startDateObj, endDateObj);
      
  //     if (!dumpRegister) {
  //       ControllerLogger.logOperationFailed('Get', 'Dump Register by Date', 'No records found', req, res);
  //       return next(new AppError(404, "No dump registers found"));
  //     }

  //     ControllerLogger.logList('Dump Register by Date Range', req, res);
  //     res.status(200).json({
  //       status: "success",
  //       data: dumpRegister,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get Dump Register by Date', err, req, res);
  //     next(err);
  //   }
  // }


  // @httpGet("/getDump/all/count")
  // public async getDumpRegisterCount(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const dumpRegister = await this.dumpRegisterService.dumpcount();
      
  //     if (!dumpRegister) {
  //       ControllerLogger.logOperationFailed('Get', 'Dump Register Count', 'No records found', req, res);
  //       return next(new AppError(404, "No dump registers found"));
  //     }

  //     ControllerLogger.logList('Dump Register Count', req, res);
  //     res.status(200).json({
  //       status: "success",
  //       data: dumpRegister,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get Dump Register Count', err, req, res);
  //     next(err);
  //   }
  // }


  // @httpGet("/getDump/quantityandcost")
  // public async getDumpRegisterQty(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const dumpRegisterQty = await this.dumpRegisterService.totaldumpquantity();
  //     const dumpregisterAmt = await this.dumpRegisterService.totaldumpcost();
      
  //     if (!dumpRegisterQty) {
  //       ControllerLogger.logOperationFailed('Get', 'Dump Register Quantity and Cost', 'No records found', req, res);
  //       return next(new AppError(404, "No dump registers found"));
  //     }
      
  //     const number1 = parseInt(dumpRegisterQty.toString());
      
  //     ControllerLogger.logList('Dump Register Quantity and Cost', req, res);
  //     res.status(200).json({
  //       status: "success",
  //       data: {
  //         totalDumpQuantity: number1,
  //         totalDumpAmount: dumpregisterAmt
  //       },
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get Dump Register Quantity and Cost', err, req, res);
  //     next(err);
  //   }
  // }


  // @httpGet("/:id")
  // public async getDumpRegisterById(
  //   @requestParam("id") id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const dumpRegister = await this.dumpRegisterService.getDumpRegisterById(id);
      
  //     if (!dumpRegister) {
  //       ControllerLogger.logNotFound('Dump Register', id, req, res);
  //       return next(new AppError(404, "Dump register not found"));
  //     }

  //     // 🔔 Send notification for dump register view
  //     // try {
  //     //   const userId = res.locals.user?.id;
  //     //   if (userId) {
  //     //     await this.notificationService.createNoti(
  //     //       `Viewed dump register with ID ${id} details`,
  //     //       userId
  //     //     );
  //     //   }
  //     // } catch (notifError) {
  //     //   console.log('Dump register view notification error:', notifError);
  //     // }

  //     ControllerLogger.logView('Dump Register', id, req, res);
  //     res.status(200).json({
  //       status: "success",
  //       data: dumpRegister,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get Dump Register by ID', err, req, res);
  //     next(err);
  //   }
  // }

