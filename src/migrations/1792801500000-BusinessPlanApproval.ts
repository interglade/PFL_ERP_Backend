import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Single-level business plan approval: who decided, when, and the remark, on both
 * procurement_targets and sales_targets (approved_by_id, approved_at, approval_remark).
 *
 * Idempotent and uses TypeORM's own constraint names, so it is safe whether or not
 * `synchronize` has already created the columns.
 *
 * Run with: npm run typeorm:migrate
 */
export class BusinessPlanApproval1792801500000 implements MigrationInterface {
    name = 'BusinessPlanApproval1792801500000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const table of ['procurement_targets', 'sales_targets']) {
            await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "approved_by_id" uuid`);
            await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP`);
            await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "approval_remark" text`);
            const fk = queryRunner.connection.namingStrategy.foreignKeyName(table, ['approved_by_id']);
            const exists = await queryRunner.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [fk]);
            if (!exists.length) {
                await queryRunner.query(
                    `ALTER TABLE "${table}" ADD CONSTRAINT "${fk}" FOREIGN KEY ("approved_by_id") ` +
                    `REFERENCES "employees"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
                );
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ['procurement_targets', 'sales_targets']) {
            const fk = queryRunner.connection.namingStrategy.foreignKeyName(table, ['approved_by_id']);
            await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${fk}"`);
            await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "approval_remark"`);
            await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "approved_at"`);
            await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "approved_by_id"`);
        }
    }
}
