import {
  controller, httpGet, httpPatch, httpPost, httpDelete, request, requestParam, response, next,
} from 'inversify-express-utils';

import { inject } from 'inversify';

import { NextFunction, Request, Response } from 'express';
import { captureUser, deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { requireRole } from '../../middleware/requireRole';
import { Role } from '../../employee/entity/user.entity';
import {
  validateCreateBankDetails,
  validateUpdateBankDetails,
  validateUpdateCompany,
} from '../dto/company.dto';
import { CompanyService } from '../service/company.service';
import { TYPES } from '../../types';
import { ControllerLogger } from '../../utils/controllerLogger';
import AppError from '../../utils/appError';


@controller('/company', deserializeUser, requireUser)
export class CompanyController {
  constructor(
    @inject(TYPES.CompanyService)
    private readonly companyService: CompanyService,
  ) {}

  // ─── Get All ──────────────────────────────────────────────────────────────

  @httpGet('/')
  async getCompany(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const companies = await this.companyService.getAllCompanies();

      if (!companies || companies.length === 0) {
        ControllerLogger.logNotFound('Company', 'all', req, res);
        return next(new AppError(404, 'Companies not found'));
      }

      ControllerLogger.logGetAllRecords('Company', req, res);
      res.status(200).json({ status: 'success', data: companies });
    } catch (error) {
      ControllerLogger.logError('Company retrieval', error, req, res);
      next(error);
    }
  }

  // ─── Get All For Update ───────────────────────────────────────────────────

  @httpGet('/update/getall')
  async getAllCompany(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const companies = await this.companyService.getAllforupdateCompanies();

      if (!companies || companies.length === 0) {
        ControllerLogger.logNotFound('Company', 'update list', req, res);
        return next(new AppError(404, 'Companies not found'));
      }

      ControllerLogger.logGetAllRecords('Company', req, res);
      res.status(200).json({ status: 'success', data: companies });
    } catch (error) {
      ControllerLogger.logError('Company update list retrieval', error, req, res);
      next(error);
    }
  }

  // ─── Get Partial ──────────────────────────────────────────────────────────

  @httpGet('/partial/details')
  async getPartialCompany(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const companies = await this.companyService.getPartialCompanyDeatils();

      if (!companies || companies.length === 0) {
        ControllerLogger.logNotFound('Company', 'partial details', req, res);
        return next(new AppError(404, 'Company partial details not found'));
      }

      ControllerLogger.logGetAllRecords('Company', req, res);
      res.status(200).json({ status: 'success', data: companies });
    } catch (error) {
      ControllerLogger.logError('Company partial details retrieval', error, req, res);
      next(error);
    }
  }

  // ─── Get By ID ────────────────────────────────────────────────────────────

  @httpGet('/:id')
  async getByIdCompany(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = req.params;
      const company = await this.companyService.getCompanyById(id);

      if (!company) {
        ControllerLogger.logNotFound('Company', id, req, res);
        return next(new AppError(404, 'Company not found'));
      }

      ControllerLogger.logView('Company', id, req, res);
      res.status(200).json({ status: 'success', data: company });
    } catch (error) {
      ControllerLogger.logError('Company view', error, req, res);
      next(error);
    }
  }

  // ─── Write routes: admin only ─────────────────────────────────────────────

  @httpPatch('/:id', captureUser, requireRole(Role.ADMIN))
  async updateCompany(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const dto = validateUpdateCompany(req.body);
      const company = await this.companyService.updateCompany(id, dto, res.locals.user.id);

      ControllerLogger.logSuccess('Company updated', id, req, res);
      res.status(200).json({ status: 'success', data: company });
    } catch (error) {
      ControllerLogger.logError('Company update', error, req, res);
      next(error);
    }
  }

  @httpPost('/:id/bank-details', captureUser, requireRole(Role.ADMIN))
  async addBankDetail(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const dto = validateCreateBankDetails(req.body);
      const bank = await this.companyService.addBankDetail(id, dto, res.locals.user.id);

      ControllerLogger.logSuccess('Company bank details added', bank.id, req, res);
      res.status(201).json({ status: 'success', data: bank });
    } catch (error) {
      ControllerLogger.logError('Company bank details creation', error, req, res);
      next(error);
    }
  }

  @httpPatch('/bank-details/:bankId', captureUser, requireRole(Role.ADMIN))
  async updateBankDetail(
    @requestParam('bankId') bankId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const dto = validateUpdateBankDetails(req.body);
      const bank = await this.companyService.updateBankDetail(bankId, dto, res.locals.user.id);

      ControllerLogger.logSuccess('Company bank details updated', bankId, req, res);
      res.status(200).json({ status: 'success', data: bank });
    } catch (error) {
      ControllerLogger.logError('Company bank details update', error, req, res);
      next(error);
    }
  }

  @httpDelete('/bank-details/:bankId', captureUser, requireRole(Role.ADMIN))
  async deleteBankDetail(
    @requestParam('bankId') bankId: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      await this.companyService.deleteBankDetail(bankId, res.locals.user.id);

      ControllerLogger.logSuccess('Company bank details deleted', bankId, req, res);
      res.status(200).json({ status: 'success', message: 'Bank details deleted' });
    } catch (error) {
      ControllerLogger.logError('Company bank details deletion', error, req, res);
      next(error);
    }
  }
}
