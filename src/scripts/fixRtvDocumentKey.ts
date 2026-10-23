require('dotenv').config();
import 'reflect-metadata';
import { DataSource, EntityManager } from 'typeorm';

/**
 * ONE-OFF — renames the Return To Vendor document key from 'return-by-vendor'
 * to 'return-to-vendor' (the value used by DocumentTypeEnum.RETURN_TO_VENDOR,
 * checkPermission and the frontend). Until this runs, RTV permissions never
 * match for non-admin users.
 *
 * NOTE: the app seeds src/data/documentDefination.json at startup and skips keys
 * that already exist, so once the backend has booted with the corrected seed
 * there are usually TWO rows: the old 'return-by-vendor' (holding the users'
 * permissions) and a fresh, unreferenced 'return-to-vendor'. This script handles
 * every combination:
 *   - only old            -> rename it in place (keeps its id and permissions);
 *   - old + new, new unreferenced -> delete the new row, then rename the old one;
 *   - old + new, old unreferenced -> delete the old row;
 *   - both referenced     -> move the old row's references onto the new row
 *                            (document_permissions for the same employee are
 *                            merged by OR-ing the can* flags), then delete the old row.
 * It also rewrites 'return-by-vendor' in any text / enum column named like a
 * document key or type (uniqueKey, documentType, type, docType, ...), and reports
 * (without changing) json/jsonb columns that contain it.
 *
 * DRY RUN by default. Usage:
 *   npm run db:fix-rtv-key             (dry run)
 *   npm run db:fix-rtv-key -- --apply  (writes, one transaction)
 */

const APPLY = process.argv.includes('--apply');
const OLD_KEY = 'return-by-vendor';
const NEW_KEY = 'return-to-vendor';
const DEF_TABLE = 'document_definitions';
const PERM_TABLE = 'document_permissions';

/** Column names that may hold a document key as text. */
const KEY_COLUMN_PATTERN =
  '^(uniquekey|unique_key|documentkey|document_key|dockey|doc_key|documenttype|document_type|doctype|doc_type|type|permissionkey|permission_key|modulekey|module_key|module|pagekey|page_key|screenkey|screen_key)$';

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

interface DefRow { id: string; isDeleted: boolean | null; deletedAt: Date | null }
interface RefColumn { table: string; column: string }

async function referencingColumns(m: EntityManager, schema: string): Promise<RefColumn[]> {
  const rows: Array<{ table_name: string; column_name: string }> = await m.query(
    `SELECT DISTINCT kcu.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1
        AND ccu.table_schema = $1 AND ccu.table_name = $2 AND ccu.column_name = 'id'`,
    [schema, DEF_TABLE],
  );
  return rows.map((r) => ({ table: r.table_name, column: r.column_name }));
}

