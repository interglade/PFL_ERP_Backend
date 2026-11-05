/**
 * Steps, stage, status and summary of a transaction
 * (docs/transaction-tracking-plan.md §3, §9.3).
 *
 * `deriveStage` is pure: it works from `StageFacts`, which `loadStageFacts`
 * reads from what already exists (document approvals, ReceivingStatusService,
 * dispatch status, delivery confirmation, GRN / invoice payment status).
 * Nothing is duplicated: each fact comes from the service that owns it.
 */

import { EntityManager } from 'typeorm';
import { DocumentStatus } from '../approvalFlow/entity/docuemnt.entity';
import { ReceivingStatusService } from '../receiving/service/receivingStatus.service';
import { ReceivingSourceType, ReceivingState } from '../receiving/receiving.types';
import { DispatchType } from '../vehicleDispatch/entity/vehicleDispatch.entity';
import { directSaleDcSql, sourceDispatchStatuses, SourceDispatchStatus } from '../vehicleDispatch/service/dispatchRules';
import { activeConfirmation } from '../deliveryChallans/customerDeliveryChllan/service/dcDelivery';
import { Item } from '../deliveryChallans/deliverychllan/entity/dItem.entity';
import { GrnDeliveryMode } from '../grn/entity/grn.entity';
import { GrnPaymentStatus } from '../utils/status.enum';
import { DocFact, fkColumn, isLiveDoc, loadTransactionDocFacts } from './transaction.docs';
import { TxnDocType, TxnStatus, TxnStep, TxnStepDoc, TxnStepState, TxnSummary, TxnType } from './transaction.types';

// ─── Labels ───────────────────────────────────────────────────────────────────

/** Title of each step on the step bar. */
export const STEP_TITLE: Record<string, string> = {
  rfpa: 'RFPA',
  'deal-slip': 'Deal Slip',
  grn: 'GRN',
  dispatch: 'Dispatch',
  receiving: 'Receiving',
  'delivered-to-customer': 'Delivered to customer',
  payment: 'Payment',
  'transfer-dc': 'Transfer DC',
  'customer-dc': 'Customer DC',
  return: 'Return (RBC)',
  delivery: 'Delivery confirmed',
  invoice: 'Final Invoice',
  'return-receiving': 'Return received',
  'other-dc': 'Other DC',
  'second-sale': 'Second Sale',
};

/** "Current step" wording shown to users (§9.3). */
const STAGE_LABEL: Record<string, string> = {
  rfpa: 'Waiting for RFPA approval',
  'deal-slip': 'Deal slip pending',
  grn: 'Waiting for GRN approval',
  dispatch: 'Vehicle dispatch pending',
  receiving: 'At the CC/DC – receiving',
  'delivered-to-customer': 'Delivered to customer pending',
  payment: 'Waiting for payment',
  'transfer-dc': 'Transfer DC pending',
  'customer-dc': 'Customer DC pending',
  return: 'Waiting for return (RBC) approval',
  delivery: 'Delivery confirmation pending',
  invoice: 'Final invoice pending',
  'other-dc': 'Other DC pending',
  'second-sale': 'Second sale pending',
};
export const IN_TRANSIT_LABEL = 'In transit';
export const DONE_STAGE = 'done';
export const DONE_LABEL = 'Done';
export const CANCELLED_STAGE = 'cancelled';
export const CANCELLED_LABEL = 'Cancelled';

/** Stage keys in order per type (side steps excluded), for filters and the dashboard. */
export const STAGE_KEYS: Record<TxnType, string[]> = {
  purchase: ['rfpa', 'deal-slip', 'grn', 'dispatch', 'receiving', 'delivered-to-customer', 'payment'],
  transfer: ['transfer-dc', 'dispatch', 'receiving'],
  sale: ['customer-dc', 'dispatch', 'return', 'delivery', 'invoice', 'payment'],
  'other-sale': ['other-dc'],
  'second-sale': ['second-sale'],
};

// ─── Pure derivation ──────────────────────────────────────────────────────────

