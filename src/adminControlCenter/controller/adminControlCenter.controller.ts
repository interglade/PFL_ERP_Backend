import { inject } from 'inversify';
import { controller, httpGet, next, request, response } from 'inversify-express-utils';
import { NextFunction, Request, Response } from 'express';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { TYPES } from '../../types';
import { Role } from '../../employee/entity/user.entity';
import AppError from '../../utils/appError';
import { AccFiltersService } from '../service/accFilters.service';
import { AccOverviewService } from '../service/accOverview.service';
import { AccPurchaseService } from '../service/accPurchase.service';
import { AccSalesService } from '../service/accSales.service';
import { AccDocumentsService } from '../service/accDocuments.service';
import { AccUsersService } from '../service/accUsers.service';
import { isRefresh, parseFilters } from '../service/accShared.util';

/**
 * Admin Control Center dashboard - one endpoint per tab, plus the filter
 * options. Admin only. Every tab object carries generatedAt; the cached tabs
 * take ?refresh=true to recompute.
 */
@controller('/admin/dashboard/control-center', deserializeUser, requireUser)
export class AdminControlCenterController {
  constructor(
    @inject(TYPES.AccFiltersService) private readonly filtersService: AccFiltersService,
    @inject(TYPES.AccOverviewService) private readonly overviewService: AccOverviewService,
    @inject(TYPES.AccPurchaseService) private readonly purchaseService: AccPurchaseService,
    @inject(TYPES.AccSalesService) private readonly salesService: AccSalesService,
    @inject(TYPES.AccDocumentsService) private readonly documentsService: AccDocumentsService,
    @inject(TYPES.AccUsersService) private readonly usersService: AccUsersService,
  ) {}

  @httpGet('/filters')
  async getFilters(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, () => this.filtersService.getFilters());
  }

  @httpGet('/overview')
  async getOverview(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, () => this.overviewService.getOverview(isRefresh(req.query)));
  }

  @httpGet('/purchase')
  async getPurchase(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, () =>
      this.purchaseService.getPurchase(parseFilters(req.query), isRefresh(req.query)),
    );
  }

  @httpGet('/sales')
  async getSales(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, () =>
      this.salesService.getSales(parseFilters(req.query), isRefresh(req.query)),
    );
  }

  @httpGet('/documents')
  async getDocuments(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, () => this.documentsService.getDocuments());
  }

  @httpGet('/users')
  async getUsers(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, () => this.usersService.getUsers(isRefresh(req.query)));
  }

  /**
   * Admin check, the standard envelope, and errors as a real HTTP status. Roles
   * are plain strings on the user, so the check is a simple includes().
   */
  private async handle(res: Response, next: NextFunction, load: () => Promise<object>) {
    try {
      const roles: string[] = res.locals.user?.roles ?? [];
      if (!roles.includes(Role.ADMIN)) {
        return next(new AppError(403, 'Only admins can view the admin dashboard'));
      }
      const data = await load();
      res.status(200).json({ data, allRecords: 0, totalPages: 1, page: 1 });
    } catch (error) {
      next(error);
    }
  }
}
