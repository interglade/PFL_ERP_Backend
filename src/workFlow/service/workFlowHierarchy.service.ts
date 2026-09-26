import { inject, injectable } from "inversify";
import { DepartmentEnum, WorkflowHierarchy } from "../entity/workflowClosure.entity";

import { MoreThan } from "typeorm";
import { TYPES } from "../../types";
import { WorkflowHierarchyRepository } from "../repository/WorkflowHierarchy.repository";


@injectable()
export class WorkflowHierarchyService {

  constructor(
    @inject(TYPES.WorkflowHierarchyRepository)
    private readonly workflowHierarchyRepository: WorkflowHierarchyRepository,
  ) {}

  /**
   * Insert a direct manager→subordinate relationship
   * Automatically builds the full hierarchy tree
   */
  async addSingleRelation(
    department: DepartmentEnum,
    managerId: string,
    subordinateId: string
  ) {
    // Check if relation already exists
    const existing = await this.workflowHierarchyRepository.findOne({
      where: {
        department,
        ancestor: { id: managerId },
        descendant: { id: subordinateId },
        depth: 1
      }
    });

    if (existing) {
      return { message: "Relation already exists" };
    }

    // Insert self-reference for manager (if not exists)
    await this.workflowHierarchyRepository
      .createQueryBuilder()
      .insert()
      .values({
        department,
        ancestor: { id: managerId } as any,
        descendant: { id: managerId } as any,
        depth: 0
      })
      .orIgnore()
      .execute();

    // Insert self-reference for subordinate (if not exists)
    await this.workflowHierarchyRepository
      .createQueryBuilder()
      .insert()
      .values({
        department,
        ancestor: { id: subordinateId } as any,
        descendant: { id: subordinateId } as any,
        depth: 0
      })
      .orIgnore()
      .execute();

    // Insert direct relation
    await this.workflowHierarchyRepository.insert({
      department,
      ancestor: { id: managerId } as any,
      descendant: { id: subordinateId } as any,
      depth: 1
    });

    // Insert indirect relations (closure table logic)
    // This connects all ancestors of manager to all descendants of subordinate
    await this.workflowHierarchyRepository.query(
      `
      INSERT INTO workflow_hierarchy (department, ancestor_id, descendant_id, depth)
      SELECT 
        $1 AS department,
        super_anc.ancestor_id, 
        super_desc.descendant_id,
        super_anc.depth + super_desc.depth + 1
      FROM workflow_hierarchy AS super_anc
      CROSS JOIN workflow_hierarchy AS super_desc
      WHERE super_anc.descendant_id = $2
        AND super_desc.ancestor_id = $3
        AND super_anc.department = $1
        AND super_desc.department = $1
      ON CONFLICT DO NOTHING;
      `,
      [department, managerId, subordinateId]
    );

    return { message: "Relation added successfully. Hierarchy automatically updated." };
  }

  /**
   * Add multiple relations at once
   */
  async addBulkRelations(
    department: DepartmentEnum,
    relations: { manager: string; subordinate: string }[]
  ) {
    

    for (const r of relations) {
      await this.addSingleRelation(department, r.manager, r.subordinate);
    }

    return { message: "Bulk workflow saved successfully. Full hierarchy built automatically." };
  }

  /**
   * Get full workflow tree for department
   */
  
