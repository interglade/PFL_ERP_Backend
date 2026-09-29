import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { TYPES } from '../../types';
import { DocumentsTab } from '../adminControlCenter.types';
import {
  DOC_TYPES,
  DOC_TYPE_BY_KEY,
  InFlightDoc,
  loadInFlightDocuments,
  statusLabel,
} from './accApprovalStage';
import { loadPeople, pickFirst, roleForStage, toContact } from './accPeople';
import {
  completeDoc,
  dateTimeLabel,
  fromSqlText,
  isoIst,
  nowIst,
  sqlTs,
  tsText,
  unpaid,
} from './accShared.util';

const GRN_STAGES = [
  'Verification',
  'Approval L1',
  'Approval L2',
  'Approval L3',
  'Finalization 1',
  'Finalization 2',
];
const INVOICE_STAGES = ['Approval L1', 'Approval L2'];
const PENDING_CAP = 100;

interface PendingItem {
  id: string;
  docNo: string;
  docType: string;
  createdAt: string; // IST text, sortable
  creatorId: string | null;
  status: string;
  waitingOn: string[];
  actingAs: string;
  pendingDays: number;
}

/**
 * Documents & Registrations tab. Always computed live - the pending list
 * drives the admin's phone calls, so it must reflect the current state.
 */
@injectable()
export class AccDocumentsService {
  constructor(@inject(TYPES.DataSource) private readonly dataSource: DataSource) {}

  async getDocuments(): Promise<DocumentsTab & { generatedAt: string }> {
    const generatedAt = isoIst();
    const [pipeline, inFlight, unpaidCounts, registrations, pendingRegs, verifierIds] =
      await Promise.all([
        this.pipeline(),
        loadInFlightDocuments(this.dataSource),
        this.unpaidCounts(),
        this.registrations(),
        this.pendingRegistrations(),
        this.verifierIds(),
      ]);

    return {
      generatedAt,
      pipeline,
      grnStages: [
        ...stageCounts(inFlight, 'grn', GRN_STAGES),
        { stage: 'Unpaid', count: unpaidCounts.grn },
      ],
      invoiceStages: [
        ...stageCounts(inFlight, 'final-invoice', INVOICE_STAGES),
        { stage: 'Unpaid', count: unpaidCounts.invoice },
      ],
      registrations,
      pending: await this.pendingList(inFlight, pendingRegs, verifierIds),
    };
  }

  // ─── Pipeline ──────────────────────────────────────────────────────────────

  private async pipeline(): Promise<DocumentsTab['pipeline']> {
    const rows: any[] = await this.dataSource.query(
      `SELECT type::text AS type,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status::text = 'COMPLETE')::int AS approved,
              COUNT(*) FILTER (WHERE status::text IN ('REJECT', 'disapproved'))::int AS rejected
         FROM documents
        WHERE "isDeleted" = false
        GROUP BY type`,
    );
    const byType = new Map(rows.map((r) => [r.type, r]));

    return DOC_TYPES.map((def) => {
      const r = byType.get(def.type);
      const total = r?.total ?? 0;
      const approved = r?.approved ?? 0;
      const rejected = r?.rejected ?? 0;
      return {
        id: def.type,
        department: def.department,
        docType: def.label,
        total,
        inApproval: total - approved - rejected,
        approved,
        rejected,
      };
    });
  }

