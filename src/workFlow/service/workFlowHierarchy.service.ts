import { inject, injectable } from "inversify";
import { EntityManager } from "typeorm";
import { DepartmentEnum } from "../entity/workflowClosure.entity";
import { TYPES } from "../../types";
import { WorkflowHierarchyRepository } from "../repository/WorkflowHierarchy.repository";
import AppError from "../../utils/appError";
import {
  DepartmentTree,
  isInSubtree,
  loadDepartmentTree,
  lockDepartment,
  removeMember,
  writeDepartmentTree,
} from "../closure";

export type WorkflowNode = {
  id: string;
  nodeId: string;
  name: string;
  employeeId: string | null;
  designation: string | null;
  managerId: string | null;
  children: WorkflowNode[];
};

type EmployeeInfo = { id: string; name: string; employeeId: string | null; designation: string | null };

/**
 * Reporting tree per department. Rules kept on every write:
 *  - one direct manager per employee per department
 *  - nobody reports to themselves or to someone in their own team (no cycles)
 *  - only existing, non-deleted employees
 * Each write runs in one transaction, locked per department, and rebuilds the closure rows
 * from the direct links (see ../closure.ts).
 */
@injectable()
export class WorkflowHierarchyService {

  constructor(
    @inject(TYPES.WorkflowHierarchyRepository)
    private readonly workflowHierarchyRepository: WorkflowHierarchyRepository,
  ) {}

  // ─── Reads ────────────────────────────────────────────────────────────────

  /**
   * The department's reporting tree as a list of top-level people. With `managerId`, only
   * that person and their team (an empty list when they are not in the tree).
   */
  async getTree(department: DepartmentEnum, managerId?: string): Promise<WorkflowNode[]> {
    const tree = await loadDepartmentTree(this.workflowHierarchyRepository.manager, department);
    const employees = await this.findEmployees(this.workflowHierarchyRepository.manager, [...tree.members]);
    const forest = this.buildForest(tree, employees);
    if (!managerId) return forest;
    const found = this.findNode(forest, managerId);
    return found ? [found] : [];
  }

  /** The user's team in every department where they lead one (used for team views). */
  async getChildrenTreeForAllDepartments(userId: string): Promise<{ department: string; tree: WorkflowNode | null }[]> {
    const departments: Array<{ department: DepartmentEnum }> = await this.workflowHierarchyRepository.query(
      `SELECT DISTINCT department FROM workflow_hierarchy WHERE ancestor_id = $1 AND depth = 1`,
      [userId],
    );
    const result: { department: string; tree: WorkflowNode | null }[] = [];
    for (const { department } of departments) {
      const [tree] = await this.getTree(department, userId);
      result.push({ department, tree: tree ?? null });
    }
    return result;
  }

  // ─── Writes ───────────────────────────────────────────────────────────────

  /** `subordinateId` starts reporting to `managerId` (bringing their own team along). */
  async addSingleRelation(department: DepartmentEnum, managerId: string, subordinateId: string) {
    await this.change(department, [managerId, subordinateId], (tree, names) => {
      this.link(tree, names, managerId, subordinateId);
    });
    return { message: "Employee added to the workflow." };
  }

  /** Several links at once; all are applied or none (the error names the row). */
  async addBulkRelations(department: DepartmentEnum, relations: { manager: string; subordinate: string }[]) {
    if (!relations.length) throw new AppError(400, "Add at least one reporting line");
    relations.forEach((r, i) => {
      if (!r?.manager || !r?.subordinate) {
        throw new AppError(400, `Row ${i + 1}: select both "Reporting To" and "Reporting By"`);
      }
    });
    const ids = relations.flatMap((r) => [r.manager, r.subordinate]);
    await this.change(department, ids, (tree, names) => {
      relations.forEach((r, i) => {
        // the same line twice in one submission is harmless
        if (tree.managerOf.get(r.subordinate) === r.manager) return;
        try {
          this.link(tree, names, r.manager, r.subordinate);
        } catch (err) {
          if (err instanceof AppError) throw new AppError(err.statusCode, `Row ${i + 1}: ${err.message}`);
          throw err;
        }
      });
    });
    return { message: "Workflow saved." };
  }

  /**
   * `newEmployeeId` takes `oldEmployeeId`'s place: same manager, same team. The old employee
   * leaves the department's tree. Works for the top person too.
   */
  async replaceMember(department: DepartmentEnum, oldEmployeeId: string, newEmployeeId: string) {
    await this.change(department, [oldEmployeeId, newEmployeeId], (tree, names) => {
      if (!tree.members.has(oldEmployeeId)) {
        throw new AppError(404, `${names.get(oldEmployeeId)} is not in this workflow`);
      }
      if (oldEmployeeId === newEmployeeId) throw new AppError(400, "Select a different employee");
      if (tree.members.has(newEmployeeId)) {
        throw new AppError(409, `${names.get(newEmployeeId)} is already in this workflow. Use "Change Reporting Manager" to move them.`);
      }
      const manager = tree.managerOf.get(oldEmployeeId);
      for (const [employee, current] of tree.managerOf) {
        if (current === oldEmployeeId) tree.managerOf.set(employee, newEmployeeId);
      }
      tree.managerOf.delete(oldEmployeeId);
      tree.members.delete(oldEmployeeId);
      tree.members.add(newEmployeeId);
      if (manager) tree.managerOf.set(newEmployeeId, manager);
    });
    return { message: "Employee replaced in the workflow." };
  }

