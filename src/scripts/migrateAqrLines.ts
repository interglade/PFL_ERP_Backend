/**
 * ONE-TIME MIGRATION — legacy AQRs → product lines
 * (docs/receiving-links-plan.md §2.3 / §4 item 2).
 *
 * Before receiving links an AQR carried one product in its header columns
 * (`product_id`, `varient_id`, `arrivedQty`, `samplingQty`, `totalQty`,
 * `totalpercent`) and its quality parameters pointed at the AQR. New AQRs have
 * one `aqr_product` row per product of the source and parameters per line.
 *
 * Steps (each prints its counts):
 *   (a) every `aqr` row with no `aqr_product` rows and a non-null `product_id`
 *       gets one line built from its header columns (text quantities → numeric,
 *       unparseable → 0, `receivedQty` null) and its header-level parameters are
 *       re-pointed at that line;
 *   (b) legacy purchase AQRs without a GRN are linked to a GRN when exactly ONE
 *       GRN matches: same company, same vendor or farmer, a `grn_products` row
 *       with the AQR's product, GRN document COMPLETE, and `arrivalDate` between
 *       the GRN document's creation day and +7 days. Ambiguous ones are listed;
 *   (c) the number of `return_to_vendor` rows with `grn_id IS NULL` is printed
 *       (they are listed, not guessed).
 *
 * Usage:
 *   npm run migrate:aqr-lines -- --dry-run   # report only, everything rolled back
 *   npm run migrate:aqr-lines                # apply
 *
 * Idempotent: lines are only added where none exist, GRN links only where
 * `grn_id` is null. Run after the application has started once on the new
 * code so TypeORM `synchronize` has created `aqr_product` and the new columns.
 */

import { transports } from 'winston';
import { QueryRunner } from 'typeorm';

import { AppDataSource } from '../utils/data-source';
import logger from '../utils/logger';
import { legacyQuantityToNumber as textToNumeric } from '../aqr/service/aqr.validation';

const DRY_RUN = process.argv.includes('--dry-run');

interface LegacyAqrRow {
  id: string;
  aqrNo: string | null;
  product_id: string;
  varient_id: string | null;
  arrivedQty: string | null;
  samplingQty: string | null;
  totalQty: string | null;
  totalpercent: string | null;
  remark: string | null;
}

interface PurchaseAqrRow {
  id: string;
  aqrNo: string | null;
  company_id: string | null;
  vendor_id: string | null;
  farmer_id: string | null;
  product_id: string;
  arrivalDate: string | null;
}

interface GrnCandidate {
  id: string;
  grnNo: string | null;
  createdAt: string;
}

/** The script must be readable on the terminal even when the logger only writes files. */
function ensureConsoleOutput(): void {
  const hasConsole = logger.transports.some((t) => t instanceof transports.Console);
  if (!hasConsole) logger.add(new transports.Console());
}

async function columnExists(runner: QueryRunner, table: string, column: string): Promise<boolean> {
  const rows = await runner.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

async function tableExists(runner: QueryRunner, table: string): Promise<boolean> {
  const rows = await runner.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [table]);
  return rows.length > 0;
}

/**
 * `aqr_parameter.aqr` has no explicit @JoinColumn, so its column follows the
 * naming strategy (`aqrId`); detect it instead of assuming.
 */
async function legacyParameterFkColumn(runner: QueryRunner): Promise<string> {
  for (const candidate of ['aqrId', 'aqr_id']) {
    if (await columnExists(runner, 'aqr_parameter', candidate)) return candidate;
  }
  throw new Error('aqr_parameter has neither an "aqrId" nor an "aqr_id" column; cannot re-point legacy parameters');
}

// ─── (a) one line per legacy AQR ─────────────────────────────────────────────

