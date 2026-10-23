require('dotenv').config();
import 'reflect-metadata';
import { DataSource, EntityManager } from 'typeorm';

/**
 * ONE-OFF — merges duplicate rows of the `uom` master ('KG', 'Kg', 'kgs', 'Kgs.' ...).
 *
 * Rows are grouped by a normalised key of `uom.unit` (see normaliseUomKey). Every
 * column that references `uom` through a foreign key is found generically from
 * information_schema (plus the UOM_conversion_matrix from/to columns as a fallback
 * in case their constraints are missing), so new referencing tables are covered.
 *
 * DRY RUN by default: prints each group with the references held by each uom id
 * and the row that would be kept. Nothing is written.
 *
 * With --apply, inside ONE transaction, for every group with more than one row:
 *   1. the canonical row is the live row with the most references
 *      (tie -> oldest createdAt, then lowest id);
 *   2. every referencing FK column is re-pointed from the duplicates to it
 *      (for join tables whose unique/PK constraint includes the column, rows that
 *      would become duplicates are removed first);
 *   3. the duplicates are soft-deleted (isDeleted = true, deletedAt = now()) when
 *      the table has those columns, otherwise deleted;
 *   4. UOM_conversion_matrix rows that became self-conversions (from = to) or
 *      duplicate (from, to) pairs are soft-deleted / deleted.
 * Any error rolls the whole run back.
 *
 * Usage: npm run db:dedupe-uoms             (dry run)
 *        npm run db:dedupe-uoms -- --apply  (writes)
 */

const APPLY = process.argv.includes('--apply');

const SYNONYMS: Record<string, string> = {
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg', kgm: 'kg',
  no: 'nos', nos: 'nos', number: 'nos', numbers: 'nos', pc: 'nos', pcs: 'nos', piece: 'nos', pieces: 'nos',
  box: 'box', boxes: 'box',
  crate: 'crate', crates: 'crate',
  bundle: 'bundle', bundles: 'bundle',
  dozen: 'dozen', dozens: 'dozen', dz: 'dozen', doz: 'dozen',
};

/** Normalised grouping key for a uom label. Exported for tests. */
export function normaliseUomKey(raw: string | null | undefined): string {
  const base = String(raw ?? '').trim().toLowerCase().replace(/[.\s]+/g, '');
  if (!base) return '';
  if (SYNONYMS[base]) return SYNONYMS[base];
  let stem = base;
  if (stem.endsWith('s') && stem.length - 1 >= 2) stem = stem.slice(0, -1);
  return SYNONYMS[stem] ?? stem;
}

interface UomRow {
  id: string;
  unit: string | null;
  abbreviation: string | null;
  createdAt: Date | null;
  live: boolean;
}

interface RefColumn {
  table: string;
  column: string;
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

async function columnsOf(m: EntityManager, schema: string, table: string): Promise<Set<string>> {
  const rows: Array<{ column_name: string }> = await m.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  );
  return new Set(rows.map((r) => r.column_name));
}

async function findReferencingColumns(m: EntityManager, schema: string): Promise<RefColumn[]> {
  const rows: Array<{ table_name: string; column_name: string }> = await m.query(
    `SELECT DISTINCT kcu.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND ccu.table_schema = $1
        AND ccu.table_name = 'uom'
        AND ccu.column_name = 'id'
      ORDER BY kcu.table_name, kcu.column_name`,
    [schema],
  );
  const refs: RefColumn[] = rows.map((r) => ({ table: r.table_name, column: r.column_name }));

  // Fallback: the conversion matrix relations, in case their FK constraints are missing.
  const matrixCols = await columnsOf(m, schema, 'UOM_conversion_matrix');
  for (const column of ['fromUOMId', 'toUOMId']) {
    if (matrixCols.has(column) && !refs.some((r) => r.table === 'UOM_conversion_matrix' && r.column === column)) {
      refs.push({ table: 'UOM_conversion_matrix', column });
    }
  }
  return refs;
}

/** Other columns of each unique/PK constraint on `table` that includes `column`. */
async function uniqueSiblings(m: EntityManager, schema: string, ref: RefColumn): Promise<string[][]> {
  const rows: Array<{ constraint_name: string; column_name: string }> = await m.query(
    `SELECT tc.constraint_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2
        AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')`,
    [schema, ref.table],
  );
  const byConstraint = new Map<string, string[]>();
  for (const r of rows) {
    const list = byConstraint.get(r.constraint_name) ?? [];
    list.push(r.column_name);
    byConstraint.set(r.constraint_name, list);
  }
  return [...byConstraint.values()]
    .filter((cols) => cols.includes(ref.column))
    .map((cols) => cols.filter((c) => c !== ref.column));
}

