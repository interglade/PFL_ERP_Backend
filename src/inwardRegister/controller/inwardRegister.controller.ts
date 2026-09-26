import { inject } from 'inversify';
import {
  controller,
  httpPost,
  httpGet,
  httpPatch,
  request,
  requestParam,
  response,
  next,
  httpDelete,
} from 'inversify-express-utils';
import { Request, Response, NextFunction } from 'express';
import { TYPES } from '../../types';
import { InwardRegisterService } from '../service/inwardRegister.service';
import AppError from '../../utils/appError';
import logger from '../../utils/logger';
import { ControllerLogger } from '../../utils/controllerLogger';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
;
import { Source } from '../../utils/status.enum';
import { error } from 'console';
import { PaginationOptions } from '../../utils/pagination';

import { CreateInwardRegisterDto, CreateInwardRegisterInput, UpdateInwardRegisterDto } from '../dto/inwardRegister.dto';
import { UserActivityLogService } from '../../employeeActivity/service/userActivityLog.service';
import { NotificationService } from '../../notification/service/notification.service';
import { ActivityAction, ActivityModule } from '../../employeeActivity/entity/userActivityLog.entity';
import { DocumentExportService } from '../../excel/export/documentExport.service';
import { INWARD_REGISTER_EXPORT } from '../excel/inwardRegister.export';
import { applyDocumentListFilters } from '../../global/filters/documentListOptions';
import { DocumentTypeEnum as FilterDocumentType } from '../../approvalFlow/entity/docuemnt.entity';


@controller('/inwardRegister', deserializeUser, requireUser)
export class InwardRegisterController {
  constructor(
    @inject(TYPES.InwardRegisterService)
    private inwardRegisterService: InwardRegisterService,
    @inject(TYPES.NotificationService)
    private readonly notificationService: NotificationService,
   @inject(TYPES.UserActivityLogService) private activityLogService: UserActivityLogService,
   @inject(TYPES.DocumentExportService)
   private readonly documentExportService: DocumentExportService,
    
  ) {}

