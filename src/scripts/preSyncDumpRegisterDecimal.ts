require('dotenv').config();
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../utils/data-source';

/**
 * PRE-SYNC STEP for the receiving-links change — run BEFORE the first backend
 * boot that carries it (docs/receiving-links-plan.md §7, step 0).
 *
 * The entity changed `dump_register.totalQty` / `totalDumpCost` from integer to
 * numeric. TypeORM `synchronize` does not convert a column type in place: it
 * DROPs the column and ADDs a new one, which erases the stored values. This
 * script converts the two columns in place with `ALTER COLUMN … TYPE … USING`,
 * so the following `synchronize` sees them as already matching and touches
 * nothing.
 *
 * It opens its own DataSource with `synchronize: false` and never initialises
 * `AppDataSource`, because initialising that one would run synchronize first.
 *
 * Safe to run more than once. Usage: npm run db:pre-sync-dump-register
 */
const COLUMN_STATE_SQL = `
  SELECT column_name, data_type, numeric_precision, numeric_scale
    FROM information_schema.columns
   WHERE table_name = 'dump_register' AND column_name IN ('totalQty', 'totalDumpCost')
   ORDER BY column_name`;

async function main(): Promise<void> {
  const sqlPath = path.join(__dirname, 'sql', '2026-10-10-pre-sync-dump-register-decimal.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  const dataSource = new DataSource({
    ...AppDataSource.options,
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    entities: [],
    subscribers: [],
    migrations: [],
    cache: false,
  });
  await dataSource.initialize();
  try {
    console.log('dump_register before:', await dataSource.query(COLUMN_STATE_SQL));
    await dataSource.transaction(async (manager) => {
      await manager.query(sql);
    });
    console.log('dump_register after: ', await dataSource.query(COLUMN_STATE_SQL));
  } finally {
    await dataSource.destroy();
  }
}

main()
  .then(() => {
    console.log('pre-sync conversion done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('pre-sync conversion failed:', error);
    process.exit(1);
  });
