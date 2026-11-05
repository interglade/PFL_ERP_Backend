import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Permission groups for the employee permission table (client request 2026-10-29):
 *   document_definitions_documenttype_enum  gains 'Registration' (vendors, farmers, customers,
 *                                           transporters, drivers, vehicles) and 'Plan' (business plans)
 *   approval_flows_type_enum                gains the same values (same TypeScript enum; never flow types)
 *
 * The keys' groups and allowed actions are synced from src/data/documentDefination.json at startup.
 * Idempotent, so it can run before or after `synchronize`.
 *
 * Run with: npm run typeorm:migrate
 */
export class PermissionGroups1792800800000 implements MigrationInterface {
  name = "PermissionGroups1792800800000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const type of ["document_definitions_documenttype_enum", "approval_flows_type_enum"]) {
      await queryRunner.query(`ALTER TYPE "${type}" ADD VALUE IF NOT EXISTS 'Registration'`);
      await queryRunner.query(`ALTER TYPE "${type}" ADD VALUE IF NOT EXISTS 'Plan'`);
    }
  }

  public async down(): Promise<void> {
    // Enum values cannot be dropped in Postgres without recreating the type; they are left in place.
  }
}
