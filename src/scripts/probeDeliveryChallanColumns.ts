require('dotenv').config();
import 'reflect-metadata';

/**
 * DIAGNOSTIC — prints which database column TypeORM uses for the
 * `fromLocation` relation of the three delivery challan entities.
 *
 * The three children of `delivery_challan_purchase` (single-table
 * inheritance) each declare a `fromLocation` relation with a different
 * `@JoinColumn` name (`branch_id`, `from_location_id`,
 * `other_from_location_id_for_other`). TypeORM keeps one column per property
 * name, chosen by decorator registration order, i.e. by module import order.
 * The application (app.ts → inversify.config) and the TypeORM CLI (entity
 * glob) import the modules in different orders, so `synchronize` renames the
 * column back and forth between the two names. Never read it in raw SQL
 * without asking the metadata first.
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/probeDeliveryChallanColumns.ts        # app import order
 *   PROBE_ORDER=glob npx ts-node --transpile-only src/scripts/probeDeliveryChallanColumns.ts  # CLI glob order
 *
 * Opens its own DataSource with synchronize disabled; it changes nothing.
 */
async function main(): Promise<void> {
  if (process.env.PROBE_ORDER !== 'glob') {
    // Same first imports as src/app.ts, so decorators register in the app's order.
    require('../middleware/performance.middleware');
    require('../inversify.config');
  }
  const { DataSource } = require('typeorm');
  const { AppDataSource } = require('../utils/data-source');
  const { DeliveryChallanPurchase } = require('../deliveryChallans/deliverychllan/entity/deliveryChallan.entity');
  const { CustomerDeliveryChallan } = require('../deliveryChallans/customerDeliveryChllan/entity/customerDeliveryChallan.entity');
  const { StockTransferDeliveryChallan } = require('../deliveryChallans/stockTransferDC/entity/stockTransferdeliveryChallan.entity');
  const { OtherDeliveryChallan } = require('../deliveryChallans/otherDeliveryChallan/entity/otherDeliveryChallan.entity');
  const { Item } = require('../deliveryChallans/deliverychllan/entity/dItem.entity');
  const { ReturnedProducts } = require('../returnByCustomer/entity/returnProduct.entity');
  const { GRN } = require('../grn/entity/grn.entity');

  const ds = new DataSource({ ...AppDataSource.options, synchronize: false, migrationsRun: false, dropSchema: false, cache: false });
  await ds.initialize();
  try {
    const joinCol = (entity: any, prop: string) => {
      const rel = ds.getMetadata(entity).findRelationWithPropertyPath(prop);
      return rel ? rel.joinColumns.map((c: any) => c.databaseName).join(',') : '(no relation)';
    };
    console.log('order:', process.env.PROBE_ORDER === 'glob' ? 'glob (CLI)' : 'app');
    console.log('parent table columns (location-ish):',
      ds.getMetadata(DeliveryChallanPurchase).columns.map((c: any) => c.databaseName).filter((n: string) => /location|branch/.test(n)));
    console.log('CustomerDeliveryChallan.fromLocation ->', joinCol(CustomerDeliveryChallan, 'fromLocation'));
    console.log('StockTransferDeliveryChallan.fromLocation ->', joinCol(StockTransferDeliveryChallan, 'fromLocation'));
    console.log('StockTransferDeliveryChallan.toLocation   ->', joinCol(StockTransferDeliveryChallan, 'toLocation'));
    console.log('OtherDeliveryChallan.fromLocation        ->', joinCol(OtherDeliveryChallan, 'fromLocation'));
    console.log('Item.deliveryChallan                     ->', joinCol(Item, 'deliveryChallan'));
    console.log('ReturnedProducts.postReturn              ->', joinCol(ReturnedProducts, 'postReturn'));
    console.log('GRN.purchaseForSalesLocation             ->', joinCol(GRN, 'purchaseForSalesLocation'));
    const live = await ds.query(
      `SELECT string_agg(column_name, ',' ORDER BY column_name) AS cols FROM information_schema.columns
        WHERE table_name = 'delivery_challan_purchase' AND (column_name LIKE '%location%' OR column_name = 'branch_id')`,
    );
    console.log('live DB columns:', live[0]?.cols);
  } finally {
    await ds.destroy();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
