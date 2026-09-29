import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { CacheService } from '../../global/cache.service';
import { TYPES } from '../../types';
import { toPlanMonth } from '../../utils/planMonth';
import { TeamRow, UsersTab } from '../adminControlCenter.types';
import { FlowDef, loadFlows, loadInFlightDocuments } from './accApprovalStage';
import { loadPeople, toContact } from './accPeople';
import {
  cacheKey,
  cachedTab,
  completeDoc,
  fullName,
  nowIst,
  num,
  parseDepartments,
  parseRoles,
  primaryRole,
  round2,
  sqlTs,
} from './accShared.util';

/** document_definitions.documentType → the approval-flow category it is created under. */
const FLOW_CATEGORY: Record<string, 'Procurement' | 'Sale' | 'Operation'> = {
  Procurement: 'Procurement',
  GRN: 'Procurement',
  RFPA: 'Procurement',
  DEAL_SLIP: 'Procurement',
  'multi-cash-voucher': 'Procurement',
  'transport-payment-voucher': 'Procurement',
  'packaging-material-voucher': 'Procurement',
  Sale: 'Sale',
  DC_TYPE_CUSTOMER: 'Sale',
  'second-sale': 'Sale',
  Operation: 'Operation',
  DC_TYPE_STOCK_TRANSFER: 'Operation',
  DC_TYPE_OTHER: 'Operation',
  'vehicle-dispatch-register': 'Operation',
};

const CATEGORY_LABEL = { Procurement: 'Procurement', Sale: 'Sales', Operation: 'Operation' };

interface Gap {
  id: string;
  userId: string;
  issue: string;
}