export interface StageFacts {
  type: TxnType;
  originDocType: TxnDocType;
  /** Approval status of the origin document (newest `documents` row). */
  originStatus: string | null;
  originDeleted: boolean;
  docs: DocFact[];
  /** Purchase: the GRN goes straight to a customer (no receiving). */
  directToCustomer?: boolean;
  /** Purchase / transfer: ReceivingStatusService state of the GRN / Transfer DC. */
  receivingState?: ReceivingState | null;
  /** Vehicle dispatch of the GRN / Transfer DC / Customer DC (sourceDispatchStatuses). */
  dispatchStatus?: SourceDispatchStatus | null;
  /** Purchase: grns.ammountStatus = paid. */
  grnPaid?: boolean;
  /** Purchase, direct to customer: the Customer DC raised from the GRN has a confirmed delivery. */
  deliveredToCustomer?: boolean;
  /** Sale: the Customer DC was raised from a direct-to-customer GRN (no sales dispatch). */
  directSale?: boolean;
  /** Sale: active delivery confirmation. */
  deliveryConfirmed?: boolean;
  /** Sale: invoices.ammountStatus = paid (live invoice). */
  invoicePaid?: boolean;
  /** Sale: receiving state of the approved RBC (side step). */
  returnReceivingState?: ReceivingState | null;
}

export interface StageResult {
  steps: TxnStep[];
  stage: string;
  stageLabel: string;
  status: TxnStatus;
}

/** Raw state of a step before the "first open step is current" pass. */
type RawState = 'done' | 'open' | 'none' | 'rejected' | 'skipped';

/** State of a step from its documents: a live COMPLETE document → done, live other → open, only rejected → rejected. */
export function docStepState(docs: DocFact[]): RawState {
  const present = docs.filter((d) => !d.deleted);
  const live = present.filter(isLiveDoc);
  if (live.some((d) => d.status === DocumentStatus.COMPLETE)) return 'done';
  if (live.length) return 'open';
  if (present.some((d) => d.status === DocumentStatus.REJECT)) return 'rejected';
  return 'none';
}

function dispatchStepState(status: SourceDispatchStatus | null | undefined, docs: DocFact[], sourceExists: boolean): RawState {
  if (!sourceExists) return 'none';
  switch (status) {
    case 'Approved':
      return 'done';
    case 'Not Required':
      return 'skipped';
    case 'Pending':
      return 'open';
    default: {
      const fromDocs = docStepState(docs);
      return fromDocs === 'rejected' ? 'rejected' : fromDocs === 'done' ? 'done' : 'none';
    }
  }
}

function receivingStepState(state: ReceivingState | null | undefined): RawState {
  if (state === 'Done') return 'done';
  if (state === 'In Progress' || state === 'Received' || state === 'In Transit') return 'open';
  return 'none';
}

interface PlannedStep {
  key: string;
  raw: RawState;
  side?: boolean;
}

