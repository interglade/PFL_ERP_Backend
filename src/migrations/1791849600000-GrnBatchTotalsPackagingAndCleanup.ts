import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * GRN schema changes (2026-10-13).
 *
 * Adds
 *   grns.batchNo                 varchar(100), unique among live GRNs (partial index)
 *   grns.totalGrossWeight        numeric(12,3), Σ line gross weight, backfilled here
 *   grns.totalNetWeight          numeric(12,3), Σ line net weight, backfilled here
 *   grns.isVehicleDispatchCreated boolean, backfilled here
 *   grn_products.packing_material_id  FK -> post_packaging_material
 *
 * Removes (unused / irrelevant)
 *   grns.requestingDepartment, receivedThrough, vehicleNo, delivery_receiving_person, baseLocation
 *   Their values are copied to grn_removed_fields_backup_20261013 first.
 *
 * The app also runs TypeORM `synchronize`, so the first boot would create/drop the same
 * columns. Every statement here is idempotent and the column types match the entities
 * exactly, so this migration can be run before OR after that boot. If the app booted first
 * the five columns are already gone and their backup is skipped (nothing left to copy).
 *
 * Run with: npm run typeorm:migrate
 */
export class GrnBatchTotalsPackagingAndCleanup1791849600000 implements MigrationInterface {
  name = "GrnBatchTotalsPackagingAndCleanup1791849600000";

