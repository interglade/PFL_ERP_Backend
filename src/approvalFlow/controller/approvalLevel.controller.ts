// src/controllers/approvalLevel.controller.ts
import { NextFunction, Request, Response } from 'express';
import { inject, injectable } from 'inversify';

import { ApprovalLevel } from '../entity/approvalLevel.entity';
import { TYPES } from '../../types';
import {
  controller,
  httpGet,
  next,
  request,
  response,
} from 'inversify-express-utils';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { ApprovalLevelService } from '../service/approvalLevel.service';

@controller('/approval', deserializeUser, requireUser)
export class ApprovalLevelController {
  constructor(
    @inject(TYPES.ApprovalLevelService)
    private approvalLevelService: ApprovalLevelService,
  ) {}
  @httpGet('/')
  public async approvalmethod(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const { employeeId, department, level } = req.body;

      const approval = this.approvalLevelService.createApprovalLevelForEmployee(
        employeeId,
        department,
        level,
      );

      res.status(200).json({
        message: 'approve sucessfully approved',
        data: approval,
      });
    } catch (error) {
      next(error);
    }
  }
}
