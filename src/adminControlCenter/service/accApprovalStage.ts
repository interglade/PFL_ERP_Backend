import { DataSource } from 'typeorm';
import { tsText } from './accShared.util';

/**
 * Works out where an in-flight document sits in its approval flow and whose
 * action it is waiting on. Nothing stores this, so it is derived from
 * documents.status, the documents_approve_by_whom slots and the creator's
 * approval flow - mirroring the rules in DocumentbService,
 * DocDoubleApproverService and DocSingalApproverService.
 */

// ─── Document types ──────────────────────────────────────────────────────────

export interface DocTypeDef {
  type: string; // documents.type
  label: string; // label shown on the dashboard
  department: 'Procurement' | 'Operation' | 'Sales';
  table: string | null; // module table holding the document number
  noCol: string | null;
  creatorCol: string | null;
}

/** Every document type on the pipeline, in the order the spec lists them. */
export const DOC_TYPES: DocTypeDef[] = [
  { type: 'rfpa', label: 'RFPA', department: 'Procurement', table: 'rfpa', noCol: '"rfpaId"', creatorCol: 'created_by' },
  { type: 'deal-slip', label: 'Deal Slip', department: 'Procurement', table: 'deal_slips', noCol: '"dealSlipNo"', creatorCol: 'created_by' },
  { type: 'grn', label: 'GRN', department: 'Procurement', table: 'grns', noCol: '"grnNo"', creatorCol: 'createdby_id' },
  { type: 'multi-cash-voucher', label: 'Multicash Voucher', department: 'Procurement', table: 'multiple_cash_voucher', noCol: '"voucherNo"', creatorCol: 'requested_by_employee_id' },
  { type: 'labor-payment-voucher', label: 'Labor Payment Voucher', department: 'Procurement', table: 'labour_payment_voucher', noCol: '"voucherNo"', creatorCol: 'requested_by_employee_id' },
  { type: 'transport-payment-voucher', label: 'Transport Payment Voucher', department: 'Procurement', table: 'transport_payment_voucher', noCol: '"voucherNo"', creatorCol: 'requested_by_employee_id' },
  { type: 'packaging-material-voucher', label: 'Packing Material Voucher', department: 'Procurement', table: 'packing_material_payment', noCol: '"voucherNo"', creatorCol: 'requested_by_employee_id' },
  { type: 'aqr', label: 'AQR', department: 'Operation', table: 'aqr', noCol: '"aqrNo"', creatorCol: null },
  { type: 'inward-register', label: 'Inward Register', department: 'Operation', table: 'inward_register', noCol: '"inwardNo"', creatorCol: null },
  { type: 'dump-register', label: 'Dump Register', department: 'Operation', table: 'dump_register', noCol: '"dumpNo"', creatorCol: 'requested_by_employee_id' },
  { type: 'return-to-vendor', label: 'RTV', department: 'Operation', table: 'return_to_vendor', noCol: '"rtvNo"', creatorCol: '"createdBy_id"' },
  { type: 'return-by-customer', label: 'RBC', department: 'Operation', table: 'return_by_customer', noCol: '"rbcNo"', creatorCol: 'createdby_id' },
  { type: 'DC_TYPE_STOCK_TRANSFER', label: 'DC for Stock Transfer', department: 'Operation', table: 'delivery_challan_purchase', noCol: '"challanNo"', creatorCol: 'created_by' },
  { type: 'vehicle-dispatch-register', label: 'Vehicle Dispatch Register', department: 'Operation', table: 'dispatch', noCol: '"vehicleDispatchNo"', creatorCol: null },
  { type: 'DC_TYPE_CUSTOMER', label: 'DC for Customer', department: 'Sales', table: 'delivery_challan_purchase', noCol: '"challanNo"', creatorCol: 'created_by' },
  { type: 'final-invoice', label: 'Final Invoice', department: 'Sales', table: 'invoices', noCol: '"invoiceNo"', creatorCol: 'created_by' },
  { type: 'second-sale', label: 'Second Sales Register', department: 'Sales', table: 'second_sale_document', noCol: '"secondSaleNo"', creatorCol: null },
  { type: 'DC_TYPE_OTHER', label: 'DC for Other', department: 'Sales', table: 'delivery_challan_purchase', noCol: '"challanNo"', creatorCol: 'created_by' },
];