  private static readonly BACKUP_TABLE = "grn_removed_fields_backup_20261013";
  private static readonly REMOVED_COLUMNS = [
    "requestingDepartment",
    "receivedThrough",
    "vehicleNo",
    "delivery_receiving_person",
    "baseLocation",
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Back up the data of the columns that are about to be dropped ──────────
    const present: Array<{ column_name: string }> = await queryRunner.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'grns' AND column_name = ANY($1::text[])`,
      [GrnBatchTotalsPackagingAndCleanup1791849600000.REMOVED_COLUMNS],
    );
    const presentNames = new Set(present.map((r) => r.column_name));
    const backupTable = GrnBatchTotalsPackagingAndCleanup1791849600000.BACKUP_TABLE;
    if (presentNames.size > 0) {
      const selectList = GrnBatchTotalsPackagingAndCleanup1791849600000.REMOVED_COLUMNS
        .filter((c) => presentNames.has(c))
        // the enum column is stored as text so the backup has no dependency on the enum type
        .map((c) => `"${c}"::text AS "${c}"`)
        .join(", ");
      await queryRunner.query(
        `CREATE TABLE IF NOT EXISTS "${backupTable}" AS SELECT id, ${selectList} FROM grns`,
      );
    }

    // ── 2. New columns on grns ───────────────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "batchNo" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "totalGrossWeight" numeric(12,3)`);
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "totalNetWeight" numeric(12,3)`);
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "isVehicleDispatchCreated" boolean NOT NULL DEFAULT false`);

    // Batch no: one live GRN per batch no (blank batch nos and deleted GRNs are not constrained).
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_grns_batch_no_live" ON "grns" ("batchNo") WHERE "batchNo" IS NOT NULL AND "isDeleted" = false`,
    );

    // ── 3. grn_products.packing_material_id ──────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "grn_products" ADD COLUMN IF NOT EXISTS "packing_material_id" uuid`);
    // Constraint name = what TypeORM generates, so `synchronize` sees nothing to change.
    const fkName = queryRunner.connection.namingStrategy.foreignKeyName(
      "grn_products",
      ["packing_material_id"],
      "post_packaging_material",
      ["id"],
    );
    const fkExists = await queryRunner.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1`,
      [fkName],
    );
    if (fkExists.length === 0) {
      await queryRunner.query(
        `ALTER TABLE "grn_products" ADD CONSTRAINT "${fkName}" FOREIGN KEY ("packing_material_id") REFERENCES "post_packaging_material"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
    }

    // ── 4. Backfill totals from the existing lines (only where not yet set) ──────
    await queryRunner.query(
      `UPDATE "grns" g
          SET "totalGrossWeight" = s.gross, "totalNetWeight" = s.net
         FROM (SELECT grn_id,
                      ROUND(COALESCE(SUM("grossWeight"), 0)::numeric, 3) AS gross,
                      ROUND(COALESCE(SUM("netWeight"), 0)::numeric, 3)   AS net
                 FROM "grn_products"
                WHERE "deletedAt" IS NULL
                GROUP BY grn_id) s
        WHERE s.grn_id = g.id
          AND g."totalGrossWeight" IS NULL
          AND g."totalNetWeight" IS NULL`,
    );

    // ── 5. Backfill isVehicleDispatchCreated (live purchase dispatch exists) ─────
    await queryRunner.query(
      `UPDATE "grns" g
          SET "isVehicleDispatchCreated" = EXISTS (
            SELECT 1 FROM "dispatch" d
             WHERE d.grn_id = g.id
               AND d."dispatchType"::text = 'purchase'
               AND d."deletedAt" IS NULL
               AND d."isDeleted" = false
               AND NOT EXISTS (
                 SELECT 1 FROM "documents" x
                  WHERE x.document_type_id = d.id::text
                    AND x.type::text = 'vehicle-dispatch-register'
                    AND x.status::text = 'reject'
                    AND x."deletedAt" IS NULL))`,
    );

    // ── 6. Drop the unused columns (data is in the backup table) ─────────────────
    await queryRunner.query(`ALTER TABLE "grns" DROP COLUMN IF EXISTS "requestingDepartment"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "grns_requestingdepartment_enum"`);
    await queryRunner.query(`ALTER TABLE "grns" DROP COLUMN IF EXISTS "receivedThrough"`);
    await queryRunner.query(`ALTER TABLE "grns" DROP COLUMN IF EXISTS "vehicleNo"`);
    await queryRunner.query(`ALTER TABLE "grns" DROP COLUMN IF EXISTS "delivery_receiving_person"`);
    await queryRunner.query(`ALTER TABLE "grns" DROP COLUMN IF EXISTS "baseLocation"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const backupTable = GrnBatchTotalsPackagingAndCleanup1791849600000.BACKUP_TABLE;

    // Re-create the removed columns (requestingDepartment comes back as plain text) and
    // restore their values from the backup table when it exists.
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "requestingDepartment" character varying`);
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "receivedThrough" character varying`);
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "vehicleNo" character varying`);
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "delivery_receiving_person" character varying`);
    await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "baseLocation" character varying`);

    const backupExists = await queryRunner.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
      [backupTable],
    );
    if (backupExists.length > 0) {
      const backupCols: Array<{ column_name: string }> = await queryRunner.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = $1 AND column_name = ANY($2::text[])`,
        [backupTable, GrnBatchTotalsPackagingAndCleanup1791849600000.REMOVED_COLUMNS],
      );
      if (backupCols.length > 0) {
        const setList = backupCols.map((c) => `"${c.column_name}" = b."${c.column_name}"`).join(", ");
        await queryRunner.query(`UPDATE "grns" g SET ${setList} FROM "${backupTable}" b WHERE b.id = g.id`);
      }
    }

    // Remove what `up` added.
    const fkName = queryRunner.connection.namingStrategy.foreignKeyName(
      "grn_products",
      ["packing_material_id"],
      "post_packaging_material",
      ["id"],
    );
    await queryRunner.query(`ALTER TABLE "grn_products" DROP CONSTRAINT IF EXISTS "${fkName}"`);
    await queryRunner.query(`ALTER TABLE "grn_products" DROP COLUMN IF EXISTS "packing_material_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_grns_batch_no_live"`);
    await queryRunner.query(`ALTER TABLE "grns" DROP COLUMN IF EXISTS "isVehicleDispatchCreated"`);
    await queryRunner.query(`ALTER TABLE "grns" DROP COLUMN IF EXISTS "totalNetWeight"`);
    await queryRunner.query(`ALTER TABLE "grns" DROP COLUMN IF EXISTS "totalGrossWeight"`);
    await queryRunner.query(`ALTER TABLE "grns" DROP COLUMN IF EXISTS "batchNo"`);
  }
}
