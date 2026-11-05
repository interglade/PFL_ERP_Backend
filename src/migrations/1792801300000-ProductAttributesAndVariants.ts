import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Attribute-based product variants (docs/product-variant-plan.md):
 *
 *  - product_attribute         Count, Size, Variety, Origin, Brand (+ any added later)
 *  - product_attribute_value   the allowed values of each attribute, unique per attribute
 *                              ignoring case and spacing (value_key)
 *  - product_allowed_value     the values a product may vary by
 *  - product_variant_value     the values of each variant
 *  - product.last_variant_seq  last variant number handed out, so codes are never reused
 *  - productVarient.sequence / combination_key / is_active
 *                              code number, the sorted value ids (unique per product),
 *                              and whether new documents may pick the variant
 *
 * The five standard attributes are created by the app on first use
 * (ensureDefaultAttributes), so this migration only builds the schema.
 *
 * Idempotent and uses TypeORM's own constraint names, so it is safe whether or not
 * `synchronize` has already created the objects.
 *
 * Run with: npm run typeorm:migrate
 */
export class ProductAttributesAndVariants1792801300000 implements MigrationInterface {
    name = 'ProductAttributesAndVariants1792801300000'

    private async addForeignKey(
        queryRunner: QueryRunner,
        table: string,
        column: string,
        referencedTable: string,
        onDelete: 'CASCADE' | 'NO ACTION',
    ): Promise<void> {
        const name = queryRunner.connection.namingStrategy.foreignKeyName(table, [column]);
        const exists = await queryRunner.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
        if (exists.length) return;
        await queryRunner.query(
            `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") ` +
            `REFERENCES "${referencedTable}"("id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
        );
    }

    /** A many-to-many join table the way TypeORM builds one. */
    private async createJoinTable(
        queryRunner: QueryRunner,
        table: string,
        ownerColumn: string,
        ownerTable: string,
    ): Promise<void> {
        const naming = queryRunner.connection.namingStrategy;
        const columns = [ownerColumn, 'attribute_value_id'];
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "${table}" (
                "${ownerColumn}" uuid NOT NULL,
                "attribute_value_id" uuid NOT NULL,
                CONSTRAINT "${naming.primaryKeyName(table, columns)}" PRIMARY KEY ("${ownerColumn}", "attribute_value_id")
            )
        `);
        for (const column of columns) {
            await queryRunner.query(
                `CREATE INDEX IF NOT EXISTS "${naming.indexName(table, [column])}" ON "${table}" ("${column}")`,
            );
        }
        await this.addForeignKey(queryRunner, table, ownerColumn, ownerTable, 'CASCADE');
        await this.addForeignKey(queryRunner, table, 'attribute_value_id', 'product_attribute_value', 'CASCADE');
    }

    public async up(queryRunner: QueryRunner): Promise<void> {
        const naming = queryRunner.connection.namingStrategy;
        const uuidGenerator = (queryRunner.connection.driver as any).uuidGenerator as string;
        const modelColumns = `
                "id" uuid NOT NULL DEFAULT ${uuidGenerator},
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                "deletion_scheduled_at" TIMESTAMP,
                "isDeleted" boolean NOT NULL DEFAULT false,
                "deletedAt" TIMESTAMP,`;

        // ── product_attribute ────────────────────────────────────────────────
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "product_attribute" (${modelColumns}
                "name" character varying(100) NOT NULL,
                "code" character varying(30),
                "sort_order" integer NOT NULL DEFAULT 0,
                "is_active" boolean NOT NULL DEFAULT true,
                CONSTRAINT "${naming.primaryKeyName('product_attribute', ['id'])}" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_product_attribute_name" ON "product_attribute" ("name")`,
        );

        // ── product_attribute_value ──────────────────────────────────────────
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "product_attribute_value" (${modelColumns}
                "value" character varying(100) NOT NULL,
                "value_key" character varying(100) NOT NULL,
                "is_active" boolean NOT NULL DEFAULT true,
                "attribute_id" uuid NOT NULL,
                CONSTRAINT "${naming.primaryKeyName('product_attribute_value', ['id'])}" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_product_attribute_value_key" ` +
            `ON "product_attribute_value" ("attribute_id", "value_key")`,
        );
        await this.addForeignKey(queryRunner, 'product_attribute_value', 'attribute_id', 'product_attribute', 'CASCADE');

        // ── join tables ──────────────────────────────────────────────────────
        await this.createJoinTable(queryRunner, 'product_allowed_value', 'product_id', 'product');
        await this.createJoinTable(queryRunner, 'product_variant_value', 'variant_id', 'productVarient');

        // ── product / productVarient columns ─────────────────────────────────
        await queryRunner.query(
            `ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "last_variant_seq" integer NOT NULL DEFAULT 0`,
        );
        await queryRunner.query(`
            ALTER TABLE "productVarient"
                ADD COLUMN IF NOT EXISTS "sequence" integer,
                ADD COLUMN IF NOT EXISTS "combination_key" character varying(1000),
                ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true
        `);
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_product_variant_combination" ` +
            `ON "productVarient" ("product_id", "combination_key") WHERE "combination_key" IS NOT NULL`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "UQ_product_variant_combination"`);
        await queryRunner.query(`
            ALTER TABLE "productVarient"
                DROP COLUMN IF EXISTS "sequence",
                DROP COLUMN IF EXISTS "combination_key",
                DROP COLUMN IF EXISTS "is_active"
        `);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN IF EXISTS "last_variant_seq"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "product_variant_value"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "product_allowed_value"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "product_attribute_value"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "product_attribute"`);
    }
}
