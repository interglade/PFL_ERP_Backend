import { inject } from 'inversify';
import { controller, httpGet, httpPost, next, request, requestParam, response } from 'inversify-express-utils';
import { NextFunction, Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { NotificationService } from '../../../notification/service/notification.service';
import { notifyDocumentPeople } from '../../../notification/flowNotifications';
import { DocumentTypeEnum } from '../../../approvalFlow/entity/docuemnt.entity';
import { TYPES } from '../../../types';
import { deserializeUser, requireUser } from '../../../middleware/deserializeUser';
import { confirmDelivery, deliveryStates, deliveryStatus, undoDeliveryConfirmation } from '../service/dcDelivery';

/** Delivery confirmation of Customer DCs (Phase D-1 / D-3). */
@controller('/delivery-confirmation', deserializeUser, requireUser)
export class DcDeliveryController {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.NotificationService) private readonly notificationService: NotificationService,
  ) {}

  /** D-9: the Customer DC's creator and approval-flow users. */
  private async notifyDc(dcId: string, message: (dcNo: string) => string, actorId: string): Promise<void> {
    try {
      const rows: Array<{ no: string | null }> = await this.dataSource.query(`SELECT "challanNo" AS no FROM delivery_challan_purchase WHERE id = $1`, [dcId]);
      await notifyDocumentPeople(this.dataSource.manager, this.notificationService, DocumentTypeEnum.DC_TYPE_CUSTOMER, dcId, message(rows[0]?.no ?? ''), actorId);
    } catch {
      // Runs after the response; a notification failure must not surface as a request error.
    }
  }

  /** Delivery states of many DCs for list columns: `{ dcIds: string[] }`. */
  @httpPost('/statuses')
  public async statuses(@request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const ids = Array.isArray(req.body?.dcIds) ? (req.body.dcIds as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, 500) : [];
      res.status(200).json({ status: 'success', data: await deliveryStates(this.dataSource.manager, ids) });
    } catch (error) {
      nextFn(error);
    }
  }

  /** Delivery state of one DC: confirmation, RBC, invoice, whether this user can confirm / undo and why not. */
  @httpGet('/:dcId')
  public async status(@requestParam('dcId') dcId: string, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      res.status(200).json({ status: 'success', data: await deliveryStatus(this.dataSource.manager, dcId, res.locals.user?.id ?? null) });
    } catch (error) {
      nextFn(error);
    }
  }

  /** Confirm the delivery: `{ receiverName?, remark?, proofUrl? }`; the outcome is set by the server. */
  @httpPost('/:dcId/confirm')
  public async confirm(@requestParam('dcId') dcId: string, @request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const data = await this.dataSource.transaction((manager) =>
        confirmDelivery(manager, dcId, res.locals.user.id, {
          receiverName: req.body?.receiverName ?? null,
          remark: req.body?.remark ?? null,
          proofUrl: req.body?.proofUrl ?? null,
        }),
      );
      res.status(201).json({ status: 'success', data });
      const outcome = data.outcome === 'DELIVERED_WITH_RETURN' ? `delivered with return (${data.rbcNo ?? 'RBC'})` : 'delivered with no return';
      await this.notifyDc(dcId, (no) => `DC ${no} was ${outcome}: the Final Invoice can now be created`, res.locals.user.id);
    } catch (error) {
      nextFn(error);
    }
  }

  /** Undo the confirmation: `{ reason }` (approvers of the DC / its invoice only, never the confirming user, no live invoice). */
  @httpPost('/:dcId/undo')
  public async undo(@requestParam('dcId') dcId: string, @request() req: Request, @response() res: Response, @next() nextFn: NextFunction) {
    try {
      const data = await this.dataSource.transaction((manager) => undoDeliveryConfirmation(manager, dcId, res.locals.user.id, req.body?.reason ?? null));
      res.status(200).json({ status: 'success', data });
      await this.notifyDc(dcId, (no) => `The delivery confirmation of DC ${no} was undone (${data.undoReason ?? ''}): no invoice until it is confirmed again`, res.locals.user.id);
    } catch (error) {
      nextFn(error);
    }
  }
}
