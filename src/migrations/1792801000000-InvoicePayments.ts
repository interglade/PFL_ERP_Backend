import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Final Invoice payment history (client decision 2026-10-29; built like GRN payments,
 * docs/grn-payment-history-plan.md):
 *   invoice_payments              one row per payment received against the invoice (voided rows stay)
 *   invoice_payment_changes       who recorded, edited or voided a payment, what changed and why
 *   invoices.paid_amount          sum of the live payments
 *   invoices_ammountstatus_enum   gains 'partial' (partially paid)
 *
 * Invoices already marked paid by hand keep that status with no payment rows.
 * Idempotent, so it can run before or after `synchronize`.
 *
 * Run with: npm run typeorm:migrate
 */
export class InvoicePayments1792801000000 implements MigrationInterface {
  name = "InvoicePayments1792801000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of INVOICE_PAYMENTS_UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_payment_changes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_payments"`);
    // A partially paid invoice goes back to unpaid; Postgres can't drop an enum value, so 'partial' stays.
    await queryRunner.query(`UPDATE "invoices" SET "ammountStatus" = 'unpaid' WHERE "ammountStatus"::text = 'partial'`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "paid_amount"`);
  }
}

/** The up statements, also used to bring a local database up to date by script. */
export const INVOICE_PAYMENTS_UP: string[] = [
  `ALTER TYPE "invoices_ammountstatus_enum" ADD VALUE IF NOT EXISTS 'partial'`,
  `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paid_amount" numeric(15,2) NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS "invoice_payments" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      "deletion_scheduled_at" TIMESTAMP,
      "isDeleted" boolean NOT NULL DEFAULT false,
      "deletedAt" TIMESTAMP,
      "invoice_id" uuid NOT NULL,
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
      CONSTRAINT "PK_invoice_payments" PRIMARY KEY ("id"),
      CONSTRAINT "FK_invoice_payments_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_invoice_payments_recorded_by" FOREIGN KEY ("recorded_by_id") REFERENCES "employees"("id") ON DELETE SET NULL,
      CONSTRAINT "FK_invoice_payments_voided_by" FOREIGN KEY ("voided_by_id") REFERENCES "employees"("id") ON DELETE SET NULL
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_payments_invoice_payment_no" ON "invoice_payments" ("invoice_id", "payment_no")`,
  `CREATE TABLE IF NOT EXISTS "invoice_payment_changes" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      "deletion_scheduled_at" TIMESTAMP,
      "isDeleted" boolean NOT NULL DEFAULT false,
      "deletedAt" TIMESTAMP,
      "invoice_payment_id" uuid NOT NULL,
      "action" character varying(10) NOT NULL,
      "changes" jsonb,
      "reason" text,
      "changed_by_id" uuid,
      CONSTRAINT "PK_invoice_payment_changes" PRIMARY KEY ("id"),
      CONSTRAINT "FK_invoice_payment_changes_payment" FOREIGN KEY ("invoice_payment_id") REFERENCES "invoice_payments"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_invoice_payment_changes_changed_by" FOREIGN KEY ("changed_by_id") REFERENCES "employees"("id") ON DELETE SET NULL
    )`,
];
