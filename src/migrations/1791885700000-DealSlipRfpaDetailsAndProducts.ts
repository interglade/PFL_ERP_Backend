import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Deal Slip now carries a copy of its RFPA's details and has its own product lines.
 *
 *  - deal_slips: new nullable columns for the RFPA header fields (company, locations, vendor /
 *    farmer, source, delivery / packing details) and a payment_info_id pointing at a copy of the
 *    RFPA's payment info row (stored in payment_info_for_rfpa).
 *  - deal_slip_product: new table, one row per product line, copied from rfpa_product.
 *
 * Every new column is nullable, so existing deal slips are untouched; the one-time script
 * `src/scripts/backfillDealSlipRfpaDetails.ts` fills them in for existing rows.
 *
 * Written to be idempotent (IF NOT EXISTS / guarded constraints) and to use TypeORM's own
 * constraint names, so it is safe whether or not `synchronize` has already created the objects.
 */
export class DealSlipRfpaDetailsAndProducts1791885700000 implements MigrationInterface {
    name = 'DealSlipRfpaDetailsAndProducts1791885700000'

    private async addForeignKey(
        queryRunner: QueryRunner,
        table: string,
        column: string,
        referencedTable: string,
        onDelete: 'SET NULL' | 'CASCADE',
    ): Promise<void> {
        const name = queryRunner.connection.namingStrategy.foreignKeyName(table, [column]);
        const exists = await queryRunner.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
        if (exists.length) return;
        await queryRunner.query(
            `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") ` +
            `REFERENCES "${referencedTable}"("id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
        );
    }

    public async up(queryRunner: QueryRunner): Promise<void> {
        const naming = queryRunner.connection.namingStrategy;
        const uuidGenerator = (queryRunner.connection.driver as any).uuidGenerator as string;

        // ── deal_slips: RFPA header fields ───────────────────────────────────
        await queryRunner.query(`
            ALTER TABLE "deal_slips"
                ADD COLUMN IF NOT EXISTS "company_id" uuid,
                ADD COLUMN IF NOT EXISTS "purchaselocation_id" uuid,
                ADD COLUMN IF NOT EXISTS "purchaseforwhich_id" uuid,
                ADD COLUMN IF NOT EXISTS "otherPurchaseLoc" character varying,
                ADD COLUMN IF NOT EXISTS "otherPurchaseForSalesLoc" character varying,
                ADD COLUMN IF NOT EXISTS "delivery_receiving_person" character varying,
                ADD COLUMN IF NOT EXISTS "packing_instruction" character varying,
                ADD COLUMN IF NOT EXISTS "vendor_id" uuid,
                ADD COLUMN IF NOT EXISTS "farmer_id" uuid,
                ADD COLUMN IF NOT EXISTS "source" character varying,
                ADD COLUMN IF NOT EXISTS "payment_info_id" uuid
        `);

        const paymentUnique = naming.relationConstraintName('deal_slips', ['payment_info_id']);
        const paymentUniqueExists = await queryRunner.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [paymentUnique]);
        if (!paymentUniqueExists.length) {
            await queryRunner.query(`ALTER TABLE "deal_slips" ADD CONSTRAINT "${paymentUnique}" UNIQUE ("payment_info_id")`);
        }

        await this.addForeignKey(queryRunner, 'deal_slips', 'company_id', 'company', 'SET NULL');
        await this.addForeignKey(queryRunner, 'deal_slips', 'purchaselocation_id', 'branches', 'SET NULL');
        await this.addForeignKey(queryRunner, 'deal_slips', 'purchaseforwhich_id', 'branches', 'SET NULL');
        await this.addForeignKey(queryRunner, 'deal_slips', 'vendor_id', 'vendor', 'SET NULL');
        await this.addForeignKey(queryRunner, 'deal_slips', 'farmer_id', 'farmer', 'SET NULL');
        await this.addForeignKey(queryRunner, 'deal_slips', 'payment_info_id', 'payment_info_for_rfpa', 'SET NULL');

        // ── deal_slip_product ────────────────────────────────────────────────
        const primaryKey = naming.primaryKeyName('deal_slip_product', ['id']);
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "deal_slip_product" (
                "id" uuid NOT NULL DEFAULT ${uuidGenerator},
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                "deletion_scheduled_at" TIMESTAMP,
                "isDeleted" boolean NOT NULL DEFAULT false,
                "deletedAt" TIMESTAMP,
                "grade" character varying(100),
                "quantity" integer NOT NULL,
                "unit_price" numeric(10,2) NOT NULL,
                "count" character varying(100),
                "size" character varying(100),
                "origin" character varying(100),
                "variety" character varying(100),
                "total_value" numeric(10,2) NOT NULL,
                "purchaseDate" date DEFAULT NULL,
                "expectedHarvestDate" date DEFAULT NULL,
                "dispatchDate" date,
                "deliveryDate" date,
                "product_id" uuid,
                "varient_id" uuid,
                "uom_id" uuid,
                "deal_slip_id" uuid,
                "rfpa_product_id" uuid,
                CONSTRAINT "${primaryKey}" PRIMARY KEY ("id")
            )
        `);

        await this.addForeignKey(queryRunner, 'deal_slip_product', 'product_id', 'product', 'SET NULL');
        await this.addForeignKey(queryRunner, 'deal_slip_product', 'varient_id', 'productVarient', 'SET NULL');
        await this.addForeignKey(queryRunner, 'deal_slip_product', 'uom_id', 'uom', 'SET NULL');
        await this.addForeignKey(queryRunner, 'deal_slip_product', 'deal_slip_id', 'deal_slips', 'CASCADE');
        await this.addForeignKey(queryRunner, 'deal_slip_product', 'rfpa_product_id', 'rfpa_product', 'SET NULL');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const naming = queryRunner.connection.namingStrategy;

        await queryRunner.query(`DROP TABLE IF EXISTS "deal_slip_product"`);

        // The payment info rows copied for deal slips live in payment_info_for_rfpa; they are
        // left in place (nothing else references them once the column below is dropped).
        for (const column of ['company_id', 'purchaselocation_id', 'purchaseforwhich_id', 'vendor_id', 'farmer_id', 'payment_info_id']) {
            const fk = naming.foreignKeyName('deal_slips', [column]);
            await queryRunner.query(`ALTER TABLE "deal_slips" DROP CONSTRAINT IF EXISTS "${fk}"`);
        }
        const paymentUnique = naming.relationConstraintName('deal_slips', ['payment_info_id']);
        await queryRunner.query(`ALTER TABLE "deal_slips" DROP CONSTRAINT IF EXISTS "${paymentUnique}"`);

        await queryRunner.query(`
            ALTER TABLE "deal_slips"
                DROP COLUMN IF EXISTS "company_id",
                DROP COLUMN IF EXISTS "purchaselocation_id",
                DROP COLUMN IF EXISTS "purchaseforwhich_id",
                DROP COLUMN IF EXISTS "otherPurchaseLoc",
                DROP COLUMN IF EXISTS "otherPurchaseForSalesLoc",
                DROP COLUMN IF EXISTS "delivery_receiving_person",
                DROP COLUMN IF EXISTS "packing_instruction",
                DROP COLUMN IF EXISTS "vendor_id",
                DROP COLUMN IF EXISTS "farmer_id",
                DROP COLUMN IF EXISTS "source",
                DROP COLUMN IF EXISTS "payment_info_id"
        `);
    }
}
