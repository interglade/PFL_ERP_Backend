import "reflect-metadata";
import { inject, injectable } from "inversify";
import { ProcurementTargetRepository } from "../repository/procurementTarget.repository";
import { TYPES } from "../../types";
import { UserRepository } from "../../employee/repository/user.repository";
import { ProductRepository } from "../../product/createproduct/repository/product.repository";
import { ProcurementTargetProductRepository } from "../repository/procurmentTargetProduct.repository";
import { ProcurementTargetWeekRepository } from "../repository/procurmentTargetWeek.repository";

import { WorkflowHierarchyRepository } from "../../workFlow/repository/WorkflowHierarchy.repository";
import { DepartmentEnum } from "../../workFlow/entity/workflowClosure.entity";
import * as ExcelJS from 'exceljs';
import { AppDataSource } from "../../utils/data-source";
import { toPlanMonth } from '../../utils/planMonth';

import * as path from 'path';
import * as fs from 'fs';
import { ProcurementTargetAchievementRepository } from "../repository/procurmentAchievement.repository";
import { ProcurementStatus, ProcurementTarget } from "../entity/procurmentTarget.entity";
import { ProcurementTargetProduct } from "../entity/procurementTargetProduct.entity";
import { Product } from "../../product/createproduct/entity/product.entity";
import { ProcurementTargetWeek } from "../entity/procurementTargetWeek.entity";
import { User } from "../../employee/entity/user.entity";
import { RfpaRepository } from "../../rfpa/repository/rfpa.repository";
import { DealSlipRepository } from "../../dealSlip/repository/dealSlip.repository";
import { GrnRepository } from "../../grn/repository/grn.repository";


/** One GRN line, reduced to what the weekly roll-up needs. */
export interface AchievedLine {
    productId: string;
    netWeight: number;
    amount: number;
    at: Date;
}

/**
 * Net weight procured inside one plan week.
 *
 * `productId` narrows it to a single product; pass null for everything received
 * that week, whatever the product. The week-wise view wants the total - a
 * buyer's week-3 figure is everything they brought in, not only the lines that
 * happen to appear in the plan - while the per-product view wants one product.
 *
 * The week boundaries come out of the plan as dates with no time on them, so
 * `end` is pushed to the end of its day. Without that, a GRN raised at 11am on
 * the last day of a week falls outside its own week and the quantity silently
 * lands nowhere.
 */
export function sumAchievedInWeek(
    lines: AchievedLine[],
    productId: string | null,
    start: Date | null,
    end: Date | null,
): number {
    if (!start || !end) return 0;

    const from = new Date(start);
    from.setHours(0, 0, 0, 0);

    const to = new Date(end);
    to.setHours(23, 59, 59, 999);

    return lines
        .filter(line => productId === null || line.productId === productId)
        .filter(line => line.at >= from && line.at <= to)
        .reduce((sum, line) => sum + line.netWeight, 0);
}

@injectable()
export class ProcurementTargetService {
    constructor(
        @inject(TYPES.ProcurementTargetRepository)
        private procurementTargetRepository: ProcurementTargetRepository,
        @inject(TYPES.UserRepository)
        private userRepository: UserRepository,
        @inject(TYPES.ProductRepository)
        private productRepository: ProductRepository,
        @inject(TYPES.ProcurementTargetProductRepository)
        private procurementTargetProduct: ProcurementTargetProductRepository,
        @inject(TYPES.ProcurementTargetWeekRepository)
        private weeklyProcurementRepo: ProcurementTargetWeekRepository,
        @inject(TYPES.ProcurementTargetAchievementRepository)
        private procurementAchievementRepo: ProcurementTargetAchievementRepository,
        @inject(TYPES.WorkflowHierarchyRepository)
        private workflowHierarchyRepo: WorkflowHierarchyRepository,
        @inject(TYPES.RfpaRepository)
        private rfpaRepository: RfpaRepository,
        @inject(TYPES.DealSlipRepository)
        private dealSlipRepository: DealSlipRepository,
        @inject(TYPES.GrnRepository)
        private grnRepository: GrnRepository
    ) {}

    async create(payload: any) {

   // console.log("status",payload.status);
    const targetRepo = AppDataSource.getRepository(ProcurementTarget);

   
   

    // Week-wise totals (ALL PRODUCTS)
    const weekTotals: Record<number, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6:0
    };

    // Handle both field names for backward compatibility
    const planData = payload.procurementTargetPlan || payload.procurementTargetPlane;

    if (!planData || !Array.isArray(planData)) {
      throw new Error('procurementTargetPlan is required and must be an array');
    }

    const products: ProcurementTargetProduct[] = planData.map(
      (p: any) => {
        // ✅ Validate weekly total per product
        const calculatedTotal = p.weeklyTargets.reduce(
          (sum: number, w: any) => sum + Number(w.qty),
          0,
        );

        if (calculatedTotal !== Number(p.weeklyTargetsTotalQty)) {
          throw new Error(
            `Weekly total mismatch for product ${p.product}`,
          );
        }

        const productEntity = new ProcurementTargetProduct();
        productEntity.product = { id: p.product } as Product;
        productEntity.weeklyTotalQtyPerProduct = p.weeklyTargetsTotalQty;
        productEntity.remark = p.remark;

        productEntity.weeklyProcurement = p.weeklyTargets.map((w: any) => {
          weekTotals[w.weekNo] += Number(w.qty);

          const weekEntity = new ProcurementTargetWeek();
          weekEntity.weekNo = w.weekNo;
          weekEntity.qty = w.qty;
          weekEntity.weekStartDate = w.startDate;
          weekEntity.weekEndDate = w.endDate;

          return weekEntity;
        });

        return productEntity;
      },
    );

    let status: ProcurementStatus;
    if(payload.createdBy == payload.employee)
    {
        // Employee ने स्वतःसाठी create केला → PENDING (वरचा manager approve करेल)
        status = ProcurementStatus.PENDING;
    }
    else {
        // Manager ने subordinate साठी create केला → directly APPROVED
        // (manager च creator आहे, त्याची implicit approval आहे)
        status = ProcurementStatus.APPROVED;
    }

