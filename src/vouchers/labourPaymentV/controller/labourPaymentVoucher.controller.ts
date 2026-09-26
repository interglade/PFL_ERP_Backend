import { Request, Response, NextFunction } from "express";

import { inject } from "inversify";
import { controller, httpGet, httpPost, httpDelete, request, response, next, httpPatch } from "inversify-express-utils";
import { TYPES } from "../../../types";
import { captureUser, deserializeUser, requireUser } from "../../../middleware/deserializeUser";

import logger from "../../../utils/logger";

import { PaginationOptions } from "../../../utils/pagination";
import AppError from "../../../utils/appError";
import { ControllerLogger } from '../../../utils/controllerLogger';

import { uploadAttachments } from "../../../middleware/upload.middleware";
import { setAttachmentUrls } from "../../../utils/fileUploadHelper";

import { UserActivityLogService } from "../../../employeeActivity/service/userActivityLog.service";
import { BulkDeleteResultDto } from "../../../global/general.dto";
import { LabourPaymentVoucherService } from "../service/labourPaymentVoucher.service";
import { NotificationService } from "../../../notification/service/notification.service";
import { CreateLPVoucherDto, LPVoucherListResponseDto, LPVoucherUpdateFormDto, LPVoucherViewDto } from "../dto/labourPaymentVoucher.dto";
import { ActivityAction, ActivityModule } from "../../../employeeActivity/entity/userActivityLog.entity";
import { DocumentExportService } from '../../../excel/export/documentExport.service';
import { LABOUR_PAYMENT_VOUCHER_EXPORT } from '../excel/labourPaymentVoucher.export';
import { applyDocumentListFilters } from '../../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../../approvalFlow/entity/docuemnt.entity';

