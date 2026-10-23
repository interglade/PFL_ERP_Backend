require('dotenv').config();
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../utils/data-source';
import { VehicleDispatch, DispatchType } from '../vehicleDispatch/entity/vehicleDispatch.entity';
import { DispatchProduct } from '../vehicleDispatch/entity/dispatchProduct.entity';
import { DeliveryChallanPurchase } from '../deliveryChallans/deliverychllan/entity/deliveryChallan.entity';
import { Customer } from '../customer/addcustomer/entity/customer.entity';
import { DispatchSourceResolver } from '../vehicleDispatch/service/dispatchSource';
import { readAddress } from '../transport/transport.utils';

/**
 * ONE-OFF for the three Vehicle Dispatch registers (docs/vehicle-dispatch-plan.md §3.3).
 * Run AFTER the first backend boot that carries the change, so `synchronize` has
 * added the new columns (every existing row already got `dispatchType = 'sales'`
 * from the column default).
 *
 * For each live dispatch that is linked to a delivery challan and has no product
 * lines yet it copies from the challan:
 *   - the register (`stock-transfer` when the challan is a stock transfer DC),
 *   - from-location (and to-location for a transfer),
 *   - customer and the effective shipping address (the challan's current shipping
 *     address, else the customer's registered delivery address) for a sales DC,
 *   - the product lines and totals.
 * Dispatches without a challan are left as they are and are listed; the screens show
 * them as legacy records. Nothing is deleted.
 *
 * Safe to run more than once (rows that already have lines are skipped).
 * Usage: npm run migrate:dispatch [-- --dry-run]
 */
const DRY_RUN = process.argv.includes('--dry-run');

const num = (v: number | null) => (v === null || v === undefined ? null : String(v));

async function main(): Promise<void> {
  const dataSource = new DataSource({ ...AppDataSource.options, synchronize: false, migrationsRun: false, dropSchema: false, cache: false } as any);
  await dataSource.initialize();

  const counts = { candidates: 0, sales: 0, transfer: 0, withoutChallan: 0, failed: 0 };
  const withoutChallan: string[] = [];
  const failures: string[] = [];

  try {
    const rows: Array<{ id: string; no: string | null; dc: string | null; dcType: string | null }> = await dataSource.query(`
      SELECT d.id::text AS id, d."vehicleDispatchNo" AS no, d.delivery_challan_id::text AS dc, dc.type AS "dcType"
        FROM dispatch d
        LEFT JOIN delivery_challan_purchase dc ON dc.id = d.delivery_challan_id
       WHERE d."deletedAt" IS NULL AND d."isDeleted" = false
         AND d.grn_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM dispatch_product p WHERE p.dispatch_id = d.id)
       ORDER BY d."createdAt"`);
    counts.candidates = rows.length;

    // Discriminator values of the two delivery challan children.
    const children = dataSource.getMetadata(DeliveryChallanPurchase).childEntityMetadatas;
    const discriminator = (name: string) => children.find((c) => c.targetName === name)?.discriminatorValue;
    const transferValue = discriminator('StockTransferDeliveryChallan');
    const customerValue = discriminator('CustomerDeliveryChallan');

    for (const row of rows) {
      if (!row.dc || (row.dcType !== transferValue && row.dcType !== customerValue)) {
        counts.withoutChallan++;
        withoutChallan.push(`${row.no ?? row.id}${row.dc ? ` (challan type '${row.dcType}')` : ''}`);
        continue;
      }
      const dispatchType = row.dcType === transferValue ? DispatchType.STOCK_TRANSFER : DispatchType.SALES;
      try {
        await dataSource.transaction(async (m) => {
          const source = await new DispatchSourceResolver(m).resolve(dispatchType, row.dc!);
          const d = await m.getRepository(VehicleDispatch).findOneOrFail({ where: { id: row.id }, relations: ['toAddress'] });

          d.dispatchType = dispatchType;
          if (!d.companyName && source.company) d.companyName = { id: source.company.id } as any;
          d.fromLocation = (source.fromLocation ? { id: source.fromLocation.id } : null) as any;
          if (dispatchType === DispatchType.STOCK_TRANSFER) {
            d.toLocation = (source.toLocation ? { id: source.toLocation.id } : null) as any;
          } else if (source.customer) {
            d.customer = { id: source.customer.id } as any;
            const typed = source.currentShippingAddress ? readAddress(source.currentShippingAddress) : null;
            let next = typed;
            if (!next) {
              const customer = await m.getRepository(Customer).findOne({
                where: { id: source.customer.id },
                relations: ['deliveryDetails', 'deliveryDetails.deliveryAddress'],
              });
              const registered = customer?.deliveryDetails?.deliveryAddress;
              next = registered ? readAddress(registered) : null;
            }
            if (next && !d.toAddress) d.toAddress = next as any;
            d.usesCurrentShippingAddress = !!typed;
            if (!d.clientName) d.clientName = source.customer.name as string;
          }

          const lineRepo = m.getRepository(DispatchProduct);
          d.products = source.products.map((line) =>
            Object.assign(lineRepo.create(), {
              productName: line.productId ? { id: line.productId } : null,
              variant: line.variantId ? { id: line.variantId } : null,
              uom: line.uomId ? { id: line.uomId } : null,
              packagingMaterial: line.packagingMaterialId ? { id: line.packagingMaterialId } : null,
              quantity: num(line.quantity),
              unitPrice: num(line.unitPrice),
              amount: num(line.amount),
              packingMaterialWeight: num(line.packingMaterialWeight),
              grossWeight: num(line.grossWeight),
              netWeight: num(line.netWeight),
            }),
          );
          d.totalQuantity = num(source.totals.quantity) as string;
          d.totalGrossWeight = num(source.totals.grossWeight) as string;
          d.totalNetWeight = num(source.totals.netWeight) as string;
          d.totalAmount = num(source.totals.amount) as string;

          if (dispatchType === DispatchType.STOCK_TRANSFER) counts.transfer++;
          else counts.sales++;

          if (!DRY_RUN) await m.getRepository(VehicleDispatch).save(d);
        });
      } catch (error: any) {
        counts.failed++;
        failures.push(`${row.no ?? row.id}: ${error?.message ?? error}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }

  console.log(`${DRY_RUN ? '[dry run] ' : ''}dispatches without product lines: ${counts.candidates}`);
  console.log(`  sales dispatches filled from their customer DC:    ${counts.sales}`);
  console.log(`  moved to stock transfer (linked to a transfer DC): ${counts.transfer}`);
  console.log(`  left as legacy (no delivery challan):              ${counts.withoutChallan}`);
  withoutChallan.forEach((line) => console.log(`    - ${line}`));
  if (counts.failed) {
    console.log(`  failed: ${counts.failed}`);
    failures.forEach((line) => console.log(`    - ${line}`));
  }
}

main()
  .then(() => {
    console.log(DRY_RUN ? 'dry run finished, nothing was written' : 'dispatch registers migrated');
    process.exit(0);
  })
  .catch((error) => {
    console.error('dispatch register migration failed:', error);
    process.exit(1);
  });
