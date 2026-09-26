import { id, inject } from "inversify";
import { controller, httpGet, request, response, next, requestParam, httpPost, requestBody, httpPatch, httpDelete } from "inversify-express-utils";
import { TYPES } from "../../types";
import { DealSlipService } from "../service/dealSlip.service";
import { Request, Response, NextFunction } from "express";
import AppError from "../../utils/appError";
import { captureUser, deserializeUser, requireUser} from "../../middleware/deserializeUser";
import { PaginationOptions } from "../../utils/pagination";
import { ControllerLogger } from "../../utils/controllerLogger";


import { UserActivityLogService } from "../../employeeActivity/service/userActivityLog.service";
import { NotificationService } from "../../notification/service/notification.service";
import { ApproveDealSlipDto, ApproveDealSlipResultDto, BulkDeleteDealSlipDto, BulkDeleteDealSlipResultDto, CreateDealSlipDto, DealSlipDetailDto, DealSlipDocumentViewDto, DealSlipListResponseDto, DealSlipNumbersResponseDto, DealSlipRecycleBinResponseDto, UpdateDealSlipDto } from "../dto/dealSlip.dto";
import { ActivityAction, ActivityModule } from "../../employeeActivity/entity/userActivityLog.entity";
import { DocumentExportService } from '../../excel/export/documentExport.service';
import { DEAL_SLIP_EXPORT } from '../excel/dealSlip.export';
import { applyDocumentListFilters } from '../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../approvalFlow/entity/docuemnt.entity';



@controller('/dealSlip', deserializeUser, requireUser)
export class DealSlipController {
  