@injectable()
export class AccUsersService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
  ) {}

  getUsers(refresh: boolean) {
    return cachedTab(this.cacheService, cacheKey('users'), refresh, () => this.compute());
  }

  private async compute(): Promise<UsersTab> {
    const [users, people, procurementTeams, salesTeams, gaps] = await Promise.all([
      this.users(),
      loadPeople(this.dataSource),
      this.teams('procurement'),
      this.teams('sale'),
      this.setupGaps(),
    ]);

    const teamRows = (rows: any[]): TeamRow[] =>
      rows.map((r) => ({
        id: r.leader,
        leader: toContact(people.get(r.leader)),
        members: r.members ?? 0,
        assignedTarget: round2(num(r.target)),
        achieved: round2(num(r.achieved)),
        documents: r.documents ?? 0,
      }));

    return {
      users,
      procurementTeams: teamRows(procurementTeams),
      salesTeams: teamRows(salesTeams),
      setupGaps: gaps
        .map((g) => ({ id: g.id, user: toContact(people.get(g.userId)), issue: g.issue }))
        .sort((a, b) => a.issue.localeCompare(b.issue) || a.user.name.localeCompare(b.user.name)),
    };
  }

  // ─── Users ─────────────────────────────────────────────────────────────────

  private async users(): Promise<UsersTab['users']> {
    const [rows, workflowDeps] = await Promise.all([
      this.dataSource.query(
        `SELECT e.id, e."firstName", e."lastName", e.username, e.roles::text[] AS roles, e.department,
                e.status::text AS status, COALESCE(e."primaryMobNo", '') AS phone,
                b.name AS branch, o.name AS office
           FROM employees e
           LEFT JOIN branches b ON b.id = e."currentLocation_id"
           LEFT JOIN offices o ON o.id = e."currentOffices_id"
          WHERE e."isDeleted" = false
          ORDER BY e."firstName", e."lastName"`,
      ),
      // Department fallback for users whose profile has none.
      this.dataSource.query(
        `SELECT descendant_id AS id, array_agg(DISTINCT department::text) AS deps
           FROM workflow_hierarchy WHERE "isDeleted" = false GROUP BY descendant_id`,
      ),
    ]);
    const depMap = new Map<string, string[]>(workflowDeps.map((r: any) => [r.id, r.deps]));

    return rows.map((r: any) => {
      const own = parseDepartments(r.department);
      const departments = own.length ? own : parseDepartments(depMap.get(r.id) ?? []);
      return {
        id: r.id,
        name: fullName(r.firstName, r.lastName) || r.username || '',
        role: primaryRole(parseRoles(r.roles)),
        department: departments.join(', '),
        location: r.branch || r.office || '',
        status: r.status === 'ACTIVE' ? 'Active' : 'Inactive',
        phone: r.phone,
      };
    });
  }

  // ─── Teams ─────────────────────────────────────────────────────────────────

  /**
   * One row per team leader for the current month. A team is the leader plus
   * everyone below them in the workflow hierarchy of that department.
   *  - procurement: target kg from procurement_targets, achieved = kg on the
   *    team's completed GRNs, documents = GRNs created
   *  - sale: target ₹ from sales_targets (plans are in rupees), achieved = ₹
   *    of the team's approved final invoices, documents = invoices created
   */
  private async teams(department: 'procurement' | 'sale'): Promise<any[]> {
    const now = nowIst();
    const month = now.month() + 1;
    const monthStart = sqlTs(now.clone().startOf('month'));
    const monthEnd = sqlTs(now.clone().startOf('month').add(1, 'month'));

    const stats =
      department === 'procurement'
        ? `(SELECT COALESCE(SUM(pt."monthlyTotalQty"), 0) FROM procurement_targets pt
             WHERE pt.employee_id = m.member AND pt.month = $2 AND pt.year = $3 AND pt."isDeleted" = false) AS target,
           (SELECT COALESCE(SUM(gp."netWeight"), 0) FROM grns g
              JOIN grn_products gp ON gp.grn_id = g.id AND gp."isDeleted" = false
             WHERE g.createdby_id = m.member AND g."isDeleted" = false
               AND g."createdAt" >= $4::timestamp AND g."createdAt" < $5::timestamp
               AND ${completeDoc('g', 'grn')}) AS achieved,
           (SELECT COUNT(*) FROM grns g
             WHERE g.createdby_id = m.member AND g."isDeleted" = false
               AND g."createdAt" >= $4::timestamp AND g."createdAt" < $5::timestamp)::int AS documents`
        : `(SELECT COALESCE(SUM(st."totalMonthlySale"), 0) FROM sales_targets st
             WHERE st.employee_id = m.member AND st.month = $2 AND st.year = $3 AND st."isDeleted" = false) AS target,
           (SELECT COALESCE(SUM(i."totalAmount"), 0) FROM invoices i
             WHERE i.created_by = m.member AND i."isDeleted" = false
               AND i."createdAt" >= $4::timestamp AND i."createdAt" < $5::timestamp
               AND ${completeDoc('i', 'final-invoice')}) AS achieved,
           (SELECT COUNT(*) FROM invoices i
             WHERE i.created_by = m.member AND i."isDeleted" = false
               AND i."createdAt" >= $4::timestamp AND i."createdAt" < $5::timestamp)::int AS documents`;

    return this.dataSource.query(
      `WITH leaders AS (
         SELECT DISTINCT ancestor_id AS leader FROM workflow_hierarchy
          WHERE department::text = $1 AND depth > 0 AND "isDeleted" = false
       ),
       team AS (
         SELECT l.leader, h.descendant_id AS member
           FROM leaders l
           JOIN workflow_hierarchy h
             ON h.ancestor_id = l.leader AND h.department::text = $1 AND h.depth > 0 AND h."isDeleted" = false
         UNION
         SELECT leader, leader FROM leaders
       ),
       member_stats AS (
         SELECT m.member, ${stats}
           FROM (SELECT DISTINCT member FROM team) m
       )
       SELECT t.leader::text AS leader,
              COUNT(*) FILTER (WHERE t.member <> t.leader)::int AS members,
              SUM(ms.target) AS target, SUM(ms.achieved) AS achieved, SUM(ms.documents)::int AS documents
         FROM team t
         JOIN member_stats ms ON ms.member = t.member
        GROUP BY t.leader
        ORDER BY SUM(ms.achieved) DESC`,
      [department, toPlanMonth(month, department === 'procurement' ? 'procurement' : 'sales'), now.year(), monthStart, monthEnd],
    );
  }

  // ─── Setup gaps ────────────────────────────────────────────────────────────

  /** Configuration problems that will leave documents stuck, one row per user and issue. */
  private async setupGaps(): Promise<Gap[]> {
    const [unplaced, noFlow, inactiveApprovers, pendingOnInactive, flowGaps] = await Promise.all([
      this.notInWorkflow(),
      this.createWithoutFlow(),
      this.inactiveApprovers(),
      this.pendingOnInactive(),
      this.flowConfigGaps(),
    ]);
    return [...unplaced, ...noFlow, ...inactiveApprovers, ...pendingOnInactive, ...flowGaps];
  }

  /** Active, non-admin users with no team leader or member role in any workflow. */
  private async notInWorkflow(): Promise<Gap[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT e.id FROM employees e
        WHERE e."isDeleted" = false AND e.status::text = 'ACTIVE'
          AND NOT ('admin' = ANY(e.roles::text[]))
          AND NOT EXISTS (SELECT 1 FROM workflow_hierarchy h
                           WHERE (h.ancestor_id = e.id OR h.descendant_id = e.id)
                             AND h.depth > 0 AND h."isDeleted" = false)`,
    );
    return rows.map((r) => ({
      id: `no-workflow:${r.id}`,
      userId: r.id,
      issue: 'Not placed in any workflow',
    }));
  }

  /** Active users allowed to create documents in a category with no approval flow for it. */
  private async createWithoutFlow(): Promise<Gap[]> {
    const [permissions, flows] = await Promise.all([
      this.dataSource.query(
        `SELECT DISTINCT p."employeeId" AS "userId", dd."documentType"::text AS "docType"
           FROM document_permissions p
           JOIN document_definitions dd ON dd.id = p.document_definition_id
           JOIN employees e ON e.id = p."employeeId" AND e."isDeleted" = false AND e.status::text = 'ACTIVE'
          WHERE p."canCreate" = true AND p."isDeleted" = false`,
      ),
      this.dataSource.query(
        `SELECT DISTINCT creator_id AS "userId", type::text AS type
           FROM approval_flows WHERE "isDeleted" = false`,
      ),
    ]);

    const hasFlow = new Set(flows.map((f: any) => `${f.userId}:${f.type}`));
    const gaps = new Map<string, Gap>();
    for (const p of permissions) {
      const category = FLOW_CATEGORY[p.docType];
      if (!category || hasFlow.has(`${p.userId}:${category}`)) continue;
      const id = `no-flow:${p.userId}:${category}`;
      gaps.set(id, {
        id,
        userId: p.userId,
        issue: `No approval flow configured for ${CATEGORY_LABEL[category]} documents`,
      });
    }
    return Array.from(gaps.values());
  }

  /** Inactive or removed users still named as verifier, approver or finalizer in live flows. */
  private async inactiveApprovers(): Promise<Gap[]> {
    const rows: any[] = await this.dataSource.query(
      `WITH live_flows AS (
         SELECT f.* FROM approval_flows f
           JOIN employees c ON c.id = f.creator_id AND c."isDeleted" = false AND c.status::text = 'ACTIVE'
          WHERE f."isDeleted" = false
       ),
       participants AS (
         SELECT v.user_id, f.id AS flow FROM live_flows f
           JOIN approval_flow_verifiers v ON v.approval_flow_id = f.id
         UNION
         SELECT u.user_id, f.id FROM live_flows f
           JOIN approval_levels l ON l.id = f.approval_level_id
           JOIN approver_block_users u ON u.block_id IN (
             l.first_approver_block_id, l.second_approver_block_id, l.third_approver_block_id,
             l.fourth_approver_block_id, l.fifth_approver_block_id, l.sixth_approver_block_id)
         UNION
         SELECT x.user_id, f.id FROM live_flows f
           JOIN finalizer_block_first_finalizers x ON x.finalizer_block_id = f.finalizer_block_id
         UNION
         SELECT x.user_id, f.id FROM live_flows f
           JOIN finalizer_block_second_finalizers x ON x.finalizer_block_id = f.finalizer_block_id
       )
       SELECT p.user_id::text AS "userId", COUNT(DISTINCT p.flow)::int AS flows
         FROM participants p
         JOIN employees e ON e.id = p.user_id
        WHERE e."isDeleted" = true OR e.status::text <> 'ACTIVE'
        GROUP BY p.user_id`,
    );
    return rows.map((r) => ({
      id: `inactive-approver:${r.userId}`,
      userId: r.userId,
      issue: `Inactive but still an approver in ${r.flows} approval flow${r.flows === 1 ? '' : 's'}`,
    }));
  }

  /**
   * Documents already stuck: waiting on an inactive user, or at a stage where
   * nobody is configured to act (reported against the document's creator).
   */
  private async pendingOnInactive(): Promise<Gap[]> {
    const docs = await loadInFlightDocuments(this.dataSource);
    const people = await loadPeople(
      this.dataSource,
      docs.flatMap((d) => d.waitingOn),
    );

    const onInactive = new Map<string, number>();
    const nobody = new Map<string, number>();
    for (const d of docs) {
      if (d.waitingOn.length === 0) {
        if (d.creatorId) nobody.set(d.creatorId, (nobody.get(d.creatorId) ?? 0) + 1);
        continue;
      }
      for (const userId of new Set(d.waitingOn)) {
        const person = people.get(userId);
        if (person && !person.active) onInactive.set(userId, (onInactive.get(userId) ?? 0) + 1);
      }
    }

    const plural = (n: number) => `${n} document${n === 1 ? '' : 's'}`;
    return [
      ...Array.from(onInactive, ([userId, n]) => ({
        id: `inactive-pending:${userId}`,
        userId,
        issue: `Inactive but has ${plural(n)} pending approval`,
      })),
      ...Array.from(nobody, ([userId, n]) => ({
        id: `no-approver-pending:${userId}`,
        userId,
        issue: `${plural(n)} waiting at a stage with nobody assigned`,
      })),
    ];
  }

  /**
   * Procurement flows (GRNs and vouchers) that will stall: no verifier, or
   * approver amount bands that leave a range of amounts nobody can approve.
   */
  private async flowConfigGaps(): Promise<Gap[]> {
    const flows: any[] = await this.dataSource.query(
      `SELECT f.id, f.creator_id AS "creatorId" FROM approval_flows f
         JOIN employees c ON c.id = f.creator_id AND c."isDeleted" = false AND c.status::text = 'ACTIVE'
        WHERE f."isDeleted" = false AND f.type::text = 'Procurement'`,
    );
    const defs = await loadFlows(this.dataSource, flows.map((f) => f.id));

    const gaps: Gap[] = [];
    for (const f of flows) {
      const def = defs.get(f.id);
      if (!def) continue;
      if (def.verifiers.length === 0) {
        gaps.push({
          id: `no-verifier:${f.id}`,
          userId: f.creatorId,
          issue: 'No verifier in Procurement approval flow - GRNs will wait at verification',
        });
      }
      const uncovered = firstUncoveredAmount(def);
      if (uncovered) {
        gaps.push({ id: `amount-gap:${f.id}`, userId: f.creatorId, issue: uncovered });
      }
    }
    return gaps;
  }
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * The first range of amounts, from ₹0 upward, that no approver block with
 * users covers - a GRN in it can never be approved. null when fully covered.
 */
export function firstUncoveredAmount(flow: FlowDef): string | null {
  const bands = flow.blocks
    .filter((b): b is NonNullable<typeof b> => !!b && b.users.length > 0)
    .map((b) => ({ min: b.min ?? 0, max: b.max ?? Infinity }))
    .sort((a, b) => a.min - b.min);

  if (bands.length === 0) return 'No approvers configured in Procurement approval flow';

  let coveredTo = 0;
  for (const band of bands) {
    if (band.min > coveredTo + 1) {
      return `No approver for amounts ${rupees(coveredTo)} - ${rupees(band.min)} in Procurement approval flow`;
    }
    coveredTo = Math.max(coveredTo, band.max);
    if (coveredTo === Infinity) return null;
  }
  return `No approver for amounts above ${rupees(coveredTo)} in Procurement approval flow`;
}