async function createLegacyLines(runner: QueryRunner): Promise<void> {
  const paramFk = await legacyParameterFkColumn(runner);

  const legacy: LegacyAqrRow[] = await runner.query(
    `SELECT a.id, a."aqrNo", a.product_id, a.varient_id,
            a."arrivedQty", a."samplingQty", a."totalQty", a."totalpercent", a.remark
       FROM aqr a
      WHERE a.product_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM aqr_product p WHERE p.aqr_id = a.id)
      ORDER BY a."createdAt" ASC`,
  );
  const headerOnlyWithoutProduct: { count: number }[] = await runner.query(
    `SELECT COUNT(*)::int AS count
       FROM aqr a
      WHERE a.product_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM aqr_product p WHERE p.aqr_id = a.id)`,
  );

  logger.info(`(a) Legacy AQRs without lines and with a header product: ${legacy.length}`);
  logger.info(`(a) AQRs without lines and without a header product (left as they are): ${headerOnlyWithoutProduct[0]?.count ?? 0}`);

  let linesCreated = 0;
  let parametersRepointed = 0;
  let unparseableQuantities = 0;

  for (const row of legacy) {
    const arrived = textToNumeric(row.arrivedQty);
    const sampling = textToNumeric(row.samplingQty);
    if ((row.arrivedQty ?? '').trim() && arrived === 0 && Number(row.arrivedQty) !== 0) unparseableQuantities += 1;
    if ((row.samplingQty ?? '').trim() && sampling === 0 && Number(row.samplingQty) !== 0) unparseableQuantities += 1;

    const pendingParams: { count: number }[] = await runner.query(
      `SELECT COUNT(*)::int AS count FROM aqr_parameter WHERE "${paramFk}" = $1 AND aqr_product_id IS NULL`,
      [row.id],
    );

    if (DRY_RUN) {
      linesCreated += 1;
      parametersRepointed += pendingParams[0]?.count ?? 0;
      continue;
    }

    const inserted: { id: string }[] = await runner.query(
      `INSERT INTO aqr_product
         (aqr_id, product_id, varient_id, uom_id, "receivedQty", "arrivedQty", "samplingQty", "totalQty", "totalpercent", remark)
       VALUES ($1, $2, $3, NULL, NULL, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        row.id,
        row.product_id,
        row.varient_id,
        arrived,
        sampling,
        row.totalQty === null ? null : textToNumeric(row.totalQty),
        row.totalpercent === null ? null : textToNumeric(row.totalpercent),
        row.remark,
      ],
    );
    const lineId = inserted[0]?.id;
    if (!lineId) throw new Error(`INSERT into aqr_product returned no id for AQR ${row.aqrNo ?? row.id}`);
    linesCreated += 1;

    const updated = await runner.query(
      `UPDATE aqr_parameter SET aqr_product_id = $1 WHERE "${paramFk}" = $2 AND aqr_product_id IS NULL`,
      [lineId, row.id],
    );
    // pg returns [rows, rowCount] for UPDATE through TypeORM's query()
    parametersRepointed += Array.isArray(updated) && typeof updated[1] === 'number' ? updated[1] : (pendingParams[0]?.count ?? 0);
  }

  logger.info(`(a) Lines ${DRY_RUN ? 'to create' : 'created'}: ${linesCreated}`);
  logger.info(`(a) Parameters ${DRY_RUN ? 'to re-point' : 're-pointed'} to their line: ${parametersRepointed}`);
  if (unparseableQuantities > 0) {
    logger.warn(`(a) Header quantities that were not numeric and became 0: ${unparseableQuantities}`);
  }
}

// ─── (b) link legacy purchase AQRs to their GRN when unambiguous ─────────────

async function linkPurchaseAqrsToGrn(runner: QueryRunner): Promise<void> {
  const candidates: PurchaseAqrRow[] = await runner.query(
    `SELECT a.id, a."aqrNo", a.company_id, a.vendor_id, a.farmer_id, a.product_id, a."arrivalDate"::text AS "arrivalDate"
       FROM aqr a
      WHERE a."aqrFor" = 'purchase'
        AND a.grn_id IS NULL
        AND a.product_id IS NOT NULL
      ORDER BY a."createdAt" ASC`,
  );
  const withoutProduct: { count: number }[] = await runner.query(
    `SELECT COUNT(*)::int AS count FROM aqr a WHERE a."aqrFor" = 'purchase' AND a.grn_id IS NULL AND a.product_id IS NULL`,
  );

  logger.info(`(b) Legacy purchase AQRs without a GRN: ${candidates.length} (plus ${withoutProduct[0]?.count ?? 0} without a header product, skipped)`);

  let linked = 0;
  let noMatch = 0;
  let noParty = 0;
  let noDate = 0;
  const ambiguous: { aqr: string; grns: string[] }[] = [];

  for (const aqr of candidates) {
    const label = aqr.aqrNo ?? aqr.id;
    if (!aqr.vendor_id && !aqr.farmer_id) {
      noParty += 1;
      continue;
    }
    if (!aqr.arrivalDate) {
      noDate += 1;
      continue;
    }

    const partyClause = aqr.vendor_id ? 'g.vendor_id = $2' : 'g.farmer_id = $2';
    const partyId = aqr.vendor_id ?? aqr.farmer_id;

    const grns: GrnCandidate[] = await runner.query(
      `SELECT g.id, g."grnNo", MIN(d."createdAt")::text AS "createdAt"
         FROM grns g
         JOIN documents d
           ON d.document_type_id = g.id::text
          AND d.type = 'grn'
          AND d.status = 'COMPLETE'
          AND d."isDeleted" = false
          AND d."deletedAt" IS NULL
         JOIN grn_products gp
           ON gp.grn_id = g.id
          AND gp.product_id = $3
        WHERE g.company_id IS NOT DISTINCT FROM $1
          AND ${partyClause}
          AND g."isDeleted" = false
          AND g."deletedAt" IS NULL
          AND $4::date >= d."createdAt"::date
          AND $4::date <= (d."createdAt" + INTERVAL '7 days')::date
        GROUP BY g.id, g."grnNo"
        ORDER BY MIN(d."createdAt") ASC`,
      [aqr.company_id, partyId, aqr.product_id, aqr.arrivalDate],
    );

    if (grns.length === 0) {
      noMatch += 1;
      continue;
    }
    if (grns.length > 1) {
      ambiguous.push({ aqr: label, grns: grns.map((g) => g.grnNo ?? g.id) });
      continue;
    }

    if (!DRY_RUN) {
      await runner.query(`UPDATE aqr SET grn_id = $1 WHERE id = $2 AND grn_id IS NULL`, [grns[0].id, aqr.id]);
    }
    linked += 1;
  }

  logger.info(`(b) AQRs ${DRY_RUN ? 'to link' : 'linked'} to exactly one GRN: ${linked}`);
  logger.info(`(b) AQRs with no matching COMPLETE GRN: ${noMatch}`);
  logger.info(`(b) AQRs skipped — no vendor or farmer on the AQR: ${noParty}`);
  logger.info(`(b) AQRs skipped — no arrival date: ${noDate}`);
  logger.info(`(b) AQRs with several matching GRNs (left unlinked): ${ambiguous.length}`);
  ambiguous.forEach((entry) => logger.info(`    ${entry.aqr}: ${entry.grns.join(', ')}`));
}

// ─── (c) RTVs without a GRN ──────────────────────────────────────────────────

async function reportRtvWithoutGrn(runner: QueryRunner): Promise<void> {
  if (!(await tableExists(runner, 'return_to_vendor'))) {
    logger.info('(c) Table return_to_vendor does not exist; nothing to report');
    return;
  }
  const rows: { count: number }[] = await runner.query(
    `SELECT COUNT(*)::int AS count FROM return_to_vendor WHERE grn_id IS NULL`,
  );
  logger.info(`(c) Return To Vendor rows with grn_id IS NULL (not guessed, listed only): ${rows[0]?.count ?? 0}`);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function migrateAqrLines(): Promise<void> {
  ensureConsoleOutput();
  logger.info(`AQR lines migration ${DRY_RUN ? '(DRY RUN — nothing will be written)' : '(APPLY)'}`);

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  const runner = AppDataSource.createQueryRunner();
  await runner.connect();

  try {
    if (!(await tableExists(runner, 'aqr_product'))) {
      throw new Error('Table "aqr_product" does not exist. Start the application once so TypeORM synchronize creates it, then re-run.');
    }
    if (!(await columnExists(runner, 'aqr_parameter', 'aqr_product_id'))) {
      throw new Error('Column "aqr_product_id" is missing on "aqr_parameter". Start the application once so TypeORM synchronize creates it, then re-run.');
    }
    if (!(await columnExists(runner, 'aqr', 'grn_id'))) {
      throw new Error('Column "grn_id" is missing on "aqr". Start the application once so TypeORM synchronize creates it, then re-run.');
    }

    await runner.startTransaction();
    await createLegacyLines(runner);
    await linkPurchaseAqrsToGrn(runner);
    await reportRtvWithoutGrn(runner);

    if (DRY_RUN) {
      await runner.rollbackTransaction();
      logger.info('Dry run complete — transaction rolled back, nothing written.');
    } else {
      await runner.commitTransaction();
      logger.info('Migration complete — transaction committed.');
    }
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    logger.error(`AQR lines migration failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await runner.release();
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

if (require.main === module) {
  migrateAqrLines();
}
