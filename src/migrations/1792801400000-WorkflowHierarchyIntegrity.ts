import { MigrationInterface, QueryRunner } from "typeorm";
import { repairAllDepartments } from "../workFlow/closure";

/**
 * Workflow (reporting hierarchy) integrity:
 *
 *  - rebuilds every department's closure rows from its direct links: duplicates removed, one
 *    direct manager per employee (the earliest link wins), self links and cycles dropped,
 *    deleted employees taken out with their team moved up to their manager
 *  - UQ_workflow_hierarchy_pair         one row per (department, ancestor, descendant)
 *  - UQ_workflow_hierarchy_one_manager  one direct manager per employee per department
 *
 * Idempotent. Run with: npm run typeorm:migrate
 */
export class WorkflowHierarchyIntegrity1792801400000 implements MigrationInterface {
    name = 'WorkflowHierarchyIntegrity1792801400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await repairAllDepartments(queryRunner.manager);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_workflow_hierarchy_pair"
                ON "workflow_hierarchy" ("department", "ancestor_id", "descendant_id")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_workflow_hierarchy_one_manager"
                ON "workflow_hierarchy" ("department", "descendant_id") WHERE depth = 1
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "UQ_workflow_hierarchy_one_manager"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "UQ_workflow_hierarchy_pair"`);
    }
}
