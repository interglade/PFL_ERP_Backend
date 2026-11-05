require('dotenv').config();
import 'reflect-metadata';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { AppDataSource } from '../utils/data-source';
import { Aqr } from '../aqr/entity/aqr.entity';
import { InwardRegister } from '../inwardRegister/entity/inwardRegister.entity';
import { InwardProduct } from '../inwardRegister/entity/inwardProduct.entity';
import { DumpRegister } from '../dumpRegister/entity/dumpRegister.entity';
import { DumpProduct } from '../dumpRegister/entity/dumpProduct.entity';
import { ReturnToVendor } from '../returnToVendor/entity/returnToVendor.entity';
import { ProductReturnToVendor } from '../returnToVendor/entity/productReturnToVendor.entity';
import { ReturnedProducts } from '../returnByCustomer/entity/returnProduct.entity';
import { Documentb } from '../approvalFlow/entity/docuemnt.entity';

/**
 * Indexes on the foreign keys the receiving status and the Arrivals list
 * filter on (Phase D-7). The entity files of those modules are owned by other
 * work streams, so the indexes are created here instead of with `@Index`.
 *
 * Table and column names are read from the TypeORM metadata (relations
 * without an explicit `@JoinColumn`, e.g. `inwardProduct."inwardRegisterId"`,
 * get TypeORM's default name). A column counts as indexed when any valid
 * index of the table starts with it.
 *
 * Dry run by default: lists the indexes that are missing. `--apply` creates
 * them with `CREATE INDEX CONCURRENTLY IF NOT EXISTS` (no table lock; it cannot
 * run inside a transaction, which this script never opens). An INVALID index
 * left by an interrupted concurrent build is dropped and rebuilt on `--apply`.
 *
 * Usage: npm run db:receiving-indexes [-- --apply]
 */
const APPLY = process.argv.includes('--apply');

interface IndexSpec {
  entity: EntityTarget<ObjectLiteral>;
  /** Relation property (its join column is indexed) or plain column property. */
  property: string;
  /** Partial index on `IS NOT NULL` — for sparse FKs (a document references one kind of source). */
  partial: boolean;
}

const SPECS: IndexSpec[] = [
  // AQR / Inward / Dump: one of the three source FKs is set per row.
  { entity: Aqr, property: 'grn', partial: true },
  { entity: Aqr, property: 'deliveryChallanNo', partial: true },
  { entity: Aqr, property: 'rbc', partial: true },
  { entity: InwardRegister, property: 'grnNo', partial: true },
  { entity: InwardRegister, property: 'deliveryChallanNo', partial: true },
  { entity: InwardRegister, property: 'rbcNo', partial: true },
  { entity: DumpRegister, property: 'grn', partial: true },
  { entity: DumpRegister, property: 'deliveryChallanNo', partial: true },
  { entity: DumpRegister, property: 'rbcNo', partial: true },
  { entity: ReturnToVendor, property: 'grnNo', partial: true },
  // Line tables: every row has its parent.
  { entity: InwardProduct, property: 'inwardRegister', partial: false },
  { entity: DumpProduct, property: 'dumpRegister', partial: false },
  { entity: ProductReturnToVendor, property: 'returnToVendor', partial: false },
  { entity: ReturnedProducts, property: 'postReturn', partial: false },
  // Approval documents are looked up by business id.
  { entity: Documentb, property: 'document_type_id', partial: false },
];

function resolve(dataSource: DataSource, spec: IndexSpec): { table: string; column: string } {
  const meta = dataSource.getMetadata(spec.entity);
  const relation = meta.findRelationWithPropertyPath(spec.property);
  const column = relation ? relation.joinColumns[0]?.databaseName : meta.findColumnWithPropertyPath(spec.property)?.databaseName;
  if (!column) throw new Error(`${meta.name}.${spec.property}: no column found`);
  return { table: meta.tableName, column };
}

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

async function main(): Promise<void> {
  const dataSource = new DataSource({ ...AppDataSource.options, synchronize: false, migrationsRun: false, dropSchema: false, cache: false } as any);
  await dataSource.initialize();
  let missing = 0;
  try {
    for (const spec of SPECS) {
      const { table, column } = resolve(dataSource, spec);
      const name = `idx_rcv_${table}_${column}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 63);
      const label = `${table}.${column}`;

      // Any valid index whose first key column is this column already serves the lookups.
      const covering: Array<{ index_name: string; valid: boolean }> = await dataSource.query(
        `SELECT i.relname AS index_name, x.indisvalid AS valid
           FROM pg_index x
           JOIN pg_class t ON t.oid = x.indrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = current_schema()
           JOIN pg_class i ON i.oid = x.indexrelid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.indkey[0]
          WHERE t.relname = $1 AND a.attname = $2`,
        [table, column],
      );
      const valid = covering.find((c) => c.valid);
      if (valid) {
        console.log(`ok       ${label} (index ${valid.index_name})`);
        continue;
      }
      const own: Array<{ indexname: string }> = await dataSource.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2`,
        [table, name],
      );
      const invalidOwn = own.length > 0;

      missing += 1;
      const where = spec.partial ? ` WHERE ${ident(column)} IS NOT NULL` : '';
      const sql = `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${ident(name)} ON ${ident(table)} (${ident(column)})${where}`;
      if (!APPLY) {
        console.log(`MISSING  ${label}${invalidOwn ? ` (index ${name} exists but is INVALID)` : ''}\n         ${sql}`);
        continue;
      }
      if (invalidOwn) {
        await dataSource.query(`DROP INDEX CONCURRENTLY IF EXISTS ${ident(name)}`);
        console.log(`dropped  invalid index ${name}`);
      }
      const started = Date.now();
      await dataSource.query(sql);
      console.log(`created  ${name} on ${label} in ${Date.now() - started} ms`);
    }
    if (!APPLY) {
      console.log(missing ? `\nDry run: ${missing} index(es) missing, nothing changed. Re-run with --apply to create them.` : '\nAll receiving indexes exist.');
    } else {
      console.log('\nDone. Run ANALYZE on the tables above if the planner still prefers sequential scans.');
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