export const DOC_TYPE_BY_KEY = new Map(DOC_TYPES.map((d) => [d.type, d]));

/** Label for a documents.type, including types that are not on the pipeline. */
export function docLabel(type: string): string {
  return DOC_TYPE_BY_KEY.get(type)?.label ?? type;
}

const VERIFIER_TYPES = new Set([
  'grn',
  'multi-cash-voucher',
  'labor-payment-voucher',
  'transport-payment-voucher',
  'packaging-material-voucher',
]);

const SINGLE_APPROVER_TYPES = new Set([
  'rfpa',
  'deal-slip',
  'aqr',
  'inward-register',
  'vehicle-dispatch-register',
]);

export const FINISHED_STATUSES = ['COMPLETE', 'REJECT', 'disapproved'];

/** The document's own overallStatus, as the admin reads it. */
export function statusLabel(status: string): string {
  switch (status) {
    case 'hold':
      return 'Hold';
    case 'VERIFIED':
      return 'Verified';
    case 'approved':
      return 'Approved';
    case 'FINALIZING':
    case 'FINALIZED':
      return 'Finalized';
    case 'query':
      return 'Query';
    case 'COMPLETE':
      return 'Complete';
    case 'REJECT':
    case 'disapproved':
      return 'Rejected';
    default:
      return status;
  }
}

// ─── Stage derivation (pure) ─────────────────────────────────────────────────

export interface ApproverBlockDef {
  min: number | null;
  max: number | null;
  users: string[];
}

export interface FlowDef {
  verifiers: string[];
  blocks: [ApproverBlockDef | null, ApproverBlockDef | null, ApproverBlockDef | null];
  firstFinalizers: string[];
  secondFinalizers: string[];
}

export interface DocState {
  type: string;
  status: string;
  totalAmt: number;
  verified: boolean;
  a1: boolean;
  a2: boolean;
  a3: boolean;
}

export interface StageResult {
  stage: string; // Verification, Approval L1..L3, Finalization 1/2
  waitingOn: string[]; // user ids who can act now
}

function inRange(block: ApproverBlockDef | null, amount: number): boolean {
  if (!block || block.users.length === 0) return false;
  const min = block.min === null ? 0 : Number(block.min);
  const max = block.max === null ? Infinity : Number(block.max);
  return amount >= min && amount <= max;
}

/**
 * How many approver levels a verifier-type document (GRN, vouchers) needs.
 * Same precedence as DocumentbService: the first block whose amount band
 * covers the total decides - block 1 → 1 approval, 2 → 2, 3 → 3.
 */
export function requiredApprovals(flow: FlowDef | null, amount: number): number {
  if (!flow) return 1;
  if (inRange(flow.blocks[0], amount)) return 1;
  if (inRange(flow.blocks[1], amount)) return 2;
  if (inRange(flow.blocks[2], amount)) return 3;
  return 1;
}

export function deriveStage(doc: DocState, flow: FlowDef | null): StageResult {
  const blockUsers = (i: number) => flow?.blocks[i]?.users ?? [];

  if (VERIFIER_TYPES.has(doc.type)) {
    if (doc.status === 'approved') {
      return { stage: 'Finalization 1', waitingOn: flow?.firstFinalizers ?? [] };
    }
    if (doc.status === 'FINALIZING' || doc.status === 'FINALIZED') {
      return { stage: 'Finalization 2', waitingOn: flow?.secondFinalizers ?? [] };
    }
    if (!doc.verified) {
      return { stage: 'Verification', waitingOn: flow?.verifiers ?? [] };
    }
    const needed = requiredApprovals(flow, doc.totalAmt);
    const done = [doc.a1, doc.a2, doc.a3];
    for (let i = 0; i < needed; i++) {
      if (!done[i]) return { stage: `Approval L${i + 1}`, waitingOn: blockUsers(i) };
    }
    // Every required approver acted but the status has not moved on yet.
    return { stage: 'Finalization 1', waitingOn: flow?.firstFinalizers ?? [] };
  }

  if (SINGLE_APPROVER_TYPES.has(doc.type)) {
    return { stage: 'Approval L1', waitingOn: blockUsers(0) };
  }

  // Double-approver documents: L1 and L2 may act in either order.
  if (!doc.a1) return { stage: 'Approval L1', waitingOn: blockUsers(0) };
  return { stage: 'Approval L2', waitingOn: blockUsers(1) };
}

