import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { TYPES } from '../../types';
import { Role } from '../../employee/entity/user.entity';
import AppError from '../../utils/appError';
import { toPlanMonth } from '../../utils/planMonth';
import {
  WeeklyBusinessPlanService,
  weekWindowsForMonth,
} from '../../dashboard/service/weeklyBusinessPlan.service';
import {
  DOC_TYPE_BY_KEY,
  InFlightDoc,
  loadInFlightDocuments,
  refKey,
  resolveDocRefs,
} from '../../adminControlCenter/service/accApprovalStage';
import { loadPeople, pickFirst, roleForStage, toContact } from '../../adminControlCenter/service/accPeople';
import {
  dateTimeLabel,
  fromSqlText,
  nowIst,
  num,
  round2,
  tsText,
} from '../../adminControlCenter/service/accShared.util';
import {
  MyAccess,
  MyPendingItem,
  MySubmission,
  MyTargetSummary,
  MyTeam,
  MyWork,
  PendingActionType,
  PlanName,
  PlanStatus,
  WeeklyPlanPoint,
  WorkflowDepartment,
} from '../myDashboard.types';
import { docKeyOf, WORKFLOW_DEPARTMENT } from './myShared';

/** Rejected documents stay on My Submissions this long, or until they are resubmitted. */
const REJECTED_WINDOW_DAYS = 30;
/** Team documents waiting longer than this count as stuck. */
const STUCK_AFTER_DAYS = 3;

const ACTION_BY_STAGE: Array<{ prefix: string; type: PendingActionType; role: Role }> = [
  { prefix: 'Verification', type: 'verify', role: Role.VERIFIER },
  { prefix: 'Approval', type: 'approve', role: Role.APPROVER },
  { prefix: 'Finalization', type: 'finalize', role: Role.FINALIZER },
];

/** Pending registrations of all six kinds - verifiers approve the ones created by others or themselves. */
const PENDING_REGISTRATIONS_SQL = (() => {
  const days = `FLOOR(EXTRACT(EPOCH FROM (LOCALTIMESTAMP - "createdAt")) / 86400)::int`;
  const row = (label: string, table: string, docNo: string, transport = false) => `
    SELECT '${label}' AS "docType", id::text AS id, ${docNo} AS "docNo", created_by::text AS "creatorId",
           ${tsText('"createdAt"')} AS "createdAt", ${days} AS "pendingDays"
      FROM ${table}
     WHERE "isDeleted" = false ${transport ? 'AND "deletedAt" IS NULL' : ''} AND status::text = 'Pending'`;
  return [
    row('Farmer Registration', 'farmer', `COALESCE(NULLIF("farmerCode", ''), concat_ws(' ', "farmerfName", "farmerlName"))`),
    row('Vendor Registration', 'vendor', `COALESCE(NULLIF(vendor_code, ''), company_name)`),
    row('Customer Registration', 'customers', `COALESCE(NULLIF(customercode, ''), organisation_name)`),
    row('Transporter Registration', 'transporters', `COALESCE(NULLIF("transporterCode", ''), name)`, true),
    row('Vehicle Registration', 'vehicles', `COALESCE(NULLIF("vehicleNo", ''), "vehicleCode")`, true),
    row('Driver Registration', 'drivers', `COALESCE(NULLIF("driverCode", ''), concat_ws(' ', "firstName", "lastName"))`, true),
  ].join(' UNION ALL ');
})();

/**
 * My Work, My Team and access for the standard user dashboard. Live (not
 * cached): these lists drive what the user does next.
 */
