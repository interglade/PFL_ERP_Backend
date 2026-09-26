import { inject } from 'inversify';
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
  httpPut,
} from 'inversify-express-utils';
import { TYPES } from '../../types';
import { NextFunction, Request, Response } from 'express';
import AppError from '../../utils/appError';
import { FarmerService } from '../service/farmer.service';
import {
  captureUser,
  deserializeUser,
  requireUser,
} from '../../middleware/deserializeUser';


import { PaginationOptions } from '../../utils/pagination';
import { upload } from '../../middleware/upload.middleware';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../../middleware/spaces.config';
import { PdfGeneratorService } from '../../utils/pdfGenerator';
import { CreateFarmerDto } from '../dto/farmer.dto';
import { Status } from '../../utils/status.enum';
import { ControllerLogger } from '../../utils/controllerLogger';
import { uploadSingle } from '../../middleware/uploadsingle.middleware';
import { UserActivityLogService } from '../../employeeActivity/service/userActivityLog.service';
import { NotificationService } from '../../notification/service/notification.service';
import { ActivityAction, ActivityModule } from '../../employeeActivity/entity/userActivityLog.entity';
import { Role } from '../../employee/entity/user.entity';


@controller('/farmers',deserializeUser, requireUser)
export class FarmerController {
  constructor(
    @inject(TYPES.FarmerService)
    private farmerService: FarmerService,
    @inject(TYPES.PdfGeneratorService)
    private readonly pdfGeneratorService: PdfGeneratorService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService)
    private readonly activityLogService: UserActivityLogService,
  ) {}

  @httpPost(
    '/',
    upload.fields([
      { name: 'farmPhoto', maxCount: 1 },
      { name: 'farmerPhoto', maxCount: 1 },
      { name: 'idProofCopy', maxCount: 1 },
      { name: 'sevenTwelveCopy', maxCount: 1 },
    ]),
  )
  public async createFarmer(
    @request() req: Request<{}, {}, CreateFarmerDto>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const farmerData = req.body;
      console.log(farmerData)
      farmerData.createdBy = res.locals.user.id;
      
      if (req.files) {
        const files = req.files as {
          [fieldname: string]: any[];
        };
        // DigitalOcean Spaces URLs are automatically provided by multer-s3 in .location property
        farmerData.farmPhoto = files.farmPhoto
          ? files.farmPhoto[0].location
          : null;
        farmerData.farmerPhoto = files.farmerPhoto
          ? files.farmerPhoto[0].location
          : null;
        farmerData.idProofCopy = files.idProofCopy
          ? files.idProofCopy[0].location
          : null;
        farmerData.sevenTwelveCopy = files.sevenTwelveCopy
          ? files.sevenTwelveCopy[0].location
          : null;
      }

      const farmer = await this.farmerService.createFarmer(farmerData);
      
      if (!farmer) {
        ControllerLogger.logOperationFailed('Create', 'Farmer', 'Creation failed', req, res);
        return next(new AppError(400, 'Farmer could not be created'));
      }
      
      // Log login activity (fire-and-forget) - skip for admin role
      const currentUser = res.locals.user;
      const isAdmin = currentUser.roles?.some((role: any) =>
        (role?.name ?? role)?.toLowerCase() === Role.ADMIN,
      );
      if (!isAdmin) {
      const userName = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: currentUser.id,
        userName,
        action: ActivityAction.CREATE,
        module: ActivityModule.OTHER,
        entityName: 'Farmer',
        entityId: farmer.id,
        description: `${userName} created farmer "${[farmer.farmerfName, farmer.farmermName, farmer.farmerlName].filter(Boolean).join(' ')}" (${farmer.farmerCode})`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 201,
      }).catch(() => {});
    }

      ControllerLogger.logSuccess('Farmer created', farmer.id, req, res);
      res.status(201).json({
        status: 'success',
        message: 'Farmer created successfully',
        data: farmer.id,
      });
    } catch (err) {
      ControllerLogger.logError('Create Farmer', err, req, res);
      next(err);
    }
  }

   @httpGet('/')
  public async getAllFarmers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { page, limit, search, sort } = req.query;
      const userId=res.locals.user.id;
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };
      
      const farmers = await this.farmerService.getAllFarmers(queryOptions,userId);

      if (!farmers) {
        ControllerLogger.logOperationFailed('Get All', 'Farmers', 'No records found', req, res);
        return next(new AppError(404, 'No farmers found'));
      }
      
      // 🔔 Send notification for get all farmers
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Retrieved ${farmers.meta.total} farmers`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      // }
      
      ControllerLogger.logGetAllRecords('Farmers', req, res);
      res.status(200).json({
        status: 'success',
        data: farmers.data,
        allRecords: farmers.meta.total,
        totalPages: farmers.meta.pages,
        page: farmers.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Get All Farmers', err, req, res);
      next(err);
    }
  }

  /**
   * PATCH /farmers/submit/:id
   * Submits the farmer (sets status to "pending"). Frontend calls this when user clicks "Create".
   * - req.files madhe file asel → S3 var juna delete, nava upload
   * - req.body madhe URL string asel → existing URL tashi rahu de
   */
  @httpPatch(
    '/submit/:id',
    upload.fields([
      { name: 'farmPhoto', maxCount: 1 },
      { name: 'farmerPhoto', maxCount: 1 },
      { name: 'idProofCopy', maxCount: 1 },
      { name: 'sevenTwelveCopy', maxCount: 1 },
    ]),
  )
  public async submitFarmer(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const files = req.files as { [fieldname: string]: any[] } | undefined;
      const body = req.body;
      const fileUpdates: Record<string, string | null> = {};

      const handleField = async (fieldName: string) => {
        if (files?.[fieldName]?.[0]) {
          // New file uploaded → delete old from S3 if old URL exists in body
          const oldUrl = body[fieldName];
          if (oldUrl && typeof oldUrl === 'string' && oldUrl.startsWith('http')) {
            try {
              const key = new URL(oldUrl).pathname.replace(/^\//, '');
              await s3.send(new DeleteObjectCommand({
                Bucket: process.env.DO_SPACES_BUCKET!,
                Key: key,
              }));
            } catch (e) {
              console.warn(`Could not delete old ${fieldName} from S3:`, e);
            }
          }
          fileUpdates[fieldName] = files[fieldName][0].location;
        } else if (body[fieldName] && typeof body[fieldName] === 'string') {
          // Existing URL string from frontend → keep as is
          fileUpdates[fieldName] = body[fieldName];
        }
        // else → don't touch (undefined means no change)
      };

      await handleField('farmPhoto');
      await handleField('farmerPhoto');
      await handleField('idProofCopy');
      await handleField('sevenTwelveCopy');

      // body मधली बाकी farmer info पण pass करा
      const farmerData = { ...body };
      // file fields body मधून काढा — ते fileUpdates मधून येतात
      delete farmerData.farmPhoto;
      delete farmerData.farmerPhoto;
      delete farmerData.idProofCopy;
      delete farmerData.sevenTwelveCopy;

      const farmer = await this.farmerService.submitFarmer(id, fileUpdates, farmerData, res.locals.user.id);

      ControllerLogger.logSuccess('Farmer submitted', id, req, res);
      return res.status(200).json({
        status: 'success',
        message: 'Farmer submitted successfully',
        data: { id: farmer.id, status: farmer.status },
      });
    } catch (err) {
      ControllerLogger.logError('Submit Farmer', err, req, res);
      next(err);
    }
  }

  @httpPatch("/approve/:id")
  async approveFarmer(
    @requestParam('id') farmerId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const adminUser = res.locals.user.id;
      const status = req.query.status as Status;

      const approvedFarmer = await this.farmerService.approveFarmer(farmerId, adminUser, status);

      ControllerLogger.logSuccess('Farmer approved', farmerId, req, res);
      return res.status(200).json({ message: "Farmer approved successfully", farmer: approvedFarmer });
    } catch (error: any) {
      ControllerLogger.logError('Approve Farmer', error, req, res);
      next(error);
    }
  }

// @httpGet('/')
//   public async getAllFarmers(
//     @request() req: Request,
//     @response() res: Response,
//     @next() next: NextFunction,
//   ) {
//     try {
//       const { page, limit, search, sort } = req.query;

//       const queryOptions: PaginationOptions = {
//         page: page ? Number(page) : undefined,
//         limit: limit ? Number(limit) : undefined,
//         filters: {},
//         sort: (sort as string) || undefined,
//         search: (search as string) || '',
//       };
      
//       const farmers = await this.farmerService.getAllFarmers(queryOptions);

//       if (!farmers) {
//         ControllerLogger.logOperationFailed('Get All', 'Farmers', 'No records found', req, res);
//         return next(new AppError(404, 'No farmers found'));
//       }
      
//       // 🔔 Send notification for get all farmers
//       // try {
//       //   const userId = res.locals.user?.id;
//       //   if (userId) {
//       //     await this.notificationService.createNoti(
//       //       `Retrieved ${farmers.meta.total} farmers`,
//       //       userId
//       //     );
//       //   }
//       // } catch (notifError) {
//       // }
      
//       ControllerLogger.logGetAllRecords('Farmers', req, res);
//       res.status(200).json({
//         status: 'success',
//         data: farmers.data,
//         allRecords: farmers.meta.total,
//         totalPages: farmers.meta.pages,
//         page: farmers.meta.page,
//       });
//     } catch (err) {
//       ControllerLogger.logError('Get All Farmers', err, req, res);
//       next(err);
//     }
//   }

  @httpGet('/view/:id')
  public async getFarmerByIdforview(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const farmer = await this.farmerService.getfarmerbyidforview(id);
      
      if (!farmer) {
        ControllerLogger.logNotFound('Farmer', id, req, res);
        return next(new AppError(404, 'Farmer not found'));
      }
      
      // await this.notificationService.createNoti(
      //   `Farmer details retrieved successfully ${farmer.farmerfName} ${farmer.farmermName} ${farmer.farmerlName}`,
      //   res.locals.user.id,
      // );
      
      ControllerLogger.logView('Farmer', id, req, res);
      res.status(200).json({
        status: 'success',
        data: farmer,
      });
    } catch (err) {
      ControllerLogger.logError('Get Farmer for view', err, req, res);
      next(err);
    }
  }

  @httpGet('/update/:id')
  public async getFarmerByIdforupdate(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const farmer = await this.farmerService.getfarmerbyidforupdate(id);
      
      if (!farmer) {
        ControllerLogger.logNotFound('Farmer', id, req, res);
        return next(new AppError(404, 'Farmer not found'));
      }
      
      // await this.notificationService.createNoti(
      //   `Farmer details retrieved successfully ${farmer.farmerfName} ${farmer.farmermName} ${farmer.farmerlName}`,
      //   res.locals.user.id,
      // );
      
      ControllerLogger.logView('Farmer (for update)', id, req, res);
      res.status(200).json({
        status: 'success',
        data: farmer,
      });
    } catch (err) {
      ControllerLogger.logError('Get Farmer for update', err, req, res);
      next(err);
    }
  }

  @httpPost('/upload-farmer', uploadSingle.single('file'))
  public async uploadFarmerExcel(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.file) {
        ControllerLogger.logValidationError('Upload Farmer Excel', 'No file uploaded', req, res);
        return next(new AppError(400, 'No file uploaded'));
      }

      const userId = res.locals.user?.id;
      if (!userId) {
        return next(new AppError(401, 'User not authenticated'));
      }

      // Every imported farmer is owned by whoever ran the import - the sheet
      // has no say in it.
      const summary = await this.farmerService.createFarmerwithExcel(
        (req.file as any).location || (req.file as any).path || req.file.filename,
        userId,
      );

      ControllerLogger.logSuccess('Farmer Excel uploaded', 'bulk', req, res);
      res.status(200).json({
        status: 'success',
        message:
          `${summary.created} farmer(s) imported` +
          (summary.skipped.length ? `, ${summary.skipped.length} skipped` : '') +
          (summary.failed.length ? `, ${summary.failed.length} failed` : ''),
        data: summary,
      });
    } catch (error) {
      ControllerLogger.logError('Upload Farmer Excel', error, req, res);
      next(error);
    }
  }





  @httpGet('/filterFarmer/all')
  public async getAllFarmer(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { page, limit, search, sort } = req.query;
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };
      
      const farmers = await this.farmerService.getAllFarmer(queryOptions);
      
      if (!farmers) {
        ControllerLogger.logOperationFailed('Get All', 'Farmers (filtered)', 'No records found', req, res);
        return next(new AppError(404, 'No farmers found'));
      }
      
      ControllerLogger.logList('Farmers (filtered)', req, res);
      res.status(200).json({
        status: 'success',
        data: farmers.data1,
        allRecords: farmers.meta.total,
        totalPages: farmers.meta.pages,
        page: farmers.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Get All Farmers (filtered)', err, req, res);
      next(err);
    }
  }

  @httpGet('/filterFarmer/:id')
  public async getPartialFarmer(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const farmers = await this.farmerService.getPartialFarmersById(id);
      
      if (!farmers) {
        ControllerLogger.logNotFound('Partial Farmer', id, req, res);
        return next(new AppError(404, 'No farmers found'));
      }
      
      ControllerLogger.logView('Partial Farmer', id, req, res);
      res.status(200).json({
        status: 'success',
        data: farmers,
      });
    } catch (err) {
      ControllerLogger.logError('Get Partial Farmer', err, req, res);
      next(err);
    }
  }



  @httpPut(
    '/:id',
    captureUser,
    upload.fields([
      { name: 'farmPhoto', maxCount: 1 },
      { name: 'farmerPhoto', maxCount: 1 },
      { name: 'idProofCopy', maxCount: 1 },
      { name: 'sevenTwelveCopy', maxCount: 1 },
    ]),
  )
  public async updateFarmer(
    @requestParam('id') id: string,
    @request() req: Request<{}, {}, any>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const farmerData = req.body;

      if (req.files) {
        const files = req.files as { [fieldname: string]: any[] };

        // Helper: delete old image from Spaces if a new one is being uploaded
        const replaceImage = async (fieldName: string, oldUrl: string | null) => {
          if (!files[fieldName]) return; // no new file → skip
          // Delete old file from Spaces
          if (oldUrl) {
            try {
              const key = new URL(oldUrl).pathname.replace(/^\//, '');
              await s3.send(new DeleteObjectCommand({
                Bucket: process.env.DO_SPACES_BUCKET!,
                Key: key,
              }));
            } catch (e) {
              console.warn(`Could not delete old ${fieldName} from Spaces:`, e);
            }
          }
          farmerData[fieldName] = files[fieldName][0].location;
        };

        // Fetch existing farmer to get current image URLs
        const existing = await this.farmerService.getFarmerById(id);

        await replaceImage('farmPhoto',      existing?.farmPhoto      ?? null);
        await replaceImage('farmerPhoto',    existing?.farmerPhoto    ?? null);
        await replaceImage('idProofCopy',    existing?.idProofCopy    ?? null);
        await replaceImage('sevenTwelveCopy',existing?.sevenTwelveCopy ?? null);
      }
      const requestedBy = res.locals.user.id;
      const updatedBy = res.locals.updatedBy.id;
      const farmer = await this.farmerService.updateFarmer(
        id,
        farmerData,
        updatedBy,
        requestedBy,
      );
      
      if (!farmer) {
        ControllerLogger.logNotFound('Farmer', id, req, res);
        return next(
          new AppError(404, 'Farmer not found or could not be updated'),
        );
      }
      
      await this.notificationService.createNoti(
        `Farmer details updated for: ${farmer.farmerfName} ${farmer.farmermName} ${farmer.farmerlName}`,
        res.locals.user.id,
      );
// Log login activity (fire-and-forget) - skip for admin role
      const currentUser = res.locals.user;
      const isAdmin = currentUser.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
      const userName = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: currentUser.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.OTHER,
        entityName: 'Farmer',
        entityId: id,
        description: `${userName} updated farmer "${[farmer.farmerfName, farmer.farmermName, farmer.farmerlName].filter(Boolean).join(' ')}" (${farmer.farmerCode})`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    }

      ControllerLogger.logSuccess('Farmer updated', id, req, res);
      res.status(200).json({
        status: 'success',
        message: 'Farmer updated successfully',
        data: farmer,
      });
    } catch (err) {
      ControllerLogger.logError('Update Farmer', err, req, res);
      next(err);
    }
  }

  // ─── Per-farmer file download endpoints ──────────────────────────────────
  // Frontend hits these to download a specific document for a given farmer.
  // The raw S3 URL is fetched from the DB and proxied through /files/download
  // so the download is always gated behind JWT auth.

  @httpGet('/:id/download/id-proof')
  public async downloadIdProof(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const farmer = await this.farmerService.getFarmerById(id);
      if (!farmer?.idProofCopy) {
        return next(new AppError(404, 'ID proof document not found for this farmer'));
      }
      const redirectUrl = `/files/download?url=${encodeURIComponent(farmer.idProofCopy)}`;
      return res.redirect(redirectUrl);
    } catch (err) {
      ControllerLogger.logError('Download Farmer ID Proof', err, req, res);
      next(err);
    }
  }

  @httpGet('/:id/download/seven-twelve')
  public async downloadSevenTwelve(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const farmer = await this.farmerService.getFarmerById(id);
      if (!farmer?.sevenTwelveCopy) {
        return next(new AppError(404, '7/12 document not found for this farmer'));
      }
      const redirectUrl = `/files/download?url=${encodeURIComponent(farmer.sevenTwelveCopy)}`;
      return res.redirect(redirectUrl);
    } catch (err) {
      ControllerLogger.logError('Download Farmer 7/12', err, req, res);
      next(err);
    }
  }

  @httpGet('/:id/download/farmer-photo')
  public async downloadFarmerPhoto(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const farmer = await this.farmerService.getFarmerById(id);
      if (!farmer?.farmerPhoto) {
        return next(new AppError(404, 'Farmer photo not found for this farmer'));
      }
      const redirectUrl = `/files/download?url=${encodeURIComponent(farmer.farmerPhoto)}`;
      return res.redirect(redirectUrl);
    } catch (err) {
      ControllerLogger.logError('Download Farmer Photo', err, req, res);
      next(err);
    }
  }

  @httpGet('/:id/download/farm-photo')
  public async downloadFarmPhoto(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const farmer = await this.farmerService.getFarmerById(id);
      if (!farmer?.farmPhoto) {
        return next(new AppError(404, 'Farm photo not found for this farmer'));
      }
      const redirectUrl = `/files/download?url=${encodeURIComponent(farmer.farmPhoto)}`;
      return res.redirect(redirectUrl);
    } catch (err) {
      ControllerLogger.logError('Download Farm Photo', err, req, res);
      next(err);
    }
  }

  @httpDelete('/:id')
  public async deleteFarmer(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const result = await this.farmerService.deleteFarmer(id);
      
      if (!result) {
        ControllerLogger.logNotFound('Farmer', id, req, res);
        return next(
          new AppError(404, 'Farmer not found or could not be deleted'),
        );
      }

      // 🔔 Send notification for farmer deletion
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Farmer deleted successfully`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      // }

      ControllerLogger.logSuccess('Farmer deleted', id, req, res);
