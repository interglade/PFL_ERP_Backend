import { inject } from 'inversify';
import {
  controller,
  httpDelete,
  httpGet,
  httpPatch,
  httpPost,
  next,
  request,
  requestParam,
  response,
} from 'inversify-express-utils';
import { TYPES } from '../../types';

import { NextFunction, Request, Response } from 'express';

import AppError from '../../utils/appError';
import {
  captureUser,
  deserializeUser,
  requireUser,
} from '../../middleware/deserializeUser';
import { PaginationOptions } from '../../utils/pagination';
import logger from '../../utils/logger';
import { ControllerLogger } from '../../utils/controllerLogger';

import {
  CreateOfficeDto,
  UpdateOfficeDto,
  OfficeDetailDto,
  OfficeListResponseDto,
  OfficeFilterItemDto,
  OfficeSearchItemDto,
  BulkDeleteOfficeDto,
  BulkDeleteOfficeResultDto,
} from '../dto/office.dto';
import { OfficesService } from '../service/office.service';
import { NotificationService } from '../../notification/service/notification.service';
import { OFFICE_TYPE } from '../entity/offices.entity';

@controller('/location-offices', deserializeUser, requireUser)
export class OfficesController {
  constructor(
    @inject(TYPES.OfficesService)
    private officesService: OfficesService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
  ) {}
  @httpPost('/:officeType')
  public async createOffice(
    @requestParam('officeType') officeType: OFFICE_TYPE,
    @request() req: Request<{}, {}, CreateOfficeDto>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const officeData: CreateOfficeDto & Record<string, any> = req.body;
      officeData.type = officeType;
      const office = await this.officesService.createOffice(officeData);
      if (!office) {
        return next(new AppError(400, 'Office could not be created'));
      }

      ControllerLogger.logSuccess('Office created', office.id, req, res);

      // Send notification for office creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Office ${office.type} created successfully`,
          userId
        );
      }

      res.status(201).json({
        status: 'success',
        message: `${office.type} created successfully`,
        //data: office,
      });
    } catch (err) {
      ControllerLogger.logError('Office creation', err, req, res);
      next(err);
    }
  }

  @httpGet('/:officeType/:id')
  public async getOffice(
    @requestParam('officeType') officeType: OFFICE_TYPE,
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const office: OfficeDetailDto | null = await this.officesService.getOfficeByIdAndType(id, officeType);
      if (!office) {
        return next(new AppError(404, 'Office not found'));
      }

      ControllerLogger.logView('Office', id, req, res);

      // Send notification for office view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Office ${office.type} viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: 'success',
        data: office,
      });
    } catch (err) {
      ControllerLogger.logError('Office view', err, req, res);
      next(err);
    }
  }
  @httpGet('/filterData/filter/all')
  public async getAllFilterOffice(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info(`Received request to fetch all offices`);

      const offices: OfficeFilterItemDto[] = await this.officesService.getAllByFilterDataOffice();
      if (!offices || offices.length === 0) {
        logger.warn(`No offices found`);
        return next(new AppError(404, 'Office not found'));
      }

      logger.info(`Fetched all offices successfully`);
      ControllerLogger.logList('Office (Filter)', req, res);

      // Send notification for office filter list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Office filter list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: 'success',
        data: offices,
      });
    } catch (err) {
      logger.error('Error fetching offices', { error: err });
      ControllerLogger.logError('Office filter list retrieval', err, req, res);
      next(err);
    }
  }



  @httpGet('/:officeType')
  public async getOfficesByType(
    @request() req: Request,
    @requestParam('officeType') officeType: OFFICE_TYPE,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { page, limit, search, sort } = req.query;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        searchFields: ['office.id'],
        filters: {},
        sort: (sort as string) || undefined, // Adjust this line to match your sorting requirements
        search: (search as string) || '',
      };
      const offices: OfficeListResponseDto = await this.officesService.getOfficesByType1(officeType, queryOptions);
      //console.log(offices)

      ControllerLogger.logList('Office (By Type)', req, res);

      // Send notification for offices by type list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Offices by type ${officeType} list accessed successfully`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: 'success',
        data: offices.data,
        allRecords: offices.meta.total,
        totalPages: offices.meta.pages,
        page: offices.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Office by type retrieval', err, req, res);
      next(err);
    }
  }

  @httpGet('/')
  public async searchOfficesByType(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const officeType = req.query.search as OFFICE_TYPE;
      const offices: OfficeSearchItemDto[] = await this.officesService.getOfficesByType(officeType);
      if (!offices || offices.length === 0) {
        return next(
          new AppError(404, 'No offices found for the specified type'),
        );
      }

      ControllerLogger.logList('Office (Search)', req, res);

      // Send notification for office search
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Office search for type ${officeType} completed successfully`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: 'success',
        data: offices,
      });
    } catch (err) {
      ControllerLogger.logError('Office search', err, req, res);
      next(err);
    }
  }
  @httpPatch('/:officeType/:id', captureUser)
  public async updateOffice(
    @requestParam('officeType') officeType: OFFICE_TYPE,
    @requestParam('id') id: string,
    @request() req: Request<{}, {}, UpdateOfficeDto>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const updatedBy = res.locals.updatedBy;
      const updateData: UpdateOfficeDto & Record<string, any> = req.body;
      updateData.type = officeType;

      const office = await this.officesService.updateOffice(
        id,
        updateData,
        updatedBy,
      );
      if (!office) {
        return next(
          new AppError(404, 'Office not found or could not be updated'),
        );
      }

      ControllerLogger.logSuccess('Office updated', id, req, res);

      // Send notification for office update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Office ${office.type} updated successfully`,
          userId
        );
      }

      res.status(200).json({
        status: 'success',
        message: `${office.type} data updated successfully`,
        //data: office,
      });
    } catch (err) {
      ControllerLogger.logError('Office update', err, req, res);
      next(err);
    }
  }

  
   @httpDelete("/delete/multiple")
