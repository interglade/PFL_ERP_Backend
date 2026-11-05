import { checkPermission } from '../../middleware/checkPermission';
import { inject } from 'inversify';
import { controller, httpGet, httpPost, httpPut, next, request, requestParam, response } from 'inversify-express-utils';
import { NextFunction, Request, Response } from 'express';
import { TYPES } from '../../types';
import logger from '../../utils/logger';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { ControllerLogger } from '../../utils/controllerLogger';
import { UserActivityLogService } from '../../employeeActivity/service/userActivityLog.service';
import { ActivityAction, ActivityModule } from '../../employeeActivity/entity/userActivityLog.entity';
import { GrnPaymentService } from '../service/grnPayment.service';

/**
 * GRN payment history (docs/grn-payment-history-plan.md §3.2). Anyone who can open the GRN can
 * read its payments; only Payment Managers record, edit or void them.
 */
@controller('/grns', deserializeUser, requireUser)
export class GrnPaymentController {
  constructor(
    @inject(TYPES.GrnPaymentService) private readonly grnPaymentService: GrnPaymentService,
    @inject(TYPES.UserActivityLogService) private readonly activityLogService: UserActivityLogService,
  ) {}

  private async log(req: Request, res: Response, action: ActivityAction, description: string, entityId: string, metadata: Record<string, any>) {
    try {
      const user = res.locals.user;
      const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'Unknown User';
      await this.activityLogService.logActivity({
        userId: user.id,
        userName,
        action,
        module: ActivityModule.GRN,
        entityName: 'GRN',
        entityId,
        description: `${userName} ${description}`,
        metadata,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: res.statusCode,
      });
    } catch (error) {
      logger.error('Failed to log GRN payment activity:', error);
    }
  }

  @httpGet('/:id/payments', checkPermission('grn', 'view'))
  public async getPayments(@requestParam('id') id: string, @request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const data = await this.grnPaymentService.getPayments(id, res.locals.user);
      res.status(200).json({ status: 'success', data });
    } catch (error) {
      ControllerLogger.logError('GRN payments retrieval', error, req, res);
      nextFn(error);
    }
  }

  @httpPost('/:id/payments')
  public async recordPayment(@requestParam('id') id: string, @request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const data = await this.grnPaymentService.recordPayment(id, req.body ?? {}, res.locals.user);
      void this.log(req, res, ActivityAction.UPDATE,
        `recorded payment ${data.paymentNo} (${data.paymentType}) on GRN ${data.grnNo ?? ''}`.trim(), id,
        { event: 'grn-payment-recorded', paymentId: data.paymentId, ammountStatus: data.ammountStatus });
      res.status(201).json({ status: 'success', message: `Payment ${data.paymentNo} recorded`, data });
    } catch (error) {
      ControllerLogger.logError('GRN payment record', error, req, res);
      nextFn(error);
    }
  }

  @httpPut('/:id/payments/:paymentId')
  public async editPayment(
    @requestParam('id') id: string,
    @requestParam('paymentId') paymentId: string,
    @request() req: Request,
    @response() res: Response,
    @next() nextFn: NextFunction,
  ) {
    try {
      const data = await this.grnPaymentService.editPayment(id, paymentId, req.body ?? {}, res.locals.user);
      void this.log(req, res, ActivityAction.UPDATE,
        `edited payment ${data.paymentNo} on GRN ${data.grnNo ?? ''}`.trim(), id,
        { event: 'grn-payment-edited', paymentId, ammountStatus: data.ammountStatus, changes: data.changes });
      res.status(200).json({ status: 'success', message: `Payment ${data.paymentNo} updated`, data });
    } catch (error) {
      ControllerLogger.logError('GRN payment edit', error, req, res);
      nextFn(error);
    }
  }

  @httpPost('/:id/payments/:paymentId/void')
  public async voidPayment(
    @requestParam('id') id: string,
    @requestParam('paymentId') paymentId: string,
    @request() req: Request,
    @response() res: Response,
    @next() nextFn: NextFunction,
  ) {
    try {
      const data = await this.grnPaymentService.voidPayment(id, paymentId, req.body?.reason, res.locals.user);
      void this.log(req, res, ActivityAction.UPDATE,
        `voided payment ${data.paymentNo} on GRN ${data.grnNo ?? ''}`.trim(), id,
        { event: 'grn-payment-voided', paymentId, ammountStatus: data.ammountStatus });
      res.status(200).json({ status: 'success', message: `Payment ${data.paymentNo} voided`, data });
    } catch (error) {
      ControllerLogger.logError('GRN payment void', error, req, res);
      nextFn(error);
    }
  }

  /** The advance alone covers the GRN total: a finalizer confirms it as paid. */
  @httpPost('/:id/payments/confirm-paid')
  public async confirmPaid(@requestParam('id') id: string, @request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const data = await this.grnPaymentService.confirmPaidByAdvance(id, res.locals.user);
      void this.log(req, res, ActivityAction.UPDATE, 'confirmed a GRN as paid by its advance', id,
        { event: 'amount-status', ammountStatus: data.ammountStatus });
      res.status(200).json({ status: 'success', message: 'GRN marked as paid', data });
    } catch (error) {
      ControllerLogger.logError('GRN confirm paid', error, req, res);
      nextFn(error);
    }
  }
}
