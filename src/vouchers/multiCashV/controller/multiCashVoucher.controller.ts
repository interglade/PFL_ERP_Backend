import { inject } from "inversify";
import { controller, httpDelete, httpGet, httpPatch, httpPost, next, request, requestParam, response } from "inversify-express-utils";
import { TYPES } from "../../../types";

import { NextFunction,Request,Response } from "express";
import { captureUser, deserializeUser, requireUser } from "../../../middleware/deserializeUser";

import logger from "../../../utils/logger";
import AppError from "../../../utils/appError";
import { ControllerLogger } from '../../../utils/controllerLogger';

import { PaginationOptions } from "../../../utils/pagination";

import { uploadSingle } from "../../../middleware/uploadsingle.middleware";
import { upload, uploadAttachments } from "../../../middleware/upload.middleware";
import { setAttachmentUrls } from "../../../utils/fileUploadHelper";

import { UserActivityLogService } from "../../../employeeActivity/service/userActivityLog.service";
import { MultiCashVoucherService } from "../service/multiCashVoucher.service";
import { NotificationService } from "../../../notification/service/notification.service";
import { CreateMultiCashVoucherDto, UpdateMultiCashVoucherDto } from "../dto/multiCashVoucher.dto";
import { ActivityAction, ActivityModule } from "../../../employeeActivity/entity/userActivityLog.entity";
import { DocumentExportService } from '../../../excel/export/documentExport.service';
import { MULTI_CASH_VOUCHER_EXPORT } from '../excel/multiCashVoucher.export';
import { applyDocumentListFilters } from '../../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../../approvalFlow/entity/docuemnt.entity';

//,deserializeUser,requireUser
@controller('/multiCashVoucher',deserializeUser,requireUser)
export class  MultiCashVoucherController {

    constructor(
      @inject(TYPES.MultiCashVoucherService) private multicashVoucherService: MultiCashVoucherService,
      @inject(TYPES.NotificationService) private notificationService: NotificationService,
      @inject(TYPES.UserActivityLogService) private activityLogService: UserActivityLogService,
      @inject(TYPES.DocumentExportService)
      private readonly documentExportService: DocumentExportService,
      
    ) {}

