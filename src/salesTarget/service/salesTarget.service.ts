import "reflect-metadata";
import { inject, injectable } from "inversify";

import * as ExcelJS from 'exceljs';

import * as path from 'path';
import * as fs from 'fs';
import { TYPES } from "../../types";
import { SalesTargetRepository } from "../repository/salesTarget.repository";
import { UserRepository } from "../../employee/repository/user.repository";
import { CustomerRepository } from "../../customer/addcustomer/repository/customer.repository";
import { ProductRepository } from "../../product/createproduct/repository/product.repository";
import { SalesTargetProductRepository } from "../repository/salesTargetProduct.repository";
import { SalesTargetWeekRepository } from "../repository/salesTargetWeek.repository";
import { SalesAchievementRepository } from "../repository/salesAchievement.repository";
import { WorkflowHierarchyRepository } from "../../workFlow/repository/WorkflowHierarchy.repository";
import { DepartmentEnum } from "../../workFlow/entity/workflowClosure.entity";
import { SalesTarget, Status } from "../entity/salesTarget.entity";
import { User } from "../../employee/entity/user.entity";
import { EntityManager } from "typeorm";
import { AppDataSource } from "../../utils/data-source";
import AppError from "../../utils/appError";
import { SalesTargetProduct } from "../entity/salesTargetProduct.entity";
import { SalesTargetWeek } from "../entity/salesTargetWeek.entity";
import { Customer } from "../../customer/addcustomer/entity/customer.entity";
import { Product } from "../../product/createproduct/entity/product.entity";
import {
    assertCanDecidePlan,
    directReportIds,
    planActions,
    planStatusOnSave,
    PLAN_STATUS,
    selfAndTeamIds,
} from "../../workFlow/planAccess";

@injectable()
export class SalesTargetService {
    constructor(
        @inject(TYPES.SalesTargetRepository)
        private salesTargetRepository: SalesTargetRepository,
        @inject(TYPES.UserRepository)
        private userRepository: UserRepository,
        @inject(TYPES.CustomerRepository)
        private customerRepository: CustomerRepository,
        @inject(TYPES.ProductRepository)
        private productRepository: ProductRepository,
        @inject(TYPES.SalesTargetProductRepository)
        private salesTargetProduct: SalesTargetProductRepository,
        @inject(TYPES.SalesTargetWeekRepository)
        private weeklySalesRepo: SalesTargetWeekRepository,
        @inject(TYPES.SalesAchievementRepository)
        private salesAchivementRepo: SalesAchievementRepository,
        @inject(TYPES.WorkflowHierarchyRepository)
        private workflowHierarchyRepo: WorkflowHierarchyRepository
    ) {}

    /** Approval fields for a plan just saved with `decision` (see planStatusOnSave). */
    private decisionFields(decision: { status: string; approvedById: string | null }) {
        const approved = decision.status === PLAN_STATUS.APPROVED;
        return {
            status: decision.status as Status,
            approvedBy: approved ? ({ id: decision.approvedById } as User) : null,
            approvedAt: approved ? new Date() : null,
            approvalRemark: approved ? 'Approved automatically' : null,
        };
    }

    private async assertNoOtherPlan(manager: EntityManager, employeeId: string, month: number, year: number, exceptId?: string) {
        const qb = manager.getRepository(SalesTarget)
            .createQueryBuilder('t')
            .where('t.employee_id = :employeeId AND t.month = :month AND t.year = :year', { employeeId, month, year });
        if (exceptId) qb.andWhere('t.id <> :exceptId', { exceptId });
        if (await qb.getCount()) {
            throw new AppError(409, 'This employee already has a sales plan for that month. Edit the existing plan instead.');
        }
    }

    /** Writes the customer -> product -> week lines of `plan`; returns the month total. */
    private async writeLines(manager: EntityManager, target: SalesTarget, plan: any[]): Promise<number> {
        if (!Array.isArray(plan) || plan.length === 0) {
            throw new AppError(400, 'Add at least one customer to the plan');
        }
        let monthlyTotal = 0;
        for (const customerPlan of plan) {
            const customerId = customerPlan.customerId ?? customerPlan.customer;
            const customer = await manager.findOne(Customer, { where: { id: customerId } });
            if (!customer) throw new AppError(400, `Customer not found: ${customerId}`);

            for (const productPlan of customerPlan.salesTarget ?? []) {
                const productId = productPlan.productId ?? productPlan.product;
                const product = await manager.findOne(Product, { where: { id: productId } });
                if (!product) throw new AppError(400, `Product not found: ${productId}`);

                // Calculate total from weekly targets
                const calculatedTotal = productPlan.weeklyTargets.reduce(
                    (sum: number, w: any) => sum + Number(w.amount || 0), 0
                );
                const salesPlanItem = await manager.save(manager.create(SalesTargetProduct, {
                    target,
                    customer,
                    product,
                    totalProductSale: calculatedTotal,
                }));

                for (const week of productPlan.weeklyTargets) {
                    const normalizedWeekStartDate = new Date(week.startDate);
                    normalizedWeekStartDate.setHours(0, 0, 0, 0);
                    const normalizedWeekEndDate = new Date(week.endDate);
                    normalizedWeekEndDate.setHours(23, 59, 59, 999);

                    await manager.save(manager.create(SalesTargetWeek, {
                        productTarget: salesPlanItem,
                        weekNo: Number(week.weekNo),
                        weekStartDate: normalizedWeekStartDate,
                        weekEndDate: normalizedWeekEndDate,
                        saleAmount: Number(week.amount || 0),
                    }));
                }
                monthlyTotal += calculatedTotal;
            }
        }
        return monthlyTotal;
    }

