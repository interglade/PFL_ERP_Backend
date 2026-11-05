import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Access Phase 1 (docs/access-gap-fixes.md):
 *   employees_roles_enum                     gains 'super_admin' (Super Admin always also holds 'admin')
 *   document_definitions_documenttype_enum   gains 'Report' (group of the report permission keys)
 *   approval_flows_type_enum                 gains 'Report' (same TypeScript enum; never used as a flow type)
 *   document_definitions.allowedActions      actions each permission key supports
 *   document_permissions.canExport           Excel export permission
 *
 * The key list itself is synced from src/data/documentDefination.json at startup.
 * Idempotent, so it can run before or after `synchronize`.
 *
 * Run with: npm run typeorm:migrate
 */
export class AccessPhase11792800700000 implements MigrationInterface {
  name = "AccessPhase11792800700000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "employees_roles_enum" ADD VALUE IF NOT EXISTS 'super_admin'`);
    await queryRunner.query(`ALTER TYPE "document_definitions_documenttype_enum" ADD VALUE IF NOT EXISTS 'Report'`);
    await queryRunner.query(`ALTER TYPE "approval_flows_type_enum" ADD VALUE IF NOT EXISTS 'Report'`);
    await queryRunner.query(`ALTER TABLE "document_definitions" ADD COLUMN IF NOT EXISTS "allowedActions" text[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "document_permissions" ADD COLUMN IF NOT EXISTS "canExport" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Enum values cannot be dropped in Postgres without recreating the type; they are left in place.
    await queryRunner.query(`ALTER TABLE "document_permissions" DROP COLUMN IF EXISTS "canExport"`);
    await queryRunner.query(`ALTER TABLE "document_definitions" DROP COLUMN IF EXISTS "allowedActions"`);
  }
}
