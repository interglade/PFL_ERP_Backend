import { Request, Response, NextFunction } from "express";

import { inject } from "inversify";
import { controller, httpGet, httpPost, httpPut, httpDelete, request, response, next, httpPatch } from "inversify-express-utils";
import { TYPES } from "../../../types";

import { captureUser, deserializeUser, requireUser } from "../../../middleware/deserializeUser";

import logger from "../../../utils/logger";

import { PaginationOptions } from "../../../utils/pagination";
import AppError from "../../../utils/appError";
import { ControllerLogger } from "../../../utils/controllerLogger";

import { uploadSingle } from "../../../middleware/uploadsingle.middleware";
import { upload, uploadAttachments } from "../../../middleware/upload.middleware";
import { setAttachmentUrls } from "../../../utils/fileUploadHelper";

import { UserActivityLogService } from "../../../employeeActivity/service/userActivityLog.service";
import { PMPVoucherService } from "../service/pmpvoucher.service";
import { NotificationService } from "../../../notification/service/notification.service";
import { CreatePMPVoucherDto, UpdatePMPVoucherDto } from "../dto/pmpVoucher.dto";
import { ActivityAction, ActivityModule } from "../../../employeeActivity/entity/userActivityLog.entity";
import { DocumentExportService } from '../../../excel/export/documentExport.service';
import { PACKING_MATERIAL_VOUCHER_EXPORT } from '../excel/packingMaterialVoucher.export';
import { applyDocumentListFilters } from '../../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../../approvalFlow/entity/docuemnt.entity';