    // ✅ Create target entity
    const target = targetRepo.create({
      employee: { id: payload.employee } as User,
      month: payload.month,
      year: payload.year,
      monthlyTotalQty: payload.procurementMonthlyTotalTargetQty,
      week1TotalQty: weekTotals[1],
      week2TotalQty: weekTotals[2],
      week3TotalQty: weekTotals[3],
      week4TotalQty: weekTotals[4],
      week5TotalQty: weekTotals[5],
      creatdeBy: { id: payload.createdBy } as User,
      status: status,
      products,
    });

    return targetRepo.save(target);
  }
 

    // Get all targets with pagination
    async getalltargets(
        employeeId: string,
        page?: number,
        limit?: number,
        filters: {
            employeeId?: string;
            month?: number;
            year?: number;
            fromMonth?: number;
            fromYear?: number;
            toMonth?: number;
            toYear?: number;
        } = {}
    ) {
        try {
            const isPaginated = page !== undefined && limit !== undefined;
            const skip = isPaginated ? (page! - 1) * limit! : 0;

            // Get all subordinates including self (depth >= 0)
            const subordinates = await this.workflowHierarchyRepo
                .createQueryBuilder('wh')
                .select('wh.descendant_id')
                .where('wh.ancestor_id = :employeeId', { employeeId })
                .andWhere('wh.depth >= 0')
                .getRawMany();

            let employeeIds = subordinates.map(s => s.descendant_id);

            // Filter by specific employeeId if provided
            if (filters.employeeId) {
                employeeIds = employeeIds.filter(id => id === filters.employeeId);
            }

            if (employeeIds.length === 0) {
                return {
                    targets: [],
                    totalItems: 0,
                    totalPages: 0,
                    currentPage: page ?? 1  
                };
            }

            const qb = this.procurementTargetRepository
                .createQueryBuilder('target')
                .leftJoinAndSelect('target.employee', 'employee')
                .where('target.employee.id IN (:...employeeIds)', { employeeIds })
                .orderBy('target.createdAt', 'DESC');

            // Legacy single month/year filter
            if (filters.month !== undefined) {
                qb.andWhere('target.month = :month', { month: filters.month });
            }
            if (filters.year !== undefined) {
                qb.andWhere('target.year = :year', { year: filters.year });
            }

            // Date range filter — fromMonth/fromYear to toMonth/toYear
            // Converts month+year into a comparable integer (year*12 + month)
            // so range queries work correctly across year boundaries
            // e.g. fromMonth=8&fromYear=2026&toMonth=2&toYear=2027
            if (
                filters.fromMonth !== undefined && filters.fromYear !== undefined &&
                filters.toMonth !== undefined && filters.toYear !== undefined
            ) {
                qb.andWhere(
                    '(target.year * 12 + target.month) >= :from AND (target.year * 12 + target.month) <= :to',
                    {
                        from: filters.fromYear * 12 + filters.fromMonth,
                        to: filters.toYear * 12 + filters.toMonth,
                    }
                );
            } else if (filters.fromMonth !== undefined && filters.fromYear !== undefined) {
                // Only from — no upper bound
                qb.andWhere(
                    '(target.year * 12 + target.month) >= :from',
                    { from: filters.fromYear * 12 + filters.fromMonth }
                );
            } else if (filters.toMonth !== undefined && filters.toYear !== undefined) {
                // Only to — no lower bound
                qb.andWhere(
                    '(target.year * 12 + target.month) <= :to',
                    { to: filters.toYear * 12 + filters.toMonth }
                );
            }

            if (isPaginated) {
                qb.skip(skip).take(limit!);
            }

            const [targets, totalItems] = await qb.getManyAndCount();

            const totalPages = isPaginated ? Math.ceil(totalItems / limit!) : 1;

            // Month names array (0-11 index)
            const monthNames = [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'
            ];

            // Format the targets with weekly totals
            const formattedTargets = targets.map(target => {
                const monthName = target.month !== null && target.month >= 0 && target.month <= 11
                    ? monthNames[target.month]
                    : null;

                const monthYear = monthName && target.year 
                    ? `${monthName} ${target.year}`
                    : null;

                return {
                    id: target.id,
                    employeeName: target.employee 
                        ? `${target.employee.firstName} ${target.employee.lastName}` 
                        : null,
                    month: target.month,
                    monthName: monthName,
                    year: target.year,
                    monthYear: monthYear,
                    week1Total: target.week1TotalQty || 0,
                    week2Total: target.week2TotalQty || 0,
                    week3Total: target.week3TotalQty || 0,
                    week4Total: target.week4TotalQty || 0,
                    week5Total: target.week5TotalQty || 0,
                    totalTarget: target.monthlyTotalQty || 0,
                    status: target.status
                };
            });

            return {
                targets: formattedTargets,
                totalItems,
                totalPages,
                currentPage: page
            };
        } catch (error) {
            throw error;
        }
    }





    // Get monthly plan view
    async getMonthlyPlanView(employeeId: string, month: number, year: number) {
        try {
            const target = await this.procurementTargetRepository
                .createQueryBuilder('target')
                .leftJoinAndSelect('target.employee', 'employee')
                .leftJoinAndSelect('target.products', 'products')
                .leftJoinAndSelect('products.product', 'product')
                .leftJoinAndSelect('products.weeklyProcurement', 'weeklyProcurement')
                .where('target.employee.id = :employeeId', { employeeId })
                .andWhere('target.month = :month', { month })
                .andWhere('target.year = :year', { year })
                .getOne();

            if (!target) {
                return {
                    employee: null,
                    month: null,
                    year: null,
                    monthlyTotalQty: 0,
                    plan: []
                };
            }

            return {
                employee: `${target.employee.firstName} ${target.employee.lastName}`,
                month: target.month,
                year: target.year,
                monthlyTotalQty: target.monthlyTotalQty,
                procurementTargetPlan: target.products.map(p => ({
                    product: p.product.name,
                    weeklyTotalQtyPerProduct: p.weeklyTotalQtyPerProduct,
                    remark: p.remark,
                    weeklyProcurement: p.weeklyProcurement.map(w => ({
                        weekNo: w.weekNo,
                        startDate: w.weekStartDate,
                        endDate: w.weekEndDate,
                        qty: w.qty
                    }))
                }))
            };
        } catch (error) {
            throw error;
        }
    }

    // Get monthly plan view structured
    async getMonthlyPlanViewStructured(targetId: string) {
        try {
            const target = await this.procurementTargetRepository
                .createQueryBuilder('target')
                .leftJoinAndSelect('target.employee', 'employee')
                .leftJoinAndSelect('target.products', 'products')
                .leftJoinAndSelect('products.product', 'product')
                .leftJoinAndSelect('products.weeklyProcurement', 'weeklyProcurement')
                .where('target.id = :targetId', { targetId })
                .getOne();

            if (!target) {
                return {
                    employee: null,
                    month: 0,
                    year: 0,
                    procurementMonthlyTotalTargetQty: null,
                    procurementTargetPlan: [],
                    summary: {
                        weeklyTotals: [],
                        monthlyTotal: null
                    }
                };
            }

            // Calculate weekly totals across all products
            const weeklyTotalsMap = new Map<number, number>();

            const procurementTargetPlan = target.products.map(p => {
                const weeklyTargets = p.weeklyProcurement.map(w => {
                    const qty = Number(w.qty || 0);
                    
                    // Accumulate weekly totals
                    if (!weeklyTotalsMap.has(w.weekNo)) {
                        weeklyTotalsMap.set(w.weekNo, 0);
                    }
                    weeklyTotalsMap.set(w.weekNo, weeklyTotalsMap.get(w.weekNo)! + qty);

                    return {
                        weekNo: w.weekNo,
                        startDate: w.weekStartDate ? (typeof w.weekStartDate === 'string' ? w.weekStartDate : new Date(w.weekStartDate).toISOString().split('T')[0]) : null,
                        endDate: w.weekEndDate ? (typeof w.weekEndDate === 'string' ? w.weekEndDate : new Date(w.weekEndDate).toISOString().split('T')[0]) : null,
                        qty: qty
                    };
                });

                return {
                    product: p.product?.name|| null,
                    weeklyTargetsTotalQty: p.weeklyTotalQtyPerProduct || null,
                    weeklyTargets: weeklyTargets,
                    remark: p.remark || null
                };
            });

            // Build summary
            const weeklyTotals = Array.from(weeklyTotalsMap.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([weekNo, total]) => ({
                    weekNo: weekNo,
                    total: Number(total.toFixed(2))
                }));

            const monthlyTotal = weeklyTotals.reduce((sum, week) => sum + week.total, 0);

            return {
                employee: target.employee?.firstName+' '+target.employee.lastName|| null,
                month: target.month || 0,
                year: target.year || 0,
                procurementMonthlyTotalTargetQty: target.monthlyTotalQty || null,
                procurementTargetPlan: procurementTargetPlan,
                summary: {
                    weeklyTotals: weeklyTotals,
                    monthlyTotal: Number(monthlyTotal.toFixed(2))
                }
            };
        } catch (error) {
            throw error;
        }
    }

