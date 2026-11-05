import { Role } from '../../employee/entity/user.entity';
import { requireRole } from '../../middleware/requireRole';
import { controller, httpPost, httpGet, httpDelete, httpPut } from "inversify-express-utils";
import { NextFunction, Request, Response } from "express";
import { inject } from "inversify";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { DepartmentEnum, normalizeDepartment } from "../entity/workflowClosure.entity";
import { ControllerLogger } from "../../utils/controllerLogger";
import { WorkflowHierarchyService } from "../service/workFlowHierarchy.service";
import AppError from '../../utils/appError';

function parseDepartment(raw: unknown): DepartmentEnum {
  if (typeof raw !== 'string' || !raw.trim()) throw new AppError(400, 'Department is required');
  try {
    return normalizeDepartment(raw);
  } catch {
    throw new AppError(400, `Unknown department "${raw}"`);
  }
}

function requireIds(fields: Record<string, unknown>) {
  const missing = Object.entries(fields).filter(([, v]) => typeof v !== 'string' || !v).map(([k]) => k);
  if (missing.length) throw new AppError(400, `${missing.join(', ')} required`);
}

@controller("/workflow", deserializeUser, requireUser)
export class WorkflowHierarchyController {
  constructor(
    @inject(TYPES.WorkflowHierarchyService) private workflowService: WorkflowHierarchyService,
  ) {}

  /** Body: { department, managerId, newSubordinate } — newSubordinate starts reporting to managerId. */
  @httpPost("/add", requireRole(Role.ADMIN))
  async addRelation(req: Request, res: Response, next: NextFunction) {
    try {
      const { managerId, newSubordinate } = req.body;
      const department = parseDepartment(req.body.department);
      requireIds({ managerId, newSubordinate });
      const result = await this.workflowService.addSingleRelation(department, managerId, newSubordinate);
      ControllerLogger.logSuccess('Workflow relation added', `${managerId} -> ${newSubordinate}`, req, res);
      return res.status(201).json({ status: "success", message: result.message, data: result.message });
    } catch (error) {
      ControllerLogger.logError('Workflow relation addition', error, req, res);
      next(error);
    }
  }

  /** Body: { department, relations: [{ manager, subordinate }] } — all rows or none. */
  @httpPost("/bulk", requireRole(Role.ADMIN))
  async addBulkRelations(req: Request, res: Response, next: NextFunction) {
    try {
      const department = parseDepartment(req.body.department);
      const { relations } = req.body;
      if (!Array.isArray(relations)) throw new AppError(400, 'relations must be a list');
      const result = await this.workflowService.addBulkRelations(department, relations);
      ControllerLogger.logSuccess('Bulk workflow relations added', `${relations.length} relations`, req, res);
      return res.status(201).json({ status: "success", message: result.message, data: result.message });
    } catch (error) {
      ControllerLogger.logError('Bulk workflow relations addition', error, req, res);
      next(error);
    }
  }

  /**
   * The department's tree as a list of top-level people; with ?managerId= only that person
   * and their team.
   */
  @httpGet("/getworkflow/:department")
  async getTree(req: Request, res: Response, next: NextFunction) {
    try {
      const department = parseDepartment(req.params.department);
      const managerId = typeof req.query.managerId === 'string' && req.query.managerId ? req.query.managerId : undefined;
      const data = await this.workflowService.getTree(department, managerId);
      ControllerLogger.logList('Workflow tree', req, res);
      return res.status(200).json({ status: "success", data });
    } catch (error) {
      ControllerLogger.logError('Workflow tree retrieval', error, req, res);
      next(error);
    }
  }

  /** Body: { department, oldSubordinate, newSubordinate } — the new employee takes the old one's place. */
  @httpPut("/update-one", requireRole(Role.ADMIN))
  async replaceNode(req: Request, res: Response, next: NextFunction) {
    try {
      const department = parseDepartment(req.body.department);
      const { oldSubordinate, newSubordinate } = req.body;
      requireIds({ oldSubordinate, newSubordinate });
      const result = await this.workflowService.replaceMember(department, oldSubordinate, newSubordinate);
      ControllerLogger.logSuccess('Workflow employee replaced', `${oldSubordinate} -> ${newSubordinate}`, req, res);
      return res.status(200).json({ status: "success", message: result.message });
    } catch (error) {
      ControllerLogger.logError('Workflow employee replacement', error, req, res);
      next(error);
    }
  }

  /** Body: { department, employeeId, newManagerId | null } — moves the employee with their team. */
  @httpPut("/move", requireRole(Role.ADMIN))
  async moveNode(req: Request, res: Response, next: NextFunction) {
    try {
      const department = parseDepartment(req.body.department);
      const { employeeId } = req.body;
      const newManagerId = req.body.newManagerId || null;
      requireIds({ employeeId });
      const result = await this.workflowService.moveMember(department, employeeId, newManagerId);
      ControllerLogger.logSuccess('Workflow reporting manager changed', `${employeeId} -> ${newManagerId ?? 'top'}`, req, res);
      return res.status(200).json({ status: "success", message: result.message });
    } catch (error) {
      ControllerLogger.logError('Workflow reporting manager change', error, req, res);
      next(error);
    }
  }

  /** Takes the employee out of the department's tree; their team moves up to their manager. */
  @httpDelete("/delete-node/:department/:nodeId", requireRole(Role.ADMIN))
  async deleteSingleNode(req: Request, res: Response, next: NextFunction) {
    try {
      const department = parseDepartment(req.params.department);
      const { nodeId } = req.params;
      requireIds({ nodeId });
      const result = await this.workflowService.deleteSingleNode(department, nodeId);
      ControllerLogger.logSuccess('Workflow node deleted', nodeId, req, res);
      return res.status(200).json({ status: "success", message: result.message, data: result });
    } catch (error) {
      ControllerLogger.logError('Workflow node deletion', error, req, res);
      next(error);
    }
  }
}
