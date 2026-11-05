import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Payment Manager role (client decision 2026-10-29): only Payment Managers record, edit and void
 * payments on GRNs and Final Invoices; finalizers, admins and Super Admins no longer.
 *   employees_roles_enum  gains 'payment_manager'
 *
 * Idempotent, so it can run before or after `synchronize`.
 * Run with: npm run typeorm:migrate
 */
export class PaymentManagerRole1792800900000 implements MigrationInterface {
  name = "PaymentManagerRole1792800900000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "employees_roles_enum" ADD VALUE IF NOT EXISTS 'payment_manager'`);
  }

  public async down(): Promise<void> {
    // Enum values cannot be dropped in Postgres without recreating the type; left in place.
  }
}
