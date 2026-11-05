import { EntityManager } from 'typeorm';

/**
 * Pure closure-table helpers for workflow_hierarchy, shared by WorkflowHierarchyService,
 * the integrity migration and the repair script.
 *
 * A department's tree is kept as `managerOf` (employee -> direct manager) plus `members`
 * (everyone in the tree, top people included). The closure rows (depth 0 self rows and every
 * ancestor/descendant pair) are always derived from those two, never patched in place.
 */

export type ClosureRow = { ancestor: string; descendant: string; depth: number };

export type DepartmentTree = {
  members: Set<string>;
  managerOf: Map<string, string>;
};

/** The managers above `employeeId`, nearest first. Stops at a cycle. */
export function managersAbove(managerOf: Map<string, string>, employeeId: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([employeeId]);
  let current = managerOf.get(employeeId);
  while (current && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = managerOf.get(current);
  }
  return chain;
}

/** True when `candidate` is `employeeId` or somewhere below them. */
export function isInSubtree(managerOf: Map<string, string>, employeeId: string, candidate: string): boolean {
  return candidate === employeeId || managersAbove(managerOf, candidate).includes(employeeId);
}

/**
 * Takes `employeeId` out of the tree; their direct team then reports to their manager
 * (or becomes top level when they had none).
 */
export function removeMember(tree: DepartmentTree, employeeId: string): void {
  const manager = tree.managerOf.get(employeeId);
  for (const [employee, current] of tree.managerOf) {
    if (current !== employeeId) continue;
    if (manager) tree.managerOf.set(employee, manager);
    else tree.managerOf.delete(employee);
  }
  tree.managerOf.delete(employeeId);
  tree.members.delete(employeeId);
}

export function closureRows(tree: DepartmentTree): ClosureRow[] {
  const rows: ClosureRow[] = [];
  for (const member of tree.members) {
    rows.push({ ancestor: member, descendant: member, depth: 0 });
    managersAbove(tree.managerOf, member).forEach((manager, i) =>
      rows.push({ ancestor: manager, descendant: member, depth: i + 1 }),
    );
  }
  return rows;
}

/**
 * Turns whatever rows a department has (possibly duplicated, with several managers per
 * employee or cycles) into a valid tree: per employee the earliest direct manager wins,
 * self links are dropped, and a link that would close a cycle is dropped.
 */
export function treeFromRows(
  rows: Array<{ ancestor_id: string; descendant_id: string; depth: number; createdAt?: Date | string }>,
): DepartmentTree {
  const members = new Set<string>();
  const managerOf = new Map<string, string>();
  const direct = rows
    .filter((r) => Number(r.depth) === 1)
    .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());

  for (const r of rows) {
    if (Number(r.depth) === 0 && r.ancestor_id) members.add(r.ancestor_id);
  }
  for (const r of direct) {
    const manager = r.ancestor_id;
    const employee = r.descendant_id;
    if (!manager || !employee || manager === employee || managerOf.has(employee)) continue;
    if (isInSubtree(managerOf, employee, manager)) continue;
    managerOf.set(employee, manager);
    members.add(manager);
    members.add(employee);
  }
  return { members, managerOf };
}

export async function loadDepartmentTree(manager: EntityManager, department: string): Promise<DepartmentTree> {
  const rows = await manager.query(
    `SELECT ancestor_id, descendant_id, depth, "createdAt" FROM workflow_hierarchy WHERE department = $1`,
    [department],
  );
  return treeFromRows(rows);
}

/** Replaces the department's rows with the closure of `tree`. Run inside a transaction. */
export async function writeDepartmentTree(manager: EntityManager, department: string, tree: DepartmentTree): Promise<void> {
  await manager.query(`DELETE FROM workflow_hierarchy WHERE department = $1`, [department]);
  const rows = closureRows(tree);
  if (!rows.length) return;
  await manager.query(
    `INSERT INTO workflow_hierarchy (department, ancestor_id, descendant_id, depth)
     SELECT $1, t.ancestor, t.descendant, t.depth
       FROM unnest($2::uuid[], $3::uuid[], $4::int[]) AS t(ancestor, descendant, depth)`,
    [department, rows.map((r) => r.ancestor), rows.map((r) => r.descendant), rows.map((r) => r.depth)],
  );
}

/** Serialises writers of one department's tree for the rest of the transaction. */
export async function lockDepartment(manager: EntityManager, department: string): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`workflow_hierarchy:${department}`]);
}

/**
 * Rebuilds every department from its direct links (see treeFromRows). Employees that no
 * longer exist or are deleted are taken out, their team moving up to their manager.
 * Returns per department how many rows there were and how many there are now.
 */
export async function repairAllDepartments(
  manager: EntityManager,
): Promise<Array<{ department: string; before: number; after: number }>> {
  const departments: Array<{ department: string; n: string }> = await manager.query(
    `SELECT department, count(*) AS n FROM workflow_hierarchy GROUP BY department`,
  );
  const active = new Set<string>(
    (await manager.query(`SELECT id FROM employees WHERE "deletedAt" IS NULL`)).map((r: { id: string }) => r.id),
  );
  const report: Array<{ department: string; before: number; after: number }> = [];
  for (const { department, n } of departments) {
    const tree = await loadDepartmentTree(manager, department);
    for (const member of [...tree.members]) {
      if (!active.has(member)) removeMember(tree, member);
    }
    await writeDepartmentTree(manager, department, tree);
    report.push({ department, before: Number(n), after: closureRows(tree).length });
  }
  return report;
}
