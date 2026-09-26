import { Request,  Response } from 'express';
import { controller, httpGet, httpPost, httpDelete, requestParam, requestBody, response, next, request, httpPatch } from 'inversify-express-utils';
import { inject } from 'inversify';

import { TPVoucher } from '../entity/transportPaymentvoucher.entity';
import { TYPES } from '../../../types';
import { NextFunction } from 'express';
import AppError from '../../../utils/appError'; // Custom error handling middleware

import { captureUser, deserializeUser, requireUser } from '../../../middleware/deserializeUser';


import logger from '../../../utils/logger';

import { PaginationOptions } from '../../../utils/pagination';
import { ControllerLogger } from '../../../utils/controllerLogger';
import { upload, uploadAttachments } from '../../../middleware/upload.middleware';
import { setAttachmentUrls } from '../../../utils/fileUploadHelper';


import { UserActivityLogService } from '../../../employeeActivity/service/userActivityLog.service';
import { TPVoucherService } from '../service/transportPaymentV.service';
import { NotificationService } from '../../../notification/service/notification.service';
import { CreateTPVoucherDto } from '../dto/transportPaymentVoucher.dto';
import { ActivityAction, ActivityModule } from '../../../employeeActivity/entity/userActivityLog.entity';
import { DocumentExportService } from '../../../excel/export/documentExport.service';
import { TRANSPORT_PAYMENT_VOUCHER_EXPORT } from '../excel/transportPaymentVoucher.export';
import { applyDocumentListFilters } from '../../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../../approvalFlow/entity/docuemnt.entity';

@controller('/tpvoucher', deserializeUser, requireUser)
export class TPVoucherController {
  constructor(
    @inject(TYPES.TPVoucherService) private tpVoucherService: TPVoucherService,
    @inject(TYPES.NotificationService) private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService) private activityLogService: UserActivityLogService,
    @inject(TYPES.DocumentExportService)
    private readonly documentExportService: DocumentExportService,
    
  ) {}

  @httpPost('/', uploadAttachments)
  public async createTPVoucher(
    @requestBody() tpVoucherData:CreateTPVoucherDto ,
    @request() req:Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      console.log("tpvoucherdata......",tpVoucherData);
      logger.info('Received request to create TPVoucher');
      
      // Use helper function to handle file URL extraction
      setAttachmentUrls(tpVoucherData, req.files as any[]);
    
    if (tpVoucherData.kyc === true || (tpVoucherData.kyc as any) === 'true')
    {
      tpVoucherData.kyc=true;
    }
     
      tpVoucherData.requestedBy = res.locals.user.id;
      tpVoucherData.requestingDepartment = res.locals.user.selectDepartment;
      const createdVoucher = await this.tpVoucherService.createTPVoucher(tpVoucherData);
      if (!createdVoucher) {
        logger.error('TPVoucher creation failed');
        ControllerLogger.logError('Transport Payment Voucher creation', new AppError(400, "TPVoucher could not be created"), req, res);
        return next(new AppError(400, "TPVoucher could not be created"));
      }
      logger.info('TPVoucher created successfully', { voucherId: createdVoucher.id });
      ControllerLogger.logSuccess('Transport Payment Voucher created', createdVoucher.id, req, res);

      // Send notification for transport payment voucher creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Transport Payment Voucher created successfully`,
          userId
        );
      }