@controller("/lpvoucher", deserializeUser, requireUser)
export class LabourPaymentVoucherController {
  constructor(
    @inject(TYPES.LabourPaymentVoucherService) private lpVoucherService: LabourPaymentVoucherService,
    @inject(TYPES.NotificationService) private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService) private activityLogService: UserActivityLogService,
    @inject(TYPES.DocumentExportService)
    private readonly documentExportService: DocumentExportService,
    
  ) {}

  /**
   * GET export/excel - every Labour Payment Voucher the user can see in the list, as an .xlsx.
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
      entityName: 'Labour Payment Voucher',
      definition: LABOUR_PAYMENT_VOUCHER_EXPORT,
      list: { documentType: FilterDocumentType.LABOR_PAYMENT_VOUCHER, searchFields: ['"voucher.voucherNo",'] },
      fetchList: (queryOptions, userId) => this.lpVoucherService.getLPVouchers(queryOptions, userId),
    });
  }

  // Get all Labour Payment Vouchers
  @httpGet("/")
  public async getAllVouchers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Fetching all Labour Payment Vouchers");
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
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.LABOR_PAYMENT_VOUCHER);
      const vouchers: LPVoucherListResponseDto = await this.lpVoucherService.getLPVouchers(queryOptions, userId);
      logger.info(`Fetched ${vouchers.meta.total} vouchers successfully`);
      ControllerLogger.logList('Labour Payment Voucher', req, res);

      // Send notification for labour payment voucher list access
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Labour Payment Voucher records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: vouchers.data,
        allRecords: vouchers.meta.total,
        totalPages: vouchers.meta.pages,
        page: vouchers.meta.page,
      });
    } catch (err) {
      logger.error("Error fetching Labour Payment Vouchers", { error: err });
      ControllerLogger.logError('Labour Payment Voucher list retrieval', err, req, res);
      next(err);
    }
  }

  // Get Labour Payment Voucher by ID




  @httpGet("/:id/view")
  public async getVoucherByIdForView(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info(`Fetching Labour Payment Voucher with ID`);
      const { id } = req.params;
      const voucher: LPVoucherViewDto | null = await this.lpVoucherService.getLPVoucherByIdForView(id);

      if (!voucher) {
        logger.warn(`Voucher with ID: ${id} not found`);
        return res.status(404).json({ status: "fail", message: "Voucher not found" });
      }
      logger.info(`Fetched voucher with ID: ${id} successfully`);
      ControllerLogger.logView('Labour Payment Voucher (View)', id, req, res);

      res.status(200).json({
        status: "success",
        data: voucher,
      });
    } catch (err) {
      logger.error("Error fetching Labour Payment Voucher by ID", { error: err });
      ControllerLogger.logError('Labour Payment Voucher view', err, req, res);
      next(err);
    }
  }

  @httpGet("/:id/update")
  public async getVoucherByIdForUpdate(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info(`Fetching Labour Payment Voucher with ID`);
      const { id } = req.params;
      const voucher: LPVoucherUpdateFormDto | null = await this.lpVoucherService.getLPVoucherByIdForUpdate(id);

      if (!voucher) {
        logger.warn(`Voucher with ID: ${id} not found`);
        return res.status(404).json({ status: "fail", message: "Voucher not found" });
      }
      logger.info(`Fetched voucher with ID: ${id} successfully`);
      ControllerLogger.logView('Labour Payment Voucher (Update)', id, req, res);

      res.status(200).json({
        status: "success",
        data: voucher,
      });
    } catch (err) {
      logger.error("Error fetching Labour Payment Voucher by ID", { error: err });
      ControllerLogger.logError('Labour Payment Voucher view for update', err, req, res);
      next(err);
    }
  }

  // Create a new Labour Payment Voucher
  @httpPost("/", uploadAttachments)
  public async createVoucher(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Creating new Labour Payment Voucher");
      const voucherData: CreateLPVoucherDto & Record<string, any> = req.body;
      
      if(voucherData.kyc===true||(voucherData.kyc) as any === 'true')
      {
        voucherData.kyc=true;
      }
      // Use helper function to handle file URL extraction
      setAttachmentUrls(voucherData, req.files as any[]);
     Object.keys( voucherData).forEach((key) => {
      if ( voucherData[key] === "null")  voucherData[key] = null;
    });
      voucherData.requestedBy = res.locals.user.id;
      voucherData.requestingDepartment = res.locals.user.selectDepartment; // Assuming the user id is available in res.locals
      const newVoucher = await this.lpVoucherService.createLPVoucher(voucherData);
      logger.info("Labour Payment Voucher created successfully");
      ControllerLogger.logSuccess('Labour Payment Voucher created', Array.isArray(newVoucher) ? newVoucher[0]?.id : newVoucher?.id, req, res);

      // Send notification for labour payment voucher creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Labour Payment Voucher created successfully`,
          userId
        );
      }

      // Single activity log
            const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
                this.activityLogService.logActivity({
                  userId: res.locals.user.id,
                  userName,
                  action: ActivityAction.CREATE,
                  module: ActivityModule.LABOUR_PAYMENT,
                  entityName: 'Labour Payment Voucher',
                  entityId: newVoucher.id,
                  description: `${userName} has created Labour Payment Voucher ${newVoucher.voucherNo || newVoucher.id}`,
                  ipAddress: req.ip || '',
                  userAgent: req.get('user-agent'),
                  endpoint: req.originalUrl,
                  httpMethod: req.method,
                  statusCode: 201,
                }).catch(() => {});
                

      res.status(201).json({
        status: "success",
        message: 'Labour Payment Voucher created successfully',
        //data: newVoucher,
      });
    } catch (err) {
      logger.error("Error creating Labour Payment Voucher", { error: err });
      ControllerLogger.logError('Labour Payment Voucher creation', err, req, res);
      if (err instanceof Error) {
               return next(new AppError(400, err.message)); // ← sends 400 with real message
             }
      next(err);
    }
  }

  // Update a Labour Payment Voucher
  @httpPatch("/:id", uploadAttachments, captureUser)
  public async updateVoucher(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const updatedBy = res.locals.updatedBy;
      const { id } = req.params;
      logger.info(`Updating Labour Payment Voucher with ID: ${id}`);
      const updatedData= req.body;
      
      // Use helper function to handle file URL extraction
      setAttachmentUrls(updatedData, req.files as any[]);

     Object.keys(updatedData).forEach((key) => {
      if (updatedData[key] === "null") updatedData[key] = null;
    });
      const updatedVoucher = await this.lpVoucherService.updateLPVoucher(id, updatedData,updatedBy);

      if (!updatedVoucher) {
        logger.warn(`Voucher with ID: ${id} not found`);
        return res.status(404).json({ 
          status: "fail",
           message: "Voucher not found" });
      }
      logger.info(`Labour Payment Voucher with ID: ${id} updated successfully`);
      ControllerLogger.logSuccess('Labour Payment Voucher updated', id, req, res);

      // Send notification for labour payment voucher update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Labour Payment Voucher updated successfully`,
          userId
        );
      }

      // Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.LABOUR_PAYMENT,
        entityName: 'Labour Payment Voucher',
        entityId: id,
        description: `${userName} has updated Labour Payment Voucher ${updatedVoucher.voucherNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    
      res.status(200).json({
        status: "success",
        //data: updatedVoucher,
      });
    } catch (err) {
      logger.error("Error updating Labour Payment Voucher", { error: err });
      ControllerLogger.logError('Labour Payment Voucher update', err, req, res);
      next(err);
    }
  }

  // Delete a Labour Payment Voucher
  @httpDelete("/:id")
  public async deleteVoucher(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info(`Deleting Labour Payment Voucher with ID`);
      const { id } = req.params;
      let result=await this.lpVoucherService.deleteLPVoucher(id);
      logger.info(`Labour Payment Voucher with ID: ${id} deleted successfully`);
      ControllerLogger.logSuccess('Labour Payment Voucher deleted', id, req, res);

      // Send notification for labour payment voucher deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Labour Payment Voucher deleted successfully`,
      //     userId
      //   );
      // }

      // Activity log
       const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.LABOUR_PAYMENT,
        entityName: 'Labour Payment Voucher',
        entityId: id,
        description: `${userName} has deleted Labour Payment Voucher ${result?.No || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      res.status(200).json({ 
        status: "success", 
        message: "Voucher deleted successfully" });
    } catch (err) {
      logger.error("Error deleting Labour Payment Voucher", { error: err });
      ControllerLogger.logError('Labour Payment Voucher deletion', err, req, res);
      next(err);
    }
  }

   @httpGet("/recyclebin")
  public async getAllRecycleBinVouchers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Fetching all Labour Payment Vouchers");
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
      const vouchers: LPVoucherListResponseDto = await this.lpVoucherService.getLPRecycleBinVouchers(queryOptions, userId);
      logger.info(`Fetched ${vouchers.data.length} vouchers successfully`);
      ControllerLogger.logList('Labour Payment Voucher Recycle Bin', req, res);

      res.status(200).json({
        status: "success",
        data: vouchers.data,
        allRecords: vouchers.meta.total,
        totalPages: vouchers.meta.pages,
        page: vouchers.meta.page,
      });
    } catch (err) {
      logger.error("Error fetching Labour Payment Vouchers", { error: err });
      ControllerLogger.logError('Labour Payment Voucher recycle bin retrieval', err, req, res);
      next(err);
    }
  }


  @httpDelete('/delete/multiple')
      public async deleteMultipleLPVoucher(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction,
      ) {
        try {
          const { ids } = req.body;
          if (!Array.isArray(ids) || ids.length === 0) {
            return next(new AppError(400, 'An array of AQR IDs is required'));
          }
          const result: BulkDeleteResultDto = await this.lpVoucherService.deleteMultipleLPVoucher(ids);
          const deletedNos = result.success.map(s => s.No || s.id).join(', ');
   
          ControllerLogger.logSuccess(`${ids.length} Labour Payment Vouchers deleted`, ids.join(', '), req, res);

          // Activity log
        const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.LABOUR_PAYMENT,
        entityName: 'Labour Payment Voucher',
        description: `${userName} has bulk deleted ${result.success.length} Labour Payment Voucher(s): ${deletedNos}`,
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
          logger.error('Error deleting multiple LPVoucher', { error });
          ControllerLogger.logError('Multiple Labour Payment Vouchers deletion', error, req, res);
          next(error);
        }
      }
  

}
