import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Brings back the GRN receiving person under the new name `grns.receivingPerson`
 * (it was `delivery_receiving_person` and was dropped by
 * 1791849600000-GrnBatchTotalsPackagingAndCleanup by mistake).
 *
 * Works in every state the database can be in:
 *   - old column still there (nothing dropped yet)  -> renamed in place, data kept
 *   - old column dropped, backup table present      -> new column added, values restored from the backup
 *   - neither                                       -> new column added, values start empty
 *
 * Type matches the entity (character varying, nullable) so `synchronize` sees no difference.
 *
 * Run with: npm run typeorm:migrate (after 1791849600000-GrnBatchTotalsPackagingAndCleanup)
 */
export class GrnReceivingPerson1791849600001 implements MigrationInterface {
  name = "GrnReceivingPerson1791849600001";

  private static readonly BACKUP_TABLE = "grn_removed_fields_backup_20261013";

  private async columnExists(queryRunner: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await queryRunner.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasNew = await this.columnExists(queryRunner, "grns", "receivingPerson");
    const hasOld = await this.columnExists(queryRunner, "grns", "delivery_receiving_person");

    if (!hasNew && hasOld) {
      await queryRunner.query(`ALTER TABLE "grns" RENAME COLUMN "delivery_receiving_person" TO "receivingPerson"`);
      return;
    }

    if (!hasNew) {
      await queryRunner.query(`ALTER TABLE "grns" ADD COLUMN "receivingPerson" character varying`);
    }

    // Restore the values saved before the column was dropped (only where still empty).
    const backup = GrnReceivingPerson1791849600001.BACKUP_TABLE;
    const backupHasColumn =
      (await this.columnExists(queryRunner, backup, "delivery_receiving_person"));
    if (backupHasColumn) {
      await queryRunner.query(
        `UPDATE "grns" g
            SET "receivingPerson" = b."delivery_receiving_person"
           FROM "${backup}" b
          WHERE b.id = g.id
            AND g."receivingPerson" IS NULL
            AND b."delivery_receiving_person" IS NOT NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Back to the previous name only if the old column is not there; otherwise just drop.
    if (await this.columnExists(queryRunner, "grns", "receivingPerson")) {
      await queryRunner.query(`ALTER TABLE "grns" DROP COLUMN "receivingPerson"`);
    }
  }
}