// ─── Loading (a fixed number of queries, never one per document) ────────────

export interface InFlightDoc extends DocState, StageResult {
  id: string; // documents.id
  moduleId: string | null; // GRN id, invoice id, ...
  docNo: string;
  creatorId: string | null;
  createdAt: string; // IST text 'YYYY-MM-DDTHH:mm:ss'
  pendingDays: number;
}

export async function loadInFlightDocuments(ds: DataSource): Promise<InFlightDoc[]> {
  const rows: any[] = await ds.query(
    `SELECT d.id, d.type::text AS type, d.status::text AS status, COALESCE(d."totalAmt", 0) AS "totalAmt",
            d.document_type_id AS "moduleId", d.approval_flow_id AS "flowId", d.last_action_by AS "lastActionBy",
            ${tsText('d."createdAt"')} AS "createdAt",
            FLOOR(EXTRACT(EPOCH FROM (LOCALTIMESTAMP - d."createdAt")) / 86400)::int AS "pendingDays",
            (w.verified_id IS NOT NULL) AS verified,
            (a1.status::text = 'approved') AS a1,
            (a2.status::text = 'approved') AS a2,
            (a3.status::text = 'approved') AS a3
       FROM documents d
       LEFT JOIN documents_approve_by_whom w ON w.id = d.approval_info_id
       LEFT JOIN approval_stage_info a1 ON a1.id = w.first_approved_id
       LEFT JOIN approval_stage_info a2 ON a2.id = w.second_approved_id
       LEFT JOIN approval_stage_info a3 ON a3.id = w.third_approved_id
      WHERE d."isDeleted" = false
        AND d.status::text <> ALL($1)`,
    [FINISHED_STATUSES],
  );

  const flows = await loadFlows(ds, rows.map((r) => r.flowId).filter(Boolean));
  const refs = await resolveDocRefs(
    ds,
    rows.filter((r) => r.moduleId).map((r) => ({ type: r.type, id: r.moduleId })),
  );

  return rows.map((r) => {
    const state: DocState = {
      type: r.type,
      status: r.status,
      totalAmt: Number(r.totalAmt) || 0,
      verified: !!r.verified,
      a1: !!r.a1,
      a2: !!r.a2,
      a3: !!r.a3,
    };
    const ref = refs.get(refKey(r.type, r.moduleId));
    return {
      ...state,
      ...deriveStage(state, r.flowId ? flows.get(r.flowId) ?? null : null),
      id: r.id,
      moduleId: r.moduleId,
      docNo: ref?.docNo || '',
      creatorId: ref?.creatorId || r.lastActionBy || null,
      createdAt: r.createdAt,
      pendingDays: Math.max(0, Number(r.pendingDays) || 0),
    };
  });
}