async getMonthlyPlanUpdateStructured(
  targetId: string
): Promise<{
  employee: string | null;
  month: number;
  year: number;
  procurementMonthlyTotalTargetQty: number | null;
  procurementTargetPlan: any[];
  summary: {
    weeklyTotals: Array<{
      weekNo: number | null;
      total: number | null;
    }>;
    monthlyTotal: number | null;
  };
}> {
  //console.log("getMonthlyPlanUpdateStructured params:", { targetId });

  const target = await this.procurementTargetRepository
    .createQueryBuilder("target")
    .leftJoinAndSelect("target.employee", "employee")
    .where("target.id = :targetId", { targetId })
    .getOne();

  if (!target) {
    return {
      employee: null,
      month: 0,
      year: 0,
      procurementMonthlyTotalTargetQty: null,
      procurementTargetPlan: [],
      summary: {
        weeklyTotals: [],
        monthlyTotal: null
      }
    };
  }

  const targetProducts = await this.procurementTargetProduct.find({
    where: { target: { id: target.id } },
    relations: ["product"]
  });

  const productMap = new Map<string, any>();
  let monthlyTotalQty = 0;
  const weeklyTotalsMap = new Map<number, number>();

  for (const targetProduct of targetProducts) {
    if (!targetProduct.product) {
      continue;
    }

    const productId = targetProduct.product.id;
    
    if (!productMap.has(productId)) {
      productMap.set(productId, {
        product: productId,
        weeklyTargetsTotalQty: 0,
        remark: targetProduct.remark || null,
        weeklyTargets: []
      });
    }

    const weeklyProcurement = await this.weeklyProcurementRepo.find({
      where: { productTarget: { id: targetProduct.id } },
      order: { weekNo: "ASC" }
    });

    const weeklyTargets = weeklyProcurement.map(week => {
      const qty = Number(week.qty || 0);
      
      if (!weeklyTotalsMap.has(week.weekNo)) {
        weeklyTotalsMap.set(week.weekNo, 0);
      }
      weeklyTotalsMap.set(week.weekNo, weeklyTotalsMap.get(week.weekNo)! + qty);
      
      return {
        weekNo: week.weekNo,
        startDate: week.weekStartDate ? (typeof week.weekStartDate === 'string' ? week.weekStartDate : new Date(week.weekStartDate).toISOString().split('T')[0]) : null,
        endDate: week.weekEndDate ? (typeof week.weekEndDate === 'string' ? week.weekEndDate : new Date(week.weekEndDate).toISOString().split('T')[0]) : null,
        qty: qty
      };
    });

    const weeklyTotal = weeklyProcurement.reduce(
      (sum, week) => sum + Number(week.qty || 0),
      0
    );

    monthlyTotalQty += weeklyTotal;

    productMap.get(productId).weeklyTargetsTotalQty = weeklyTotal;
    productMap.get(productId).weeklyTargets = weeklyTargets;
  }

  const procurementTargetPlan = Array.from(productMap.values());

  // Build summary with weeklyTotals array
  const weeklyTotals = Array.from(weeklyTotalsMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([weekNo, total]) => ({
      weekNo: weekNo,
      total: Number(total.toFixed(2))
    }));

  const monthlyTotal = weeklyTotals.reduce((sum, week) => sum + week.total, 0);

  return {
    employee: target.employee?.id || null,
    month: target.month || 0,
    year: target.year || 0,
    procurementMonthlyTotalTargetQty: Number(monthlyTotalQty.toFixed(2)),
    procurementTargetPlan,
    summary: {
      weeklyTotals: weeklyTotals,
      monthlyTotal: Number(monthlyTotal.toFixed(2))
    }
  };
}



    // Generate plan in brief Excel
    async generatePlanInBriefExcel(filters: any) {
        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Plan in Brief');

            worksheet.columns = [
                { header: 'Employee', key: 'employee', width: 20 },
                { header: 'Month', key: 'month', width: 10 },
                { header: 'Year', key: 'year', width: 10 },
                { header: 'Total Qty', key: 'totalQty', width: 15 },
                { header: 'Status', key: 'status', width: 15 }
            ];

            const targets = await this.procurementTargetRepository
                .createQueryBuilder('target')
                .leftJoinAndSelect('target.employee', 'employee')
                .getMany();

            targets.forEach(target => {
                worksheet.addRow({
                    employee: `${target.employee.firstName} ${target.employee.lastName}`,
                    month: target.month,
                    year: target.year,
                    totalQty: target.monthlyTotalQty,
                    status: target.status
                });
            });

            const exportDir = path.join(process.cwd(), 'exports', 'procurement-plans');
            if (!fs.existsSync(exportDir)) {
                fs.mkdirSync(exportDir, { recursive: true });
            }

            const fileName = `Procurement_Plan_Brief_${new Date().toISOString().split('T')[0]}.xlsx`;
            const filePath = path.join(exportDir, fileName);

            await workbook.xlsx.writeFile(filePath);

            return { fileName, filePath };
        } catch (error) {
            throw error;
        }
    }

    // Generate monthly business plan Excel
    async generateMonthlyBusinessPlanExcel(targetId: string) {
        try {
            const data = await this.getMonthlyPlanViewStructured(targetId);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Monthly Business Plan');

            worksheet.columns = [
                { header: 'Product', key: 'product', width: 25 },
                { header: 'Week 1', key: 'week1', width: 12 },
                { header: 'Week 2', key: 'week2', width: 12 },
                { header: 'Week 3', key: 'week3', width: 12 },
                { header: 'Week 4', key: 'week4', width: 12 },
                { header: 'Week 5', key: 'week5', width: 12 },
                { header: 'Total', key: 'total', width: 12 },
                { header: 'Remark', key: 'remark', width: 30 }
            ];

            data.procurementTargetPlan.forEach((product: any) => {
                const weekData: any = { week1: 0, week2: 0, week3: 0, week4: 0, week5: 0 };
                
                product.weeklyTargets.forEach((week: any) => {
                    weekData[`week${week.weekNo}`] = week.qty;
                });

                worksheet.addRow({
                    product: product.product,
                    week1: weekData.week1,
                    week2: weekData.week2,
                    week3: weekData.week3,
                    week4: weekData.week4,
                    week5: weekData.week5,
                    total: product.weeklyTargetsTotalQty,
                    remark: product.remark
                });
            });

            const exportDir = path.join(process.cwd(), 'exports', 'monthly-plans');
            if (!fs.existsSync(exportDir)) {
                fs.mkdirSync(exportDir, { recursive: true });
            }

            const fileName = `Procurement_Target_${targetId}_${new Date().toISOString().split('T')[0]}.xlsx`;
            const filePath = path.join(exportDir, fileName);

            await workbook.xlsx.writeFile(filePath);

            return { fileName, filePath };
        } catch (error) {
            throw error;
        }
    }

    // Get target performance
    /**
     * Procurement actually done by an employee in a month, as one row per
     * GRN line.
     *
     * The `procurement_achievements` table is not used: nothing in the codebase
     * ever writes a row to it, so reading it made every "achieved" figure zero
     * even when the employee had completed GRNs. The GRNs themselves are the
     * record of what was procured, which is what the rest of the dashboard
     * measures too.
     *
     * Only GRNs whose document reached COMPLETE are counted - one still moving
     * through approval is not procurement yet.
     *
     * Fetched once per request and bucketed in memory, rather than a query per
     * week per product.
     */
    private async fetchAchievedLines(
        employeeId: string,
        month: number,
        year: number,
    ): Promise<AchievedLine[]> {
        // A calendar month with room either side, so a plan week that runs a
        // day past the month boundary still finds its GRNs.
        const from = new Date(Date.UTC(year, month - 2, 1, 0, 0, 0, 0));
        const to = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

        const rows = await AppDataSource.query(
            `
            SELECT gp.product_id            AS "productId",
                   gp."netWeight"           AS "netWeight",
                   gp.amount                AS "amount",
                   grn."createdAt"          AS "at"
              FROM grn_products gp
              INNER JOIN grns grn
                      ON grn.id = gp.grn_id
              INNER JOIN documents doc
                      ON doc.document_type_id = grn.id::text
                     AND doc.type = $1
                     AND doc.status = $2
             WHERE grn.createdby_id = $3::uuid
               AND grn."createdAt" BETWEEN $4 AND $5
               AND grn."isDeleted" = false
               AND gp."isDeleted" = false
            `,
            ['grn', 'COMPLETE', employeeId, from, to],
        );

        return rows.map((row: any) => ({
            productId: String(row.productId ?? ''),
            netWeight: Number(row.netWeight ?? 0),
            amount: Number(row.amount ?? 0),
            at: new Date(row.at),
        }));
    }

    async getTargetPerformance(
        employeeId: string,
        month: number,
        year: number,
        productId?: string
    ) {
        try {
            const target = await this.procurementTargetRepository.findOne({
                where: {
                    employee: { id: employeeId },
                    // The URL carries a 1-12 month; this table stores 0-11.
                    // Passing it through unconverted read the *following*
                    // month's plan, which came back as "no plan found".
                    month: toPlanMonth(month, 'procurement'),
                    year: year
                },
                relations: ['employee']
            });

            if (!target) {
                return [];
            }

            let targetProductsQuery = this.procurementTargetProduct
                .createQueryBuilder("ptp")
                .leftJoinAndSelect("ptp.product", "product")
                .where("ptp.target.id = :targetId", { targetId: target.id });

            if (productId) {
                targetProductsQuery.andWhere("ptp.product.id = :productId", { productId });
            }

            const targetProducts = await targetProductsQuery.getMany();

            if (targetProducts.length === 0) {
                return [];
            }

            const achievedLines = await this.fetchAchievedLines(employeeId, month, year);

            const weeklyDataMap = new Map<number, {
                weekNo: number;
                period: string;
                start: Date | null;
                end: Date | null;
                targetAssigned: number;
                targetAchieved: number;
            }>();

            for (const targetProduct of targetProducts) {
                const weeklyTargets = await this.weeklyProcurementRepo.find({
                    where: { productTarget: { id: targetProduct.id } },
                    order: { weekNo: "ASC" }
                });

                for (const week of weeklyTargets) {
                    const weekTarget = Number(week.qty || 0);

                    if (!weeklyDataMap.has(week.weekNo)) {
                        const startDate = week.weekStartDate ? new Date(week.weekStartDate) : null;
                        const endDate = week.weekEndDate ? new Date(week.weekEndDate) : null;

                        weeklyDataMap.set(week.weekNo, {
                            weekNo: week.weekNo,
                            period: `${startDate?.toISOString().split('T')[0] || ''} to ${endDate?.toISOString().split('T')[0] || ''}`,
                            start: startDate,
                            end: endDate,
                            targetAssigned: 0,
                            targetAchieved: 0
                        });
                    }

                    const weekData = weeklyDataMap.get(week.weekNo)!;
                    weekData.targetAssigned += weekTarget;
                }
            }

            // Achieved is summed once per week, not once per planned product.
            // Adding it inside the product loop would count the same week's
            // procurement again for every product in the plan.
            //
            // With no productId filter this is everything received that week,
            // including products the plan never mentioned - the row is a
            // week total, and getProcurementPerProduct is the per-product view.
            for (const weekData of weeklyDataMap.values()) {
                weekData.targetAchieved = sumAchievedInWeek(
                    achievedLines,
                    productId ?? null,
                    weekData.start,
                    weekData.end,
                );
            }

            const weeklyBreakdown = Array.from(weeklyDataMap.values())
                .sort((a, b) => a.weekNo - b.weekNo)
                .map(week => {
                    const percentage = week.targetAssigned > 0
                        ? Number(((week.targetAchieved / week.targetAssigned) * 100).toFixed(2))
                        : 0;
                    
                    // Variance as percentage
                    const variance = week.targetAssigned > 0
                        ? Number((((week.targetAchieved - week.targetAssigned) / week.targetAssigned) * 100).toFixed(2))
                        : 0;

                    return {
                        Period: week.weekNo,
                        targetAssigned: Number(week.targetAssigned.toFixed(2)),
                        targetAchieved: Number(week.targetAchieved.toFixed(2)),
                        percentage: percentage,
                        variance: variance
                    };
                });

            return weeklyBreakdown;

        } catch (error) {
            console.error('Error in getTargetPerformance:', error);
            throw error;
        }
    }

    // Get procurement per product
    async getProcurementPerProduct(
        employeeId: string,
        month: number,
        year: number
    ) {
        try {
            const target = await this.procurementTargetRepository.findOne({
                where: {
                    employee: { id: employeeId },
                    // The URL carries a 1-12 month; this table stores 0-11.
                    // Passing it through unconverted read the *following*
                    // month's plan, which came back as "no plan found".
                    month: toPlanMonth(month, 'procurement'),
                    year: year
                },
                relations: ['employee']
            });

            if (!target) {
                return [];
            }

            const targetProducts = await this.procurementTargetProduct
                .createQueryBuilder("ptp")
                .leftJoinAndSelect("ptp.product", "product")
                .where("ptp.target.id = :targetId", { targetId: target.id })
                .getMany();

            if (targetProducts.length === 0) {
                return [];
            }

            const achievedLines = await this.fetchAchievedLines(employeeId, month, year);

            const productDataMap = new Map<string, {
                productId: string;
                productName: string;
                targetAssigned: number;
                targetAchieved: number;
            }>();

            for (const targetProduct of targetProducts) {
                const productId = targetProduct.product?.id || 'unknown';
                const productName = targetProduct.product?.name || 'Unknown Product';

                const weeklyTargets = await this.weeklyProcurementRepo.find({
                    where: { productTarget: { id: targetProduct.id } },
                    order: { weekNo: "ASC" }
                });

                let productTargetTotal = 0;
                let productAchievedTotal = 0;

                for (const week of weeklyTargets) {
                    const weekTarget = Number(week.qty || 0);
                    productTargetTotal += weekTarget;

                    // Real GRN lines, not the never-populated
                    // procurement_achievements table.
                    const weekAchieved = sumAchievedInWeek(
                        achievedLines,
                        String(targetProduct.product?.id ?? ''),
                        week.weekStartDate ? new Date(week.weekStartDate) : null,
                        week.weekEndDate ? new Date(week.weekEndDate) : null,
                    );
                    productAchievedTotal += weekAchieved;
                }

                if (!productDataMap.has(productId)) {
                    productDataMap.set(productId, {
                        productId: productId,
                        productName: productName,
                        targetAssigned: 0,
                        targetAchieved: 0
                    });
                }

                const productData = productDataMap.get(productId)!;
                productData.targetAssigned += productTargetTotal;
                productData.targetAchieved += productAchievedTotal;
            }

            const productBreakdown = Array.from(productDataMap.values())
                .map(product => {
                    const percentage = product.targetAssigned > 0
                        ? Number(((product.targetAchieved / product.targetAssigned) * 100).toFixed(2))
                        : 0;
                    
                    // Variance as percentage
                    const variance = product.targetAssigned > 0
                        ? Number((((product.targetAchieved - product.targetAssigned) / product.targetAssigned) * 100).toFixed(2))
                        : 0;

                    return {
                        productName: product.productName,
                        targetAssigned: Number(product.targetAssigned.toFixed(2)),
                        targetAchieved: Number(product.targetAchieved.toFixed(2)),
                        percentage: percentage,
                        variance: variance
                    };
                });

            return productBreakdown;

        } catch (error) {
            console.error('Error in getProcurementPerProduct:', error);
            throw error;
        }
    }

    // Get procurement report (RFPA + Deal Slip + GRN documents with target vs achievement)
    async getProcurementReport(filters: {
        employeeId: string;
        startDate: Date;
        endDate: Date;
        company?: string;
        location?: string;
        vendor?: string;
        farmer?: string;
        product?: string;
    }) {
        const { employeeId, startDate, endDate, company, location, vendor, farmer, product } = filters;

        // ── RFPA documents ───────────────────────────────────────────────────
        const rfpaQuery = this.rfpaRepository
            .createQueryBuilder('rfpa')
            .leftJoinAndSelect('rfpa.rfpaProducts', 'rfpaProducts')
            .leftJoinAndSelect('rfpaProducts.productName', 'rfpaProductName')
            .leftJoinAndSelect('rfpa.selectedVendor', 'selectedVendor')
            .leftJoinAndSelect('rfpa.selectedFarmer', 'selectedFarmer')
            .leftJoinAndSelect('rfpa.companyName', 'companyName')
            .leftJoinAndSelect('rfpa.purchaseLocation', 'purchaseLocation')
            .where('rfpa.createdBy = :employeeId', { employeeId })
            .andWhere('rfpa.createdAt >= :startDate', { startDate })
            .andWhere('rfpa.createdAt <= :endDate', { endDate })
            .andWhere('rfpa.isDeleted = false');

        if (company) {
            rfpaQuery.andWhere('LOWER(companyName.name) LIKE LOWER(:company)', { company: `%${company}%` });
        }
        if (location) {
            rfpaQuery.andWhere('LOWER(purchaseLocation.name) LIKE LOWER(:location)', { location: `%${location}%` });
        }
        if (vendor) {
            rfpaQuery.andWhere('LOWER(selectedVendor.companyName) LIKE LOWER(:vendor)', { vendor: `%${vendor}%` });
        }
        if (farmer) {
            rfpaQuery.andWhere(
                `LOWER(CONCAT(selectedFarmer.farmerfName, ' ', selectedFarmer.farmerlName)) LIKE LOWER(:farmer)`,
                { farmer: `%${farmer}%` }
            );
        }
        if (product) {
            rfpaQuery.andWhere('LOWER(rfpaProductName.name) LIKE LOWER(:product)', { product: `%${product}%` });
        }

        const rfpaDocuments = await rfpaQuery.orderBy('rfpa.createdAt', 'DESC').getMany();

        // ── Deal Slip documents ──────────────────────────────────────────────
        const dealSlipQuery = this.dealSlipRepository
            .createQueryBuilder('dealSlip')
            .leftJoinAndSelect('dealSlip.rfpa', 'rfpa')
            .leftJoinAndSelect('rfpa.rfpaProducts', 'rfpaProducts')
            .leftJoinAndSelect('rfpaProducts.productName', 'rfpaProductName')
            .leftJoinAndSelect('rfpa.selectedVendor', 'selectedVendor')
            .leftJoinAndSelect('rfpa.selectedFarmer', 'selectedFarmer')
            .leftJoinAndSelect('rfpa.companyName', 'companyName')
            .leftJoinAndSelect('rfpa.purchaseLocation', 'purchaseLocation')
            .where('dealSlip.createdBy = :employeeId', { employeeId })
            .andWhere('dealSlip.createdAt >= :startDate', { startDate })
            .andWhere('dealSlip.createdAt <= :endDate', { endDate })
            .andWhere('dealSlip.isDeleted = false');

        if (company) {
            dealSlipQuery.andWhere('LOWER(companyName.name) LIKE LOWER(:company)', { company: `%${company}%` });
        }
        if (location) {
            dealSlipQuery.andWhere('LOWER(purchaseLocation.name) LIKE LOWER(:location)', { location: `%${location}%` });
        }
        if (vendor) {
            dealSlipQuery.andWhere('LOWER(selectedVendor.companyName) LIKE LOWER(:vendor)', { vendor: `%${vendor}%` });
        }
        if (farmer) {
            dealSlipQuery.andWhere(
                `LOWER(CONCAT(selectedFarmer.farmerfName, ' ', selectedFarmer.farmerlName)) LIKE LOWER(:farmer)`,
                { farmer: `%${farmer}%` }
            );
        }
        if (product) {
            dealSlipQuery.andWhere('LOWER(rfpaProductName.name) LIKE LOWER(:product)', { product: `%${product}%` });
        }

        const dealSlipDocuments = await dealSlipQuery.orderBy('dealSlip.createdAt', 'DESC').getMany();

        // ── GRN documents ────────────────────────────────────────────────────
        const grnQuery = this.grnRepository
            .createQueryBuilder('grn')
            .leftJoinAndSelect('grn.grnProducts', 'grnProducts')
            .leftJoinAndSelect('grnProducts.productName', 'grnProductName')
            .leftJoinAndSelect('grn.selectedVendor', 'selectedVendor')
            .leftJoinAndSelect('grn.selectedFarmer', 'selectedFarmer')
            .leftJoinAndSelect('grn.companyName', 'companyName')
            .leftJoinAndSelect('grn.purchaseLocation', 'purchaseLocation')
            .where('grn.createdBy = :employeeId', { employeeId })
            .andWhere('grn.createdAt >= :startDate', { startDate })
            .andWhere('grn.createdAt <= :endDate', { endDate })
            .andWhere('grn.isDeleted = false');

        if (company) {
            grnQuery.andWhere('LOWER(companyName.name) LIKE LOWER(:company)', { company: `%${company}%` });
        }
        if (location) {
            grnQuery.andWhere('LOWER(purchaseLocation.name) LIKE LOWER(:location)', { location: `%${location}%` });
        }
        if (vendor) {
            grnQuery.andWhere('LOWER(selectedVendor.companyName) LIKE LOWER(:vendor)', { vendor: `%${vendor}%` });
        }
        if (farmer) {
            grnQuery.andWhere(
                `LOWER(CONCAT(selectedFarmer.farmerfName, ' ', selectedFarmer.farmerlName)) LIKE LOWER(:farmer)`,
                { farmer: `%${farmer}%` }
            );
        }
        if (product) {
            grnQuery.andWhere('LOWER(grnProductName.name) LIKE LOWER(:product)', { product: `%${product}%` });
        }

        const grnDocuments = await grnQuery.orderBy('grn.createdAt', 'DESC').getMany();

        // ── Target vs Achievement ────────────────────────────────────────────
        // Derive month/year from the startDate for the target lookup
        const month = startDate.getMonth() + 1; // 1-12
        const year = startDate.getFullYear();

        const target = await this.procurementTargetRepository.findOne({
            where: {
                employee: { id: employeeId },
                month: toPlanMonth(month, 'procurement'),
                year,
            },
        });

        let targetQty = 0;
        if (target) {
            targetQty = Number(target.monthlyTotalQty ?? 0);
        }

        // Sum net weight from completed GRNs in the date range
        const achievedQty = grnDocuments.reduce((sum, grn) => {
            const grnNet = (grn.grnProducts ?? []).reduce(
                (s: number, p: any) => s + Number(p.netWeight ?? 0),
                0
            );
            return sum + grnNet;
        }, 0);

        const achievementPercentage = targetQty > 0
            ? Number(((achievedQty / targetQty) * 100).toFixed(2))
            : 0;

        return {
            rfpa: { documents: rfpaDocuments },
            dealSlip: { documents: dealSlipDocuments },
            grn: { documents: grnDocuments },
            targetvsachievement: {
                targetQty: Number(targetQty.toFixed(2)),
                achievedQty: Number(achievedQty.toFixed(2)),
                achievementPercentage,
            },
        };
    }

    // Get procurement summary
    async getProcurementSummary(
        employeeId: string,
        month: number,
        year: number
    ) {
        try {
            const target = await this.procurementTargetRepository.findOne({
                where: {
                    employee: { id: employeeId },
                    // The URL carries a 1-12 month; this table stores 0-11.
                    // Passing it through unconverted read the *following*
                    // month's plan, which came back as "no plan found".
                    month: toPlanMonth(month, 'procurement'),
                    year: year
                },
                relations: ['employee']
            });

            if (!target) {
                return {
                    achievementRate: 0,
                    totalAssignedQuantity: 0,
                    totalAchievedQuantity: 0,
                    'productsExceededTarget': 0,
                    'productsOnTrack': 0,
                    'productsBelowTarget': 0,
                    'productsCritical': 0,
                    bestPerformingProduct: null,
                    needsAttention: null,
                    bestPerformingWeek: null
                };
            }

            const targetProducts = await this.procurementTargetProduct
                .createQueryBuilder("ptp")
                .leftJoinAndSelect("ptp.product", "product")
                .where("ptp.target.id = :targetId", { targetId: target.id })
                .getMany();

            let totalAssignedQuantity = 0;
            let totalAchievedQuantity = 0;

            // Product performance tracking
            const achievedLines = await this.fetchAchievedLines(employeeId, month, year);

            const productPerformance = new Map<string, {
                name: string;
                assigned: number;
                achieved: number;
                rate: number;
            }>();

            // Week performance tracking
            const weekPerformance = new Map<number, number>();

            for (const targetProduct of targetProducts) {
                const productName = targetProduct.product?.name || 'Unknown';

                const weeklyTargets = await this.weeklyProcurementRepo.find({
                    where: { productTarget: { id: targetProduct.id } }
                });

                let productAssigned = 0;
                let productAchieved = 0;

                for (const week of weeklyTargets) {
                    const weekTarget = Number(week.qty || 0);
                    productAssigned += weekTarget;
                    totalAssignedQuantity += weekTarget;

                    // Real GRN lines, not the never-populated
                    // procurement_achievements table.
                    const weekAchieved = sumAchievedInWeek(
                        achievedLines,
                        String(targetProduct.product?.id ?? ''),
                        week.weekStartDate ? new Date(week.weekStartDate) : null,
                        week.weekEndDate ? new Date(week.weekEndDate) : null,
                    );
                    productAchieved += weekAchieved;
                    totalAchievedQuantity += weekAchieved;

                    // Track week performance
                    if (!weekPerformance.has(week.weekNo)) {
                        weekPerformance.set(week.weekNo, 0);
                    }
                    weekPerformance.set(week.weekNo, weekPerformance.get(week.weekNo)! + weekAchieved);
                }

                // Calculate product achievement rate
                const productRate = productAssigned > 0 
                    ? (productAchieved / productAssigned) * 100 
                    : 0;

                productPerformance.set(productName, {
                    name: productName,
                    assigned: productAssigned,
                    achieved: productAchieved,
                    rate: productRate
                });
            }

            // Calculate achievement rate
            const achievementRate = totalAssignedQuantity > 0
                ? Number(((totalAchievedQuantity / totalAssignedQuantity) * 100).toFixed(2))
                : 0;

            // Categorize products by performance
            let productsExceeded = 0;
            let productsOnTrack = 0;
            let productsBelowTarget = 0;
            let productsCritical = 0;

            let bestProduct = { name: '', rate: -1 };
            let worstProduct = { name: '', rate: 101 };

            productPerformance.forEach((perf) => {
                if (perf.rate >= 100) productsExceeded++;
                else if (perf.rate >= 80) productsOnTrack++;
                else if (perf.rate >= 50) productsBelowTarget++;
                else productsCritical++;

                if (perf.rate > bestProduct.rate) {
                    bestProduct = { name: perf.name, rate: perf.rate };
                }
                if (perf.rate < worstProduct.rate) {
                    worstProduct = { name: perf.name, rate: perf.rate };
                }
            });

            // Find best performing week
            let bestWeek = { weekNo: 0, total: -1 };
            weekPerformance.forEach((total, weekNo) => {
                if (total > bestWeek.total) {
                    bestWeek = { weekNo, total };
                }
            });

            return {
                achievementRate: achievementRate,
                totalAssignedQuantity: Number(totalAssignedQuantity.toFixed(2)),
                totalAchievedQuantity: Number(totalAchievedQuantity.toFixed(2)),
                'productsExceededTarget': productsExceeded,
                'productsOnTrack': productsOnTrack,
                'productsBelowTarget': productsBelowTarget,
                'productsCritical': productsCritical,
                bestPerformingProduct: bestProduct.name || null,
                needsAttention: worstProduct.name || null,
                bestPerformingWeek: bestWeek.weekNo > 0 ? `Week ${bestWeek.weekNo}` : null
            };

        } catch (error) {
            console.error('Error in getProcurementSummary:', error);
            throw error;
        }
    }

    /**
     * PATCH /procurement-target/:id/approve
     * Body: { action: 'approved' | 'rejected', remark?: string }
     *
     * Rules:
     *  - Target employee स्वतः create केला (PENDING) → workflow hierarchy नुसार
     *    direct manager (depth=1 ancestor, department=procurement) approve करेल
     *  - Manager ने employee साठी create केला → directly APPROVED होतो (approval ची गरज नाही)
     */
    async approveTarget(
        targetId: string,
        managerId: string,
        action: 'approved' | 'rejected',
        remark?: string,
    ): Promise<ProcurementTarget> {
        const target = await this.procurementTargetRepository.findOne({
            where: { id: targetId },
            relations: ['employee', 'creatdeBy'],
        });

        if (!target) {
            throw new Error(`Procurement target with ID ${targetId} not found`);
        }

        // Terminal state guard
        if (target.status === ProcurementStatus.APPROVED) {
            throw new Error('Target is already approved');
        }
        if (target.status === ProcurementStatus.REJECTED) {
            throw new Error('Target is already rejected');
        }

        const employeeId = target.employee?.id;
        const createdById = target.creatdeBy?.id;

        if (target.status === ProcurementStatus.PENDING) {
            // Employee ने स्वतःसाठी create केला →
            // workflow_hierarchy मध्ये managerId चा depth=1 ancestor approve करेल
            const rows: { ancestor_id: string }[] = await this.workflowHierarchyRepo.query(
                `SELECT ancestor_id
                 FROM workflow_hierarchy
                 WHERE descendant_id = $1
                   AND ancestor_id   = $2
                   AND department    = $3
                   AND depth         = 1`,
                [employeeId, managerId, DepartmentEnum.PURCHASE],
            );

            if (rows.length === 0) {
                throw new Error('You are not the direct manager of this employee in the procurement workflow');
            }
        } else {
            throw new Error(`Target cannot be approved in its current status: ${target.status}`);
        }

        target.status = action === 'approved'
            ? ProcurementStatus.APPROVED
            : ProcurementStatus.REJECTED;

        return this.procurementTargetRepository.save(target);
    }

    /**
     * GET /procurement-target/manager/pending-approval
     * Manager ला दिसतात:
     *  - PENDING targets — workflow hierarchy नुसार manager चे direct subordinates चे
     *    subordinates ने स्वतःसाठी create केलेले (employee = createdBy, depth=1 under managerId)
     *  - Manager ने subordinate साठी create केलेले directly APPROVED होतात (pending list मध्ये येत नाहीत)
     */
    async getPendingTargetsForManager(managerId: string): Promise<any[]> {
        // workflow hierarchy मधून direct subordinates (depth=1) मिळवतो
        // यात subordinates ने स्वतःसाठी create केलेले PENDING targets cover होतात
        const subordinateRows: { descendant_id: string }[] = await this.workflowHierarchyRepo.query(
            `SELECT descendant_id
             FROM workflow_hierarchy
             WHERE ancestor_id  = $1
               AND department   = $2
               AND depth        = 1`,
            [managerId, DepartmentEnum.PURCHASE],
        );

        const subordinateIds = subordinateRows.map(r => r.descendant_id);

        const results: ProcurementTarget[] = [];

        // PENDING targets — subordinates ने स्वतःसाठी create केलेले
        // (employee IN subordinateIds AND createdBy = employee AND status = PENDING)
        if (subordinateIds.length > 0) {
            const pendingTargets = await this.procurementTargetRepository
                .createQueryBuilder('pt')
                .leftJoinAndSelect('pt.employee', 'employee')
                .leftJoinAndSelect('pt.creatdeBy', 'creatdeBy')
                .where('pt.employee_id IN (:...subordinateIds)', { subordinateIds })
                .andWhere('pt.createdby_id = pt.employee_id') // self-created
                .andWhere('pt.status = :pendingStatus', { pendingStatus: ProcurementStatus.PENDING })
                .orderBy('pt.createdAt', 'DESC')
                .getMany();

            results.push(...pendingTargets);
        }

        return results.map(t => ({
            id: t.id,
            status: t.status,
            month: t.month,
            year: t.year,
            monthlyTotalQty: t.monthlyTotalQty,
            employee: t.employee
                ? { id: t.employee.id, name: `${(t.employee as any).firstName ?? ''} ${(t.employee as any).lastName ?? ''}`.trim() }
                : null,
            createdBy: t.creatdeBy
                ? { id: t.creatdeBy.id, name: `${(t.creatdeBy as any).firstName ?? ''} ${(t.creatdeBy as any).lastName ?? ''}`.trim() }
                : null,
        }));
    }
}


    // // Update status
    // async updateStatus(id: string, payload: any) {
    //     try {
    //         const target = await this.procurementTargetRepository.findOne({
    //             where: { id }
    //         });

    //         if (!target) {
    //             throw new Error("Procurement target not found");
    //         }

    //         if (payload.status) {
    //             target.status = payload.status;
    //         }

    //         await this.procurementTargetRepository.save(target);

    //         return target;
    //     } catch (error) {
    //         throw error;
    //     }
    // }


    // // Debug endpoint - get all targets
    // async getAllTargetsDebug() {
    //     try {
    //         const targets = await this.procurementTargetRepository
    //             .createQueryBuilder('target')
    //             .leftJoinAndSelect('target.employee', 'employee')
    //             .orderBy('target.createdAt', 'DESC')
    //             .getMany();

    //         return targets;
    //     } catch (error) {
    //         throw error;
    //     }
    // }


    // // Get all targets simple (no pagination)
    // async getAllTargetsSimple(employeeId: string) {
    //     try {
    //         const targets = await this.procurementTargetRepository
    //             .createQueryBuilder('target')
    //             .leftJoinAndSelect('target.employee', 'employee')
    //             .where('target.employee.id = :employeeId', { employeeId })
    //             .orderBy('target.createdAt', 'DESC')
    //             .getMany();

    //         return { targets };
    //     } catch (error) {
    //         throw error;
    //     }
    // }


   // // Get targets for manager approval
    // async getTargetsForManagerApproval(managerId: string, department: DepartmentEnum) {
    //     try {
    //         // Get all subordinates for this manager
    //         const subordinates = await this.workflowHierarchyRepo
    //             .createQueryBuilder('wh')
    //             .select('wh.descendant_id')
    //             .where('wh.ancestor_id = :managerId', { managerId })
    //             .andWhere('wh.department = :department', { department })
    //             .andWhere('wh.depth > 0')
    //             .getRawMany();

    //         const subordinateIds = subordinates.map(s => s.descendant_id);

    //         if (subordinateIds.length === 0) {
    //             return [];
    //         }

    //         // Get pending targets for these subordinates
    //         const targets = await this.procurementTargetRepository
    //             .createQueryBuilder('target')
    //             .leftJoinAndSelect('target.employee', 'employee')
    //             .leftJoinAndSelect('target.products', 'products')
    //             .leftJoinAndSelect('products.product', 'product')
    //             .where('target.employee.id IN (:...subordinateIds)', { subordinateIds })
    //             .andWhere('target.status = :status', { status: ProcurementStatus.SUBMITTED })
    //             .orderBy('target.createdAt', 'DESC')
    //             .getMany();

    //         return targets;
    //     } catch (error) {
    //         throw error;
    //     }
    // }

