import { Role } from '../../employee/entity/user.entity';
import { DepartmentEnum } from '../../workFlow/entity/workflowClosure.entity';
import { selfAndTeamIds } from '../../workFlow/planAccess';
import { ReportPermKey, ReportScope } from '../reportCenter.types';

/** The reporting tree that decides a team leader's team for each report type. */
const DEPARTMENT_OF: Partial<Record<ReportPermKey, DepartmentEnum>> = {
  'purchase-report': DepartmentEnum.PURCHASE,
  'sales-report': DepartmentEnum.SALE,
  'operation-report': DepartmentEnum.OPERATIONS,
};

/**
 * Who sees what (docs/reports-plan.md §3.4):
 *  - admin: everything
 *  - everyone else: documents they created, plus those of everyone below them in the
 *    report type's department tree (a team member has nobody below, so sees only their own)
 *  - Business Reports are company-wide by nature and are granted to management only
 */
export async function resolveScope(user: any, permKey: ReportPermKey): Promise<ReportScope> {
  const roles: string[] = Array.isArray(user?.roles) ? user.roles : [];
  const userName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.username || 'Unknown';
  const isAdmin = roles.includes(Role.ADMIN);
  const department = DEPARTMENT_OF[permKey];

  if (isAdmin || !department) {
    return { userId: user.id, userName, isAdmin, creatorIds: null };
  }
  return { userId: user.id, userName, isAdmin, creatorIds: await selfAndTeamIds(user.id, department) };
}
