/**
 * Weekly procurement and sales achievement against the monthly business plan.
 *
 * Four views share one response shape - own/team x procurement/sales - so the
 * dashboard can render them with a single component:
 *
 *   [{ week: 'week-1', assignedQuantity, achievedQuantity, achievedAmount }, ...]
 *
 * "Assigned" comes from the business plan for the month. "Achieved" comes from
 * the documents the plan is measured by, counted only once they are COMPLETE:
 * GRNs for procurement, final invoices for sales - the same definition the rest
 * of the dashboard already uses.
 *
 * Note the unit difference the two plans are written in: a procurement plan is
 * set in quantity, a sales plan in rupees. `assignedQuantity` therefore holds
 * the planned quantity for procurement and the planned amount for sales, which
 * is what each one has to be compared against.
 */

import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { TYPES } from '../../types';
import {
  DocumentStatus,
  DocumentTypeEnum,
} from '../../approvalFlow/entity/docuemnt.entity';
import { DepartmentEnum } from '../../workFlow/entity/workflowClosure.entity';
import { toPlanMonth } from '../../utils/planMonth';
import { WorkflowHierarchyRepository } from '../../workFlow/repository/WorkflowHierarchy.repository';
import { getMonth } from 'date-fns';

/** One row of the response, identical across all four endpoints. */
export interface WeeklyAchievement {
  week: string;
  assignedQuantity: number;
  achievedQuantity: number;
  achievedAmount: number;
}

/** A week of the month, with the window achievements are counted in. */
export interface WeekWindow {
  weekNo: number;
  start: Date;
  end: Date;
}

/** Whose numbers a request is asking for. */
type Scope = 'own' | 'team';

const MAX_WEEKS = 5;

/** Only a completed document counts as achievement - one still in approval does not. */
const COMPLETED_DOCUMENT_STATUS = DocumentStatus.COMPLETE;

/** Rounds to paise, and turns a null SUM into 0. */
function toAmount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

/**
 * The weeks of a month, as 7-day blocks from the 1st with the last block
 * running to the end of the month.
 *
 * A plan's own `weekStartDate`/`weekEndDate` are deliberately not used as the
 * buckets: a team's members can have plans cut on different dates, and their
 * numbers have to land in the same rows to be summed. Plan quantities are
 * matched to these buckets by `weekNo` instead, which is how the plan numbers
 * its weeks anyway.
 *
 * February gets four weeks, a 29-to-31 day month gets five.
 */
export function weekWindowsForMonth(month: number, year: number): WeekWindow[] {
  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const windows: WeekWindow[] = [];

  for (let weekNo = 1; weekNo <= MAX_WEEKS; weekNo++) {
    const startDay = (weekNo - 1) * 7 + 1;
    if (startDay > daysInMonth) break;

    const endDay = Math.min(startDay + 6, daysInMonth);

    windows.push({
      weekNo,
      start: new Date(Date.UTC(year, month - 1, startDay, 0, 0, 0, 0)),
      end: new Date(Date.UTC(year, month - 1, endDay, 23, 59, 59, 999)),
    });
  }

  return windows;
}

