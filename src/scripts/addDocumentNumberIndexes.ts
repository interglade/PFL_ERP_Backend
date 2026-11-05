require('dotenv').config();
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../utils/data-source';
import { SERIES } from '../global/numbering/documentNumber';

/**
 * Unique document numbers (A5 of docs/batch-stock-plan.md; GRN excluded).
 *
 * New numbers come from `document_sequences` and cannot collide any more, but
 * older data already holds duplicates (every Stock Transfer DC was …S00001,
 * every voucher of a day shared one number). Those documents may be printed,
 * so they are not renumbered. Instead each table gets a UNIQUE index on its
 * number column that covers only rows created from `--from` (default: today):
 * it guards every new number while leaving history as it is.
 *
 * Dry run by default: lists, per table, the duplicate numbers that exist and
 * whether the index exists. `--apply` creates the missing indexes.
 *
 * Usage: npm run db:unique-doc-numbers [-- --apply] [-- --from=2026-10-16]
 */
const APPLY = process.argv.includes('--apply');
const fromArg = process.argv.find((a) => a.startsWith('--from='))?.split('=')[1];
const FROM = fromArg ?? new Date().toISOString().slice(0, 10);

async function main(): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM)) throw new Error(`--from must be YYYY-MM-DD, got ${FROM}`);
  const dataSource = new DataSource({ ...AppDataSource.options, synchronize: false, migrationsRun: false, dropSchema: false, cache: false } as any);
  await dataSource.initialize();
  try {
    const seen = new Set<string>();
    for (const series of Object.values(SERIES)) {
      const key = `${series.table}.${series.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const index = `uq_${series.table}_${series.column}_from_${FROM.replace(/-/g, '')}`.toLowerCase();

      const dupes: Array<{ no: string; n: string }> = await dataSource.query(
        `SELECT "${series.column}" AS no, COUNT(*) AS n FROM "${series.table}"
          WHERE "${series.column}" IS NOT NULL GROUP BY "${series.column}" HAVING COUNT(*) > 1
          ORDER BY COUNT(*) DESC LIMIT 10`,
      );
      const newDupes: Array<{ n: string }> = await dataSource.query(
        `SELECT COUNT(*) AS n FROM (
           SELECT 1 FROM "${series.table}" WHERE "${series.column}" IS NOT NULL AND "createdAt" >= $1
            GROUP BY "${series.column}" HAVING COUNT(*) > 1) d`,
        [FROM],
      );
      const exists: Array<{ n: string }> = await dataSource.query(`SELECT COUNT(*) AS n FROM pg_indexes WHERE indexname = $1`, [index]);

      console.log(`\n${key}`);
      console.log(dupes.length
        ? `  duplicates in history (left as they are): ${dupes.map((d) => `${d.no} ×${d.n}`).join(', ')}`
        : '  no duplicate numbers');
      if (Number(exists[0].n) > 0) {
        console.log(`  index ${index} already exists`);
        continue;
      }
      if (Number(newDupes[0].n) > 0) {
        console.log(`  SKIPPED: rows created since ${FROM} already repeat a number; pick a later --from`);
        continue;
      }
      if (!APPLY) {
        console.log(`  would create UNIQUE index ${index} (rows created since ${FROM})`);
        continue;
      }
      await dataSource.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${index}" ON "${series.table}" ("${series.column}")
          WHERE "${series.column}" IS NOT NULL AND "createdAt" >= '${FROM}'`,
      );
      console.log(`  created UNIQUE index ${index}`);
    }
    if (!APPLY) console.log('\nDry run: nothing was changed. Re-run with --apply to create the indexes.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