  private async unpaidCounts(): Promise<{ grn: number; invoice: number }> {
    const [row] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*) FROM grns g
           WHERE g."isDeleted" = false AND ${unpaid('g')} AND ${completeDoc('g', 'grn')})::int AS grn,
         (SELECT COUNT(*) FROM invoices i
           WHERE i."isDeleted" = false AND ${unpaid('i')} AND ${completeDoc('i', 'final-invoice')})::int AS invoice`,
    );
    return { grn: row?.grn ?? 0, invoice: row?.invoice ?? 0 };
  }

  // ─── Registrations ─────────────────────────────────────────────────────────

  private async registrations(): Promise<DocumentsTab['registrations']> {
    const monthStart = sqlTs(nowIst().startOf('month'));
    const counts = (type: string, table: string) => `
      SELECT '${type}' AS type,
             COUNT(*) FILTER (WHERE status::text IN ('approved', 'pending', 'notapproved'))::int AS total,
             COUNT(*) FILTER (WHERE status::text IN ('approved', 'pending', 'notapproved')
                                AND "createdAt" >= $1::timestamp)::int AS "thisMonth",
             COUNT(*) FILTER (WHERE status::text = 'approved')::int AS approved,
             COUNT(*) FILTER (WHERE status::text = 'pending')::int AS pending,
             COUNT(*) FILTER (WHERE status::text = 'notapproved')::int AS rejected
        FROM ${table}
       WHERE "isDeleted" = false`;

    const rows: any[] = await this.dataSource.query(
      `${counts('Farmer', 'farmer')} UNION ALL ${counts('Vendor', 'vendor')} UNION ALL ${counts('Customer', 'customers')}`,
      [monthStart],
    );
    const byType = new Map(rows.map((r) => [r.type, r]));
    return (['Farmer', 'Vendor', 'Customer'] as const).map((type) => {
      const r = byType.get(type);
      return {
        type,
        total: r?.total ?? 0,
        thisMonth: r?.thisMonth ?? 0,
        approved: r?.approved ?? 0,
        pending: r?.pending ?? 0,
        rejected: r?.rejected ?? 0,
      };
    });
  }

  private pendingRegistrations(): Promise<any[]> {
    const days = `FLOOR(EXTRACT(EPOCH FROM (LOCALTIMESTAMP - "createdAt")) / 86400)::int`;
    return this.dataSource.query(
      `SELECT 'Farmer Registration' AS "docType", id::text AS id,
              COALESCE(NULLIF("farmerCode", ''), concat_ws(' ', "farmerfName", "farmerlName")) AS "docNo",
              created_by::text AS "creatorId", ${tsText('"createdAt"')} AS "createdAt", ${days} AS "pendingDays"
         FROM farmer WHERE "isDeleted" = false AND status::text = 'pending'
       UNION ALL
       SELECT 'Vendor Registration', id::text, COALESCE(NULLIF(vendor_code, ''), company_name),
              created_by::text, ${tsText('"createdAt"')}, ${days}
         FROM vendor WHERE "isDeleted" = false AND status::text = 'pending'
       UNION ALL
       SELECT 'Customer Registration', id::text, COALESCE(NULLIF(customercode, ''), organisation_name),
              created_by::text, ${tsText('"createdAt"')}, ${days}
         FROM customers WHERE "isDeleted" = false AND status::text = 'pending'`,
    );
  }

  /** Registrations wait on anyone with the verifier role. */
  private async verifierIds(): Promise<string[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT id FROM employees WHERE "isDeleted" = false AND 'verifier' = ANY(roles::text[])`,
    );
    return rows.map((r) => r.id);
  }

  // ─── Call list ─────────────────────────────────────────────────────────────

  private async pendingList(
    inFlight: InFlightDoc[],
    pendingRegs: any[],
    verifierIds: string[],
  ): Promise<DocumentsTab['pending']> {
    const items: PendingItem[] = [
      ...inFlight
        .filter((d) => DOC_TYPE_BY_KEY.has(d.type))
        .map((d) => ({
          id: d.id,
          docNo: d.docNo,
          docType: DOC_TYPE_BY_KEY.get(d.type)!.label,
          createdAt: d.createdAt,
          creatorId: d.creatorId,
          status: statusLabel(d.status),
          waitingOn: d.waitingOn,
          actingAs: roleForStage(d.stage),
          pendingDays: d.pendingDays,
        })),
      ...pendingRegs.map((r) => ({
        id: r.id,
        docNo: r.docNo || '',
        docType: r.docType,
        createdAt: r.createdAt,
        creatorId: r.creatorId,
        status: 'Pending',
        waitingOn: verifierIds,
        actingAs: 'Verifier',
        pendingDays: Math.max(0, Number(r.pendingDays) || 0),
      })),
    ];

    // Oldest first, capped.
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const top = items.slice(0, PENDING_CAP);

    const people = await loadPeople(
      this.dataSource,
      top.flatMap((i) => [...i.waitingOn, i.creatorId || '']),
    );

    return top.map((i) => ({
      id: i.id,
      docNo: i.docNo,
      docType: i.docType,
      createdAt: dateTimeLabel(fromSqlText(i.createdAt)),
      creator: toContact(i.creatorId ? people.get(i.creatorId) : undefined),
      status: i.status,
      pendingWith: toContact(pickFirst(i.waitingOn, people), i.actingAs),
      pendingDays: i.pendingDays,
    }));
  }
}

function stageCounts(docs: InFlightDoc[], type: string, stages: string[]) {
  const counts = new Map(stages.map((s) => [s, 0]));
  for (const d of docs) {
    if (d.type === type && counts.has(d.stage)) counts.set(d.stage, counts.get(d.stage)! + 1);
  }
  return stages.map((stage) => ({ stage, count: counts.get(stage)! }));
}