  /**
   * Get all subordinates for a manager in tree format (direct and indirect)
   */
  async getSubordinates(managerId: string, department: DepartmentEnum) {
    // First, get all people under this manager
    const subordinateIds = await this.workflowHierarchyRepository.query(
      `
      SELECT DISTINCT descendant_id
      FROM workflow_hierarchy
      WHERE ancestor_id = $1 
        AND department = $2 
        AND depth > 0
      `,
      [managerId, department]
    );

    if (subordinateIds.length === 0) {
      // Return just the manager node with no children
      const managerInfo = await this.workflowHierarchyRepository.query(
        `
        SELECT 
          u.id,
          CONCAT(u."firstName", ' ', u."lastName") AS name
        FROM employees u
        WHERE u.id = $1
        `,
        [managerId]
      );
      
      return managerInfo.length > 0 ? {
        id: managerInfo[0].id,
        nodeId: managerInfo[0].id,
        name: managerInfo[0].name,
        children: []
      } : null;
    }

    // Get all relationships within the subtree (including the manager and all subordinates)
    const allIds = [managerId, ...subordinateIds.map((row: any) => row.descendant_id)];
    const placeholders = allIds.map((_, index) => `$${index + 2}`).join(',');
    
    const rows = await this.workflowHierarchyRepository.query(
      `
      SELECT DISTINCT
        wh.ancestor_id,
        wh.descendant_id,
        wh.depth,
        CONCAT(u1."firstName", ' ', u1."lastName") AS ancestor_name,
        CONCAT(u2."firstName", ' ', u2."lastName") AS descendant_name
      FROM workflow_hierarchy wh
      JOIN employees u1 ON wh.ancestor_id = u1.id
      JOIN employees u2 ON wh.descendant_id = u2.id
      WHERE wh.department = $1
        AND wh.ancestor_id IN (${placeholders})
        AND wh.descendant_id IN (${placeholders})
        AND wh.depth <= 1
      ORDER BY wh.depth ASC;
      `,
      [department, ...allIds]
    );

    // Build tree structure starting from the manager
    return this.buildManagerTree(rows, managerId);
  }


  /**
   * Get full workflow tree for department
   */
  async getWorkflowTree(department: DepartmentEnum) {
    const rows = await this.workflowHierarchyRepository.query(
      `
      SELECT 
        wh.ancestor_id,
        wh.descendant_id,
        wh.depth,
        CONCAT(u1."firstName", ' ', u1."lastName") AS ancestor_name,
        CONCAT(u2."firstName", ' ', u2."lastName") AS descendant_name
      FROM workflow_hierarchy wh
      JOIN employees u1 ON wh.ancestor_id = u1.id
      JOIN employees u2 ON wh.descendant_id = u2.id
      WHERE wh.department = $1 AND wh.depth > 0
      ORDER BY wh.depth ASC;
      `,
      [department]
    );

    return this.buildTree(rows);
  }



  /**
   * Build tree structure starting from a specific manager
   */
  private buildManagerTree(rows: any[], rootManagerId: string) {
    const nodeMap: any = {};
    
    // Create all nodes
    rows.forEach((row) => {
      if (!nodeMap[row.ancestor_id]) {
        nodeMap[row.ancestor_id] = {
          id: row.ancestor_id,
          nodeId: row.ancestor_id,
          name: row.ancestor_name,
          children: []
        };
      }
      if (!nodeMap[row.descendant_id]) {
        nodeMap[row.descendant_id] = {
          id: row.descendant_id,
          nodeId: row.descendant_id,
          name: row.descendant_name,
          employeeId: row.descendant_employee_id ?? null,
          designation: row.descendant_designation ?? null,
          children: []
        };
      }
    });

    // Attach children (only direct relationships)
    rows.forEach((row) => {
      if (row.depth === 1) {
        const parent = nodeMap[row.ancestor_id];
        const child = nodeMap[row.descendant_id];
        if (parent && child && parent !== child) {
          if (!parent.children.find((c: any) => c.id === child.id)) {
            parent.children.push(child);
          }
        }
      }
    });

    // Return the root manager node
    return nodeMap[rootManagerId] || null;
  }

  /**
   * Remove a relationship and rebuild hierarchy
   */
  /**
   * Delete all workflow entries for a node in a department
   * (removes node as ancestor AND as descendant)
   */
  async deleteSingleNode(department: DepartmentEnum, nodeId: string) {
    await this.workflowHierarchyRepository.query(
      `
      DELETE FROM workflow_hierarchy
      WHERE department = $1
        AND (ancestor_id = $2 OR descendant_id = $2)
      `,
      [department, nodeId]
    );
    return { message: 'Node deleted successfully from workflow hierarchy.' };
  }

  /**
   * Update a single node — replace oldSubordinate with newSubordinate under a manager
   */
  async updateSingleNode(
    department: DepartmentEnum,
    managerId: string,
    oldSubordinateId: string,
    newSubordinateId: string
  ) {
    await this.removeRelation(department, managerId, oldSubordinateId);
    await this.addSingleRelation(department, managerId, newSubordinateId);
    return { message: 'Node updated successfully.' };
  }




