import {
  controller,
  httpGet,
  httpPost,
  next,
  request,
  response,
} from 'inversify-express-utils';

import { inject } from 'inversify';

import { NextFunction, Request, Response } from 'express';
import { deserializeUser, requireUser } from '../../../middleware/deserializeUser';
import { TYPES } from '../../../types';
import { ProductVarientsService } from '../service/varients.service';
import AppError from '../../../utils/appError';
import logger from '../../../utils/logger';
import { PaginationOptions } from '../../../utils/pagination';


@controller('/varients', deserializeUser, requireUser)
export class VarientsController {
  constructor(
    @inject(TYPES.ProductVarientsService)
    private productVarientService: ProductVarientsService,
  ) {}

  @httpPost('/getvarients/byids')
  public async getVarientsByIds(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const { ids } = req.body;

      if (!Array.isArray(ids)) {
        throw new AppError(400, 'ids must be an array');
      }

      // Filter empty strings before passing to service
      const validIds = ids.filter((id: any) => id && String(id).trim() !== '');
      if (validIds.length === 0) {
        res.status(200).json({ status: 'success', data: [] });
        return;
      }

      const varients = await this.productVarientService.getVarientsByIds(validIds);

      res.status(200).json({
        status: 'success',
        data: varients,
      });
    } catch (error) {
      logger.error('Error fetching varients by ids:', error);
      next(error);
    }
  }



  @httpGet('/partial/data')
    public async getAllPartial(
      @response() res: Response,
      @next() next: NextFunction,
      @request() req: Request,
    ) {
      try {
        logger.info('Fetching all products');
        const { page, limit, search, sort } = req.query;
  
        const queryOptions: PaginationOptions = {
          page: page ? Number(page) : undefined,
          limit: limit ? Number(limit) : undefined,
          // searchFields: ['product.name'],
          filters: {},
          sort: (sort as string) || undefined,
          search: (search as string) || '',
        };
        const products = await this.productVarientService.getAllByFilter(queryOptions);
        logger.info(`Fetched ${products.length} products successfully`);
        res
          .status(200)
          .json({
            status: 'success',
            data: products.data,
            totalRecords: products.meta.total,
            totalPages: products.meta.pages,
            page: products.meta.page,
          });
      } catch (err) {
        logger.error('Error fetching all products', { error: err });
        next(err);
      }
    }
}


  // @httpPost('/')
  // public async createVarient(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ): Promise<void> {
  //   try {
  //     logger.info(`Creating new variants`);

  //     const { product, variants } = req.body;

  //     if (!product) {
  //       throw new AppError(400, 'productId is required');
  //     }

  //     if (!Array.isArray(variants)) {
  //       throw new AppError(400, 'variants should be an array');
  //     }

  //     const newVariants = await this.productVarientService.createVarient(
  //       product,
  //       variants,
  //     );

  //     if (!newVariants || newVariants.length === 0) {
  //       throw new AppError(400, 'No variants were created');
  //     }

  //     ControllerLogger.logSuccess('Variants created', `${newVariants.length} variants`, req, res);
  //     res.status(200).json({
  //       status: 'success',
  //       message: 'Variants created successfully',
  //       //data: newVariants,
  //     });
  //   } catch (error) {
  //     logger.error(`Error creating variants:`, error);
  //     ControllerLogger.logError('Variants creation', error, req, res);
  //     next(error);
  //   }
  // }

