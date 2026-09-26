import { inject } from 'inversify';
import {
  controller,
  httpGet,
  httpPatch,
  httpPost,
  request,
  response,
  next,
  requestParam,
  requestBody,
  httpDelete,
} from 'inversify-express-utils';
import { TYPES } from '../../types';
import { RfpaService } from '../service/rfpa.service';
import { NextFunction, Request, Response } from 'express';
import AppError from '../../utils/appError';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { Source } from '../../utils/status.enum';
import logger from '../../utils/logger';
import { PaginationOptions } from '../../utils/pagination';
import { checkPermission } from '../../middleware/checkPermission';
import { ControllerLogger } from '../../utils/controllerLogger';


import { UserActivityLogService } from '../../employeeActivity/service/userActivityLog.service';
import { BulkDeleteResultDto } from '../../global/general.dto';
import { NotificationService } from '../../notification/service/notification.service';
import { BulkDeleteRfpaDto, CreateRfpaDto, RfpaDocumentViewResponseDto, RfpaListResponseDto, RfpaNumbersResponseDto, RfpaRecycleBinResponseDto, RfpaUpdateFormDto, UpdateRfpaDto } from '../dto/rfpa.dto';
import { ActivityAction, ActivityModule } from '../../employeeActivity/entity/userActivityLog.entity';
import { DocumentExportService } from '../../excel/export/documentExport.service';
import { RFPA_EXPORT } from '../excel/rfpa.export';
import { applyDocumentListFilters } from '../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../approvalFlow/entity/docuemnt.entity';