  async removeRelation(
    department: DepartmentEnum,
    managerId: string,
    subordinateId: string
  ) {
    // Delete the direct relationship and all indirect paths through it
    await this.workflowHierarchyRepository.query(
      `
      DELETE FROM workflow_hierarchy
      WHERE department = $1
        AND ancestor_id IN (
          SELECT ancestor_id 
          FROM workflow_hierarchy 
          WHERE descendant_id = $2 AND department = $1
        )
        AND descendant_id IN (
          SELECT descendant_id 
          FROM workflow_hierarchy 
          WHERE ancestor_id = $3 AND department = $1
        )
        AND (ancestor_id, descendant_id) IN (
          SELECT super_anc.ancestor_id, super_desc.descendant_id
          FROM workflow_hierarchy AS super_anc
          JOIN workflow_hierarchy AS direct ON direct.ancestor_id = $2 
            AND direct.descendant_id = $3 
            AND direct.department = $1
          JOIN workflow_hierarchy AS super_desc ON super_desc.ancestor_id = $3
          WHERE super_anc.descendant_id = $2
            AND super_anc.department = $1
            AND super_desc.department = $1
        );
      `,
      [department, managerId, subordinateId]
    );

    return { message: "Relation removed successfully. Hierarchy automatically updated." };
  }

  /**
   * Build nested tree from closure table rows
   */
  private buildTree(rows: any[]) {
    const nodeMap: any = {};
    const rootNodes: any[] = [];

    // Create all nodes
    rows.forEach((row) => {
      if (!nodeMap[row.ancestor_id]) {
        nodeMap[row.ancestor_id] = {
          id: row.ancestor_id,
          node_id: row.ancestor_id,
          name: row.ancestor_name,
          children: []
        };
      }
      if (!nodeMap[row.descendant_id]) {
        nodeMap[row.descendant_id] = {
          id: row.descendant_id,
          node_id: row.descendant_id,
          name: row.descendant_name,
          children: []
        };
      }
    });

    // Attach children (only direct relationships)
    rows.forEach((row) => {
      if (row.depth === 1) {
        const parent = nodeMap[row.ancestor_id];
        const child = nodeMap[row.descendant_id];
        if (parent && child && parent !== child) {
          if (!parent.children.find((c: any) => c.id === child.id)) {
            parent.children.push(child);
          }
        }
      }
    });

    // Find root nodes (nodes that are never descendants in depth=1 relationships)
    const descendantIds = new Set(
      rows.filter(r => r.depth === 1).map(r => r.descendant_id)
    );
    
    Object.values(nodeMap).forEach((node: any) => {
      if (!descendantIds.has(node.id)) {
        rootNodes.push(node);
      }
    });

    return rootNodes;
  }

async updateBranch(
  department: DepartmentEnum,
  managerId: string,
  newSubordinates: string[]
) {
  // Step 1: Remove existing direct children of manager
  await this.workflowHierarchyRepository.delete({
    department,
    ancestor: { id: managerId },
    depth: 1
  });

  // Step 2: Insert new direct children
  for (const sub of newSubordinates) {
    await this.addSingleRelation(department, managerId, sub);
  }

  // Step 3: Rebuild hierarchy under this manager 
  await this.rebuildHierarchy(department, managerId);

  return { message: "Branch updated successfully" };
}
/**
   * Returns the nested children tree for a user across all departments.
   * Fetches ALL depth=1 (direct parent→child) rows within the user's entire subtree,
   * so buildManagerTree can recursively attach grandchildren, great-grandchildren, etc.
   */
  async getChildrenTreeForAllDepartments(userId: string): Promise<{ department: string; tree: any }[]> {
    // Fetch every direct (depth=1) edge where the parent is the user OR any of their descendants
    const rows = await this.workflowHierarchyRepository.query(
      `
      SELECT 
        wh.department,
        wh.ancestor_id,
        wh.descendant_id,
        wh.depth,
        CONCAT(u1."firstName", ' ', u1."lastName") AS ancestor_name,
        CONCAT(u2."firstName", ' ', u2."lastName") AS descendant_name,
        u2."employeeId"  AS descendant_employee_id,
        u2."designation" AS descendant_designation
      FROM workflow_hierarchy wh
      JOIN employees u1 ON wh.ancestor_id  = u1.id
      JOIN employees u2 ON wh.descendant_id = u2.id
      WHERE wh.depth = 1
        AND wh.ancestor_id IN (
          -- the user themselves + all their descendants
          SELECT descendant_id
          FROM workflow_hierarchy
          WHERE ancestor_id = $1
          UNION ALL
          SELECT $1
        )
      ORDER BY wh.department, wh.depth ASC;
      `,
      [userId]
    );

    if (rows.length === 0) return [];

    // Group by department
    const byDept: Record<string, any[]> = {};
    for (const row of rows) {
      if (!byDept[row.department]) byDept[row.department] = [];
      byDept[row.department].push(row);
    }

    return Object.entries(byDept).map(([department, deptRows]) => ({
      department,
      tree: this.buildManagerTree(deptRows, userId),
    }));
  }