public async softDeleteMultipleOffices(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {

    const { ids }: BulkDeleteOfficeDto = req.body;
    const officeIds=ids;
      const officeType = req.query.officeType as OFFICE_TYPE;

    if (!Array.isArray(officeIds) || officeIds.length === 0) {
      ControllerLogger.logError(
        "Office bulk deletion",
        new AppError(400, "officeIds must be a non-empty array"),
        req,
        res
      );
      return next(new AppError(400, "officeIds must be a non-empty array"));
    }

    const result: BulkDeleteOfficeResultDto = await this.officesService.softDeleteOffices(officeIds, officeType);

    ControllerLogger.logSuccess(
      "Office bulk soft deleted",
      officeIds.join(","),
      req,
      res
    );

    // Send notification
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     `Multiple Offices soft deleted: ${officeIds.length}`,
    //     userId
    //   );
    // }

    return res.status(200).json({
      status: "success",
      message: "Offices soft deleted successfully",
      affected: result.affected,
    });

  } catch (err) {
    ControllerLogger.logError("Office bulk deletion", err, req, res);
    next(err);
  }
}
}


// @httpDelete('/:officeType/:id')
  // public async deleteOffice(
  //   @requestParam('officeType') officeType: OFFICE_TYPE,
  //   @requestParam('id') id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const result = await this.officesService.deleteOffice(id, officeType);
  //     if (!result) {
  //       return next(
  //         new AppError(404, 'Office not found or could not be deleted'),
  //       );
  //     }

  //     ControllerLogger.logSuccess('Office deleted', id, req, res);

  //     // Send notification for office deletion
  //     // const userId = res.locals.user?.id;
  //     // if (userId) {
  //     //   await this.notificationService.createNoti(
  //     //     `Office ${officeType} deleted successfully`,
  //     //     userId
  //     //   );
  //     // }

  //     res.status(200).json({
  //       status: 'success',
  //       message: 'Office deleted successfully',
  //     });
  //     // res.status(204).send(); // No content
  //   } catch (err) {
  //     ControllerLogger.logError('Office deletion', err, req, res);
  //     next(err);
  //   }
  // }


//  @httpGet('/get/all/offices')
//   public async getAllOffice(
//     @request() req: Request<{}, {}, any>,
//     @response() res: Response,
//     @next() next: NextFunction,
//   ) {
//     try {
//       const office: OfficeSearchItemDto[] | null = await this.officesService.getAllOffice();
//       if (!office) {
//         return next(new AppError(404, 'Office not found'));
//       }

//       ControllerLogger.logList('Office (All)', req, res);

//       // Send notification for all offices list access
//       // const userId = res.locals.user?.id;
//       // if (userId) {
//       //   await this.notificationService.createNoti(
//       //     'All offices list accessed successfully',
//       //     userId
//       //   );
//       // }

//       res.status(200).json({
//         status: 'success',
//         data: office,
//       });
//     } catch (err) {
//       ControllerLogger.logError('Office list retrieval', err, req, res);
//       next(err);
//     }
//   }