  @httpPost('/')
  public async createInwardRegister(
    @request() req: Request<{}, {}, any>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info('Creating new inward register', { body: req.body });
      const data:CreateInwardRegisterInput = req.body;
      //console.log(data);
      const requestedBy = res.locals.user.id;
       data.requestedBy = requestedBy;

      if (data.grnNo === '') {
        data.grnNo = null;
      }
      if (data.deliveryChallanNo === '') {
        data.deliveryChallanNo = null;
      }
      //console.log(data)
      // Set vendor or farmer based on the source
      if (data.source === Source.VENDOR) {
        data.selectedVendor = { id: data.selectedParty! };
      } else if (data.source === Source.FARMER) {
        data.selectedFarmer = { id: data.selectedParty! };
      }
      const inwardRegister =
        await this.inwardRegisterService.createInwardRegister(data);
      if (!inwardRegister) {
        logger.warn('Inward register not created', { data });
        return next(new AppError(400, 'Inward register not created'));
      }
      ControllerLogger.logSuccess('Inward Register created', inwardRegister.id, req, res);

      // Send notification for inward register creation
      const currentUserId = res.locals.user?.id;
      if (currentUserId) {
        await this.notificationService.createNoti(
          `Inward register created successfully`,
          currentUserId
        );
      }

      // Single activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
          this.activityLogService.logActivity({
            userId: res.locals.user.id,
            userName,
            action: ActivityAction.CREATE,
            module: ActivityModule.INWARD_REGISTER,
            entityName: 'Inward Register',
            entityId: inwardRegister.id,
            description: `${userName} has created Inward Register ${inwardRegister.inwardNo || inwardRegister.id}`,
            ipAddress: req.ip || '',
            userAgent: req.get('user-agent'),
            endpoint: req.originalUrl,
            httpMethod: req.method,
            statusCode: 201,
          }).catch(() => {});

      res.status(201).json({
        status: 'success',
        message: 'Inward register created successfully',
        data: inwardRegister,
      });
    } catch (err) {
      logger.error('Error creating inward register', { error: err });
      ControllerLogger.logError('Inward Register creation', err, req, res);
      if (error instanceof Error) {
               return next(new AppError(400, error.message)); // ← sends 400 with real message
             }
      next(err);
    }
  }

  //TODO: get All Inward Register in Recycle Bin.....By Vaishali
  @httpGet('/recyclebin')
  public async getAllRecycleBinInwardRegisters(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info('Fetching all InwardRegister...');
      const {
        page,
        limit,
        search,
        sort,
        inwardType,
        batchNo,
        // requestingDepartment,
        // dealSlipNo
      } = req.query;
  
      const userId = res.locals.user.id;
  
      const filters: any = {};
      if (inwardType) filters.inwardType = inwardType;
      if (batchNo) filters.batchNo = batchNo;
      // if (requestingDepartment) filters.requestingDepartment = requestingDepartment;
      // if (dealSlipNo) filters.dealSlipNo = dealSlipNo;
  
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        searchFields: ['batchNo'],
        filters,
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };
  
      const inwardRegisters = await this.inwardRegisterService.getAllRecycleBinInwardRegisters(queryOptions, userId);
  
      if (!inwardRegisters || inwardRegisters.data.length === 0) {
        logger.warn('No InwardRegister found for this user.');
        return res.status(200).json({
          status: 'success',
          data: [],
          allRecords: 0,
          totalPages: 0,
          page: queryOptions.page,
        });
      }
  
    //  logger.info(Total InwardRegister fetched: ${inwardRegisters.data.length});
      ControllerLogger.logList('Inward Register Recycle Bin', req, res);
      
      // Send notification for recycle bin access
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Inward register recycle bin accessed',
      //     userId
      //   );
      // }
  
      res.status(200).json({
        status: 'success',
        data: inwardRegisters.data,
        allRecords: inwardRegisters.meta.total,
        totalPages: inwardRegisters.meta.pages,
        page: inwardRegisters.meta.page,
      });
    } catch (error) {
      console.error('Error fetching InwardRegister:', error);
      ControllerLogger.logError('Inward Register recycle bin retrieval', error, req, res);
      next(error);
    }
  }


  @httpGet('/update/:id')
  public async getInwardRegisterForUpdate(
    @requestParam('id') id: string,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const userId=res.locals.user.id;
      logger.info('Fetching inward register by ID', { id });
      const inwardRegister =
        await this.inwardRegisterService.getInwardidforupdate(id,userId);
      if (!inwardRegister) {
        logger.warn('Inward register not found', { id });
        return next(
          new AppError(404, `Inward register with ID ${id} not found`),
        );
      }

      res.status(200).json({
        status: 'success',
        data: inwardRegister,
      });
    } catch (err) {
      logger.error('Error fetching inward register', { id, error: err });
      next(err);
    }
  }

  @httpPatch('/:id')
  public async updateInwardRegister(
    @requestParam('id') id: string,
    @request() req: Request<{}, {}, UpdateInwardRegisterDto>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info('Updating inward register', { id, body: req.body });
      const updatedBy = res.locals.user.id;
      const updatedData = req.body;
      if (updatedData.source === Source.VENDOR) {
        updatedData.selectedVendor = { id: updatedData.selectedParty! };
      } else if (updatedData.source === Source.FARMER) {
        updatedData.selectedFarmer = { id: updatedData.selectedParty! };
      }
      //console.log(updatedData)
      const updatedInwardRegister =
        await this.inwardRegisterService.updateInwardRegister(
          id,
          updatedData,
          updatedBy,
        );

      if (!updatedInwardRegister) {
        logger.warn('Inward register not found or not updated', { id });
        return next(
          new AppError(
            404,
            `Inward register with ID ${id} not found or not updated`,
          ),
        );
      }

      // Send notification for inward register update
      const currentUserId = res.locals.user?.id;
      if (currentUserId) {
        await this.notificationService.createNoti(
          `Inward register updated successfully`,
          currentUserId
        );
      }

      // Activity log
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.INWARD_REGISTER,
        entityName: 'Inward Register',
        entityId: id,
        description: `${userName} has updated Inward Register ${updatedInwardRegister.inwardNo || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});

      ControllerLogger.logSuccess('Inward_Register updated', updatedInwardRegister.id, req, res);
      res.status(200).json({
        status: 'success',
        message: 'Inward register updated successfully',
        data: updatedInwardRegister,
      });
    } catch (err) {
      logger.error('Error updating inward register', { id, error: err });
      next(err);
    }
  }

  @httpDelete('/:id')
  public async deleteInwardRegister(
    @requestParam('id') id: string,
    @request() req:Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      // Call the service to delete the inward register
     let result= await this.inwardRegisterService.deleteInwardRegister(id);
      
      // Send notification for inward register deletion
      // const currentUserId = res.locals.user?.id;
      // if (currentUserId) {
      //   await this.notificationService.createNoti(
      //     `Inward register deleted`,
      //     currentUserId
      //   );
      // }

       // Activity log
       const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.INWARD_REGISTER,
        entityName: 'Inward Register',
        entityId: id,
        description: `${userName} has deleted Inward Register ${result.No || id}`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
      
      res
        .status(200)
        .json({ message: `InwardRegister with ID ${id} has been deleted.` });
    } catch (error) {
      logger.error('Error updating inward register', { id, error: error });
      next(error);
    }
  }

  /**
   * GET export/excel - every Inward Register the user can see in the list, as an .xlsx.
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
      entityName: 'Inward Register',
      definition: INWARD_REGISTER_EXPORT,
      list: { documentType: FilterDocumentType.INWARD_REGISTER, searchFields: ['batchNo'], filterKeys: ['inwardType', 'batchNo'] },
      fetchList: (queryOptions, userId) => this.inwardRegisterService.getAllInwardRegisters(queryOptions, userId),
    });
  }

//TODO: get All Inward Register.....By Vaishali
  @httpGet('/')
  public async getAllInwardRegisters(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info('Fetching all InwardRegister...');
      const {
        page,
        limit,
        search,
        sort,
        inwardType,
        batchNo,
        // requestingDepartment,
        // dealSlipNo
      } = req.query;
  
      const userId = res.locals.user.id;
  
      const filters: any = {};
      if (inwardType) filters.inwardType = inwardType;
      if (batchNo) filters.batchNo = batchNo;
      // if (requestingDepartment) filters.requestingDepartment = requestingDepartment;
      // if (dealSlipNo) filters.dealSlipNo = dealSlipNo;
  
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        searchFields: ['batchNo'],
        filters,
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };
  
      // Same filters as the Excel export: validated, applied in SQL before pagination.
      applyDocumentListFilters(queryOptions, req.query, FilterDocumentType.INWARD_REGISTER);
      const inwardRegisters = await this.inwardRegisterService.getAllInwardRegisters(queryOptions, userId);
  
      if (!inwardRegisters || inwardRegisters.data.length === 0) {
        logger.warn('No InwardRegister found for this user.');
        return res.status(200).json({
          status: 'success',
          data: [],
          allRecords: 0,
          totalPages: 0,
          page: queryOptions.page,
        });
      }
  
    //  logger.info(Total InwardRegister fetched: ${inwardRegisters.data.length});
      
      // Send notification for inward register list access
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Inward register list accessed successfully',
      //     userId
      //   );
      // }
  
      res.status(200).json({
        status: 'success',
        data: inwardRegisters.data,
        allRecords: inwardRegisters.meta.total,
        totalPages: inwardRegisters.meta.pages,
        page: inwardRegisters.meta.page,
      });
    } catch (error) {
      console.error('Error fetching InwardRegister:', error);
      next(error);
    }
  }

  //TODO: Inward Register get by id for view...BY Vaishali
  @httpGet('/view/:docid')
  public async getInwardregisterByIdForView(
    @requestParam('docid') docid: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
     // logger.info(Fetching Inward register with Document ID);
      
      const userId = res.locals.user.id;
      const inwodRegister = await this.inwardRegisterService.getInwardregisterByIdForView(docid,userId);
      if (!inwodRegister) {
        return res.status(403).json({
        status: 'fail',
        message: 'You do not have permission to view this Inward Register',
      });
        //return next(new AppError(404, 'dealSlip not found'));
      }
    //  logger.info(Inward Register with ID fetched successfully.);
      const requestedBy = res.locals.user.id;
      // Send a notification when the user logs in successfully
      // const message = Welcome back! You have successfully logged in.;
      // await this.notificationService.createNoti(message, requestedBy);

       ControllerLogger.logView('INWARD_REGISTER', inwodRegister.id, req, res);

      res.status(200).json({
        status: 'success',
        data: inwodRegister,
      });
    } catch (error) {
      logger.error('Error fetching Inward Register by ID:', error);
      next(error);
    }
  }

  @httpDelete('/delete/multiple')
    public async deleteMultipleInwardRegister(
      @request() req: Request,
      @response() res: Response,
      @next() next: NextFunction,
    ) {
      try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
          return next(new AppError(400, 'An array of AQR IDs is required'));
        }
        const result = await this.inwardRegisterService.deleteMultipleInwardRegister(ids);
        const deletedNos = result.success.map(s => s.No || s.id).join(', ');

        // Activity log
        const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.INWARD_REGISTER,
        entityName: 'Inward Register',
        description: `${userName} has bulk deleted ${result.success.length} Inward Register(s): ${deletedNos}`,
        metadata: { ids, count: ids.length },
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
        logger.error('Error deleting multiple AQRs', { error });
        next(error);
      }
    }

}


  // @httpGet('/inward-registers/scheduled-for-deletion')
  // public async getScheduledForDeletion(
  //   @response() res: Response,
  // ): Promise<void> {
  //   try {
  //     const records =
  //       await this.inwardRegisterService.getScheduledForDeletionRecords();
  //     res.status(200).json(records);
  //   } catch (error) {
  //     logger.error('Error retrieving scheduled for deletion records', {
  //       error,
  //     });
  //     res.status(500).json({ message: 'Error retrieving records' });
  //   }
  // }



  //  @httpGet('/view/:id')
  // public async getInwardRegisterForGet(
  //   @requestParam('id') id: string,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     console.log(id);
  //     logger.info('Fetching inward register by ID', { id });
  //     const inwardRegister =
  //       await this.inwardRegisterService.getInwardidforget(id);
  //     console.log(inwardRegister)
  //     if (!inwardRegister) {
  //       logger.warn('Inward register not found', { id });
  //       return next(
  //         new AppError(404, `Inward register with ID ${id} not found`),
  //       );
  //     }

  //     res.status(200).json({
  //       status: 'success',
  //       data: inwardRegister,
  //     });
  //   } catch (err) {
  //     console.log(err);
  //     logger.error('Error fetching inward register', { id, error: err });
  //     next(err);
  //   }
  // }


// @httpGet('/filter')
// public async filterInwardRegisters(
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction,
// ) {
// try {
//       // Extract pagination
//       const page = parseInt(req.query.page as string, 10) || 1;
//       const limit = parseInt(req.query.limit as string, 10) || 10;

//       // Remove pagination keys and treat the rest as filters
//       const { page: _p, limit: _l, ...restQuery } = req.query;

//       // Always initialize filters as a Record
//       const filters: Record<string, any> = {};

//       for (const [key, value] of Object.entries(restQuery ?? {})) {
//         if (value !== undefined && value !== "") {
//           filters[key] = value;
//         }
//       }

//       const result = await this.inwardRegisterService.filterInwardRegisters(page, limit, filters);

//       res.json({
//         success: true,
//         ...result,
//       });
//     } catch (error) {
//       console.error(error);
//       res.status(500).json({ success: false, message: "Server Error" });
//     }
// }
  // @httpGet('/')
  // public async getInwardRegisters(
  //   @response() res: Response,
  //   @request() req: Request,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     logger.info('Fetching all inward registers');
  //     const { page, limit, search, sort, inwardId } = req.query;

  //     const queryOptions: PaginationOptions = {
  //       page: page ? Number(page) : undefined,
  //       limit: limit ? Number(limit) : undefined,
  //       searchFields: [''],
  //       filters: {},
  //       sort: (sort as string) || undefined, 
  //       search: (search as string) || '',
  //     };
  //     const inwardRegisters =
  //       await this.inwardRegisterService.getInwardRegisters(queryOptions);

  //     res.status(200).json({
  //       status: 'success',
  //       data: inwardRegisters.data,
  //       allRecords: inwardRegisters.meta.total,
  //       totalPages: inwardRegisters.meta.pages,
  //       page: inwardRegisters.meta.page,
  //     });
  //   } catch (err) {
  //     logger.error('Error fetching inward registers', { error: err });
  //     console.log(err);
  //     next(err);
  //   }
  // }

  // @httpGet('/:id')
  // public async getInwardRegisterById(
  //   @requestParam('id') id: string,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     logger.info('Fetching inward register by ID', { id });
  //     const inwardRegister =
  //       await this.inwardRegisterService.getInwardRegisterById(id);
  //     if (!inwardRegister) {
  //       logger.warn('Inward register not found', { id });
  //       return next(
  //         new AppError(404, `Inward register with ID ${id} not found`),
  //       );
  //     }

  //     // Send notification for inward register view
  //     // const currentUserId = res.locals.user?.id;
  //     // if (currentUserId) {
  //     //   await this.notificationService.createNoti(
  //     //     `Inward register viewed: ${id}`,
  //     //     currentUserId
  //     //   );
  //     // }

  //     res.status(200).json({
  //       status: 'success',
  //       data: inwardRegister,
  //     });
  //   } catch (err) {
  //     logger.error('Error fetching inward register', { id, error: err });
  //     next(err);
  //   }
  // }


