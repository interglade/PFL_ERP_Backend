import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * RFPA / Deal Slip sync (docs/rfpa-deal-slip-sync-plan.md):
 *   grn_products.grade   free text, pre-filled from the Deal Slip line (B10 / D9)
 *   rfpa.created_by      was never saved on create; filled from the RFPA document's creator (B2)
 *
 * Idempotent: the column is added only if missing, and only RFPAs without a creator are filled.
 *
 * Run with: npm run typeorm:migrate
 */
export class GrnGradeRfpaCreatedBy1792800100000 implements MigrationInterface {
  name = "GrnGradeRfpaCreatedBy1792800100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "grn_products" ADD COLUMN IF NOT EXISTS "grade" character varying(100)`);

    // The RFPA document's lastActionBy is set to the creator when the RFPA is created.
    await queryRunner.query(`
      UPDATE "rfpa" r
         SET "created_by" = d.last_action_by
        FROM (
          SELECT DISTINCT ON (document_type_id) document_type_id, last_action_by
            FROM "documents"
           WHERE type = 'rfpa' AND last_action_by IS NOT NULL
           ORDER BY document_type_id, "createdAt" ASC
        ) d
       WHERE r."created_by" IS NULL
         AND d.document_type_id = r.id::text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The created_by backfill is kept: the values are correct and new RFPAs set them anyway.
    await queryRunner.query(`ALTER TABLE "grn_products" DROP COLUMN IF EXISTS "grade"`);
  }
}