  async rebuildHierarchy(department: DepartmentEnum, managerId: string) {
  // delete all indirect relations
  await this.workflowHierarchyRepository.delete({
    department,
    ancestor: { id: managerId },
    depth: MoreThan(1)
  });

  // get direct children again
  const directChildren = await this.workflowHierarchyRepository.find({
    where: {
      department,
      ancestor: { id: managerId },
      depth: 1
    },
    relations: ["descendant"]
  });

  for (const child of directChildren) {
    await this.addSingleRelation(department, managerId, child.descendant.id);
  }
}


}


  // /**
  //  * Clean duplicate entries from workflow hierarchy
  //  */
  // async cleanDuplicates(department?: DepartmentEnum) {
  //   const query = department
  //     ? `DELETE FROM workflow_hierarchy
  //        WHERE id NOT IN (
  //          SELECT MIN(id)
  //          FROM workflow_hierarchy
  //          WHERE department = $1
  //          GROUP BY ancestor_id, descendant_id, department, depth
  //        )
  //        AND department = $1`
  //     : `DELETE FROM workflow_hierarchy
  //        WHERE id NOT IN (
  //          SELECT MIN(id)
  //          FROM workflow_hierarchy
  //          GROUP BY ancestor_id, descendant_id, department, depth
  //        )`;

  //   const params = department ? [department] : [];
  //   const result = await this.workflowHierarchyRepository.query(query, params);
  //   return { message: 'Duplicates cleaned successfully.', deletedCount: result.rowCount ?? 0 };
  // }


// async getUserWorkflowsByDepartment(userId: string) {
//     // Find every department this user participates in (as ancestor OR descendant)
//     const departmentRows: { department: DepartmentEnum }[] =
//       await this.workflowHierarchyRepository.query(
//         `
//         SELECT DISTINCT department
//         FROM workflow_hierarchy
//         WHERE ancestor_id = $1 OR descendant_id = $1
//         `,
//         [userId],
//       );

//     if (departmentRows.length === 0) {
//       return [];
//     }

//     const result: { department: DepartmentEnum; hierarchy: any }[] = [];

//     for (const { department } of departmentRows) {
//       // Pull all depth-1 edges for this department so we can build the full tree
//       const rows: {
//         ancestor_id: string;
//         descendant_id: string;
//         depth: number;
//         ancestor_name: string;
//         descendant_name: string;
//       }[] = await this.workflowHierarchyRepository.query(
//         `
//         SELECT
//           wh.ancestor_id,
//           wh.descendant_id,
//           wh.depth,
//           CONCAT(u1."firstName", ' ', u1."lastName") AS ancestor_name,
//           CONCAT(u2."firstName", ' ', u2."lastName") AS descendant_name
//         FROM workflow_hierarchy wh
//         JOIN employees u1 ON wh.ancestor_id = u1.id
//         JOIN employees u2 ON wh.descendant_id = u2.id
//         WHERE wh.department = $1
//           AND wh.depth = 1
//         ORDER BY wh.depth ASC;
//         `,
//         [department],
//       );

//       if (rows.length === 0) {
//         // User exists only as a self-reference — return a single node
//         const selfRow: { id: string; name: string }[] =
//           await this.workflowHierarchyRepository.query(
//             `
//             SELECT
//               u.id,
//               CONCAT(u."firstName", ' ', u."lastName") AS name
//             FROM employees u
//             WHERE u.id = $1
//             `,
//             [userId],
//           );

