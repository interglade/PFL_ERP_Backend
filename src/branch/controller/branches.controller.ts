import { inject } from 'inversify';
import {
  controller,
  httpPost,
  httpGet,
  httpDelete,
  request,
  requestParam,
  response,
  next,
  httpPatch,
} from 'inversify-express-utils';
import { TYPES } from '../../types';
import { BranchType } from '../entity/branches.entity';
import { NextFunction, Request, Response } from 'express';
import AppError from '../../utils/appError';
import { BranchessService } from '../service/branches.service';
import { captureUser, deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { PaginationOptions } from '../../utils/pagination';
import { ControllerLogger } from '../../utils/controllerLogger';

import { UserActivityLogService } from '../../employeeActivity/service/userActivityLog.service';

import {
  CreateBranchDto,
  UpdateBranchDto,
  BranchDetailDto,
  BranchListResponseDto,
  BranchFilterItemDto,
  BulkDeleteBranchDto,
} from '../dto/branch.dto';
import { NotificationService } from '../../notification/service/notification.service';
import { ActivityAction, ActivityModule } from '../../employeeActivity/entity/userActivityLog.entity';

@controller('/location-branches', deserializeUser, requireUser)
export class BranchessController {
  constructor(
    @inject(TYPES.BranchessService)
    private branchesService: BranchessService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService)
    private activityLogService: UserActivityLogService,
  ) {}

  // ─── Create ───────────────────────────────────────────────────────────────

  @httpPost('/:branchType')
  public async createBranch(
    @request() req: Request<{ branchType: string }, {}, CreateBranchDto>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const branchData: CreateBranchDto & Record<string, any> = { ...req.body, type: req.params.branchType as BranchType };
      const branch = await this.branchesService.createBranch(branchData);

      if (!branch) {
        ControllerLogger.logOperationFailed('Create', 'Branch', 'could not be created', req, res);
        return next(new AppError(400, 'Branch could not be created'));
      }

      const userId = res.locals.user?.id;
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';

      if (userId) {
        this.notificationService
          .createNoti(`${branch.type} "${branch.name}" created successfully`, userId)
          .catch(() => {});
      }
// Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = res.locals.user?.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.CREATE,
        module: ActivityModule.OTHER,
        entityName: 'Branch',
        entityId: branch.id,
        description: `${userName} has created ${branch.type} "${branch.name}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 201,
      }).catch(() => {});
    }

      ControllerLogger.logSuccess(`${branch.type} created`, branch.id, req, res);
      res.status(201).json({ status: 'success', message: `${branch.type} created successfully` });
    } catch (err) {
      ControllerLogger.logError('Branch creation', err, req, res);
      next(err);
    }
  }

  // ─── Get By ID ────────────────────────────────────────────────────────────

  @httpGet('/:id')
  public async getBranch(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      console.log("hiiiiiiiiiiii");
      const branch: BranchDetailDto | null = await this.branchesService.getBranchByIdAndType(id);

      if (!branch) {
        ControllerLogger.logNotFound('Branch', id, req, res);
        return next(new AppError(404, 'Branch not found'));
      }

      ControllerLogger.logView('Branch', id, req, res);
      res.status(200).json({ status: 'success', data: branch });
    } catch (err) {
      ControllerLogger.logError('Branch view', err, req, res);
      next(err);
    }
  }

  // ─── Get All By Type ──────────────────────────────────────────────────────

  @httpGet('/getall/:branchType')
  public async getAllBranch(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const branchType = req.params.branchType as BranchType;
      const { page, limit, search, sort } = req.query;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      const branch: BranchListResponseDto | null = await this.branchesService.getAllByBranchType(branchType, queryOptions);

      if (!branch) {
        ControllerLogger.logNotFound('Branch', branchType, req, res);
        return next(new AppError(404, 'Branch not found'));
      }

      ControllerLogger.logGetAllRecords('Branch', req, res);
      res.status(200).json({
        status: 'success',
        data: branch.data,
        allRecords: branch.meta.total,
        totalPages: branch.meta.pages,
        page: branch.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Branch retrieval', err, req, res);
      next(err);
    }
  }

  // ─── Get Filter Data ──────────────────────────────────────────────────────

  @httpGet('/filterData/filter/all')
  public async getAllFilterBranch(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const branches: BranchFilterItemDto[] = await this.branchesService.getAllByFilterDataBranchType();

      if (!branches || branches.length === 0) {
        ControllerLogger.logNotFound('Branches', 'filter data', req, res);
        return next(new AppError(404, 'Branches not found'));
      }

      ControllerLogger.logGetAllRecords('Branch', req, res);
      res.status(200).json({ status: 'success', data: branches });
    } catch (err) {
      ControllerLogger.logError('Branch filter retrieval', err, req, res);
      next(err);
    }
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  @httpPatch('/:branchType/:id', captureUser)
  public async updateBranch(
    @requestParam('id') id: string,
    @requestParam('branchType') branchType: string,
    @request() req: Request<{}, {}, UpdateBranchDto>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const updatedBy = res.locals.updatedBy;
      const updateData: UpdateBranchDto & Record<string, any> = { ...req.body, type: branchType as BranchType };

      const branch = await this.branchesService.updateBranch(id, updateData, updatedBy);

      if (!branch) {
        ControllerLogger.logOperationFailed('Update', 'Branch', 'not found or could not be updated', req, res);
        return next(new AppError(404, 'Branch not found or could not be updated'));
      }

      const userId = res.locals.user?.id;
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';

      if (userId) {
        this.notificationService
          .createNoti(`${branch.type} "${branch.name}" updated successfully`, userId)
          .catch(() => {});
      }
// Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = res.locals.user?.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.OTHER,
        entityName: 'Branch',
        entityId: id,
        description: `${userName} has updated ${branch.type} "${branch.name}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    }
      ControllerLogger.logSuccess('Branch updated', id, req, res);
      res.status(200).json({ status: 'success', message: `${branch.type} data updated successfully` });
    } catch (err) {
      ControllerLogger.logError('Branch update', err, req, res);
      next(err);
    }
  }

  // ─── Delete (schedule) ────────────────────────────────────────────────────

  @httpDelete('/')
  public async deleteBranch(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const id = req.query.id as string;
      const branchType = req.query.branchType as BranchType;

      const result = await this.branchesService.deleteBranch(id, branchType);

      if (!result) {
        ControllerLogger.logOperationFailed('Delete', 'Branch', 'not found or could not be deleted', req, res);
        return next(new AppError(404, 'Branch not found or could not be deleted'));
      }

      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
// Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = res.locals.user?.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.OTHER,
        entityName: 'Branch',
        entityId: id,
        description: `${userName} has deleted ${result.type} "${result.name}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    }

      ControllerLogger.logSuccess('Branch deleted', id, req, res);
      res.status(200).json({ status: 'success', message: `${branchType} deleted successfully` });
    } catch (err) {
      ControllerLogger.logError('Branch deletion', err, req, res);
      next(err);
    }
  }

  // ─── Soft Delete Multiple ─────────────────────────────────────────────────

  @httpDelete('/delete/multiple')
  public async softDeleteMultipleBranches(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { ids }: BulkDeleteBranchDto = req.body;
      const branchIds=ids;
      const branchType = req.query.branchType as BranchType;

      if (!Array.isArray(branchIds) || branchIds.length === 0) {
        return next(new AppError(400, 'branchIds must be a non-empty array'));
      }

      const result = await this.branchesService.softDeleteBranches(branchIds, branchType);

      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      const deletedList = result.deleted.map(b => `${b.type} "${b.name}"`).join(', ');
// Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = res.locals.user?.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.OTHER,
        entityName: 'Branch',
        description: `${userName} has bulk deleted ${result.deleted.length} branch(es): ${deletedList}`,
        metadata: { ids: branchIds, count: branchIds.length },
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    }
      ControllerLogger.logSuccess('Branch bulk soft deleted', branchIds.join(','), req, res);
      res.status(200).json({
        status: 'success',
        message: 'Branches soft deleted successfully',
        affected: result.affected,
      });
    } catch (err) {
      ControllerLogger.logError('Branch bulk deletion', err, req, res);
      next(err);
    }
  }
}
