import { DataSource } from 'typeorm';
import AppError from '../../utils/appError';
import { DOC_TYPE_BY_KEY } from '../../adminControlCenter/service/accApprovalStage';
import { nowIst, num, Period, PERIODS, periodRange, round2, sqlTs } from '../../adminControlCenter/service/accShared.util';
import { MyDocumentStatusRow, RegistrationSummary, WorkflowDepartment } from '../myDashboard.types';

/**
 * Shared pieces of the standard user dashboard. The creator of every document
 * is documents.last_action_by: it is set when the document is created and the
 * approval engines never change it (approvalGuards.assertNotCreator).
 */

/** workflow_hierarchy.department values. */
export const WORKFLOW_DEPARTMENT: Record<WorkflowDepartment, string> = {
  procurement: 'procurement',
  sales: 'sale',
};

/** documents.type -> the frontend permission key (document_definitions.uniqueKey). */
const DOC_KEY: Record<string, string> = {
  DC_TYPE_CUSTOMER: 'deliveryChallan-Customer',
  DC_TYPE_STOCK_TRANSFER: 'deliveryChallan-Stock-Transfer',
  DC_TYPE_OTHER: 'deliveryChallan-Other',
};

/** dispatch."dispatchType" -> permission key of that dispatch register. */
const DISPATCH_KEY: Record<string, string> = {
  purchase: 'vehicle-dispatch-purchase',
  'stock-transfer': 'vehicle-dispatch-transfer',
  sales: 'vehicle-dispatch-sales',
};

export function docKeyOf(type: string): string {
  return DOC_KEY[type] ?? type;
}

export function parsePeriod(value: any): Period {
  const period = (value || 'this-month') as Period;
  if (!PERIODS.includes(period)) {
    throw new AppError(400, `Invalid period. Use one of: ${PERIODS.join(', ')}`);
  }
  return period;
}

/** [start, end) of a period as IST SQL timestamps. */
export function periodBounds(period: Period): [string, string] {
  const range = periodRange(period, nowIst());
  return [sqlTs(range.start), sqlTs(range.end)];
}

/** Current work location plus access locations (access_location_id has its column names swapped). */
export async function userLocationIds(ds: DataSource, userId: string): Promise<string[]> {
  const rows: any[] = await ds.query(
    `SELECT "currentLocation_id"::text AS id FROM employees WHERE id = $1 AND "currentLocation_id" IS NOT NULL
     UNION
     SELECT user_id::text FROM access_location_id WHERE accesslocation_id = $1 AND user_id IS NOT NULL`,
    [userId],
  );
  return rows.map((r) => r.id);
}

/**
 * Per document type: documents the user created in the period. Vehicle
 * dispatch registers are one documents.type, split here by flow.
 */
export async function myDocumentRows(
  ds: DataSource,
  userId: string,
  period: Period,
  types: string[],
  dispatchType?: 'purchase' | 'stock-transfer' | 'sales',
): Promise<MyDocumentStatusRow[]> {
  const [start, end] = periodBounds(period);
  const allTypes = dispatchType ? [...types, 'vehicle-dispatch-register'] : types;
  const rows: any[] = await ds.query(
    `SELECT d.type::text AS type,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE d.status::text = 'Complete')::int AS approved,
            COUNT(*) FILTER (WHERE d.status::text = 'Rejected')::int AS rejected,
            COUNT(*) FILTER (WHERE d.status::text NOT IN ('Complete', 'Rejected'))::int AS "inApproval"
       FROM documents d
      WHERE d."isDeleted" = false AND d.status::text <> 'Draft'
        AND d.last_action_by = $1 AND d.type::text = ANY($2)
        AND d."createdAt" >= $3::timestamp AND d."createdAt" < $4::timestamp
        AND (d.type::text <> 'vehicle-dispatch-register'
             OR EXISTS (SELECT 1 FROM dispatch v WHERE v.id::text = d.document_type_id AND v."dispatchType"::text = $5))
      GROUP BY d.type`,
    [userId, allTypes, start, end, dispatchType ?? ''],
  );
  const byType = new Map(rows.map((r) => [r.type, r]));
  return allTypes.map((type) => {
    const r = byType.get(type) ?? {};
    const isDispatch = type === 'vehicle-dispatch-register';
    return {
      id: type,
      docKey: isDispatch ? DISPATCH_KEY[dispatchType!] : docKeyOf(type),
      docType: DOC_TYPE_BY_KEY.get(type)?.label ?? type,
      total: r.total ?? 0,
      inApproval: r.inApproval ?? 0,
      approved: r.approved ?? 0,
      rejected: r.rejected ?? 0,
    };
  });
}

const REGISTRATION_TABLES: Record<string, string> = {
  Farmer: 'farmer',
  Vendor: 'vendor',
  Customer: 'customers',
};

/** Registrations the user created (all time, Drafts excluded) - same counts as the admin registration cards. */
export async function myRegistrations(ds: DataSource, userId: string, types: string[]): Promise<RegistrationSummary[]> {
  const monthStart = sqlTs(nowIst().startOf('month'));
  const sql = types
    .map((type) => {
      const table = REGISTRATION_TABLES[type];
      return `SELECT '${type}' AS type,
                     COUNT(*)::int AS total,
                     COUNT(*) FILTER (WHERE "createdAt" >= $2::timestamp)::int AS "thisMonth",
                     COUNT(*) FILTER (WHERE status::text = 'Approved')::int AS approved,
                     COUNT(*) FILTER (WHERE status::text = 'Pending')::int AS pending,
                     COUNT(*) FILTER (WHERE status::text = 'Rejected')::int AS rejected
                FROM ${table}
               WHERE "isDeleted" = false AND created_by = $1 AND status::text IN ('Approved', 'Pending', 'Rejected')`;
    })
    .join(' UNION ALL ');
  const rows: any[] = await ds.query(sql, [userId, monthStart]);
  return types.map((type) => {
    const r = rows.find((x) => x.type === type) ?? {};
    return {
      type,
      total: r.total ?? 0,
      thisMonth: r.thisMonth ?? 0,
      approved: r.approved ?? 0,
      pending: r.pending ?? 0,
      rejected: r.rejected ?? 0,
    };
  });
}

export { num, round2 };
