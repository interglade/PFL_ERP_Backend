import {
  controller,
  httpGet,
  next,
  request,
  response,
} from 'inversify-express-utils';
import { inject } from 'inversify';
import { TYPES } from '../../../types';
import { Request, Response, NextFunction } from 'express';
import AppError from '../../../utils/appError';
import { deserializeUser, requireUser } from '../../../middleware/deserializeUser';
import { DeliveryChallanService } from '../service/deliveryChallan.service';

@controller('/deliveryChallan', deserializeUser, requireUser)
export class DeliveryChallanController {
  constructor(
    @inject(TYPES.DeliveryChallanService)
    private deliveryChallanService: DeliveryChallanService,
  ) {}

  @httpGet('/dc-type/numbers')
  public async getDcTypeNumbers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const dcType = (req.query.dcType as string)?.split('?')[0]?.trim();

      if (!dcType) return next(new AppError(400, 'dcType query param is required'));

      const page = req.query.page ? parseInt(req.query.page as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const search = req.query.search as string | undefined;

      // isReturnByCustomerCreated filter — accepts 'true' or 'false' as string
      const isReturnByCustomerCreatedRaw = req.query.isReturnByCustomerCreated as string | undefined;
      const isReturnByCustomerCreated = isReturnByCustomerCreatedRaw !== undefined
        ? isReturnByCustomerCreatedRaw === 'true'
        : undefined;

      // overAllStatus filter — document status e.g. 'complete', 'reject', 'pending'
      const overAllStatus = req.query.overAllStatus as string | undefined;

      const result = await this.deliveryChallanService.getDcTypeNumbers(
        dcType,
        page,
        limit,
        search,
        isReturnByCustomerCreated,
        overAllStatus,
      );

      res.status(200).json({
        status: 'success',
        data: result.data,
        allRecords: result.total,
        totalPages: result.totalPages,
        page: result.page,
      });
    } catch (error) {
      next(error);
    }
  }
}
