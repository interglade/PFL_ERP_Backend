import { inject } from "inversify";
import { controller, httpGet, next, response,request, requestParam, httpPost, requestBody, httpPatch, httpDelete } from "inversify-express-utils";
import { TYPES } from "../../types";

import { NextFunction,Request,Response } from "express";
import AppError from "../../utils/appError";
import { captureUser, deserializeUser, requireUser } from "../../middleware/deserializeUser";
import logger, { UserLogger } from "../../utils/logger";
import { PaginationOptions } from "../../utils/pagination";
import { ControllerLogger } from "../../utils/controllerLogger";

import {
  CreateRBCDto,
  UpdateRBCDto,
  RBCListResponseDto,
  RBCDetailDto,
  RBCViewDto,
  RBCUpdateFormDto,
  RBCNumbersResponseDto,
  BulkDeleteRBCDto,
  BulkDeleteRBCResultDto,
} from "../dto/postReturnByCustomer.dto";
import { UserActivityLogService } from "../../employeeActivity/service/userActivityLog.service";
import { PostReturnByCustomerService } from "../service/postReturnByCustomer.service";
import { NotificationService } from "../../notification/service/notification.service";
import { ActivityAction, ActivityModule } from "../../employeeActivity/entity/userActivityLog.entity";
import { DocumentExportService } from '../../excel/export/documentExport.service';
import { RETURN_BY_CUSTOMER_EXPORT } from '../excel/returnByCustomer.export';
import { applyDocumentListFilters } from '../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../approvalFlow/entity/docuemnt.entity';



