require('dotenv').config();
import 'reflect-metadata';

/**
 * DIAGNOSTIC — opens transactions for existing documents inside one DB
 * transaction, attaches their children, prints the list / detail / search /
 * ledger the API would return, then ROLLS BACK. It changes nothing.
 *
 * Usage: npx ts-node --transpile-only src/scripts/probeTransactions.ts
 */
async function main(): Promise<void> {
  require('../middleware/performance.middleware');
  require('../inversify.config');
  const { DataSource } = require('typeorm');
  const { AppDataSource } = require('../utils/data-source');
  const core = require('../transactions/transaction.core');
  const { TransactionService } = require('../transactions/service/transaction.service');

  const ds = new DataSource({ ...AppDataSource.options, synchronize: false, migrationsRun: false, dropSchema: false, cache: false });
  await ds.initialize();
  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  const m = qr.manager;
  const service = new TransactionService({ manager: m, connection: ds });
  const show = (label: string, value: unknown) => console.log(`\n=== ${label}\n${JSON.stringify(value, null, 2)}`);
  try {
    const opened: string[] = [];
    if (process.argv.includes('--synthetic')) {
      // Empty dev database: minimal rows (rolled back below).
      const g = (await m.query(`INSERT INTO grns ("grnNo", "batchNo", "totalAmt") VALUES ('GRN-PROBE1', 'PROBE-B1', 1000) RETURNING id::text AS id`))[0];
      await m.query(`INSERT INTO documents (type, status, document_type_id) VALUES ('grn', 'Complete', $1)`, [g.id]);
      const a = (await m.query(`INSERT INTO aqr ("aqrNo", grn_id) VALUES ('AQR-PROBE1', $1) RETURNING id::text AS id`, [g.id]))[0];
      await m.query(`INSERT INTO documents (type, status, document_type_id) VALUES ('aqr', 'Hold', $1)`, [a.id]);
      await m.query(`INSERT INTO inward_register ("inwardNo", grn_id) VALUES ('IWD-PROBE1', $1)`, [g.id]);
      const dc = (await m.query(`INSERT INTO delivery_challan_purchase ("challanNo", type, "totalProductAmount") VALUES ('CN-PROBE1', 'customer_delivery_challan', 500) RETURNING id::text AS id`))[0];
      await m.query(`INSERT INTO documents (type, status, document_type_id) VALUES ('DC_TYPE_CUSTOMER', 'Complete', $1)`, [dc.id]);
      const inv = (await m.query(`INSERT INTO invoices ("invoiceNo", delivery_challan_id, "totalAmount") VALUES ('INV-PROBE1', $1, 500) RETURNING id::text AS id`, [dc.id]))[0];
      await m.query(`INSERT INTO documents (type, status, document_type_id) VALUES ('final-invoice', 'Hold', $1)`, [inv.id]);
      await m.query(`INSERT INTO delivery_challan_purchase ("challanNo", type, "stockTransferType") VALUES ('ST-PROBE1', 'stock-transfer-delivery-challan', 'cc-dc stock transfer')`);
    }
    // Purchase from the newest GRN with an Inward (G, as if it had no deal slip).
    const grn = (await m.query(
      `SELECT g.id::text AS id, g."grnNo" AS no FROM grns g WHERE g."deletedAt" IS NULL AND EXISTS (SELECT 1 FROM inward_register i WHERE i.grn_id = g.id)
        ORDER BY g."createdAt" DESC LIMIT 1`,
    ))[0];
    if (grn) {
      const txn = await core.openTransaction(m, { type: 'purchase', origin: { docType: 'grn', docId: grn.id, docNo: grn.no }, partyName: 'Probe party' });
      opened.push(txn);
      const children: Array<{ t: string; id: string; no: string | null }> = await m.query(
        `SELECT 'aqr' AS t, id::text AS id, "aqrNo" AS no FROM aqr WHERE grn_id = $1
         UNION ALL SELECT 'inward-register', id::text, "inwardNo" FROM inward_register WHERE grn_id = $1
         UNION ALL SELECT 'dump-register', id::text, "dumpNo" FROM dump_register WHERE grn_id = $1
         UNION ALL SELECT 'dispatch', id::text, "vehicleDispatchNo" FROM dispatch WHERE grn_id = $1`,
        [grn.id],
      );
      for (const c of children) await core.attachToTransaction(m, { txnNo: txn, docType: c.t, docId: c.id, docNo: c.no });
      console.log(`purchase ${txn} for GRN ${grn.no} with ${children.length} children`);
    }
    // Sale from the newest Customer DC with an invoice.
    const dc = (await m.query(
      `SELECT dc.id::text AS id, dc."challanNo" AS no FROM delivery_challan_purchase dc
        WHERE dc.type = 'customer_delivery_challan' AND dc."deletedAt" IS NULL
        ORDER BY EXISTS (SELECT 1 FROM invoices i WHERE i.delivery_challan_id = dc.id) DESC, dc."createdAt" DESC LIMIT 1`,
    ))[0];
    if (dc) {
      const txn = await core.openTransaction(m, { type: 'sale', origin: { docType: 'dc-customer', docId: dc.id, docNo: dc.no } });
      opened.push(txn);
      const children: Array<{ t: string; id: string; no: string | null }> = await m.query(
        `SELECT 'final-invoice' AS t, id::text AS id, "invoiceNo" AS no FROM invoices WHERE delivery_challan_id = $1
         UNION ALL SELECT 'return-by-customer', id::text, "rbcNo" FROM return_by_customer WHERE delivery_challan_id = $1
         UNION ALL SELECT 'dispatch', id::text, "vehicleDispatchNo" FROM dispatch WHERE delivery_challan_id = $1`,
        [dc.id],
      );
      for (const c of children) await core.attachToTransaction(m, { txnNo: txn, docType: c.t, docId: c.id, docNo: c.no });
      console.log(`sale ${txn} for DC ${dc.no} with ${children.length} children`);
    }
    // Transfer.
    const tdc = (await m.query(
      `SELECT id::text AS id, "challanNo" AS no FROM delivery_challan_purchase WHERE type = 'stock-transfer-delivery-challan' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
    ))[0];
    if (tdc) opened.push(await core.openTransaction(m, { type: 'transfer', origin: { docType: 'dc-transfer', docId: tdc.id, docNo: tdc.no } }));

    if (process.argv.includes('--synthetic') && opened.length >= 2) {
      // Stock: Inward posts in (origin txn + ledger txn), the Customer DC consumes (link).
      const { postIn, reserveLines, consumeDocument } = require('../inventoryStock/batch/stockBatch.core');
      const iw = (await m.query(`SELECT id::text AS id FROM inward_register WHERE "inwardNo" = 'IWD-PROBE1'`))[0];
      const dcRow = (await m.query(`SELECT id::text AS id FROM delivery_challan_purchase WHERE "challanNo" = 'CN-PROBE1'`))[0];
      const ids = { companyId: '11111111-1111-1111-1111-111111111111', locationId: '22222222-2222-2222-2222-222222222222', productId: '33333333-3333-3333-3333-333333333333' };
      await postIn(m, { ...ids, variantId: null, uomId: null, batchNo: 'PROBE-B1', stockType: 'FRESH', qty: 10, kg: 50, value: 1000, originType: 'GRN', movementType: 'INWARD_PURCHASE', doc: { type: 'inward-register', id: iw.id, no: 'IWD-PROBE1' } });
      await reserveLines(m, { doc: { type: 'DC_TYPE_CUSTOMER', id: dcRow.id, no: 'CN-PROBE1' }, ...ids, stockType: 'FRESH', lines: [{ lineId: null, productId: ids.productId, variantId: null, uomId: null, qty: 4, kg: 20, label: 'probe' }] });
      await consumeDocument(m, { docType: 'DC_TYPE_CUSTOMER', docId: dcRow.id, docNo: 'CN-PROBE1', movementType: 'DC_CUSTOMER' });
      show('stock', {
        batch: await m.query(`SELECT batch_no, origin_txn_no, qty FROM stock_batch WHERE batch_no = 'PROBE-B1'`),
        ledger: await m.query(`SELECT movement_type, doc_no, txn_no FROM stock_ledger WHERE batch_no = 'PROBE-B1' ORDER BY posted_at, movement_type DESC`),
        links: await m.query(`SELECT from_txn, to_txn, kind, batch_no, qty, net_kg FROM transaction_links`),
      });
    }
    const list = await service.list({ page: 1, limit: 10, sort: 'txnNo:asc' });
    show(`list (${list.total})`, list.data);
    show('summary', await service.summary());
    for (const txn of opened) {
      const d = await service.detail(txn);
      show(`detail ${txn}`, { ...d, documents: d.documents.slice(0, 6) });
      show(`ledger ${txn}`, (await service.ledger(txn)).slice(0, 3));
    }
    if (grn) show(`search ${grn.no}`, await service.search(grn.no));
    if (opened[0]) show(`search ${opened[0]}`, await service.search(opened[0]));
    // Refresh by document type of the approval engines.
    if (grn) await core.refreshTransactionOf(m, 'grn', grn.id);
    await core.refreshTransactionOf(m, 'not-a-type', '00000000-0000-0000-0000-000000000000');
    console.log('\nrefreshTransactionOf ok; filter with type=sale:', (await service.list({ page: 1, limit: 5, types: ['sale'], search: 'S' })).total);
  } finally {
    await qr.rollbackTransaction();
    await qr.release();
    await ds.destroy();
    console.log('\nrolled back');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('probe failed:', e?.stack ?? e); process.exit(1); });
