import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Vehicle dispatch (`dispatch` table, shared by the purchase / stock-transfer / sales registers):
 *   outDate               date, entered together with outTime
 *   expectedReachingDate  date, entered together with reachingTime (the expected reaching time)
 *
 * Both are nullable, so existing rows are untouched. Types match the entity, and the
 * statements are idempotent, so this can run before or after `synchronize` creates the columns.
 *
 * Run with: npm run typeorm:migrate
 */
export class DispatchOutDateExpectedReachingDate1791936000000 implements MigrationInterface {
  name = "DispatchOutDateExpectedReachingDate1791936000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "dispatch" ADD COLUMN IF NOT EXISTS "outDate" date`);
    await queryRunner.query(`ALTER TABLE "dispatch" ADD COLUMN IF NOT EXISTS "expectedReachingDate" date`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "dispatch" DROP COLUMN IF EXISTS "expectedReachingDate"`);
    await queryRunner.query(`ALTER TABLE "dispatch" DROP COLUMN IF EXISTS "outDate"`);
  }
}
