import {
  controller,
  httpGet,
  httpPatch,
  httpPut,
  next,
  request,
  requestParam,
  response,
} from 'inversify-express-utils';

import { inject } from 'inversify';
import { NextFunction, Response, Request } from 'express';
import { deserializeUser, requireUser } from '../../../middleware/deserializeUser';
import { ProductVarientService } from '../service/productVarient.service';
import { TYPES } from '../../../types';
import { ControllerLogger } from '../../../utils/controllerLogger';


@controller('/productVarient', deserializeUser, requireUser)
export class ProductVarientController {
  constructor(
    @inject(TYPES.ProductVarientService)
    private productVarientService: ProductVarientService,
  ) {}

  @httpGet('/')
  public async getAll(
    @response() res: Response,
    @request() req: Request,
    @next()
    next: NextFunction,
  ): Promise<any> {
    try {
      const { page, limit, search, sort } = req.query;
      const queryOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        searchFields: ['product.name'],
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };
      const productVarient = await this.productVarientService.getAllvarient(
        queryOptions,
      );
      if (!productVarient) {
        ControllerLogger.logError('Product Varient list retrieval', new Error('product varient not found'), req, res);
        return res
          .status(404)
          .json({ status: 'fail', message: 'product varient not found' });
      }
      ControllerLogger.logList('Product Varient', req, res);
      res
        .status(200)
        .json({
          status: 'success',
          data: productVarient.data,
          allRecords: productVarient.meta.total,
          totalPages: productVarient.meta.pages,
          page: productVarient.meta.page,
        });
    } catch (err) {
      ControllerLogger.logError('Product Varient list retrieval', err, req, res);
      next(err);
    }
  }

  @httpGet('/:id')
  public async getByVarientId(
    @response() res: Response,
    @request() req: Request,
    @next() next: NextFunction,
  ): Promise<any> {
    try {
      const varientId = req.params.id;
      const productVarient = await this.productVarientService.getVarientById(
        varientId,
      );
      if (!productVarient) {
        ControllerLogger.logError('Product Varient view', new Error('product varient not found'), req, res);
        return res
          .status(404)
          .json({ status: 'fail', message: 'product varient not found' });
      }
      ControllerLogger.logView('Product Varient', varientId, req, res);
      res.status(200).json({ status: 'success', data: productVarient });
    } catch (err) {
      ControllerLogger.logError('Product Varient view', err, req, res);
      next(err);
    }
  }

  @httpGet('/product/:id')
  public async getByProductId(
    @response() res: Response,
    @request() req: Request,
    @next() next: NextFunction,
  ): Promise<any> {
    try {
      const productId = req.params.id;
      const productVarient =
        await this.productVarientService.getVarientByProductId(productId);
      if (!productVarient) {
        ControllerLogger.logError('Product Varient by Product view', new Error('Product varient not found'), req, res);
        return res
          .status(404)
          .json({ status: 'fail', message: 'Product varient not found' });
      }
      ControllerLogger.logView('Product Varient by Product', productId, req, res);
      res.status(200).json({ status: 'success', data: productVarient });
    } catch (err) {
      ControllerLogger.logError('Product Varient by Product view', err, req, res);
      next(err);
    }
  }

  

}