    /**
     * Create sales target. Status from the reporting tree (planStatusOnSave): Pending for the
     * employee's own plan, Approved when their direct manager creates it or nobody is above them.
     */
    async create(payload: any) {
        const { employeeId, month, year, plan } = payload;
        return AppDataSource.transaction(async (manager) => {
            const user = await manager.findOne(User, { where: { id: employeeId } });
            if (!user) throw new AppError(404, "User not found");

            const decision = await planStatusOnSave(payload.createdBy, employeeId, DepartmentEnum.SALE, manager);
            await this.assertNoOtherPlan(manager, employeeId, month, year);

            const monthlyPlan = await manager.save(manager.create(SalesTarget, {
                employee: user,
                createdBy: { id: payload.createdBy } as User,
                month,
                year,
                totalMonthlySale: 0,
                ...this.decisionFields(decision),
            }));
            monthlyPlan.totalMonthlySale = await this.writeLines(manager, monthlyPlan, plan);
            return manager.save(monthlyPlan);
        });
    }

    /**
     * The employee or their direct manager edits the plan. The lines are replaced and the
     * status is worked out again as on create, so an edit by the employee goes back to Pending.
     */
    async update(targetId: string, payload: any, actorId: string) {
        return AppDataSource.transaction(async (manager) => {
            const target = await manager.findOne(SalesTarget, { where: { id: targetId }, relations: ['employee'] });
            if (!target) throw new AppError(404, 'Sales plan not found');
            const employeeId = target.employee?.id;
            if (payload.employee && payload.employee !== employeeId) {
                throw new AppError(400, 'The employee of a plan cannot be changed');
            }
            const decision = await planStatusOnSave(actorId, employeeId, DepartmentEnum.SALE, manager);
            const month = payload.month ?? target.month;
            const year = payload.year ?? target.year;
            await this.assertNoOtherPlan(manager, employeeId, month, year, targetId);

            // weeks go with their product line (ON DELETE CASCADE)
            await manager.createQueryBuilder()
                .delete()
                .from(SalesTargetProduct)
                .where('monthly_sales_plan_id = :targetId', { targetId })
                .execute();

            Object.assign(target, { month, year, ...this.decisionFields(decision) });
            target.totalMonthlySale = await this.writeLines(manager, target, payload.plan);
            return manager.save(target);
        });
    }

    /** Status, decision and what the viewer may do: the approval block of the plan screens. */
    private async approvalInfo(target: SalesTarget, viewerId?: string) {
        const actions = viewerId
            ? await planActions(viewerId, { employeeId: target.employee?.id ?? null, status: target.status }, DepartmentEnum.SALE)
            : { canEdit: false, canApprove: false };
        const by = target.approvedBy;
        return {
            employeeId: target.employee?.id ?? null,
            status: target.status,
            approvedBy: by ? `${by.firstName ?? ''} ${by.lastName ?? ''}`.trim() : null,
            approvedAt: target.approvedAt ?? null,
            approvalRemark: target.approvalRemark ?? null,
            ...actions,
        };
    }

    // Get all targets with pagination
    async getalltargets(
    employeeId: string,
    isAdmin: boolean,
    page?: number,
    limit?: number,
    filters: {
      employeeId?: string;
      customerId?: string;
      month?: number;
      year?: number;
      fromMonth?: number;
      fromYear?: number;
      toMonth?: number;
      toYear?: number;
    } = {}
  ) {
        try {

            console.log(
                "month=",filters.month
                , "year=",filters.year,
                "fromMonth=",
                filters.fromMonth, "fromYear",filters.fromYear,
                "tomonth=",filters.toMonth, "toyear=",filters.toYear
            )
            const isPaginated = page !== undefined && limit !== undefined;
            const skip = isPaginated ? (page! - 1) * limit! : 0;

            // Admins see every plan; others their own and their sales team's
            let employeeIds: string[] | null = isAdmin
                ? null
                : await selfAndTeamIds(employeeId, DepartmentEnum.SALE);

            // Filter by specific employeeId if provided
            if (filters.employeeId) {
                employeeIds = employeeIds ? employeeIds.filter(id => id === filters.employeeId) : [filters.employeeId];
            }

            if (employeeIds && employeeIds.length === 0) {
                return {
                    targets: [],
                    totalItems: 0,
                    totalPages: 0,
                    currentPage: page ?? 1
                };
            }

            const qb = this.salesTargetRepository
                .createQueryBuilder('target')
                .leftJoinAndSelect('target.employee', 'employee')
                .leftJoinAndSelect('target.approvedBy', 'approvedBy')
                .orderBy('target.createdAt', 'DESC');
            if (employeeIds) {
                qb.where('target.employee.id IN (:...employeeIds)', { employeeIds });
            }
            const team = new Set(await directReportIds(employeeId, DepartmentEnum.SALE));

            // Legacy single month/year filter
            if (filters.month !== undefined) {
                qb.andWhere('target.month = :month', { month: filters.month });
            }
            if (filters.year !== undefined) {
                qb.andWhere('target.year = :year', { year: filters.year });
            }

            // Date range filter — fromMonth/fromYear to toMonth/toYear
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
                qb.andWhere(
                    '(target.year * 12 + target.month) >= :from',
                    { from: filters.fromYear * 12 + filters.fromMonth }
                );
            } else if (filters.toMonth !== undefined && filters.toYear !== undefined) {
                qb.andWhere(
                    '(target.year * 12 + target.month) <= :to',
                    { to: filters.toYear * 12 + filters.toMonth }
                );
            }

            // customerId filter — keep only targets that have at least one
            // SalesTargetProduct linked to the given customer
            if (filters.customerId) {
                qb.andWhere(
                    `target.id IN (
                        SELECT stp."monthly_sales_plan_id"
                        FROM sales_target_products stp
                        WHERE stp."customer_id" = :customerId
                          AND stp."deletedAt" IS NULL
                    )`,
                    { customerId: filters.customerId }
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

            // Format the targets with weekly totals calculated from products
            const formattedTargets = await Promise.all(targets.map(async (target) => {
                // Get all products for this target
                const targetProducts = await this.salesTargetProduct.find({
                    where: { target: { id: target.id } }
                });

                // Calculate weekly totals
                const weeklyTotals = { week1: 0, week2: 0, week3: 0, week4: 0, week5: 0 };

                for (const product of targetProducts) {
                    const weeklyTargets = await this.weeklySalesRepo.find({
                        where: { productTarget: { id: product.id } }
                    });

                    weeklyTargets.forEach(week => {
                        const weekKey = `week${week.weekNo}` as keyof typeof weeklyTotals;
                        weeklyTotals[weekKey] += Number(week.saleAmount || 0);
                    });
                }

                // Convert month number to month name (month is 0-indexed: Jan=1, Dec=12)
                const monthName = target.month !== null && target.month >= 0 && target.month <= 11
                    ? monthNames[target.month ]
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
                    week1Total: weeklyTotals.week1,
                    week2Total: weeklyTotals.week2,
                    week3Total: weeklyTotals.week3,
                    week4Total: weeklyTotals.week4,
                    week5Total: weeklyTotals.week5,
                    totalTarget: target.totalMonthlySale || 0,
                    status: target.status,
                    employeeId: target.employee?.id ?? null,
                    approvedBy: target.approvedBy
                        ? `${target.approvedBy.firstName ?? ''} ${target.approvedBy.lastName ?? ''}`.trim()
                        : null,
                    approvedAt: target.approvedAt ?? null,
                    approvalRemark: target.approvalRemark ?? null,
                    canEdit: target.employee?.id === employeeId || team.has(target.employee?.id),
                    canApprove: team.has(target.employee?.id) && target.status === Status.PENDING,
                };
            }));

            return {
                targets: formattedTargets,
                totalItems,
                totalPages,
                currentPage: page ?? 1
            };
        } catch (error) {
            throw error;
        }
    }

