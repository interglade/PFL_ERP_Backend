import {
  controller,
  httpGet,
  httpPatch,
  httpPost,
  httpDelete,
  next,
  request,
  response,
  requestParam,
} from 'inversify-express-utils';
import { deserializeUser, requireUser, captureUser } from '../../../middleware/deserializeUser';
import { TYPES } from '../../../types';
import { OtherDeliveryChallanService } from '../service/otherDeliveryChallan.service';
import { inject } from 'inversify';
import { NextFunction, Response, Request } from 'express';
import { PaginationOptions } from '../../../utils/pagination';

import { ControllerLogger } from '../../../utils/controllerLogger';

import { UserRepository } from '../../../employee/repository/user.repository';
import { UserActivityLogService } from '../../../employeeActivity/service/userActivityLog.service';

import AppError from '../../../utils/appError';
import { upload, uploadAttachments } from '../../../middleware/upload.middleware';
import { setAttachmentUrls } from '../../../utils/fileUploadHelper';
import { NotificationService } from '../../../notification/service/notification.service';
import { DocumentbService } from '../../../approvalFlow/service/documentb.service';
import { ActivityAction, ActivityModule } from '../../../employeeActivity/entity/userActivityLog.entity';
import { DocumentExportService } from '../../../excel/export/documentExport.service';
import { OTHER_DELIVERY_CHALLAN_EXPORT } from '../excel/otherDeliveryChallan.export';
import { applyDocumentListFilters } from '../../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../../approvalFlow/entity/docuemnt.entity';

