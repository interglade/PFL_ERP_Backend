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
import { NextFunction, Request, Response } from "express";
import AppError from "../../utils/appError";
import logger from "../../utils/logger";

import { ControllerLogger } from "../../utils/controllerLogger"; // if needed for file upload

import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { PaginationOptions } from "../../utils/pagination";

import { UserActivityLogService } from "../../employeeActivity/service/userActivityLog.service";
import { CreateVehicleDispatchDto, UpdateVehicleDispatchDto } from "../dto/vehicleDispatch.dto";
import { VehicleDispatchService } from "../service/vehicleDispatch.service";
import { NotificationService } from "../../notification/service/notification.service";
import { ActivityAction, ActivityModule } from "../../employeeActivity/entity/userActivityLog.entity";
import { DocumentExportService } from '../../excel/export/documentExport.service';
import { VEHICLE_DISPATCH_EXPORT } from '../excel/vehicleDispatch.export';
import { applyDocumentListFilters } from '../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../approvalFlow/entity/docuemnt.entity';

@controller("/vehicleDispatches",deserializeUser,requireUser)
export class VehicleDispatchController {
  constructor(
    @inject(TYPES.VehicleDispatchService)
    private vehicleDispatchService: VehicleDispatchService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService, // Inject NotificationService
    @inject(TYPES.UserActivityLogService) private activityLogService: UserActivityLogService,
    @inject(TYPES.DocumentExportService)
    private readonly documentExportService: DocumentExportService,
    
  ) {}

