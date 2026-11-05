require('dotenv').config();
import 'reflect-metadata';

/**
 * DIAGNOSTIC — checks that every document of every transaction type is stamped
 * with the expected `txn_no` by the same open / attach helpers the services
 * call at create (docs/transaction-tracking-plan.md §9.4). Minimal synthetic
 * rows are inserted inside one DB transaction which is ROLLED BACK at the end,
 * so nothing is left behind (number serials included).
 *
 * Usage: npx ts-node --transpile-only src/scripts/probeTransactionWiring.ts
 */
async function main(): Promise<void> {
  require('../middleware/performance.middleware');
  require('../inversify.config');
  const { DataSource } = require('typeorm');
  const { AppDataSource } = require('../utils/data-source');
  const core = require('../transactions/transaction.core');
  const { stampGrnTransaction } = require('../grn/grnTransaction');
  const { assertDealSlipUsableForGrn } = require('../dealSlip/dealSlipGrnLink');
  const { attachToReceivingSource } = require('../receiving/receiving.transaction');
  const { attachToDcTransaction } = require('../deliveryChallans/customerDeliveryChllan/service/dcTransaction');
  const { SecondSale } = require('../secondSale/entity/secondSale.entity');

  const ds = new DataSource({ ...AppDataSource.options, synchronize: false, migrationsRun: false, dropSchema: false, cache: false });
  await ds.initialize();
  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  const m = qr.manager;
  const results: Array<{ check: string; ok: boolean; detail: string }> = [];
  const check = (name: string, ok: boolean, detail = '') => results.push({ check: name, ok, detail });
  const one = async (sql: string, params: unknown[] = []) => (await m.query(sql, params))[0];
  const ins = async (sql: string, params: unknown[] = []): Promise<string> => (await one(`${sql} RETURNING id::text AS id`, params)).id;
  const doc = (type: string, status: string, id: string) =>
    m.query(`INSERT INTO documents (type, status, document_type_id) VALUES ($1, $2, $3)`, [type, status, id]);
  const txnOf = async (table: string, id: string): Promise<string | null> => (await one(`SELECT txn_no FROM ${table} WHERE id = $1`, [id]))?.txn_no ?? null;
  const expectTxn = async (label: string, table: string, id: string, expected: string | null) => {
    const got = await txnOf(table, id);
    check(label, Boolean(expected) && got === expected, `got ${got}, expected ${expected}`);
  };

  try {
    // ── Purchase R: RFPA → Deal Slip → GRN → dispatch / AQR / Inward / Dump / RTV ──
    const rfpa = await ins(`INSERT INTO rfpa ("rfpaId", source) VALUES ('RFPA-WIRE1', 'vendor')`);
    await doc('rfpa', 'Complete', rfpa);
    const R = await core.openTransaction(m, { type: 'purchase', origin: { docType: 'rfpa', docId: rfpa, docNo: 'RFPA-WIRE1' }, partyType: 'vendor', partyName: 'Wire vendor' });
    check('RFPA opens an R purchase', /^R\d{11}$/.test(R), R);
    await expectTxn('RFPA header txn_no', 'rfpa', rfpa, R);

    const slip = await ins(
      `INSERT INTO deal_slips ("lotNo", "loadingLocation", "specialRequest", "dealSlipNo", rfpa_id) VALUES ('L1', 'X', 'none', 'DL-WIRE1', $1)`,
      [rfpa],
    );
    await doc('deal-slip', 'Complete', slip);
    // dealSlipAutoCreate: the RFPA's number, read from the RFPA row.
    await core.attachToTransaction(m, { txnNo: await txnOf('rfpa', rfpa), docType: 'deal-slip', docId: slip, docNo: 'DL-WIRE1' });
    await expectTxn('Deal Slip ← RFPA', 'deal_slips', slip, R);

    await assertDealSlipUsableForGrn(m, slip, null);
    const grn = await ins(`INSERT INTO grns ("grnNo", "batchNo", "totalAmt", deal_slip_id) VALUES ('GRN-WIRE1', 'WIRE-B1', 1000, $1)`, [slip]);
    await doc('grn', 'Complete', grn);
    await stampGrnTransaction(m, grn, { creating: true });
    await expectTxn('GRN with Deal Slip ← Deal Slip', 'grns', grn, R);

    // One Deal Slip = one GRN.
    let guard = 'no error';
    try {
      await assertDealSlipUsableForGrn(m, slip, null);
    } catch (e: any) {
      guard = `${e.statusCode ?? e.status} ${e.message}`;
    }
    check('Second GRN on the same Deal Slip refused (409)', guard === '409 Deal Slip DL-WIRE1 is already used by GRN GRN-WIRE1', guard);
    let self = 'no error';
    try {
      await assertDealSlipUsableForGrn(m, slip, grn);
    } catch (e: any) {
      self = e.message;
    }
    check('The GRN itself may keep its Deal Slip on update', self === 'no error', self);

    const pDispatch = await ins(`INSERT INTO dispatch ("vehicleDispatchNo", "dispatchType", grn_id) VALUES ('VD-WIRE1', 'purchase', $1)`, [grn]);
    await core.attachToTransaction(m, { txnNo: await core.txnNoOf(m, 'grn', grn), docType: 'dispatch', docId: pDispatch, docNo: 'VD-WIRE1' });
    await expectTxn('Purchase dispatch ← GRN', 'dispatch', pDispatch, R);

    const aqr = await ins(`INSERT INTO aqr ("aqrNo", grn_id) VALUES ('AQR-WIRE1', $1)`, [grn]);
    await attachToReceivingSource(m, { sourceType: 'grn', sourceId: grn, docType: 'aqr', docId: aqr, docNo: 'AQR-WIRE1' });
    await expectTxn('AQR ← GRN', 'aqr', aqr, R);
    const inward = await ins(`INSERT INTO inward_register ("inwardNo", grn_id) VALUES ('IWD-WIRE1', $1)`, [grn]);
    await attachToReceivingSource(m, { sourceType: 'grn', sourceId: grn, docType: 'inward', docId: inward, docNo: 'IWD-WIRE1' });
    await expectTxn('Inward ← GRN', 'inward_register', inward, R);
    const dump = await ins(`INSERT INTO dump_register ("dumpNo", grn_id) VALUES ('DMP-WIRE1', $1)`, [grn]);
    await attachToReceivingSource(m, { sourceType: 'grn', sourceId: grn, docType: 'dump', docId: dump, docNo: 'DMP-WIRE1' });
    await expectTxn('Dump ← GRN', 'dump_register', dump, R);
    const rtv = await ins(`INSERT INTO return_to_vendor ("rtvNo", grn_id) VALUES ('RTV-WIRE1', $1)`, [grn]);
    await attachToReceivingSource(m, { sourceType: 'grn', sourceId: grn, docType: 'rtv', docId: rtv, docNo: 'RTV-WIRE1' });
    await expectTxn('RTV ← GRN', 'return_to_vendor', rtv, R);
    const rDocs = await one(`SELECT COUNT(*)::int AS n FROM transaction_documents WHERE txn_no = $1`, [R]);
    check('R transaction lists 8 documents', rDocs.n === 8, `${rDocs.n}`);

    // ── Purchase G: GRN without a Deal Slip; then moved onto a Deal Slip ──
    const gGrn = await ins(`INSERT INTO grns ("grnNo", "batchNo", "totalAmt") VALUES ('GRN-WIRE2', 'WIRE-B2', 500)`);
    await doc('grn', 'Hold', gGrn);
    const G = await stampGrnTransaction(m, gGrn, { creating: true });
    check('GRN without Deal Slip opens a G purchase', /^G\d{11}$/.test(G ?? ''), String(G));
    await expectTxn('G GRN header txn_no', 'grns', gGrn, G);
    const gDispatch = await ins(`INSERT INTO dispatch ("vehicleDispatchNo", "dispatchType", grn_id) VALUES ('VD-WIRE2', 'purchase', $1)`, [gGrn]);
    await core.attachToTransaction(m, { txnNo: await core.txnNoOf(m, 'grn', gGrn), docType: 'dispatch', docId: gDispatch, docNo: 'VD-WIRE2' });
    await expectTxn('G dispatch ← GRN', 'dispatch', gDispatch, G);

    // Edit: the G GRN switches to a second R deal slip → re-attached, the G turns Cancelled.
    const rfpa2 = await ins(`INSERT INTO rfpa ("rfpaId", source) VALUES ('RFPA-WIRE2', 'vendor')`);
    const R2 = await core.openTransaction(m, { type: 'purchase', origin: { docType: 'rfpa', docId: rfpa2, docNo: 'RFPA-WIRE2' } });
    const slip2 = await ins(`INSERT INTO deal_slips ("lotNo", "loadingLocation", "specialRequest", "dealSlipNo", rfpa_id) VALUES ('L2', 'X', 'none', 'DL-WIRE2', $1)`, [rfpa2]);
    await doc('deal-slip', 'Complete', slip2);
    await core.attachToTransaction(m, { txnNo: R2, docType: 'deal-slip', docId: slip2, docNo: 'DL-WIRE2' });
    await assertDealSlipUsableForGrn(m, slip2, gGrn);
    await m.query(`UPDATE grns SET deal_slip_id = $2 WHERE id = $1`, [gGrn, slip2]);
    await stampGrnTransaction(m, gGrn, { creating: false });
    await expectTxn('GRN switching Deal Slip re-attaches', 'grns', gGrn, R2);
    const gState = await one(`SELECT status FROM transactions WHERE txn_no = $1`, [G]);
    check('Emptied G transaction is cancelled', gState?.status === 'Cancelled', gState?.status);

    // ── Transfer T: Transfer DC → dispatch → AQR / Inward at the To-location ──
    const tdc = await ins(`INSERT INTO delivery_challan_purchase ("challanNo", type, "stockTransferType") VALUES ('ST-WIRE1', 'stock-transfer-delivery-challan', 'cc-dc stock transfer')`);
    await doc('DC_TYPE_STOCK_TRANSFER', 'Complete', tdc);
    const T = await core.openTransaction(m, { type: 'transfer', origin: { docType: 'dc-transfer', docId: tdc, docNo: 'ST-WIRE1' }, partyType: 'branch' });
    check('Transfer DC opens a T transfer', /^T\d{11}$/.test(T), T);
    const tDispatch = await ins(`INSERT INTO dispatch ("vehicleDispatchNo", "dispatchType", delivery_challan_id) VALUES ('VD-WIRE3', 'stock-transfer', $1)`, [tdc]);
    await core.attachToTransaction(m, { txnNo: await core.txnNoOf(m, 'dc-transfer', tdc), docType: 'dispatch', docId: tDispatch, docNo: 'VD-WIRE3' });
    await expectTxn('Transfer dispatch ← Transfer DC', 'dispatch', tDispatch, T);
    const tAqr = await ins(`INSERT INTO aqr ("aqrNo", delivery_challan_id) VALUES ('AQR-WIRE2', $1)`, [tdc]);
    await attachToReceivingSource(m, { sourceType: 'stock-transfer-dc', sourceId: tdc, docType: 'aqr', docId: tAqr, docNo: 'AQR-WIRE2' });
    await expectTxn('AQR ← Transfer DC', 'aqr', tAqr, T);
    const tInward = await ins(`INSERT INTO inward_register ("inwardNo", delivery_challan_id) VALUES ('IWD-WIRE2', $1)`, [tdc]);
    await attachToReceivingSource(m, { sourceType: 'stock-transfer-dc', sourceId: tdc, docType: 'inward', docId: tInward, docNo: 'IWD-WIRE2' });
    await expectTxn('Inward ← Transfer DC', 'inward_register', tInward, T);

    // ── Sale S: Customer DC → dispatch → RBC (→ Inward) → Final Invoice ──
    const cdc = await ins(`INSERT INTO delivery_challan_purchase ("challanNo", type, "totalProductAmount") VALUES ('CN-WIRE1', 'customer_delivery_challan', 500)`);
    await doc('DC_TYPE_CUSTOMER', 'Complete', cdc);
    const S = await core.openTransaction(m, { type: 'sale', origin: { docType: 'dc-customer', docId: cdc, docNo: 'CN-WIRE1' }, partyType: 'customer' });
    check('Customer DC opens an S sale', /^S\d{11}$/.test(S), S);
    const sDispatch = await ins(`INSERT INTO dispatch ("vehicleDispatchNo", "dispatchType", delivery_challan_id) VALUES ('VD-WIRE4', 'sales', $1)`, [cdc]);
    await core.attachToTransaction(m, { txnNo: await core.txnNoOf(m, 'dc-customer', cdc), docType: 'dispatch', docId: sDispatch, docNo: 'VD-WIRE4' });
    await expectTxn('Sales dispatch ← Customer DC', 'dispatch', sDispatch, S);
    const rbc = await ins(`INSERT INTO return_by_customer ("rbcNo", delivery_challan_id) VALUES ('RBC-WIRE1', $1)`, [cdc]);
    await attachToDcTransaction(m, 'return-by-customer', rbc);
    await expectTxn('RBC ← Customer DC', 'return_by_customer', rbc, S);
    const rInward = await ins(`INSERT INTO inward_register ("inwardNo", rbc_id) VALUES ('IWD-WIRE3', $1)`, [rbc]);
    await attachToReceivingSource(m, { sourceType: 'rbc', sourceId: rbc, docType: 'inward', docId: rInward, docNo: 'IWD-WIRE3' });
    await expectTxn('Return Inward ← RBC', 'inward_register', rInward, S);
    const inv = await ins(`INSERT INTO invoices ("invoiceNo", delivery_challan_id, "totalAmount") VALUES ('INV-WIRE1', $1, 500)`, [cdc]);
    await attachToDcTransaction(m, 'final-invoice', inv);
    await expectTxn('Final Invoice ← Customer DC', 'invoices', inv, S);
    const sStep = await one(`SELECT step FROM transaction_documents WHERE doc_type = 'inward-register' AND doc_id = $1`, [rInward]);
    check('Return Inward sits on the return-receiving step', sStep?.step === 'return-receiving', sStep?.step);

    // ── Direct sale: Customer DC raised from the R GRN ──
    const ddc = await ins(`INSERT INTO delivery_challan_purchase ("challanNo", type, grn_id) VALUES ('CN-WIRE2', 'customer_delivery_challan', $1)`, [grn]);
    const SD = await core.openTransaction(m, { type: 'sale', origin: { docType: 'dc-customer', docId: ddc, docNo: 'CN-WIRE2' } });
    await core.linkDirectSale(m, ddc);
    const link = await one(`SELECT kind FROM transaction_links WHERE from_txn = $1 AND to_txn = $2`, [R, SD]);
    check('Direct-sale DC links the purchase to its sale', link?.kind === 'direct-sale', JSON.stringify(link));

    // ── Other Sale SO and Second Sale SS ──
    const odc = await ins(`INSERT INTO delivery_challan_purchase ("challanNo", type, other_customer_name) VALUES ('OD-WIRE1', 'other_delivery_challan', 'Walk-in')`);
    const SO = await core.openTransaction(m, { type: 'other-sale', origin: { docType: 'dc-other', docId: odc, docNo: 'OD-WIRE1' }, partyType: 'walk-in', partyName: 'Walk-in' });
    check('Other DC opens an SO other sale', /^SO\d{11}$/.test(SO), SO);
    await expectTxn('Other DC header txn_no', 'delivery_challan_purchase', odc, SO);
    const ss = await ins(`INSERT INTO second_sale_document ("saleDate", "secondSaleNo", "customerName") VALUES (CURRENT_DATE, 'SS-WIRE1', 'Buyer')`);
    const SS = await core.openTransaction(m, { type: 'second-sale', origin: { docType: 'second-sale', docId: ss, docNo: 'SS-WIRE1' }, partyType: 'walk-in', partyName: 'Buyer' });
    check('Second Sale opens an SS second sale', /^SS\d{11}$/.test(SS), SS);
    await expectTxn('Second Sale header txn_no', 'second_sale_document', ss, SS);

    // ── A request body cannot set txn_no through an entity save (column insert/update: false) ──
    const fake = m.getRepository(SecondSale).create({ saleDate: new Date(), secondSaleNo: 'SS-WIRE2', txnNo: 'SS99999999999' });
    const saved = await m.getRepository(SecondSale).save(fake);
    check('Entity insert ignores a body txnNo', (await txnOf('second_sale_document', saved.id)) === null, String(await txnOf('second_sale_document', saved.id)));
    await m.getRepository(SecondSale).update({ id: ss }, { txnNo: 'SS99999999999', remarks: 'x' } as any);
    await expectTxn('Entity update ignores a body txnNo', 'second_sale_document', ss, SS);

    // ── Delete → refresh cancels the transaction ──
    await m.query(`UPDATE second_sale_document SET "isDeleted" = true, "deletedAt" = now() WHERE id = $1`, [ss]);
    await core.refreshTransactionOf(m, 'second-sale', ss);
    const ssState = await one(`SELECT status FROM transactions WHERE txn_no = $1`, [SS]);
    check('Deleted origin + refresh → cancelled', ssState?.status === 'Cancelled', ssState?.status);

    const all = await m.query(`SELECT txn_no, txn_type, status, stage FROM transactions WHERE txn_no = ANY($1) ORDER BY txn_no`, [[R, G, R2, T, S, SD, SO, SS]]);
    console.log(JSON.stringify(all, null, 2));
  } finally {
    await qr.rollbackTransaction();
    await qr.release();
    await ds.destroy();
  }
  const shown = results;
  for (const r of shown) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.check}${r.ok ? '' : `  (${r.detail})`}`);
  const failed = shown.filter((r) => !r.ok).length;
  console.log(`\n${shown.length - failed}/${shown.length} passed; rolled back`);
  if (failed) process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error('probe failed:', e?.stack ?? e); process.exit(1); });