// Log login activity (fire-and-forget) - skip for admin role
      const currentUser = res.locals.user;
      const isAdmin = currentUser.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
      const userName = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: currentUser.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.OTHER,
        entityName: 'Farmer',
        entityId: id,
        description: `${userName} deleted farmer ${id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    }
      res.status(200).json({
        status: 'success',
        message: 'Farmer deleted successfully',
      });
    } catch (err) {
      ControllerLogger.logError('Delete Farmer', err, req, res);
      next(err);
    }
  }





  @httpGet('/filterFarmer/search/withfilter')
  public async getAllFarmersWithQuery(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const filter = req.query.search as string;
      const farmers = await this.farmerService.getAllFarmerWithFilter(filter);
      
      if (!farmers) {
        ControllerLogger.logOperationFailed('Get All', 'Farmers (with filter)', 'No records found', req, res);
        return next(new AppError(404, 'No farmers found'));
      }
      
      ControllerLogger.logList('Farmers (with filter)', req, res);
      res.status(200).json({
        status: 'success',
        data: farmers,
      });
    } catch (err) {
      ControllerLogger.logError('Get All Farmers with Filter', err, req, res);
      next(err);
    }
  }

  @httpGet('/export/excel')
  public async exportFarmersExcel(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const userId = res.locals.user?.id;
      if (!userId) {
        return next(new AppError(401, 'User not authenticated'));
      }

      const { search, sort } = req.query;

      // Same options the list endpoint builds, minus page/limit - an export
      // covers the whole filtered set, not one page of it.
      const queryOptions: PaginationOptions = {
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      const file = await this.farmerService.exportToExcel(queryOptions, userId);

      try {
        await this.notificationService.createNoti(
          `Farmer Excel export ready (${file.rowCount} farmers)`,
          userId,
        );
      } catch (notifError) {
        // A failed notification must not fail the export.
      }

      ControllerLogger.logList('Farmer Excel Export', req, res);

      return res.status(200).json({
        status: 'success',
        message: `${file.rowCount} farmer(s) exported successfully`,
        data: {
          downloadUrl: file.downloadUrl,
          fileName: file.fileName,
          totalRecords: file.rowCount,
        },
      });
    } catch (error) {
      ControllerLogger.logError('Farmer Excel export', error, req, res);
      next(error);
    }
  }

  @httpGet('/download/template')
  public async downloadExcelTemplate(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      // Generated from the same column map the importer reads, so the template
      // can never drift out of sync with what the upload endpoint accepts.
      const file = await this.farmerService.buildExcelTemplate();

      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Farmer template "${file.fileName}" generated`,
            userId,
          );
        }
      } catch (notifError) {
        // A failed notification must not fail the download.
      }

      ControllerLogger.logList('Farmer Template Generated', req, res);

      res.status(200).json({
        status: 'success',
        message: 'Template URL generated successfully',
        data: {
          downloadUrl: file.downloadUrl,
          fileName: file.fileName,
        },
      });
    } catch (error) {
      ControllerLogger.logError('Generate Farmer Template URL', error, req, res);
      next(error);
    }
  }

  //TODO:Delete Mutilple
   @httpDelete("/delete/multiple")
  public async softDeleteMultipleFarmers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
  
      const { ids } = req.body;
      const farmerIds=ids;
  
      if (!Array.isArray(farmerIds) || farmerIds.length === 0) {
        ControllerLogger.logError(
          "Farmer bulk deletion",
          new AppError(400, "farmerIds must be a non-empty array"),
          req,
          res
        );
        return next(new AppError(400, "farmerIds must be a non-empty array"));
      }
  
      const result = await this.farmerService.softDeleteFarmers(farmerIds);
  
      ControllerLogger.logSuccess(
        "Farmers bulk soft deleted",
        farmerIds.join(","),
        req,
        res
      );
