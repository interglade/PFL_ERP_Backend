import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Second Sale customer details: the same walk-in customer fields as the Other DC
 * (client decision 2026-11-02, docs/other-dc-invoice-plan.md §4.0):
 *   billing_address_id        renamed from customeraddress_id (existing addresses kept); now many-to-one,
 *                             so the one-to-one unique constraint is dropped
 *   ship_to_same_as_billing   true: goods go to the billing address
 *   shipping_address_id       shipping address when not same as billing
 *   customer_type             'individual' / 'business'
 *   customer_alt_contact_no   optional
 *   customer_pan_no           optional
 *   place_of_supply           state supplied to, filled from the billing address state for existing rows
 *   delivery_challan_id       dropped: a second sale is not linked to a delivery challan
 *
 * Idempotent, so it can run before or after `synchronize`. If `synchronize` already dropped
 * customeraddress_id, those addresses are gone; if it created billing_address_id next to it, the
 * addresses are copied across before the old column is dropped.
 *
 * Run with: npm run typeorm:migrate
 */
export class SecondSaleCustomerDetails1792801200000 implements MigrationInterface {
  name = "SecondSaleCustomerDetails1792801200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of SECOND_SALE_CUSTOMER_DETAILS_UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "second_sale_document"
         DROP COLUMN IF EXISTS "ship_to_same_as_billing",
         DROP COLUMN IF EXISTS "shipping_address_id",
         DROP COLUMN IF EXISTS "customer_type",
         DROP COLUMN IF EXISTS "customer_alt_contact_no",
         DROP COLUMN IF EXISTS "customer_pan_no",
         DROP COLUMN IF EXISTS "place_of_supply"`,
    );
    // The challan link comes back empty.
    await queryRunner.query(`ALTER TABLE "second_sale_document" ADD COLUMN IF NOT EXISTS "delivery_challan_id" uuid`);
    await queryRunner.query(
      `DO $$ BEGIN
         ALTER TABLE "second_sale_document" ADD CONSTRAINT "FK_second_sale_delivery_challan"
           FOREIGN KEY ("delivery_challan_id") REFERENCES "delivery_challan_purchase"("id") ON DELETE SET NULL;
       EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
         IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'second_sale_document' AND column_name = 'billing_address_id')
            AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'second_sale_document' AND column_name = 'customeraddress_id') THEN
           ALTER TABLE "second_sale_document" RENAME COLUMN "billing_address_id" TO "customeraddress_id";
         END IF;
       END $$`,
    );
  }
}

const hasColumn = (column: string) =>
  `EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'second_sale_document' AND column_name = '${column}')`;

/** The up statements, also used to bring a local database up to date by script. */
export const SECOND_SALE_CUSTOMER_DETAILS_UP: string[] = [
  // Billing address: keep the existing customer address links.
  `DO $$ BEGIN
     IF ${hasColumn("customeraddress_id")} AND NOT ${hasColumn("billing_address_id")} THEN
       ALTER TABLE "second_sale_document" RENAME COLUMN "customeraddress_id" TO "billing_address_id";
     ELSIF ${hasColumn("customeraddress_id")} THEN
       UPDATE "second_sale_document" SET "billing_address_id" = "customeraddress_id"
        WHERE "billing_address_id" IS NULL AND "customeraddress_id" IS NOT NULL;
       ALTER TABLE "second_sale_document" DROP COLUMN "customeraddress_id";
     END IF;
   END $$`,
  `ALTER TABLE "second_sale_document" ADD COLUMN IF NOT EXISTS "billing_address_id" uuid`,
  // One-to-one became many-to-one: drop the unique constraint on the column.
  `DO $$ DECLARE c record; BEGIN
     FOR c IN
       SELECT con.conname FROM pg_constraint con
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
        WHERE con.conrelid = 'second_sale_document'::regclass AND con.contype = 'u' AND a.attname = 'billing_address_id'
     LOOP
       EXECUTE format('ALTER TABLE "second_sale_document" DROP CONSTRAINT %I', c.conname);
     END LOOP;
   END $$`,
  `ALTER TABLE "second_sale_document"
     ADD COLUMN IF NOT EXISTS "ship_to_same_as_billing" boolean NOT NULL DEFAULT true,
     ADD COLUMN IF NOT EXISTS "shipping_address_id" uuid,
     ADD COLUMN IF NOT EXISTS "customer_type" character varying(20) DEFAULT 'individual',
     ADD COLUMN IF NOT EXISTS "customer_alt_contact_no" character varying,
     ADD COLUMN IF NOT EXISTS "customer_pan_no" character varying(10),
     ADD COLUMN IF NOT EXISTS "place_of_supply" character varying`,
  addressForeignKey("billing_address_id", "FK_second_sale_billing_address"),
  addressForeignKey("shipping_address_id", "FK_second_sale_shipping_address"),
  // Existing sales: individual customer, place of supply from the billing address state.
  `UPDATE "second_sale_document" SET "customer_type" = 'individual' WHERE "customer_type" IS NULL`,
  `UPDATE "second_sale_document" s SET "place_of_supply" = a."state"
     FROM "address" a WHERE a."id" = s."billing_address_id" AND s."place_of_supply" IS NULL AND a."state" IS NOT NULL`,
  // A second sale is not linked to a delivery challan (its foreign key goes with the column).
  `ALTER TABLE "second_sale_document" DROP COLUMN IF EXISTS "delivery_challan_id"`,
];

/** Foreign key to address, unless the column already has one (e.g. the old one-to-one key, or `synchronize`). */
function addressForeignKey(column: string, constraint: string): string {
  return `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'second_sale_document'::regclass AND c.contype = 'f' AND a.attname = '${column}'
     ) THEN
       ALTER TABLE "second_sale_document" ADD CONSTRAINT "${constraint}"
         FOREIGN KEY ("${column}") REFERENCES "address"("id") ON DELETE SET NULL;
     END IF;
   END $$`;
}
