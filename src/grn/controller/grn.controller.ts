import { inject } from 'inversify';
import {
  controller,
  httpPost,
  httpGet,

  httpDelete,
  request,
  requestParam,
  response,
  next,
 
  httpPut,
} from 'inversify-express-utils';
import { TYPES } from '../../types';
import { NextFunction, Request, Response } from 'express';
import AppError from '../../utils/appError'; // Custom error handling

import {
  captureUser,
  deserializeUser,
  requireUser,
} from '../../middleware/deserializeUser';
import { Source, CompanyName } from '../../utils/status.enum';

import logger from '../../utils/logger';
import { http } from 'winston';

import ExcelJS from 'exceljs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

import { PaginationOptions } from '../../utils/pagination';

import { UserRepository } from '../../employee/repository/user.repository';
import { UserActivityLogService } from '../../employeeActivity/service/userActivityLog.service';

import { ControllerLogger } from '../../utils/controllerLogger';
import { uploadSingle } from '../../middleware/uploadsingle.middleware';
import { NotificationService } from '../../notification/service/notification.service';
import { DocumentbService } from '../../approvalFlow/service/documentb.service';
import { GrnService } from '../service/grn.service';
import { GrnRepository } from '../repository/grn.repository';
import { ActivityAction, ActivityModule } from '../../employeeActivity/entity/userActivityLog.entity';
import { CreateGrnDto, UpdateGrnDto } from '../dto/grn.dto';
import { DocumentExportService } from '../../excel/export/documentExport.service';
import { GRN_EXPORT } from '../excel/grn.export';
import { applyDocumentListFilters } from '../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../approvalFlow/entity/docuemnt.entity';