@controller('/rfpa', deserializeUser, requireUser)
export class RfpaController {
  constructor(
    @inject(TYPES.RfpaService)
    private readonly rfpaService: RfpaService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService) private activityLogService: UserActivityLogService,
    @inject(TYPES.DocumentExportService)
    private readonly documentExportService: DocumentExportService,
    
  ) { }



  @httpGet('/recyclebin')
  public async getRecycleBinRfpa(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      //logger.info('Fetching all RFPA...');
      const {
        page,
        limit,
        search,
        sort,
        selectedVendor,
        source,
        companyName,
        requestingDepartment,
        rfpaId,
      } = req.query;

      const userId = res.locals.user.id;

      const filters: any = {};
      // if (selectedVendor) filters.selectedVendor = selectedVendor;
      // if (source) filters.source = source;
      // if (requestingDepartment) filters.requestingDepartment = requestingDepartment;
      // if (companyName) filters.companyName = companyName;
      // if (rfpaId) filters.rfpaId = rfpaId;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        //searchFields: [''],
        filters,
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      const rfpas: RfpaRecycleBinResponseDto = await this.rfpaService.getRecycleBinRfpa(queryOptions, userId);

      if (!rfpas || rfpas.data.length === 0) {
        logger.warn('No RFPAS found for this user.');
        return res.status(200).json({
          status: 'success',
          data: [],
          allRecords: 0,
          totalPages: 0,
          page: queryOptions.page,
        });
      }

      logger.info(`Total RFPAS fetched: ${rfpas.data.length}`);

      res.status(200).json({
        status: 'success',
        data: rfpas.data,
        allRecords: rfpas.meta.total,
        totalPages: rfpas.meta.pages,
        page: rfpas.meta.page,
      });
    } catch (error) {
      console.error('Error fetching rfpas:', error);
      next(error);
    }
  }


  //TODO: Create RFPA
  @httpPost('/', checkPermission('rfpa', 'create'))
  public async createRfpa(
    @requestBody() rfpaData: CreateRfpaDto & Record<string, any>,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      logger.info('Creating a new RFPA:', rfpaData);

      const requestedBy = res.locals.user.id;

      if (!rfpaData) {
        logger.warn('Invalid RFPA data');
        ControllerLogger.logError(
          'RFPA creation',
          new AppError(400, 'RFPA could not be created, no data provided'),
          req,
          res,
        );
        return next(
          new AppError(400, 'RFPA could not be created, no data provided'),
        );
      }

      rfpaData.createdBy = requestedBy;

      rfpaData.requestingDepartment = res.locals.user.selectDepartment;

      if (rfpaData.source === Source.VENDOR) {
        if (!rfpaData.selectedParty) {
          logger.warn('Vendor source selected, but no vendor provided');
          ControllerLogger.logError(
            'RFPA creation',
            new AppError(
              400,
              'Vendor must be provided when the source is vendor',
            ),
            req,
            res,
          );
          return next(
            new AppError(
              400,
              'Vendor must be provided when the source is vendor',
            ),
          );
        }
        rfpaData.selectedVendor = { id: rfpaData.selectedParty };
      } else if (rfpaData.source === Source.FARMER) {
        if (!rfpaData.selectedParty) {
          logger.warn('Farmer source selected, but no farmer provided');
          ControllerLogger.logError(
            'RFPA creation',
            new AppError(
              400,
              'Farmer must be provided when the source is farmer',
            ),
            req,
            res,
          );
          return next(
            new AppError(
              400,
              'Farmer must be provided when the source is farmer',
            ),
          );
        }
        rfpaData.selectedFarmer = { id: rfpaData.selectedParty };
      } else {
        logger.warn('Invalid source provided');
        ControllerLogger.logError(
          'RFPA creation',
          new AppError(
            400,
            'Invalid source: Either vendor or farmer must be provided',
          ),
          req,
          res,
        );
        return next(
          new AppError(
            400,
            'Invalid source: Either vendor or farmer must be provided',
          ),
        );
      }

      const newRfpa = await this.rfpaService.createRfpa(rfpaData);
      logger.info('RFPA created successfully: %o', newRfpa);

      ControllerLogger.logSuccess('RFPA created', newRfpa.id, req, res);

      // Send notification for RFPA creation
      const userId = res.locals.user.id;
      try {
        if (userId) {
          await this.notificationService.createNoti(
            `RFPA created successfully`,
            userId,
          );
        }
      } catch (notifError) {
        logger.warn('RFPA create notification failed:', notifError);
      }

       // Single activity log
       const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
          //const userName = `${res.locals.user.firstName ?? ''} ${res.locals.user.lastName ?? ''}`.trim();
          this.activityLogService.logActivity({
            userId: res.locals.user.id,
            userName,
            action: ActivityAction.CREATE,
            module: ActivityModule.RFPA,
            entityName: 'RFPA',
            entityId: newRfpa.id,
            description: `${userName} has created RFPA ${newRfpa.rfpaId || newRfpa.id}`,
            ipAddress: req.ip || '',
            userAgent: req.get('user-agent'),
            endpoint: req.originalUrl,
            httpMethod: req.method,
            statusCode: 201,
          }).catch(() => {});


      res.status(201).json({
        status: 'success',
        message: 'RFPA created successfully',
        data: newRfpa,
      });
    } catch (error) {
      logger.error('Error creating RFPA:', error);
      ControllerLogger.logError('RFPA creation', error, req, res);

      if (error instanceof Error) {
        return next(new AppError(400, error.message)); // ← sends 400 with real message
      }

      next(error);
    }
  }

  @httpPatch('/:id', checkPermission('rfpa', 'edit'))
  public async updateRfpa(
    @requestParam('id') rfpaId: string,
    @requestBody() rfpaData: UpdateRfpaDto & Record<string, any>,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {

      logger.info(`Updating RFPA with ID`);
      const updatedBy = res.locals.user.id;
      rfpaData.requestedBy = res.locals.user.id;
      const updatedRfpa = await this.rfpaService.updateRfpa(
        rfpaId,
        rfpaData,
        updatedBy,
      );
      if (!updatedRfpa) {
        logger.warn(`RFPA with ID ${rfpaId} not found`);
        ControllerLogger.logError(
          'RFPA update',
          new AppError(404, 'RFPA not found'),
          req,
          res,
        );
        return next(new AppError(404, 'RFPA not found'));
      }
      logger.info(`RFPA with ID ${rfpaId} updated successfully`);
      ControllerLogger.logSuccess('RFPA updated', rfpaId, req, res);

      // Send notification for RFPA update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `RFPA updated successfully`,
          userId,
        );
      }

      // Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      //const userName = `${res.locals.user.firstName ?? ''} ${res.locals.user.lastName ?? ''}`.trim();
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.RFPA,
        entityName: 'RFPA',
        entityId: rfpaId,
        description: `${userName} has updated RFPA ${updatedRfpa.rfpaId || rfpaId}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});


      res.status(200).json({
        status: 'success',
        //data: updatedRfpa,
        message: 'RFPA updated successfully',
      });
    } catch (error) {
      logger.error(`Error updating RFPA with ID ${rfpaId}:`, error);
      ControllerLogger.logError('RFPA update', error, req, res);
      next(error);
    }
  }

  @httpPatch('/approve/:rfpaId')
  public async approveRFPAHandler(
    @requestParam('rfpaId') rfpaId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      logger.info(`Approving RFPA with ID`);
      const userId = res.locals.user.id;
      const { approvalStatus, note } = req.body;
      const result = 10;
      // await this.rfpaService.approveRFPA(
      //   rfpaId,
      //   userId,
      //   req.body,
      // );

      if (!result) {
        logger.warn(`RFPA with ID: ${rfpaId} not found or cannot be approved`);
        return next(new AppError(404, 'RFPA not found or cannot be approved'));
      }
      logger.info(`Successfully approved RFPA with ID: ${rfpaId}`);
      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (error) {
      logger.error(`Error approving RFPA with ID ${rfpaId}:`, error);
      next(error);
    }
  }

  @httpGet('/rfpas/approved')
  public async getAllApprovedRfpas(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      logger.info(`Fetching All approved RFPA`);
      const rfpas = 10;
      //await this.rfpaService.findAllApprovedRfpas();

      if (!rfpas || (Array.isArray(rfpas) && rfpas.length === 0)) {
        logger.warn('No approved RFPAs found');
        return next(new AppError(400, 'No RFPAs found'));
      }
      //logger.info(`Found ${rfpas.length} approved RFPAs`);
      res.status(200).json({
        status: 'success',
        data: rfpas,
      });
    } catch (error) {
      logger.error('Error fetching approved RFPAs:', error);
      next(error);
    }
  }
  @httpGet('/rfpanumbers/getAllRfpaNo')
  public async getAllRFPANumbers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info('Fetching all RFPA numbers');
      const isDealSlipCreated =
        req.query.isDealSlipCreated === 'true'
          ? true
          : req.query.isDealSlipCreated === 'false'
            ? false
            : undefined;
      const userId = res.locals.user?.id;
      const rfpas: RfpaNumbersResponseDto = await this.rfpaService.getAllRFPANumbers(
        { ...req.query, isDealSlipCreated },
        userId,
      );
      if (!rfpas || !rfpas.data) {
        logger.warn('No RFPA numbers found');
        ControllerLogger.logError(
          'RFPA numbers retrieval',
          new AppError(404, 'No RFPAs found'),
          req,
          res,
        );
        return next(new AppError(404, 'No RFPAs found'));
      }
      logger.info(`Found ${rfpas.data.length} RFPA numbers`);
      ControllerLogger.logList('RFPA Numbers', req, res);
      res.status(200).json({
        status: 'success',
        data: rfpas.data,
        allRecords: rfpas.total,
        totalPages: rfpas.totalPages,
        page: rfpas.page,
      });
    } catch (error) {
      logger.error('Error fetching RFPA numbers:', error);
      ControllerLogger.logError('RFPA numbers retrieval', error, req, res);
      next(error);
    }
  }

  @httpGet('/:id/update')
public async getRfpaByIdByUpdate(
  @requestParam('id') rfpaId: string,
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction,
): Promise<void> {
  try {
    //logger.info(`Fetching RFPA with ID: ${rfpaId}`);
    const rfpa: RfpaUpdateFormDto | null = await this.rfpaService.getRFQByIdForUpdate(rfpaId);

    if (!rfpa) {
      logger.warn(`RFPA with ID ${rfpaId} not found`);
      ControllerLogger.logError(
        'RFPA retrieval for update',
        new AppError(404, 'RFPA not found'),
        req,
        res,
      );
      throw new AppError(404, 'RFPA not found');
    }
    //logger.info(`Successfully fetched RFPA with ID: ${rfpaId}`);
    //ControllerLogger.logView('RFPA (for update)', rfpaId, req, res);
    res.status(200).json({
      status: 'success',
      data: rfpa,
      //message:"rfpa is created"
    });
  } catch (error) {
    logger.error(`Error fetching RFPA with ID ${rfpaId}:`, error);
    ControllerLogger.logError('RFPA retrieval for update', error, req, res);
    next(error);
  }
}

  @httpDelete('/:id', checkPermission('rfpa', 'delete'))
  public async deleteRfpas(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      logger.info('Deleting RFPA ......');
      const { id } = req.params;
      if (!id) {
        logger.warn('RFPA ID not provided');
        ControllerLogger.logError(
          'RFPA deletion',
          new AppError(400, 'RFPA ID is required'),
          req,
          res,
        );
        return next(new AppError(400, 'RFPA ID is required'));
      }
      const success = await this.rfpaService.deleteRfpa(id);
      if (!success) {
        logger.warn('No RFPA numbers found');
        ControllerLogger.logError(
          'RFPA deletion',
          new AppError(404, 'No RFPAs found'),
          req,
          res,
        );
        return next(new AppError(404, 'No RFPAs found'));
      }
      ControllerLogger.logSuccess('RFPA deleted', id, req, res);

      // Send notification for RFPA deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `RFPA deleted successfully`,
      //     userId,
      //   );
      // }

       // Activity log
       const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      //const userName = `${res.locals.user.firstName ?? ''} ${res.locals.user.lastName ?? ''}`.trim();
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.RFPA,
        entityName: 'RFPA',
        entityId: id,
        description: `${userName} has deleted RFPA ${success.No || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      res.status(200).json({
        status: 'success',
        message: 'RFPA deleted Successfully',
      });
    } catch (error) {
      logger.error('Error to Delete rfpa');
      ControllerLogger.logError('RFPA deletion', error, req, res);
      next(error);
    }
  }

  //   //TODO:By Vaishali
  //   //TODO: get All RFPA
  // @httpGet('/')
  // public async getAllRfpa(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     logger.info('Fetching all RFPA...');
  //     const {
  //       page,
  //       limit,
  //       search,
  //       sort,
  //       selectedVendor,
  //       source,
  //       companyName,
  //       requestingDepartment,
  //       rfpaId
  //     } = req.query;

  //     const userId = res.locals.user.id;

  //     const filters: any = {};
  //     if (selectedVendor) filters.selectedVendor = selectedVendor;
  //     if (source) filters.source = source;
  //     if (requestingDepartment) filters.requestingDepartment = requestingDepartment;
  //     if (companyName) filters.companyName = companyName;
  //     if (rfpaId) filters.rfpaId = rfpaId;

  //     const queryOptions: PaginationOptions = {
  //       page: page ? Number(page) : 1,
  //       limit: limit ? Number(limit) : 10,
  //       searchFields: ['rfpaId'],
  //       filters,
  //       sort: (sort as string) || undefined,
  //       search: (search as string) || '',
  //     };

  //     const rfpas = await this.rfpaService.getAllRfpa(queryOptions, userId);

  //     if (!rfpas || rfpas.data.length === 0) {
  //       logger.warn('No RFPAS found for this user.');
  //       return res.status(200).json({
  //         status: 'success',
  //         data: [],
  //         allRecords: 0,
  //         totalPages: 0,
  //         page: queryOptions.page,
  //       });
  //     }

  //     logger.info(`Total RFPAS fetched: ${rfpas.data.length}`);

  //     res.status(200).json({
  //       status: 'success',
  //       data: rfpas.data,
  //       allRecords: rfpas.meta.total,
  //       totalPages: rfpas.meta.pages,
  //       page: rfpas.meta.page,
  //     });
  //   } catch (error) {
  //     console.error('Error fetching rfpas:', error);
  //     next(error);
  //   }
  // }

  // //TODO:By Vaishali
  //  //TODO: RPFA get by id for view
  //   @httpGet('/view/:docid')
  //   public async getRfpaByIdForView(
  //     @requestParam('docid') docid: string,
  //     @response() res: Response,
  //     @next() next: NextFunction,
  //   ) {
  //     try {
  //       logger.info(`Fetching RFPA with Document ID`);
  //       console.log("Shriiiiiiiiiii");

  //       console.log(docid);
  //       const userId = res.locals.user.id;
  //       const rfpa = await this.rfpaService.getRfpaByIdForView(docid,userId);
  //       console.log(rfpa);
  //       if (!rfpa) {
  //         return res.status(403).json({
  //         status: 'fail',
  //         message: 'You do not have permission to view this RFPA',
  //       });
  //         //return next(new AppError(404, 'dealSlip not found'));
  //       }
  //       logger.info(`rfpa with ID fetched successfully.`);
  //       const requestedBy = res.locals.user.id;
  //       console.log('user is ', requestedBy);
  //       // Send a notification when the user logs in successfully
  //       // const message = Welcome back! You have successfully logged in.;
  //       // await this.notificationService.createNoti(message, requestedBy);
  //       res.status(200).json({
  //         status: 'success',
  //         data: rfpa,
  //       });
  //     } catch (error) {
  //       console.log(error);
  //       logger.error('Error fetching RFPA by ID:', error);
  //       next(error);
  //     }
  //   }

  //TODO:By Vaishali
  //TODO: get All RFPA
  // @httpGet('/')
  // public async getAllRfpa(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     logger.info('Fetching all RFPA...');
  //     const {
  //       page,
  //       limit,
  //       search,
  //       sort,
  //       selectedVendor,
  //       source,
  //       companyName,
  //       requestingDepartment,
  //       rfpaId
  //     } = req.query;

  //     const userId = res.locals.user.id;

  //     const filters: any = {};
  //     if (selectedVendor) filters.selectedVendor = selectedVendor;
  //     if (source) filters.source = source;
  //     if (requestingDepartment) filters.requestingDepartment = requestingDepartment;
  //     if (companyName) filters.companyName = companyName;
  //     if (rfpaId) filters.rfpaId = rfpaId;

  //     const queryOptions: PaginationOptions = {
  //       page: page ? Number(page) : 1,
  //       limit: limit ? Number(limit) : 10,
  //       searchFields: ['rfpaId'],
  //       filters,
  //       sort: (sort as string) || undefined,
  //       search: (search as string) || '',
  //     };

  //     const rfpas = await this.rfpaService.getAllRfpa(queryOptions, userId);
  // console.log("rrrrrfffffppppppaaaassss",rfpas)
  //     if (!rfpas || rfpas.data.length === 0) {
  //       logger.warn('No RFPAS found for this user.');
  //       return res.status(200).json({
  //         status: 'success',
  //         data: [],
  //         allRecords: 0,
  //         totalPages: 0,
  //         page: queryOptions.page,
  //       });
  //     }

  //     logger.info(`Total RFPAS fetched: ${rfpas.data.length}`);

  //     res.status(200).json({
  //       status: 'success',
  //       data: rfpas.data,
  //       allRecords: rfpas.meta.total,
  //       totalPages: rfpas.meta.pages,
  //       page: rfpas.meta.page,
  //     });
  //   } catch (error) {
  //     console.error('Error fetching rfpas:', error);
  //     next(error);
  //   }
  // }

  /**
   * GET export/excel - every RFPA the user can see in the list, as an .xlsx.
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
      entityName: 'RFPA',
      definition: RFPA_EXPORT,
      list: { documentType: FilterDocumentType.RFPA },
      fetchList: (queryOptions, userId) => this.rfpaService.getAllRfpa(queryOptions, userId),
    });
  }

  //TODO:By Vaishali
  //TODO: get All RFPA
  @httpGet('/')
  public async getAllRfpa(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      //logger.info('Fetching all RFPA...');
      const {
        page,
        limit,
        search,
        sort,
        selectedVendor,
        source,
        companyName,
        requestingDepartment,
        rfpaId,
      } = req.query;

      const userId = res.locals.user?.id;

      const filters: any = {};
      // if (selectedVendor) filters.selectedVendor = selectedVendor;
      // if (source) filters.source = source;
      // if (requestingDepartment) filters.requestingDepartment = requestingDepartment;
      // if (companyName) filters.companyName = companyName;
      // if (rfpaId) filters.rfpaId = rfpaId;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        //searchFields: [''],
        filters,
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.RFPA);
      const rfpas: RfpaListResponseDto = await this.rfpaService.getAllRfpa(queryOptions, userId);

      if (!rfpas || rfpas.data.length === 0) {
        logger.warn('No RFPAS found for this user.');
        return res.status(200).json({
          status: 'success',
          data: [],
          allRecords: 0,
          totalPages: 0,
          page: queryOptions.page,
        });
      }

      logger.info(`Total RFPAS fetched: ${rfpas.data.length}`);

      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'RFPA records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: 'success',
        data: rfpas.data,
        allRecords: rfpas.meta.total,
        totalPages: rfpas.meta.pages,
        page: rfpas.meta.page,
      });
    } catch (error) {
      console.error('Error fetching rfpas:', error);
      next(error);
    }
  }

  //TODO:By Vaishali
  //TODO: RPFA get by id for view
  @httpGet('/view/:docid')
  public async getRfpaByIdForView(
    @requestParam('docid') docid: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info(`Fetching RFPA with Document ID`);

      const userId = res.locals.user.id;
      const rfpa: RfpaDocumentViewResponseDto | null = await this.rfpaService.getRfpaByIdForView(docid, userId);
      if (!rfpa) {
        ControllerLogger.logError(
          'RFPA view',
          new Error('You do not have permission to view this RFPA'),
          req,
          res,
        );
        // return res.status(403).json({
        //   status: 'fail',
        //   message: 'You do not have permission to view this RFPA',
        // });
        //return next(new AppError(404, 'dealSlip not found'));
      }
      logger.info(`rfpa with ID fetched successfully.`);
      const requestedBy = res.locals.user.id;
      // Send a notification when the user logs in successfully
      // const message = Welcome back! You have successfully logged in.;
      // await this.notificationService.createNoti(message, requestedBy);
      ControllerLogger.logView('RFPA (document view)', docid, req, res);
      res.status(200).json({
        status: 'success',
        data: rfpa,
      });
    } catch (error) {
      logger.error('Error fetching RFPA by ID:', error);
      ControllerLogger.logError('RFPA view', error, req, res);
      next(error);
    }
  }



  //pest in rfpa controller
  @httpDelete('/delete/multiple')
  public async deleteMultipleRfpas(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      logger.info('Deleting multiple RFPAs ......', req.body);
      const { ids }: BulkDeleteRfpaDto = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        logger.warn('RFPA IDs not provided or invalid');
        ControllerLogger.logError(
          'RFPA multiple deletion',
          new AppError(400, 'An array of RFPA IDs is required'),
          req,
          res,
        );
        return next(new AppError(400, 'An array of RFPA IDs is required'));
      }
      const result: BulkDeleteResultDto = await this.rfpaService.deleteMultipleRFPA(ids);
      const deletedNos = result.success.map(s => s.No || s.id).join(', ');

      ControllerLogger.logSuccess(
        'RFPA multiple deletion',
        `${ids.length} records`,
        req,
        res,
      );

       // Activity log
       const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      //const userName = `${res.locals.user.firstName ?? ''} ${res.locals.user.lastName ?? ''}`.trim();
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.RFPA,
        entityName: 'RFPA',
        description: `${userName} has bulk deleted ${result.success.length} RFPA(s): ${deletedNos}`,
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
    } catch (error) {
      logger.error('Error deleting multiple RFPAs:', error);
      ControllerLogger.logError('RFPA multiple deletion', error, req, res);
      next(error);
    }
  }
}



// @httpGet('/filter')
// public async filterRfpas(
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction,
// ) {
//   try {
//     // Extract pagination
//     const page = parseInt(req.query.page as string, 10) || 1;
//     const limit = parseInt(req.query.limit as string, 10) || 10;

//     // Remove pagination keys and treat the rest as filters
//     const { page: _p, limit: _l, ...restQuery } = req.query;

//     // Always initialize filters as a Record
//     const filters: Record<string, any> = {};

//     for (const [key, value] of Object.entries(restQuery ?? {})) {
//       if (value !== undefined && value !== '') {
//         filters[key] = value;
//       }
//     }

//     const result = await this.rfpaService.filterRfpas(page, limit, filters);

//     res.json({
//       success: true,
//       ...result,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: 'Server Error' });
//   }
// }







// @httpGet('/')
// @httpGet('/get')
// public async getAllRfpas(
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction,
// ): Promise<void> {
//   try {
//     logger.info('Fetching all RFPAs');

//     const { page, limit, search, sort, rfpaId } = req.query;

//     const queryOptions: PaginationOptions = {
//       page: page ? Number(page) : undefined,
//       limit: limit ? Number(limit) : undefined,
//       searchFields: ['rfpa.rfpaId'],
//       filters: {},
//       sort: (sort as string) || undefined,
//       search: (search as string) || '',
//     };
//     const rfpas = await this.rfpaService.findAllRfpas(queryOptions);

//     if (!rfpas || (Array.isArray(rfpas) && rfpas.length === 0)) {
//       logger.warn('No RFPAs found');
//       return next(new AppError(400, 'No RFPAs found'));
//     }
//     logger.info('Successfully fetched all RFPAs');
//     res.status(200).json({
//       status: 'success',

//       data: rfpas.data,
//       allRecords: rfpas.meta.total,
//       totalPages: rfpas.meta.pages,
//       page: rfpas.meta.page,
//     });
//   } catch (error) {
//     console.log(error);
//     logger.error('Error fetching all RFPAs', error);
//     next(error);
//   }
// }

// @httpGet('/:id', checkPermission('rfpa', 'view'))
// public async getRfpaById(
//   @requestParam('id') rfpaId: string,
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction,
// ): Promise<void> {
//   try {
//     logger.info(`Fetching RFPA with ID: ${rfpaId}`);
//     const rfpa = await this.rfpaService.getRFQById(rfpaId);

//     if (!rfpa) {
//       logger.warn(`RFPA with ID ${rfpaId} not found`);
//       throw new AppError(404, 'RFPA not found');
//     }
//     logger.info(`Successfully fetched RFPA with ID: ${rfpaId}`);
//     res.status(200).json({
//       status: 'success',
//       data: rfpa,
//       //message:"rfpa is created"
//     });
//   } catch (error) {
//     console.log(error);
//     logger.error(`Error fetching RFPA with ID ${rfpaId}:`, error);
//     next(error);
//   }
// }

// @httpGet('/:id/view')
// public async getRfpaByIdByView(
//   @requestParam('id') rfpaId: string,
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction,
// ): Promise<void> {
//   try {
//     logger.info(`Fetching RFPA with ID: ${rfpaId}`);
//     const rfpa: RfpaViewResponseDto | null = await this.rfpaService.getRFQByIdByView(rfpaId);

//     if (!rfpa) {
//       logger.warn(`RFPA with ID ${rfpaId} not found`);
//       ControllerLogger.logError(
//         'RFPA view',
//         new AppError(404, 'RFPA not found'),
//         req,
//         res,
//       );
//       throw new AppError(404, 'RFPA not found');
//     }
//     logger.info(`Successfully fetched RFPA with ID: ${rfpaId}`);
//     ControllerLogger.logView('RFPA (for view)', rfpaId, req, res);

//     // // Send notification for RFPA view
//     // const userId = res.locals.user?.id;
//     // if (userId) {
//     //   await this.notificationService.createNoti(
//     //     `RFPA viewed: ${rfpaId}`,
//     //     userId
//     //   );
//     // }

//     res.status(200).json({
//       status: 'success',
//       data: rfpa,
//       //message:"rfpa is created"
//     });
//   } catch (error) {
//     logger.error(`Error fetching RFPA with ID ${rfpaId}:`, error);
//     ControllerLogger.logError('RFPA view', error, req, res);
//     next(error);
//   }
// }




