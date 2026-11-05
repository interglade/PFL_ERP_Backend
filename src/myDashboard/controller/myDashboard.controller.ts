import { inject } from 'inversify';
import { controller, httpGet, next, request, response } from 'inversify-express-utils';
import { NextFunction, Request, Response } from 'express';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { TYPES } from '../../types';
import { Role } from '../../employee/entity/user.entity';
import AppError from '../../utils/appError';
import { isoIst } from '../../adminControlCenter/service/accShared.util';
import { MyWorkService } from '../service/myWork.service';
import { MyPaymentsService } from '../service/myPayments.service';
import { MyDepartmentsService } from '../service/myDepartments.service';
import { parsePeriod } from '../service/myShared';
import { WorkflowDepartment } from '../myDashboard.types';

/**
 * Standard user dashboard (docs/user-dashboard-plan.md §8). Every endpoint
 * returns only the signed-in user's own work. Admins and Super Admins use the
 * Admin Control Center instead and get 403 here.
 */
@controller('/dashboard/me', deserializeUser, requireUser)
export class MyDashboardController {
  constructor(
    @inject(TYPES.MyWorkService) private readonly workService: MyWorkService,
    @inject(TYPES.MyPaymentsService) private readonly paymentsService: MyPaymentsService,
    @inject(TYPES.MyDepartmentsService) private readonly departmentsService: MyDepartmentsService,
  ) {}

  @httpGet('/access')
  async getAccess(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, (userId) => this.workService.getAccess(userId));
  }

  @httpGet('/work')
  async getWork(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, async (userId, roles) => {
      const [work, payments] = await Promise.all([
        this.workService.getWork(userId, roles),
        roles.includes(Role.PAYMENT_MANAGER) ? this.paymentsService.queueSummary() : Promise.resolve(null),
      ]);
      return payments ? { ...work, queues: { ...work.queues, 'record-payment': payments } } : work;
    });
  }

  @httpGet('/team')
  async getTeam(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, (userId) => {
      const department = req.query.department as WorkflowDepartment;
      if (department !== 'procurement' && department !== 'sales') {
        throw new AppError(400, 'department must be procurement or sales');
      }
      const period = req.query.period === 'last-month' ? 'last-month' : 'this-month';
      return this.workService.getTeam(userId, department, period);
    });
  }

  @httpGet('/finalization')
  async getFinalization(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, (userId) => this.paymentsService.getFinalization(userId), Role.FINALIZER);
  }

  @httpGet('/payments')
  async getPayments(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, (userId) => this.paymentsService.getPayments(userId), Role.PAYMENT_MANAGER);
  }

  @httpGet('/procurement')
  async getProcurement(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, (userId) => this.departmentsService.getProcurement(userId, parsePeriod(req.query.period)));
  }

  @httpGet('/sales')
  async getSales(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, (userId) => this.departmentsService.getSales(userId, parsePeriod(req.query.period)));
  }

  @httpGet('/operation')
  async getOperation(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    await this.handle(res, next, (userId) => this.departmentsService.getOperation(userId, parsePeriod(req.query.period)));
  }

  /** Non-admin check, optional role check, and the standard envelope. */
  private async handle(
    res: Response,
    next: NextFunction,
    load: (userId: string, roles: string[]) => Promise<object>,
    requiredRole?: Role,
  ) {
    try {
      const user = res.locals.user;
      const roles: string[] = user?.roles ?? [];
      if (roles.includes(Role.ADMIN)) {
        return next(new AppError(403, 'Admins use the Admin Control Center dashboard'));
      }
      if (requiredRole && !roles.includes(requiredRole)) {
        return next(new AppError(403, 'This part of the dashboard is not part of your role'));
      }
      const data = await load(user.id, roles);
      res.status(200).json({ data: { generatedAt: isoIst(), ...data }, allRecords: 0, totalPages: 1, page: 1 });
    } catch (error) {
      next(error);
    }
  }
}