@injectable()
export class MyWorkService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.WeeklyBusinessPlanService) private readonly weeklyService: WeeklyBusinessPlanService,
  ) {}

  // ─── Access ────────────────────────────────────────────────────────────────

  /** Workflow membership and leadership, which the sign-in response does not carry. */
  async getAccess(userId: string): Promise<MyAccess> {
    const rows: any[] = await this.dataSource.query(
      `SELECT department::text AS department,
              bool_or(descendant_id = $1) AS member,
              bool_or(ancestor_id = $1 AND depth = 1) AS leads
         FROM workflow_hierarchy
        WHERE (descendant_id = $1 OR ancestor_id = $1) AND "isDeleted" = false
        GROUP BY department`,
      [userId],
    );
    const of = (dep: WorkflowDepartment) => rows.find((r) => r.department === WORKFLOW_DEPARTMENT[dep]);
    return {
      plans: { procurement: !!of('procurement')?.member, sales: !!of('sales')?.member },
      leads: { procurement: !!of('procurement')?.leads, sales: !!of('sales')?.leads },
    };
  }

  // ─── My Work ───────────────────────────────────────────────────────────────

  async getWork(userId: string, roles: string[]): Promise<MyWork> {
    const [access, all] = await Promise.all([this.getAccess(userId), loadInFlightDocuments(this.dataSource)]);
    const inFlight = all.filter((d) => DOC_TYPE_BY_KEY.has(d.type));

    const [pending, submissions, plans, plansToApprove] = await Promise.all([
      this.pending(userId, roles, inFlight),
      this.submissions(userId, inFlight),
      this.plans(userId, access),
      access.leads.procurement || access.leads.sales ? this.plansToApprove(userId) : Promise.resolve(null),
    ]);
    return { queues: plansToApprove ? { 'approve-plan': plansToApprove } : {}, pending, submissions, ...plans };
  }

  private async pending(userId: string, roles: string[], inFlight: InFlightDoc[]): Promise<MyPendingItem[]> {
    // the creator never acts on their own document (approvalGuards.assertNotCreator)
    const docs = inFlight
      .filter((d) => d.waitingOn.includes(userId) && d.creatorId !== userId)
      .map((d) => {
        const action = ACTION_BY_STAGE.find((a) => d.stage.startsWith(a.prefix));
        if (!action || !roles.includes(action.role)) return null;
        const level = d.stage.split(' ').pop();
        return {
          creatorId: d.creatorId,
          item: {
            id: d.id,
            category: 'Document' as const,
            docNo: d.docNo,
            docType: DOC_TYPE_BY_KEY.get(d.type)!.label,
            createdAt: d.createdAt,
            status: d.status,
            actionType: action.type,
            action: action.type === 'verify' ? 'Verify' : action.type === 'approve' ? `Approve (${level})` : `Finalize (${level})`,
            amount: d.totalAmt ? round2(d.totalAmt) : null,
            pendingDays: d.pendingDays,
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const registrations: any[] = roles.includes(Role.VERIFIER)
      ? await this.dataSource.query(PENDING_REGISTRATIONS_SQL)
      : [];

    const people = await loadPeople(this.dataSource, [
      ...docs.map((d) => d.creatorId || ''),
      ...registrations.map((r) => r.creatorId || ''),
    ]);
    const contact = (id: string | null) => toContact(id ? people.get(id) : undefined);

    const items: MyPendingItem[] = [
      ...docs.map(({ item, creatorId }) => ({ ...item, creator: contact(creatorId) })),
      ...registrations.map((r) => ({
        id: r.id,
        category: 'Registration' as const,
        docNo: r.docNo || '',
        docType: r.docType,
        createdAt: r.createdAt,
        creator: contact(r.creatorId),
        status: 'Pending',
        actionType: 'verify' as const,
        action: 'Approve',
        amount: null,
        pendingDays: Math.max(0, num(r.pendingDays)),
      })),
    ];
    // oldest first, with readable dates
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return items.map((i) => ({ ...i, createdAt: dateTimeLabel(fromSqlText(i.createdAt)) }));
  }

  private async submissions(userId: string, inFlight: InFlightDoc[]): Promise<MySubmission[]> {
    const mine = inFlight.filter((d) => d.creatorId === userId);

    const rejectedRows: any[] = await this.dataSource.query(
      `SELECT d.id, d.type::text AS type, d.document_type_id AS "moduleId", COALESCE(d."totalAmt", 0) AS "totalAmt",
              ${tsText('d."createdAt"')} AS "createdAt",
              COALESCE(
                (SELECT s.reason FROM approval_stage_info s
                  WHERE s.id IN (w.verified_id, w.first_approved_id, w.second_approved_id, w.third_approved_id,
                                 w.first_finalized_id, w.second_finalized_id)
                    AND s.status::text = 'Rejected' AND NULLIF(s.reason, '') IS NOT NULL
                  ORDER BY s."statusChangedAt" DESC NULLS LAST LIMIT 1),
                NULLIF(d.remarks, '')) AS reason
         FROM documents d
         LEFT JOIN documents_approve_by_whom w ON w.id = d.approval_info_id
        WHERE d."isDeleted" = false AND d.status::text = 'Rejected' AND d.last_action_by = $1
          AND d."updatedAt" >= LOCALTIMESTAMP - make_interval(days => $2)`,
      [userId, REJECTED_WINDOW_DAYS],
    );
    const rejectedRefs = await resolveDocRefs(
      this.dataSource,
      rejectedRows.filter((r) => r.moduleId && DOC_TYPE_BY_KEY.has(r.type)).map((r) => ({ type: r.type, id: r.moduleId })),
    );
    const rejected = rejectedRows
      .filter((r) => DOC_TYPE_BY_KEY.has(r.type))
      .map((r) => ({ row: r, ref: rejectedRefs.get(refKey(r.type, r.moduleId)) }));

    const people = await loadPeople(this.dataSource, mine.flatMap((d) => d.waitingOn));

    const live: MySubmission[] = mine.map((d) => {
      const waiting = pickFirst(d.waitingOn, people);
      return {
        id: d.id,
        docKey: docKeyOf(d.type),
        docNo: d.docNo,
        docType: DOC_TYPE_BY_KEY.get(d.type)!.label,
        createdAt: d.createdAt,
        amount: d.totalAmt ? round2(d.totalAmt) : null,
        status: d.status,
        stage: d.stage,
        waitingOn: waiting ? toContact(waiting, roleForStage(d.stage)) : null,
        pendingDays: d.pendingDays,
      };
    });
    const rejectedItems: MySubmission[] = rejected.map(({ row, ref }) => ({
      id: row.id,
      docKey: docKeyOf(row.type),
      docNo: ref?.docNo || '',
      docType: DOC_TYPE_BY_KEY.get(row.type)!.label,
      createdAt: row.createdAt,
      amount: num(row.totalAmt) ? round2(num(row.totalAmt)) : null,
      status: 'Rejected',
      stage: 'Rejected',
      waitingOn: null,
      pendingDays: 0,
      rejectionReason: row.reason || 'No reason given',
    }));

    return [...rejectedItems, ...live.sort((a, b) => a.createdAt.localeCompare(b.createdAt))].map((s) => ({
      ...s,
      createdAt: dateTimeLabel(fromSqlText(s.createdAt)),
    }));
  }

  // ─── Business plans ────────────────────────────────────────────────────────

  private async plans(userId: string, access: MyAccess) {
    const now = nowIst();
    const month = now.month() + 1;
    const year = now.year();
    const windows = weekWindowsForMonth(month, year);
    const today = now.date();

    const targets: MyTargetSummary[] = [];
    const weekly = {} as Record<PlanName, WeeklyPlanPoint[]>;

    for (const dep of ['procurement', 'sales'] as WorkflowDepartment[]) {
      if (!access.plans[dep]) continue;
      const plan: PlanName = dep === 'procurement' ? 'Procurement' : 'Sales';
      const [record, rows] = await Promise.all([
        this.planRecord(dep, userId, month, year),
        dep === 'procurement'
          ? this.weeklyService.getOwnProcurement(userId, month, year)
          : this.weeklyService.getOwnSales(userId, month, year),
      ]);

      const points: WeeklyPlanPoint[] = windows.map((w, i) => {
        const r: any = rows[i] ?? {};
        const startDay = (w.weekNo - 1) * 7 + 1;
        const achieved = dep === 'procurement' ? num(r.achievedQuantity) : num(r.achievedAmount);
        return {
          week: `Week ${w.weekNo} (${startDay}–${Math.min(startDay + 6, windows.length * 7, daysIn(month, year))})`,
          planned: round2(num(r.assignedQuantity)),
          achieved: startDay > today ? null : round2(achieved),
        };
      });

      // planned to date: finished weeks in full, the current week by days elapsed
      const plannedToDate = points.reduce((sum, p, i) => {
        const startDay = i * 7 + 1;
        const endDay = Math.min(startDay + 6, daysIn(month, year));
        if (today >= endDay) return sum + p.planned;
        if (today < startDay) return sum;
        return sum + (p.planned * (today - startDay + 1)) / (endDay - startDay + 1);
      }, 0);

      targets.push({
        plan,
        unit: dep === 'procurement' ? 'kg' : 'INR',
        status: record ? (record.status as PlanStatus) : 'Missing',
        remark: record?.status === 'Rejected' ? record.remark || undefined : undefined,
        monthlyTarget: round2(points.reduce((s, p) => s + p.planned, 0)),
        plannedToDate: round2(plannedToDate),
        achieved: round2(points.reduce((s, p) => s + (p.achieved ?? 0), 0)),
      });
      weekly[plan] = points;
    }
    return { targets, weekly };
  }

  /** Pending plans of the user's direct team members (only the direct manager decides them). */
  private async plansToApprove(userId: string) {
    const days = FLOOR_DAYS('t."createdAt"');
    const team = (dep: string) =>
      `t.employee_id IN (SELECT descendant_id FROM workflow_hierarchy
                          WHERE ancestor_id = $1 AND department::text = '${dep}' AND depth = 1 AND "isDeleted" = false)`;
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count, COALESCE(MAX(days), 0)::int AS "oldestDays" FROM (
         SELECT ${days} AS days FROM procurement_targets t
          WHERE t."isDeleted" = false AND t.status::text = 'Pending' AND ${team(WORKFLOW_DEPARTMENT.procurement)}
         UNION ALL
         SELECT ${days} FROM sales_targets t
          WHERE t."isDeleted" = false AND t.status::text = 'Pending' AND ${team(WORKFLOW_DEPARTMENT.sales)}
       ) x`,
      [userId],
    );
    return { count: row?.count ?? 0, oldestDays: row?.oldestDays ?? 0 };
  }

  /** The user's plan row for a month, or null when none was made. */
  private async planRecord(dep: WorkflowDepartment, employeeId: string, month: number, year: number) {
    const sql =
      dep === 'procurement'
        ? `SELECT status::text AS status, approval_remark AS remark FROM procurement_targets
            WHERE employee_id = $1 AND month = $2 AND year = $3 AND "isDeleted" = false
            ORDER BY "createdAt" DESC LIMIT 1`
        : `SELECT status::text AS status, approval_remark AS remark FROM sales_targets
            WHERE employee_id = $1 AND month = $2 AND year = $3 AND "isDeleted" = false
            ORDER BY "createdAt" DESC LIMIT 1`;
    const [row] = await this.dataSource.query(sql, [employeeId, toPlanMonth(month, dep), year]);
    return row ?? null;
  }

  // ─── My Team ───────────────────────────────────────────────────────────────

  async getTeam(userId: string, dep: WorkflowDepartment, period: 'this-month' | 'last-month'): Promise<MyTeam> {
    const memberRows: any[] = await this.dataSource.query(
      `SELECT descendant_id AS id FROM workflow_hierarchy
        WHERE ancestor_id = $1 AND department::text = $2 AND depth = 1 AND "isDeleted" = false`,
      [userId, WORKFLOW_DEPARTMENT[dep]],
    );
    if (memberRows.length === 0) {
      throw new AppError(403, `You have no team members in the ${dep} workflow`);
    }
    const ids: string[] = memberRows.map((r) => r.id);

    const ref = period === 'last-month' ? nowIst().subtract(1, 'month') : nowIst();
    const month = ref.month() + 1;
    const year = ref.year();
    const start = ref.clone().startOf('month').format('YYYY-MM-DD HH:mm:ss');
    const end = ref.clone().startOf('month').add(1, 'month').format('YYYY-MM-DD HH:mm:ss');

    const complete = (alias: string, type: string) => `EXISTS (SELECT 1 FROM documents cd
        WHERE cd.document_type_id = ${alias}.id::text AND cd.type = '${type}'
          AND cd.status = 'Complete' AND cd."isDeleted" = false)`;

    const [planRows, achievedRows, inFlight, people] = await Promise.all([
      this.dataSource.query(
        dep === 'procurement'
          ? `SELECT DISTINCT ON (employee_id) employee_id AS id, status::text AS status,
                    COALESCE("monthlyTotalQty", 0) AS target
               FROM procurement_targets
              WHERE employee_id = ANY($1) AND month = $2 AND year = $3 AND "isDeleted" = false
              ORDER BY employee_id, "createdAt" DESC`
          : `SELECT DISTINCT ON (employee_id) employee_id AS id, status::text AS status,
                    COALESCE("totalMonthlySale", 0) AS target
               FROM sales_targets
              WHERE employee_id = ANY($1) AND month = $2 AND year = $3 AND "isDeleted" = false
              ORDER BY employee_id, "createdAt" DESC`,
        [ids, toPlanMonth(month, dep), year],
      ),
      this.dataSource.query(
        dep === 'procurement'
          ? `SELECT g.createdby_id AS id, COUNT(*)::int AS documents,
                    COALESCE(SUM((SELECT COALESCE(SUM(gp."netWeight"), 0) FROM grn_products gp
                                   WHERE gp.grn_id = g.id AND gp."isDeleted" = false)), 0) AS achieved
               FROM grns g
              WHERE g."isDeleted" = false AND g.createdby_id = ANY($1)
                AND g."createdAt" >= $2::timestamp AND g."createdAt" < $3::timestamp
                AND ${complete('g', 'grn')}
              GROUP BY g.createdby_id`
          : `SELECT i.created_by AS id, COUNT(*)::int AS documents, COALESCE(SUM(i."totalAmount"), 0) AS achieved
               FROM invoices i
              WHERE i."isDeleted" = false AND i.created_by = ANY($1)
                AND COALESCE(i."invoiceDate"::timestamp, i."createdAt") >= $2::timestamp
                AND COALESCE(i."invoiceDate"::timestamp, i."createdAt") < $3::timestamp
                AND ${complete('i', 'final-invoice')}
              GROUP BY i.created_by`,
        [ids, start, end],
      ),
      loadInFlightDocuments(this.dataSource),
      loadPeople(this.dataSource, ids),
    ]);

    const memberSet = new Set(ids);
    const stuckDocuments = inFlight.filter(
      (d) => DOC_TYPE_BY_KEY.has(d.type) && d.pendingDays > STUCK_AFTER_DAYS && memberSet.has(d.creatorId ?? ''),
    ).length;

    const planOf = new Map<string, any>(planRows.map((r: any) => [r.id, r]));
    const achievedOf = new Map<string, any>(achievedRows.map((r: any) => [r.id, r]));
    const ordered = [...ids].sort((a, b) => (people.get(a)?.name ?? '').localeCompare(people.get(b)?.name ?? ''));

    return {
      teamName: dep === 'procurement' ? 'Procurement Team' : 'Sales Team',
      unit: dep === 'procurement' ? 'kg' : 'INR',
      members: ordered.map((id) => {
        const plan = planOf.get(id);
        return {
          id,
          member: toContact(people.get(id)),
          // only an approved plan is a target
          assignedTarget: plan?.status === 'Approved' ? round2(num(plan.target)) : 0,
          achieved: round2(num(achievedOf.get(id)?.achieved)),
          documents: achievedOf.get(id)?.documents ?? 0,
        };
      }),
      plans: ordered.map((id) => ({
        id,
        member: toContact(people.get(id)),
        status: (planOf.get(id)?.status as PlanStatus) ?? 'Missing',
      })),
      stuckDocuments,
    };
  }
}

function FLOOR_DAYS(col: string): string {
  return `GREATEST(FLOOR(EXTRACT(EPOCH FROM (LOCALTIMESTAMP - ${col})) / 86400)::int, 0)`;
}

function daysIn(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