@controller('/grns', deserializeUser, requireUser)
export class GrnController {
  private s3Client: S3Client;
  private bucketName: string;
  constructor(
    @inject(TYPES.GrnService) private readonly grnService: GrnService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.DocumentbService)
    private readonly documentbService: DocumentbService,
    @inject(TYPES.GrnRepository) private readonly grnRepository: GrnRepository,
    @inject(TYPES.UserRepository) private readonly userRepository: UserRepository,
    @inject(TYPES.UserActivityLogService)
    private readonly activityLogService: UserActivityLogService,
    @inject(TYPES.DocumentExportService)
    private readonly documentExportService: DocumentExportService,

  ) {
    this.s3Client = new S3Client({
      credentials: {
        accessKeyId: process.env.ACCESS_KEY!,
        secretAccessKey: process.env.ACCESS_SECRET!,
      },
      region: process.env.REGION!,
    });
    this.bucketName = process.env.BUCKET_NAME!;
  }

  /**
   * Helper method to log user activity
   */
  private async logUserActivity(
    req: Request,
    res: Response,
    action: ActivityAction,
    description: string,
    options?: {
      entityId?: string;
      metadata?: Record<string, any>;
      changes?: Record<string, { oldValue: any; newValue: any }>;
    }
  ): Promise<void> {
    try {
      const user = res.locals.user;
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      await this.activityLogService.logActivity({
        userId: user.id,
        userName,
        action,
        module: ActivityModule.GRN,
        entityName: 'GRN',
        entityId: options?.entityId,
        description,
        metadata: options?.metadata,
        changes: options?.changes,
        ipAddress: req.ip ||'',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: res.statusCode,
      });
    } catch (error) {
      logger.error('Failed to log activity:', error);
    }
  }

  //TODO: Create GRN
  @httpPost('/', uploadSingle.single('billImage'))
  public async createGrn(
    @request() req: Request<{}, {}, CreateGrnDto>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      
      const grnData:CreateGrnDto = req.body;
console.log(req.body);
      if (req.file) {
        const imageUrl = (req.file as any).location;
        console.log("imageurl..............",imageUrl);
        if (imageUrl) {
          grnData.billImage = imageUrl;
        }
      }

      console.log("billImage.......",grnData.billImage);

      // Object.keys(req.body).forEach((key) => {
      //   if (grnData[key] === "null") grnData[key] = null;
      // });

      const requestedBy = res.locals.user.id;

      //const baseLocation = res.locals.user.relocationPlace;
      grnData.createdBy = requestedBy;
      grnData.requestedBy = requestedBy;
      // grnData.baseLocation = baseLocation;
      grnData.requestingDepartment = res.locals.user.selectDepartment;
      //if (grnData === '')
        if (grnData.source === Source.VENDOR && !grnData.selectedParty) {
          
          return next(
            new AppError(
              400,
              'Vendor must be provided when the source is vendor',
            ),
          );
        } else if (grnData.source === Source.FARMER && !grnData.selectedParty) {
         
          return next(
            new AppError(
              400,
              'Farmer must be provided when the source is farmer',
            ),
          );
        }

      if (grnData.source === Source.VENDOR) {
        grnData.selectedVendor = { id: grnData.selectedParty };
        grnData.expectedHarvestDate = null;
      } else if (grnData.source === Source.FARMER) {
        grnData.selectedFarmer = { id: grnData.selectedParty };
      }

      //console.log("Final GRN Data:", grnData);

      const newGrn = await this.grnService.createGrn(grnData);
      if (!newGrn) {
        
        return next(new AppError(400, 'GRN could not be created'));
      }
      

      // 🔔 Send SSE notification to creator
      // try {
      //   await this.notificationService.createNoti(
      //     `GRN ${newGrn.grnNo} created successfully and submitted for approval`,
      //     requestedBy
      //   );
       
      // } catch (notifError) {
        
      //   // Don't fail the main operation if notification fails
      // }

      // // 🔔 Notify approvers if approval flow exists
      // try {
      //   // Get the Document record for this GRN with approval flow
      //   const document = await this.documentbService.getDocumentByTypeId(newGrn.id);

      //   if (document && document.approvalFlow) {
      //     const flow = document.approvalFlow;
      //     const approvers: string[] = [];

      //     // Collect verifiers
      //     if (flow.verifiers && flow.verifiers.length > 0) {
      //       flow.verifiers.forEach((verifier: any) => {
      //         if (verifier.id) approvers.push(verifier.id);
      //       });
      //     }

      //     // Collect approvers from approval levels
      //     if (flow.approvers) {
      //       const levels = [
      //         flow.approvers.firstApprover,
      //         flow.approvers.secondApprover,
      //         flow.approvers.thirdApprover
      //       ];

      //       levels.forEach((level: any) => {
      //         if (level && level.users && level.users.length > 0) {
      //           level.users.forEach((user: any) => {
      //             if (user.id) approvers.push(user.id);
      //           });
      //         }
      //       });
      //     }

      //     // Send notifications to all approvers
      //     for (const approverId of approvers) {
      //       await this.notificationService.createNoti(
      //         `New GRN ${newGrn.grnNo} requires your approval`,
      //         approverId
      //       );
            
      //     }
      //   }
      // } catch (approverNotifError) {
       
      //   // Don't fail the main operation
      // }

      // 📊 Log user activity
        const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
        await this.activityLogService.logActivity({
          userId: requestedBy,
          userName,
          action: ActivityAction.CREATE,
          module: ActivityModule.GRN,
          entityName: 'GRN',
          entityId: newGrn.id,
          description: `${userName} has created GRN ${newGrn.grnNo || newGrn.id}`,
          // metadata: {
          //   grnNo: newGrn.grnNo,
          //   totalAmt: newGrn.totalAmt,
          //   source: newGrn.source,
          //   purchaseLocation: newGrn.purchaseLocation,
          // },
          ipAddress: req.ip || '',
          userAgent: req.get('user-agent'),
          endpoint: req.originalUrl,
          httpMethod: req.method,
          statusCode: 201,
        }).catch(()=>{});
      ControllerLogger.logSuccess('GRN created', newGrn.id, req, res);

      res.status(201).json({
        status: 'success',
        message: 'GRN created successfully',
        //data: newGrn,
      });
    } catch (error) {
      ControllerLogger.logError('GRN creation', error, req, res);
      console.log(error);
      if (error instanceof Error) {
               return next(new AppError(400, error.message)); // ← sends 400 with real message
             }
      next(error);
    }
  }

  //TODO: Get All Recycle Bin GRN
  @httpGet('/recycle-bin')
  public async getAllRecycleBinGrns(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
     
      const { page, limit, search, sort, rfpaId, companyName, source, grnType, locationType } = req.query;
      const userId = res.locals.user.id;
      // const userRole = res.locals.user.role;
      // if (userRole !== "SuperAdmin")
      //   return res.status(403).json({ message: "Access denied" });

      //TODO: Shri
      const filters: any = {};
      if (companyName) filters.companyName = companyName; // GRN field
      if (source) filters.source = source; // GRN field
      if (grnType) filters.grnType = grnType; // GRN field
      if (locationType) filters.locationType = locationType; // GRN field
      //if (status) filters.status = status; // Document field
      //if (remarks) filters.remarks = remarks;




      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        searchFields: ['grn.grnNo'],
        filters,
        sort: (sort as string) || undefined, // Adjust this line to match your sorting requirements
        search: (search as string) || '',
      };
      const grns = await this.grnService.getAllRecycleBinGrns(queryOptions, userId);
      //console.log(grns)
      if (!grns) {
        
        return next(new AppError(404, 'No GRNs found'));
      }

      // 🔔 Send notification for accessing recycle bin
      // try {
      //   await this.notificationService.createNoti(
      //     `Accessed GRN recycle bin (${grns.data.length} items)`,
      //     userId
      //   );
      // } catch (notifError) {
      //   console.log('Notification error:', notifError);
      // }
      
      ControllerLogger.logList('GRN Recycle Bin', req, res);

      res.status(200).json({
        status: 'success',
        data: grns.data,
        allRecords: grns.meta.total,
        totalPages: grns.meta.pages,
        page: grns.meta.page,
      });
    } catch (error) {
      ControllerLogger.logError('GRN recycle bin retrieval', error, req, res);
      next(error);
    }
  }
  /**
   * GET export/excel - every GRN the user can see in the list, as an .xlsx.
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
      entityName: 'GRN',
      definition: GRN_EXPORT,
      list: { documentType: FilterDocumentType.GRN, searchFields: ['grn.grnNo'], filterKeys: ['companyName', 'source', 'grnType', 'locationType'] },
      fetchList: (queryOptions, userId) => this.grnService.getAllGrns(queryOptions, userId),
    });
  }

  //TODO: GRN get all
  @httpGet('/')
  public async getAllGrns(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {

      const { page, limit, search, sort, rfpaId, companyName, source, grnType, locationType } = req.query;
      const userId = res.locals.user.id;

      //TODO: Shri
      const filters: any = {};
      if (companyName) filters.companyName = companyName; // GRN field
      if (source) filters.source = source; // GRN field
      if (grnType) filters.grnType = grnType; // GRN field
      if (locationType) filters.locationType = locationType; // GRN field
      //if (status) filters.status = status; // Document field
      //if (remarks) filters.remarks = remarks;




      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        searchFields: ['grn.grnNo'],
        filters,
        sort: (sort as string) || undefined, // Adjust this line to match your sorting requirements
        search: (search as string) || '',
      };
      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.GRN);
      const grns = await this.grnService.getAllGrns(queryOptions, userId);
      //console.log(grns)
      if (!grns) {
        
        return next(new AppError(404, 'No GRNs found'));
      }
      
      
      // � Soend notification for accessing main GRN list
      // try {
      //   await this.notificationService.createNoti(
      //     `Accessed GRN list (${grns.data.length} items found)`,
      //     userId
      //   );
      // } catch (notifError) {
      //   console.log('Notification error:', notifError);
      // }

      // 📊 Log activity
      // await this.logUserActivity(req, res, ActivityAction.VIEW,
      //   `Viewed all GRNs (${grns.data.length} items)`,
      //   { metadata: { count: grns.data.length, filters, page, limit } }
      // );

      ControllerLogger.logList('GRN', req, res);

      res.status(200).json({
        status: 'success',
        data: grns.data,

        allRecords: grns.meta.total,
        totalPages: grns.meta.pages,
        page: grns.meta.page,
      });
    } catch (error) {
      ControllerLogger.logError('GRN list retrieval', error, req, res);
      next(error);
    }
  }

  //TODO: GRN get by id for view
  @httpGet('/view/:docid')
  public async getGrnByIdForView(
    @requestParam('docid') docid: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      

      const grn = await this.grnService.getGrnByIdForView(docid);
      if (!grn) {
        return next(new AppError(404, 'GRN not found'));
      }
      
      const viewedBy = res.locals.user.id;

      // 🔔 Send SSE notification when GRN is viewed by approver
    

      ControllerLogger.logView('GRN', grn.id, req, res);

      res.status(200).json({
        status: 'success',
        data: grn,
      });
    } catch (error) {
      ControllerLogger.logError('GRN view', error, req, res);
      next(error);
    }
  }

  //TODO: GRN get by id for update
  @httpGet('/update/:id')
  public async getGrnByIdForupdate(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      
      const grn = await this.grnService.getGrnByIdForupdate(id);
      //console.log(grn);
      if (!grn) {
        return next(new AppError(404, 'GRN not found'));
      }
  
      const requestedBy = res.locals.user.id;

     

        // Notify approvers that GRN is being edited
        const document = await this.documentbService.getDocumentByTypeId(grn.id);
      

      ControllerLogger.logView('GRN (for update)', grn.id, req, res);

      res.status(200).json({
        status: 'success',
        data: grn,
      });
    } catch (error) {
      ControllerLogger.logError('GRN retrieval for update', error, req, res);
      next(error);
    }
  }

  @httpGet('/grnnumbers/getAllgrnNo')
  public async getAllGrnNumbers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {

    //   isAQRCreated?: boolean;
    // isInwardCreated?: boolean;
    // isDumpCreated?: boolean;
    // isDCForCustomerCreated?: boolean;
    // isMCVoucherCreated?: boolean;
    // isTPVoucherCreated?: boolean;
    // isPMPVoucherCreated?: boolean;
    // isLPVoucherCreated?: boolean;

    const isAQRCreated = req.query.isAQRCreated === 'true' ? true : req.query.isAQRCreated === 'false' ? false : undefined;
    const isInwardCreated = req.query.isInwardCreated === 'true' ? true : req.query.isInwardCreated === 'false' ? false : undefined;
    const isDumpCreated = req.query.isDumpCreated === 'true' ? true : req.query.isDumpCreated === 'false' ? false : undefined;
    const isDCForCustomerCreated = req.query.isDCForCustomerCreated === 'true' ? true : req.query.isDCForCustomerCreated === 'false' ? false : undefined;
    const isMCVoucherCreated = req.query.isMCVoucherCreated === 'true' ? true : req.query.isMCVoucherCreated === 'false' ? false : undefined;
    const isTPVoucherCreated = req.query.isTPVoucherCreated === 'true' ? true : req.query.isTPVoucherCreated === 'false' ? false : undefined;
    const isPMPVoucherCreated = req.query.isPMPVoucherCreated === 'true' ? true : req.query.isPMPVoucherCreated === 'false' ? false : undefined;
    const isLPVoucherCreated = req.query.isLPVoucherCreated === 'true' ? true : req.query.isLPVoucherCreated === 'false' ? false : undefined;

    const userId = res.locals.user.id;

      const grns = await this.grnService.getAllGrnNumbers({...req.query, isAQRCreated, isInwardCreated, isDumpCreated, isDCForCustomerCreated, isMCVoucherCreated, isTPVoucherCreated, isPMPVoucherCreated, isLPVoucherCreated}, userId); // Call the service method
      if (!grns || grns.length === 0) {
        return next(new AppError(404, 'No GRNs found'));
      }

      // 🔔 Send notification for accessing GRN numbers
      // try {
      //   const userId = res.locals.user.id;
      //   await this.notificationService.createNoti(
      //     `Retrieved all GRN numbers (${grns.length} items)`,
      //     userId
      //   );
      // } catch (notifError) {
      //   console.log('Notification error:', notifError);
      // }
     
      ControllerLogger.logList('GRN Numbers', req, res);

      res.status(200).json({
        status: 'success',
        data: grns.data, // Respond with the fetched GRN data
        allRecords: grns.pagination.total,
        totalPages: grns.pagination.pages,
        page: grns.pagination.page,
      });
    } catch (error) {
      ControllerLogger.logError('GRN numbers retrieval', error, req, res);
      next(error); // Pass any errors to the error-handling middleware
    }
  }

  //TODO: Update GRN by Image(Billing)
  @httpPut('/:id', uploadSingle.single('billImage'), captureUser)
  public async updateGrn(
    @requestParam('id') id: string,
    @request() req: Request<{}, {}, UpdateGrnDto>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
     

      let grnData: UpdateGrnDto = req.body;
      const requestBody = req.body as UpdateGrnDto & { grn?: string };

      // ✅ Handle multipart form-data JSON body
      if (requestBody.grn) {
        grnData = JSON.parse(requestBody.grn) as UpdateGrnDto;
      }

      // ✅ Handle uploaded image
      if (req.file) {
        const imageUrl = req.file.path;
        if (imageUrl) grnData.billImage = imageUrl;
      }

      // ✅ Clean 'null' strings
      (Object.keys(grnData) as Array<keyof UpdateGrnDto>).forEach((key) => {
        if (grnData[key] === 'null') {
          grnData[key] = null as any;
        }
      });

      const updatedBy = res.locals.updatedBy;

      const updatedGrn = await this.grnService.updateGrn(id, grnData, updatedBy);

      if (!updatedGrn) {
        return next(new AppError(404, 'GRN not found or could not be updated'));
      }

      // 🔔 Send SSE notification to updater
      const user=res.locals.user?.id;
        await this.notificationService.createNoti(
          `GRN ${updatedGrn.grnNo} updated successfully`,
          user
        );
        // Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.GRN,
        entityName: 'GRN',
        entityId: id,
        description: `${userName} has updated GRN ${updatedGrn.grnNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
        
      ControllerLogger.logSuccess('GRN updated', updatedGrn.id, req, res);

      res.status(200).json({
        status: 'success',
        message: 'GRN updated successfully',
        data: updatedGrn,
      });
    } catch (error) {
      ControllerLogger.logError('GRN update', error, req, res);
      next(error);
    }
  }


  //TODO: GRN delete by id
  @httpDelete('/:id')
  public async deleteGrn(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const deletedBy = res.locals.user.id;

     
      const success = await this.grnService.deleteGrn(id);
      if (!success) {
        return next(new AppError(404, 'GRN not found or could not be deleted'));
      }

      // 🔔 Send SSE notification to deleter
      
        // await this.notificationService.createNoti(
        //   `GRN ${grnNo} deleted successfully`,
        //   deletedBy
        // );
        
         // Activity log

      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.GRN,
        entityName: 'GRN',
        entityId: id,
        description: `${userName} has deleted GRN ${success.No || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      ControllerLogger.logSuccess('GRN deleted', id, req, res);

      res.status(200).json({
        status: 'success',
        message: 'Grn deleted successfully',
      });
    } catch (error) {
      ControllerLogger.logError('GRN deletion', error, req, res);
      next(error);
    }
  }



  @httpDelete('/delete/multiple')
  public async deleteMultipleGrns(
    @request() req: Request<{}, {}, { ids: string[] }>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
      
        return next(new AppError(400, 'An array of GRN IDs is required'));
      }

      const result = await this.grnService.deleteMultipleGrns(ids);
      const deletedNos = result.success.map(s => s.No || s.id).join(', ');

// await this.notificationService.createNoti(
//           `${ids.length} GRNs deleted successfully`,
//           deletedBy
//         );
      // 🔔 Send SSE notification to deleter
    

      // Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.GRN,
        entityName: 'GRN',
        description: `${userName} has bulk deleted ${result.success.length} GRN(s): ${deletedNos}`,
        metadata: { ids, count: ids.length },
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});


      ControllerLogger.logSuccess(`${ids.length} GRNs deleted`, ids.join(', '), req, res);

      res.status(200).json({
        message: result.message,
      });
    } catch (error) {
      ControllerLogger.logError('Multiple GRNs deletion', error, req, res);
      next(error);
    }
  }

  /**
   * GET /grns/:id/product-history
   * Returns the full edit history for all products in a GRN.
   * Use this endpoint to test the history feature.
   *
   * Response example:
   * [
   *   { grnProductId, productId, version, oldQuantity, newQuantity,
   *     oldRate, newRate, modifiedBy, modifiedAt }
   * ]
   */
  @httpGet('/product-history/:id')
  public async getGrnProductHistory(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const history = await this.grnService.getGrnProductHistory(id);
      res.status(200).json({
        status: 'success',
        data: history,
      });
    } catch (error) {
      ControllerLogger.logError('GRN product history retrieval', error, req, res);
      next(error);
    }
  }

  // TODO: Update GRN amount status (paid / unpaid)
  @httpPut('/amount-status/:id')
  public async updateAmountStatus(
    @requestParam('id') id: string,
    @request() req: Request<{ id: string }, {}, { ammountStatus: string }>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { ammountStatus: status } = req.body;
console.log(req.body)
      if (!status || !['paid', 'unpaid'].includes(status)) {
        return next(new AppError(400, 'Invalid status. Must be "paid" or "unpaid"'));
      }

      const result = await this.grnService.updateAmountStatus(id, status as any);

      ControllerLogger.logSuccess('GRN amount status updated', id, req, res);

      res.status(200).json({
        status: 'success',
        message: `GRN amount status updated`,
        //data: result,
      });
    } catch (error) {
      ControllerLogger.logError('GRN amount status update', error, req, res);
      next(error);
    }
  }

}




  // //TODO: Get all grn
  // @httpGet("/getall/grns")
  // async getAllGrn(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
  //   try {
  //     const resutl = await this.grnRepository.find();

  //     // 🔔 Send notification for accessing all GRNs
  //     // try {
  //     //   const userId = res.locals.user.id;
  //     //   await this.notificationService.createNoti(
  //     //     `Retrieved all GRNs from database (${resutl.length} items)`,
  //     //     userId
  //     //   );
  //     // } catch (notifError) {
  //     //   console.log('Notification error:', notifError);
  //     // }

  //     ControllerLogger.logList('All GRNs', req, res);
  //     res.status(200).json({ status: 'success', data: resutl });
  //   } catch (error) {
  //     ControllerLogger.logError('All GRNs retrieval', error, req, res);
  //     next(error);
  //   }
  // }





  // //TODO: Fetch GRN details by id
  // @httpGet('/details/:id')
  // public async getGrnDetails(
  //   @requestParam('id') id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
      
  //     const grnDetails = await this.grnService.getGrnDetails(id);
  //     if (!grnDetails) {
  //       return next(new AppError(404, 'GRN details not found'));
  //     }

  //     // 🔔 Send notification for accessing GRN details
  //     // try {
  //     //   const userId = res.locals.user.id;
  //     //   const grnNo = grnDetails.grnNo || id;
  //     //   await this.notificationService.createNoti(
  //     //     `Viewed detailed information for GRN ${grnNo}`,
  //     //     userId
  //     //   );
  //     // } catch (notifError) {
  //     //   console.log('Notification error:', notifError);
  //     // }
      
  //     ControllerLogger.logView('GRN Details', id, req, res);

  //     res.status(200).json({
  //       status: 'success',
  //       data: grnDetails,
  //     });
  //   } catch (error) {
  //     ControllerLogger.logError('GRN details retrieval', error, req, res);
  //     next(error);
  //   }
  // }




