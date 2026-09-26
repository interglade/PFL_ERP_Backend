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
} from 'inversify-express-utils';
import { inject } from 'inversify';
import { TYPES } from '../../../types';

import { Request, Response, NextFunction } from 'express';
import AppError from '../../../utils/appError';
import { ControllerLogger } from '../../../utils/controllerLogger';

import { PaginationOptions } from '../../../utils/pagination';


import { uploadAttachments } from '../../../middleware/upload.middleware';
import { setAttachmentUrls } from '../../../utils/fileUploadHelper';
import { captureUser, deserializeUser, requireUser } from '../../../middleware/deserializeUser';
import { CustomerDeliveryChallanService } from '../service/customerDeliveryChallan.service';
import { NotificationService } from '../../../notification/service/notification.service';
import { UserActivityLogService } from '../../../employeeActivity/service/userActivityLog.service';
import { CreateCustomerDeliveryChallanDto, CustomerDeliveryChallanListResponseDto, CustomerDeliveryChallanUpdateFormDto, CustomerDeliveryChallanViewDto } from '../dto/customerDeliveryChallan.dto';
import { ActivityAction, ActivityModule } from '../../../employeeActivity/entity/userActivityLog.entity';
import { DocumentExportService } from '../../../excel/export/documentExport.service';
import { CUSTOMER_DELIVERY_CHALLAN_EXPORT } from '../excel/customerDeliveryChallan.export';
import { applyDocumentListFilters } from '../../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../../approvalFlow/entity/docuemnt.entity';



