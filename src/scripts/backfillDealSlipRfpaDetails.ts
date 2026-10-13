import { AppDataSource } from "../utils/data-source";
import { DealSlip } from "../dealSlip/entity/dealSlip.entity";
import { DealSlipProduct } from "../dealSlip/entity/dealSlipProduct.entity";
import { RFPA } from "../rfpa/entity/rfpa.entity";
import {
  RFPA_COPY_RELATIONS,
  copyRfpaPaymentInfo,
  copyRfpaProducts,
  dealSlipHeaderFromRfpa,
} from "../dealSlip/service/dealSlipRfpaCopy";

/**
 * ONE-TIME BACKFILL - run once after the "Deal Slip carries its RFPA's details" release.
 *
 * Deal slips created before that release have no copy of their RFPA's header fields and no
 * product lines. For every such deal slip (one that has an RFPA but no deal_slip_product rows)
 * this copies from the RFPA:
 *   - the header fields (company, locations, vendor / farmer, source, delivery / packing),
 *   - a new payment info row,
 *   - the product lines (each remembering its rfpa_product for planned-vs-agreed comparison).
 *
 * It does NOT touch the deal slip's status, lot no, loading location, special request,
 * remark or its approval document.
 *
 * ORDER OF OPERATIONS
 *   1. Deploy the release and run the migrations (npm run typeorm:migrate), or start the app
 *      once if `synchronize` is on, so the new columns / table exist.
 *   2. Run:  npm run backfill:deal-slip-rfpa-details
 *      (add  -- --dry-run  to only report how many deal slips would be filled in)
 *
 * Idempotent: a deal slip that already has product lines is skipped, so re-running is harmless.
 */

const DRY_RUN = process.argv.includes("--dry-run");

async function backfillDealSlipRfpaDetails() {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const tableCheck = await AppDataSource.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'deal_slip_product'`,
    );
    if (tableCheck.length === 0) {
      console.error(
        '❌ Table "deal_slip_product" does not exist.\n' +
          "   Run the migrations (npm run typeorm:migrate) first, then re-run.",
      );
      await AppDataSource.destroy();
      process.exit(1);
    }

    const pending: { id: string; rfpaId: string }[] = await AppDataSource.query(
      `SELECT ds."id" AS "id", ds."rfpa_id" AS "rfpaId"
         FROM "deal_slips" ds
        WHERE ds."rfpa_id" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "deal_slip_product" p WHERE p."deal_slip_id" = ds."id")
        ORDER BY ds."createdAt" ASC`,
    );

    console.log(`📊 ${pending.length} deal slip(s) without product lines to fill in.`);

    if (pending.length === 0) {
      console.log("✅ Nothing to do - backfill already applied.");
      await AppDataSource.destroy();
      return;
    }
    if (DRY_RUN) {
      console.log("ℹ️  Dry run - nothing was changed.");
      await AppDataSource.destroy();
      return;
    }

    let done = 0;
    const failed: { id: string; reason: string }[] = [];

    for (const { id, rfpaId } of pending) {
      try {
        await AppDataSource.transaction(async (manager) => {
          const rfpa = await manager.findOne(RFPA, { where: { id: rfpaId }, relations: RFPA_COPY_RELATIONS });
          if (!rfpa) throw new Error(`RFPA ${rfpaId} not found`);

          const paymentInfo = await copyRfpaPaymentInfo(manager, rfpa);

          // update(), not save(): DealSlip.rfpa is cascade:true, so saving would also write the RFPA.
          const { requestingDepartment: _keepExistingDepartment, ...header } = dealSlipHeaderFromRfpa(rfpa);
          await manager.update(DealSlip, { id }, { ...header, paymentInfo } as any);

          const dealSlip = await manager.findOneByOrFail(DealSlip, { id });
          await copyRfpaProducts(manager, dealSlip, rfpa);
        });
        done++;
      } catch (error: any) {
        failed.push({ id, reason: error?.message ?? String(error) });
      }
    }

    console.log(`✅ Filled in ${done} deal slip(s).`);
    if (failed.length) {
      console.error(`⚠️  ${failed.length} deal slip(s) failed and were left unchanged:`);
      failed.forEach((f) => console.error(`   ${f.id}: ${f.reason}`));
    }

    const total = await AppDataSource.getRepository(DealSlipProduct).count();
    console.log(`📋 deal_slip_product rows now: ${total}`);

    await AppDataSource.destroy();
    if (failed.length) process.exit(1);
  } catch (error) {
    console.error("❌ Backfill failed:", error);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }
}

backfillDealSlipRfpaDetails();