// Log login activity (fire-and-forget) - skip for admin role
      const currentUser = res.locals.user;
      const isAdmin = currentUser.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
      const userName = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: currentUser.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.OTHER,
        entityName: 'Farmer',
        description: `${userName} bulk deleted ${farmerIds.length} farmer(s)`,
        metadata: { ids: farmerIds, count: farmerIds.length },
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    }

      return res.status(200).json({
        status: "success",
        message: "Farmers soft deleted successfully",
        affected: result.affected,
      });
  
    } catch (err) {
      ControllerLogger.logError("Employee bulk deletion", err, req, res);
      next(err);
    }
  }
}


  // @httpGet('/multifilter')
  // public async getFilteredFarmers(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const { page, limit, search, sort, ...filters } = req.query;
      
  //     const queryOptions: PaginationOptions = {
  //       page: page ? Number(page) : 1,
  //       limit: limit ? Number(limit) : 10,
  //       search: (search as string) || '',
  //       sort: (sort as string) || 'farmer.createdAt:DESC',
  //       filters: { ...filters },
  //     };

  //     const result = await this.farmerService.getFarmersWithFilters(queryOptions);

  //     if (!result || result.data.length === 0) {
  //       ControllerLogger.logOperationFailed('Get', 'Farmers (multi-filter)', 'No records found', req, res);
  //       return res.status(404).json({
  //         status: 'fail',
  //         message: 'No farmers found for the provided filters',
  //       });
  //     }

  //     ControllerLogger.logList('Farmers (multi-filter)', req, res);
  //     res.status(200).json({
  //       status: 'success',
  //       total: result.total,
  //       currentPage: result.currentPage,
  //       totalPages: result.totalPages,
  //       data: result.data,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get Filtered Farmers', err, req, res);
  //     next(err);
  //   }
  // }


  // @httpGet('/bySearch/farmer')
  // public async getFarmerbyid(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ): Promise<void> {
  //   try {
  //     const farmerId = req.query.search as string;
  //     const farmer = await this.farmerService.getFarmerDetails(farmerId);

  //     if (!farmer) {
  //       ControllerLogger.logNotFound('Farmer', farmerId, req, res);
  //       return next(new AppError(404, 'Farmer not found'));
  //     }

  //     ControllerLogger.logView('Farmer by Search', farmerId, req, res);
  //     res.status(200).json({
  //       status: 'success',
  //       data: farmer,
  //     });
  //   } catch (error) {
  //     ControllerLogger.logError('Get Farmer by Search', error, req, res);
  //     next(error);
  //   }
  // }


  // @httpGet('/forRfpa/:farmerId')
  // public async getFarmerDetails(
  //   @requestParam('farmerId') farmerId: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ): Promise<void> {
  //   try {
  //     const farmer = await this.farmerService.getFarmerDetails(farmerId);

  //     if (!farmer) {
  //       ControllerLogger.logNotFound('Farmer', farmerId, req, res);
  //       return next(new AppError(404, 'Farmer not found'));
  //     }

  //     ControllerLogger.logView('Farmer Details', farmerId, req, res);
  //     res.status(200).json({
  //       status: 'success',
  //       data: farmer,
  //     });
  //   } catch (error) {
  //     ControllerLogger.logError('Get Farmer Details', error, req, res);
  //     next(error);
  //   }
  // }


  // @httpGet('/getfarmerCode/getnos')
  // public async getAllFarmersCode(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const farmers = await this.farmerService.getAllFarmerCodes();
      
  //     if (!farmers) {
  //       ControllerLogger.logOperationFailed('Get All', 'Farmer Codes', 'No records found', req, res);
  //       return next(new AppError(404, 'No farmers found'));
  //     }
      
  //     ControllerLogger.logList('Farmer Codes', req, res);
  //     res.status(200).json({
  //       status: 'success',
  //       data: farmers,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get All Farmer Codes', err, req, res);
  //     next(err);
  //   }
  // }


 


  // @httpGet('/getFarmer/all/:id')
  // public async getFarmerByIdForUpdate(
  //   @requestParam('id') id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const farmer = await this.farmerService.getFarmerByIdForUpdate(id);
      
  //     if (!farmer) {
  //       ControllerLogger.logNotFound('Farmer', id, req, res);
  //       return next(new AppError(404, 'Farmer not found'));
  //     }

  //     ControllerLogger.logView('Farmer (for update)', id, req, res);
  //     res.status(200).json({
  //       status: 'success',
  //       data: farmer,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get Farmer by ID for update', err, req, res);
  //     next(err);
  //   }
  // }


  // @httpGet('/:id')
  // public async getFarmerById(
  //   @requestParam('id') id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const farmer = await this.farmerService.getFarmerById(id);
      
  //     if (!farmer) {
  //       ControllerLogger.logNotFound('Farmer', id, req, res);
  //       return next(new AppError(404, 'Farmer not found'));
  //     }
      
  //     // await this.notificationService.createNoti(
  //     //   `Farmer details retrieved successfully ${farmer.farmerfName} ${farmer.farmermName} ${farmer.farmerlName}`,
  //     //   res.locals.user.id,
  //     // );
      
  //     ControllerLogger.logView('Farmer', id, req, res);
  //     res.status(200).json({
  //       status: 'success',
  //       data: farmer,
  //     });
  //   } catch (err) {
  //     ControllerLogger.logError('Get Farmer by ID', err, req, res);
  //     next(err);
  //   }
  // }