    @httpPost("/", uploadAttachments)
  public async createVoucher(
    @request() req: Request<{}, {}, CreateMultiCashVoucherDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Creating a new Multi Cash Voucher");
      const voucherData: CreateMultiCashVoucherDto = req.body;

      // Use helper function to handle file URL extraction
      setAttachmentUrls(voucherData, req.files as any[]);

      // type-safe null-string cleanup
      const voucherAny = voucherData as any;
      Object.keys(voucherAny).forEach((key) => {
        if (voucherAny[key] === 'null') voucherAny[key] = null;
      });

      voucherAny.requestedBy = res.locals.user.id;
      voucherAny.requestingDepartment = res.locals.user.selectDepartment;
      const newVoucher = await this.multicashVoucherService.createVoucher(voucherData);
      logger.info("Multi Cash Voucher created successfully", { voucherId: newVoucher.id });
      ControllerLogger.logSuccess('Multi Cash Voucher created', newVoucher.id, req, res);

      // Send notification for multi cash voucher creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Multi Cash Voucher created successfully`,
          userId
        );
      }
   
      // Single activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
          this.activityLogService.logActivity({
            userId: res.locals.user.id,
            userName,
            action: ActivityAction.CREATE,
            module: ActivityModule.MULTI_CASH_VOUCHER,
            entityName: 'Multi Cash Voucher',
            entityId: newVoucher.id,
            description: `${userName} has created Multi Cash Voucher ${newVoucher.voucherNo || newVoucher.id}`,
            ipAddress: req.ip || '',
            userAgent: req.get('user-agent'),
            endpoint: req.originalUrl,
            httpMethod: req.method,
            statusCode: 201,
          }).catch(() => {});


      res.status(201).json({
        status: "success",
        message: 'Multi Cash Payment Voucher created successfully',
       
      });
    } catch (err) {
      logger.error("Error while creating Multi Cash Voucher", { error: err });
      ControllerLogger.logError('Multi Cash Voucher creation', err, req, res);
      if (err instanceof Error) {
               return next(new AppError(400, err.message)); // ← sends 400 with real message
             }
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
      logger.info("Fetching all Multi Cash Vouchers");
      const { page, limit, search, sort,voucherId} = req.query;
          
      const userId = res.locals.user.id;
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
        limit: limit ? Number(limit) : undefined,
        searchFields: ['"voucher.voucherNo",'],
        filters: {},
        sort: sort as string || undefined, // Adjust this line to match your sorting requirements
        search: search as string|| '',
      };
      const vouchers = await this.multicashVoucherService.getAllRecycleBinVouchers(queryOptions, userId);
      logger.info(`Found ${vouchers.data.length} vouchers`);
      ControllerLogger.logList('Multi Cash Voucher Recycle Bin', req, res);

      res.status(200).json({
        status: "success",
        data: vouchers.data,
        allRecords: vouchers.meta.total,
        totalPages: vouchers.meta.pages,
        page: vouchers.meta.page,
      });
    } catch (err: any) {
      logger.error("Error fetching all Multi Cash Vouchers", { error: err });
      ControllerLogger.logError('Multi Cash Voucher recycle bin retrieval', err, req, res);
      next(err);
    }
  }
  /**
   * GET export/excel - every Multi Cash Voucher the user can see in the list, as an .xlsx.
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
      entityName: 'Multi Cash Voucher',
      definition: MULTI_CASH_VOUCHER_EXPORT,
      list: { documentType: FilterDocumentType.MULTI_CASH_VOUCHER, searchFields: ['"voucher.voucherNo",'] },
      fetchList: (queryOptions, userId) => this.multicashVoucherService.getAllVouchers(queryOptions, userId),
    });
  }

  // Get all vouchers
  @httpGet("/")
  public async getAllVouchers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Fetching all Multi Cash Vouchers");
      const { page, limit, search, sort,voucherId} = req.query;
          
      const userId = res.locals.user.id;
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
        limit: limit ? Number(limit) : undefined,
        searchFields: ['"voucher.voucherNo",'],
        filters: {},
        sort: sort as string || undefined, // Adjust this line to match your sorting requirements
        search: search as string|| '',
      };
      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.MULTI_CASH_VOUCHER);
      const vouchers = await this.multicashVoucherService.getAllVouchers(queryOptions, userId);
      logger.info(`Found ${vouchers.data.length} vouchers`);
      ControllerLogger.logList('Multi Cash Voucher', req, res);

      // Send notification for multi cash voucher list access
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Multi Cash Voucher records list accessed successfully',
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
    } catch (err: any) {
      logger.error("Error fetching all Multi Cash Vouchers", { error: err });
      ControllerLogger.logError('Multi Cash Voucher list retrieval', err, req, res);
      next(err);
    }
  }

  




  @httpGet("/:id/view")
  public async getVoucherByIdForView(
    @request() req: Request<{ id: string }>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info(`Fetching Multi Cash Voucher with ID`);
      const { id } = req.params;
      const voucher = await this.multicashVoucherService.getVoucherByIdForView(id);

      if (!voucher) {
        logger.warn(`Voucher with ID ${id} not found`);
        return res.status(404).json({ status: "fail", message: "Voucher not found" });
      }
      logger.info("Voucher fetched successfully", { voucherId: id });
      ControllerLogger.logView('Multi Cash Voucher (View)', id, req, res);

      res.status(200).json({
        status: "success",
        data: voucher,
      });
    } catch (err) {
      logger.error(`Error fetching Multi Cash Voucher with ID: ${req.params.id}`, { error: err });
      ControllerLogger.logError('Multi Cash Voucher view', err, req, res);
      next(err);
    }
  }
   @httpGet("/:id/update")
  public async getVoucherByIdForUpdate(
    @request() req: Request<{ id: string }>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info(`Fetching Multi Cash Voucher with ID`);
      const { id } = req.params;
      const voucher = await this.multicashVoucherService.getVoucherByIdForUpdate(id);

      if (!voucher) {
        logger.warn(`Voucher with ID ${id} not found`);
        return res.status(404).json({ status: "fail", message: "Voucher not found" });
      }
      logger.info("Voucher fetched successfully", { voucherId: id });
      ControllerLogger.logView('Multi Cash Voucher (Update)', id, req, res);

      res.status(200).json({
        status: "success",
        data: voucher,
      });
    } catch (err) {
      logger.error(`Error fetching Multi Cash Voucher with ID: ${req.params.id}`, { error: err });
      ControllerLogger.logError('Multi Cash Voucher view for update', err, req, res);
      next(err);
    }
  }

  // Update a Labour Payment Voucher
  @httpPatch("/:id", uploadAttachments, captureUser)
  public async updateVoucher(
    @request() req: Request<{ id: string }, {}, UpdateMultiCashVoucherDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const updatedBy = res.locals.updatedBy;
      const { id } = req.params;
      const updatedData: UpdateMultiCashVoucherDto = req.body;
      logger.info(`Updating Multi Cash Voucher with ID: ${id}`, { updatedBy });
      
      // Use helper function to handle file URL extraction
      setAttachmentUrls(updatedData, req.files as any[]);

      const updateAny = updatedData as any;
      Object.keys(updateAny).forEach((key) => {
        if (updateAny[key] === "null") updateAny[key] = null;
      });
      const updatedVoucher = await this.multicashVoucherService.updateVoucher(id, updatedData, updatedBy);

      if (!updatedVoucher) {
        logger.warn(`Voucher with ID ${id} not found for update`);
        return res.status(404).json({ 
          status: "fail",
           message: "Voucher not found" });
      }
      logger.info("Voucher updated successfully", { voucherId: id });
      ControllerLogger.logSuccess('Multi Cash Voucher updated', id, req, res);

      // Send notification for multi cash voucher update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Multi Cash Voucher updated successfully`,
          userId
        );
      }


       // Activity log
       const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.MULTI_CASH_VOUCHER,
        entityName: 'Multi Cash Voucher',
        entityId: id,
        description: `${userName} has updated Multi Cash Voucher ${updatedVoucher.voucherNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      res.status(200).json({
        status: "success",
        data: updatedVoucher,
      });
    } catch (err) {
     // logger.error(`Error updating Multi Cash Voucher with ID: ${req.params.id}`, { error: err });
      ControllerLogger.logError('Multi Cash Voucher update', err, req, res);
      next(err);
    }
  }
  @httpDelete("/:id")
  public async deleteVoucher(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response, 
    @next() next: NextFunction
  ) {
    try {
     const voucher = await this.multicashVoucherService.deleteVoucher(id)
     
       if (!voucher) 
        {
               return next(new AppError(404, "Voucher not found or could not be deleted"));
             }

             ControllerLogger.logSuccess('Multi Cash Voucher deleted', id, req, res);

             // Send notification for multi cash voucher deletion
            //  const userId = res.locals.user?.id;
            //  if (userId) {
            //    await this.notificationService.createNoti(
            //      `Multi Cash Voucher deleted successfully`,
            //      userId
            //    );
            //  }


             // Activity log
             const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.MULTI_CASH_VOUCHER,
        entityName: 'Multi Cash Voucher',
        entityId: id,
        description: `${userName} has deleted Multi Cash Voucher ${voucher.No || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
             res.status(200).json({ 
              status: "success", 
              message: "Voucher deleted successfully" });
      //res.status(204).send();
    } catch (err) {
      logger.error("Error occurred while deleting voucher", { voucherId: id, error: err });
      ControllerLogger.logError('Multi Cash Voucher deletion', err, req, res);
      next(err);
    }
  }

  @httpDelete('/delete/multiple')
        public async deleteMultipleMultiCashVoucher(
          @request() req: Request,
          @response() res: Response,
          @next() next: NextFunction,
        ) {
          try {
            const { ids } = req.body;
            if (!Array.isArray(ids) || ids.length === 0) {
              return next(new AppError(400, 'An array of MultiCashVoucher IDs is required'));
            }
            const result = await this.multicashVoucherService.deleteMultipleMultiCashVoucher(ids);
            const deletedNos = result.success.map(s => s.No || s.id).join(', ');

            ControllerLogger.logSuccess(`${ids.length} Multi Cash Vouchers deleted`, ids.join(', '), req, res);


             // Activity log
             const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.MULTI_CASH_VOUCHER,
        entityName: 'Multi Cash Voucher',
        description: `${userName} has bulk deleted ${result.success.length} Multi Cash Voucher(s): ${deletedNos}`,
        metadata: { ids, count: ids.length },
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
            res.status(200).json({
              message: result.message,
              // success: result.success,
              // failed: result.failed,
            });
          }
            catch (error) {
            logger.error('Error deleting multiple multiCashVoucher', { error });
            ControllerLogger.logError('Multiple Multi Cash Vouchers deletion', error, req, res);
            next(error);
          }
        }
        


}



// @httpGet('/:id/generate-pdf')
// async generateVoucherPdf(req: Request, res: Response): Promise<void> {
//     const { id } = req.params;

//     try {
//       const pdfUrl = await this.multicashVoucherService.generateMultiCashVoucherPdf(id);
//       res.status(200).json({ message:"Url Fetch Successfully", url: pdfUrl });
//     } catch (error) {
//       console.error('Error generating voucher PDF:', error);
//       res.status(500).json({ success: false, message: 'Failed to generate PDF' });
//     }
//   }




  // // Get voucher by ID
  // @httpGet("/:id")
  // public async getVoucherById(
  //   @request() req: Request<{ id: string }>,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     logger.info(`Fetching Multi Cash Voucher with ID`);
  //     const { id } = req.params;
  //     const voucher = await this.multicashVoucherService.getVoucherById(id);

  //     if (!voucher) {
  //       logger.warn(`Voucher with ID ${id} not found`);
  //       return res.status(404).json({ status: "fail", message: "Voucher not found" });
  //     }
  //     logger.info("Voucher fetched successfully", { voucherId: id });
  //     ControllerLogger.logView('Multi Cash Voucher', id, req, res);

  //     // Send notification for multi cash voucher view
  //     // const userId = res.locals.user?.id;
  //     // if (userId) {
  //     //   await this.notificationService.createNoti(
  //     //     `Multi Cash Voucher viewed: ${id}`,
  //     //     userId
  //     //   );
  //     // }

  //     res.status(200).json({
  //       status: "success",
  //       data: voucher,
  //     });
  //   } catch (err) {
  //     logger.error(`Error fetching Multi Cash Voucher with ID: ${req.params.id}`, { error: err });
  //     ControllerLogger.logError('Multi Cash Voucher view', err, req, res);
  //     next(err);
  //   }
  // }