    // Get monthly plan view structured
    async getMonthlyPlanViewStructured(targetId: string, viewerId?: string) {
        try {
            console.log("getMonthlyPlanViewStructured params:", { targetId });

            const salesTarget = await this.salesTargetRepository
                .createQueryBuilder("target")
                .leftJoinAndSelect("target.employee", "employee")
                .leftJoinAndSelect("target.approvedBy", "approvedBy")
                .where("target.id = :targetId", { targetId })
                .getOne();

            if (!salesTarget) {
                return {
                    employee: null,
                    month: null,
                    year: null,
                    monthlyTotalQty: 0,
                    plan: []
                };
            }

            const targetProducts = await this.salesTargetProduct.find({
                where: { target: { id: salesTarget.id } },
                relations: ["customer", "product"]
            });

            const customerMap = new Map<string, any>();
            let monthlyTotalQty = 0;

            for (const targetProduct of targetProducts) {
                if (!targetProduct.customer) {
                    continue;
                }

                const customerId = targetProduct.customer.id;
                const customerName = targetProduct.customer.organisationName || customerId;

                if (!customerMap.has(customerId)) {
                    customerMap.set(customerId, {
                        customer: customerName,
                        customerSalesTotAmt: 0,
                        salesTarget: []
                    });
                }

                const weeklyTargets = await this.weeklySalesRepo.find({
                    where: { productTarget: { id: targetProduct.id } },
                    order: { weekNo: "ASC" }
                });

                const weeklyTargetsData = weeklyTargets.map(week => ({
                    weekNo: week.weekNo,
                    startDate: week.weekStartDate?.toISOString().split('T')[0] || null,
                    endDate: week.weekEndDate?.toISOString().split('T')[0] || null,
                    amount: Number(week.saleAmount || 0)
                }));

                const weeklyTargetsTotAmt = weeklyTargets.reduce(
                    (sum, week) => sum + Number(week.saleAmount || 0),
                    0
                );

                monthlyTotalQty += weeklyTargetsTotAmt;

                customerMap.get(customerId).salesTarget.push({
                    product: targetProduct.product.name || targetProduct.product.id,
                    weeklyTargetsTotAmt: weeklyTargetsTotAmt,
                    weeklyTargets: weeklyTargetsData
                });

                customerMap.get(customerId).customerSalesTotAmt += weeklyTargetsTotAmt;
            }

            const plan = Array.from(customerMap.values());

            return {
                employee: salesTarget.employee?.firstName + ' ' + salesTarget.employee?.lastName || "Any Employee",
                month: salesTarget.month,
                year: salesTarget.year,
                monthlyTotalQty: Number(monthlyTotalQty.toFixed(2)),
                plan,
                approval: await this.approvalInfo(salesTarget, viewerId),
            };
        } catch (error) {
            throw error;
        }
    }

    // Get monthly plan update structured (with summary)
    async getMonthlyPlanUpdateStructured(targetId: string, viewerId?: string): Promise<{
        employee: string | null;
        month: number | null;
        year: number | null;
        monthlyTotalQty: number;
        plan: any[];
        summary: any;
        approval?: unknown;
    }> {
        console.log("getMonthlyPlanUpdateStructured params:", { targetId });

        const salesTarget = await this.salesTargetRepository
            .createQueryBuilder("target")
            .leftJoinAndSelect("target.employee", "employee")
            .leftJoinAndSelect("target.approvedBy", "approvedBy")
            .where("target.id = :targetId", { targetId })
            .getOne();

        if (!salesTarget) {
            return {
                employee: null,
                month: null,
                year: null,
                monthlyTotalQty: 0,
                plan: [],
                summary: {}
            };
        }

        const targetProducts = await this.salesTargetProduct.find({
            where: { target: { id: salesTarget.id } },
            relations: ["customer", "product"]
        });

        const customerMap = new Map<string, any>();
        let monthlyTotalQty = 0;
        const weeklyTotalsMap = new Map<number, number>();

        for (const targetProduct of targetProducts) {
            if (!targetProduct.customer) {
                continue;
            }

            const customerId = targetProduct.customer.id;
            const customerName = customerId;

            if (!customerMap.has(customerId)) {
                customerMap.set(customerId, {
                    customer: customerName,
                    customerSalesTotAmt: 0,
                    salesTarget: []
                });
            }

            const weeklyTargets = await this.weeklySalesRepo.find({
                where: { productTarget: { id: targetProduct.id } },
                order: { weekNo: "ASC" }
            });

            const weeklyTargetsData = weeklyTargets.map(week => {
                const amount = Number(week.saleAmount || 0);

                // Accumulate weekly totals
                if (!weeklyTotalsMap.has(week.weekNo)) {
                    weeklyTotalsMap.set(week.weekNo, 0);
                }
                weeklyTotalsMap.set(week.weekNo, weeklyTotalsMap.get(week.weekNo)! + amount);

                return {
                    weekNo: week.weekNo,
                    startDate: week.weekStartDate?.toISOString().split('T')[0] || null,
                    endDate: week.weekEndDate?.toISOString().split('T')[0] || null,
                    amount: amount
                };
            });

            const weeklyTargetsTotAmt = weeklyTargets.reduce(
                (sum, week) => sum + Number(week.saleAmount || 0),
                0
            );

            monthlyTotalQty += weeklyTargetsTotAmt;

            customerMap.get(customerId).salesTarget.push({
                product: targetProduct.product.id,
                weeklyTargetsTotAmt: weeklyTargetsTotAmt,
                weeklyTargets: weeklyTargetsData
            });

            customerMap.get(customerId).customerSalesTotAmt += weeklyTargetsTotAmt;
        }

        const plan = Array.from(customerMap.values());

        // Build summary with weekly totals
        const summary: any = {};
        const sortedWeeks = Array.from(weeklyTotalsMap.keys()).sort((a, b) => a - b);

        sortedWeeks.forEach(weekNo => {
            summary[`week${weekNo}Total`] = Number(weeklyTotalsMap.get(weekNo)!.toFixed(2));
        });

        return {
            employee: salesTarget.employee?.id || "Any Employee",
            month: salesTarget.month,
            year: salesTarget.year,
            monthlyTotalQty: Number(monthlyTotalQty.toFixed(2)),
            plan,
            summary,
            approval: await this.approvalInfo(salesTarget, viewerId),
        };
    }

 

