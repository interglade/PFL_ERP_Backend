import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * GRN payment history (docs/grn-payment-history-plan.md):
 *   grn_payments              one row per payment to the GRN's vendor / farmer (voided rows stay)
 *   grn_payment_changes       who recorded, edited or voided a payment, what changed and why
 *   grns.paid_amount          sum of the live payments (advance excluded)
 *   grns_ammountstatus_enum   gains 'partial' (partially paid)
 *
 * Existing data is dummy: no backfill. GRNs already marked paid keep that status with no payment rows.
 * Idempotent, so it can run before or after `synchronize`.
 *
 * Run with: npm run typeorm:migrate
 */
export class GrnPayments1792800600000 implements MigrationInterface {
  name = "GrnPayments1792800600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "grns_ammountstatus_enum" ADD VALUE IF NOT EXISTS 'partial'`);
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "paid_amount" numeric(15,2) NOT NULL DEFAULT 0`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "grn_payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletion_scheduled_at" TIMESTAMP,
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP,
        "grn_id" uuid NOT NULL,
        "payment_no" integer NOT NULL,
        "payment_date" date NOT NULL,
        "amount" numeric(15,2) NOT NULL,
        "payment_type" character varying(10) NOT NULL DEFAULT 'partial',
        "payment_mode" character varying(50) NOT NULL,
        "paid_to_account_no" character varying(34),
        "paid_to_ifsc" character varying(11),
        "paid_to_bank_name" character varying(150),
        "reference_no" character varying(100),
        "remarks" text,
        "balance_after" numeric(15,2) NOT NULL DEFAULT 0,
        "recorded_by_id" uuid,
        "voided_at" TIMESTAMP,
        "voided_by_id" uuid,
        "void_reason" text,
        CONSTRAINT "PK_grn_payments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_grn_payments_grn" FOREIGN KEY ("grn_id") REFERENCES "grns"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_grn_payments_recorded_by" FOREIGN KEY ("recorded_by_id") REFERENCES "employees"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_grn_payments_voided_by" FOREIGN KEY ("voided_by_id") REFERENCES "employees"("id") ON DELETE SET NULL
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_grn_payments_grn_payment_no" ON "grn_payments" ("grn_id", "payment_no")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "grn_payment_changes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletion_scheduled_at" TIMESTAMP,
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP,
        "grn_payment_id" uuid NOT NULL,
        "action" character varying(10) NOT NULL,
        "changes" jsonb,
        "reason" text,
        "changed_by_id" uuid,
        CONSTRAINT "PK_grn_payment_changes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_grn_payment_changes_payment" FOREIGN KEY ("grn_payment_id") REFERENCES "grn_payments"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_grn_payment_changes_changed_by" FOREIGN KEY ("changed_by_id") REFERENCES "employees"("id") ON DELETE SET NULL
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "grn_payment_changes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "grn_payments"`);
    // A partially paid GRN goes back to unpaid; Postgres can't drop an enum value, so 'partial' stays in the type.
    await queryRunner.query(`UPDATE "grns" SET "ammountStatus" = 'unpaid' WHERE "ammountStatus"::text = 'partial'`);
    await queryRunner.query(`ALTER TABLE "grns" DROP COLUMN IF EXISTS "paid_amount"`);
  }
}
