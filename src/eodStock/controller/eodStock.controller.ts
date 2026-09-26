import { inject } from 'inversify';
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
} from 'inversify-express-utils';
import { TYPES } from '../../types';

import { NextFunction, Request, Response } from 'express';
import AppError from '../../utils/appError';

import { ControllerLogger } from '../../utils/controllerLogger';
import {
  captureUser,
  deserializeUser,
  requireUser,
} from '../../middleware/deserializeUser';
import { PaginationOptions } from '../../utils/pagination';
import {
  CreateEodStockDto,
  UpdateEodStockDto,
  EodStockDetailDto,
  EodStockViewDto,
  EodStockUpdateFormDto,
  EodStockListResponseDto,
  BulkDeleteEodStockDto,
  BulkDeleteEodStockResultDto,
} from '../dto/eodStock.dto';
import { UserActivityLogService } from '../../employeeActivity/service/userActivityLog.service';
import { EodStockService } from '../service/eodStock.service';
import { NotificationService } from '../../notification/service/notification.service';
import { ActivityAction, ActivityModule } from '../../employeeActivity/entity/userActivityLog.entity';


@controller('/eodStock', deserializeUser, requireUser)
export class EodStockController {
  constructor(
    @inject(TYPES.EodStockService)
    private eodStockService: EodStockService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService) 
    private activityLogService: UserActivityLogService,
  ) {}

  @httpPost('/')
  public async createEodStockReport(
    @request() req: Request<{}, {}, CreateEodStockDto & Record<string, any>>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const stockData: CreateEodStockDto & Record<string, any> = req.body;
      stockData.submittedBy = res.locals.user.id;

      const stock = await this.eodStockService.createEodStock(stockData);
      
      if (!stock) {
        ControllerLogger.logOperationFailed('Create', 'EOD Stock', 'Creation failed', req, res);
        return next(new AppError(400, 'stock could not be created'));
      }

      await this.notificationService.createNoti(
        `New EOD Stock created`,
        res.locals.user.id,
      );
      
     
      ControllerLogger.logSuccess('EOD Stock created', stock.id, req, res);
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
       // Single activity log
          this.activityLogService.logActivity({
            userId: res.locals.user.id,
            userName,
            action: ActivityAction.CREATE,
            module: ActivityModule.EOD_STOCK,
            entityName: 'EOD_STOCK',
            entityId: stock.id,
            description: `${userName} has created EOD_STOCK ${stock.eodNo || stock.id}`,
            ipAddress: req.ip || '',
            userAgent: req.get('user-agent'),
            endpoint: req.originalUrl,
            httpMethod: req.method,
            statusCode: 201,
          }).catch(() => {});
     
      res.status(201).json({
        status: 'success',
        message: 'Eod Stock created successfully',
        data: stock.id,
      });
    } catch (err) {
      ControllerLogger.logError('Create EOD Stock', err, req, res);
      if (err instanceof Error) {
               return next(new AppError(400, err.message)); // ← sends 400 with real message
             }
      next(err);
    }
  }

  @httpGet('/view/:id')
  public async getEodStockReportForView(
    @requestParam('id') docId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const stock: EodStockViewDto | null = await this.eodStockService.getEodStockByIdForView(docId);

      if (!stock) {
        ControllerLogger.logNotFound('EOD Stock', docId, req, res);
        return next(new AppError(404, 'Stock report not found'));
      }

      // await this.notificationService.createNoti(
      //   `EOD stock report accessed: ${stock.companyName || 'Unnamed Report'}`,
      //   res.locals.user.id,
      // );

      ControllerLogger.logView('EOD Stock', docId, req, res);
      return res.status(200).json({
        status: 'success',
        message: 'EOD stock report fetched successfully',
        data: stock,
      });
    } catch (err) {
      ControllerLogger.logError('Get EOD Stock for view', err, req, res);
      return next(err);
    }
  }

  @httpGet('/update/:id')
  public async getEodStockReportForupdate(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const stock = await this.eodStockService.getEodStockByIdForUpdate(id);

      if (!stock) {
        ControllerLogger.logNotFound('EOD Stock', id, req, res);
        return next(new AppError(404, 'Stock report not found'));
      }

      // await this.notificationService.createNoti(
      //   `EOD stock report accessed: ${stock.companyName || 'Unnamed Report'}`,
      //   res.locals.user.id,
      // );

      ControllerLogger.logView('EOD Stock (for update)', id, req, res);
      return res.status(200).json({
        status: 'success',
        message: 'EOD stock report fetched successfully',
        data: stock,
      });
    } catch (err) {
      ControllerLogger.logError('Get EOD Stock for update', err, req, res);
      return next(err);
    }
  }



  @httpGet('/')
  public async getAllEodStockReports(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const userId = res.locals.user.id;
      
      if (!userId) {
        ControllerLogger.logValidationError('Get All EOD Stocks', 'User ID is required', req, res);
        return res.status(400).json({
          status: 'error',
          message: 'User ID is required',
        });
      }

      const { page, limit, search, sort } = req.query;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        searchFields: ['eodStockId'],
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      const stocks = await this.eodStockService.getAllEodStocks(queryOptions, userId);

      if (!stocks.data || stocks.data.length === 0) {
        ControllerLogger.logOperationFailed('Get All', 'EOD Stocks', 'No records found', req, res);
        return res.status(404).json({
          status: 'error',
          message: 'No EOD stock reports found',
        });
      }

      // 🔔 Send notification for get all EOD stocks
      // try {
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Retrieved ${stocks.meta.total} EOD stock reports`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Get all EOD stocks notification error:', notifError);
      // }

      ControllerLogger.logGetAllRecords('EOD Stocks', req, res);
      return res.status(200).json({
        status: 'success',
        message: 'All EOD stock reports fetched successfully',
        data: stocks.data,
        allRecords: stocks.meta.total,
        totalPages: stocks.meta.pages,
        page: stocks.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Get All EOD Stocks', err, req, res);
      return next(err);
    }
  }

  @httpPatch('/:id', captureUser)
  async updateEodStock(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const stockData = req.body;
      const updatedBy = res.locals.updatedBy;

      const updatedStock = await this.eodStockService.updateEodStock(
        id,
        stockData,
        updatedBy,
      );
      
      if (!updatedStock) {
        ControllerLogger.logNotFound('EOD Stock', id, req, res);
        return next(
          new AppError(404, 'Stock report not found or could not be updated'),
        );
      }

      // 🔔 Send notification for EOD stock update
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `EOD stock report updated successfully`,
            userId
          );
        }
      } catch (notifError) {
      }
const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
       // Activity log
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.EOD_STOCK,
        entityName: 'EOD_STOCK',
        entityId: id,
        description: `${userName} has updated EOD_STOCK ${updatedStock.eodNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      ControllerLogger.logSuccess('EOD Stock updated', id, req, res);
      res.status(200).json({
        status: 'success',
        message: 'Stock report updated successfully',
        data: updatedStock,
      });
    } catch (err) {
      ControllerLogger.logError('Update EOD Stock', err, req, res);
      next(err);
    }
  }

  @httpGet('/recyclebin')
  public async getAllRecycleBinEodStockReports(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const userId = res.locals.user.id;
      
      if (!userId) {
        ControllerLogger.logValidationError('Get Recycle Bin EOD Stocks', 'User ID is required', req, res);
        return res.status(400).json({
          status: 'error',
          message: 'User ID is required',
        });
      }

      const { page, limit, search, sort } = req.query;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        searchFields: ['eodStockId'],
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      const stocks = await this.eodStockService.getAllRecycleBinEodStocks(queryOptions, userId);

      if (!stocks.data || stocks.data.length === 0) {
        ControllerLogger.logOperationFailed('Get All', 'EOD Stocks (Recycle Bin)', 'No records found', req, res);
        return res.status(404).json({
          status: 'error',
          message: 'No EOD stock reports found',
        });
      }

      ControllerLogger.logGetAllRecords('EOD Stocks (Recycle Bin)', req, res);
      return res.status(200).json({
        status: 'success',
        message: 'All EOD stock reports fetched successfully',
        data: stocks.data,
        allRecords: stocks.meta.total,
        totalPages: stocks.meta.pages,
        page: stocks.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Get Recycle Bin EOD Stocks', err, req, res);
      return next(err);
    }
  }

  @httpDelete('/:id')
  public async deleteEodStock(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const result = await this.eodStockService.deleteEodStock(id);

      if (!result) {
        ControllerLogger.logNotFound('EOD Stock', id, req, res);
        return next(
          new AppError(
            404,
            'EOD Stock report not found or could not be deleted',
          ),
        );
      }

      // 🔔 Send notification for EOD stock deletion
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `EOD stock report deleted successfully`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('EOD stock deletion notification error:', notifError);
      // }

      ControllerLogger.logSuccess('EOD Stock deleted', id, req, res);
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      // Activity log
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.EOD_STOCK,
        entityName: 'EOD_STOCK',
        entityId: id,
        description: `${userName} has deleted EOD_STOCK ${result.No||id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      res.status(204).send();
    } catch (err) {
      ControllerLogger.logError('Delete EOD Stock', err, req, res);
      next(err);
    }
  }
   //TODO:Delete Multiple
@httpDelete('/delete/multiple')
  public async deleteMultipleEodStock(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return next(new AppError(400, 'An array of EODStock IDs is required'));
      }
      const result = await this.eodStockService.deleteMultipleEodStock(ids);
      const deletedNos = result.success.map(s => s.No || s.id).join(', ');

      //const deletedNos = result.success.map(s => s.eodNo || s.id).join(', ');
      // 🔔 Send notification for bulk AQR deletion
      // try {
      //   const userId = res.locals.user.id;
      //   await this.notificationService.createNoti(
      //     `EodStock deleted successfully`,
      //     userId
      //   );
      // } catch (notifError) {
      //   console.log('Notification error:', notifError);
      // }

const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      // Activity log
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.EOD_STOCK,
        entityName: 'EOD_STOCK',
        description: `${userName} has bulk deleted ${result.success.length} EOD_STOCK(s): ${deletedNos}`,
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
       ControllerLogger.logError('EODStock deleteed', error, req, res);
      next(error);
    }
  }

}


  // @httpGet('/:id')
  // public async getEodStockReport(
  //   @requestParam('id') stockId: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const stock = await this.eodStockService.getEodStockById(stockId);

  //     if (!stock) {
  //       ControllerLogger.logNotFound('EOD Stock', stockId, req, res);
  //       return next(new AppError(404, 'Stock report not found'));
  //     }

  //     // await this.notificationService.createNoti(
  //     //   `EOD stock report accessed: ${stock.companyName || 'Unnamed Report'}`,
  //     //   res.locals.user.id,
  //     // );

  //     ControllerLogger.logView('EOD Stock', stockId, req, res);
  //     return res.status(200).json({
  //       status: 'success',
  //       message: 'EOD stock report fetched successfully',
  //       data: stock,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get EOD Stock by ID', err, req, res);
  //     return next(err);
  //   }
  // }