async function countRefs(m: EntityManager, refs: RefColumn[], id: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of refs) {
    const [{ n }] = await m.query(`SELECT COUNT(*) AS n FROM ${q(r.table)} WHERE ${q(r.column)} = $1::uuid`, [id]);
    if (Number(n) > 0) out.set(`${r.table}.${r.column}`, Number(n));
  }
  return out;
}

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
const fmt = (m: Map<string, number>) => (m.size ? [...m.entries()].map(([k, v]) => `${k}=${v}`).join(', ') : 'none');

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
    const [{ schema }] = await ds.query(`SELECT current_schema() AS schema`);
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (pass --apply to write)'}`);

    const run = async (m: EntityManager) => {
      // ---------------------------------------------------------------
      // 1. document_definitions
      // ---------------------------------------------------------------
      const defs = async (key: string): Promise<DefRow[]> =>
        m.query(
          `SELECT id::text AS id, "isDeleted", "deletedAt" FROM ${q(DEF_TABLE)} WHERE "uniqueKey" = $1 ${APPLY ? 'FOR UPDATE' : ''}`,
          [key],
        );
      const oldRows = await defs(OLD_KEY);
      const newRows = await defs(NEW_KEY);
      const refs = await referencingColumns(m, schema);
      console.log(`Columns referencing ${DEF_TABLE}: ${refs.map((r) => `${r.table}.${r.column}`).join(', ') || 'none'}`);

      const oldRow = oldRows[0];
      const newRow = newRows[0];
      const oldRefs = oldRow ? await countRefs(m, refs, oldRow.id) : new Map<string, number>();
      const newRefs = newRow ? await countRefs(m, refs, newRow.id) : new Map<string, number>();
      if (oldRow) console.log(`'${OLD_KEY}' row ${oldRow.id}${oldRow.deletedAt || oldRow.isDeleted ? ' (soft-deleted)' : ''}: refs ${fmt(oldRefs)}`);
      if (newRow) console.log(`'${NEW_KEY}' row ${newRow.id}${newRow.deletedAt || newRow.isDeleted ? ' (soft-deleted)' : ''}: refs ${fmt(newRefs)}`);

      if (!oldRow) {
        console.log(`No '${OLD_KEY}' document definition — nothing to rename.`);
      } else if (!newRow) {
        console.log(`Plan: rename ${oldRow.id} '${OLD_KEY}' -> '${NEW_KEY}' (permissions keep pointing at it).`);
        if (APPLY) {
          await m.query(`UPDATE ${q(DEF_TABLE)} SET "uniqueKey" = $1 WHERE id = $2::uuid`, [NEW_KEY, oldRow.id]);
        }
      } else if (total(newRefs) === 0) {
        console.log(`Plan: delete unreferenced '${NEW_KEY}' row ${newRow.id} (seeded at startup), then rename ${oldRow.id}.`);
        if (APPLY) {
          await m.query(`DELETE FROM ${q(DEF_TABLE)} WHERE id = $1::uuid`, [newRow.id]);
          await m.query(
            `UPDATE ${q(DEF_TABLE)} SET "uniqueKey" = $1, "isDeleted" = false, "deletedAt" = NULL WHERE id = $2::uuid`,
            [NEW_KEY, oldRow.id],
          );
        }
      } else if (total(oldRefs) === 0) {
        console.log(`Plan: delete unreferenced '${OLD_KEY}' row ${oldRow.id}; '${NEW_KEY}' row ${newRow.id} is already in use.`);
        if (APPLY) await m.query(`DELETE FROM ${q(DEF_TABLE)} WHERE id = $1::uuid`, [oldRow.id]);
      } else {
        console.log(`Plan: both rows referenced — move references of ${oldRow.id} onto ${newRow.id}, merge permissions, delete ${oldRow.id}.`);
        if (APPLY) {
          for (const r of refs) {
            if (r.table === PERM_TABLE) {
              // Same employee holds a permission row on both definitions: OR the flags into
              // the new row and drop the old one; then move the rest.
              const flagCols: Array<{ column_name: string }> = await m.query(
                `SELECT column_name FROM information_schema.columns
                  WHERE table_schema = $1 AND table_name = $2 AND data_type = 'boolean' AND column_name LIKE 'can%'`,
                [schema, PERM_TABLE],
              );
              const empCol = 'employeeId';
              const [{ n: hasEmp }] = await m.query(
                `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
                [schema, PERM_TABLE, empCol],
              );
              if (Number(hasEmp) === 0) throw new Error(`${PERM_TABLE}.${empCol} not found — cannot merge permissions safely.`);
              if (flagCols.length > 0) {
                const sets = flagCols.map((c) => `${q(c.column_name)} = n.${q(c.column_name)} OR o.${q(c.column_name)}`).join(', ');
                await m.query(
                  `UPDATE ${q(PERM_TABLE)} n SET ${sets}
                     FROM ${q(PERM_TABLE)} o
                    WHERE n.${q(r.column)} = $1::uuid AND o.${q(r.column)} = $2::uuid
                      AND n.${q(empCol)} IS NOT DISTINCT FROM o.${q(empCol)}`,
                  [newRow.id, oldRow.id],
                );
              }
              await m.query(
                `DELETE FROM ${q(PERM_TABLE)} o
                  WHERE o.${q(r.column)} = $2::uuid
                    AND EXISTS (SELECT 1 FROM ${q(PERM_TABLE)} n
                                 WHERE n.${q(r.column)} = $1::uuid
                                   AND n.${q(empCol)} IS NOT DISTINCT FROM o.${q(empCol)})`,
                [newRow.id, oldRow.id],
              );
            }
            await m.query(`UPDATE ${q(r.table)} SET ${q(r.column)} = $1::uuid WHERE ${q(r.column)} = $2::uuid`, [newRow.id, oldRow.id]);
          }
          await m.query(`DELETE FROM ${q(DEF_TABLE)} WHERE id = $1::uuid`, [oldRow.id]);
        }
      }

      // ---------------------------------------------------------------
      // 2. Other text / enum key columns holding the old key
      // ---------------------------------------------------------------
      const cols: Array<{ table_name: string; column_name: string; data_type: string; udt_name: string }> = await m.query(
        `SELECT c.table_name, c.column_name, c.data_type, c.udt_name
           FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = $1 AND t.table_type = 'BASE TABLE'
            AND c.data_type IN ('text', 'character varying', 'USER-DEFINED')
            AND lower(c.column_name) ~ $2
            AND NOT (c.table_name = $3 AND c.column_name = 'uniqueKey')`,
        [schema, KEY_COLUMN_PATTERN, DEF_TABLE],
      );
      let textHits = 0;
      for (const c of cols) {
        if (c.data_type === 'USER-DEFINED') {
          // Only enums can hold the value; skip other user-defined types.
          const labels: Array<{ enumlabel: string }> = await m.query(
            `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1`,
            [c.udt_name],
          );
          const set = new Set(labels.map((l) => l.enumlabel));
          if (!set.has(OLD_KEY)) continue;
          const [{ n }] = await m.query(`SELECT COUNT(*) AS n FROM ${q(c.table_name)} WHERE ${q(c.column_name)}::text = $1`, [OLD_KEY]);
          if (Number(n) === 0) continue;
          textHits += Number(n);
          if (!set.has(NEW_KEY)) {
            console.log(`  ! ${c.table_name}.${c.column_name} (enum ${c.udt_name}) has ${n} rows with '${OLD_KEY}' but the enum lacks '${NEW_KEY}' — left unchanged, fix manually.`);
            continue;
          }
          console.log(`  ${c.table_name}.${c.column_name} (enum): ${n} rows -> '${NEW_KEY}'`);
          if (APPLY) {
            await m.query(
              `UPDATE ${q(c.table_name)} SET ${q(c.column_name)} = $1::${q(c.udt_name)} WHERE ${q(c.column_name)}::text = $2`,
              [NEW_KEY, OLD_KEY],
            );
          }
          continue;
        }
        const [{ n }] = await m.query(`SELECT COUNT(*) AS n FROM ${q(c.table_name)} WHERE ${q(c.column_name)} = $1`, [OLD_KEY]);
        if (Number(n) === 0) continue;
        textHits += Number(n);
        console.log(`  ${c.table_name}.${c.column_name}: ${n} rows -> '${NEW_KEY}'`);
        if (APPLY) {
          await m.query(`UPDATE ${q(c.table_name)} SET ${q(c.column_name)} = $1 WHERE ${q(c.column_name)} = $2`, [NEW_KEY, OLD_KEY]);
        }
      }
      console.log(`Other key columns scanned: ${cols.length}; rows holding '${OLD_KEY}': ${textHits}`);

      // ---------------------------------------------------------------
      // 3. Report-only: json/jsonb columns mentioning the old key
      // ---------------------------------------------------------------
      const jsonCols: Array<{ table_name: string; column_name: string }> = await m.query(
        `SELECT c.table_name, c.column_name
           FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = $1 AND t.table_type = 'BASE TABLE' AND c.data_type IN ('json', 'jsonb')`,
        [schema],
      );
      for (const c of jsonCols) {
        const [{ n }] = await m.query(
          `SELECT COUNT(*) AS n FROM ${q(c.table_name)} WHERE ${q(c.column_name)}::text LIKE $1`,
          [`%${OLD_KEY}%`],
        );
        if (Number(n) > 0) console.log(`  (report only) ${c.table_name}.${c.column_name}: ${n} json rows mention '${OLD_KEY}' — review manually.`);
      }
    };

    if (APPLY) {
      await ds.transaction(run);
      console.log('\nAPPLIED (committed).');
    } else {
      await run(ds.manager);
      console.log('\nDRY RUN complete — nothing written. Re-run with --apply to write.');
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('fixRtvDocumentKey failed (nothing was committed):', err);
  process.exit(1);
});
