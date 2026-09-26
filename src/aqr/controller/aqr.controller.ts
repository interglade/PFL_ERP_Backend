import { Request, Response, NextFunction } from "express";
import { inject } from "inversify";
import {
  controller, httpGet, httpPost, httpDelete, httpPatch,
  request, response, next, requestParam,
} from "inversify-express-utils";
import { TYPES } from "../../types";
import { AqrService } from "../service/aqr.service";

import AppError from "../../utils/appError";
import { PaginationOptions } from "../../utils/pagination";

import { ControllerLogger } from "../../utils/controllerLogger";

import { UserActivityLogService } from "../../employeeActivity/service/userActivityLog.service";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { NotificationService } from "../../notification/service/notification.service";
import { CreateAqrDto, UpdateAqrDto } from "../dto/aqr.dto";
import { ActivityAction, ActivityModule } from "../../employeeActivity/entity/userActivityLog.entity";
import { DocumentExportService } from '../../excel/export/documentExport.service';
import { AQR_EXPORT } from '../excel/aqr.export';
import { applyDocumentListFilters } from '../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../approvalFlow/entity/docuemnt.entity';


@controller("/aqr", deserializeUser, requireUser)
export class AqrController {
  constructor(
    @inject(TYPES.AqrService) private aqrService: AqrService,
    @inject(TYPES.NotificationService) private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService) private activityLogService: UserActivityLogService,
    @inject(TYPES.DocumentExportService)
    private readonly documentExportService: DocumentExportService,
  ) {}

  // ─── Create ───────────────────────────────────────────────────────────────