//TODO: Get all GRN numbers
  // @httpGet('/grnnumbers/getAllgrnNo')
  // public async getAllGrnNumbers(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const grns = await this.grnService.getAllGrnNumbers(); // Call the service method
  //     if (!grns || grns.length === 0) {
  //       return next(new AppError(404, 'No GRNs found'));
  //     }

  //     // 🔔 Send notification for accessing GRN numbers
  //     try {
  //       const userId = res.locals.user.id;
  //       await this.notificationService.createNoti(
  //         `Retrieved all GRN numbers (${grns.length} items)`,
  //         userId
  //       );
  //     } catch (notifError) {
  //       console.log('Notification error:', notifError);
  //     }
     
  //     ControllerLogger.logList('GRN Numbers', req, res);

  //     res.status(200).json({
  //       status: 'success',
  //       data: grns, // Respond with the fetched GRN data
  //     });
  //   } catch (error) {
  //     ControllerLogger.logError('GRN numbers retrieval', error, req, res);
  //     next(error); // Pass any errors to the error-handling middleware
  //   }
  // }




  //approve grn
  // @httpPost('/request/:grnId')
  // async requestApproval(@requestParam('grnId') grnId: string,
  // @response() res: Response,
  // ) {
  //   try {
  //     const requestedBy = res.locals.user.id;
  //     const approval = await this.grnService.requestApproval(grnId,requestedBy);
  //     res.status(201).json(approval);
  //   } catch (err) {
  //     res.status(400).json({ err });
  //   }
  // }

  // @httpGet('/getall/get-pending-approvals')
  // async getPendingApprovals(
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const userId = res.locals.user.id;
  //     const pendingApprovals = await this.grnService.getPendingGrns(userId);
  //     res.status(200).json({
  //       status: "success",
  //       data: pendingApprovals,
  //     });
  //   } catch (error) {
  //     logger.error("Error fetching pending approvals:", error);
  //     next(error);
  //   }
  // }

  //TODO: Get all pending approvals
  // @httpGet('/getAll')
  // async getAllPendingApprovals(
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const userId = res.locals.user.id;
  //     const result = await this.grnService.getAllPendingApprovals();
  //   } catch (error) {
  //      logger.error("Error fetching pending approvals:", error);
  //      next(error);
  //   }
  // }





 // //TODO: GRN get by id
  // @httpGet('/:id')
  // public async getGrnById(
  //   @requestParam('id') id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
      
      
  //     const grn = await this.grnService.getGrnById(id);
  //     //console.log(grn);
  //     if (!grn) {
  //       return next(new AppError(404, 'GRN not found'));
  //     }
      
  //     const accessedBy = res.locals.user.id;

  //     // 🔔 Send SSE notification when GRN is accessed
  //     try {
  //       const document = await this.documentbService.getDocumentByTypeId(grn.id);

  //       if (document && document.approvalFlow) {
  //         const flow = document.approvalFlow;
  //         let isApprover = false;

  //         // Check if accessor is a verifier
  //         if (flow.verifiers && flow.verifiers.length > 0) {
  //           isApprover = flow.verifiers.some((v: any) => v.id === accessedBy);
  //         }

  //         // Check if accessor is an approver
  //         if (!isApprover && flow.approvers) {
  //           const levels = [
  //             flow.approvers.firstApprover,
  //             flow.approvers.secondApprover,
  //             flow.approvers.thirdApprover
  //           ];

  //           for (const level of levels) {
  //             if (level && level.users && level.users.length > 0) {
  //               if (level.users.some((u: any) => u.id === accessedBy)) {
  //                 isApprover = true;
  //                 break;
  //               }
  //             }
  //           }
  //         }

  //         // If accessor is an approver, notify the creator
  //         if (isApprover && grn.createdBy?.id && grn.createdBy.id !== accessedBy) {
  //           const accessor = await this.userRepository.findOne({ where: { id: accessedBy } });
  //           const accessorName = accessor ? `${accessor.firstName} ${accessor.lastName}` : 'An approver';

  //           // await this.notificationService.createNoti(
  //           //   `${accessorName} viewed GRN ${grn.grnNo}`,
  //           //   grn.createdBy.id
  //           // );
            
  //         }
  //       }
  //     } catch (notifError) {
        
  //     }

  //     // 📊 Log activity
  //     await this.logUserActivity(req, res, ActivityAction.VIEW,
  //       `Viewed GRN ${grn.grnNo}`,
  //       { 
  //         entityId: grn.id,
  //         metadata: { grnNo: grn.grnNo, totalAmt: grn.totalAmt }
  //       }
  //     );

  //     ControllerLogger.logView('GRN', grn.id, req, res);

  //     res.status(200).json({
  //       status: 'success',
  //       data: grn,
  //     });
  //   } catch (error) {
  //     ControllerLogger.logError('GRN view', error, req, res);
  //     next(error);
  //   }
  // }
