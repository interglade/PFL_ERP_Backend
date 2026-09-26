import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceEmbeddedWithFK1720527842900 implements MigrationInterface {
  name = 'ReplaceEmbeddedWithFK1720527842900';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop all old embedded fields for each approval stage
    await queryRunner.query(`
      ALTER TABLE "documents_approve_by_whom" 
        DROP COLUMN IF EXISTS "verified_userId",
        DROP COLUMN IF EXISTS "verified_userName",
        DROP COLUMN IF EXISTS "verified_status",
        DROP COLUMN IF EXISTS "verified_reason",
        DROP COLUMN IF EXISTS "verified_statusChangedAt",

        DROP COLUMN IF EXISTS "first_finalized_userId",
        DROP COLUMN IF EXISTS "first_finalized_userName",
        DROP COLUMN IF EXISTS "first_finalized_status",
        DROP COLUMN IF EXISTS "first_finalized_reason",
        DROP COLUMN IF EXISTS "first_finalized_statusChangedAt",

        DROP COLUMN IF EXISTS "second_finalized_userId",
        DROP COLUMN IF EXISTS "second_finalized_userName",
        DROP COLUMN IF EXISTS "second_finalized_status",
        DROP COLUMN IF EXISTS "second_finalized_reason",
        DROP COLUMN IF EXISTS "second_finalized_statusChangedAt",

        DROP COLUMN IF EXISTS "first_approved_userId",
        DROP COLUMN IF EXISTS "first_approved_userName",
        DROP COLUMN IF EXISTS "first_approved_status",
        DROP COLUMN IF EXISTS "first_approved_reason",
        DROP COLUMN IF EXISTS "first_approved_statusChangedAt",

        DROP COLUMN IF EXISTS "second_approved_userId",
        DROP COLUMN IF EXISTS "second_approved_userName",
        DROP COLUMN IF EXISTS "second_approved_status",
        DROP COLUMN IF EXISTS "second_approved_reason",
        DROP COLUMN IF EXISTS "second_approved_statusChangedAt",

        DROP COLUMN IF EXISTS "third_approved_userId",
        DROP COLUMN IF EXISTS "third_approved_userName",
        DROP COLUMN IF EXISTS "third_approved_status",
        DROP COLUMN IF EXISTS "third_approved_reason",
        DROP COLUMN IF EXISTS "third_approved_statusChangedAt";
    `);

    // Add new foreign key columns
    await queryRunner.query(`
      ALTER TABLE "documents_approve_by_whom"
        ADD COLUMN "verified_id" uuid,
        ADD COLUMN "first_finalized_id" uuid,
        ADD COLUMN "second_finalized_id" uuid,
        ADD COLUMN "first_approved_id" uuid,
        ADD COLUMN "second_approved_id" uuid,
        ADD COLUMN "third_approved_id" uuid,

        ADD CONSTRAINT "FK_verified_stage" FOREIGN KEY ("verified_id") REFERENCES "approval_stage_info"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "FK_first_finalized_stage" FOREIGN KEY ("first_finalized_id") REFERENCES "approval_stage_info"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "FK_second_finalized_stage" FOREIGN KEY ("second_finalized_id") REFERENCES "approval_stage_info"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "FK_first_approved_stage" FOREIGN KEY ("first_approved_id") REFERENCES "approval_stage_info"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "FK_second_approved_stage" FOREIGN KEY ("second_approved_id") REFERENCES "approval_stage_info"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "FK_third_approved_stage" FOREIGN KEY ("third_approved_id") REFERENCES "approval_stage_info"("id") ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys and ID columns
    await queryRunner.query(`
      ALTER TABLE "documents_approve_by_whom"
        DROP CONSTRAINT IF EXISTS "FK_verified_stage",
        DROP CONSTRAINT IF EXISTS "FK_first_finalized_stage",
        DROP CONSTRAINT IF EXISTS "FK_second_finalized_stage",
        DROP CONSTRAINT IF EXISTS "FK_first_approved_stage",
        DROP CONSTRAINT IF EXISTS "FK_second_approved_stage",
        DROP CONSTRAINT IF EXISTS "FK_third_approved_stage",

        DROP COLUMN IF EXISTS "verified_id",
        DROP COLUMN IF EXISTS "first_finalized_id",
        DROP COLUMN IF EXISTS "second_finalized_id",
        DROP COLUMN IF EXISTS "first_approved_id",
        DROP COLUMN IF EXISTS "second_approved_id",
        DROP COLUMN IF EXISTS "third_approved_id";
    `);

    // NOTE: You can optionally restore old columns here if needed
  }
}

