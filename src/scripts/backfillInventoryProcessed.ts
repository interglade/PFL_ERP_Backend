import { AppDataSource } from "../utils/data-source";

/**
 * ONE-TIME BACKFILL — run this once, immediately after deploying the change
 * that moves inventory movement from document creation to document approval.
 *
 * WHY THIS IS REQUIRED
 * --------------------
 * Under the previous code, `inventory_stock` was updated at CREATE time for
 * every inventory-bearing document, whatever its approval status. So every
 * document that already exists in the database has ALREADY had its stock
 * applied — including documents still sitting at `hold`.
 *
 * The new `documents.inventoryProcessed` column defaults to false. Without this
 * backfill, the first time an existing document is approved the new code would
 * apply its stock a SECOND time.
 *
 * This script marks every pre-existing inventory-bearing document as already
 * processed, so only documents created from now on move stock at approval.
 *
 * ORDER OF OPERATIONS
 *   1. Deploy the new code and restart the app once, so TypeORM `synchronize`
 *      creates the `inventoryProcessed` column.
 *   2. Stop approval activity (or run during a quiet window).
 *   3. Run:  npm run backfill:inventory-processed
 *   4. Resume normal use.
 *
 * The script is idempotent — running it twice is harmless.
 *
 * NOTE ON DC_TYPE_OTHER: Other Delivery Challan has never moved stock and still
 * does not, so it is deliberately excluded.
 */

const INVENTORY_BEARING_TYPES = [
  "inward-register",
  "DC_TYPE_CUSTOMER",
  "DC_TYPE_STOCK_TRANSFER",
  "dump-register",
  "return-to-vendor",
];

async function backfillInventoryProcessed() {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const columnCheck = await AppDataSource.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_name = 'documents'
          AND column_name = 'inventoryProcessed'`,
    );

    if (columnCheck.length === 0) {
      console.error(
        '❌ Column "inventoryProcessed" does not exist on "documents".\n' +
          "   Start the application once so TypeORM synchronize creates it, then re-run.",
      );
      await AppDataSource.destroy();
      process.exit(1);
    }

    const before = await AppDataSource.query(
      `SELECT COUNT(*)::int AS count
         FROM documents
        WHERE type = ANY($1)
          AND "inventoryProcessed" = false`,
      [INVENTORY_BEARING_TYPES],
    );

    console.log(
      `📊 ${before[0].count} pre-existing inventory-bearing document(s) to mark as processed.`,
    );

    if (before[0].count === 0) {
      console.log("✅ Nothing to do — backfill already applied.");
      await AppDataSource.destroy();
      return;
    }

    const result = await AppDataSource.query(
      `UPDATE documents
          SET "inventoryProcessed" = true
        WHERE type = ANY($1)
          AND "inventoryProcessed" = false`,
      [INVENTORY_BEARING_TYPES],
    );

    console.log(`✅ Marked ${result[1] ?? before[0].count} document(s) as inventoryProcessed = true.`);

    const perType = await AppDataSource.query(
      `SELECT type, COUNT(*)::int AS count
         FROM documents
        WHERE type = ANY($1)
          AND "inventoryProcessed" = true
        GROUP BY type
        ORDER BY type`,
      [INVENTORY_BEARING_TYPES],
    );

    console.log("\n📋 Processed documents by type:");
    perType.forEach((row: any) => console.log(`   ${row.type}: ${row.count}`));

    await AppDataSource.destroy();
  } catch (error) {
    console.error("❌ Backfill failed:", error);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }
}

backfillInventoryProcessed();