  @httpPost("/")
  public async createVehicleDispatch(
    @request() req: Request<{}, {}, CreateVehicleDispatchDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const dispatchData: CreateVehicleDispatchDto = {
        ...req.body,
        dcNo: req.body.dcNo || null,
        requestedBy: res.locals.user.id,
      };


      logger.debug("Vehicle dispatch data prepared for creation", dispatchData);
      const vehicleDispatch = await this.vehicleDispatchService.create(
        dispatchData
      );
      if (!vehicleDispatch) {
        logger.error("Failed to create vehicle dispatch", { dispatchData });
        return next(new AppError(400, "Vehicle dispatch could not be created"));
      }
      logger.info("Vehicle dispatch created successfully", {
        vehicleDispatchId: vehicleDispatch.id,
      });

      // Send notification for vehicle dispatch creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Vehicle Dispatch created successfully`,
          userId
        );
      }

      ControllerLogger.logSuccess('Vehicle Dispatch created', vehicleDispatch.id, req, res);
       // Single activity log
       const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
          this.activityLogService.logActivity({
            userId: res.locals.user.id,
            userName,
            action: ActivityAction.CREATE,
            module: ActivityModule.VEHICAL_DISPATCH,
            entityName: 'Vehical Dispatch',
            entityId: vehicleDispatch.id,
            description: `${userName} has created Vehical Dispatch ${vehicleDispatch.vehicleDispatchNo || vehicleDispatch.id}`,
            ipAddress: req.ip || '',
            userAgent: req.get('user-agent'),
            endpoint: req.originalUrl,
            httpMethod: req.method,
            statusCode: 201,
          }).catch(() => {});
     
      res.status(201).json({
        status: "success",
        message: "Vehicle Dispatch created successfully",
        data: vehicleDispatch.id,
      });
    } catch (err) {
      logger.error("Error occurred while creating vehicle dispatch", {
        error: err,
      });
      ControllerLogger.logError('Vehicle Dispatch creation', err, req, res);
      if (err instanceof Error) {
               return next(new AppError(400, err.message)); // ← sends 400 with real message
             }
      next(err);
    }
  }
 //TODO: get All Recycle Bin Vehical Dispatch.....By Vaishali
    @httpGet('/recyclebin')
    public async getAllRecycleBinVehicalDispatch(
      @request() req: Request,
      @response() res: Response,
      @next() next: NextFunction,
    ) {
      try {
        logger.info('Fetching all Vehical Dispatch...');
        const {
          page,
          limit,
          search,
          sort,
          vehicleType,
          vehicleNo,
        } = req.query;
    
        const userId = res.locals.user.id;
    
        const filters: any = {};
        if (vehicleType) filters.vehicleType = vehicleType;
        if (vehicleNo) filters.vehicleNo = vehicleNo;
        
    
        const queryOptions: PaginationOptions = {
          page: page ? Number(page) : 1,
          limit: limit ? Number(limit) : 10,
          searchFields: ['vehicleType vehicleNo'],
          filters,
          sort: (sort as string) || undefined,
          search: (search as string) || '',
        };
    
        const vehicalDispatch = await this.vehicleDispatchService.getAllRecycleBinVehicalDispatch(queryOptions, userId);
    
        if (!vehicalDispatch || vehicalDispatch.data.length === 0) {
          logger.warn('No Vehical Dispatch found for this user.');
          return res.status(200).json({
            status: 'success',
            data: [],
            allRecords: 0,
            totalPages: 0,
            page: queryOptions.page,
          });
        }
    
      //  logger.info(Total Vehical Dispatch fetched: ${vehicalDispatch.data.length});
    
        res.status(200).json({
          status: 'success',
          data: vehicalDispatch.data,
          allRecords: vehicalDispatch.meta.total,
          totalPages: vehicalDispatch.meta.pages,
          page: vehicalDispatch.meta.page,
        });
      } catch (error) {
        console.error('Error fetching Vehical Dispatch:', error);
        next(error);
      }
    }



  
  @httpPatch("/:id")
  public async updateVehicleDispatch(
    @requestParam("id") id: string,
    @request() req: Request<{}, {}, UpdateVehicleDispatchDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Updating vehicle dispatch details", {
        vehicleDispatchId: id,
      });
      const updateBy = res.locals.user.id;
      const updatedDispatch = await this.vehicleDispatchService.update(
        id,
        req.body,
        updateBy,
      );
      if (!updatedDispatch) {
        logger.warn("Vehicle Dispatch not found or could not be updated", {
          vehicleDispatchId: id,
        });
        return next(
          new AppError(
            404,
            "Vehicle Dispatch not found or could not be updated"
          )
        );
      }
      logger.info("Vehicle Dispatch updated successfully", { updatedDispatch });

      // Send notification for vehicle dispatch update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Vehicle Dispatch updated successfully`,
          userId
        );
      }

      ControllerLogger.logSuccess('Vehicle Dispatch updated', id, req, res);
      
      // Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.VEHICAL_DISPATCH,
        entityName: 'Vehical Dispatch',
        entityId: id,
        description: `${userName} has updated Vehical Dispatch ${updatedDispatch.vehicleDispatchNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});


      res.status(200).json({
        status: "success",
        message: "Vehicle Dispatch updated successfully",
        data: updatedDispatch,
      });
    } catch (err) {
      logger.error("Error occurred while updating vehicle dispatch", {
        vehicleDispatchId: id,
        error: err,
      });
      next(err);
    }
  }

  @httpDelete("/:id")
  public async deleteVehicleDispatch(
    @requestParam("id") id: string,
    @response() res: Response,
    @request() req:Request,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Deleting vehicle dispatch", { vehicleDispatchId: id });
      const result= await this.vehicleDispatchService.delete(id);
      //res.status(204).send(); // No content

      if (!result) {
              
              return next(
                new AppError(404, "Vehicle Dispatch not found or could not be deleted")
              );
            }

      // Send notification for vehicle dispatch deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Vehicle Dispatch deleted successfully`,
      //     userId
      //   );
      // }

      
       // Activity log
       const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.VEHICAL_DISPATCH,
        entityName: 'Vehical Dispatch',
        entityId: id,
        description: `${userName} has deleted Vehical Dispatch ${result.No || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      res.status(200).json({
        status: "success",
        message: "Vehicle Dispatch has been deleted",
      });
    } catch (err) {
      logger.error("Error occurred while deleting vehicle dispatch", {
        vehicleDispatchId: id,
        error: err,
      });
      next(err);
    }
  }


  /**
   * GET export/excel - every Vehicle Dispatch the user can see in the list, as an .xlsx.
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
      entityName: 'Vehicle Dispatch',
      definition: VEHICLE_DISPATCH_EXPORT,
      list: { documentType: FilterDocumentType.VEHICLE_DISPATCH_REGISTER, searchFields: ['vehicleType vehicleNo'], filterKeys: ['vehicleType', 'vehicleNo'] },
      fetchList: (queryOptions, userId) => this.vehicleDispatchService.getAllvehicalDispatch(queryOptions, userId),
    });
  }

  //TODO: get All Vehical Dispatch.....By Vaishali
    @httpGet('/')
    public async getAllvehicalDispatch(
      @request() req: Request,
      @response() res: Response,
      @next() next: NextFunction,
    ) {
      try {
        logger.info('Fetching all Vehical Dispatch...');
        const {
          page,
          limit,
          search,
          sort,
          vehicleType,
          vehicleNo,
        } = req.query;
    
        const userId = res.locals.user.id;
    
        const filters: any = {};
        if (vehicleType) filters.vehicleType = vehicleType;
        if (vehicleNo) filters.vehicleNo = vehicleNo;
        
    
        const queryOptions: PaginationOptions = {
          page: page ? Number(page) : 1,
          limit: limit ? Number(limit) : 10,
          searchFields: ['vehicleType vehicleNo'],
          filters,
          sort: (sort as string) || undefined,
          search: (search as string) || '',
        };
    
        // Same filters as the Excel export: validated, applied in SQL before pagination.
        applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.VEHICLE_DISPATCH_REGISTER);
        const vehicalDispatch = await this.vehicleDispatchService.getAllvehicalDispatch(queryOptions, userId);
    
        if (!vehicalDispatch || vehicalDispatch.data.length === 0) {
          logger.warn('No Vehical Dispatch found for this user.');
          return res.status(200).json({
            status: 'success',
            data: [],
            allRecords: 0,
            totalPages: 0,
            page: queryOptions.page,
          });
        }
    
      //  logger.info(Total Vehical Dispatch fetched: ${vehicalDispatch.data.length});
    
        // Send notification for vehicle dispatch list access
        // if (userId) {
        //   await this.notificationService.createNoti(
        //     'Vehicle Dispatch records list accessed successfully',
        //     userId
        //   );
        // }

        ControllerLogger.logList('Vehicle Dispatch', req, res);
        res.status(200).json({
          status: 'success',
          data: vehicalDispatch.data,
          allRecords: vehicalDispatch.meta.total,
          totalPages: vehicalDispatch.meta.pages,
          page: vehicalDispatch.meta.page,
        });
      } catch (error) {
        console.error('Error fetching Vehical Dispatch:', error);
        next(error);
      }
    }


     //TODO: Vehical Dispatch get by id for view...BY Vaishali
      @httpGet('/view/:docid')
      public async getVehicalDispatchByIdForView(
        @requestParam('docid') docid: string,
        @response() res: Response,
        @next() next: NextFunction,
      ) {
        try {
       //   logger.info(Fetching Vehical Dispatch with Document ID);
          
          const userId = res.locals.user.id;
          const vehicalDispatch = await this.vehicleDispatchService.getVehicalDispatchByIdForView(docid,userId);
          if (!vehicalDispatch) {
            return res.status(403).json({
            status: 'fail',
            message: 'You do not have permission to view this Inward Register',
          });
            //return next(new AppError(404, 'dealSlip not found'));
          }
          logger.info(`Vehical Dispatch with ID fetched successfully.`);
          const requestedBy = res.locals.user.id;
          // Send a notification when the user logs in successfully
          // const message = Welcome back! You have successfully logged in.;
          // await this.notificationService.createNoti(message, requestedBy);
          res.status(200).json({
            status: 'success',
            data: vehicalDispatch,
          });
        } catch (error) {
          logger.error('Error fetching Vehical Dispatch by ID:', error);
          next(error);
        }
      }
@httpDelete('/delete/multiple')
    public async deleteMultipleVehicleDispatch(
      @request() req: Request,
      @response() res: Response,
      @next() next: NextFunction,
    ) {
      try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
          return next(new AppError(400, 'An array of Vehicle Dispatch IDs is required'));
        }
        const result = await this.vehicleDispatchService.deleteMultipleVehicleDispatch(ids);
        const deletedNos = result.success.map(s => s.No || s.id).join(', ');

        // Send notification for multiple vehicle dispatch deletion
        // const userId = res.locals.user?.id;
        // if (userId) {
        //   await this.notificationService.createNoti(
        //     `Multiple Vehicle Dispatches deleted successfully: ${ids.length} records`,
        //     userId
        //   );
        // }

        ControllerLogger.logSuccess('Vehicle Dispatch multiple deletion', `${ids.length} records`, req, res);
        
        // Activity log
        const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.VEHICAL_DISPATCH,
        entityName: 'Vehical Dispatch',
        description: `${userName} has bulk deleted ${result.success.length} Vehical Dispatch(s): ${deletedNos}`,
        metadata: { ids, count: ids.length },
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});


        res.status(200).json({
          message: result.message,
          success: result.success,
          failed: result.failed,
        });
      }
        catch (error) {
        logger.error('Error deleting multiple Vehicle Dispatch', { error });
        next(error);
      }
    }


}


  // @httpGet("/:id")
  // public async getVehicleDispatchById(
  //   @requestParam("id") id: string,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     logger.info("Fetching vehicle dispatch details by ID", {
  //       vehicleDispatchId: id,
  //     });
  //     const vehicleDispatch = await this.vehicleDispatchService.findById(id);
  //     if (!vehicleDispatch) {
  //       logger.warn("Vehicle Dispatch not found", { vehicleDispatchId: id });
  //       return next(new AppError(404, "Vehicle Dispatch not found"));
  //     }
  //     logger.info("Vehicle Dispatch details retrieved successfully", {
  //       vehicleDispatch,
  //     });

  //     // Send notification for vehicle dispatch view
  //     // const userId = res.locals.user?.id;
  //     // if (userId) {
  //     //   await this.notificationService.createNoti(
  //     //     `Vehicle Dispatch viewed: ${id}`,
  //     //     userId
  //     //   );
  //     // }


  //     res.status(200).json({
  //       status: "success",
  //       data: vehicleDispatch,
  //     });
  //   } catch (err) {
  //     logger.error("Error occurred while fetching vehicle dispatch details", {
  //       vehicleDispatchId: id,
  //       error: err,
  //     });
  //     next(err);
  //   }
  // }


//   @httpGet('/filter')
// public async filterVehicalDispatch(
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction,
// ) {
// try {
//       // Extract pagination
//       const page = parseInt(req.query.page as string, 10) || 1;
//       const limit = parseInt(req.query.limit as string, 10) || 10;

//       // Remove pagination keys and treat the rest as filters
//       const { page: _p, limit: _l, ...restQuery } = req.query;

//       // Always initialize filters as a Record
//       const filters: Record<string, any> = {};

//       for (const [key, value] of Object.entries(restQuery ?? {})) {
//         if (value !== undefined && value !== "") {
//           filters[key] = value;
//         }
//       }

//       const result = await this.vehicleDispatchService.filterVehicalDispatch(page, limit, filters);

//       res.json({
//         success: true,
//         ...result,
//       });
//     } catch (error) {
//       console.error(error);
//       res.status(500).json({ success: false, message: "Server Error" });
//     }
// }