  constructor(
    @inject(TYPES.DealSlipService)
    private dealSlipService: DealSlipService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService)
    private activityLogService: UserActivityLogService,
    @inject(TYPES.DocumentExportService)
    private readonly documentExportService: DocumentExportService,
  ) {}

  @httpGet('/recyclebin')
  public async getRecycleBinDealSlips(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const {
        page,
        limit,
        search,
        sort,
        approvalStatus,
        loadingLocation,
        requestingDepartment,
        dealSlipNo
      } = req.query;

      const userId = res.locals.user.id;

      const filters: any = {};
      if (approvalStatus) filters.approvalStatus = approvalStatus;
      if (loadingLocation) filters.loadingLocation = loadingLocation;
      if (requestingDepartment) filters.requestingDepartment = requestingDepartment;
      if (dealSlipNo) filters.dealSlipNo = dealSlipNo;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        filters,
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      const dealSlips: DealSlipRecycleBinResponseDto = await this.dealSlipService.getRecycleBinDealSlips(queryOptions, userId);

      if (!dealSlips || dealSlips.data.length === 0) {
        return res.status(200).json({
          status: 'success',
          data: [],
          allRecords: 0,
          totalPages: 0,
          page: queryOptions.page,
        });
      }

      ControllerLogger.logGetAllRecords('Deal Slips (Recycle Bin)', req, res);
      res.status(200).json({
        status: 'success',
        data: dealSlips.data,
        allRecords: dealSlips.meta.total,
        totalPages: dealSlips.meta.pages,
        page: dealSlips.meta.page,
      });
    } catch (error) {
      ControllerLogger.logError('Get Recycle Bin Deal Slips', error, req, res);
      next(error);
    }
  }

  /**
   * GET export/excel - every Deal Slip the user can see in the list, as an .xlsx.
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
      entityName: 'Deal Slip',
      definition: DEAL_SLIP_EXPORT,
      list: { documentType: FilterDocumentType.DEAL_SLIP, filterKeys: ['approvalStatus', 'loadingLocation', 'requestingDepartment', 'dealSlipNo'] },
      fetchList: (queryOptions, userId) => this.dealSlipService.getAllDealSlips(queryOptions, userId),
       // TEMP: testing only, revert after
     //fetchList: async () => ({ data: [{ id: '00000000-0000-0000-0000-000000000000', documentId: null }] }),
    });
  }

  @httpGet('/')
  public async getAllDealSlips(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const {
        page,
        limit,
        search,
        sort,
        approvalStatus,
        loadingLocation,
        requestingDepartment,
        dealSlipNo
      } = req.query;

      const userId = res.locals.user.id;

      const filters: any = {};
      if (approvalStatus) filters.approvalStatus = approvalStatus;
      if (loadingLocation) filters.loadingLocation = loadingLocation;
      if (requestingDepartment) filters.requestingDepartment = requestingDepartment;
      if (dealSlipNo) filters.dealSlipNo = dealSlipNo;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        filters,
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.DEAL_SLIP);
      const dealSlips: DealSlipListResponseDto = await this.dealSlipService.getAllDealSlips(queryOptions, userId);

      if (!dealSlips || dealSlips.data.length === 0) {
        return res.status(200).json({
          status: 'success',
          data: [],
          allRecords: 0,
          totalPages: 0,
          page: queryOptions.page,
        });
      }

      // // 🔔 Send notification for get all deal slips
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Retrieved ${dealSlips.meta.total} deal slips`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Get all deal slips notification error:', notifError);
      // }

      ControllerLogger.logGetAllRecords('Deal Slips', req, res);
      res.status(200).json({
        status: 'success',
        data: dealSlips.data,
        allRecords: dealSlips.meta.total,
        totalPages: dealSlips.meta.pages,
        page: dealSlips.meta.page,
      });
    } catch (error) {
      ControllerLogger.logError('Get All Deal Slips', error, req, res);
      next(error);
    }
  }



  @httpGet("/:id/update")
  public async findDealSlipByIdforUpdate(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      const dealSlip: DealSlipDetailDto | null = await this.dealSlipService.findDealSlipByIdforUpdate(id);
      
      if (!dealSlip) {
        ControllerLogger.logNotFound('Deal Slip', id, req, res);
        return next(new AppError(404, "Deal Slip not found"));
      }
      
      ControllerLogger.logView('Deal Slip (for update)', id, req, res);
      res.status(200).json({
        status: "success",
        data: dealSlip,
      });
    } catch (error) {
      ControllerLogger.logError('Get Deal Slip for update', error, req, res);
      next(error);
    }
  }

  @httpPost("/")
  public async createDealSlip(
    @requestBody() dealData: CreateDealSlipDto & Record<string, any>,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      Object.keys(dealData).forEach((key) => {
        if (dealData[key] === "null") dealData[key] = null;
      });
      
      const requestedBy = res.locals.user.id;
      dealData.requestedBy = requestedBy;
      dealData.requestingDepartment = res.locals.user.selectDepartment;
      
      const dealSlip = await this.dealSlipService.createDealSlip(dealData);
      
      // 🔔 Send notification for deal slip creation
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Deal slip "${dealSlip.dealSlipNo}" created successfully`,
            userId
          );
        }
      } catch (notifError) {
      }

      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      
      //const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
     
      // Single activity log
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.CREATE,
        module: ActivityModule.DEAL_SLIP,
        entityName: 'DealSlip',
        entityId: dealSlip.id,
        description: `${userName} has created DealSlip ${dealSlip.dealSlipNo || dealSlip.id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
      
      ControllerLogger.logSuccess('Deal Slip created', dealSlip.id, req, res);
      res.status(200).json({
        status: "success",
        data: dealSlip,
      });
    } catch (error) {
      ControllerLogger.logError('Create Deal Slip', error, req, res);

       if (error instanceof Error) {
         return next(new AppError(400, error.message)); // ← sends 400 with real message
       }

      next(error);
    }
  }

  @httpPatch("/:id",captureUser)
  public async updateDealSlip(
    @requestParam("id") dealSlipId: string,
    @requestBody() dealSlipData: UpdateDealSlipDto & Record<string, any>,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      Object.keys(dealSlipData).forEach((key) => {
        if (dealSlipData[key] === "null") dealSlipData[key] = null;
      });
      
      const updatedBy = res.locals.updatedBy;
      const updatedDealSlip = await this.dealSlipService.updateDealSlip(dealSlipId, dealSlipData, updatedBy);

      if (!updatedDealSlip) {
        ControllerLogger.logNotFound('Deal Slip', dealSlipId, req, res);
        return next(new AppError(404, "Deal Slip not found"));
      }
      
      // 🔔 Send notification for deal slip update
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Deal slip "${updatedDealSlip.dealSlipNo}" updated successfully`,
            userId
          );
        }
      } catch (notifError) {
      }

      // 📝 Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.DEAL_SLIP,
        entityName: 'DealSlip',
        entityId: dealSlipId,
        description: `${userName} has updated DealSlip ${updatedDealSlip.dealSlipNo || dealSlipId}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
      
      ControllerLogger.logSuccess('Deal Slip updated', dealSlipId, req, res);
      res.status(200).json({
        status: "success",
        message: "Deal Slip updated successfully",
      });
    } catch (error) {
      ControllerLogger.logError('Update Deal Slip', error, req, res);
      next(error);
    }
  }

  @httpPatch("/approve/:dealSlipId")
  public async approveDealSlipHandler(
    @requestParam("dealSlipId") dealSlipId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      const userId = res.locals.user.id;
      const { approvalStatus, approvalNote }: ApproveDealSlipDto = req.body;
      
      const result: ApproveDealSlipResultDto = await this.dealSlipService.approveDealSlip(dealSlipId, userId, { approvalStatus, approvalNote: approvalNote ?? undefined });

      if (!result) {
        ControllerLogger.logOperationFailed('Approve', 'Deal Slip', 'Cannot be approved', req, res);
        return next(new AppError(404, "Deal Slip not found or cannot be approved"));
      }
      
      // 🔔 Send notification for deal slip approval
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Deal slip approved with status: ${approvalStatus}`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Deal slip approval notification error:', notifError);
      // }
      
      ControllerLogger.logSuccess('Deal Slip approved', dealSlipId, req, res);
      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      ControllerLogger.logError('Approve Deal Slip', error, req, res);
      next(error);
    }
  }

  
  @httpGet("/dealslipno/getAlldealslipNo")
  public async getAllDealSlipNumbers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {

      const isGrnCreated = req.query.isGrnCreated === "true" ? true : req.query.isGrnCreated === "false" ? false : undefined;
      const userId = res.locals.user.id;

      

      const dealSlips: DealSlipNumbersResponseDto = await this.dealSlipService.getAllDealSlipsNo({...req.query, isGrnCreated},userId);
      
      if (!dealSlips || dealSlips.pagination.total === 0) {
        ControllerLogger.logOperationFailed('Get All', 'Deal Slip Numbers', 'No records found', req, res);
        return next(new AppError(404, "No Deal Slips found"));
      }
      
      ControllerLogger.logList('Deal Slip Numbers', req, res);
      res.status(200).json({
        status: "success",
        data: dealSlips.data,
        allRecords: dealSlips.pagination.total,
        totalPages: dealSlips.pagination.totalPages,
        page: dealSlips.pagination.page,
        
      });
    } catch (error) {
      ControllerLogger.logError('Get All Deal Slip Numbers', error, req, res);
      next(error);
    }
  }

  @httpDelete("/:id")
  public async deleteDealSlip(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const success = await this.dealSlipService.deleteDealSlip(id);
      
      if (!success) {
        ControllerLogger.logNotFound('Deal Slip', id, req, res);
        return res.status(404).json({ message: 'Deal Slip not found' });
      }

      // 📝 Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.DEAL_SLIP,
        entityName: 'DealSlip',
        entityId: id,
        description: `${userName} has deleted DealSlip ${success.dealSlipNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
      
      ControllerLogger.logSuccess('Deal Slip deleted', id, req, res);
      res.status(200).json({
        status: "success",
        message: "Deal Slip deleted successfully",
      });
    } catch (err) {
      ControllerLogger.logError('Delete Deal Slip', err, req, res);
      next(err);
    }
  }

  @httpGet('/view/:docid')
  public async getDealSlipByIdForView(
    @requestParam('docid') docid: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const userId = res.locals.user.id;
      const dealSlip: DealSlipDocumentViewDto | null = await this.dealSlipService.getDealSlipByIdForView(docid, userId);
      
      if (!dealSlip) {
        ControllerLogger.logOperationFailed('View', 'Deal Slip', 'Permission denied', req, res);
        return res.status(403).json({
          status: 'fail',
          message: 'You do not have permission to view this Deal Slip',
        });
      }
      
      ControllerLogger.logView('Deal Slip', docid, req, res);
      res.status(200).json({
        status: 'success',
        data: dealSlip,
      });
    } catch (error) {
      ControllerLogger.logError('Get Deal Slip by ID for view', error, req, res);
      next(error);
    }
  }



  @httpDelete("/delete/multiple")
  public async deleteMultipleDealSlips(
    @requestBody() body: BulkDeleteDealSlipDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const result: BulkDeleteDealSlipResultDto = await this.dealSlipService.deleteMultipleDealSlips(body.ids);
      
      // 📝 Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      const deletedList = (result as any).deletedNos?.map((no: string) => `"${no}"`).join(', ') || body.ids.join(', ');
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.DEAL_SLIP,
        entityName: 'DealSlip',
        description: `${userName} has bulk deleted ${body.ids.length} DealSlip(s): ${deletedList}`,
        metadata: { ids: body.ids, count: body.ids.length },
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      ControllerLogger.logSuccess('Multiple Deal Slips deleted', `${body.ids.length} items`, req, res);
      res.status(200).json({
        message: result.message,
      });
    } catch (err) {
      ControllerLogger.logError('Delete Multiple Deal Slips', err, req, res);
      next(err);
    }
  }
}



  // @httpGet('/filter')
  // public async filterDealSlips(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const page = parseInt(req.query.page as string, 10) || 1;
  //     const limit = parseInt(req.query.limit as string, 10) || 10;

  //     const { page: _p, limit: _l, ...restQuery } = req.query;

  //     const filters: Record<string, any> = {};
  //     for (const [key, value] of Object.entries(restQuery ?? {})) {
  //       if (value !== undefined && value !== "") {
  //         filters[key] = value;
  //       }
  //     }

  //     const result = await this.dealSlipService.filterDealSlips(page, limit, filters);

  //     ControllerLogger.logList('Deal Slips (filtered)', req, res);
  //     res.json({
  //       success: true,
  //       ...result,
  //     });
  //   } catch (error) {
  //     ControllerLogger.logError('Filter Deal Slips', error, req, res);
  //     res.status(500).json({ success: false, message: "Server Error" });
  //   }
  // }



// @httpGet("/dealslipno/getAlldealslipNo")
  // public async getAllDealSlipNumbers(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const dealSlips = await this.dealSlipService.getAllDealSlipsNo();
      
  //     if (!dealSlips || dealSlips.length === 0) {
  //       ControllerLogger.logOperationFailed('Get All', 'Deal Slip Numbers', 'No records found', req, res);
  //       return next(new AppError(404, "No Deal Slips found"));
  //     }
      
  //     ControllerLogger.logList('Deal Slip Numbers', req, res);
  //     res.status(200).json({
  //       status: "success",
  //       data: dealSlips,
  //     });
  //   } catch (error) {
  //     ControllerLogger.logError('Get All Deal Slip Numbers', error, req, res);
  //     next(error);
  //   }
  // }



  // @httpGet("/:id")
  // public async getDealSlipById(
  //   @requestParam("id") id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ): Promise<void> {
  //   try {
  //     const dealSlip: DealSlipDetailDto | null = await this.dealSlipService.findDealSlipById(id);
      
  //     if (!dealSlip) {
  //       ControllerLogger.logNotFound('Deal Slip', id, req, res);
  //       return next(new AppError(404, "Deal Slip not found"));
  //     }
      
  //     // 🔔 Send notification for deal slip view
  //     // try {
  //     //   const userId = res.locals.user?.id;
  //     //   if (userId) {
  //     //     await this.notificationService.createNoti(
  //     //       `Viewed deal slip "${dealSlip.dealSlipNo}" details`,
  //     //       userId
  //     //     );
  //     //   }
  //     // } catch (notifError) {
  //     //   console.log('Deal slip view notification error:', notifError);
  //     // }
      
  //     ControllerLogger.logView('Deal Slip', id, req, res);
  //     res.status(200).json({
  //       status: "success",
  //       data: dealSlip,
  //     });
  //   } catch (error) {
  //     ControllerLogger.logError('Get Deal Slip by ID', error, req, res);
  //     next(error);
  //   }
  // }