    // Generate view plan Excel (single sheet)
    async generateViewPlanExcel(targetId: string) {
        try {
            const data = await this.getMonthlyPlanViewStructured(targetId);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Sales Plan');

            worksheet.columns = [
                { header: 'Customer', key: 'customer', width: 25 },
                { header: 'Product', key: 'product', width: 25 },
                { header: 'Week 1', key: 'week1', width: 12 },
                { header: 'Week 2', key: 'week2', width: 12 },
                { header: 'Week 3', key: 'week3', width: 12 },
                { header: 'Week 4', key: 'week4', width: 12 },
                { header: 'Week 5', key: 'week5', width: 12 },
                { header: 'Total', key: 'total', width: 12 }
            ];

            data.plan.forEach((customer: any) => {
                customer.salesTarget.forEach((product: any) => {
                    const weekData: any = { week1: 0, week2: 0, week3: 0, week4: 0, week5: 0 };
                    product.weeklyTargets.forEach((week: any) => {
                        weekData[`week${week.weekNo}`] = week.amount;
                    });

                    worksheet.addRow({
                        customer: customer.customer,
                        product: product.product,
                        week1: weekData.week1,
                        week2: weekData.week2,
                        week3: weekData.week3,
                        week4: weekData.week4,
                        week5: weekData.week5,
                        total: product.weeklyTargetsTotAmt
                    });
                });
            });

            const exportDir = path.join(process.cwd(), 'exports', 'view-plans');
            if (!fs.existsSync(exportDir)) {
                fs.mkdirSync(exportDir, { recursive: true });
            }

            const filename = `Sales_View_Plan_${targetId}_${new Date().toISOString().split('T')[0]}.xlsx`;
            const filePath = path.join(exportDir, filename);
            const relativePath = path.join('view-plans', filename);

            await workbook.xlsx.writeFile(filePath);

            const buffer = await workbook.xlsx.writeBuffer();

            return {
                buffer: Buffer.from(buffer),
                filename,
                filePath,
                relativePath,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            };
        } catch (error) {
            throw error;
        }
    }

  

