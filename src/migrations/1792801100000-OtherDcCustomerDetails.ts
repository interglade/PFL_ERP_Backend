import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Other DC customer details (client decision 2026-11-02, docs/other-dc-invoice-plan.md §4.0):
 *   other_billing_address_id         billing address (replaces customer_address_for_other; no Other DCs existed)
 *   other_ship_to_same_as_billing    true: goods go to the billing address
 *   other_shipping_address_id        shipping address when not same as billing
 *   other_customer_type              'individual' / 'business'
 *   other_customer_alt_contact_no    optional
 *   other_customer_pan_no            optional
 *   other_place_of_supply            state supplied to
 *
 * Idempotent, so it can run before or after `synchronize`. `down` re-creates the old column empty.
 *
 * Run with: npm run typeorm:migrate
 */
export class OtherDcCustomerDetails1792801100000 implements MigrationInterface {
  name = "OtherDcCustomerDetails1792801100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of OTHER_DC_CUSTOMER_DETAILS_UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_challan_purchase"
         DROP COLUMN IF EXISTS "other_billing_address_id",
         DROP COLUMN IF EXISTS "other_ship_to_same_as_billing",
         DROP COLUMN IF EXISTS "other_shipping_address_id",
         DROP COLUMN IF EXISTS "other_customer_type",
         DROP COLUMN IF EXISTS "other_customer_alt_contact_no",
         DROP COLUMN IF EXISTS "other_customer_pan_no",
         DROP COLUMN IF EXISTS "other_place_of_supply"`,
    );
    await queryRunner.query(`ALTER TABLE "delivery_challan_purchase" ADD COLUMN IF NOT EXISTS "customer_address_for_other" uuid`);
    await queryRunner.query(
      `DO $$ BEGIN
         ALTER TABLE "delivery_challan_purchase" ADD CONSTRAINT "FK_dcp_customer_address_for_other"
           FOREIGN KEY ("customer_address_for_other") REFERENCES "address"("id") ON DELETE SET NULL;
       EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
  }
}

/** The up statements, also used to bring a local database up to date by script. */
export const OTHER_DC_CUSTOMER_DETAILS_UP: string[] = [
  `ALTER TABLE "delivery_challan_purchase" DROP COLUMN IF EXISTS "customer_address_for_other"`,
  `ALTER TABLE "delivery_challan_purchase"
     ADD COLUMN IF NOT EXISTS "other_billing_address_id" uuid,
     ADD COLUMN IF NOT EXISTS "other_ship_to_same_as_billing" boolean NOT NULL DEFAULT true,
     ADD COLUMN IF NOT EXISTS "other_shipping_address_id" uuid,
     ADD COLUMN IF NOT EXISTS "other_customer_type" character varying(20) DEFAULT 'individual',
     ADD COLUMN IF NOT EXISTS "other_customer_alt_contact_no" character varying,
     ADD COLUMN IF NOT EXISTS "other_customer_pan_no" character varying(10),
     ADD COLUMN IF NOT EXISTS "other_place_of_supply" character varying`,
  addressForeignKey("other_billing_address_id", "FK_dcp_other_billing_address"),
  addressForeignKey("other_shipping_address_id", "FK_dcp_other_shipping_address"),
];

/** Foreign key to address, unless the column already has one (e.g. created by `synchronize`). */
function addressForeignKey(column: string, constraint: string): string {
  return `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'delivery_challan_purchase'::regclass AND c.contype = 'f' AND a.attname = '${column}'
     ) THEN
       ALTER TABLE "delivery_challan_purchase" ADD CONSTRAINT "${constraint}"
         FOREIGN KEY ("${column}") REFERENCES "address"("id") ON DELETE SET NULL;
     END IF;
   END $$`;
}