@httpPost("/")
public async createAqr(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction,
): Promise<Response | void> {
  try {
    const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';

    const aqrData: CreateAqrDto = { ...req.body, requestedBy: res.locals.user.id };
    const createdAqr = await this.aqrService.createAqr(aqrData);

    if (!createdAqr) {
      ControllerLogger.logOperationFailed("Create", "AQR", "not created", req, res);
      return next(new AppError(400, "AQR not created"));
    }

    this.notificationService
      .createNoti("AQR created successfully and submitted for approval", res.locals.user.id)
      .catch(() => {});

    // Single activity log
    this.activityLogService.logActivity({
      userId: res.locals.user.id,
      userName,
      action: ActivityAction.CREATE,
      module: ActivityModule.AQR,
      entityName: 'AQR',
      entityId: createdAqr.id,
      description: `${userName} has created AQR ${createdAqr.aqrNo || createdAqr.id}`,
      ipAddress: req.ip || '',
      userAgent: req.get('user-agent'),
      endpoint: req.originalUrl,
      httpMethod: req.method,
      statusCode: 201,
    }).catch(() => {});

    return res.status(201).json({ status: "success", message: "AQR created successfully" });
  } catch (error) {
    ControllerLogger.logError("AQR creation", error, req, res);
    if (error instanceof Error) return next(new AppError(400, error.message));
    next(error);
  }
}

  // ─── Get All ──────────────────────────────────────────────────────────────

  /**
   * GET export/excel - every AQR the user can see in the list, as an .xlsx.
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
      entityName: 'AQR',
      definition: AQR_EXPORT,
      list: { documentType: FilterDocumentType.AQR, filterKeys: ['supplierName', 'arrivalDate'] },
      fetchList: (queryOptions, userId) => this.aqrService.getAllAqrs(queryOptions, userId),
    });
  }

  @httpGet("/")
  public async getAllAqrs(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { page, limit, search, sort, supplierName, arrivalDate } = req.query;
      const userId = res.locals.user.id;

      const filters: any = {};
      if (supplierName) filters.supplierName = supplierName;
      if (arrivalDate) filters.arrivalDate = arrivalDate;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        filters,
        sort: (sort as string) || undefined,
        search: (search as string) || "",
      };

      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.AQR);
      const aqrs = await this.aqrService.getAllAqrs(queryOptions, userId);

      if (!aqrs || aqrs.data.length === 0) {
        return res.status(200).json({ status: "success", data: [], allRecords: 0, totalPages: 0, page: queryOptions.page });
      }

      ControllerLogger.logGetAllRecords("AQR", req, res);
      res.status(200).json({
        status: "success",
        data: aqrs.data,
        allRecords: aqrs.meta.total,
        totalPages: aqrs.meta.pages,
        page: aqrs.meta.page,
      });
    } catch (error) {
      ControllerLogger.logError("AQR retrieval", error, req, res);
      next(error);
    }
  }

  // ─── Recycle Bin ──────────────────────────────────────────────────────────

  @httpGet("/recycle-bin")
  public async getAllRecycleBinAqrs(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { page, limit, search, sort, supplierName, arrivalDate } = req.query;
      const userId = res.locals.user.id;

      const filters: any = {};
      if (supplierName) filters.supplierName = supplierName;
      if (arrivalDate) filters.arrivalDate = arrivalDate;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        filters,
        sort: (sort as string) || undefined,
        search: (search as string) || "",
      };

      const aqrs = await this.aqrService.getAllRecycleBinAqrs(queryOptions, userId);

      if (!aqrs || aqrs.data.length === 0) {
        return res.status(200).json({ status: "success", data: [], allRecords: 0, totalPages: 0, page: queryOptions.page });
      }

      ControllerLogger.logGetAllRecords("AQR", req, res);
      res.status(200).json({
        status: "success",
        data: aqrs.data,
        allRecords: aqrs.meta.total,
        totalPages: aqrs.meta.pages,
        page: aqrs.meta.page,
      });
    } catch (error) {
      ControllerLogger.logError("Aqr Recycle Bin", error, req, res);
      next(error);
    }
  }

  // ─── View (with approval info) ────────────────────────────────────────────

  @httpGet("/view/:docid")
  public async getAQRByIdForView(
    @requestParam("docid") docid: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const userId = res.locals.user.id;
      const aqr = await this.aqrService.getAQRByIdForView(docid, userId);

      if (!aqr) {
        ControllerLogger.logOperationFailed("View", "AQR", "permission denied or not found", req, res);
        return res.status(403).json({ status: "fail", message: "You do not have permission to view this AQR" });
      }

      ControllerLogger.logView("AQR", docid, req, res);
      res.status(200).json({ status: "success", data: aqr });
    } catch (error) {
      ControllerLogger.logError("AQR view", error, req, res);
      next(error);
    }
  }



  // ─── Get For Update ───────────────────────────────────────────────────────

  @httpGet("/update/:id")
  public async getAqrByIdForUpdate(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const { id } = req.params;
      const aqr = await this.aqrService.getAqrByIdForUpdate(id);

      if (!aqr) {
        ControllerLogger.logNotFound("AQR", id, req, res);
        throw new AppError(404, "AQR not found");
      } 

      ControllerLogger.logView("AQR", id, req, res);
      return res.status(200).json({ status: "success", data: aqr });
    } catch (error) {
      ControllerLogger.logError("AQR Get", error, req, res);
      next(error);
    }
  }


  // ─── Update ───────────────────────────────────────────────────────────────

  @httpPatch("/:id")
  public async updateAqr(
    @request() req: Request<{ id: string }, {}, UpdateAqrDto>,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<Response | void> {
    try {
      const { id } = req.params;
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      const updatedAqr = await this.aqrService.updateAqr(id, req.body, res.locals.updatedBy);

      if (!updatedAqr) {
        ControllerLogger.logOperationFailed("Update", "AQR", "not found or could not be updated", req, res);
        throw new AppError(404, "AQR not found or could not be updated");
      }

      this.notificationService
        .createNoti("AQR updated successfully", res.locals.user.id)
        .catch(() => {});

      // Activity log
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.AQR,
        entityName: 'AQR',
        entityId: id,
        description: `${userName} has updated AQR ${updatedAqr.aqrNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      ControllerLogger.logSuccess("AQR updated", id, req, res);
      return res.status(200).json({ status: "success", message: "AQR updated successfully", });
    } catch (error) {
      ControllerLogger.logError("AQR update", error, req, res);
      next(error);
    }
  }
  
  
//   @httpPatch("/:id")
// public async updateAqr(
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction,
// ): Promise<Response | void> {
//   try {
//     const { id } = req.params;
//     const updateData: UpdateAqrDto = req.body;
//     console.log("updatedData",updateData);
//     const updatedAqr = await this.aqrService.updateAqr(id, updateData, res.locals.updatedBy);

//     if (!updatedAqr) {
//       ControllerLogger.logOperationFailed("Update", "AQR", "not found or could not be updated", req, res);
//       throw new AppError(404, "AQR not found or could not be updated");
//     }

//     this.notificationService
//       .createNoti("AQR updated successfully", res.locals.user.id)
//       .catch(() => {});

//     ControllerLogger.logSuccess("AQR updated", id, req, res);
//     return res.status(200).json({ status: "success", message: "AQR updated successfully" });
//   } catch (error) {
//     ControllerLogger.logError("AQR update", error, req, res);
//     next(error);
//   }
// }
  // ─── Delete ───────────────────────────────────────────────────────────────

  @httpDelete("/:id")
  public async deleteAqr(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<Response | void> {
    try {
      const { id } = req.params;
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      const deleted = await this.aqrService.deleteAqr(id);

      if (!deleted) {
        ControllerLogger.logOperationFailed("Delete", "AQR", "not found or could not be deleted", req, res);
        throw new AppError(404, "AQR not found or could not be deleted");
      }

      ControllerLogger.logSuccess("AQR deleted", id, req, res);

      // Activity log
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.AQR,
        entityName: 'AQR',
        entityId: id,
        description: `${userName} has deleted AQR ${deleted.aqrNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      return res.status(200).json({ status: "success", message: "AQR deleted successfully" });
    } catch (error) {
      ControllerLogger.logError("AQR deletion", error, req, res);
      next(error);
    }
  }

  // ─── Delete Multiple ──────────────────────────────────────────────────────

  @httpDelete("/delete/multiple")
  public async deleteMultipleAqrs(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return next(new AppError(400, "An array of AQR IDs is required"));
      }

      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      const result = await this.aqrService.deleteMultipleAqrs(ids);

      const deletedNos = result.success.map(s => s.aqrNo || s.id).join(', ');

      // Activity log
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.AQR,
        entityName: 'AQR',
        description: `${userName} has bulk deleted ${result.success.length} AQR(s): ${deletedNos}`,
        metadata: { ids, count: ids.length },
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      res.status(200).json({ message: result.message, success: result.success.map(s => s.id), failed: result.failed });
    } catch (error) {
      ControllerLogger.logError("AQR bulk delete", error, req, res);
      next(error);
    }
  }
}




  // ─── Search ───────────────────────────────────────────────────────────────

  // @httpGet("/search/:search")
  // public async searchAqr(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ): Promise<Response | void> {
  //   try {
  //     const { search } = req.params;
  //     const aqr = await this.aqrService.searchAqr(search);

  //     if (!aqr) {
  //       ControllerLogger.logNotFound("AQR", search, req, res);
  //       throw new AppError(404, "AQR not found");
  //     }

  //     ControllerLogger.logView("AQR", search, req, res);
  //     return res.status(200).json({ status: "success", data: aqr });
  //   } catch (error) {
  //     ControllerLogger.logError("AQR search", error, req, res);
  //     next(error);
  //   }
  // }





  // ─── Filter ───────────────────────────────────────────────────────────────

  // @httpGet("/filter")
  // public async filterAqrs(
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
  //       if (value !== undefined && value !== "") filters[key] = value;
  //     }

  //     const result = await this.aqrService.filterAqrs(page, limit, filters);
  //     res.json({ success: true, ...result });
  //   } catch (error) {
  //     ControllerLogger.logError("AQR filter", error, req, res);
  //     next(error);
  //   }
  // }

  // ─── Get By ID ────────────────────────────────────────────────────────────

  // @httpGet("/:id")
  // public async getAqrById(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ): Promise<Response | void> {
  //   try {
  //     const { id } = req.params;
  //     const aqr = await this.aqrService.getAqrById(id);

  //     if (!aqr) {
  //       ControllerLogger.logNotFound("AQR", id, req, res);
  //       throw new AppError(404, "AQR not found");
  //     }

  //     ControllerLogger.logView("AQR", id, req, res);
  //     return res.status(200).json({ status: "success", data: aqr });
  //   } catch (error) {
  //     ControllerLogger.logError("AQR Get", error, req, res);
  //     next(error);
  //   }
  // }