//,deserializeUser, requireUser
@controller("/pmpvoucher",deserializeUser, requireUser)
export class PMPVoucherController {
  constructor(
    @inject(TYPES.PMPVoucherService) private pmpVoucherService: PMPVoucherService,
    @inject(TYPES.NotificationService) private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService) private activityLogService: UserActivityLogService,
    @inject(TYPES.DocumentExportService)
    private readonly documentExportService: DocumentExportService,
    
  ) {}

  /**
   * GET export/excel - every Packing Material Voucher the user can see in the list, as an .xlsx.
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
      entityName: 'Packing Material Voucher',
      definition: PACKING_MATERIAL_VOUCHER_EXPORT,
      list: { documentType: FilterDocumentType.PACKAGING_MATERIAL_VOUCHER, searchFields: ['"voucher.voucherNo",'] },
      fetchList: (queryOptions, userId) => this.pmpVoucherService.getAllVouchers(queryOptions, userId),
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
      logger.info("Fetching all vouchers");
      const userId = res.locals.user.id;
      const { page, limit, search, sort,voucherNo} = req.query
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
                limit: limit ? Number(limit) : undefined,
        searchFields: ['"voucher.voucherNo",'],
        filters: {},
        sort: sort as string || undefined, // Adjust this line to match your sorting requirements
        search: search as string|| '',
      };
      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.PACKAGING_MATERIAL_VOUCHER);
      const vouchers = await this.pmpVoucherService.getAllVouchers(queryOptions, userId);
      logger.info("Vouchers fetched successfully", { vouchers });
      
      ControllerLogger.logList("PMP Voucher", req, res);

      // Send notification for PMP voucher list access
     
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'PMP Voucher records list accessed successfully',
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
      logger.error("Error fetching vouchers", { error: err });
      ControllerLogger.logError('PMP Voucher list retrieval', err, req, res);
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
      logger.info("Fetching all vouchers");
      const userId = res.locals.user.id;
      const { page, limit, search, sort,voucherNo} = req.query
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
                limit: limit ? Number(limit) : undefined,
        searchFields: ['"voucher.voucherNo",'],
        filters: {},
        sort: sort as string || undefined, // Adjust this line to match your sorting requirements
        search: search as string|| '',
      };
      const vouchers = await this.pmpVoucherService.getAllRecycleBinVouchers(queryOptions, userId);
      
      logger.info("Vouchers fetched successfully", { vouchers });
      
      ControllerLogger.logList("PMP Voucher Recycle Bin", req, res);
      
      res.status(200).json({
        status: "success",
        data: vouchers.data,
        allRecords: vouchers.meta.total,
        totalPages: vouchers.meta.pages,
        page: vouchers.meta.page,
      });
    } catch (err: any) {
      logger.error("Error fetching vouchers", { error: err });
      ControllerLogger.logError('PMP Voucher recycle bin retrieval', err, req, res);
      next(err);
    }
  }
  // Get voucher by ID



  @httpGet("/:id/view")
  public async getVoucherByIdForView(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { id } = req.params;
      const voucher = await this.pmpVoucherService.getVoucherByIdforView(id);
      logger.info(`Fetching voucher with ID: ${id}`);
      if (!voucher) {
        logger.warn(`Voucher with ID: ${id} not found`);
        return res.status(404).json({ status: "fail", message: "Voucher not found" });
      }
      logger.info(`Voucher with ID: ${id} fetched successfully`);
      
      ControllerLogger.logView("PMP Voucher", id, req, res);
      
      res.status(200).json({
        status: "success",
        data: voucher,
      });
    } catch (err) {
      logger.error("Error fetching voucher by ID", { error: err });
      ControllerLogger.logError('PMP Voucher view', err, req, res);
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
      const { id } = req.params;
      const voucher = await this.pmpVoucherService.getVoucherByIdForUpdate(id);
      logger.info(`Fetching voucher with ID: ${id}`);
      if (!voucher) {
        logger.warn(`Voucher with ID: ${id} not found`);
        return res.status(404).json({ status: "fail", message: "Voucher not found" });
      }
      logger.info(`Voucher with ID: ${id} fetched successfully`);
      
      ControllerLogger.logView("PMP Voucher (for update)", id, req, res);
      
      res.status(200).json({
        status: "success",
        data: voucher,
      });
    } catch (err) {
      logger.error("Error fetching voucher by ID", { error: err });
      ControllerLogger.logError('PMP Voucher retrieval for update', err, req, res);
      next(err);
    }
  }

  // Create a new voucher
  @httpPost("/", uploadAttachments)
  public async createVoucher(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const voucherData: CreatePMPVoucherDto = req.body;
      const voucherDataAny = voucherData as any;

      if (voucherData.kyc === true || (voucherData.kyc as any) === 'true')
    {
      voucherData.kyc=true;
    }
      
      // Use helper function to handle file URL extraction
      setAttachmentUrls(voucherDataAny, req.files as any[]);
      Object.keys(voucherDataAny).forEach((key: string) => {
        if (voucherDataAny[key] === "null") voucherDataAny[key] = null;
      });
      logger.info("Creating a new voucher");
      
    voucherData.requestedBy= res.locals.user.id;
    voucherData.requestingDepartment = res.locals.user.selectDepartment;
      const newVoucher = await this.pmpVoucherService.createVoucher(voucherData);
      logger.info("New voucher created successfully");
      
      ControllerLogger.logSuccess('PMP Voucher created', newVoucher.id, req, res);

      // Send notification for PMP voucher creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `PMP Voucher created successfully`,
          userId
        );
      }
      
        // Single activity log
        const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
          this.activityLogService.logActivity({
            userId: res.locals.user.id,
            userName,
            action: ActivityAction.CREATE,
            module: ActivityModule.PMP_VOUCHER,
            entityName: 'Packaging Material Voucher',
            entityId: newVoucher.id,
            description: `${userName} has created Packaging Material Voucher ${newVoucher.voucherNo || newVoucher.id}`,
            ipAddress: req.ip || '',
            userAgent: req.get('user-agent'),
            endpoint: req.originalUrl,
            httpMethod: req.method,
            statusCode: 201,
          }).catch(() => {});

      res.status(201).json({
        status: "success",
        message: 'Packing Material Payment Voucher created successfully',
        //data: newVoucher,
      });
    } catch (err) {
      logger.error("Error creating voucher", { error: err });
      ControllerLogger.logError('PMP Voucher creation', err, req, res);
      if (err instanceof Error) {
               return next(new AppError(400, err.message)); // ← sends 400 with real message
             }
      next(err);
    }
  }

  // Update a voucher
  @httpPatch("/:id", uploadAttachments, captureUser)
  public async updateVoucher(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const updatedBy=res.locals.updatedBy;
      console.log("updated by............",updatedBy)
      const { id } = req.params;
      const updatedData: UpdatePMPVoucherDto = req.body;
      const updateAny = updatedData as any;

      // Use helper function to handle file URL extraction
      setAttachmentUrls(updateAny, req.files as any[]);

      Object.keys(updateAny).forEach((key) => {
        if (updateAny[key] === "null") updateAny[key] = null;
      });
      logger.info(`Updating voucher with ID: ${id}`);
      const updatedVoucher = await this.pmpVoucherService.updateVoucher(id, updatedData, updatedBy);

      if (!updatedVoucher) {
        logger.warn(`Voucher with ID: ${id} not found for update`);
        return res.status(404).json({ status: "fail", message: "Voucher not found" });
      }
      logger.info(`Voucher with ID: ${id} updated successfully`);
      
      ControllerLogger.logSuccess('PMP Voucher updated', id, req, res);

      // Send notification for PMP voucher update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `PMP Voucher updated successfully`,
          userId
        );
      }
      
       // Activity log
       const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.PMP_VOUCHER,
        entityName: 'Packaging Material Voucher',
        entityId: id,
        description: `${userName} has updated Packaging Material Voucher ${updatedVoucher.voucherNo || id}`,
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
      logger.error("Error updating voucher", { error: err });
      ControllerLogger.logError('PMP Voucher update', err, req, res);
      next(err);
    }
  }

  // Delete a voucher
  @httpDelete("/:id")
  public async deleteVoucher(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { id } = req.params;
      logger.info(`Deleting voucher with ID: ${id}`);
      const success = await this.pmpVoucherService.deleteVoucher(id);

      if (!success) {
        logger.warn(`Voucher with ID: ${id} not found for deletion`);
        return res.status(404).json({ status: "fail", message: "Voucher not found" });
      }
      logger.info(`Voucher with ID: ${id} deleted successfully`);
      
      ControllerLogger.logSuccess('PMP Voucher deleted', id, req, res);

      // Send notification for PMP voucher deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `PMP Voucher deleted successfully`,
      //     userId
      //   );
      // }

      // Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.PMP_VOUCHER,
        entityName: 'Packaging Material Voucher',
        entityId: id,
        description: `${userName} has deleted Packaging Material Voucher ${success.No || id}`,
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
      logger.error("Error deleting voucher", { error: err });
      ControllerLogger.logError('PMP Voucher deletion', err, req, res);
      next(err);
    }
  }
  @httpDelete('/delete/multiple')
      public async deleteMultiplePMPVoucher(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction,
      ) {
        try {
          const { ids } = req.body;
          if (!Array.isArray(ids) || ids.length === 0) {
            return next(new AppError(400, 'An array of AQR IDs is required'));
          }
          const result = await this.pmpVoucherService.deleteMultiplePMPVoucher(ids);
          const deletedNos = result.success.map(s => s.No || s.id).join(', ');

          ControllerLogger.logSuccess('Multiple PMP Vouchers deleted', `${ids.length} items`, req, res);
          
          // Activity log
          const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.PMP_VOUCHER,
        entityName: 'Packaging Material Voucher',
        description: `${userName} has bulk deleted ${result.success.length} Packaging Material Voucher(s): ${deletedNos}`,
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
          logger.error('Error deleting  PMPVoucher', { error });
          ControllerLogger.logError('Multiple PMP Voucher deletion', error, req, res);
          next(error);
        }
      }


}




  // @httpGet("/:id")
  // public async getVoucherById(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const { id } = req.params;
  //     const voucher = await this.pmpVoucherService.getVoucherById(id);
  //     logger.info(`Fetching voucher with ID: ${id}`);
  //     if (!voucher) {
  //       logger.warn(`Voucher with ID: ${id} not found`);
  //       return res.status(404).json({ status: "fail", message: "Voucher not found" });
  //     }
  //     logger.info(`Voucher with ID: ${id} fetched successfully`);
      
  //     ControllerLogger.logView("PMP Voucher", id, req, res);

  //     // Send notification for PMP voucher view
  //     // const userId = res.locals.user?.id;
  //     // if (userId) {
  //     //   await this.notificationService.createNoti(
  //     //     `PMP Voucher viewed: ${id}`,
  //     //     userId
  //     //   );
  //     // }
      
  //     res.status(200).json({
  //       status: "success",
  //       data: voucher,
  //     });
  //   } catch (err) {
  //     logger.error("Error fetching voucher by ID", { error: err });
  //     ControllerLogger.logError('PMP Voucher view', err, req, res);
  //     next(err);
  //   }
  // }