@controller('/customer-delivery-challan', deserializeUser, requireUser)
export class CustomerDeliveryChallanController {
  constructor(
    @inject(TYPES.CustomerDeliveryChallanService)
    private customerDeliveryChallanService: CustomerDeliveryChallanService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService)
    private activityLogService: UserActivityLogService,
    @inject(TYPES.DocumentExportService)
    private readonly documentExportService: DocumentExportService,
  ) {}

  @httpPost('/', uploadAttachments)
  public async createChallan(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      // Use helper function to handle file URL extraction
      setAttachmentUrls(req.body, req.files as any[]);

      req.body.createdBy = res.locals.user.id;

      const challan = await this.customerDeliveryChallanService.create(
        req.body as CreateCustomerDeliveryChallanDto & Record<string, any>,
        req.body.createdBy
      );
      
      if (!challan) {
        ControllerLogger.logOperationFailed('Create', 'Customer Delivery Challan', 'Creation failed', req, res);
        return next(
          new AppError(400, 'Customer delivery challan could not be created'),
        );
      }

      // 🔔 Send notification for customer delivery challan creation
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Customer delivery challan "${challan.challanNo}" created successfully`,
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
        action: ActivityAction.CREATE,
        module: ActivityModule.CUSTOMER_DELIVERY_CHALLAN,
        entityName: 'CustomerDeliveryChallan',
        entityId: challan.id,
        description: `${userName} has created Customer Delivery Challan "${challan.challanNo || challan.id}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 201,
      }).catch(() => {});

      ControllerLogger.logSuccess('Customer Delivery Challan created', challan.id, req, res);
      res.status(201).json({
        status: 'success',
        message: 'Customer delivery challan created successfully',
        data: challan,
      });
    } catch (err) {
      ControllerLogger.logError('Create Customer Delivery Challan', err, req, res);
      next(err);
    }
  }

  @httpGet('/update/:id')
  public async getChallanById(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const challan: { data: CustomerDeliveryChallanUpdateFormDto } | null = await this.customerDeliveryChallanService.getByIdCustomerDeliveryChallanforUpdate(id);

      if (!challan) {
        ControllerLogger.logNotFound('Customer Delivery Challan', id, req, res);
        return next(new AppError(404, 'Customer delivery challan not found'));
      }

      // 🔔 Send notification for customer delivery challan update view
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     const challanNo = challan.data?.challanNo || 'Challan';
      //     await this.notificationService.createNoti(
      //       `customer delivery challan "${challanNo}" for editing`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Customer delivery challan update view notification error:', notifError);
      // }

      ControllerLogger.logView('Customer Delivery Challan (for update)', id, req, res);
      res.status(200).json({
        status: 'success',
        data: challan.data,
      });
    } catch (err) {
      ControllerLogger.logError('Get Customer Delivery Challan for update', err, req, res);

       if (err instanceof Error) {
         return next(new AppError(400, err.message)); // ← sends 400 with real message
       }

      next(err);
    }
  }

   @httpGet('/view/:id')
  public async getChallanByIdforView(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const challan: { data: CustomerDeliveryChallanViewDto } | null = await this.customerDeliveryChallanService.getByIdCustomerDeliveryChallanForView(id);

      if (!challan) {
        ControllerLogger.logNotFound('Customer Delivery Challan', id, req, res);
        return next(new AppError(404, 'Customer delivery challan not found'));
      }

      // 🔔 Send notification for customer delivery challan view
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     const challanNo = challan.data?.challanNo || 'Challan';
      //     await this.notificationService.createNoti(
      //       `Viewed customer delivery challan "${challanNo}" details`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Customer delivery challan view notification error:', notifError);
      // }

      ControllerLogger.logView('Customer Delivery Challan', id, req, res);
      res.status(200).json({
        status: 'success',
        data: challan.data,
      });
    } catch (err) {
      ControllerLogger.logError('Get Customer Delivery Challan for view', err, req, res);
      next(err);
    }
  }


  /**
   * GET export/excel - every Customer Delivery Challan the user can see in the list, as an .xlsx.
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
      entityName: 'Customer Delivery Challan',
      definition: CUSTOMER_DELIVERY_CHALLAN_EXPORT,
      list: { documentType: FilterDocumentType.DC_TYPE_CUSTOMER },
      fetchList: (queryOptions, userId) => this.customerDeliveryChallanService.getAllCustomerDeliveryChallans(queryOptions, userId),
    });
  }

  @httpGet('/')
  public async getAllChallans(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { page, limit, search, sort } = req.query;
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
       // searchFields: ['deliveryChallanId'],
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      const userId = res.locals.user.id;

      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.DC_TYPE_CUSTOMER);
      const challans: CustomerDeliveryChallanListResponseDto =
        await this.customerDeliveryChallanService.getAllCustomerDeliveryChallans(
          queryOptions,
          userId
        );

      if (!challans || challans.data.length === 0) {
        ControllerLogger.logOperationFailed('Get All', 'Customer Delivery Challans', 'No records found', req, res);
        return next(new AppError(404, 'No customer delivery challans found'));
      }
    
      // 🔔 Send notification for get all customer delivery challans
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Retrieved ${challans.meta.total} customer delivery challans`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Get all customer delivery challans notification error:', notifError);
      // }
    
      ControllerLogger.logGetAllRecords('Customer Delivery Challans', req, res);
      res.status(200).json({
        status: 'success',
          data: challans.data,
      allRecords: challans.meta.total,
      totalPages: challans.meta.pages,
      page: challans.meta.page,
    })}
      
    catch (err) {
      ControllerLogger.logError('Get All Customer Delivery Challans', err, req, res);
      next(err);
    }
  }

  @httpPatch('/:id', captureUser, uploadAttachments)
  public async updateChallan(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const updatedBy = res.locals.updatedBy;

      // Use helper function to handle file URL extraction
      setAttachmentUrls(req.body, req.files as any[]);
      const challan = await this.customerDeliveryChallanService.update(id, {
        ...req.body,
        updatedBy,
      });

      if (!challan) {
        ControllerLogger.logNotFound('Customer Delivery Challan', id, req, res);
        return next(
          new AppError(404, 'Challan not found or could not be updated'),
        );
      }

      // 🔔 Send notification for customer delivery challan update
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Customer delivery challan with ID ${challan.challanNo} updated successfully`,
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
        module: ActivityModule.CUSTOMER_DELIVERY_CHALLAN,
        entityName: 'CustomerDeliveryChallan',
        entityId: id,
        description: `${userName} has updated Customer Delivery Challan "${challan.challanNo || id}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      ControllerLogger.logSuccess('Customer Delivery Challan updated', id, req, res);
      res.status(200).json({
        status: 'success',
        message: 'Customer delivery challan updated successfully',
      });
    } catch (err) {
      ControllerLogger.logError('Update Customer Delivery Challan', err, req, res);
      next(err);
    }
  }

  @httpDelete('/')
  public async deleteChallan(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const id = req.query.id as string;

      const result = await this.customerDeliveryChallanService.delete(id);

      if (!result) {
        ControllerLogger.logNotFound('Customer Delivery Challan', id, req, res);
        return next(
          new AppError(404, 'Challan not found or could not be deleted'),
        );
      }

      // 📝 Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.CUSTOMER_DELIVERY_CHALLAN,
        entityName: 'CustomerDeliveryChallan',
        entityId: id,
        description: `${userName} has deleted Customer Delivery Challan "${result.challanNo || id}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      ControllerLogger.logSuccess('Customer Delivery Challan deleted', id, req, res);
      res.status(200).json({
        status: 'success',
        message: 'Customer delivery challan deleted successfully',
      });
    } catch (err) {
      ControllerLogger.logError('Delete Customer Delivery Challan', err, req, res);
      next(err);
    }
  }
   //TODO:Delete Multiple
  @httpDelete('/delete/multiple')
    public async deleteMultipleCustomerDC(
      @request() req: Request,
      @response() res: Response,
      @next() next: NextFunction,
    ) {
      try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
          return next(new AppError(400, 'An array of AQR IDs is required'));
        }
        const result = await this.customerDeliveryChallanService.deleteMultipleCustomerDC(ids);
        const deletedNos = result.success.map(s => s.No || s.id).join(', ');

        // 📝 Activity log
        const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
        this.activityLogService.logActivity({
          userId: res.locals.user.id,
          userName,
          action: ActivityAction.DELETE,
          module: ActivityModule.CUSTOMER_DELIVERY_CHALLAN,
          entityName: 'CustomerDeliveryChallan',
          description: `${userName} has bulk deleted ${result.success.length} Customer Delivery Challan(s): ${deletedNos}`,
          metadata: { ids, success: result.success, failed: result.failed },
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
         ControllerLogger.logError('Customer DC deleteed', error, req, res);
        next(error);
      }
    }
  
  
  






}


  // @httpGet('/check-return-status/:id')
  // public async checkReturnStatus(
  //   @requestParam('id') id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const status = await this.customerDeliveryChallanService.checkReturnByCustomerStatus(id);

  //     if (!status) {
  //       ControllerLogger.logNotFound('Delivery Challan', id, req, res);
  //       return next(new AppError(404, 'Delivery challan not found'));
  //     }

  //     ControllerLogger.logView('Delivery Challan return status', id, req, res);
  //     res.status(200).json({
  //       status: 'success',
  //       data: status,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Check Delivery Challan return status', err, req, res);
  //     next(err);
  //   }
  // }


  // @httpGet('/net-amounts/:id')
  // public async getChallanWithNetAmounts(
  //   @requestParam('id') id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const challan = await this.customerDeliveryChallanService.getDeliveryChallanWithNetAmounts(id);

  //     if (!challan) {
  //       ControllerLogger.logNotFound('Delivery Challan', id, req, res);
  //       return next(new AppError(404, 'Delivery challan not found'));
  //     }

  //     // 🔔 Send notification for delivery challan net amounts view
  //     // try {
  //     //   const userId = res.locals.user?.id;
  //     //   if (userId) {
  //     //     await this.notificationService.createNoti(
  //     //       `Viewed delivery challan with ID ${id} net amounts`,
  //     //       userId
  //     //     );
  //     //   }
  //     // } catch (notifError) {
  //     //   console.log('Delivery challan net amounts view notification error:', notifError);
  //     // }

  //     ControllerLogger.logView('Delivery Challan with net amounts', id, req, res);
  //     res.status(200).json({
  //       status: 'success',
  //       data: challan,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get Delivery Challan with net amounts', err, req, res);
  //     next(err);
  //   }
  // }


  // @httpPost('/update-returns/:id')
  // public async updateChallanWithReturns(
  //   @requestParam('id') id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     await this.customerDeliveryChallanService.updateDeliveryChallanProductsWithReturns(id);

  //     // 🔔 Send notification for delivery challan returns update
  //     try {
  //       const userId = res.locals.user?.id;
  //       if (userId) {
  //         await this.notificationService.createNoti(
  //           `Delivery challan with ID ${id} updated with return data`,
  //           userId
  //         );
  //       }
  //     } catch (notifError) {
  //     }

  //     ControllerLogger.logSuccess('Delivery Challan updated with returns', id, req, res);
  //     res.status(200).json({
  //       status: 'success',
  //       message: 'Delivery challan updated with return data successfully',
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Update Delivery Challan with returns', err, req, res);
  //     next(err);
  //   }
  // }