  /** Moves an employee (with their team) under another manager, or to the top when null. */
  async moveMember(department: DepartmentEnum, employeeId: string, newManagerId: string | null) {
    await this.change(department, newManagerId ? [employeeId, newManagerId] : [employeeId], (tree, names) => {
      if (!tree.members.has(employeeId)) {
        throw new AppError(404, `${names.get(employeeId)} is not in this workflow`);
      }
      tree.managerOf.delete(employeeId);
      if (newManagerId) this.link(tree, names, newManagerId, employeeId);
    });
    return { message: "Reporting manager changed." };
  }

  /** Takes an employee out of the tree; their team then reports to their manager. */
  async deleteSingleNode(department: DepartmentEnum, nodeId: string) {
    await this.change(department, [], (tree) => {
      if (!tree.members.has(nodeId)) throw new AppError(404, "This employee is not in the workflow");
      removeMember(tree, nodeId);
    });
    return { message: "Employee removed from the workflow. Their team now reports to their manager." };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Adds manager -> subordinate to the in-memory tree, enforcing the rules. */
  private link(tree: DepartmentTree, names: Map<string, string>, managerId: string, subordinateId: string) {
    if (managerId === subordinateId) throw new AppError(400, "An employee cannot report to themselves");
    const current = tree.managerOf.get(subordinateId);
    if (current === managerId) {
      throw new AppError(409, `${names.get(subordinateId)} already reports to ${names.get(managerId)}`);
    }
    if (current) {
      throw new AppError(
        409,
        `${names.get(subordinateId)} already reports to ${names.get(current) ?? "another manager"}. ` +
          `Use "Change Reporting Manager" to move them.`,
      );
    }
    if (isInSubtree(tree.managerOf, subordinateId, managerId)) {
      throw new AppError(400, `${names.get(managerId)} is in ${names.get(subordinateId)}'s team, so cannot be their manager`);
    }
    tree.managerOf.set(subordinateId, managerId);
    tree.members.add(managerId);
    tree.members.add(subordinateId);
  }

  /** Load, edit in memory, write back — one transaction, one department at a time. */
  private async change(
    department: DepartmentEnum,
    employeeIds: string[],
    edit: (tree: DepartmentTree, names: Map<string, string>) => void,
  ) {
    await this.workflowHierarchyRepository.manager.transaction(async (manager) => {
      await lockDepartment(manager, department);
      const tree = await loadDepartmentTree(manager, department);
      const wanted = [...new Set(employeeIds)];
      const found = await this.findEmployees(manager, [...new Set([...wanted, ...tree.members])]);
      const missing = wanted.filter((id) => !found.has(id));
      if (missing.length) throw new AppError(404, "Employee not found or deleted");
      const names = new Map([...found].map(([id, e]) => [id, e.name]));
      edit(tree, names);
      await writeDepartmentTree(manager, department, tree);
    });
  }

  private async findEmployees(manager: EntityManager, ids: string[]): Promise<Map<string, EmployeeInfo>> {
    const valid = ids.filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
    if (!valid.length) return new Map();
    const rows: EmployeeInfo[] = await manager.query(
      `SELECT id,
              TRIM(CONCAT_WS(' ', "firstName", "lastName")) AS name,
              "employeeId" AS "employeeId",
              designation
         FROM employees
        WHERE id = ANY($1::uuid[]) AND "deletedAt" IS NULL`,
      [valid],
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  private buildForest(tree: DepartmentTree, employees: Map<string, EmployeeInfo>): WorkflowNode[] {
    const nodes = new Map<string, WorkflowNode>();
    for (const id of tree.members) {
      const e = employees.get(id);
      if (!e) continue; // deleted after being added; hidden until the next repair
      nodes.set(id, {
        id,
        nodeId: id,
        name: e.name,
        employeeId: e.employeeId ?? null,
        designation: e.designation ?? null,
        managerId: tree.managerOf.get(id) ?? null,
        children: [],
      });
    }
    const roots: WorkflowNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.managerId ? nodes.get(node.managerId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    const byName = (a: WorkflowNode, b: WorkflowNode) => a.name.localeCompare(b.name);
    const sort = (list: WorkflowNode[]) => {
      list.sort(byName);
      list.forEach((n) => sort(n.children));
    };
    sort(roots);
    return roots;
  }

  private findNode(list: WorkflowNode[], id: string): WorkflowNode | null {
    for (const node of list) {
      if (node.id === id) return node;
      const found = this.findNode(node.children, id);
      if (found) return found;
    }
    return null;
  }
}
