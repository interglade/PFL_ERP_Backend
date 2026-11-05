require('dotenv').config();
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../utils/data-source';
import { PROCESSING_TABLE, processingTypesFor } from '../receiving/receiving.sql';
import { ReceivingSourceType } from '../receiving/receiving.types';

/**
 * Arrivals status (docs/arrivals-status-plan.md §7): receiving now starts with
 * the Receive button, which records the vehicle's `arrivedAt` on its dispatch.
 * Sources received before that button existed already have processing
 * documents but a dispatch without `arrivedAt`, so the Vehicle Dispatch
 * register would show them as never arrived.
 *
 * For every live purchase / stock transfer dispatch with no `arrivedAt` whose
 * GRN / Transfer DC has a live (not deleted) AQR, Inward, Dump or RTV, this sets
 * `arrivedAt` to the `createdAt` of the earliest such document. `arrived_by`
 * stays empty (nobody pressed Receive) and `reachingTime` (the expected time)
 * is not touched.
 *
 * Dry run by default: lists what would change. `--apply` writes it in one
 * transaction.
 *
 * Usage: npm run db:backfill-dispatch-arrival [-- --apply]
 */
const APPLY = process.argv.includes('--apply');

const LINKS: Array<{ sourceType: ReceivingSourceType; fk: 'grn_id' | 'delivery_challan_id'; dispatchType: string }> = [
  { sourceType: 'grn', fk: 'grn_id', dispatchType: 'purchase' },
  { sourceType: 'stock-transfer-dc', fk: 'delivery_challan_id', dispatchType: 'stock-transfer' },
];

/** Earliest `createdAt` of a live processing document of the source `sourceIdExpr` (constants only). */
function earliestDocumentSql(sourceType: ReceivingSourceType, sourceIdExpr: string): string {
  const parts = processingTypesFor(sourceType).map((docType) => {
    const spec = PROCESSING_TABLE[docType];
    const fk = spec.fk[sourceType]!;
    const live = ['b."isDeleted" = false', 'b."deletedAt" IS NULL', ...spec.extraLive.map((p) => `b.${p}`)].join(' AND ');
    return `SELECT MIN(b."createdAt") AS at FROM ${spec.table} b WHERE b.${fk} = ${sourceIdExpr} AND ${live}`;
  });
  return `(SELECT MIN(x.at) FROM (${parts.join(' UNION ALL ')}) x)`;
}

interface Row {
  id: string;
  no: string | null;
  source_id: string;
  first_doc_at: Date;
}

async function main(): Promise<void> {
  const dataSource = new DataSource({ ...AppDataSource.options, synchronize: false, migrationsRun: false, dropSchema: false, cache: false } as any);
  await dataSource.initialize();
  try {
    const found: Array<Row & { type: string }> = [];
    for (const link of LINKS) {
      const earliest = earliestDocumentSql(link.sourceType, `d."${link.fk}"`);
      const rows: Row[] = await dataSource.query(
        `SELECT d.id::text AS id, d."vehicleDispatchNo" AS no, d."${link.fk}"::text AS source_id, ${earliest} AS first_doc_at
           FROM dispatch d
          WHERE d."dispatchType"::text = $1 AND d."${link.fk}" IS NOT NULL
            AND d."arrivedAt" IS NULL AND d."isDeleted" = false AND d."deletedAt" IS NULL
            AND ${earliest} IS NOT NULL
          ORDER BY d."createdAt"`,
        [link.dispatchType],
      );
      rows.forEach((row) => found.push({ ...row, type: link.dispatchType }));
    }

    for (const row of found) {
      console.log(`${APPLY ? 'set     ' : 'would set'} ${row.type} dispatch ${row.no ?? row.id} arrivedAt = ${new Date(row.first_doc_at).toISOString()}`);
    }
    if (!found.length) {
      console.log('Nothing to backfill: every dispatch with receiving documents has arrivedAt.');
      return;
    }
    if (!APPLY) {
      console.log(`\nDry run: ${found.length} dispatch(es) would be updated, nothing changed. Re-run with --apply to write.`);
      return;
    }
    await dataSource.transaction(async (m) => {
      for (const row of found) {
        await m.query(`UPDATE dispatch SET "arrivedAt" = $2 WHERE id = $1 AND "arrivedAt" IS NULL`, [row.id, row.first_doc_at]);
      }
    });
    console.log(`\nDone: ${found.length} dispatch(es) updated. Flush the vehicleDispatch:* cache keys (or wait for their TTL).`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
