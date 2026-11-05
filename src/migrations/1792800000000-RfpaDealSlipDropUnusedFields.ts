import { MigrationInterface, QueryRunner } from "typeorm";

const DEPARTMENTS = [
  'admin', 'hr', 'operations', 'sale', 'procurement', 'it', 'business_development',
  'exports', 'branding_&_marketing', 'farming', 'quality_checking', 'other',
];

/**
 * RFPA and Deal Slip no longer carry these fields (they were never filled in and nothing read them):
 *   rfpa.requestingDepartment, deal_slips.requestingDepartment (and their enum types)
 *   rfpa_product / deal_slip_product: count, size, origin, variety
 *
 * The statements are idempotent, so this can run before or after `synchronize` drops the columns.
 * `down` re-creates the columns empty; dropped values are not restored.
 *
 * Run with: npm run typeorm:migrate
 */
export class RfpaDealSlipDropUnusedFields1792800000000 implements MigrationInterface {
  name = "RfpaDealSlipDropUnusedFields1792800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['rfpa', 'deal_slips']) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "requestingDepartment"`);
      await queryRunner.query(`DROP TYPE IF EXISTS "public"."${table}_requestingdepartment_enum"`);
    }
    for (const table of ['rfpa_product', 'deal_slip_product']) {
      for (const column of ['count', 'size', 'origin', 'variety']) {
        await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${column}"`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const values = DEPARTMENTS.map((d) => `'${d}'`).join(', ');
    for (const table of ['rfpa', 'deal_slips']) {
      await queryRunner.query(
        `DO $$ BEGIN CREATE TYPE "public"."${table}_requestingdepartment_enum" AS ENUM(${values}); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "requestingDepartment" "public"."${table}_requestingdepartment_enum"`,
      );
    }
    for (const table of ['rfpa_product', 'deal_slip_product']) {
      for (const column of ['count', 'size', 'origin', 'variety']) {
        await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" character varying(100)`);
      }
    }
  }
}