async function main(): Promise<void> {
  const { AppDataSource } = require('../utils/data-source');
  const ds = new DataSource({
    ...AppDataSource.options,
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    cache: false,
  } as any);
  await ds.initialize();

  try {
    const m = ds.manager;
    const [{ schema }] = await m.query(`SELECT current_schema() AS schema`);

    const uomCols = await columnsOf(m, schema, 'uom');
    if (uomCols.size === 0) throw new Error(`Table "uom" not found in schema ${schema}`);
    const hasCreatedAt = uomCols.has('createdAt');
    const hasIsDeleted = uomCols.has('isDeleted');
    const hasDeletedAt = uomCols.has('deletedAt');

    const liveExpr = [
      hasIsDeleted ? `COALESCE("isDeleted", false) = false` : null,
      hasDeletedAt ? `"deletedAt" IS NULL` : null,
    ].filter(Boolean).join(' AND ') || 'true';

    const uoms: UomRow[] = await m.query(
      `SELECT id::text AS id, unit, abbreviation,
              ${hasCreatedAt ? `"createdAt"` : 'NULL'} AS "createdAt",
              (${liveExpr}) AS live
         FROM uom`,
    );

    const refs = await findReferencingColumns(m, schema);
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (pass --apply to write)'}`);
    console.log(`uom rows: ${uoms.length}; referencing columns: ${refs.length}`);
    for (const r of refs) console.log(`  - ${r.table}.${r.column}`);

    // Reference counts per uom id per column.
    const refCounts = new Map<string, Map<string, number>>(); // uomId -> "table.column" -> n
    for (const r of refs) {
      const rows: Array<{ id: string; n: string }> = await m.query(
        `SELECT ${q(r.column)}::text AS id, COUNT(*) AS n FROM ${q(r.table)} WHERE ${q(r.column)} IS NOT NULL GROUP BY ${q(r.column)}`,
      );
      for (const row of rows) {
        const perCol = refCounts.get(row.id) ?? new Map<string, number>();
        perCol.set(`${r.table}.${r.column}`, Number(row.n));
        refCounts.set(row.id, perCol);
      }
    }
    const totalRefs = (id: string) => [...(refCounts.get(id)?.values() ?? [])].reduce((a, b) => a + b, 0);

    // Group.
    const groups = new Map<string, UomRow[]>();
    for (const u of uoms) {
      const key = normaliseUomKey(u.unit) || normaliseUomKey(u.abbreviation);
      if (!key) continue;
      const list = groups.get(key) ?? [];
      list.push(u);
      groups.set(key, list);
    }

    const plans: Array<{ key: string; canonical: UomRow; duplicates: UomRow[] }> = [];
    for (const [key, rows] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (rows.length < 2) continue;
      const live = rows.filter((r) => r.live);
      if (live.length === 0) {
        console.log(`\n[${key}] ${rows.length} rows, none live — skipped`);
        continue;
      }
      const ranked = [...live].sort((a, b) => {
        const diff = totalRefs(b.id) - totalRefs(a.id);
        if (diff !== 0) return diff;
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (ta !== tb) return ta - tb;
        return a.id.localeCompare(b.id);
      });
      const canonical = ranked[0];
      plans.push({ key, canonical, duplicates: rows.filter((r) => r.id !== canonical.id) });
    }

    for (const p of plans) {
      console.log(`\n[${p.key}] ${p.duplicates.length + 1} rows`);
      for (const u of [p.canonical, ...p.duplicates]) {
        const tag = u.id === p.canonical.id ? 'KEEP ' : 'MERGE';
        const detail = [...(refCounts.get(u.id)?.entries() ?? [])].map(([c, n]) => `${c}=${n}`).join(', ');
        console.log(
          `  ${tag} ${u.id}  unit=${JSON.stringify(u.unit)} abbr=${JSON.stringify(u.abbreviation)}` +
            `${u.live ? '' : ' (already deleted)'} createdAt=${u.createdAt ? new Date(u.createdAt).toISOString() : '-'}` +
            `  refs=${totalRefs(u.id)}${detail ? ` [${detail}]` : ''}`,
        );
      }
    }

    if (plans.length === 0) {
      console.log('\nNo duplicate uom groups found.');
      return;
    }

    const summary = { groups: plans.length, rowsMerged: 0, refsRepointed: 0, joinRowsRemoved: 0, matrixRowsRetired: 0 };

    if (!APPLY) {
      summary.rowsMerged = plans.reduce((a, p) => a + p.duplicates.filter((d) => d.live).length, 0);
      summary.refsRepointed = plans.reduce((a, p) => a + p.duplicates.reduce((b, d) => b + totalRefs(d.id), 0), 0);
      console.log(`\nDRY RUN summary: ${summary.groups} groups, ${summary.rowsMerged} live duplicate rows would be retired, ${summary.refsRepointed} references would be re-pointed.`);
      console.log('Re-run with --apply to write.');
      return;
    }

    await ds.transaction(async (tx) => {
      const siblingsByRef = new Map<string, string[][]>();
      for (const r of refs) siblingsByRef.set(`${r.table}.${r.column}`, await uniqueSiblings(tx, schema, r));

      for (const p of plans) {
        const dupIds = p.duplicates.map((d) => d.id);

        for (const r of refs) {
          const siblings = siblingsByRef.get(`${r.table}.${r.column}`) ?? [];
          for (const others of siblings) {
            if (others.length === 0) {
              throw new Error(`${r.table}.${r.column} is unique on its own; merging uom "${p.key}" could violate it — resolve manually.`);
            }
            // Join-table style: keep one row per (other columns), preferring the canonical one.
            const partition = others.map(q).join(', ');
            const removed: any = await tx.query(
              `DELETE FROM ${q(r.table)} WHERE ctid IN (
                 SELECT ctid FROM (
                   SELECT ctid, ROW_NUMBER() OVER (
                            PARTITION BY ${partition}
                            ORDER BY (${q(r.column)} = $1::uuid) DESC) AS rn
                     FROM ${q(r.table)}
                    WHERE ${q(r.column)} = $1::uuid OR ${q(r.column)} = ANY($2::uuid[])
                 ) x WHERE x.rn > 1)`,
              [p.canonical.id, dupIds],
            );
            summary.joinRowsRemoved += Number(removed?.[1] ?? 0);
          }

          const updated: any = await tx.query(
            `UPDATE ${q(r.table)} SET ${q(r.column)} = $1::uuid WHERE ${q(r.column)} = ANY($2::uuid[])`,
            [p.canonical.id, dupIds],
          );
          summary.refsRepointed += Number(updated?.[1] ?? 0);
        }

        const liveDupIds = p.duplicates.filter((d) => d.live).map((d) => d.id);
        if (liveDupIds.length > 0) {
          if (hasIsDeleted || hasDeletedAt) {
            const sets = [
              hasIsDeleted ? `"isDeleted" = true` : null,
              hasDeletedAt ? `"deletedAt" = now()` : null,
            ].filter(Boolean).join(', ');
            await tx.query(`UPDATE uom SET ${sets} WHERE id = ANY($1::uuid[])`, [liveDupIds]);
          } else {
            await tx.query(`DELETE FROM uom WHERE id = ANY($1::uuid[])`, [liveDupIds]);
          }
          summary.rowsMerged += liveDupIds.length;
        }
      }

      // Conversion matrix: retire self-conversions and duplicate (from, to) pairs.
      const matrixCols = await columnsOf(tx, schema, 'UOM_conversion_matrix');
      if (matrixCols.has('fromUOMId') && matrixCols.has('toUOMId')) {
        const mLive = [
          matrixCols.has('isDeleted') ? `COALESCE("isDeleted", false) = false` : null,
          matrixCols.has('deletedAt') ? `"deletedAt" IS NULL` : null,
        ].filter(Boolean).join(' AND ') || 'true';
        const order = matrixCols.has('createdAt') ? `"createdAt", id` : 'id';
        const victims: Array<{ id: string }> = await tx.query(
          `SELECT id::text AS id FROM (
             SELECT id, "fromUOMId", "toUOMId",
                    ROW_NUMBER() OVER (PARTITION BY "fromUOMId", "toUOMId" ORDER BY ${order}) AS rn
               FROM "UOM_conversion_matrix" WHERE ${mLive}
           ) x WHERE x."fromUOMId" = x."toUOMId" OR x.rn > 1`,
        );
        if (victims.length > 0) {
          const ids = victims.map((v) => v.id);
          if (matrixCols.has('isDeleted') || matrixCols.has('deletedAt')) {
            const sets = [
              matrixCols.has('isDeleted') ? `"isDeleted" = true` : null,
              matrixCols.has('deletedAt') ? `"deletedAt" = now()` : null,
            ].filter(Boolean).join(', ');
            await tx.query(`UPDATE "UOM_conversion_matrix" SET ${sets} WHERE id = ANY($1::uuid[])`, [ids]);
          } else {
            await tx.query(`DELETE FROM "UOM_conversion_matrix" WHERE id = ANY($1::uuid[])`, [ids]);
          }
          summary.matrixRowsRetired = ids.length;
        }
      }
    });

    console.log(
      `\nAPPLIED: ${summary.groups} groups, ${summary.rowsMerged} duplicate uom rows retired, ` +
        `${summary.refsRepointed} references re-pointed, ${summary.joinRowsRemoved} conflicting join rows removed, ` +
        `${summary.matrixRowsRetired} conversion-matrix rows retired.`,
    );
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('dedupeUoms failed (nothing was committed):', err);
    process.exit(1);
  });
}