/** Steps, stage, status from the facts (§9.3). */
export function deriveStage(facts: StageFacts): StageResult {
  const docsOf = (step: string) => facts.docs.filter((d) => d.step === step);
  const planned: PlannedStep[] = [];
  let closed = false;

  switch (facts.type) {
    case 'purchase': {
      if (facts.originDocType === 'rfpa') {
        planned.push({ key: 'rfpa', raw: docStepState(docsOf('rfpa')) });
        planned.push({ key: 'deal-slip', raw: docStepState(docsOf('deal-slip')) });
      }
      const grnState = docStepState(docsOf('grn'));
      planned.push({ key: 'grn', raw: grnState });
      const grnExists = docsOf('grn').some(isLiveDoc);
      planned.push({ key: 'dispatch', raw: dispatchStepState(facts.dispatchStatus, docsOf('dispatch'), grnExists) });
      const arrived = facts.directToCustomer ? Boolean(facts.deliveredToCustomer) : facts.receivingState === 'Done';
      if (facts.directToCustomer) {
        planned.push({ key: 'delivered-to-customer', raw: facts.deliveredToCustomer ? 'done' : 'none' });
      } else {
        planned.push({ key: 'receiving', raw: receivingStepState(facts.receivingState) });
      }
      planned.push({ key: 'payment', raw: grnExists && facts.grnPaid ? 'done' : 'none' });
      closed = grnState === 'done' && arrived && Boolean(facts.grnPaid);
      break;
    }
    case 'transfer': {
      const dcState = docStepState(docsOf('transfer-dc'));
      planned.push({ key: 'transfer-dc', raw: dcState });
      planned.push({ key: 'dispatch', raw: dispatchStepState(facts.dispatchStatus, docsOf('dispatch'), true) });
      planned.push({ key: 'receiving', raw: receivingStepState(facts.receivingState) });
      closed = dcState === 'done' && facts.receivingState === 'Done';
      break;
    }
    case 'sale': {
      planned.push({ key: 'customer-dc', raw: docStepState(docsOf('customer-dc')) });
      planned.push({ key: 'dispatch', raw: facts.directSale ? 'skipped' : dispatchStepState(facts.dispatchStatus, docsOf('dispatch'), true) });
      const returnDocs = docsOf('return').filter((d) => !d.deleted);
      let returnState: RawState | null = null;
      if (returnDocs.length) {
        returnState = docStepState(returnDocs);
        // A rejected RBC no longer holds the delivery: once delivered without it, the step is not needed.
        if (returnState === 'rejected' && facts.deliveryConfirmed) returnState = 'skipped';
        planned.push({ key: 'return', raw: returnState });
      }
      planned.push({ key: 'delivery', raw: facts.deliveryConfirmed ? 'done' : 'none' });
      const invoiceState = docStepState(docsOf('invoice'));
      planned.push({ key: 'invoice', raw: invoiceState });
      planned.push({ key: 'payment', raw: invoiceState === 'done' && facts.invoicePaid ? 'done' : 'none' });
      if (returnState === 'done') {
        planned.push({ key: 'return-receiving', raw: receivingStepState(facts.returnReceivingState), side: true });
      }
      // The return's AQR / Inward / Dump never keep the Sale open (client decision 9).
      closed = invoiceState === 'done' && Boolean(facts.invoicePaid);
      break;
    }
    case 'other-sale': {
      const state = docStepState(docsOf('other-dc'));
      planned.push({ key: 'other-dc', raw: state });
      closed = state === 'done';
      break;
    }
    case 'second-sale': {
      const state = docStepState(docsOf('second-sale'));
      planned.push({ key: 'second-sale', raw: state });
      closed = state === 'done';
      break;
    }
  }

  // First main step not done / skipped is current (or stays rejected); the later ones are pending.
  let current: PlannedStep | null = null;
  const steps: TxnStep[] = planned.map((p) => {
    let state: TxnStepState;
    if (p.side) {
      state = p.raw === 'done' ? 'Done' : p.raw === 'open' ? 'Current' : 'Pending';
    } else if (p.raw === 'done' || p.raw === 'skipped') {
      state = p.raw === 'done' ? 'Done' : 'Skipped';
    } else if (!current) {
      current = p;
      state = p.raw === 'rejected' ? 'Rejected' : 'Current';
    } else {
      state = p.raw === 'rejected' ? 'Rejected' : 'Pending';
    }
    return { key: p.key, label: STEP_TITLE[p.key] ?? p.key, state, ...(p.side ? { side: true } : {}), docs: docsOf(p.key).map(toStepDoc) };
  });

  const cancelled = facts.originDeleted || facts.originStatus === DocumentStatus.REJECT;
  if (cancelled) return { steps, stage: CANCELLED_STAGE, stageLabel: CANCELLED_LABEL, status: 'Cancelled' };
  if (closed) {
    // Closed: nothing left is current any more (e.g. an optional step after the close rule).
    return { steps: steps.map((s) => (s.state === 'Current' && !s.side ? { ...s, state: 'Pending' as TxnStepState } : s)), stage: DONE_STAGE, stageLabel: DONE_LABEL, status: 'Closed' };
  }
  const cur = current as PlannedStep | null;
  if (!cur) return { steps, stage: DONE_STAGE, stageLabel: DONE_LABEL, status: 'Open' };
  return { steps, stage: cur.key, stageLabel: stageLabelOf(cur.key, cur.raw, facts), status: 'Open' };
}

export function stageLabelOf(key: string, raw: RawState | TxnStepState, facts: Pick<StageFacts, 'receivingState'>): string {
  if (raw === 'rejected' || raw === 'Rejected') return `${STEP_TITLE[key] ?? key} rejected`;
  if (key === 'receiving' && facts.receivingState === 'In Transit') return IN_TRANSIT_LABEL;
  return STAGE_LABEL[key] ?? key;
}

function toStepDoc(d: DocFact): TxnStepDoc {
  return { docType: d.docType, id: d.id, docNo: d.docNo, documentId: d.documentId, status: d.deleted ? 'Deleted' : d.status };
}

