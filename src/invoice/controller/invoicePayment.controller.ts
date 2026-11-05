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
import { InvoicePaymentService } from '../service/invoicePayment.service';

/**
 * Final Invoice payment history (client decision 2026-10-29, built like GRN payments). Anyone who
 * can open the invoice can read its payments; only Payment Managers record, edit or void them.
 */
@controller('/final-invoice', deserializeUser, requireUser)
export class InvoicePaymentController {
  constructor(
    @inject(TYPES.InvoicePaymentService) private readonly invoicePaymentService: InvoicePaymentService,
    @inject(TYPES.UserActivityLogService) private readonly activityLogService: UserActivityLogService,
  ) {}

  private async log(req: Request, res: Response, description: string, entityId: string, metadata: Record<string, any>) {
    try {
      const user = res.locals.user;
      const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'Unknown User';
      await this.activityLogService.logActivity({
        userId: user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.INVOICE,
        entityName: 'INVOICE',
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
      logger.error('Failed to log Final Invoice payment activity:', error);
    }
  }

  @httpGet('/:id/payments', checkPermission('final-invoice', 'view'))
  public async getPayments(@requestParam('id') id: string, @request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const data = await this.invoicePaymentService.getPayments(id, res.locals.user);
      res.status(200).json({ status: 'success', data });
    } catch (error) {
      ControllerLogger.logError('Final Invoice payments retrieval', error, req, res);
      nextFn(error);
    }
  }

  @httpPost('/:id/payments')
  public async recordPayment(@requestParam('id') id: string, @request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const data = await this.invoicePaymentService.recordPayment(id, req.body ?? {}, res.locals.user);
      void this.log(req, res, `recorded payment ${data.paymentNo} (${data.paymentType}) on Final Invoice ${data.invoiceNo ?? ''}`.trim(), id,
        { event: 'invoice-payment-recorded', paymentId: data.paymentId, ammountStatus: data.ammountStatus });
      res.status(201).json({ status: 'success', message: `Payment ${data.paymentNo} recorded`, data });
    } catch (error) {
      ControllerLogger.logError('Final Invoice payment record', error, req, res);
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
      const data = await this.invoicePaymentService.editPayment(id, paymentId, req.body ?? {}, res.locals.user);
      void this.log(req, res, `edited payment ${data.paymentNo} on Final Invoice ${data.invoiceNo ?? ''}`.trim(), id,
        { event: 'invoice-payment-edited', paymentId, ammountStatus: data.ammountStatus, changes: data.changes });
      res.status(200).json({ status: 'success', message: `Payment ${data.paymentNo} updated`, data });
    } catch (error) {
      ControllerLogger.logError('Final Invoice payment edit', error, req, res);
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
      const data = await this.invoicePaymentService.voidPayment(id, paymentId, req.body?.reason, res.locals.user);
      void this.log(req, res, `voided payment ${data.paymentNo} on Final Invoice ${data.invoiceNo ?? ''}`.trim(), id,
        { event: 'invoice-payment-voided', paymentId, ammountStatus: data.ammountStatus });
      res.status(200).json({ status: 'success', message: `Payment ${data.paymentNo} voided`, data });
    } catch (error) {
      ControllerLogger.logError('Final Invoice payment void', error, req, res);
      nextFn(error);
    }
  }
}