const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      // Single activity log
          this.activityLogService.logActivity({
            userId: res.locals.user.id,
            userName,
            action: ActivityAction.CREATE,
            module: ActivityModule.TRANSPORT_PAYMENT,
            entityName: 'Transport Payment Voucher',
            entityId: createdVoucher.id,
            description: `${userName} has created Transport Payment Voucher${createdVoucher.voucherNo || createdVoucher.id}`,
            ipAddress: req.ip || '',
            userAgent: req.get('user-agent'),
            endpoint: req.originalUrl,
            httpMethod: req.method,
            statusCode: 201,
          }).catch(() => {});

          
      res.status(201).json({
        status: 'success',
        message: 'Transport Payment Voucher created successfully',
        //data: createdVoucher,
      });
    } catch (error) {
      logger.error('Error creating TPVoucher', { error });
      ControllerLogger.logError('Transport Payment Voucher creation', error, req, res);
      if (error instanceof Error) {
               return next(new AppError(400, error.message)); // ← sends 400 with real message
             }
      next(error);
    }
  }

  /**
   * GET export/excel - every Transport Payment Voucher the user can see in the list, as an .xlsx.
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
      entityName: 'Transport Payment Voucher',
      definition: TRANSPORT_PAYMENT_VOUCHER_EXPORT,
      list: { documentType: FilterDocumentType.TRANSPORT_PAYMENT_VOUCHER, searchFields: ['"voucher.voucherNo",'] },
      fetchList: (queryOptions, userId) => this.tpVoucherService.getAllTPVouchers(queryOptions, userId),
    });
  }

  @httpGet('/')
  public async getAllTPVouchers(
    @request() req:Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info('Received request to get all TPVouchers');
      const userId = res.locals.user.id; // Get the user ID from the request context
      const { page, limit, search, sort,voucherId} = req.query
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
        limit: limit ? Number(limit) : undefined,
              searchFields: ['"voucher.voucherNo",'],
              filters: {},
              sort: sort as string || undefined, // Adjust this line to match your sorting requirements
              search: search as string|| '',
            };
      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.TRANSPORT_PAYMENT_VOUCHER);
      const vouchers = await this.tpVoucherService.getAllTPVouchers(queryOptions, userId);
      // if (!vouchers.length) {
      //   return next(new AppError(404, 'No Transport Payment Vouchers found'));
      // }
      logger.info('Fetched all Transport Payment Vouchers successfully');
      ControllerLogger.logList('Transport Payment Voucher', req, res);

      // Send notification for transport payment voucher list access
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Transport Payment Voucher records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: 'success',
        data: vouchers.data,
        allRecords: vouchers.meta.total,
        totalPages: vouchers.meta.pages,
        page: vouchers.meta.page,
      });
    } catch (error) {
      logger.error('Error fetching all TPVouchers', { error });
      ControllerLogger.logError('Transport Payment Voucher list retrieval', error, req, res);
      next(error);
    }
  }

  @httpGet('/recycle-bin')
  public async getAllRecycleBinTPVouchers(
    @request() req:Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info('Received request to get all TPVouchers');
      const userId = res.locals.user.id; // Get the user ID from the request context
      const { page, limit, search, sort,voucherId} = req.query
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
        limit: limit ? Number(limit) : undefined,
              searchFields: ['"voucher.voucherNo",'],
              filters: {},
              sort: sort as string || undefined, // Adjust this line to match your sorting requirements
              search: search as string|| '',
            };
      const vouchers = await this.tpVoucherService.getAllRecycleBinTPVouchers(queryOptions, userId);
      // if (!vouchers.length) {
      //   return next(new AppError(404, 'No Transport Payment Vouchers found'));
      // }
      logger.info('Fetched all Transport Payment Vouchers successfully');
      ControllerLogger.logList('Transport Payment Voucher Recycle Bin', req, res);
      res.status(200).json({
        status: 'success',
        data: vouchers.data,
        allRecords: vouchers.meta.total,
        totalPages: vouchers.meta.pages,
        page: vouchers.meta.page,
      });
    } catch (error) {
      logger.error('Error fetching all TPVouchers', { error });
      ControllerLogger.logError('Transport Payment Voucher recycle bin retrieval', error, req, res);
      next(error);
    }
  }


  @httpGet('/:id/view')
  public async getTPVoucherByIdForView(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info(`Received request to get TPVoucher with id: ${id}`);
      const voucher = await this.tpVoucherService.getTPVoucherByIdForView(id);
      if (!voucher) {
        logger.warn(`TPVoucher with id ${id} not found`);
        ControllerLogger.logError('Transport Payment Voucher view', new AppError(404, 'Transport Payment Voucher not found'), req, res);
        return next(new AppError(404, 'Transport Payment Voucher not found'));
      }
      logger.info(`Fetched Transport Payment Voucher with ID: ${id} successfully`);
      ControllerLogger.logView('Transport Payment Voucher (for view)', id, req, res);
      res.status(200).json({
        status: 'success',
        data: voucher,
      });
    } catch (error) {
      logger.error('Error fetching TPVoucher by id', { error, id });
      ControllerLogger.logError('Transport Payment Voucher view', error, req, res);
      next(error);
    }
  }

  @httpGet('/:id/update')
  public async getTPVoucherByIdForUpdate(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info(`Received request to get TPVoucher with id: ${id}`);
      const voucher = await this.tpVoucherService.getTPVoucherByIdForUpdate(id);
      if (!voucher) {
        logger.warn(`TPVoucher with id ${id} not found`);
        ControllerLogger.logError('Transport Payment Voucher retrieval for update', new AppError(404, 'Transport Payment Voucher not found'), req, res);
        return next(new AppError(404, 'Transport Payment Voucher not found'));
      }
      logger.info(`Fetched Transport Payment Voucher with ID: ${id} successfully`);
      ControllerLogger.logView('Transport Payment Voucher (for update)', id, req, res);
      res.status(200).json({
        status: 'success',
        data: voucher,
      });
    } catch (error) {
      logger.error('Error fetching TPVoucher by id', { error, id });
      ControllerLogger.logError('Transport Payment Voucher retrieval for update', error, req, res);
      next(error);
    }
  }
  @httpPatch('/:id', captureUser, uploadAttachments)
  public async updateTPVoucher(
    @requestParam('id') id: string,
    @requestBody() updateData: any,
    @request() req:Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info(`Received request to update TPVoucher with id: ${id}`);
      
      // Use helper function to handle file URL extraction
      setAttachmentUrls(updateData, req.files as any[]);
     Object.keys(updateData).forEach((key) => {
      if (updateData[key] === "null") updateData[key] = null;
    });
      const updatedBy=res.locals.updatedBy
      const updatedVoucher = await this.tpVoucherService.updateTPVoucher(id, updateData,updatedBy);
      if (!updatedVoucher) {
        logger.warn(`TPVoucher with id ${id} not found for update`);
        ControllerLogger.logError('Transport Payment Voucher update', new AppError(404, 'Transport Payment Voucher not found for update'), req, res);
        return next(new AppError(404, 'Transport Payment Voucher not found for update'));
      }
      logger.info(`TPVoucher with id ${id} updated successfully`);
      ControllerLogger.logSuccess('Transport Payment Voucher updated', id, req, res);

      // Send notification for transport payment voucher update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Transport Payment Voucher updated successfully`,
          userId
        );
      }
const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
       // Activity log
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.TRANSPORT_PAYMENT,
        entityName: 'Transport Payment Voucher',
        entityId: id,
        description: `${userName} has updated Transport Payment Voucher${updatedVoucher.voucherNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});


      res.status(200).json({
        status: 'success',
        // data: updatedVoucher,
        message: 'Transport Payment Voucher updated successfully',
      });
    } catch (error) {
      logger.error('Error updating TPVoucher', { error });
      ControllerLogger.logError('Transport Payment Voucher update', error, req, res);
      next(error);
    }
  }

  @httpDelete('/:id')
  public async deleteTPVoucher(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      if (!id) {
        logger.warn("TPVoucher ID not provided");
        ControllerLogger.logError('Transport Payment Voucher deletion', new AppError(400, "TPVoucher ID is required"), req, res);
        return next(new AppError(400, "TPVoucher ID is required"));
      }
      logger.info(`Received request to delete TPVoucher with id: ${id}`);
      const success = await this.tpVoucherService.deleteTPVoucher(id);
      if (!success) {
        logger.warn("TPVoucher ID not provided");
        ControllerLogger.logError('Transport Payment Voucher deletion', new AppError(400, "TPVoucher ID is required"), req, res);
        return next(new AppError(400, "TPVoucher ID is required"));
      }
      logger.info(`TPVoucher with id ${id} deleted successfully`);
      ControllerLogger.logSuccess('Transport Payment Voucher deleted', id, req, res);

      // Send notification for transport payment voucher deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Transport Payment Voucher deleted successfully`,
      //     userId
      //   );
      // }

      // Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.TRANSPORT_PAYMENT,
        entityName: 'Transport Payment Voucher',
        entityId: id,
        description: `${userName} has deleted Transport Payment Voucher${success.No || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});


      res.status(200).json({
        status: "success",
        message: "TPVoucher deleted successfully"
      });
      //res.status(200).send("Deleted successfully"); // No content
    } catch (error) {
      logger.error('Error deleting TPVoucher', { error });
      ControllerLogger.logError('Transport Payment Voucher deletion', error, req, res);
      next(error);
    }
  }

  @httpDelete('/delete/multiple')
      public async deleteMultipleTransportPaymentVoucher(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction,
      ) {
        try {
          const { ids } = req.body;
          if (!Array.isArray(ids) || ids.length === 0) {
            ControllerLogger.logError('Transport Payment Voucher multiple deletion', new AppError(400, 'An array of Transport Payment Voucher IDs is required'), req, res);
            return next(new AppError(400, 'An array of Transport Payment Voucher IDs is required'));
          }
          const result = await this.tpVoucherService.deleteMultipleTransportPaymentVoucher(ids);
          const deletedNos = result.success.map(s => s.No || s.id).join(', ');
          ControllerLogger.logSuccess('Transport Payment Voucher multiple deletion', `${ids.length} records`, req, res);

          // Send notification for multiple transport payment voucher deletion
          // const userId = res.locals.user?.id;
          // if (userId) {
          //   await this.notificationService.createNoti(
          //     `Multiple Transport Payment Vouchers deleted successfully: ${ids.length} records`,
          //     userId
          //   );
          // }

           // Activity log
           const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.TRANSPORT_PAYMENT,
        entityName: 'Transport Payment Voucher',
        description: `${userName} has bulk deleted ${result.success.length} Transport Payment Voucher(s): ${deletedNos}`,
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
        }
          catch (error) {
          logger.error('Error deleting multiple Transport Payment Voucher', { error });
          ControllerLogger.logError('Transport Payment Voucher multiple deletion', error, req, res);
          next(error);
        }
      }
}


  // @httpGet('/:id')
  // public async getTPVoucherById(
  //   @requestParam('id') id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     logger.info(`Received request to get TPVoucher with id: ${id}`);
  //     const voucher = await this.tpVoucherService.getTPVoucherById(id);
  //     if (!voucher) {
  //       logger.warn(`TPVoucher with id ${id} not found`);
  //       ControllerLogger.logError('Transport Payment Voucher view', new AppError(404, 'Transport Payment Voucher not found'), req, res);
  //       return next(new AppError(404, 'Transport Payment Voucher not found'));
  //     }
  //     logger.info(`Fetched Transport Payment Voucher with ID: ${id} successfully`);
  //     ControllerLogger.logView('Transport Payment Voucher', id, req, res);

  //     // Send notification for transport payment voucher view
  //     const userId = res.locals.user?.id;
  //     // if (userId) {
  //     //   await this.notificationService.createNoti(
  //     //     `Transport Payment Voucher viewed: ${id}`,
  //     //     userId
  //     //   );
  //     // }

  //     res.status(200).json({
  //       status: 'success',
  //       data: voucher,
  //     });
  //   } catch (error) {
  //     logger.error('Error fetching TPVoucher by id', { error, id });
  //     ControllerLogger.logError('Transport Payment Voucher view', error, req, res);
  //     next(error);
  //   }
  // }