//         result.push({
//           department,
//           hierarchy: selfRow.length > 0
//             ? { id: selfRow[0].id, name: selfRow[0].name, children: [] }
//             : null,
//         });
//         continue;
//       }

//       // Build the full tree for this department, then find the root(s)
//       const nodeMap: Record<string, { id: string; name: string; children: any[] }> = {};

//       for (const row of rows) {
//         if (!nodeMap[row.ancestor_id]) {
//           nodeMap[row.ancestor_id] = { id: row.ancestor_id, name: row.ancestor_name, children: [] };
//         }
//         if (!nodeMap[row.descendant_id]) {
//           nodeMap[row.descendant_id] = { id: row.descendant_id, name: row.descendant_name, children: [] };
//         }
//       }

//       for (const row of rows) {
//         const parent = nodeMap[row.ancestor_id];
//         const child = nodeMap[row.descendant_id];
//         if (parent && child && parent.id !== child.id) {
//           if (!parent.children.find((c) => c.id === child.id)) {
//             parent.children.push(child);
//           }
//         }
//       }

//       // Root nodes = nodes that never appear as a descendant in depth-1 rows
//       const descendantIds = new Set(rows.map((r) => r.descendant_id));
//       const roots = Object.values(nodeMap).filter((n) => !descendantIds.has(n.id));

//       result.push({
//         department,
//         hierarchy: roots.length === 1 ? roots[0] : roots,
//       });
//     }

//     return result;
//   }


  // /**
  //  * Check for duplicate entries in workflow hierarchy
  //  */
  // async checkDuplicates(department?: DepartmentEnum) {
  //   const query = department
  //     ? `SELECT ancestor_id, descendant_id, department, depth, COUNT(*) as count
  //        FROM workflow_hierarchy
  //        WHERE department = $1
  //        GROUP BY ancestor_id, descendant_id, department, depth
  //        HAVING COUNT(*) > 1`
  //     : `SELECT ancestor_id, descendant_id, department, depth, COUNT(*) as count
  //        FROM workflow_hierarchy
  //        GROUP BY ancestor_id, descendant_id, department, depth
  //        HAVING COUNT(*) > 1`;

  //   const params = department ? [department] : [];
  //   const duplicates = await this.workflowHierarchyRepository.query(query, params);
  //   return { duplicates, count: duplicates.length };
  // }



  // /**
  //  * Get the tree structure for a specific manager
  //  */
  // async getManagerTree(managerId: string, department: DepartmentEnum) {
  //   // Get all relationships where this manager is an ancestor
  //   const rows = await this.workflowHierarchyRepository.query(
  //     `
  //     SELECT 
  //       wh.ancestor_id,
  //       wh.descendant_id,
  //       wh.depth,
  //       CONCAT(u1."firstName", ' ', u1."lastName") AS ancestor_name,
  //       CONCAT(u2."firstName", ' ', u2."lastName") AS descendant_name
  //     FROM workflow_hierarchy wh
  //     JOIN employees u1 ON wh.ancestor_id = u1.id
  //     JOIN employees u2 ON wh.descendant_id = u2.id
  //     WHERE wh.ancestor_id = $1 
  //       AND wh.department = $2 
  //       AND wh.depth >= 0
  //     ORDER BY wh.depth ASC;
  //     `,
  //     [managerId, department]
  //   );

  //   if (rows.length === 0) {
  //     return null;
  //   }

  //   return this.buildManagerTree(rows, managerId);
  // }


  // /**
  //  * Get all managers for a subordinate (direct and indirect)
  //  */
  // async getManagers(subordinateId: string, department: DepartmentEnum) {
  //   const managers = await this.workflowHierarchyRepository.query(
  //     `
  //     SELECT 
  //       wh.ancestor_id AS id,
  //       CONCAT(u."firstName", ' ', u."lastName") AS name,
  //       wh.depth,
  //       CASE WHEN wh.depth = 1 THEN 'Direct Manager' ELSE 'Higher Management' END AS relationship_type
  //     FROM workflow_hierarchy wh
  //     JOIN employees u ON wh.ancestor_id = u.id
  //     WHERE wh.descendant_id = $1 
  //       AND wh.department = $2 
  //       AND wh.depth > 0
  //     ORDER BY wh.depth ASC;
  //     `,
  //     [subordinateId, department]
  //   );

  //   return managers;
  // }


