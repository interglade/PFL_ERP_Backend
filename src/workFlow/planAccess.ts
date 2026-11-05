import { NextFunction, Request, Response } from 'express';
import { EntityManager } from 'typeorm';
import { Role } from '../employee/entity/user.entity';
import AppError from '../utils/appError';
import { AppDataSource } from '../utils/data-source';
import { DepartmentEnum } from './entity/workflowClosure.entity';

/**
 * Business plan approval (single level, from the department's reporting tree):
 *  - an employee's own plan goes to their direct manager: Pending until approved or rejected
 *  - a plan a direct manager creates or edits for a direct team member: Approved at once
 *  - a top person's own plan (in the tree, nobody above): Approved at once
 *  - any edit by the employee sends the plan back to Pending
 *  - someone not in the department's tree cannot create a plan (nobody could approve it)
 */

export const PLAN_STATUS = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' } as const;
export type PlanStatus = (typeof PLAN_STATUS)[keyof typeof PLAN_STATUS];

const DEPARTMENT_LABEL: Partial<Record<DepartmentEnum, string>> = {
  [DepartmentEnum.PURCHASE]: 'Procurement',
  [DepartmentEnum.SALE]: 'Sales',
};

export async function directManagerOf(
  employeeId: string,
  department: DepartmentEnum,
  manager: EntityManager = AppDataSource.manager,
): Promise<string | null> {
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT ancestor_id AS id FROM workflow_hierarchy WHERE descendant_id = $1 AND department = $2 AND depth = 1 LIMIT 1`,
    [employeeId, department],
  );
  return rows[0]?.id ?? null;
}

export async function directReportIds(managerId: string, department: DepartmentEnum): Promise<string[]> {
  const rows: Array<{ id: string }> = await AppDataSource.query(
    `SELECT descendant_id AS id FROM workflow_hierarchy WHERE ancestor_id = $1 AND department = $2 AND depth = 1`,
    [managerId, department],
  );
  return rows.map((r) => r.id);
}

/** The employee and everyone below them in the department's tree. */
export async function selfAndTeamIds(employeeId: string, department: DepartmentEnum): Promise<string[]> {
  const rows: Array<{ id: string }> = await AppDataSource.query(
    `SELECT DISTINCT descendant_id AS id FROM workflow_hierarchy WHERE ancestor_id = $1 AND department = $2`,
    [employeeId, department],
  );
  return [...new Set([employeeId, ...rows.map((r) => r.id)])];
}

async function isInWorkflow(employeeId: string, department: DepartmentEnum, manager: EntityManager): Promise<boolean> {
  const rows = await manager.query(
    `SELECT 1 FROM workflow_hierarchy WHERE descendant_id = $1 AND department = $2 LIMIT 1`,
    [employeeId, department],
  );
  return rows.length > 0;
}

/**
 * The status a plan gets when `actorId` creates or saves it for `employeeId`; throws 403
 * when the actor may not create or edit that employee's plan.
 */
export async function planStatusOnSave(
  actorId: string,
  employeeId: string,
  department: DepartmentEnum,
  manager: EntityManager = AppDataSource.manager,
): Promise<{ status: PlanStatus; approvedById: string | null }> {
  const label = DEPARTMENT_LABEL[department] ?? department;
  const managerId = await directManagerOf(employeeId, department, manager);
  if (actorId !== employeeId) {
    if (managerId !== actorId) {
      throw new AppError(403, `You can create or edit a plan only for yourself or your direct team members in the ${label} workflow`);
    }
    return { status: PLAN_STATUS.APPROVED, approvedById: actorId };
  }
  if (managerId) return { status: PLAN_STATUS.PENDING, approvedById: null };
  if (await isInWorkflow(employeeId, department, manager)) {
    return { status: PLAN_STATUS.APPROVED, approvedById: actorId };
  }
  throw new AppError(403, `You are not in the ${label} workflow yet. Ask the admin to add you before creating a plan.`);
}

/** Only the employee's direct manager decides a Pending plan. */
export async function assertCanDecidePlan(
  actorId: string,
  employeeId: string,
  department: DepartmentEnum,
  status: string,
): Promise<void> {
  if (status !== PLAN_STATUS.PENDING) {
    throw new AppError(409, `This plan is already ${status}. Only a Pending plan can be approved or rejected.`);
  }
  if ((await directManagerOf(employeeId, department)) !== actorId) {
    throw new AppError(403, 'Only the direct reporting manager can approve or reject this plan');
  }
}

/** What the viewer may do with one plan — sent to the screens so they show the right buttons. */
export async function planActions(
  viewerId: string,
  plan: { employeeId: string | null; status: string },
  department: DepartmentEnum,
): Promise<{ canEdit: boolean; canApprove: boolean }> {
  if (!plan.employeeId) return { canEdit: false, canApprove: false };
  const isOwn = plan.employeeId === viewerId;
  const isDirectManager = !isOwn && (await directManagerOf(plan.employeeId, department)) === viewerId;
  return {
    canEdit: isOwn || isDirectManager,
    canApprove: isDirectManager && plan.status === PLAN_STATUS.PENDING,
  };
}

const isAdmin = (user: any) => Array.isArray(user?.roles) && user.roles.includes(Role.ADMIN);

async function isAbove(viewerId: string, employeeId: string | null, department?: DepartmentEnum): Promise<boolean> {
  if (!employeeId) return false;
  const rows = await AppDataSource.query(
    `SELECT 1 FROM workflow_hierarchy
      WHERE ancestor_id = $1 AND descendant_id = $2 AND depth > 0 ${department ? 'AND department = $3' : ''} LIMIT 1`,
    department ? [viewerId, employeeId, department] : [viewerId, employeeId],
  );
  return rows.length > 0;
}

function employeeScopeGuard(department?: DepartmentEnum) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = res.locals.user;
      const target = req.params.employeeId ?? (typeof req.query.employee === 'string' ? req.query.employee : undefined);
      if (!target || target === user?.id || isAdmin(user)) return next();
      if (!(await isAbove(user?.id, target, department))) {
        return next(new AppError(403, "You can only see your own or your team's data"));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Route guard for endpoints that take another employee's id (:employeeId or ?employee=):
 * admins any employee; others themselves or anyone below them in a reporting tree.
 */
export const guardEmployeeScope = employeeScopeGuard();

/** Same as guardEmployeeScope, limited to one department's reporting tree. */
export const guardEmployeeScopeIn = (department: DepartmentEnum) => employeeScopeGuard(department);

const PLAN_TABLES = {
  procurement: { table: 'procurement_targets', creator: 'createdby_id', department: DepartmentEnum.PURCHASE },
  sales: { table: 'sales_targets', creator: 'created_by_id', department: DepartmentEnum.SALE },
} as const;

/**
 * Route guard for one plan by :id — admins, the plan's employee, its creator, or anyone above
 * the employee in that department's reporting tree (managers view their team's plans).
 */
export const guardPlanRecord = (kind: keyof typeof PLAN_TABLES) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = res.locals.user;
      if (isAdmin(user)) return next();
      const { table, creator, department } = PLAN_TABLES[kind];
      const rows: Array<{ employee: string | null; creator: string | null }> = await AppDataSource.query(
        `SELECT employee_id::text AS employee, ${creator}::text AS creator FROM ${table} WHERE id::text = $1`,
        [req.params.id],
      );
      const plan = rows[0];
      if (!plan) return next(new AppError(404, 'Business plan not found'));
      if (plan.employee === user?.id || plan.creator === user?.id) return next();
      if (!(await isAbove(user?.id, plan.employee, department))) {
        return next(new AppError(403, 'You do not have access to this plan'));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
