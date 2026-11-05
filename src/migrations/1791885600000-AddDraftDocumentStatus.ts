import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds the 'draft' value to documents.status (DocumentStatus.DRAFT).
 *
 * A draft document has been created but not yet sent to approvers - used by the auto-created
 * Deal Slip until its lot no and loading location are filled in.
 *
 * Kept in its own migration: before PostgreSQL 12 ALTER TYPE ... ADD VALUE cannot run inside a
 * transaction block, and in any version the new value cannot be used in the same transaction
 * that adds it. Nothing in the following migrations uses 'draft'.
 */
export class AddDraftDocumentStatus1791885600000 implements MigrationInterface {
    name = 'AddDraftDocumentStatus1791885600000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "documents_status_enum" ADD VALUE IF NOT EXISTS 'draft'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // PostgreSQL cannot drop a single enum value. Rebuild the type without 'draft',
        // first turning any draft documents back into 'hold'.
        await queryRunner.query(`UPDATE "documents" SET "status" = 'hold' WHERE "status" = 'draft'`);
        await queryRunner.query(`ALTER TYPE "documents_status_enum" RENAME TO "documents_status_enum_old"`);
        await queryRunner.query(`
            CREATE TYPE "documents_status_enum" AS ENUM(
                'hold', 'query', 'approved', 'disapproved',
                'FINALIZING', 'FINALIZED', 'COMPLETE', 'REJECT', 'VERIFIED'
            )
        `);
        await queryRunner.query(`ALTER TABLE "documents" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`
            ALTER TABLE "documents"
            ALTER COLUMN "status" TYPE "documents_status_enum"
            USING "status"::text::"documents_status_enum"
        `);
        await queryRunner.query(`ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'hold'`);
        await queryRunner.query(`DROP TYPE "documents_status_enum_old"`);
    }
}