@controller("/returns",deserializeUser,requireUser)
export class PostReturnByCustomerController {
  constructor(
    @inject(TYPES.PostReturnByCustomerService)
    private postReturnByCustomerService: PostReturnByCustomerService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService) private activityLogService: UserActivityLogService,
    @inject(TYPES.DocumentExportService)
    private readonly documentExportService: DocumentExportService,

  ) {}

  /**
   * GET export/excel - every Return By Customer the user can see in the list, as an .xlsx.
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
      entityName: 'Return By Customer',
      definition: RETURN_BY_CUSTOMER_EXPORT,
      list: { documentType: FilterDocumentType.RETURN_BY_CUSTOMER, searchFields: ['postreturn.id'] },
      fetchList: (queryOptions, userId) => this.postReturnByCustomerService.getAllPostReturnByCustomer(queryOptions, userId),
    });
  }

  @httpGet("/")
  public async getAllPostReturns(
    @request() req:Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { page, limit, search, sort,id} = req.query;
          
      
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
        limit: limit ? Number(limit) : undefined,
        searchFields: ["postreturn.id"],
        filters: {},
        sort: sort as string || undefined, // Adjust this line to match your sorting requirements
        search: search as string|| '',
      };

      const userId = res.locals.user?.id;
      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.RETURN_BY_CUSTOMER);
      const postReturns = await this.postReturnByCustomerService.getAllPostReturnByCustomer(queryOptions, userId);
      
      // Log the successful retrieval
      ControllerLogger.logList("Post Return By Customer", req, res);

      
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Post Return By Customer records list accessed successfully',
      //     userId
      //   );
      // }
      
      res.status(200).json({
        status: "success",
        data: postReturns.data,
        allRecords: postReturns.meta.total,
        totalPages: postReturns.meta.pages,
        page:postReturns.meta.page,
      });
    } catch (error) {
      ControllerLogger.logError('Post Return By Customer list retrieval', error, req, res);
      next(error);
    }
  }

  @httpGet("/:id")
  public async getPostReturnById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const postReturn = await this.postReturnByCustomerService.getByIdPostReturnByCustomer(id);
      if (!postReturn) {
        return next(new AppError(404, "Post return not found"));
      }
      
      ControllerLogger.logView("Post Return By Customer", id, req, res);

      // Send notification for post return view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Post Return By Customer viewed: ${id}`,
      //     userId
      //   );
      // }
      
      res.status(200).json({
        status: "success",
        data: postReturn,
      });
    } catch (error) {
      ControllerLogger.logError('Post Return By Customer view', error, req, res);
      next(error);
    }
  }

  @httpGet("/view/:docid")
  public async getPostReturnByIdforview(
    @requestParam("docid") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const postReturn = await this.postReturnByCustomerService.getByIdPostReturnByCustomerforView(id);
      if (!postReturn) {
        return next(new AppError(404, "Post return not found"));
      }
      
      ControllerLogger.logView("Post Return By Customer", id, req, res);
      
      res.status(200).json({
        status: "success",
        data: postReturn,
      });
    } catch (error) {
      ControllerLogger.logError('Post Return By Customer view', error, req, res);
      next(error);
    }
  }



  @httpGet("/update/:id")
  public async getPostReturnByIdforupdate(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const postReturn = await this.postReturnByCustomerService.getByIdPostReturnByCustomerforupdate(id);
      if (!postReturn) {
        return next(new AppError(404, "Post return not found"));
      }
      
      ControllerLogger.logView("Post Return By Customer (for update)", id, req, res);
      
      res.status(200).json({
        status: "success",
        data: postReturn,
      });
    } catch (error) {
      ControllerLogger.logError('Post Return By Customer retrieval for update', error, req, res);
      next(error);
    }
  }

@httpDelete('/delete/multiple')
  public async deleteMultipleRBC(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return next(new AppError(400, 'An array of RBC IDs is required'));
      }
      const result = await this.postReturnByCustomerService.deleteMultipleRBC(ids);
      const deletedNos = result.success.map(s => s.No || s.id).join(', ');

      // 🔔 Send notification for bulk AQR deletion
      // try {
      //   const userId = res.locals.user.id;
      //   await this.notificationService.createNoti(
      //     `RBCs deleted successfully`,
      //     userId
      //   );
      // } catch (notifError) {
      //   console.log('Notification error:', notifError);
      // }

      // Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.RETURN_BY_CUSTOMER,
        entityName: 'ReturnByCustomer',
        description: `${userName} has bulk deleted ${result.success.length} ReturnByCustomer(s): ${deletedNos}`,
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
       ControllerLogger.logError('RBC deleteed', error, req, res);
      next(error);
    }
  }

  @httpGet("/get/rbcNo")
  public async getAllRBCNumbers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const page = req.query.page ? parseInt(req.query.page as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const search = req.query.search as string | undefined;
      const result = await this.postReturnByCustomerService.getAllRBCNumbers(page, limit, search);
      res.status(200).json({
        status: 'success',
        data: result.data,
        allRecords: result.total,
        totalPages: result.totalPages,
        page: result.page,
      });
    } catch (error) {
      next(error);
    }
  }

  @httpPost("/")
  public async createPostReturn(
    @requestBody() postReturnData: any,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {

      const requestedBy = res.locals.user.id; // Pass full user object
      const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'Unknown';

      const newPostReturn = await this.postReturnByCustomerService.createReturn(postReturnData, requestedBy, clientIp);
      
      ControllerLogger.logSuccess('Post Return By Customer created', newPostReturn.id, req, res);

      // Send notification for post return creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Post Return By Customer created successfully`,
          userId
        );
      }

      // Single activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
          this.activityLogService.logActivity({
            userId: res.locals.user.id,
            userName,
            action: ActivityAction.CREATE,
            module: ActivityModule.RETURN_BY_CUSTOMER,
            entityName: 'ReturnByCustomer',
            entityId: newPostReturn.id,
            description: `${userName} has created ReturnByCustomer ${newPostReturn.rbcNo || newPostReturn.id}`,
            ipAddress: req.ip || '',
            userAgent: req.get('user-agent'),
            endpoint: req.originalUrl,
            httpMethod: req.method,
            statusCode: 201,
          }).catch(() => {});
      
      res.status(201).json({
        status: "success",
        data: newPostReturn.id,
        message: "Post return created successfully",
      });
    } catch (error) {
      ControllerLogger.logError('Post Return By Customer creation', error, req, res);
      if (error instanceof Error) {
               return next(new AppError(400, error.message)); // ← sends 400 with real message
             }
      next(error);
    }
  }

  @httpPatch("/:id" ,captureUser)
    public async update(
      @requestParam("id") id: string,
      @requestBody() data: any,
      @request()req:Request,
      @response() res: Response,
      @next() next: NextFunction
    ) {
      try {
        const updatedBy = res.locals.updatedBy;
        const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'Unknown';
        const postreturn = await this.postReturnByCustomerService.updatePostReturnByCustomer(id, data, updatedBy, clientIp);
        
        if (!postreturn) {
          ControllerLogger.logError(`Post Return By Customer update`, new Error("PostReturn not found or update failed"), req, res);
          return next(new AppError(404, "postreturn not found or update failed"));
        }
        
        ControllerLogger.logSuccess('Post Return By Customer updated', id, req, res);

        // Send notification for post return update
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Post Return By Customer updated successfully`,
            userId
          );
        }
        
          // Activity log
          const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.RETURN_BY_CUSTOMER,
        entityName: 'ReturnByCustomer',
        entityId: id,
        description: `${userName} has updated ReturnByCustomer ${postreturn.rbcNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});


        res.status(200).json({
          status: "success",
          message: "postreturn updated successfully",
        });
      } catch (err) {
        logger.error(`Error updating postreturn with ID: ${id}`, { error: err });
        ControllerLogger.logError('Post Return By Customer update', err, req, res);
        next(err);
      }
    }
    @httpPost('/export-report')
  async exportReport(@request() req: Request,
      @response() res: Response,
      @next() next: NextFunction,) {
  
        try{
          
          const buffer = await this.postReturnByCustomerService.generateReturnByCustomerReport(req.body);
  
          if (!buffer) {
          ControllerLogger.logOperationFailed('Export', 'Final Invoice Report', 'No data found for the given filters', req, res);
          return res.status(404).json({
            status: 'error',
            message: 'No data found for the given filters',
          });
        }
  
  
        res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=ReturnBYCustomer_Report.xlsx',
      );
  
      res.send(buffer);
  
  
        }catch(err){
          ControllerLogger.logError('Export Excel to Spaces', err, req, res);
        next(err);
        }
    }
}
