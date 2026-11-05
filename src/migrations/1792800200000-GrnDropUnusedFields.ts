import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * GRN clean-up. Nothing in the app wrote or showed these columns:
 *   grns.branch_id                 (a third branch link next to purchase / purchase-for locations)
 *   grns.purchase_id               (user link; the GRN keeps the free-text `purchasedBy`)
 *   grn_products.revisedQuantity   (never entered; GRN history tracks quantity and rate)
 *   grn_products.revisedRate
 *
 * Idempotent, so it can run before or after `synchronize` drops them. The number of rows that
 * still held a value is logged before the drop, so check it on a real database first.
 * `down` re-creates the columns empty; dropped values are not restored.
 *
 * Run with: npm run typeorm:migrate
 */
export class GrnDropUnusedFields1792800200000 implements MigrationInterface {
  name = "GrnDropUnusedFields1792800200000";

  private async columnExists(queryRunner: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await queryRunner.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const targets: Array<[string, string]> = [
      ["grns", "branch_id"],
      ["grns", "purchase_id"],
      ["grn_products", "revisedQuantity"],
      ["grn_products", "revisedRate"],
    ];
    for (const [table, column] of targets) {
      if (!(await this.columnExists(queryRunner, table, column))) continue;
      const [{ used }] = await queryRunner.query(`SELECT COUNT("${column}")::int AS used FROM "${table}"`);
      console.log(`GrnDropUnusedFields: ${table}.${column} held a value in ${used} row(s); dropping`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "grn_products" ADD COLUMN IF NOT EXISTS "revisedRate" numeric(10,2)`);
    await queryRunner.query(`ALTER TABLE "grn_products" ADD COLUMN IF NOT EXISTS "revisedQuantity" numeric(10,2)`);
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "purchase_id" uuid`);
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "branch_id" uuid`);
    await queryRunner.query(
      `DO $$ BEGIN
         ALTER TABLE "grns" ADD CONSTRAINT "FK_grns_purchase_user" FOREIGN KEY ("purchase_id") REFERENCES "users"("id") ON DELETE SET NULL;
       EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
         ALTER TABLE "grns" ADD CONSTRAINT "FK_grns_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL;
       EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$`,
    );
  }
}
