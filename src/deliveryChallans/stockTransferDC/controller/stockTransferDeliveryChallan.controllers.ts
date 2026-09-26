import { controller, httpDelete, httpGet, httpPatch, httpPost, next, request, requestParam, response } from "inversify-express-utils";
import { captureUser, deserializeUser, requireUser } from "../../../middleware/deserializeUser";
import { inject } from "inversify";
import { TYPES } from "../../../types";
import { StockTransferDeliveryChallanService } from "../service/stockTransferDeliveryChallan.service";

import { NextFunction ,Request,Response} from "express";
import logger from "../../../utils/logger";
import AppError from "../../../utils/appError";
import { PaginationOptions } from "../../../utils/pagination";

import { ControllerLogger } from "../../../utils/controllerLogger";
import { uploadAttachments } from "../../../middleware/upload.middleware";
import { setAttachmentUrls } from "../../../utils/fileUploadHelper";
;

import { UserActivityLogService } from "../../../employeeActivity/service/userActivityLog.service";
import { NotificationService } from "../../../notification/service/notification.service";
import { CreateSTDeliveryChallanDto, STDeliveryChallanListResponseDto, STDeliveryChallanUpdateFormDto, STDeliveryChallanViewDto } from "../dto/stockTransferDeliveryChallan.dto";
import {  ActivityAction, ActivityModule } from "../../../employeeActivity/entity/userActivityLog.entity";
import { DocumentExportService } from '../../../excel/export/documentExport.service';
import { STOCK_TRANSFER_DELIVERY_CHALLAN_EXPORT } from '../excel/stockTransferDeliveryChallan.export';
import { applyDocumentListFilters } from '../../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../../approvalFlow/entity/docuemnt.entity';

@controller('/tranfer-delivery-challan', deserializeUser, requireUser)
export class StockTranferDeliveryChallanController {

 constructor(
        @inject(TYPES.StockTransferDeliveryChallanService)
        private readonly stockTransferDeliveryChallanService: StockTransferDeliveryChallanService,
        @inject(TYPES.NotificationService)
        private notificationService: NotificationService,
        @inject(TYPES.UserActivityLogService) private activityLogService: UserActivityLogService,
        @inject(TYPES.DocumentExportService)
        private readonly documentExportService: DocumentExportService,
        
      ) {}
 @httpPost('/', uploadAttachments)
  public async create(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {

      // Use helper function to handle file URL extraction
      setAttachmentUrls(req.body, req.files as any[]);
      logger.info('Creating stock transfer delivery challan');
      const requestedBy = res.locals.user.id;
      req.body.createdBy = requestedBy;
      req.body.transferType=req.body.stockTransferType;
      const challan = await this.stockTransferDeliveryChallanService.create(
        req.body as CreateSTDeliveryChallanDto & Record<string, any>,
        requestedBy
      );
      if (!challan) {
        ControllerLogger.logError('Stock Transfer Delivery Challan creation', new AppError(400, 'Stock transfer delivery challan could not be created'), req, res);
        return next(new AppError(400, 'Stock transfer delivery challan could not be created'));
      }

      ControllerLogger.logSuccess('Stock Transfer Delivery Challan created', challan.id, req, res);

      // Send notification for stock transfer delivery challan creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Stock Transfer Delivery Challan created successfully`,
          userId
        );
      }

      // Single activity log
            const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
                this.activityLogService.logActivity({
                  userId: res.locals.user.id,
                  userName,
                  action: ActivityAction.CREATE,
                  module: ActivityModule.STOCK_TRANSFER_DELIVERY_CHALLAN,
                  entityName: 'Stock Trasnfer Delivery Challan',
                  entityId: challan.id,
                  description: `${userName} has created  Stock Trasnfer Delivery Challan${challan.challanNo || challan.id}`,
                  ipAddress: req.ip || '',
                  userAgent: req.get('user-agent'),
                  endpoint: req.originalUrl,
                  httpMethod: req.method,
                  statusCode: 201,
                }).catch(() => {});

                
      