/** Loads approval flows with all their participants in five queries. */
export async function loadFlows(ds: DataSource, flowIds: string[]): Promise<Map<string, FlowDef>> {
  const ids = Array.from(new Set(flowIds));
  const result = new Map<string, FlowDef>();
  if (ids.length === 0) return result;

  const [flows, verifiers] = await Promise.all([
    ds.query(
      `SELECT f.id, f.finalizer_block_id AS "finalizerBlockId",
              l.first_approver_block_id AS b1, l.second_approver_block_id AS b2, l.third_approver_block_id AS b3
         FROM approval_flows f
         LEFT JOIN approval_levels l ON l.id = f.approval_level_id
        WHERE f.id = ANY($1)`,
      [ids],
    ),
    ds.query(
      `SELECT approval_flow_id AS "flowId", user_id AS "userId" FROM approval_flow_verifiers WHERE approval_flow_id = ANY($1)`,
      [ids],
    ),
  ]);

  const blockIds = flows.flatMap((f: any) => [f.b1, f.b2, f.b3]).filter(Boolean);
  const finalizerIds = flows.map((f: any) => f.finalizerBlockId).filter(Boolean);

  const [blocks, fin1, fin2] = await Promise.all([
    blockIds.length
      ? ds.query(
          `SELECT b.id, b."minAmtCanApprove" AS min, b."maxAmtCanApprove" AS max,
                  COALESCE(array_agg(u.user_id) FILTER (WHERE u.user_id IS NOT NULL), '{}') AS users
             FROM approver_blocks b
             LEFT JOIN approver_block_users u ON u.block_id = b.id
            WHERE b.id = ANY($1)
            GROUP BY b.id`,
          [blockIds],
        )
      : [],
    finalizerIds.length
      ? ds.query(
          `SELECT finalizer_block_id AS "blockId", user_id AS "userId" FROM finalizer_block_first_finalizers WHERE finalizer_block_id = ANY($1)`,
          [finalizerIds],
        )
      : [],
    finalizerIds.length
      ? ds.query(
          `SELECT finalizer_block_id AS "blockId", user_id AS "userId" FROM finalizer_block_second_finalizers WHERE finalizer_block_id = ANY($1)`,
          [finalizerIds],
        )
      : [],
  ]);

  const blockMap = new Map<string, ApproverBlockDef>(
    blocks.map((b: any) => [
      b.id,
      {
        min: b.min === null ? null : Number(b.min),
        max: b.max === null ? null : Number(b.max),
        users: b.users || [],
      },
    ]),
  );
  const group = (list: any[], key: string) => {
    const m = new Map<string, string[]>();
    for (const row of list) {
      if (!m.has(row[key])) m.set(row[key], []);
      m.get(row[key])!.push(row.userId);
    }
    return m;
  };
  const verifierMap = group(verifiers, 'flowId');
  const fin1Map = group(fin1, 'blockId');
  const fin2Map = group(fin2, 'blockId');

  for (const f of flows) {
    result.set(f.id, {
      verifiers: verifierMap.get(f.id) ?? [],
      blocks: [
        f.b1 ? blockMap.get(f.b1) ?? null : null,
        f.b2 ? blockMap.get(f.b2) ?? null : null,
        f.b3 ? blockMap.get(f.b3) ?? null : null,
      ],
      firstFinalizers: fin1Map.get(f.finalizerBlockId) ?? [],
      secondFinalizers: fin2Map.get(f.finalizerBlockId) ?? [],
    });
  }
  return result;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function refKey(type: string, id: string | null): string {
  return `${type}:${id}`;
}

/**
 * Document number and creator for (type, module id) pairs: one query per
 * document type present, never one per document.
 */
export async function resolveDocRefs(
  ds: DataSource,
  pairs: { type: string; id: string }[],
): Promise<Map<string, { docNo: string; creatorId: string | null }>> {
  const byType = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!p.id || !UUID_RE.test(p.id) || !DOC_TYPE_BY_KEY.get(p.type)?.table) continue;
    if (!byType.has(p.type)) byType.set(p.type, new Set());
    byType.get(p.type)!.add(p.id);
  }

  const result = new Map<string, { docNo: string; creatorId: string | null }>();
  await Promise.all(
    Array.from(byType.entries()).map(async ([type, idSet]) => {
      const def = DOC_TYPE_BY_KEY.get(type)!;
      const rows: any[] = await ds.query(
        `SELECT id::text AS id, ${def.noCol}::text AS "docNo", ${def.creatorCol ? `${def.creatorCol}::text` : 'NULL'} AS "creatorId"
           FROM ${def.table}
          WHERE id = ANY($1::uuid[])`,
        [Array.from(idSet)],
      );
      for (const r of rows) {
        result.set(refKey(type, r.id), { docNo: r.docNo || '', creatorId: r.creatorId || null });
      }
    }),
  );
  return result;
}