/** Whole days between `from` and `to` (never negative). */
export function daysBetween(from: Date | string | null | undefined, to: Date | string | null | undefined = new Date()): number {
  if (!from) return 0;
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

// ─── Facts from the database ──────────────────────────────────────────────────

const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** The live document of a step (newest), else the newest non-deleted one. */
export function pickDoc(docs: DocFact[], step: string): DocFact | null {
  const list = docs.filter((d) => d.step === step && !d.deleted);
  const live = list.filter(isLiveDoc);
  return (live.length ? live[live.length - 1] : list[list.length - 1]) ?? null;
}

async function receivingStateOf(manager: EntityManager, type: ReceivingSourceType, id: string): Promise<ReceivingState | null> {
  try {
    const status = await new ReceivingStatusService(manager.connection).getSourceStatus(type, id, manager);
    return status.state;
  } catch {
    // Deleted / direct-to-customer sources have no receiving status.
    return null;
  }
}

async function dispatchStatusOf(manager: EntityManager, type: DispatchType, sourceId: string): Promise<SourceDispatchStatus | null> {
  const statuses = await sourceDispatchStatuses(manager, type, [sourceId]);
  return statuses[sourceId]?.status ?? null;
}

async function paymentStatusOf(manager: EntityManager, table: 'grns' | 'invoices', id: string): Promise<string | null> {
  const rows: Array<{ status: string | null }> = await manager.query(
    `SELECT "ammountStatus"::text AS status FROM ${table} WHERE id = $1`,
    [id],
  );
  return rows[0]?.status ?? null;
}

export interface TxnHeader {
  txnNo: string;
  txnType: TxnType;
  originDocType: TxnDocType;
  originDocId: string;
}

/** Reads the facts `deriveStage` needs. */
export async function loadStageFacts(manager: EntityManager, txn: TxnHeader, docs: DocFact[]): Promise<StageFacts> {
  const origin = docs.find((d) => d.docType === txn.originDocType && d.id === txn.originDocId) ?? null;
  const facts: StageFacts = {
    type: txn.txnType,
    originDocType: txn.originDocType,
    originStatus: origin?.status ?? null,
    // An origin no longer in the transaction (a G-GRN moved to its Deal Slip's purchase) cancels it.
    originDeleted: origin ? origin.deleted : true,
    docs,
  };

  if (txn.txnType === 'purchase') {
    const grn = pickDoc(docs, 'grn');
    if (grn && isLiveDoc(grn)) {
      const rows: Array<{ mode: string | null }> = await manager.query(`SELECT "deliveryMode"::text AS mode FROM grns WHERE id = $1`, [grn.id]);
      facts.directToCustomer = rows[0]?.mode === GrnDeliveryMode.DIRECT_TO_CUSTOMER;
      facts.grnPaid = (await paymentStatusOf(manager, 'grns', grn.id)) === GrnPaymentStatus.PAID;
      facts.dispatchStatus = await dispatchStatusOf(manager, DispatchType.PURCHASE, grn.id);
      if (facts.directToCustomer) {
        const dcs: Array<{ id: string }> = await manager.query(
          `SELECT dc.id::text AS id FROM delivery_challan_purchase dc
            WHERE dc.grn_id = $1 AND dc.type = 'customer_delivery_challan' AND COALESCE(dc."isDeleted", false) = false AND dc."deletedAt" IS NULL`,
          [grn.id],
        );
        for (const dc of dcs) {
          if (await activeConfirmation(manager, dc.id)) {
            facts.deliveredToCustomer = true;
            break;
          }
        }
      } else if (grn.status === DocumentStatus.COMPLETE) {
        facts.receivingState = await receivingStateOf(manager, 'grn', grn.id);
      }
    }
  } else if (txn.txnType === 'transfer') {
    facts.dispatchStatus = await dispatchStatusOf(manager, DispatchType.STOCK_TRANSFER, txn.originDocId);
    if (origin?.status === DocumentStatus.COMPLETE && !origin.deleted) {
      facts.receivingState = await receivingStateOf(manager, 'stock-transfer-dc', txn.originDocId);
    }
  } else if (txn.txnType === 'sale') {
    const direct: Array<{ direct: boolean }> = await manager.query(`SELECT ${directSaleDcSql('$1::uuid')} AS direct`, [txn.originDocId]);
    facts.directSale = Boolean(direct[0]?.direct);
    if (!facts.directSale) facts.dispatchStatus = await dispatchStatusOf(manager, DispatchType.SALES, txn.originDocId);
    facts.deliveryConfirmed = Boolean(await activeConfirmation(manager, txn.originDocId));
    const invoice = pickDoc(docs, 'invoice');
    if (invoice && isLiveDoc(invoice)) {
      facts.invoicePaid = (await paymentStatusOf(manager, 'invoices', invoice.id)) === GrnPaymentStatus.PAID;
    }
    const rbc = pickDoc(docs, 'return');
    if (rbc && isLiveDoc(rbc) && rbc.status === DocumentStatus.COMPLETE) {
      facts.returnReceivingState = await receivingStateOf(manager, 'rbc', rbc.id);
    }
  }
  return facts;
}

/** Cached totals (§9.3): purchase from the GRN lines (RFPA lines before a GRN exists), the rest from the origin's lines. */
export async function computeSummary(manager: EntityManager, txn: TxnHeader, docs: DocFact[], daysOpen: number): Promise<TxnSummary> {
  type Totals = { products: string | null; qty: string | null; kg: string | null; value: string | null };
  let totals: Totals | undefined;
  if (txn.txnType === 'purchase') {
    const grn = pickDoc(docs, 'grn');
    if (grn) {
      const rows: Totals[] = await manager.query(
        `SELECT COUNT(DISTINCT gp.product_id) AS products, SUM(gp.quantity) AS qty, SUM(gp."netWeight") AS kg,
                COALESCE((SELECT g."totalAmt" FROM grns g WHERE g.id = $1), SUM(gp.amount)) AS value
           FROM grn_products gp WHERE gp.grn_id = $1 AND gp."deletedAt" IS NULL`,
        [grn.id],
      );
      totals = rows[0];
    } else {
      const rfpa = pickDoc(docs, 'rfpa');
      if (rfpa) {
        const rows: Totals[] = await manager.query(
          `SELECT COUNT(DISTINCT rp.product_id) AS products, SUM(rp.quantity) AS qty, 0 AS kg, SUM(rp.total_value) AS value
             FROM rfpa_product rp WHERE rp.rfpa_id = $1 AND rp."deletedAt" IS NULL`,
          [rfpa.id],
        );
        totals = rows[0];
      }
    }
  } else if (txn.txnType === 'second-sale') {
    const rows: Totals[] = await manager.query(
      `SELECT COUNT(DISTINCT sp.product_id) AS products, SUM(sp.quantity) AS qty, SUM(sp."netWeight") AS kg,
              COALESCE((SELECT s."totalAmt" FROM second_sale_document s WHERE s.id = $1), SUM(sp.amount)) AS value
         FROM second_sale_product sp WHERE sp.second_sale_register_id = $1 AND sp."deletedAt" IS NULL`,
      [txn.originDocId],
    );
    totals = rows[0];
  } else {
    const itemDc = fkColumn(manager, Item, 'deliveryChallan');
    const rows: Totals[] = await manager.query(
      `SELECT COUNT(DISTINCT it.product_id) AS products, SUM(it.quantity) AS qty, SUM(it."netWeight") AS kg,
              COALESCE((SELECT dc."totalProductAmount" FROM delivery_challan_purchase dc WHERE dc.id = $1), SUM(it.amount)) AS value
         FROM item it WHERE it.${itemDc} = $1 AND it."deletedAt" IS NULL`,
      [txn.originDocId],
    );
    totals = rows[0];
  }
  return {
    productCount: num(totals?.products),
    totalQty: round3(num(totals?.qty)),
    totalKg: round3(num(totals?.kg)),
    totalValue: round2(num(totals?.value)),
    daysOpen,
  };
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

export interface TxnEvaluation {
  txn: TxnHeader;
  openedAt: Date;
  docs: DocFact[];
  facts: StageFacts;
  result: StageResult;
  summary: TxnSummary;
  /** What `transactions` holds now (to tell whether the cache is stale). */
  cached: { status: string; stage: string; stageLabel: string };
}

/** Works out the current steps, stage, status and summary of a transaction (reads only); null when unknown. */
export async function evaluateTransaction(manager: EntityManager, txnNo: string): Promise<TxnEvaluation | null> {
  const rows: Array<{ txn_no: string; txn_type: TxnType; origin_doc_type: TxnDocType; origin_doc_id: string; opened_at: Date; status: string; stage: string; stage_label: string }> =
    await manager.query(
      `SELECT txn_no, txn_type, origin_doc_type, origin_doc_id::text AS origin_doc_id, opened_at, status, stage, stage_label
         FROM transactions WHERE txn_no = $1`,
      [txnNo],
    );
  const row = rows[0];
  if (!row) return null;
  const txn: TxnHeader = { txnNo: row.txn_no, txnType: row.txn_type, originDocType: row.origin_doc_type, originDocId: row.origin_doc_id };
  const docs = await loadTransactionDocFacts(manager, txnNo);
  const facts = await loadStageFacts(manager, txn, docs);
  const result = deriveStage(facts);
  const summary = await computeSummary(manager, txn, docs, daysBetween(row.opened_at));
  return { txn, openedAt: row.opened_at, docs, facts, result, summary, cached: { status: row.status, stage: row.stage, stageLabel: row.stage_label } };
}
