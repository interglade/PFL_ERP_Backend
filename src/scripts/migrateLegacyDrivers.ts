require('dotenv').config();
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../utils/data-source';
import { normalizePhone, PHONE_REGEX } from '../transport/transport.utils';

/**
 * ONE-OFF for the Transporter Registration change (docs/transporter-master-plan.md):
 * run AFTER the first backend boot that carries it, so `synchronize` has already
 * added the new `drivers` columns.
 *
 * Driver rows created before the registration flow existed have no creator, no
 * driver code and the old default status `pending`, which would hide them from
 * employees and leave them waiting for an approval nobody will ask for. For every
 * live driver without a creator this script
 *   - gives it the next free `DR-00001` style code,
 *   - sets `pending` to `approved` (other statuses are left alone),
 *   - tidies the phone number to ten digits when that yields a valid number that no
 *     other driver already uses; anything else is listed and left as it is.
 *
 * Safe to run more than once (rows that already have a code are skipped).
 * Usage: npm run migrate:drivers [-- --dry-run]
 */
const DRY_RUN = process.argv.includes('--dry-run');

interface LegacyRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  status: string;
}

async function main(): Promise<void> {
  const dataSource = new DataSource({
    ...AppDataSource.options,
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    entities: [],
    subscribers: [],
    migrations: [],
    cache: false,
  } as any);
  await dataSource.initialize();

  try {
    const rows: LegacyRow[] = await dataSource.query(
      `SELECT id, "firstName", "lastName", "phoneNumber", status::text AS status
         FROM drivers
        WHERE created_by IS NULL AND "deletedAt" IS NULL AND "driverCode" IS NULL
        ORDER BY "createdAt", id`,
    );
    const [{ last }] = await dataSource.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace("driverCode", '\\D', '', 'g'), '')::int), 0) AS last FROM drivers`,
    );
    const usedPhones = new Set<string>(
      (await dataSource.query(`SELECT "phoneNumber" FROM drivers WHERE "deletedAt" IS NULL AND "phoneNumber" IS NOT NULL`)).map(
        (r: { phoneNumber: string }) => r.phoneNumber,
      ),
    );

    console.log(`${DRY_RUN ? '[dry run] ' : ''}legacy drivers to migrate: ${rows.length}`);
    const unusable: string[] = [];
    let approved = 0;
    let rephoned = 0;
    let next = Number(last);

    await dataSource.transaction(async (manager) => {
      for (const row of rows) {
        next += 1;
        const code = `DR-${String(next).padStart(5, '0')}`;
        const nextStatus = row.status === 'pending' ? 'approved' : row.status;
        if (nextStatus !== row.status) approved += 1;

        let phone = row.phoneNumber;
        const tidy = normalizePhone(row.phoneNumber);
        if (tidy && tidy !== row.phoneNumber) {
          if (PHONE_REGEX.test(tidy) && !usedPhones.has(tidy)) {
            usedPhones.delete(row.phoneNumber ?? '');
            usedPhones.add(tidy);
            phone = tidy;
            rephoned += 1;
          } else {
            unusable.push(`${row.firstName ?? ''} ${row.lastName ?? ''} (${row.id}): phone "${row.phoneNumber}"`);
          }
        }

        if (!DRY_RUN) {
          await manager.query(
            `UPDATE drivers SET "driverCode" = $1, status = $2::drivers_status_enum, "phoneNumber" = $3 WHERE id = $4`,
            [code, nextStatus, phone, row.id],
          );
        }
      }
    });

    console.log(`  codes assigned:      ${rows.length}`);
    console.log(`  pending -> approved: ${approved}`);
    console.log(`  phones tidied:       ${rephoned}`);
    if (unusable.length) {
      console.log(`  phones left as they were (not a valid or already used number): ${unusable.length}`);
      unusable.forEach((line) => console.log(`    - ${line}`));
    }
  } finally {
    await dataSource.destroy();
  }
}

main()
  .then(() => {
    console.log(DRY_RUN ? 'dry run finished, nothing was written' : 'legacy drivers migrated');
    process.exit(0);
  })
  .catch((error) => {
    console.error('legacy driver migration failed:', error);
    process.exit(1);
  });