@controller('/other-delivery-challan', deserializeUser, requireUser)
export class OtherDeliveryChallanController {
  constructor(
    @inject(TYPES.OtherDeliveryChallanService)
    private readonly otherDeliveryChallanService: OtherDeliveryChallanService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.DocumentbService)
    private readonly documentbService: DocumentbService,
    @inject(TYPES.UserRepository) 
    private readonly userRepository: UserRepository,
    @inject(TYPES.UserActivityLogService)
    private readonly activityLogService: UserActivityLogService,
    @inject(TYPES.DocumentExportService)
    private readonly documentExportService: DocumentExportService,
  ) {}

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
      await this.activityLogService.logActivity({
        userId: user.id,
        userName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        action,
        module: ActivityModule.OTHER_DELIVERY_CHALLAN,
        entityName: 'Other Delivery Challan',
        entityId: options?.entityId,
        description,
        metadata: options?.metadata,
        changes: options?.changes,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: res.statusCode,
      });
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  }

  @httpPost('/', uploadAttachments)
  public async createOtherDeliveryChallan(
    @response() res: Response,
    @request() req: Request,
    @next() next: NextFunction,
  ) {
    try {
      const otherDeliveryChallanData = req.body;
      const requestedBy = res.locals.user.id;
      otherDeliveryChallanData.createdBy = requestedBy;
      otherDeliveryChallanData.requestedBy = requestedBy;
      otherDeliveryChallanData.requestingDepartment = res.locals.user.selectDepartment;

      // Use helper function to handle file URL extraction
      setAttachmentUrls(otherDeliveryChallanData, req.files as any[]);

      const otherDeliveryChallan =
        await this.otherDeliveryChallanService.create(otherDeliveryChallanData);
      if (!otherDeliveryChallan) {
        return next(new AppError(400, 'Other Delivery Challan could not be created'));
      }

      // 🔔 Send SSE notification to creator
      try {
        await this.notificationService.createNoti(
          `Other Delivery Challan ${otherDeliveryChallan.id} created successfully and submitted for approval`,
          requestedBy
        );
      } catch (notifError) {
        console.error('Notification error:', notifError);
        // Don't fail the main operation if notification fails
      }

  ControllerLogger.logSuccess('Other Delivery Challan created', otherDeliveryChallan.id, req, res);

      // Single activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
    this.activityLogService.logActivity({
      userId: res.locals.user.id,
      userName,
      action: ActivityAction.CREATE,
      module: ActivityModule.OTHER_DELIVERY_CHALLAN,
      entityName: 'Other Delivery Challan',
      entityId: otherDeliveryChallan.id,
      description: `${userName} has created Other Delivery Challan ${otherDeliveryChallan.challanNo || otherDeliveryChallan.id}`,
      ipAddress: req.ip || '',
      userAgent: req.get('user-agent'),
      endpoint: req.originalUrl,
      httpMethod: req.method,
      statusCode: 201,
    }).catch(() => {});

      res.status(201).json({
        status: 'success',
        message: 'Other Delivery Challan created successfully',
      });
    } catch (err) {
      ControllerLogger.logError('Other Delivery Challan creation', err, req, res);
      next(err);
    }
  }

  /**
   * GET export/excel - every Other Delivery Challan the user can see in the list, as an .xlsx.
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
      entityName: 'Other Delivery Challan',
      definition: OTHER_DELIVERY_CHALLAN_EXPORT,
      list: { documentType: FilterDocumentType.DC_TYPE_OTHER, searchFields: ['challan.id'] },
      fetchList: (queryOptions, userId) => this.otherDeliveryChallanService.getAll(queryOptions, userId),
    });
  }

  @httpGet('/')
  public async getAllOtherDeliveryChallan(
    @response() res: Response,
    @request() req: Request,
    @next() next: NextFunction,
  ) {
    try {
      const { page, limit, search, sort } = req.query;
      const userId = res.locals.user.id;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        searchFields: ['challan.id'],
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };
      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.DC_TYPE_OTHER);
      const otherDeliveryChallans =
        await this.otherDeliveryChallanService.getAll(queryOptions, userId);

      if (!otherDeliveryChallans) {
        return next(new AppError(404, 'No Other Delivery Challans found'));
      }

      // 📊 Log activity
      // await this.logUserActivity(req, res, ActivityAction.VIEW,
      //   `Viewed all Other Delivery Challans (${otherDeliveryChallans.data.length} items)`,
      //   { metadata: { count: otherDeliveryChallans.data.length, filters: {}, page, limit } }
      // );

      // Log the successful list retrieval
      ControllerLogger.logList('Other Delivery Challan', req, res);

      res.status(200).json({
        status: 'success',
        data: otherDeliveryChallans.data,
        allRecords: otherDeliveryChallans.meta.total,
        totalPages: otherDeliveryChallans.meta.pages,
        page: otherDeliveryChallans.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Other Delivery Challan list retrieval', err, req, res);
      next(err);
    }
  }



  @httpGet('/view/:id')
  public async getOtherDeliveryChallanByIdForView(
    @requestParam('id') id: string,
    @response() res: Response,
    @request() req: Request,
    @next() next: NextFunction,
  ) {
    try {

      const otherDeliveryChallan =
        await this.otherDeliveryChallanService.getByIdChallanforView(id);
      if (!otherDeliveryChallan) {
        return next(new AppError(404, 'Other Delivery Challan not found'));
      }

      const viewedBy = res.locals.user.id;

      // 🔔 Send SSE notification when Other Delivery Challan is viewed by approver
      // try {
      //   const document = await this.documentbService.getDocumentByTypeId(otherDeliveryChallan.id);

      //   if (document && document.approvalFlow) {
      //     const flow = document.approvalFlow;
      //     let isApprover = false;

      //     // Check if viewer is a verifier
      //     if (flow.verifiers && flow.verifiers.length > 0) {
      //       isApprover = flow.verifiers.some((v: any) => v.id === viewedBy);
      //     }

      //     // Check if viewer is an approver
      //     if (!isApprover && flow.approvers) {
      //       const levels = [
      //         flow.approvers.firstApprover,
      //         flow.approvers.secondApprover,
      //         flow.approvers.thirdApprover
      //       ];

      //       for (const level of levels) {
      //         if (level && level.users && level.users.length > 0) {
      //           if (level.users.some((u: any) => u.id === viewedBy)) {
      //             isApprover = true;
      //             break;
      //           }
      //         }
      //       }
      //     }

      //     // If viewer is an approver, notify the creator
      //     if (isApprover && otherDeliveryChallan.createdBy?.id && otherDeliveryChallan.createdBy.id !== viewedBy) {
      //       const viewer = await this.userRepository.findOne({ where: { id: viewedBy } });
      //       const viewerName = viewer ? `${viewer.firstName} ${viewer.lastName}` : 'An approver';

      //       await this.notificationService.createNoti(
      //         `${viewerName} is reviewing Other Delivery Challan ${otherDeliveryChallan.id}`,
      //         res.locals.user.id
      //       );
      //     }
      //   }
      // } catch (notifError) {
      //   console.error('Notification error:', notifError);
      // }

      // Log the successful view
      ControllerLogger.logView('Other Delivery Challan', otherDeliveryChallan.id, req, res);

      res.status(200).json({
        status: 'success',
        data: otherDeliveryChallan,
      });
    } catch (err) {
      ControllerLogger.logError('Other Delivery Challan view', err, req, res);
      next(err);
    }
  }
  @httpGet('/update/:id')
  public async getOtherDeliveryChallanByIdForUpdate(
    @requestParam('id') id: string,
    @response() res: Response,
    @request() req: Request,
    @next() next: NextFunction,
  ) {
    try {
      const otherDeliveryChallan =
        await this.otherDeliveryChallanService.getByIdChallanforUpdate(id);
      if (!otherDeliveryChallan) {
        return next(new AppError(404, 'Other Delivery Challan not found'));
      }

      const requestedBy = res.locals.user.id;

      // 🔔 Send SSE notification when Other Delivery Challan is opened for editing
      // try {
      //   const challanId = otherDeliveryChallan.id || id;

      //   // Notify creator if someone else is editing
      //   if (otherDeliveryChallan.createdBy?.id && otherDeliveryChallan.createdBy.id !== requestedBy) {
      //     const editor = await this.userRepository.findOne({ where: { id: requestedBy } });
      //     const editorName = editor ? `${editor.firstName} ${editor.lastName}` : 'Someone';

      //     await this.notificationService.createNoti(
      //       `${editorName} is editing Other Delivery Challan ${challanId}`,
      //       otherDeliveryChallan.createdBy.id
      //     );
      //   }

      //   // Notify approvers that Other Delivery Challan is being edited
      //   const document = await this.documentbService.getDocumentByTypeId(otherDeliveryChallan.id);
      //   if (document && document.approvalFlow) {
      //     const flow = document.approvalFlow;
      //     const approvers: string[] = [];

      //     if (flow.verifiers && flow.verifiers.length > 0) {
      //       flow.verifiers.forEach((verifier: any) => {
      //         if (verifier.id && verifier.id !== requestedBy) approvers.push(verifier.id);
      //       });
      //     }

      //     if (flow.approvers) {
      //       const levels = [
      //         flow.approvers.firstApprover,
      //         flow.approvers.secondApprover,
      //         flow.approvers.thirdApprover
      //       ];

      //       levels.forEach((level: any) => {
      //         if (level && level.users && level.users.length > 0) {
      //           level.users.forEach((user: any) => {
      //             if (user.id && user.id !== requestedBy) approvers.push(user.id);
      //           });
      //         }
      //       });
      //     }

      //     // Send notification to approvers
      //     for (const approverId of approvers) {
      //       await this.notificationService.createNoti(
      //         `Other Delivery Challan ${challanId} is being edited and may require re-approval`,
      //         approverId
      //       );
      //     }
      //   }
      // } catch (notifError) {
      //   console.error('Notification error:', notifError);
      // }

      // Log the successful view for update
      ControllerLogger.logView('Other Delivery Challan (for update)', otherDeliveryChallan.id, req, res);

      res.status(200).json({
        status: 'success',
        data: otherDeliveryChallan,
      });
    } catch (err) {
      ControllerLogger.logError('Other Delivery Challan view for update', err, req, res);
      next(err);
    }
  }

  @httpPatch('/:id', uploadAttachments, captureUser)
  public async updateOtherDeliveryChallan(
    @requestParam('id') id: string,
    @response() res: Response,
    @request() req: Request,
    @next() next: NextFunction,
  ) {
    try {
      let otherDeliveryChallanData = req.body;

      // ✅ Handle multipart form-data JSON body
      if (req.body.otherDeliveryChallan) {
        otherDeliveryChallanData = JSON.parse(req.body.otherDeliveryChallan);
      }

      // ✅ Handle uploaded image
      // Use helper function to handle file URL extraction
      setAttachmentUrls(otherDeliveryChallanData, req.files as any[]);

      // ✅ Clean 'null' strings
      Object.keys(otherDeliveryChallanData).forEach((key) => {
        if (otherDeliveryChallanData[key] === 'null') otherDeliveryChallanData[key] = null;
      });

      const updatedBy = res.locals.updatedBy;

      const updatedOtherDeliveryChallan =
        await this.otherDeliveryChallanService.update(
          id,
          otherDeliveryChallanData,
        );
      if (!updatedOtherDeliveryChallan) {
        return next(new AppError(404, 'Other Delivery Challan not found or could not be updated'));
      }

      // 🔔 Send SSE notification to updater
      try {
        await this.notificationService.createNoti(
          `Other Delivery Challan ${updatedOtherDeliveryChallan.id} updated successfully`,
          updatedBy
        );

        // 🔔 Notify approvers about the update
        const document = await this.documentbService.getDocumentByTypeId(updatedOtherDeliveryChallan.id);
        if (document && document.approvalFlow) {
          const flow = document.approvalFlow;
          const approvers: string[] = [];

          // Collect verifiers
          if (flow.verifiers && flow.verifiers.length > 0) {
            flow.verifiers.forEach((verifier: any) => {
              if (verifier.id) approvers.push(verifier.id);
            });
          }

          // Collect approvers from approval levels
          if (flow.approvers) {
            const levels = [
              flow.approvers.firstApprover,
              flow.approvers.secondApprover,
              flow.approvers.thirdApprover
            ];

            levels.forEach((level: any) => {
              if (level && level.users && level.users.length > 0) {
                level.users.forEach((user: any) => {
                  if (user.id && user.id !== updatedBy) approvers.push(user.id);
                });
              }
            });
          }

          // Send notifications to approvers
          for (const approverId of approvers) {
            await this.notificationService.createNoti(
              `Other Delivery Challan ${updatedOtherDeliveryChallan.id} has been updated and requires re-approval`,
              approverId
            );
          }
        }
      } catch (notifError) {
        console.error('Notification error:', notifError);
      }

      // Log the successful update
      ControllerLogger.logSuccess('Other Delivery Challan updated', updatedOtherDeliveryChallan.id, req, res);

       // Activity log
       const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.OTHER_DELIVERY_CHALLAN,
        entityName: 'Other Delivery Challan',
        entityId: id,
        description: `${userName} has updated Other Delivery Challan ${updatedOtherDeliveryChallan.challanNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      res.status(200).json({
        status: 'success',
        message: 'Other Delivery Challan updated successfully',
        data: updatedOtherDeliveryChallan,
      });
    } catch (err) {
      ControllerLogger.logError('Other Delivery Challan update', err, req, res);
      next(err);
    }
  }

  @httpDelete('/:id')
  public async deleteOtherDeliveryChallan(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const deletedBy = res.locals.user.id;

      // Get Other Delivery Challan details before deletion for notification
      // const challan = await this.otherDeliveryChallanService.getById(id);
      // const challanId = challan?.data?.id || id;

      const success = await this.otherDeliveryChallanService.delete(id);
      if (!success) {
        return next(new AppError(404, 'Other Delivery Challan not found or could not be deleted'));
      }

      // 🔔 Send SSE notification to deleter
      // try {
      //   await this.notificationService.createNoti(
      //     `Other Delivery Challan ${challanId} deleted successfully`,
      //     deletedBy
      //   );

        // 🔔 Notify relevant users about deletion
      //   if (challan?.data) {
      //     // Notify creator if different from deleter
      //     if (challan.data.createdBy?.id && challan.data.createdBy.id !== deletedBy) {
      //       await this.notificationService.createNoti(
      //         `Other Delivery Challan ${challanId} has been deleted`,
      //         challan.data.createdBy.id
      //       );
      //     }

      //     // Notify approvers about deletion
      //     const document = await this.documentbService.getDocumentByTypeId(id);
      //     if (document && document.approvalFlow) {
      //       const flow = document.approvalFlow;
      //       const notifyUsers: string[] = [];

      //       if (flow.verifiers && flow.verifiers.length > 0) {
      //         flow.verifiers.forEach((verifier: any) => {
      //           if (verifier.id && verifier.id !== deletedBy) notifyUsers.push(verifier.id);
      //         });
      //       }

      //       if (flow.approvers) {
      //         const levels = [
      //           flow.approvers.firstApprover,
      //           flow.approvers.secondApprover,
      //           flow.approvers.thirdApprover
      //         ];

      //         levels.forEach((level: any) => {
      //           if (level && level.users && level.users.length > 0) {
      //             level.users.forEach((user: any) => {
      //               if (user.id && user.id !== deletedBy) notifyUsers.push(user.id);
      //             });
      //           }
      //         });
      //       }

      //       for (const userId of notifyUsers) {
      //         await this.notificationService.createNoti(
      //           `Other Delivery Challan ${challanId} has been deleted`,
      //           userId
      //         );
      //       }
      //     }
      //   }
      // } catch (notifError) {
      //   console.error('Notification error:', notifError);
      // }

      ControllerLogger.logSuccess('Other Delivery Challan deleted', id, req, res);

      // Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.OTHER_DELIVERY_CHALLAN,
        entityName: 'Other Delivery Challan',
        entityId: id,
        description: `${userName} has deleted Other Delivery Challan ${success.No || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});


      res.status(200).json({
        status: 'success',
        message: 'Other Delivery Challan deleted successfully',
      });
    } catch (error) {
      ControllerLogger.logError('Other Delivery Challan deletion', error, req, res);
      next(error);
    }
  }



  @httpDelete('/delete/multiple')
  public async deleteMultipleOtherDeliveryChallans(
    @request() req: Request<{}, {}, { ids: string[] }>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return next(new AppError(400, 'An array of Other Delivery Challan IDs is required'));
      }

      const result = await this.otherDeliveryChallanService.deleteMultipleOtherDeliveryChallans(ids);
      const deletedNos = result.success.map(s => s.No || s.id).join(', ');

      ControllerLogger.logSuccess(`${ids.length} Other Delivery Challans soft deleted`, ids.join(', '), req, res);

       // Activity log
       const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.OTHER_DELIVERY_CHALLAN,
        entityName: 'Other Delivery Challan',
        description: `${userName} has bulk deleted ${result.success.length} Other Delivery Challan(s): ${deletedNos}`,
        metadata: { ids, count: ids.length },
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});


      res.status(200).json({
        status: 'success',
        message: result.message,
        success: result.success,
        failed: result.failed,
      });
    } catch (error) {
      ControllerLogger.logError('Multiple Other Delivery Challans deletion', error, req, res);
      next(error);
    }
  }
}


  // @httpGet('/:id')
  // public async getOtherDeliveryChallanById(
  //   @requestParam('id') id: string,
  //   @response() res: Response,
  //   @request() req: Request,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const otherDeliveryChallan =
  //       await this.otherDeliveryChallanService.getById(id);
  //     if (!otherDeliveryChallan) {
  //       return next(new AppError(404, 'Other Delivery Challan not found'));
  //     }

  //     const accessedBy = res.locals.user.id;

  //     // 🔔 Send SSE notification when Other Delivery Challan is accessed
  //     // try {
  //     //   const document = await this.documentbService.getDocumentByTypeId(otherDeliveryChallan.data.id);

  //     //   if (document && document.approvalFlow) {
  //     //     const flow = document.approvalFlow;
  //     //     let isApprover = false;

  //     //     // Check if accessor is a verifier
  //     //     if (flow.verifiers && flow.verifiers.length > 0) {
  //     //       isApprover = flow.verifiers.some((v: any) => v.id === accessedBy);
  //     //     }

  //     //     // Check if accessor is an approver
  //     //     if (!isApprover && flow.approvers) {
  //     //       const levels = [
  //     //         flow.approvers.firstApprover,
  //     //         flow.approvers.secondApprover,
  //     //         flow.approvers.thirdApprover
  //     //       ];

  //     //       for (const level of levels) {
  //     //         if (level && level.users && level.users.length > 0) {
  //     //           if (level.users.some((u: any) => u.id === accessedBy)) {
  //     //             isApprover = true;
  //     //             break;
  //     //           }
  //     //         }
  //     //       }
  //     //     }

  //     //     // If accessor is an approver, notify the creator
  //     //     if (isApprover && otherDeliveryChallan.data.createdBy?.id && otherDeliveryChallan.data.createdBy.id !== accessedBy) {
  //     //       const accessor = await this.userRepository.findOne({ where: { id: accessedBy } });
  //     //       const accessorName = accessor ? `${accessor.firstName} ${accessor.lastName}` : 'An approver';

  //     //       await this.notificationService.createNoti(
  //     //         `${accessorName} viewed Other Delivery Challan ${otherDeliveryChallan.data.id}`,
  //     //         otherDeliveryChallan.data.createdBy.id
  //     //       );
  //     //     }
  //     //   }
  //     // } catch (notifError) {
  //     //   console.error('Notification error:', notifError);
  //     // }

  //     // 📊 Log activity
  //     await this.logUserActivity(req, res, ActivityAction.VIEW,
  //       `Viewed Other Delivery Challan ${otherDeliveryChallan.data.id}`,
  //       { 
  //         entityId: otherDeliveryChallan.data.id,
  //         metadata: { challanId: otherDeliveryChallan.data.id }
  //       }
  //     );

  //     // Log the successful view
  //     ControllerLogger.logView('Other Delivery Challan', id, req, res);

  //     res.status(200).json({
  //       status: 'success',
  //       data: otherDeliveryChallan.data,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Other Delivery Challan view', err, req, res);
  //     next(err);
  //   }
  // }

