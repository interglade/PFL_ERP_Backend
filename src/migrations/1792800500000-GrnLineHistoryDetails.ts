import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * GRN edit rules S3 / S4 (docs/grn-edit-rules-plan.md):
 *   grn_product_history.changeType            'updated' | 'added' | 'removed' (existing rows: 'updated')
 *   old/new unit, gross / packing / net weight, the four line dates and packaging material
 *   grn_product_history.grn_product_id        nullable, ON DELETE SET NULL (was CASCADE): a removed GRN
 *                                             line is now deleted, and its history must survive it.
 *
 * Idempotent, so it can run before or after `synchronize`. `down` drops the new columns and restores
 * the cascade (rows without a line are deleted first, as the old NOT NULL column requires).
 *
 * Run with: npm run typeorm:migrate
 */
export class GrnLineHistoryDetails1792800500000 implements MigrationInterface {
  name = "GrnLineHistoryDetails1792800500000";

  private readonly decimals = [
    "oldGrossWeight", "newGrossWeight", "oldPackingMaterialWeight", "newPackingMaterialWeight", "oldNetWeight", "newNetWeight",
  ];
  private readonly dates = [
    "oldPurchaseDate", "newPurchaseDate", "oldDispatchDate", "newDispatchDate",
    "oldDeliveryDate", "newDeliveryDate", "oldExpectedHarvestDate", "newExpectedHarvestDate",
  ];
  private readonly refs: Array<[string, string]> = [
    ["old_uom_id", "uom"], ["new_uom_id", "uom"],
    ["old_packing_material_id", "post_packaging_material"], ["new_packing_material_id", "post_packaging_material"],
  ];

  private async lineForeignKeys(queryRunner: QueryRunner): Promise<string[]> {
    const rows: Array<{ name: string }> = await queryRunner.query(
      `SELECT tc.constraint_name AS name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'grn_product_history' AND tc.constraint_type = 'FOREIGN KEY' AND k.column_name = 'grn_product_id'`,
    );
    return rows.map((r) => r.name);
  }

  private async tableFor(queryRunner: QueryRunner, preferred: string): Promise<string | null> {
    const rows = await queryRunner.query(`SELECT to_regclass($1) AS t`, [preferred]);
    return rows[0]?.t ? preferred : null;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const t = `"grn_product_history"`;
    await queryRunner.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS "changeType" character varying(10) NOT NULL DEFAULT 'updated'`);
    for (const c of this.decimals) await queryRunner.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS "${c}" numeric(14,3)`);
    for (const c of this.dates) await queryRunner.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS "${c}" date`);
    for (const [column, table] of this.refs) {
      await queryRunner.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS "${column}" uuid`);
      const target = await this.tableFor(queryRunner, table);
      if (!target) continue;
      await queryRunner.query(
        `DO $$ BEGIN
           ALTER TABLE ${t} ADD CONSTRAINT "FK_grn_history_${column}" FOREIGN KEY ("${column}") REFERENCES "${target}"("id") ON DELETE SET NULL;
         EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      );
    }

    // The line link: nullable and SET NULL, so a deleted line keeps its history.
    for (const name of await this.lineForeignKeys(queryRunner)) {
      await queryRunner.query(`ALTER TABLE ${t} DROP CONSTRAINT "${name}"`);
    }
    await queryRunner.query(`ALTER TABLE ${t} ALTER COLUMN "grn_product_id" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE ${t} ADD CONSTRAINT "FK_grn_history_grn_product" FOREIGN KEY ("grn_product_id") REFERENCES "grn_products"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const t = `"grn_product_history"`;
    for (const name of await this.lineForeignKeys(queryRunner)) {
      await queryRunner.query(`ALTER TABLE ${t} DROP CONSTRAINT "${name}"`);
    }
    await queryRunner.query(`DELETE FROM ${t} WHERE "grn_product_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE ${t} ALTER COLUMN "grn_product_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE ${t} ADD CONSTRAINT "FK_grn_history_grn_product" FOREIGN KEY ("grn_product_id") REFERENCES "grn_products"("id") ON DELETE CASCADE`,
    );
    for (const [column] of this.refs) await queryRunner.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS "${column}"`);
    for (const c of [...this.decimals, ...this.dates, "changeType"]) {
      await queryRunner.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS "${c}"`);
    }
  }
}