      res.status(201).json({
        status: 'success',
        message: 'Stock transfer delivery challan created successfully',
        data: challan,
      });
    } catch (err) {
      logger.error('Error creating stock transfer delivery challan', { error: err });
      ControllerLogger.logError('Stock Transfer Delivery Challan creation', err, req, res);
      if (err instanceof Error) {
               return next(new AppError(400, err.message)); // ← sends 400 with real message
             }
      next(err);
    }
  }


@httpDelete('/delete/multiple')
  public async deleteMultipleDCForStockTransfer(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        ControllerLogger.logError('Stock Transfer Delivery Challan multiple deletion', new AppError(400, 'An array of DC for Stock Transfer IDs is required'), req, res);
        return next(new AppError(400, 'An array of DC for Stock Transfer IDs is required'));
      }
      const result = await this.stockTransferDeliveryChallanService.deleteMultipleDCForStockTransfer(ids);
      const deletedNos = result.success.map(s => s.No || s.id).join(', ');
      ControllerLogger.logSuccess('Stock Transfer Delivery Challan multiple deletion', `${ids.length} records`, req, res);

      // Send notification for multiple stock transfer delivery challan deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Multiple Stock Transfer Delivery Challans deleted successfully: ${ids.length} records`,
      //     userId
      //   );
      // }


      // Activity log
        const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.STOCK_TRANSFER_DELIVERY_CHALLAN,
        entityName: 'Stock Trasnfer Delivery Challan',
        description: `${userName} has bulk deleted ${result.success.length} Stock Trasnfer Delivery Challan(s): ${deletedNos}`,
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
      logger.error('Error deleting multiple DC for Stock Transfer', { error });
      ControllerLogger.logError('Stock Transfer Delivery Challan multiple deletion', error, req, res);
      next(error);
    }
  }
  @httpGet('/update/:id')
  public async getByIdforupdate(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const challan: STDeliveryChallanUpdateFormDto | null = await this.stockTransferDeliveryChallanService.getByIdChallanforUpdate(id);
      if (!challan) {
        ControllerLogger.logError('Stock Transfer Delivery Challan retrieval for update', new AppError(404, 'Stock transfer delivery challan not found'), req, res);
        return next(new AppError(404, 'Stock transfer delivery challan not found'));
      }

      ControllerLogger.logView('Stock Transfer Delivery Challan (for update)', id, req, res);
      res.status(200).json({
        status: 'success',
        data: challan,
      });
    } catch (err) {
      logger.error('Error fetching challan by ID', { error: err });
      ControllerLogger.logError('Stock Transfer Delivery Challan retrieval for update', err, req, res);
      next(err);
    }
  }

  @httpGet('/view/:id')
  public async getByIdforview(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const challan: STDeliveryChallanViewDto | null = await this.stockTransferDeliveryChallanService.getByIdChallanforView(id);
      if (!challan) {
        ControllerLogger.logError('Stock Transfer Delivery Challan view', new AppError(404, 'Stock transfer delivery challan not found'), req, res);
        return next(new AppError(404, 'Stock transfer delivery challan not found'));
      }

      ControllerLogger.logView('Stock Transfer Delivery Challan (for view)', id, req, res);
      res.status(200).json({
        status: 'success',
        data: challan,
      });
    } catch (err) {
      logger.error('Error fetching challan by ID', { error: err });
      ControllerLogger.logError('Stock Transfer Delivery Challan view', err, req, res);
      next(err);
    }
  }


  /**
   * GET export/excel - every Stock Transfer Delivery Challan the user can see in the list, as an .xlsx.
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
      entityName: 'Stock Transfer Delivery Challan',
      definition: STOCK_TRANSFER_DELIVERY_CHALLAN_EXPORT,
      list: { documentType: FilterDocumentType.DC_TYPE_STOCK_TRANSFER, searchFields: ['challanNo'] },
      fetchList: (queryOptions, userId) => this.stockTransferDeliveryChallanService.getAll(queryOptions, userId),
    });
  }

  @httpGet('/')
  public async getAll(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { page, limit, search, sort } = req.query;
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        searchFields: ['challanNo'], // adjust based on your searchable fields
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      const userId = res.locals.user.id;

      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.DC_TYPE_STOCK_TRANSFER);
      const challans: STDeliveryChallanListResponseDto = await this.stockTransferDeliveryChallanService.getAll(queryOptions, userId);

      ControllerLogger.logList('Stock Transfer Delivery Challan', req, res);

      // Send notification for stock transfer delivery challan list access
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Stock Transfer Delivery Challan records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: 'success',
        ...challans,
      });
    } catch (err) {
      logger.error('Error fetching all challans', { error: err });
      ControllerLogger.logError('Stock Transfer Delivery Challan list retrieval', err, req, res);
      next(err);
    }
  }

  @httpPatch('/:id', captureUser, uploadAttachments)
  public async update(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const updatedBy = res.locals.updatedBy;
      
      // Use helper function to handle file URL extraction
      setAttachmentUrls(req.body, req.files as any[]);
      const updated = await this.stockTransferDeliveryChallanService.update(id, {
        ...req.body,
        updatedBy,
      });

      if (!updated) {
        ControllerLogger.logError('Stock Transfer Delivery Challan update', new AppError(404, 'Challan not found or could not be updated'), req, res);
        return next(new AppError(404, 'Challan not found or could not be updated'));
      }

      ControllerLogger.logSuccess('Stock Transfer Delivery Challan updated', id, req, res);

      // Send notification for stock transfer delivery challan update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Stock Transfer Delivery Challan updated successfully`,
          userId
        );
      }

       // Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.STOCK_TRANSFER_DELIVERY_CHALLAN,
        entityName: 'Stock Trasnfer Delivery Challan',
        entityId: id,
        description: `${userName} has updated Stock Trasnfer Delivery Challan ${updated.challanNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});      

      res.status(200).json({
        status: 'success',
        message: 'Stock transfer delivery challan updated successfully',
      });
    } catch (err) {
      logger.error('Error updating challan', { error: err });
      ControllerLogger.logError('Stock Transfer Delivery Challan update', err, req, res);
      next(err);
    }
  }

  @httpDelete('/')
  public async delete(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const id = req.query.id as string;

      const deleted = await this.stockTransferDeliveryChallanService.delete(id);
      if (!deleted) {
        ControllerLogger.logError('Stock Transfer Delivery Challan deletion', new AppError(404, 'Challan not found or could not be deleted'), req, res);
        return next(new AppError(404, 'Challan not found or could not be deleted'));
      }

      ControllerLogger.logSuccess('Stock Transfer Delivery Challan deleted', id, req, res);

      // Send notification for stock transfer delivery challan deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Stock Transfer Delivery Challan deleted successfully`,
      //     userId
      //   );
      // }


       // Activity log
       const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.STOCK_TRANSFER_DELIVERY_CHALLAN,
        entityName: 'Stock Trasnfer Delivery Challan',
        entityId: id,
        description: `${userName} has deleted Stock Trasnfer Delivery Challan ${deleted.No || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});


      res.status(200).json({
        status: 'success',
        message: 'Stock transfer delivery challan deleted successfully',
      });
    } catch (err) {
      logger.error('Error deleting challan', { error: err });
      ControllerLogger.logError('Stock Transfer Delivery Challan deletion', err, req, res);
      next(err);
    }
  }
}


  // @httpGet('/:id')
  // public async getById(
  //   @requestParam('id') id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const challan = await this.stockTransferDeliveryChallanService.getById(id);
  //     if (!challan) {
  //       ControllerLogger.logError('Stock Transfer Delivery Challan view', new AppError(404, 'Stock transfer delivery challan not found'), req, res);
  //       return next(new AppError(404, 'Stock transfer delivery challan not found'));
  //     }

  //     ControllerLogger.logView('Stock Transfer Delivery Challan', id, req, res);

  //     // Send notification for stock transfer delivery challan view
  //     // const userId = res.locals.user?.id;
  //     // if (userId) {
  //     //   await this.notificationService.createNoti(
  //     //     `Stock Transfer Delivery Challan viewed: ${id}`,
  //     //     userId
  //     //   );
  //     // }

  //     res.status(200).json({
  //       status: 'success',
  //       data: challan,
  //     });
  //   } catch (err) {
  //     logger.error('Error fetching challan by ID', { error: err });
  //     ControllerLogger.logError('Stock Transfer Delivery Challan view', err, req, res);
  //     next(err);
  //   }
  // }

