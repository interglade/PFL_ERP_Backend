import {
  controller,
  httpGet,
  httpPatch,
  httpPost,
  httpDelete,
  next,
  request,
  requestParam,
  response,
} from 'inversify-express-utils';

import { NextFunction, Request, Response } from 'express';

import { inject } from 'inversify';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { TYPES } from '../../types';
import { PackingMaterialService } from '../service/packingMaterial.service';
import { NotificationService } from '../../notification/service/notification.service';
import logger from '../../utils/logger';
import { PaginationOptions } from '../../utils/pagination';
import { BulkDeletePackingMaterialDto, CreatePackingMaterialDto, PackingMaterialDetailDto, PackingMaterialListResponseDto, PackingMaterialPartialDto, UpdatePackingMaterialDto } from '../dto/packingMaterial.dto';
import { ControllerLogger } from '../../utils/controllerLogger';
import AppError from '../../utils/appError';


@controller('/packingMaterial', deserializeUser, requireUser)
export class PackingMaterialController {
  constructor(
    @inject(TYPES.PackingMaterialService)
    private packingMaterialService: PackingMaterialService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
  ) {}
  @httpGet('/')
  public async getAllPackingMaterial(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info('Fetching all packing materials');
      const { page, limit, search, sort } = req.query;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        //searchFields: [''],
        filters: {},
        sort: (sort as string) || undefined, // Adjust this line to match your sorting requirements
        search: (search as string) || '',
      };
      const materials: PackingMaterialListResponseDto = await this.packingMaterialService.getAll(queryOptions);

      ControllerLogger.logList("Packing Material", req, res);

      // Send notification for packing material list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Packing Material records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: 'success',
        data: materials.formatResponse,
        allRecords: materials.data1.total,
        totalPages: materials.data1.pages,
        page: materials.data1.page,
      });
    } catch (err) {
      logger.error('Error fetching packing materials', { error: err });
      ControllerLogger.logError('Packing Material list retrieval', err, req, res);
      next(err);
    }
  }

  @httpPost('/')
  public async createPackingMaterial(
    @request() req: Request<{}, {}, CreatePackingMaterialDto>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info('getting data');
      const data: CreatePackingMaterialDto = req.body;
      const materials = await this.packingMaterialService.createPackingMaterial(
        data,
      );

      if (!materials) {
        logger.error('No materials found');
        return next(new AppError(404, 'No materials found'));
      }
      logger.info('materials saved successfully');
      
      ControllerLogger.logSuccess('Packing Material created', materials.id, req, res);

      // Send notification for packing material creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Packing Material created successfully`,
          userId
        );
      }
      
      res.status(200).json({
        status: 'success',
      });
    } catch (err) {
      logger.error('Error occurred while fetching all materials', {
        error: err,
      });
      ControllerLogger.logError('Packing Material creation', err, req, res);
      next(err);
    }
  }

  @httpGet('/:id')
  public async getPackingMaterialId(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info('Fetching material details by ID', { materialId: id });
      const material: PackingMaterialDetailDto = await this.packingMaterialService.getMaterialById(id);
      if (!material) {
        logger.warn('Material not found', { farmerId: id });
        return next(new AppError(404, 'Material not found'));
      }
      logger.info('Material details retrieved successfully', { material });

      ControllerLogger.logView("Packing Material", id, req, res);

      // Send notification for packing material view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Packing Material viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: 'success',
        data: material,
      });
    } catch (err) {
      logger.error('Error occurred while fetching Material details', {
        materiald: id,
        error: err,
      });
      ControllerLogger.logError('Packing Material view', err, req, res);
      next(err);
    }
  }

  @httpPatch('/:id')
  public async updatePackingMaterial(
    @requestParam('id') id: string,
    @request() req: Request<{}, {}, UpdatePackingMaterialDto>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info('Updating packing Material', { id });
      const updatedBy = res.locals.user.id;
      const updatedData: UpdatePackingMaterialDto = req.body;

      const packingMaterial =
        await this.packingMaterialService.updatePackingMaterial(
          id,
          updatedData,
          updatedBy,
        );

      if (!packingMaterial) {
        logger.warn('Packing Material not found or not updated', { id });
        return next(
          new AppError(
            404,
            `Packing Material with ID ${id} not found or not updated`,
          ),
        );
      }

      ControllerLogger.logSuccess('Packing Material updated', id, req, res);

      // Send notification for packing material update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Packing Material updated successfully`,
          userId
        );
      }

      res.status(200).json({
        status: 'success',
        message: 'Packing Material updated successfully',
        data: packingMaterial,
      });
    } catch (err) {
      logger.error('Error updating Packing Material', { id, error: err });
      ControllerLogger.logError('Packing Material update', err, req, res);
      next(err);
    }
  }
  @httpGet('/all/partial')
  public async partialPackingMaterial(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const packingMaterial = await this.packingMaterialService.getAllPartial() as PackingMaterialPartialDto[];

      if (!packingMaterial || packingMaterial.length === 0) {
        logger.warn('Packing Material not found');
        return next(new AppError(404, 'Packing Material not found'));
      }

      ControllerLogger.logList("Packing Material Partial", req, res);

      // Send notification for packing material partial list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Packing Material partial list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: 'success',
        message: 'Packing materials fetched successfully',
        data: packingMaterial,
      });
    } catch (err) {
      logger.error('Error fetching packing materials', { error: err });
      ControllerLogger.logError('Packing Material partial list retrieval', err, req, res);
      next(err);
    }
  }

  @httpDelete('/delete/multiple')
  public async deleteMultiplePackingMaterials(
    @request() req: Request<{}, {}, BulkDeletePackingMaterialDto>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { ids }: BulkDeletePackingMaterialDto = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return next(new AppError(400, 'An array of packing material IDs is required'));
      }

      const result = await this.packingMaterialService.deleteMultiplePackingMaterials(ids);

      ControllerLogger.logSuccess('Packing Material multiple deletion', `${ids.length} records`, req, res);
      res.status(200).json({
        status: 'success',
        message: result.message,
        success: result.success,
        failed: result.failed,
      });
    } catch (err) {
      ControllerLogger.logError('Packing Material multiple deletion', err, req, res);
      next(err);
    }
  }
}
