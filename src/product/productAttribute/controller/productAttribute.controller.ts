import { NextFunction, Request, Response } from 'express';
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
import { Role } from '../../../employee/entity/user.entity';
import { requireRole } from '../../../middleware/requireRole';
import { deserializeUser, requireUser } from '../../../middleware/deserializeUser';
import { TYPES } from '../../../types';
import { ControllerLogger } from '../../../utils/controllerLogger';
import { ProductAttributeService } from '../service/productAttribute.service';

/** Attribute master - the values products vary by (docs/product-variant-plan.md §1). */
@controller('/product-attributes', deserializeUser, requireUser)
export class ProductAttributeController {
  constructor(
    @inject(TYPES.ProductAttributeService)
    private readonly attributeService: ProductAttributeService,
  ) {}

  @httpGet('/')
  public async findAll(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const data = await this.attributeService.findAll();
      ControllerLogger.logList('Product Attribute', req, res);
      res.status(200).json({ status: 'success', data });
    } catch (err) {
      ControllerLogger.logError('Product Attribute list retrieval', err, req, res);
      next(err);
    }
  }

  @httpPost('/', requireRole(Role.ADMIN))
  public async createAttribute(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const attribute = await this.attributeService.createAttribute(req.body?.name);
      ControllerLogger.logSuccess('Product Attribute created', attribute.id, req, res);
      res.status(201).json({ status: 'success', message: 'Attribute created', data: attribute });
    } catch (err) {
      ControllerLogger.logError('Product Attribute creation', err, req, res);
      next(err);
    }
  }

  @httpPatch('/values/:valueId', requireRole(Role.ADMIN))
  public async updateValue(
    @requestParam('valueId') valueId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { value, isActive } = req.body ?? {};
      const saved = await this.attributeService.updateValue(valueId, { value, isActive });
      ControllerLogger.logSuccess('Product Attribute value updated', valueId, req, res);
      res.status(200).json({ status: 'success', message: 'Value updated', data: saved });
    } catch (err) {
      ControllerLogger.logError('Product Attribute value update', err, req, res);
      next(err);
    }
  }

  @httpDelete('/values/:valueId', requireRole(Role.ADMIN))
  public async deleteValue(
    @requestParam('valueId') valueId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      await this.attributeService.deleteValue(valueId);
      ControllerLogger.logSuccess('Product Attribute value deleted', valueId, req, res);
      res.status(200).json({ status: 'success', message: 'Value deleted' });
    } catch (err) {
      ControllerLogger.logError('Product Attribute value deletion', err, req, res);
      next(err);
    }
  }

  @httpPatch('/:id', requireRole(Role.ADMIN))
  public async updateAttribute(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { name, isActive, sortOrder } = req.body ?? {};
      const saved = await this.attributeService.updateAttribute(id, { name, isActive, sortOrder });
      ControllerLogger.logSuccess('Product Attribute updated', id, req, res);
      res.status(200).json({ status: 'success', message: 'Attribute updated', data: saved });
    } catch (err) {
      ControllerLogger.logError('Product Attribute update', err, req, res);
      next(err);
    }
  }

  @httpPost('/:id/values', requireRole(Role.ADMIN))
  public async addValue(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const value = await this.attributeService.addValue(id, req.body?.value);
      ControllerLogger.logSuccess('Product Attribute value created', value.id, req, res);
      res.status(201).json({
        status: 'success',
        message: 'Value added',
        data: { id: value.id, value: value.value, isActive: value.isActive },
      });
    } catch (err) {
      ControllerLogger.logError('Product Attribute value creation', err, req, res);
      next(err);
    }
  }
}
