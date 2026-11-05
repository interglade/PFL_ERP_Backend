import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * grns.rfpa_id is dropped: it was never written. A GRN's RFPA is the one its deal slip was made from
 * (grns.deal_slip_id -> deal_slips.rfpa_id), which is how the GRN filter "rfpaNo" now finds it.
 *
 * Idempotent, so it can run before or after `synchronize` drops it. `down` re-creates the column empty.
 *
 * Run with: npm run typeorm:migrate
 */
export class GrnDropRfpaLink1792800400000 implements MigrationInterface {
  name = "GrnDropRfpaLink1792800400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "grns" DROP COLUMN IF EXISTS "rfpa_id"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "rfpa_id" uuid`);
    await queryRunner.query(
      `DO $$ BEGIN
         ALTER TABLE "grns" ADD CONSTRAINT "FK_grns_rfpa" FOREIGN KEY ("rfpa_id") REFERENCES "rfpa"("id") ON DELETE SET NULL;
       EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
  }
}
