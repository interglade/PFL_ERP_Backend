require('dotenv').config();
import 'reflect-metadata';

/**
 * DIAGNOSTIC — runs ReceivingStatusService.listArrivals() and one
 * getSourceStatus() directly against the configured database, bypassing HTTP
 * and authentication, and prints the result or the SQL error.
 *
 * Usage: npx ts-node --transpile-only src/scripts/probeReceivingArrivals.ts [sourceType sourceId]
 * Opens its own DataSource with synchronize disabled; it changes nothing.
 */
async function main(): Promise<void> {
  require('../middleware/performance.middleware');
  require('../inversify.config'); // same decorator registration order as the app
  const { DataSource } = require('typeorm');
  const { AppDataSource } = require('../utils/data-source');
  const { ReceivingStatusService } = require('../receiving/service/receivingStatus.service');

  const ds = new DataSource({ ...AppDataSource.options, synchronize: false, migrationsRun: false, dropSchema: false, cache: false });
  await ds.initialize();
  try {
    const service = new ReceivingStatusService(ds);
    const arrivals = await service.listArrivals({ page: 1, limit: 10 });
    console.log('listArrivals total:', arrivals.total, 'rows on page:', arrivals.data.length);
    for (const row of arrivals.data) {
      console.log(` - ${row.sourceType} ${row.sourceNo} @ ${row.locationName} products=${row.productCount} receivedKg=${row.receivedKg} state=${row.state} slots=${JSON.stringify(row.slots)}`);
    }
    const [sourceType, sourceId] = process.argv.slice(2);
    const first = arrivals.data[0];
    const probeType = sourceType ?? first?.sourceType;
    const probeId = sourceId ?? first?.sourceId;
    if (probeType && probeId) {
      const status = await service.getSourceStatus(probeType, probeId);
      console.log(`getSourceStatus(${probeType}, ${probeId}): state=${status.state} documentId=${status.source.documentId} products=${status.products.length}`);
      for (const p of status.products) {
        console.log(`   ${p.productName}${p.variantName ? ` (${p.variantName})` : ''}: received=${p.receivedKg} inward=${p.inwardKg} dump=${p.dumpKg} rtv=${p.rtvKg} diff=${p.differenceKg}`);
      }
    }
  } finally {
    await ds.destroy();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('probe failed:', e?.message ?? e); process.exit(1); });
