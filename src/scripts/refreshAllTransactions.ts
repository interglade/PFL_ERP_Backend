require('dotenv').config();
import 'reflect-metadata';

/**
 * Safety net for transaction tracking (docs/transaction-tracking-plan.md §9.4):
 * recomputes stage, status and summary of every transaction (or of the ones
 * given on the command line).
 *
 * Usage: npm run txn:refresh-all [-- R26102900001 S26102900003 …]
 *        npm run txn:refresh-all -- --open      (open transactions only)
 * Opens its own DataSource with synchronize disabled; it only updates the
 * `transactions` / `transaction_documents` caches.
 */
async function main(): Promise<void> {
  require('../middleware/performance.middleware');
  require('../inversify.config'); // same decorator registration order as the app
  const { DataSource } = require('typeorm');
  const { AppDataSource } = require('../utils/data-source');
  const { refreshTransaction } = require('../transactions/transaction.core');

  const args = process.argv.slice(2);
  const openOnly = args.includes('--open');
  const given = args.filter((a) => !a.startsWith('--')).map((a) => a.trim().toUpperCase());

  const ds = new DataSource({ ...AppDataSource.options, synchronize: false, migrationsRun: false, dropSchema: false, cache: false });
  await ds.initialize();
  try {
    const rows: Array<{ txn_no: string }> = given.length
      ? await ds.query(`SELECT txn_no FROM transactions WHERE txn_no = ANY($1::varchar[]) ORDER BY opened_at`, [given])
      : await ds.query(`SELECT txn_no FROM transactions ${openOnly ? "WHERE status = 'Open'" : ''} ORDER BY opened_at`);
    console.log(`Refreshing ${rows.length} transaction(s)…`);
    let done = 0;
    for (const row of rows) {
      await refreshTransaction(ds.manager, row.txn_no);
      done += 1;
      if (done % 100 === 0) console.log(`  ${done}/${rows.length}`);
    }
    const summary: Array<{ txn_type: string; status: string; n: string }> = await ds.query(
      `SELECT txn_type, status, COUNT(*) AS n FROM transactions GROUP BY txn_type, status ORDER BY txn_type, status`,
    );
    for (const s of summary) console.log(`  ${s.txn_type} ${s.status}: ${s.n}`);
    console.log('Done.');
  } finally {
    await ds.destroy();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('refresh failed:', e?.message ?? e); process.exit(1); });