@injectable()
export class WeeklyBusinessPlanService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.WorkflowHierarchyRepository)
    private readonly workflowHierarchyRepo: WorkflowHierarchyRepository,
  ) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  /** A team member's own procurement plan versus what they procured. */
  async getOwnProcurement(userId: string, month: number, year: number) {
   
    return this.buildProcurement(await this.resolveEmployees(userId, 'own'), month, year);
  }

  /** A team member's own sales plan versus what they invoiced. */
  async getOwnSales(userId: string, month: number, year: number) {
    return this.buildSales(await this.resolveEmployees(userId, 'own'), month, year);
  }

  /** A team leader's whole team, procurement plan versus procurement. */
  async getTeamProcurement(userId: string, month: number, year: number) {
    const employees = await this.resolveEmployees(userId, 'team', DepartmentEnum.PURCHASE);
    return this.buildProcurement(employees, month, year);
  }

  /** A team leader's whole team, sales plan versus invoicing. */
  async getTeamSales(userId: string, month: number, year: number) {
    const employees = await this.resolveEmployees(userId, 'team', DepartmentEnum.SALE);
    return this.buildSales(employees, month, year);
  }

  // ─── Who the numbers cover ────────────────────────────────────────────────

  /**
   * The employee ids a request covers.
   *
   * A team includes the leader themselves: `workflow_hierarchy` carries a
   * depth-0 row per user, and the rest of the dashboard counts the leader in
   * their own team totals, so these endpoints match that.
   */
  private async resolveEmployees(
    userId: string,
    scope: Scope,
    department?: DepartmentEnum,
  ): Promise<string[]> {
    if (scope === 'own') return [userId];

    const rows = await this.workflowHierarchyRepo.find({
      where: {
        ancestor: { id: userId },
        ...(department ? { department } : {}),
      },
      relations: ['descendant'],
    });

    const ids = new Set(
      rows.map((row) => String(row.descendant?.id)).filter((id) => id && id !== 'undefined'),
    );

    // A leader with no hierarchy rows yet still sees their own numbers rather
    // than an empty dashboard.
    ids.add(userId);

    return [...ids];
  }

  // ─── Week windows ─────────────────────────────────────────────────────────

  /** Empty result rows for a month, ready to be filled in. */
  private emptyRows(windows: WeekWindow[]): Map<number, WeeklyAchievement> {
    return new Map(
      windows.map((window) => [
        window.weekNo,
        {
          week: `week-${window.weekNo}`,
          assignedQuantity: 0,
          achievedQuantity: 0,
          achievedAmount: 0,
        },
      ]),
    );
  }

  // ─── Procurement ──────────────────────────────────────────────────────────

  private async buildProcurement(
    employeeIds: string[],
    month: number,
    year: number,
  ): Promise<WeeklyAchievement[]> {
    const windows = weekWindowsForMonth(month, year);
    const rows = this.emptyRows(windows);

    // Planned quantity per week, summed across every product in every covered
    // employee's plan for the month.
    const assigned = await this.dataSource
      .createQueryBuilder()
      .select('week."weekNo"', 'weekNo')
      .addSelect('COALESCE(SUM(week.qty), 0)', 'assigned')
      .from('procurement_target_weeks', 'week')
      .innerJoin('procurement_target_products', 'product', 'product.id = week.product_target_id')
      .innerJoin('procurement_targets', 'target', 'target.id = product.target_id')
      .where('target.employee_id IN (:...employeeIds)', { employeeIds })
      .andWhere('target.month = :month', { month: toPlanMonth(month, 'procurement') })
      .andWhere('target.year = :year', { year })
      .andWhere('target."isDeleted" = false')
      .groupBy('week."weekNo"')
      .getRawMany<{ weekNo: number; assigned: string }>();

    for (const row of assigned) {
      const target = rows.get(Number(row.weekNo));
      if (target) target.assignedQuantity = toAmount(row.assigned);
    }

    for (const window of windows) {
      const row = rows.get(window.weekNo)!;

      // Amount and quantity are read separately on purpose: joining the product
      // lines in to get quantity would repeat grn.totalAmt once per line and
      // inflate the amount.
      const amount = await this.completedGrnQuery(employeeIds, window)
        .select('COALESCE(SUM(grn."totalAmt"), 0)', 'amount')
        .getRawOne<{ amount: string }>();

      const quantity = await this.completedGrnQuery(employeeIds, window)
        .innerJoin('grn_products', 'line', 'line.grn_id = grn.id')
        .select('COALESCE(SUM(line."netWeight"), 0)', 'quantity')
        .getRawOne<{ quantity: string }>();

      row.achievedAmount = toAmount(amount?.amount);
      row.achievedQuantity = toAmount(quantity?.quantity);
    }

    return [...rows.values()];
  }

  /**
   * GRNs raised by the given employees inside a week, counted only once their
   * document reached COMPLETE - a GRN still in approval is not procurement yet.
   */
  private completedGrnQuery(employeeIds: string[], window: WeekWindow) {
    return this.dataSource
      .createQueryBuilder()
      .from('grns', 'grn')
      .innerJoin(
        'documents',
        'doc',
        `doc.document_type_id = grn.id::text
           AND doc.type = :docType
           AND doc.status = :docStatus`,
        { docType: DocumentTypeEnum.GRN, docStatus: COMPLETED_DOCUMENT_STATUS },
      )
      .where('grn.createdby_id IN (:...employeeIds)', { employeeIds })
      .andWhere('grn."createdAt" BETWEEN :start AND :end', {
        start: window.start,
        end: window.end,
      })
      .andWhere('grn."isDeleted" = false');
  }

  // ─── Sales ────────────────────────────────────────────────────────────────

  private async buildSales(
    employeeIds: string[],
    month: number,
    year: number,
  ): Promise<WeeklyAchievement[]> {
    const windows = weekWindowsForMonth(month, year);
    const rows = this.emptyRows(windows);

    // A sales plan is written in rupees, so this is the planned *amount*. It is
    // reported in assignedQuantity to keep one response shape across all four
    // endpoints; compare it against achievedAmount.
    const assigned = await this.dataSource
      .createQueryBuilder()
      .select('week."weekNo"', 'weekNo')
      .addSelect('COALESCE(SUM(week.sale_amount), 0)', 'assigned')
      .from('sales_target_weeks', 'week')
      .innerJoin('sales_target_products', 'product', 'product.id = week.sales_target_product_id')
      .innerJoin('sales_targets', 'target', 'target.id = product.monthly_sales_plan_id')
      .where('target.employee_id IN (:...employeeIds)', { employeeIds })
      .andWhere('target.month = :month', { month: toPlanMonth(month, 'sales') })
      .andWhere('target.year = :year', { year })
      .andWhere('target."isDeleted" = false')
      .groupBy('week."weekNo"')
      .getRawMany<{ weekNo: number; assigned: string }>();

    for (const row of assigned) {
      const target = rows.get(Number(row.weekNo));
      if (target) target.assignedQuantity = toAmount(row.assigned);
    }

    for (const window of windows) {
      const row = rows.get(window.weekNo)!;

      // Value comes off the invoice, weight off its delivery challan.
      const achieved = await this.completedInvoiceTotals(employeeIds, window);

      row.achievedAmount = achieved.amount;
      row.achievedQuantity = achieved.quantity;
    }

    return [...rows.values()];
  }

  /**
   * Invoiced value and weight for a week.
   *
   * The value is summed off the invoices themselves, but the weight is not:
   * `invoices.netProductWeight` is not reliably filled in, so it is read from
   * the delivery challan each invoice points at, which is where the weight
   * actually lives.
   *
   * The challans are de-duplicated first. One challan can carry several
   * invoices, and the goods left the yard once - summing per invoice would
   * count the same weight twice.
   *
   * Written as SQL rather than a query builder because it needs one scan for
   * the value and a separate de-duplicated scan for the weight.
   */
  private async completedInvoiceTotals(
    employeeIds: string[],
    window: WeekWindow,
  ): Promise<{ amount: number; quantity: number }> {
    const invoiceFilter = `
      INNER JOIN documents doc
              ON doc.document_type_id = invoice.id::text
             AND doc.type = $1
             AND doc.status = $2
       WHERE invoice.created_by = ANY($3::uuid[])
         AND invoice."createdAt" BETWEEN $4 AND $5
         AND invoice."isDeleted" = false
    `;

    const [row] = await this.dataSource.query(
      `
      SELECT
        COALESCE((
          SELECT SUM(invoice."totalAmount")
            FROM invoices invoice
            ${invoiceFilter}
        ), 0) AS amount,

        COALESCE((
          SELECT SUM(dc."netProductWeight")
            FROM delivery_challan_purchase dc
           WHERE dc.id IN (
             SELECT DISTINCT invoice.delivery_challan_id
               FROM invoices invoice
               ${invoiceFilter}
                AND invoice.delivery_challan_id IS NOT NULL
           )
        ), 0) AS quantity
      `,
      [
        DocumentTypeEnum.FINAL_INVOICE,
        COMPLETED_DOCUMENT_STATUS,
        employeeIds,
        window.start,
        window.end,
      ],
    );

    return {
      amount: toAmount(row?.amount),
      quantity: toAmount(row?.quantity),
    };
  }
}