    // Get target performance
    async getTargetPerformance(
        employeeId: string,
        month: number,
        year: number,
        customerId?: string,
        productId?: string
    ) {
        try {
            console.log('=== getTargetPerformance START ===');
            console.log('Input params:', { employeeId, month, year, customerId, productId });

            const dbMonth = month;
            console.log('Converted month for DB query:', dbMonth);

            const salesTarget = await this.salesTargetRepository.findOne({
                where: {
                    employee: { id: employeeId },
                    month: dbMonth,
                    year: year
                },
                relations: ['employee']
            });

            console.log('Sales target found:', salesTarget ? `ID: ${salesTarget.id}` : 'null');

            if (!salesTarget) {
                console.log('No sales target found - returning empty array');
                return [];
            }

            let targetProductsQuery = this.salesTargetProduct
                .createQueryBuilder("stp")
                .leftJoinAndSelect("stp.customer", "customer")
                .leftJoinAndSelect("stp.product", "product")
                .where("stp.target.id = :targetId", { targetId: salesTarget.id });

            if (customerId) {
                targetProductsQuery.andWhere("stp.customer.id = :customerId", { customerId });
            }

            if (productId) {
                targetProductsQuery.andWhere("stp.product.id = :productId", { productId });
            }

            const targetProducts = await targetProductsQuery.getMany();
            console.log('Target products found:', targetProducts.length);

            if (targetProducts.length === 0) {
                console.log('No target products found - returning empty array');
                return [];
            }

            const weeklyDataMap = new Map<number, {
                weekNo: number;
                period: string;
                targetAssigned: number;
                targetAchieved: number;
            }>();

            for (const targetProduct of targetProducts) {
                console.log(`Processing product: ${targetProduct.product?.name || targetProduct.id}`);

                const weeklyTargets = await this.weeklySalesRepo.find({
                    where: { productTarget: { id: targetProduct.id } },
                    order: { weekNo: "ASC" }
                });

                console.log(`  Found ${weeklyTargets.length} weekly targets`);

                for (const week of weeklyTargets) {
                    const weekTarget = Number(week.saleAmount || 0);

                    const achievements = await this.salesAchivementRepo.find({
                        where: { weeklySales: { id: week.id } }
                    });

                    const weekAchieved = achievements.reduce((sum, ach) => sum + Number(ach.achievedAmount || 0), 0);

                    console.log(`  Week ${week.weekNo}: target=${weekTarget}, achieved=${weekAchieved}`);

                    if (!weeklyDataMap.has(week.weekNo)) {
                        const startDate = week.weekStartDate ? new Date(week.weekStartDate) : null;
                        const endDate = week.weekEndDate ? new Date(week.weekEndDate) : null;

                        weeklyDataMap.set(week.weekNo, {
                            weekNo: week.weekNo,
                            period: `${startDate?.toISOString().split('T')[0] || ''} to ${endDate?.toISOString().split('T')[0] || ''}`,
                            targetAssigned: 0,
                            targetAchieved: 0
                        });
                    }

                    const weekData = weeklyDataMap.get(week.weekNo)!;
                    weekData.targetAssigned += weekTarget;
                    weekData.targetAchieved += weekAchieved;
                }
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

            console.log('Weekly breakdown created:', weeklyBreakdown.length, 'weeks');
            console.log('=== getTargetPerformance END ===');

            return weeklyBreakdown;

        } catch (error) {
            console.error('Error in getTargetPerformance:', error);
            throw error;
        }
    }

    // Get sales per customer
    async getSalesPerCustomer(
        employeeId: string,
        month: number,
        year: number
    ) {
        try {
            console.log('=== getSalesPerCustomer START ===');
            console.log('Input params:', { employeeId, month, year });

            const dbMonth = month;
            console.log('Converted month for DB query:', dbMonth);

            const salesTarget = await this.salesTargetRepository.findOne({
                where: {
                    employee: { id: employeeId },
                    month: dbMonth,
                    year: year
                },
                relations: ['employee']
            });

            console.log('Sales target found:', salesTarget ? `ID: ${salesTarget.id}` : 'null');

            if (!salesTarget) {
                console.log('No sales target found - returning empty array');
                return [];
            }

            let targetProductsQuery = this.salesTargetProduct
                .createQueryBuilder("stp")
                .leftJoinAndSelect("stp.customer", "customer")
                .leftJoinAndSelect("stp.product", "product")
                .where("stp.target.id = :targetId", { targetId: salesTarget.id });

            const targetProducts = await targetProductsQuery.getMany();
            console.log('Target products found:', targetProducts.length);

            if (targetProducts.length === 0) {
                console.log('No target products found - returning empty array');
                return [];
            }

            const customerDataMap = new Map<string, {
                customerId: string;
                customerName: string;
                targetAssigned: number;
                targetAchieved: number;
            }>();

            for (const targetProduct of targetProducts) {
                const customerId = targetProduct.customer?.id || 'unknown';
                const customerName = targetProduct.customer?.organisationName || 'Unknown Customer';

                console.log(`Processing product for customer: ${customerName}`);

                const weeklyTargets = await this.weeklySalesRepo.find({
                    where: { productTarget: { id: targetProduct.id } },
                    order: { weekNo: "ASC" }
                });

                console.log(`  Found ${weeklyTargets.length} weekly targets`);

                let productTargetTotal = 0;
                let productAchievedTotal = 0;

                for (const week of weeklyTargets) {
                    const weekTarget = Number(week.saleAmount || 0);
                    productTargetTotal += weekTarget;

                    const achievements = await this.salesAchivementRepo.find({
                        where: { weeklySales: { id: week.id } }
                    });

                    const weekAchieved = achievements.reduce((sum, ach) => sum + Number(ach.achievedAmount || 0), 0);
                    productAchievedTotal += weekAchieved;

                    console.log(`  Week ${week.weekNo}: target=${weekTarget}, achieved=${weekAchieved}`);
                }

                if (!customerDataMap.has(customerId)) {
                    customerDataMap.set(customerId, {
                        customerId: customerId,
                        customerName: customerName,
                        targetAssigned: 0,
                        targetAchieved: 0
                    });
                }

                const customerData = customerDataMap.get(customerId)!;
                customerData.targetAssigned += productTargetTotal;
                customerData.targetAchieved += productAchievedTotal;
            }

            const customerBreakdown = Array.from(customerDataMap.values())
                .map(customer => {
                    const percentage = customer.targetAssigned > 0
                        ? Number(((customer.targetAchieved / customer.targetAssigned) * 100).toFixed(2))
                        : 0;
                    const variancePercentage = customer.targetAssigned > 0
                        ? Number((((customer.targetAchieved - customer.targetAssigned) / customer.targetAssigned) * 100).toFixed(2))
                        : 0;

                    return {
                        customerName: customer.customerName,
                        targetAssigned: Number(customer.targetAssigned.toFixed(2)),
                        targetAchieved: Number(customer.targetAchieved.toFixed(2)),
                        percentage: percentage,
                        variance: variancePercentage
                    };
                });

            console.log('Customer breakdown created:', customerBreakdown.length, 'customers');
            console.log('=== getSalesPerCustomer END ===');

            return customerBreakdown;

        } catch (error) {
            console.error('Error in getSalesPerCustomer:', error);
            throw error;
        }
    }

    // Get sales per product
    async getSalesPerProduct(
        employeeId: string,
        month: number,
        year: number
    ) {
        try {
            console.log('=== getSalesPerProduct START ===');
            console.log('Input params:', { employeeId, month, year });

            const dbMonth = month;
            console.log('Converted month for DB query:', dbMonth);

            const salesTarget = await this.salesTargetRepository.findOne({
                where: {
                    employee: { id: employeeId },
                    month: dbMonth,
                    year: year
                },
                relations: ['employee']
            });

            console.log('Sales target found:', salesTarget ? `ID: ${salesTarget.id}` : 'null');

            if (!salesTarget) {
                console.log('No sales target found - returning empty array');
                return [];
            }

            let targetProductsQuery = this.salesTargetProduct
                .createQueryBuilder("stp")
                .leftJoinAndSelect("stp.customer", "customer")
                .leftJoinAndSelect("stp.product", "product")
                .where("stp.target.id = :targetId", { targetId: salesTarget.id });

            const targetProducts = await targetProductsQuery.getMany();
            console.log('Target products found:', targetProducts.length);

            if (targetProducts.length === 0) {
                console.log('No target products found - returning empty array');
                return [];
            }

            const productDataMap = new Map<string, {
                productId: string;
                productName: string;
                targetAssigned: number;
                targetAchieved: number;
            }>();

            for (const targetProduct of targetProducts) {
                const productId = targetProduct.product?.id || 'unknown';
                const productName = targetProduct.product?.name || 'Unknown Product';

                console.log(`Processing product: ${productName}`);

                const weeklyTargets = await this.weeklySalesRepo.find({
                    where: { productTarget: { id: targetProduct.id } },
                    order: { weekNo: "ASC" }
                });

                console.log(`  Found ${weeklyTargets.length} weekly targets`);

                let productTargetTotal = 0;
                let productAchievedTotal = 0;

                for (const week of weeklyTargets) {
                    const weekTarget = Number(week.saleAmount || 0);
                    productTargetTotal += weekTarget;

                    const achievements = await this.salesAchivementRepo.find({
                        where: { weeklySales: { id: week.id } }
                    });

                    const weekAchieved = achievements.reduce((sum, ach) => sum + Number(ach.achievedAmount || 0), 0);
                    productAchievedTotal += weekAchieved;

                    console.log(`  Week ${week.weekNo}: target=${weekTarget}, achieved=${weekAchieved}`);
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

            console.log('Product breakdown created:', productBreakdown.length, 'products');
            console.log('=== getSalesPerProduct END ===');

            return productBreakdown;

        } catch (error) {
            console.error('Error in getSalesPerProduct:', error);
            throw error;
        }
    }

    // Get sales summary
    async getSalesSummary(
        employeeId: string,
        month: number,
        year: number
    ) {
        try {
            const salesTarget = await this.salesTargetRepository.findOne({
                where: {
                    employee: { id: employeeId },
                    month: month,
                    year: year
                },
                relations: ['employee']
            });

            if (!salesTarget) {
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
                    bestPerformingWeek: null,
                    topCustomer: null
                };
            }

            const targetProducts = await this.salesTargetProduct
                .createQueryBuilder("stp")
                .leftJoinAndSelect("stp.product", "product")
                .leftJoinAndSelect("stp.customer", "customer")
                .where("stp.target.id = :targetId", { targetId: salesTarget.id })
                .getMany();

            let totalAssignedQuantity = 0;
            let totalAchievedQuantity = 0;

            // Product performance tracking
            const productPerformance = new Map<string, {
                name: string;
                assigned: number;
                achieved: number;
                rate: number;
            }>();

            // Week performance tracking
            const weekPerformance = new Map<number, number>();

            // Customer performance tracking
            const customerPerformance = new Map<string, number>();

            for (const targetProduct of targetProducts) {
                const productName = targetProduct.product?.name || 'Unknown';
                const customerName = targetProduct.customer?.organisationName || 'Unknown';

                const weeklyTargets = await this.weeklySalesRepo.find({
                    where: { productTarget: { id: targetProduct.id } }
                });

                let productAssigned = 0;
                let productAchieved = 0;

                for (const week of weeklyTargets) {
                    const weekTarget = Number(week.saleAmount || 0);
                    productAssigned += weekTarget;
                    totalAssignedQuantity += weekTarget;

                    const achievements = await this.salesAchivementRepo.find({
                        where: { weeklySales: { id: week.id } }
                    });

                    const weekAchieved = achievements.reduce((sum, ach) => sum + Number(ach.achievedAmount || 0), 0);
                    productAchieved += weekAchieved;
                    totalAchievedQuantity += weekAchieved;

                    // Track week performance
                    if (!weekPerformance.has(week.weekNo)) {
                        weekPerformance.set(week.weekNo, 0);
                    }
                    weekPerformance.set(week.weekNo, weekPerformance.get(week.weekNo)! + weekAchieved);

                    // Track customer performance
                    if (!customerPerformance.has(customerName)) {
                        customerPerformance.set(customerName, 0);
                    }
                    customerPerformance.set(customerName, customerPerformance.get(customerName)! + weekAchieved);
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

            // Find top customer
            let topCustomer = { name: '', total: -1 };
            customerPerformance.forEach((total, name) => {
                if (total > topCustomer.total) {
                    topCustomer = { name, total };
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
                bestPerformingWeek: bestWeek.weekNo > 0 ? `Week ${bestWeek.weekNo}` : null,
                topCustomer: topCustomer.name || null
            };

        } catch (error) {
            console.error('Error in getSalesSummary:', error);
            throw error;
        }
    }

    /**
     * PATCH /sales-target/:id/approve
     * Body: { action: 'Approved' | 'Rejected', remark?: string }; a remark is required to reject.
     * Only the employee's direct manager in the sales tree decides, only while Pending.
     */
    async approveTarget(
        targetId: string,
        managerId: string,
        action: 'Approved' | 'Rejected',
        remark?: string,
    ): Promise<SalesTarget> {
        const target = await this.salesTargetRepository.findOne({
            where: { id: targetId },
            relations: ['employee'],
        });
        if (!target) throw new AppError(404, 'Sales plan not found');

        const reason = typeof remark === 'string' ? remark.trim() : '';
        if (action === 'Rejected' && !reason) {
            throw new AppError(400, 'Give a reason for rejecting the plan');
        }
        await assertCanDecidePlan(managerId, target.employee?.id, DepartmentEnum.SALE, target.status);

        target.status = action === 'Approved' ? Status.APPROVED : Status.REJECTED;
        target.approvedBy = { id: managerId } as User;
        target.approvedAt = new Date();
        target.approvalRemark = reason || null;
        return this.salesTargetRepository.save(target);
    }

    /**
     * GET /sales-target/manager/pending-approval
     * Manager ला दिसतात:
     *  - PENDING targets — direct subordinates ने self-create केलेले
     *  - Manager ने subordinate साठी create केलेले directly APPROVED होतात (pending list मध्ये येत नाहीत)
     */
    async getPendingTargetsForManager(managerId: string): Promise<any[]> {
        const subordinateRows: { descendant_id: string }[] = await this.workflowHierarchyRepo.query(
            `SELECT descendant_id
             FROM workflow_hierarchy
             WHERE ancestor_id  = $1
               AND department   = $2
               AND depth        = 1`,
            [managerId, DepartmentEnum.SALE],
        );

        const subordinateIds = subordinateRows.map(r => r.descendant_id);
        const results: SalesTarget[] = [];

        // PENDING — subordinates ने self-create केलेले (employee = createdBy)
        if (subordinateIds.length > 0) {
            const pendingTargets = await this.salesTargetRepository
                .createQueryBuilder('st')
                .leftJoinAndSelect('st.employee', 'employee')
                .leftJoinAndSelect('st.createdBy', 'createdBy')
                .where('st.employee_id IN (:...subordinateIds)', { subordinateIds })
                .andWhere('st.status = :pendingStatus', { pendingStatus: Status.PENDING })
                .orderBy('st.createdAt', 'DESC')
                .getMany();
            results.push(...pendingTargets);
        }

        return results.map(t => ({
            id: t.id,
            status: t.status,
            month: t.month,
            year: t.year,
            totalMonthlySale: t.totalMonthlySale,
            employee: t.employee
                ? { id: t.employee.id, name: `${(t.employee as any).firstName ?? ''} ${(t.employee as any).lastName ?? ''}`.trim() }
                : null,
            createdBy: t.createdBy
                ? { id: t.createdBy.id, name: `${(t.createdBy as any).firstName ?? ''} ${(t.createdBy as any).lastName ?? ''}`.trim() }
                : null,
        }));
    }
}


  // // Generate monthly business plan Excel
    // async generateMonthlyBusinessPlanExcel(targetId: string) {
    //     try {
    //         const data = await this.getMonthlyPlanViewStructured(targetId);

    //         const workbook = new ExcelJS.Workbook();
    //         const worksheet = workbook.addWorksheet('Monthly Business Plan');

    //         // Add title
    //         worksheet.mergeCells('A1:H1');
    //         worksheet.getCell('A1').value = 'Monthly Sales Business Plan';
    //         worksheet.getCell('A1').font = { size: 16, bold: true };
    //         worksheet.getCell('A1').alignment = { horizontal: 'center' };

    //         // Add employee info
    //         worksheet.getCell('A2').value = 'Employee:';
    //         worksheet.getCell('B2').value = data.employee;
    //         worksheet.getCell('A3').value = 'Month/Year:';
    //         worksheet.getCell('B3').value = `${data.month}/${data.year}`;

    //         // Add headers
    //         worksheet.getRow(5).values = ['Customer', 'Product', 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Total'];
    //         worksheet.getRow(5).font = { bold: true };

    //         let rowIndex = 6;
    //         data.plan.forEach((customer: any) => {
    //             customer.salesTarget.forEach((product: any) => {
    //                 const weekData: any = { week1: 0, week2: 0, week3: 0, week4: 0, week5: 0 };
    //                 product.weeklyTargets.forEach((week: any) => {
    //                     weekData[`week${week.weekNo}`] = week.amount;
    //                 });

    //                 worksheet.getRow(rowIndex).values = [
    //                     customer.customer,
    //                     product.product,
    //                     weekData.week1,
    //                     weekData.week2,
    //                     weekData.week3,
    //                     weekData.week4,
    //                     weekData.week5,
    //                     product.weeklyTargetsTotAmt
    //                 ];
    //                 rowIndex++;
    //             });
    //         });

    //         const exportDir = path.join(process.cwd(), 'exports', 'monthly-plans');
    //         if (!fs.existsSync(exportDir)) {
    //             fs.mkdirSync(exportDir, { recursive: true });
    //         }

    //         const fileName = `Sales_Target_${targetId}_${new Date().toISOString().split('T')[0]}.xlsx`;
    //         const filePath = path.join(exportDir, fileName);

    //         await workbook.xlsx.writeFile(filePath);

    //         return { fileName, filePath };
    //     } catch (error) {
    //         throw error;
    //     }
    // }


   // // Generate monthly plan Excel (3 sheets)
    // async generateMonthlyPlanExcel(targetId: string) {
    //     try {
    //         const data = await this.getMonthlyPlanViewStructured(targetId);

    //         const workbook = new ExcelJS.Workbook();

    //         // Sheet 1: Summary
    //         const summarySheet = workbook.addWorksheet('Summary');
    //         summarySheet.columns = [
    //             { header: 'Employee', key: 'employee', width: 25 },
    //             { header: 'Month', key: 'month', width: 10 },
    //             { header: 'Year', key: 'year', width: 10 },
    //             { header: 'Total Amount', key: 'total', width: 15 }
    //         ];
    //         summarySheet.addRow({
    //             employee: data.employee,
    //             month: data.month,
    //             year: data.year,
    //             total: data.monthlyTotalQty
    //         });

    //         // Sheet 2: Customer-wise breakdown
    //         const customerSheet = workbook.addWorksheet('Customer Breakdown');
    //         customerSheet.columns = [
    //             { header: 'Customer', key: 'customer', width: 30 },
    //             { header: 'Total Amount', key: 'total', width: 15 }
    //         ];
    //         data.plan.forEach((customer: any) => {
    //             customerSheet.addRow({
    //                 customer: customer.customer,
    //                 total: customer.customerSalesTotAmt
    //             });
    //         });

    //         // Sheet 3: Detailed plan
    //         const detailSheet = workbook.addWorksheet('Detailed Plan');
    //         detailSheet.columns = [
    //             { header: 'Customer', key: 'customer', width: 25 },
    //             { header: 'Product', key: 'product', width: 25 },
    //             { header: 'Week 1', key: 'week1', width: 12 },
    //             { header: 'Week 2', key: 'week2', width: 12 },
    //             { header: 'Week 3', key: 'week3', width: 12 },
    //             { header: 'Week 4', key: 'week4', width: 12 },
    //             { header: 'Week 5', key: 'week5', width: 12 },
    //             { header: 'Total', key: 'total', width: 12 }
    //         ];

    //         data.plan.forEach((customer: any) => {
    //             customer.salesTarget.forEach((product: any) => {
    //                 const weekData: any = { week1: 0, week2: 0, week3: 0, week4: 0, week5: 0 };
    //                 product.weeklyTargets.forEach((week: any) => {
    //                     weekData[`week${week.weekNo}`] = week.amount;
    //                 });

    //                 detailSheet.addRow({
    //                     customer: customer.customer,
    //                     product: product.product,
    //                     week1: weekData.week1,
    //                     week2: weekData.week2,
    //                     week3: weekData.week3,
    //                     week4: weekData.week4,
    //                     week5: weekData.week5,
    //                     total: product.weeklyTargetsTotAmt
    //                 });
    //             });
    //         });

    //         const exportDir = path.join(process.cwd(), 'exports', 'monthly-plans');
    //         if (!fs.existsSync(exportDir)) {
    //             fs.mkdirSync(exportDir, { recursive: true });
    //         }

    //         const filename = `Sales_Target_${targetId}_${new Date().toISOString().split('T')[0]}.xlsx`;
    //         const filePath = path.join(exportDir, filename);
    //         const relativePath = path.join('monthly-plans', filename);

    //         await workbook.xlsx.writeFile(filePath);

    //         const buffer = await workbook.xlsx.writeBuffer();

    //         return {
    //             buffer: Buffer.from(buffer),
    //             filename,
    //             filePath,
    //             relativePath,
    //             contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    //         };
    //     } catch (error) {
    //         throw error;
    //     }
    // }


    // // Update status
    // async updateStatus(targetId: string, status: Status, managerId: string) {
    //     try {
    //         const target = await this.salesTargetRepository.findOne({
    //             where: { id: targetId }
    //         });

    //         if (!target) {
    //             throw new Error("Sales target not found");
    //         }

    //         target.status = status;
    //         await this.salesTargetRepository.save(target);

    //         return {
    //             message: "Status updated successfully",
    //             target
    //         };
    //     } catch (error) {
    //         throw error;
    //     }
    // }



    // // Review target
    // async reviewTarget(targetId: string, reviewData: any, reviewerId: string) {
    //     try {
    //         const target = await this.salesTargetRepository.findOne({
    //             where: { id: targetId }
    //         });

    //         if (!target) {
    //             throw new Error("Sales target not found");
    //         }

    //         if (reviewData.status) {
    //             target.status = reviewData.status;
    //         }

    //         await this.salesTargetRepository.save(target);
    //         return target;
    //     } catch (error) {
    //         throw error;
    //     }
    // }


    // // Get customer-wise product sales
    // async getCustomerWiseProductSales(employeeId: string, month: number, year: number) {
    //     const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    //     const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    //     console.log("Date range:", { startDate, endDate });

    //     const employee = await this.userRepository.findOne({
    //         where: { id: employeeId }
    //     });

    //     const salesTarget = await this.salesTargetRepository
    //         .createQueryBuilder("st")
    //         .where("st.employee = :employeeId", { employeeId })
    //         .andWhere("st.month = :month", { month })
    //         .andWhere("st.year = :year", { year })
    //         .getOne();

    //     if (!salesTarget) {
    //         return {
    //             employeeId,
    //             employeeName: employee?.firstName + " " + employee?.lastName,
    //             month: `${year}-${month}`,
    //             monthlySummary: { target: 0, achieved: 0, percentage: 0 },
    //             customers: []
    //         };
    //     }

    //     const targetProducts = await this.salesTargetProduct.find({
    //         where: { target: { id: salesTarget.id } },
    //         relations: ["customer", "product"]
    //     });

    //     const customerMap = new Map<string, any>();
    //     let monthlyTargetTotal = 0;
    //     let monthlyAchievedTotal = 0;

    //     for (const tp of targetProducts) {
    //         const customerId = tp.customer.id;

    //         if (!customerMap.has(customerId)) {
    //             customerMap.set(customerId, {
    //                 customerId: tp.customer.id,
    //                 customerName: tp.customer.organisationName,
    //                 products: []
    //             });
    //         }

    //         const weeks = await this.weeklySalesRepo.find({
    //             where: { productTarget: { id: tp.id } },
    //             order: { weekNo: "ASC" }
    //         });

    //         let productTargetTotal = 0;
    //         let productAchievedTotal = 0;
    //         const weeklyData = [];

    //         for (const week of weeks) {
    //             const achievedResult = await this.salesAchivementRepo
    //                 .createQueryBuilder("a")
    //                 .select("COALESCE(SUM(a.achievedAmount),0)", "total")
    //                 .where("a.weeklySales = :weekId", { weekId: week.id })
    //                 .getRawOne();

    //             const weeklyAchieved = Number(achievedResult.total);
    //             const weeklyTarget = Number(week.saleAmount);

    //             productTargetTotal += weeklyTarget;
    //             productAchievedTotal += weeklyAchieved;
    //             monthlyTargetTotal += weeklyTarget;
    //             monthlyAchievedTotal += weeklyAchieved;

    //             const startDate = week.weekStartDate ? new Date(week.weekStartDate) : null;
    //             const endDate = week.weekEndDate ? new Date(week.weekEndDate) : null;

    //             weeklyData.push({
    //                 weekNo: week.weekNo,
    //                 dateRange: `${startDate?.toISOString().slice(0, 10) || ''} to ${endDate?.toISOString().slice(0, 10) || ''}`,
    //                 target: weeklyTarget,
    //                 achieved: weeklyAchieved,
    //                 percentage: weeklyTarget > 0 ? Number(((weeklyAchieved / weeklyTarget) * 100).toFixed(2)) : 0
    //             });
    //         }

    //         customerMap.get(customerId).products.push({
    //             productId: tp.product.id,
    //             productName: tp.product.name,
    //             weekly: weeklyData,
    //             total: {
    //                 target: productTargetTotal,
    //                 achieved: productAchievedTotal,
    //                 percentage: productTargetTotal > 0 ? Number(((productAchievedTotal / productTargetTotal) * 100).toFixed(2)) : 0
    //             }
    //         });
    //     }

    //     return {
    //         employeeId,
    //         employeeName: employee?.firstName + " " + employee?.lastName,
    //         month: `${year}-${month}`,
    //         monthlySummary: {
    //             target: monthlyTargetTotal,
    //             achieved: monthlyAchievedTotal,
    //             percentage: monthlyTargetTotal > 0 ? Number(((monthlyAchievedTotal / monthlyTargetTotal) * 100).toFixed(2)) : 0
    //         },
    //         customers: Array.from(customerMap.values())
    //     };
    // }


