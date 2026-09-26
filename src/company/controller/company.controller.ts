import { controller, httpGet, request, response, next } from 'inversify-express-utils';

import { inject } from 'inversify';

import { NextFunction, Request, Response } from 'express';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
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
}
