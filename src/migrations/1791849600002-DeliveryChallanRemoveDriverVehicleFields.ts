import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Delivery challan cleanup (2026-10-13).
 *
 * Removes from delivery_challan_purchase (shared by the customer, stock transfer and other challans)
 *   driverName, contactNo, altContactNo, vehicleNo, licenseNo, requestingDepartment
 * Transport details now live on the vehicle dispatch registers (transporter / vehicle / driver masters).
 * Their values are copied to delivery_challan_removed_fields_backup_20261013 first.
 *
 * The app also runs TypeORM `synchronize`, so the first boot would drop the same columns. Every
 * statement here is idempotent, so this migration can be run before OR after that boot. If the app
 * booted first the columns are already gone and the backup is skipped (nothing left to copy).
 *
 * Run with: npm run typeorm:migrate
 */
export class DeliveryChallanRemoveDriverVehicleFields1791849600002 implements MigrationInterface {
  name = "DeliveryChallanRemoveDriverVehicleFields1791849600002";

  private static readonly TABLE = "delivery_challan_purchase";
  private static readonly BACKUP_TABLE = "delivery_challan_removed_fields_backup_20261013";
  private static readonly REMOVED_COLUMNS = [
    "driverName",
    "contactNo",
    "altContactNo",
    "vehicleNo",
    "licenseNo",
    "requestingDepartment",
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { TABLE, BACKUP_TABLE, REMOVED_COLUMNS } = DeliveryChallanRemoveDriverVehicleFields1791849600002;

    // ── 1. Back up the data of the columns that are about to be dropped ──────────
    const present: Array<{ column_name: string }> = await queryRunner.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = $1 AND column_name = ANY($2::text[])`,
      [TABLE, REMOVED_COLUMNS],
    );
    const presentNames = new Set(present.map((r) => r.column_name));
    if (presentNames.size > 0) {
      const selectList = REMOVED_COLUMNS
        .filter((c) => presentNames.has(c))
        // the enum column is stored as text so the backup has no dependency on the enum type
        .map((c) => `"${c}"::text AS "${c}"`)
        .join(", ");
      await queryRunner.query(
        `CREATE TABLE IF NOT EXISTS "${BACKUP_TABLE}" AS SELECT id, ${selectList} FROM "${TABLE}"`,
      );
    }

    // ── 2. Drop the columns, then the now unused enum type ───────────────────────
    for (const column of REMOVED_COLUMNS) {
      await queryRunner.query(`ALTER TABLE "${TABLE}" DROP COLUMN IF EXISTS "${column}"`);
    }
    await queryRunner.query(`DROP TYPE IF EXISTS "${TABLE}_requestingdepartment_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const { TABLE, REMOVED_COLUMNS } = DeliveryChallanRemoveDriverVehicleFields1791849600002;
    // Columns come back empty and as plain text (requestingDepartment loses its enum type);
    // the data is still in the backup table.
    for (const column of REMOVED_COLUMNS) {
      await queryRunner.query(`ALTER TABLE "${TABLE}" ADD COLUMN IF NOT EXISTS "${column}" character varying`);
    }
  }
}
