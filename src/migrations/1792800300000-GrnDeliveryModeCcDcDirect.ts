import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * GRN delivery mode: `cc-dc` is split into `cc` and `dc`.
 *   grns.deliveryMode  'cc' | 'dc' | 'direct-to-customer'   (default 'cc')
 *
 * `cc` and `dc` are received at that centre; `direct-to-customer` bypasses the centres. The GRN print
 * is red for `cc` and green otherwise.
 *
 * PostgreSQL cannot drop an enum value, so the column is moved to a new enum type. A row still holding
 * the old `cc-dc` becomes `cc` (no per-row mapping: the existing rows are dummy data).
 * Run it before the backend starts: the column no longer matches the entity until it has run.
 * `down` maps both centre modes back to `cc-dc`.
 *
 * Run with: npm run typeorm:migrate
 */
export class GrnDeliveryModeCcDcDirect1792800300000 implements MigrationInterface {
  name = "GrnDeliveryModeCcDcDirect1792800300000";

  private async hasValue(queryRunner: QueryRunner, value: string): Promise<boolean> {
    const rows = await queryRunner.query(
      `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'grns_deliverymode_enum' AND e.enumlabel = $1`,
      [value],
    );
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.hasValue(queryRunner, "cc-dc"))) return; // already on cc / dc / direct-to-customer

    await queryRunner.query(`CREATE TYPE "grns_deliverymode_enum_new" AS ENUM ('cc', 'dc', 'direct-to-customer')`);
    await queryRunner.query(`ALTER TABLE "grns" ALTER COLUMN "deliveryMode" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "grns" ALTER COLUMN "deliveryMode" TYPE "grns_deliverymode_enum_new"
         USING (CASE WHEN "deliveryMode"::text = 'cc-dc' THEN 'cc' ELSE "deliveryMode"::text END)::"grns_deliverymode_enum_new"`,
    );
    await queryRunner.query(`DROP TYPE "grns_deliverymode_enum"`);
    await queryRunner.query(`ALTER TYPE "grns_deliverymode_enum_new" RENAME TO "grns_deliverymode_enum"`);
    await queryRunner.query(`ALTER TABLE "grns" ALTER COLUMN "deliveryMode" SET DEFAULT 'cc'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.hasValue(queryRunner, "cc"))) return;

    await queryRunner.query(`CREATE TYPE "grns_deliverymode_enum_old" AS ENUM ('cc-dc', 'direct-to-customer')`);
    await queryRunner.query(`ALTER TABLE "grns" ALTER COLUMN "deliveryMode" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "grns" ALTER COLUMN "deliveryMode" TYPE "grns_deliverymode_enum_old"
         USING (CASE WHEN "deliveryMode"::text IN ('cc', 'dc') THEN 'cc-dc' ELSE "deliveryMode"::text END)::"grns_deliverymode_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "grns_deliverymode_enum"`);
    await queryRunner.query(`ALTER TYPE "grns_deliverymode_enum_old" RENAME TO "grns_deliverymode_enum"`);
    await queryRunner.query(`ALTER TABLE "grns" ALTER COLUMN "deliveryMode" SET DEFAULT 'cc-dc'`);
  }
}
