import { inject, injectable } from "inversify";


import { DataSource } from "typeorm";
import { TYPES } from "../../types";
import { WorkflowHierarchyRepository } from "../../workFlow/repository/WorkflowHierarchy.repository";
import { ProcurementTargetRepository } from "../../procurementTarget/repository/procurementTarget.repository";
import { GrnRepository } from "../../grn/repository/grn.repository";
import { SalesTargetRepository } from "../../salesTarget/repository/salesTarget.repository";
import { InvoiceRepository } from "../../invoice/repository/invoice.repository";
import { UserRepository } from "../../employee/repository/user.repository";
import { CustomerRepository } from "../../customer/addcustomer/repository/customer.repository";
import { VendorRepository } from "../../vendor/createVendor/repository/vendor.repository";
import { FarmerRepository } from "../../farmer/repository/farmer.repository";
import { GrnProductRepository } from "../../grn/repository/grnProduct.repository";
import { SalesTargetProductRepository } from "../../salesTarget/repository/salesTargetProduct.repository";
import { SalesTargetWeekRepository } from "../../salesTarget/repository/salesTargetWeek.repository";
import { DepartmentEnum, normalizeDepartment, WorkflowHierarchy } from "../../workFlow/entity/workflowClosure.entity";
import { Status } from "../../utils/status.enum";
import { User } from "../../employee/entity/user.entity";
import { Documentb, DocumentStatus, DocumentTypeEnum } from "../../approvalFlow/entity/docuemnt.entity";
import { Invoice } from "../../invoice/entity/invoice.entity";
import { GRN } from "../../grn/entity/grn.entity";
import { SalesTargetWeek } from "../../salesTarget/entity/salesTargetWeek.entity";
import { SalesTargetProduct } from "../../salesTarget/entity/salesTargetProduct.entity";


@injectable()
export class DashboardService {
    constructor(
        @inject(TYPES.WorkflowHierarchyRepository) private workflowHierarchyRepo: WorkflowHierarchyRepository,
        @inject(TYPES.ProcurementTargetRepository) private procurementTargetRepo: ProcurementTargetRepository,
        @inject(TYPES.GrnRepository) private grnRepo: GrnRepository,
        @inject(TYPES.SalesTargetRepository) private saleTargetRepo: SalesTargetRepository,
        @inject(TYPES.InvoiceRepository) private finalInvoiceRepo: InvoiceRepository,
        @inject(TYPES.UserRepository) private userRepo: UserRepository,
        @inject(TYPES.CustomerRepository) private customerRepo:CustomerRepository,
        @inject(TYPES.VendorRepository)private vendorRepo:VendorRepository,
        @inject(TYPES.FarmerRepository) private farmerRepo:FarmerRepository,
        @inject(TYPES.DataSource) private dataSource: DataSource,
        @inject(TYPES.GrnProductRepository) private grnProductRepo:GrnProductRepository,
        @inject(TYPES.SalesTargetRepository) private salesTargetRepo: SalesTargetRepository,
        @inject(TYPES.SalesTargetProductRepository) private salesTargetProductRepo: SalesTargetProductRepository,
         @inject(TYPES.SalesTargetWeekRepository) private salesTargetWeekRepo: SalesTargetWeekRepository,

    ){}

//TODO:Get procurement team performance metrics for a manager
//   async getProcurementTeamPerformance(userId: string): Promise<any> {
// const teamMembers = await this.workflowHierarchyRepo.find({
//   where: {
//     ancestor: { id: userId },
//     department: DepartmentEnum.PURCHASE,
//     //depth: 1 // direct team members
//   },
//   relations: ["descendant"]
// });

// const memberIds = [
//   ...new Set(teamMembers.map(t => String(t.descendant.id)))
// ];
// console.log("Team Member IDs in DashboardService:", memberIds);
// const totalTeamMembers = memberIds.length;

// const currentMonth = new Date().getMonth();
// const currentYear = new Date().getFullYear();

// console.log("Current Month in DashboardService:", currentMonth);
// console.log("Current year",currentYear);

// const activeMembers = await this.procurementTargetRepo
//   .createQueryBuilder("target")
//   .select("DISTINCT target.employee_id", "employeeId")
//   .where("target.employee_id::text IN (:...ids)", { ids: memberIds })
//   .andWhere("target.month = :month", { month: currentMonth })
//   .andWhere("target.year = :year", { year: currentYear })
//   .getRawMany();

//   const activeIds = activeMembers.map(a => a.employeeId);
//   const activeMemberCount = activeIds.length;
//   const inactiveMemberCount = memberIds.length - activeMemberCount;
//   console.log("Active Member IDs in DashboardService:", activeIds);
//   console.log("Active Member Count in DashboardService:", activeMemberCount);
//   console.log("Inactive Member Count in DashboardService:", inactiveMemberCount);

//    // 👉 Amount query (NO JOIN)
//   const amountResult = await this.grnRepo
//     .createQueryBuilder("grn")
//     .innerJoin(
//       "documents",
//       "doc",
//       "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
//       {
//         type: "grn",
//         status: "COMPLETE"
//       }
//     )
//     .select("COALESCE(SUM(grn.totalAmt), 0)", "totalAmount")
//     .where("grn.createdby_id::text IN (:...ids)", { ids: memberIds })
//      .andWhere("grn.createdAt <= :today", { today: new Date() })
//     .getRawOne();

//   // 👉 Quantity query (WITH JOIN)
//   const qtyResult = await this.grnRepo
//     .createQueryBuilder("grn")
//     .innerJoin(
//       "documents",
//       "doc",
//       "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
//       {
//         type: "grn",
//         status: "COMPLETE"
//       }
//     )
//     .leftJoin("grn.grnProducts", "product")
//     .select("COALESCE(SUM(product.netWeight), 0)", "totalQty")
//     .where("grn.createdby_id::text IN (:...ids)", { ids: memberIds })
//     .andWhere("grn.createdAt <= :today", { today: new Date() })
//     .getRawOne();

//  const totalProcurementAmount= Number(amountResult?.totalAmount || 0)
//  const totalProcurementQty= Number(qtyResult?.totalQty || 0)
// console.log("Total Procurement Amount in DashboardService:", totalProcurementAmount);
// console.log("Total Procurement Quantity in DashboardService:", totalProcurementQty);

// const targets = await this.procurementTargetRepo
//   .createQueryBuilder("target")
//   .select("SUM(target.monthlyTotalQty)", "totalTarget")
//   .where("target.employee_id::text IN (:...ids)", { ids: memberIds })
//   .andWhere("target.month = :month", { month: currentMonth })
//   .andWhere("target.year = :year", { year: currentYear })
//   .getRawOne();
//   const AsignedTargetQty = Number(targets?.totalTarget || 0);

// const newCurrentMnth=new Date().getMonth()+1;
//   const result1 = await this.grnRepo
//   .createQueryBuilder("grn")
//   .innerJoin(
//     "documents",
//     "doc",
//     "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
//     {
//       type: "grn",
//       status: "COMPLETE"
//     }
//   )
//   .leftJoin("grn.grnProducts", "product")
//   .select("SUM(product.netWeight)", "achievedQty")
//   .where("grn.createdby_id::text IN (:...ids)", { ids: memberIds })
//   .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: newCurrentMnth })
//   .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: currentYear })
//   .getRawOne();

//   const achievedQty = Number(result1?.achievedQty || 0);

//   const achievementRate = AsignedTargetQty > 0
//   ? (achievedQty / AsignedTargetQty) * 100
//   : 0;

//    const variance = AsignedTargetQty - achievedQty;
//    return{
//     totalTeamMembers:totalTeamMembers,
//     activeMembers:activeMemberCount,
//     inactiveMembers:inactiveMemberCount,
//     totalProcurementAmount:totalProcurementAmount,  
//     totalProcurementQty:totalProcurementQty,
//     AsignedTargetQty:AsignedTargetQty,
//     achievedQty:achievedQty,
//     achievementRate:achievementRate,
//     variance:variance
//    }
//   }

  //TODO:Get Sale team performance metrics for a manager
// async getSaleTeamPerformance(userId: string): Promise<any> {
// const teamMembers = await this.workflowHierarchyRepo.find({
//   where: {
//     ancestor: { id: userId },
//     department: DepartmentEnum.SALE,
//     //depth: 1 // direct team members
//   },
//   relations: ["descendant"]
// });

// const memberIds = [
//   ...new Set(teamMembers.map(t => String(t.descendant.id)))
// ];
// //const memberIds = teamMembers.map(t => t.descendant.id);
// const totalTeamMembers = memberIds.length;

// const currentMonth = new Date().getMonth();
// const currentYear = new Date().getFullYear();
// const activeMembers = await this.saleTargetRepo
//   .createQueryBuilder("target")
//   .select("DISTINCT target.employee_id", "employeeId")
//   .where("target.employee_id::text IN (:...ids)", { ids: memberIds })
//   .andWhere("target.month = :month", { month: currentMonth })
//   .andWhere("target.year = :year", { year: currentYear })
//   .getRawMany();

//   const activeIds = activeMembers.map(a => a.employeeId);
//   const activeMemberCount = activeIds.length;
//   const inactiveMemberCount = memberIds.length - activeMemberCount;

//   const result = await this.finalInvoiceRepo
//   .createQueryBuilder("invoice")
//   .innerJoin(
//     "documents",
//     "doc",
//     "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
//     {
//       type: "final-invoice",
//       status: "COMPLETE"
//     }
//   )
//   .select("SUM(invoice.totalAmount)", "totalAmount")
//   .addSelect("SUM(invoice.netProductWeight)", "totalQty")
//   .where("invoice.created_by::text IN (:...ids)", { ids: memberIds })
//   .andWhere("invoice.createdAt <= :today", { today: new Date() })
//   .getRawOne();

//  const totalSaleAmount= Number(result?.totalAmount || 0)
//  const totalSaleQty= Number(result?.totalQty || 0)

// const targets = await this.saleTargetRepo
//   .createQueryBuilder("target")
//   .select("SUM(target.totalMonthlySale)", "totalTarget")
//   .where("target.employee_id::text IN (:...ids)", { ids: memberIds })
//   .andWhere("target.month = :month", { month: currentMonth })
//   .andWhere("target.year = :year", { year: currentYear })
//   .getRawOne();
//   const AsignedTargetQty = Number(targets?.totalTarget || 0);

//   const newCurrentMnth=new Date().getMonth()+1;
//   const result1 = await this.finalInvoiceRepo
//   .createQueryBuilder("invoice")
//   .innerJoin(
//     "documents",
//     "doc",
//     "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
//     {
//       type: "final-invoice",
//       status: "COMPLETE"
//     }
//   )
//   .select("SUM(invoice.netProductWeight)", "totalQty")
//   .where("invoice.created_by::text IN (:...ids)", { ids: memberIds })
//   .andWhere("EXTRACT(MONTH FROM invoice.createdAt) = :month", { month: newCurrentMnth })
//   .andWhere("EXTRACT(YEAR FROM invoice.createdAt) = :year", { year: currentYear })
//   .getRawOne();

//   const achievedQty = Number(result1?.totalQty || 0);

//   const achievementRate = AsignedTargetQty > 0
//   ? (achievedQty / AsignedTargetQty) * 100
//   : 0;

//    const variance = AsignedTargetQty - achievedQty;
//    return{
//     totalTeamMembers:totalTeamMembers,
//     activeMembers:activeMemberCount,
//     inactiveMembers:inactiveMemberCount,
//     totalSaleAmount:totalSaleAmount,  
//     totalSaleQty:totalSaleQty,
//     AsignedTargetQty:AsignedTargetQty,
//     achievedQty:achievedQty,
//     achievementRate:achievementRate,
//     variance:variance
//    }
//   }

  
  //TODO:Get procurement source wise performance metrics for a manager
async getProcurementSourceWise(userId: string, month?: number, year?: number): Promise<any> {
  const teamMembers = await this.workflowHierarchyRepo.find({
    where: {
      ancestor: { id: userId },
      department: DepartmentEnum.PURCHASE,
      //depth: 1
    },
    relations: ["descendant"]
  });

  //  const teamMembers = await this.workflowHierarchyRepo
  //   .createQueryBuilder("wh")
  //   .leftJoinAndSelect("wh.descendant", "descendant")
  //   .where("wh.ancestor.id = :teamLeaderId", {
  //     teamLeaderId: userId
  //   })
  //   .andWhere("wh.department = :dept", {
  //     dept: DepartmentEnum.PURCHASE
  //   })
  //   .andWhere("wh.depth > 0")
  //   .getMany();

  //const memberIds = teamMembers.map(t => t.descendant.id);

  const memberIds = [
  ...new Set(teamMembers.map(t => String(t.descendant.id)))
];

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  const currentDate = new Date();

  const selectedMonth =
    month || currentDate.getMonth() + 1;

  const selectedYear =
    year || currentDate.getFullYear();

    let currentMonth1=month?selectedMonth+1:selectedMonth;

  // 🔥 Parallel execution (performance boost)
  const [vendorData, farmerData] = await Promise.all([
    this.getProcurementMetrics(memberIds, "vendor", currentMonth1, selectedYear),
    this.getProcurementMetrics(memberIds, "farmer", currentMonth1, selectedYear)
  ]);

  return {
    totalProcurementAmountByVendor: vendorData.amount,
    totalProcurementQtyByVendor: vendorData.qty,
    totalProcurementAmountByFarmer: farmerData.amount,
    totalProcurementQtyByFarmer: farmerData.qty
  };
}

  private async getProcurementMetrics(
  memberIds: string[],
  source: "vendor" | "farmer",
  currentMonth: number,
  currentYear: number
) {
  // 👉 Amount query (NO JOIN)
  const amountResult = await this.grnRepo
    .createQueryBuilder("grn")
    .innerJoin(
      "documents",
      "doc",
      "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
      {
        type: "grn",
        status: "COMPLETE"
      }
    )
    .select("COALESCE(SUM(grn.totalAmt), 0)", "totalAmount")
    .where("grn.createdby_id::text IN (:...ids)", { ids: memberIds })
    .andWhere("grn.source = :source", { source })
    .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: currentMonth })
    .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: currentYear })
    .getRawOne();

  // 👉 Quantity query (WITH JOIN)
  const qtyResult = await this.grnRepo
    .createQueryBuilder("grn")
    .innerJoin(
      "documents",
      "doc",
      "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
      {
        type: "grn",
        status: "COMPLETE"
      }
    )
    .leftJoin("grn.grnProducts", "product")
    .select("COALESCE(SUM(product.netWeight), 0)", "totalQty")
    .where("grn.createdby_id::text IN (:...ids)", { ids: memberIds })
    .andWhere("grn.source = :source", { source })
    .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: currentMonth })
    .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: currentYear })
    .getRawOne();

  return {
    amount: Number(amountResult?.totalAmount || 0),
    qty: Number(qtyResult?.totalQty || 0)
  };
   }


//TODO:Get procurement team members performance metrics for a manager
// async getProcurementTeamMembersPerformance(userId: string): Promise<any> {
//   const teamMembers = await this.workflowHierarchyRepo.find({
//   where: {
//     ancestor: { id: userId },
//     department: DepartmentEnum.PURCHASE,
//    //depth: 1 // direct team members
//   },
//   relations: ["descendant"]
// });

// const memberIds = [
//   ...new Set(teamMembers.map(t => String(t.descendant.id)))
// ];

// const currentMonth = new Date().getMonth();
// const newCurrenetMonth=new Date().getMonth()+1;
// const currentYear = new Date().getFullYear();

// const performanceData = [];
// for (const memberId of memberIds) {

//   const employee = await this.userRepo.findOne({
//   where: { id: memberId },
//   select: ["id", "firstName", "lastName"]
// });

// const employeeName = employee
//   ? `${employee.firstName} ${employee.lastName}`
//   : "Unknown";

//    // 👉 Amount query (NO JOIN)
//   const amountResult = await this.grnRepo
//     .createQueryBuilder("grn")
//     .innerJoin(
//       "documents",
//       "doc",
//       "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
//       {
//         type: "grn",
//         status: "COMPLETE"
//       }
//     )
//     .select("COALESCE(SUM(grn.totalAmt), 0)", "totalAmount")
//     .where("grn.createdby_id::text = :id", { id: memberId })
//     .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: newCurrenetMonth })
//     .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: currentYear })
//     .getRawOne();

//  const totalProcurementAmount= Number(amountResult?.totalAmount || 0)

//  const targets = await this.procurementTargetRepo
//   .createQueryBuilder("target")
//   .select("SUM(target.monthlyTotalQty)", "totalTarget")
//   .where("target.employee_id::text = :id", { id: memberId })
//   .andWhere("target.month = :month", { month: currentMonth })
//   .andWhere("target.year = :year", { year: currentYear })
//   .getRawOne();
//   const AsignedTargetQty = Number(targets?.totalTarget || 0);

//   const result1 = await this.grnRepo
//   .createQueryBuilder("grn")
//   .innerJoin(
//     "documents",
//     "doc",
//     "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
//     {
//       type: "grn",
//       status: "COMPLETE"
//     }
//   )
//   .leftJoin("grn.grnProducts", "product")
//   .select("SUM(product.netWeight)", "achievedQty")
//   .where("grn.createdby_id::text = :id", { id: memberId })
//   .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: newCurrenetMonth })
//   .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: currentYear })
//   .getRawOne();

//   const achievedQty = Number(result1?.achievedQty || 0);

//   const achievementRate = AsignedTargetQty > 0
//   ? (achievedQty / AsignedTargetQty) * 100
//   : 0;

//    const variance = AsignedTargetQty - achievedQty;

//    const grnCountResult = await this.grnRepo
//   .createQueryBuilder("grn")
//   .innerJoin(
//     "documents",
//     "doc",
//     "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
//     {
//       type: "grn",
//       status: "COMPLETE"
//     }
//   )
//   .select("COUNT(grn.id)", "grnCount")
//   .where("grn.createdby_id::text = :id", { id: memberId })
//   .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: newCurrenetMonth })
//   .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: currentYear })
//   .getRawOne();

// const grnCount = Number(grnCountResult?.grnCount || 0);

//  performanceData.push({
//   employeeName: employeeName,
//   totalProcurementAmount: totalProcurementAmount,
//   AsignedTargetQty: AsignedTargetQty,
//   achievedQty: achievedQty,
//   achievementRate: achievementRate,
//   variance: variance,
//    totalGRNs: grnCount
//  });
// }
// return performanceData;
// }


//TODO:Get sale team members performance metrics for a manager
// async getSaleTeamMembersPerformance(userId: string): Promise<any> {
//    const teamMembers = await this.workflowHierarchyRepo.find({
//   where: {
//     ancestor: { id: userId },
//     department: DepartmentEnum.SALE,
//    //depth: 1 // direct team members
//   },
//   relations: ["descendant"]
// });

// const memberIds = [
//   ...new Set(teamMembers.map(t => String(t.descendant.id)))
// ];

// const currentMonth = new Date().getMonth();
// const newCurrenetMonth=new Date().getMonth()+1;
// const currentYear = new Date().getFullYear();

// const performanceData = [];

// for (const memberId of memberIds) {

//   const employee = await this.userRepo.findOne({
//   where: { id: memberId },
//   select: ["id", "firstName", "lastName"]
// });

// const employeeName = employee
//   ? `${employee.firstName} ${employee.lastName}`
//   : "Unknown";

// const targets = await this.saleTargetRepo
//   .createQueryBuilder("target")
//   .select("SUM(target.totalMonthlySale)", "totalTarget")
//   .where("target.employee_id::text =:ids", { ids: memberId })
//   .andWhere("target.month = :month", { month: currentMonth })
//   .andWhere("target.year = :year", { year: currentYear })
//   .getRawOne();
//   const AsignedTargetQty = Number(targets?.totalTarget || 0);

//  const result1 = await this.finalInvoiceRepo
//   .createQueryBuilder("invoice")
//   .innerJoin(
//     "documents",
//     "doc",
//     "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
//     {
//       type: "final-invoice",
//       status: "COMPLETE"
//     }
//   )
//   .select("SUM(invoice.netProductWeight)", "totalQty")
//   .addSelect("SUM(invoice.totalAmount)", "totalAmount")
//   .where("invoice.created_by::text = :ids", { ids: memberId })
//   .andWhere("EXTRACT(MONTH FROM invoice.createdAt) = :month", { month: newCurrenetMonth })
//   .andWhere("EXTRACT(YEAR FROM invoice.createdAt) = :year", { year: currentYear })
//   .getRawOne();

//   const achievedQty = Number(result1?.totalQty || 0);
//   const totalSaleAmount= Number(result1?.totalAmount || 0)

//    const achievementRate = AsignedTargetQty > 0
//   ? (achievedQty / AsignedTargetQty) * 100
//   : 0;

//    const variance = AsignedTargetQty - achievedQty;

//  const result2 = await this.finalInvoiceRepo
//   .createQueryBuilder("invoice")
//   .innerJoin(
//     "documents",
//     "doc",
//     "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
//     {
//       type: "final-invoice",
//       status: "COMPLETE"
//     }
//   )
//   .select("COUNT(invoice.id)", "invoiceCount")
//   .where("invoice.created_by::text = :ids", { ids: memberId })
//   .andWhere("EXTRACT(MONTH FROM invoice.createdAt) = :month", { month: newCurrenetMonth })
//   .andWhere("EXTRACT(YEAR FROM invoice.createdAt) = :year", { year: currentYear })
//   .getRawOne();

//   const invoiceCount = Number(result2?.invoiceCount || 0);

//   performanceData.push({
//   employeeName: employeeName,
//   totalSaleAmount: totalSaleAmount,
//   AsignedTargetQty: AsignedTargetQty,
//   achievedQty: achievedQty,
//   achievementRate: achievementRate,
//   variance: variance,
//   totalInvoices: invoiceCount
//  });
// }
// return performanceData; 
// }

// ─── helper: get descendant employee IDs for a team leader ────────────────
  // private async getEmployeeIds(teamLeaderId: string): Promise<string[]> {
  //   const rows = await this.workflowHierarchyRepo.find({
  //     where: { ancestor: { id: teamLeaderId } },
  //     relations: ["descendant"],
  //   });
  //   return [...new Set(rows.map((r: WorkflowHierarchy) => r.descendant.id))];
  // }

  /**
   * Top 5 customers by highest sales (final invoices with COMPLETE document status).
   *
   * Query params:
   *  - teamLeaderId (optional): scopes to employees under that team leader.
   */
  // public async getTop5Customer(query: any): Promise<any> {
  //   const teamLeaderId: string | undefined = query.teamLeaderId as string | undefined;

  //   let employeeIds: string[] | null = null;

  //   if (teamLeaderId) {
  //     employeeIds = await this.getEmployeeIds(teamLeaderId);

  //     if (employeeIds.length === 0) {
  //       return {
  //         teamLeaderId,
  //         top5Customers: [],
  //         message: "No employees found under this team leader",
  //       };
  //     }
  //   }

  //   // Subquery: Invoice IDs whose document status is COMPLETE
  //   const completedInvoiceIds = this.dataSource
  //     .getRepository(Documentb)
  //     .createQueryBuilder("doc")
  //     .select("doc.document_type_id")
  //     .where("doc.type = :invType", { invType: DocumentTypeEnum.FINAL_INVOICE })
  //     .andWhere("doc.status = :invStatus", { invStatus: DocumentStatus.COMPLETE })
  //     .andWhere("doc.isDeleted = false");

  //   const invoiceQuery = this.dataSource
  //     .getRepository(Invoice)
  //     .createQueryBuilder("invoice")
  //     .innerJoin("invoice.customerName", "customer")
  //     .select([
  //       "customer.id                           AS \"customerId\"",
  //       "customer.organisationName             AS \"customerName\"",
  //       "customer.customerCode                 AS \"customerCode\"",
  //       "customer.primaryContactNo             AS \"primaryContactNo\"",
  //       "COALESCE(SUM(invoice.totalAmount), 0) AS \"totalSalesAmount\"",
  //       "COUNT(invoice.id)                     AS \"totalInvoices\"",
  //     ])
  //     .where("invoice.isDeleted = false")
  //     .andWhere("customer.isDeleted = false")
  //     .andWhere("customer.id IS NOT NULL")
  //     .andWhere(`CAST(invoice.id AS varchar) IN (${completedInvoiceIds.getQuery()})`)
  //     .setParameters(completedInvoiceIds.getParameters());

  //   if (employeeIds) {
  //     invoiceQuery.andWhere("invoice.createdBy IN (:...employeeIds)", { employeeIds });
  //   }

  //   const results = await invoiceQuery
  //     .groupBy("customer.id, customer.organisationName, customer.customerCode, customer.primaryContactNo")
  //     .orderBy("\"totalSalesAmount\"", "DESC")
  //     .limit(5)
  //     .getRawMany();

  //   const top5 = results.map((row) => ({
  //     customerId: row.customerId,
  //     customerName: row.customerName,
  //     customerCode: row.customerCode,
  //     primaryContactNo: row.primaryContactNo,
  //     totalSalesAmount: Number(row.totalSalesAmount),
  //     totalInvoices: Number(row.totalInvoices),
  //   }));

  //   return {
  //     teamLeaderId: teamLeaderId || null,
  //     top5Customers: top5,
  //   };
  // }

  /**
   * Top 5 farmers by highest purchase quantity (netWeight).
   * Only GRNs whose document status is COMPLETE are counted.
   *
   * Query params:
   *  - teamLeaderId (optional): scopes to employees under that team leader.
   */
  // public async getTop5Farmer(query: any): Promise<any> {
  //   const teamLeaderId: string | undefined = query.teamLeaderId as string | undefined;

  //   let employeeIds: string[] | null = null;

  //   if (teamLeaderId) {
  //     employeeIds = await this.getEmployeeIds(teamLeaderId);

  //     if (employeeIds.length === 0) {
  //       return {
  //         teamLeaderId,
  //         top5Farmers: [],
  //         message: "No employees found under this team leader",
  //       };
  //     }
  //   }

  //   const completedGrnIds = this.dataSource
  //     .getRepository(Documentb)
  //     .createQueryBuilder("doc")
  //     .select("doc.document_type_id")
  //     .where("doc.type = :type", { type: DocumentTypeEnum.GRN })
  //     .andWhere("doc.status = :status", { status: DocumentStatus.COMPLETE })
  //     .andWhere("doc.isDeleted = false");

  //   const grnQuery = this.dataSource
  //     .getRepository(GRN)
  //     .createQueryBuilder("grn")
  //     .innerJoin("grn.grnProducts", "grnProduct")
  //     .innerJoin("grn.selectedFarmer", "farmer")
  //     .select([
  //       "farmer.id                                                                        AS \"farmerId\"",
  //       "CONCAT(farmer.farmerfName, ' ', farmer.farmermName, ' ', farmer.farmerlName)     AS \"farmerName\"",
  //       "farmer.farmerCode                                                                AS \"farmerCode\"",
  //       "farmer.primaryMobileNo                                                           AS \"primaryMobileNo\"",
  //       "COALESCE(SUM(grnProduct.netWeight), 0)                                           AS \"totalQuantity\"",
  //       "COUNT(DISTINCT grn.id)                                                           AS \"totalGRNs\"",
  //       "COALESCE(SUM(grn.totalAmt), 0)                                                   AS \"totalPurchaseAmount\"",
  //     ])
  //     .where("grn.isDeleted = false")
  //     .andWhere("farmer.isDeleted = false")
  //     .andWhere("farmer.id IS NOT NULL")
  //     .andWhere("grn.source = :source", { source: "farmer" })
  //     .andWhere("grn.grnType = :grnType", { grnType: "purchase" })
  //     .andWhere(`CAST(grn.id AS varchar) IN (${completedGrnIds.getQuery()})`)
  //     .setParameters(completedGrnIds.getParameters());

  //   if (employeeIds) {
  //     grnQuery.andWhere("grn.createdBy IN (:...employeeIds)", { employeeIds });
  //   }

  //   const results = await grnQuery
  //     .groupBy("farmer.id, farmer.farmerfName, farmer.farmermName, farmer.farmerlName, farmer.farmerCode, farmer.primaryMobileNo")
  //     .orderBy("\"totalQuantity\"", "DESC")
  //     .limit(5)
  //     .getRawMany();

  //   const top5 = results.map((row) => ({
  //     farmerId: row.farmerId,
  //     farmerName: row.farmerName?.trim() || "Unknown",
  //     farmerCode: row.farmerCode,
  //     primaryMobileNo: row.primaryMobileNo,
  //     totalQuantity: Number(row.totalQuantity),
  //     totalGRNs: Number(row.totalGRNs),
  //     totalPurchaseAmount: Number(row.totalPurchaseAmount),
  //   }));

  //   return {
  //     teamLeaderId: teamLeaderId || null,
  //     top5Farmers: top5,
  //   };
  // }

  /**
   * Top 5 vendors by highest purchase quantity (netWeight).
   * Only GRNs whose document status is COMPLETE are counted.
   *
   * Query params:
   *  - teamLeaderId (optional): scopes to employees under that team leader.
   */
  // public async getTop5Vendor(query: any): Promise<any> {
  //   const teamLeaderId: string | undefined = query.teamLeaderId as string | undefined;

  //   let employeeIds: string[] | null = null;

  //   if (teamLeaderId) {
  //     employeeIds = await this.getEmployeeIds(teamLeaderId);

  //     if (employeeIds.length === 0) {
  //       return {
  //         teamLeaderId,
  //         top5Vendors: [],
  //         message: "No employees found under this team leader",
  //       };
  //     }
  //   }

  //   const completedGrnIds = this.dataSource
  //     .getRepository(Documentb)
  //     .createQueryBuilder("doc")
  //     .select("doc.document_type_id")
  //     .where("doc.type = :type", { type: DocumentTypeEnum.GRN })
  //     .andWhere("doc.status = :status", { status: DocumentStatus.COMPLETE })
  //     .andWhere("doc.isDeleted = false");

  //   const grnQuery = this.dataSource
  //     .getRepository(GRN)
  //     .createQueryBuilder("grn")
  //     .innerJoin("grn.grnProducts", "grnProduct")
  //     .innerJoin("grn.selectedVendor", "vendor")
  //     .select([
  //       "vendor.id                              AS \"vendorId\"",
  //       "vendor.companyName                     AS \"vendorName\"",
  //       "vendor.vendorCode                      AS \"vendorCode\"",
  //       "vendor.officeContactNo                 AS \"officeContactNo\"",
  //       "COALESCE(SUM(grnProduct.netWeight), 0)  AS \"totalQuantity\"",
  //       "COUNT(DISTINCT grn.id)                 AS \"totalGRNs\"",
  //       "COALESCE(SUM(grn.totalAmt), 0)         AS \"totalPurchaseAmount\"",
  //     ])
  //     .where("grn.isDeleted = false")
  //     .andWhere("vendor.isDeleted = false")
  //     .andWhere("vendor.id IS NOT NULL")
  //     .andWhere("grn.source = :source", { source: "vendor" })
  //     .andWhere("grn.grnType = :grnType", { grnType: "purchase" })
  //     .andWhere(`CAST(grn.id AS varchar) IN (${completedGrnIds.getQuery()})`)
  //     .setParameters(completedGrnIds.getParameters());

  //   if (employeeIds) {
  //     grnQuery.andWhere("grn.createdBy IN (:...employeeIds)", { employeeIds });
  //   }

  //   const results = await grnQuery
  //     .groupBy("vendor.id, vendor.companyName, vendor.vendorCode, vendor.officeContactNo")
  //     .orderBy("\"totalQuantity\"", "DESC")
  //     .limit(5)
  //     .getRawMany();

  //   const top5 = results.map((row) => ({
  //     vendorId: row.vendorId,
  //     vendorName: row.vendorName || "Unknown",
  //     vendorCode: row.vendorCode,
  //     officeContactNo: row.officeContactNo,
  //     totalQuantity: Number(row.totalQuantity),
  //     totalGRNs: Number(row.totalGRNs),
  //     totalPurchaseAmount: Number(row.totalPurchaseAmount),
  //   }));

  //   return {
  //     teamLeaderId: teamLeaderId || null,
  //     top5Vendors: top5,
  //   };
  // }
  async getFarmerRegistrationOverviewOfTeam(teamLeaderId: string,month?: number, year?: number) {
   const teamMembers = await this.workflowHierarchyRepo
  .createQueryBuilder("wh")
  .select("descendant.id", "id")
  .leftJoin("wh.descendant", "descendant")
  .where("wh.ancestor.id = :teamLeaderId", {
    teamLeaderId,
  })
  .andWhere("wh.depth > 0")
  .getRawMany();


// Team Leader + all unique members
const memberIds = [
  teamLeaderId,
  ...new Set(
    teamMembers.map(member => member.id)
  )
];

    // Remove duplicates
    const uniqueIds = [...new Set(memberIds)];

      const currentDate = new Date();

  let selectedMonth =
    month || currentDate.getMonth() + 1;

    selectedMonth = month?selectedMonth+1:selectedMonth;

  const selectedYear =
    year || currentDate.getFullYear();

    // Get all statistics in single query
  
    const result = await this.farmerRepo
  .createQueryBuilder("farmer")

  .select(
    `
    COUNT(
      CASE
        WHEN farmer.status = :approved
        AND EXTRACT(MONTH FROM farmer.createdAt)=:month
        AND EXTRACT(YEAR FROM farmer.createdAt)=:year
        THEN 1
      END
    )
    `,
    "registeredThisMonth"
  )

  .addSelect(
    "COUNT(farmer.id)",
    "totalRegistered"
  )

  .addSelect(
    `
    COUNT(
      CASE
      WHEN farmer.status = :approved
      THEN 1
      END
    )
    `,
    "approved"
  )

  .addSelect(
    `
    COUNT(
      CASE
      WHEN farmer.status = :pending
      THEN 1
      END
    )
    `,
    "pending"
  )

  .addSelect(
    `
    COUNT(
      CASE
      WHEN farmer.status = :rejected
      THEN 1
      END
    )
    `,
    "rejected"
  )

  .where(
    "farmer.created_by IN (:...memberIds)",
    { memberIds: uniqueIds }
  )

  .setParameters({
    month: selectedMonth,
    year: selectedYear,
    approved: Status.APPROVED,
    pending: Status.PENDING,
    rejected: Status.REJECTED,
  })

  .getRawOne();

    return {
      success: true,
      message: '',
      data: {
        registeredThisMonth:
          Number(result.registeredThisMonth) || 0,

        totalRegistered:
          Number(result.totalRegistered) || 0,

        approved:
          Number(result.approved) || 0,

        pending:
          Number(result.pending) || 0,

        rejected:
          Number(result.rejected) || 0,
      },
    };
}

async getVendorRegistrationOverviewOfTeam(teamLeaderId: string,month?: number, year?: number) {
   const teamMembers = await this.workflowHierarchyRepo
  .createQueryBuilder("wh")
  .select("descendant.id", "id")
  .leftJoin("wh.descendant", "descendant")
  .where("wh.ancestor.id = :teamLeaderId", {
    teamLeaderId,
  })
  .andWhere("wh.depth > 0")
  .getRawMany();


// Team Leader + all unique members
const memberIds = [
  teamLeaderId,
  ...new Set(
    teamMembers.map(member => member.id)
  )
];

    // Remove duplicates
    const uniqueIds = [...new Set(memberIds)];

   

    const currentDate = new Date();

  let selectedMonth =
    month || currentDate.getMonth() + 1;

    selectedMonth = month?selectedMonth+1:selectedMonth;

  const selectedYear =
    year || currentDate.getFullYear();

    // Get all statistics in single query
  
    const result = await this.vendorRepo
  .createQueryBuilder("vendor")

  .select(
    `
    COUNT(
      CASE
        WHEN vendor.status = :approved
        AND EXTRACT(MONTH FROM vendor.createdAt)=:month
        AND EXTRACT(YEAR FROM vendor.createdAt)=:year
        THEN 1
      END
    )
    `,
    "registeredThisMonth"
  )

  .addSelect(
    "COUNT(vendor.id)",
    "totalRegistered"
  )

  .addSelect(
    `
    COUNT(
      CASE
      WHEN vendor.status = :approved
      THEN 1
      END
    )
    `,
    "approved"
  )

  .addSelect(
    `
    COUNT(
      CASE
      WHEN vendor.status = :pending
      THEN 1
      END
    )
    `,
    "pending"
  )

  .addSelect(
    `
    COUNT(
      CASE
      WHEN vendor.status = :rejected
      THEN 1
      END
    )
    `,
    "rejected"
  )

  .where(
    "vendor.created_by IN (:...memberIds)",
    { memberIds: uniqueIds }
  )

  .setParameters({
    month: selectedMonth,
    year: selectedYear,
    approved: Status.APPROVED,
    pending: Status.PENDING,
    rejected: Status.REJECTED,
  })

  .getRawOne();

    return {
      success: true,
      message: '',
      data: {
        registeredThisMonth:
          Number(result.registeredThisMonth) || 0,

        totalRegistered:
          Number(result.totalRegistered) || 0,

        approved:
          Number(result.approved) || 0,

        pending:
          Number(result.pending) || 0,

        rejected:
          Number(result.rejected) || 0,
      },
    };
}

async getCustomerRegistrationOverviewOfTeam(teamLeaderId: string, month?: number, year?: number) {
   const teamMembers = await this.workflowHierarchyRepo
  .createQueryBuilder("wh")
  .select("descendant.id", "id")
  .leftJoin("wh.descendant", "descendant")
  .where("wh.ancestor.id = :teamLeaderId", {
    teamLeaderId,
  })
  .andWhere("wh.depth > 0")
  .getRawMany();


// Team Leader + all unique members
const memberIds = [
  teamLeaderId,
  ...new Set(
    teamMembers.map(member => member.id)
  )
];

    // Remove duplicates
    const uniqueIds = [...new Set(memberIds)];

   

    const currentDate = new Date();

  let selectedMonth =
    month || currentDate.getMonth() + 1;

    selectedMonth = month?selectedMonth+1:selectedMonth;

  const selectedYear =
    year || currentDate.getFullYear();

    // Get all statistics in single query
  
    const result = await this.customerRepo
  .createQueryBuilder("customer")

  .select(
    `
    COUNT(
      CASE
        WHEN customer.status = :approved
        AND EXTRACT(MONTH FROM customer.createdAt)=:month
        AND EXTRACT(YEAR FROM customer.createdAt)=:year
        THEN 1
      END
    )
    `,
    "registeredThisMonth"
  )

  .addSelect(
    "COUNT(customer.id)",
    "totalRegistered"
  )

  .addSelect(
    `
    COUNT(
      CASE
      WHEN customer.status = :approved
      THEN 1
      END
    )
    `,
    "approved"
  )

  .addSelect(
    `
    COUNT(
      CASE
      WHEN customer.status = :pending
      THEN 1
      END
    )
    `,
    "pending"
  )

  .addSelect(
    `
    COUNT(
      CASE
      WHEN customer.status = :rejected
      THEN 1
      END
    )
    `,
    "rejected"
  )

  .where(
    "customer.created_by IN (:...memberIds)",
    { memberIds: uniqueIds }
  )

  .setParameters({
    month: selectedMonth,
    year: selectedYear,
    approved: Status.APPROVED,
    pending: Status.PENDING,
    rejected: Status.REJECTED,
  })

  .getRawOne();

    return {
      success: true,
      message: '',
      data: {
        registeredThisMonth:
          Number(result.registeredThisMonth) || 0,

        totalRegistered:
          Number(result.totalRegistered) || 0,

        approved:
          Number(result.approved) || 0,

        pending:
          Number(result.pending) || 0,

        rejected:
          Number(result.rejected) || 0,
      },
    };
}

async getFarmerRegistrationOverviewOfEachTeamMember(teamLeaderId: string,month?: number, year?: number) {
  // const currentDate = new Date();
  // const currentMonth = currentDate.getMonth() + 1;
  // const currentYear = currentDate.getFullYear();

  const currentDate = new Date();

  let selectedMonth =
    month || currentDate.getMonth() + 1;

  selectedMonth = month?selectedMonth+1:selectedMonth;

  const selectedYear =
    year || currentDate.getFullYear();

  // Get all members under team leader
  const teamMembers = await this.workflowHierarchyRepo
    .createQueryBuilder("wh")
    .leftJoinAndSelect("wh.descendant", "descendant")
    .where("wh.ancestor.id = :teamLeaderId", {
      teamLeaderId
    })
    .andWhere("wh.depth > 0")
    .getMany();

  // Remove duplicates if same member exists in multiple departments
  const uniqueMembers = Array.from(
    new Map(
      teamMembers.map(
        item => [item.descendant.id, item.descendant]
      )
    ).values()
  );

   const hasChildNodes = uniqueMembers.length > 0;
   // Include self + all descendants
  // If no descendants, use only self
  const memberIds =
    uniqueMembers.length > 0
      ? [
          teamLeaderId,
          ...uniqueMembers.map((member) => member.id),
        ]
      : [teamLeaderId];
  // Single optimized query
  const stats = await this.farmerRepo
    .createQueryBuilder("farmer")
    
    .leftJoin("farmer.createdBy", "user")

    .select("user.id", "userId")

    .addSelect(
      `CONCAT(
        COALESCE(user.firstName,''),
        ' ',
        COALESCE(user.lastName,'')
      )`,
      "employeeName"
    )

    .addSelect(
      "COUNT(farmer.id)",
      "total"
    )

    .addSelect(
      `
      COUNT(
        CASE
        WHEN farmer.status=:approved
        AND EXTRACT(MONTH FROM farmer.createdAt)=:month
        AND EXTRACT(YEAR FROM farmer.createdAt)=:year
        THEN 1
        END
      )
      `,
      "thisMonth"
    )

    .addSelect(
      `
      COUNT(
        CASE
        WHEN farmer.status=:approved
        THEN 1
        END
      )
      `,
      "approved"
    )

    .addSelect(
      `
      COUNT(
        CASE
        WHEN farmer.status=:pending
        THEN 1
        END
      )
      `,
      "pending"
    )

    .addSelect(
      `
      COUNT(
        CASE
        WHEN farmer.status=:rejected
        THEN 1
        END
      )
      `,
      "rejected"
    )

    .where(
      "user.id IN (:...memberIds)",
      { memberIds }
    )

    .setParameters({
      month: selectedMonth,
      year: selectedYear,
      approved: Status.APPROVED,
      pending: Status.PENDING,
      rejected: Status.REJECTED
    })

    .groupBy("user.id")
    .addGroupBy("user.firstName")
    .addGroupBy("user.lastName")

    .getRawMany();

    if (!hasChildNodes) {
  const userData = stats[0];

  return {
  
    data: {
      totalRegistered: Number(userData?.total || 0),
      registeredThisMonth: Number(userData?.thisMonth || 0),
      approved: Number(userData?.approved || 0),
      pending: Number(userData?.pending || 0),
      rejected: Number(userData?.rejected || 0),
    },
  };
}

return {
 
  data: stats.map((item) => ({
    userId: item.userId,
    employeeName: item.employeeName,
    total: Number(item.total || 0),
    thisMonth: Number(item.thisMonth || 0),
    approved: Number(item.approved || 0),
    pending: Number(item.pending || 0),
    rejected: Number(item.rejected || 0),
  })),
};
}

async getVendorRegistrationOverviewOfEachTeamMember(teamLeaderId: string, month?: number, year?: number) {

  const currentDate = new Date();

  let currentMonth = month || currentDate.getMonth() + 1;
  currentMonth = month?currentMonth+1:currentMonth;
  const currentYear = year || currentDate.getFullYear();

  // Get all members under team leader
  const teamMembers = await this.workflowHierarchyRepo
    .createQueryBuilder("wh")
    .leftJoinAndSelect("wh.descendant", "descendant")
    .where("wh.ancestor.id = :teamLeaderId", {
      teamLeaderId
    })
    .andWhere("wh.depth > 0")
    .getMany();

  // Remove duplicates if same member exists in multiple departments
  const uniqueMembers = Array.from(
    new Map(
      teamMembers.map(
        item => [item.descendant.id, item.descendant]
      )
    ).values()
  );

  const hasChildNodes = uniqueMembers.length > 0;
  const memberIds =
    uniqueMembers.length > 0
      ? [
          teamLeaderId,
          ...uniqueMembers.map((member) => member.id),
        ]
      : [teamLeaderId];

  // Single optimized query
  const stats = await this.vendorRepo
    .createQueryBuilder("vendor")
    
    .leftJoin("vendor.createdBy", "user")

    .select("user.id", "userId")

    .addSelect(
      `CONCAT(
        COALESCE(user.firstName,''),
        ' ',
        COALESCE(user.lastName,'')
      )`,
      "employeeName"
    )

    .addSelect(
      "COUNT(vendor.id)",
      "total"
    )

    .addSelect(
      `
      COUNT(
        CASE
        WHEN vendor.status=:approved
        AND EXTRACT(MONTH FROM vendor.createdAt)=:month
        AND EXTRACT(YEAR FROM vendor.createdAt)=:year
        THEN 1
        END
      )
      `,
      "thisMonth"
    )

    .addSelect(
      `
      COUNT(
        CASE
        WHEN vendor.status=:approved
        THEN 1
        END
      )
      `,
      "approved"
    )

    .addSelect(
      `
      COUNT(
        CASE
        WHEN vendor.status=:pending
        THEN 1
        END
      )
      `,
      "pending"
    )

    .addSelect(
      `
      COUNT(
        CASE
        WHEN vendor.status=:rejected
        THEN 1
        END
      )
      `,
      "rejected"
    )

    .where(
      "user.id IN (:...memberIds)",
      { memberIds }
    )

    .setParameters({
      month: currentMonth,
      year: currentYear,
      approved: Status.APPROVED,
      pending: Status.PENDING,
      rejected: Status.REJECTED
    })

    .groupBy("user.id")
    .addGroupBy("user.firstName")
    .addGroupBy("user.lastName")
    .getRawMany();
if (!hasChildNodes) {
  const userData = stats[0];
  return {
    data: {
      totalRegistered: Number(userData?.total || 0),
      registeredThisMonth: Number(userData?.thisMonth || 0),
      approved: Number(userData?.approved || 0),
      pending: Number(userData?.pending || 0),
      rejected: Number(userData?.rejected || 0),
    },
  };
}

return {
  data: stats.map((item) => ({
    userId: item.userId,
    employeeName: item.employeeName,
    total: Number(item.total || 0),
    thisMonth: Number(item.thisMonth || 0),
    approved: Number(item.approved || 0),
    pending: Number(item.pending || 0),
    rejected: Number(item.rejected || 0),
  })),
};
}

// async getCustomerRegistrationOverviewOfEachTeamMember(teamLeaderId: string) {

//   const currentDate = new Date();

//   const currentMonth = currentDate.getMonth() + 1;
//   const currentYear = currentDate.getFullYear();

//   // Get all members under team leader
//   const teamMembers = await this.workflowHierarchyRepo
//     .createQueryBuilder("wh")
//     .leftJoinAndSelect("wh.descendant", "descendant")
//     .where("wh.ancestor.id = :teamLeaderId", {
//       teamLeaderId
//     })
//     .andWhere("wh.depth > 0")
//     .getMany();

//   // Remove duplicates if same member exists in multiple departments
//   const uniqueMembers = Array.from(
//     new Map(
//       teamMembers.map(
//         item => [item.descendant.id, item.descendant]
//       )
//     ).values()
//   );

//   if (!uniqueMembers.length) {
//     return {
//       success: true,
//       message: "",
//       data: []
//     };
//   }

//   const memberIds = uniqueMembers.map(
//     member => member.id
//   );

//   // Single optimized query
//   const stats = await this.customerRepo
//     .createQueryBuilder("customer")
    
//     .leftJoin("customer.createdBy", "user")

//     .select("user.id", "userId")

//     .addSelect(
//       `CONCAT(
//         COALESCE(user.firstName,''),
//         ' ',
//         COALESCE(user.lastName,'')
//       )`,
//       "employeeName"
//     )

//     .addSelect(
//       "COUNT(customer.id)",
//       "total"
//     )

//     .addSelect(
//       `
//       COUNT(
//         CASE
//         WHEN customer.status=:approved
//         AND EXTRACT(MONTH FROM customer.createdAt)=:month
//         AND EXTRACT(YEAR FROM customer.createdAt)=:year
//         THEN 1
//         END
//       )
//       `,
//       "thisMonth"
//     )

//     .addSelect(
//       `
//       COUNT(
//         CASE
//         WHEN customer.status=:approved
//         THEN 1
//         END
//       )
//       `,
//       "approved"
//     )

//     .addSelect(
//       `
//       COUNT(
//         CASE
//         WHEN customer.status=:pending
//         THEN 1
//         END
//       )
//       `,
//       "pending"
//     )

//     .addSelect(
//       `
//       COUNT(
//         CASE
//         WHEN customer.status=:rejected
//         THEN 1
//         END
//       )
//       `,
//       "rejected"
//     )

//     .where(
//       "user.id IN (:...memberIds)",
//       { memberIds }
//     )

//     .setParameters({
//       month: currentMonth,
//       year: currentYear,
//       approved: Status.APPROVED,
//       pending: Status.PENDING,
//       rejected: Status.REJECTED
//     })

//     .groupBy("user.id")
//     .addGroupBy("user.firstName")
//     .addGroupBy("user.lastName")

//     .getRawMany();


//   return {
//     success: true,
//     message: "",
//     data: stats.map(item => ({
//       employeeName: item.employeeName,
//       total: Number(item.total || 0),
//       thisMonth: Number(item.thisMonth || 0),
//       approved: Number(item.approved || 0),
//       pending: Number(item.pending || 0),
//       rejected: Number(item.rejected || 0),
//     }))
//   };

// }

async getCustomerRegistrationOverviewOfEachTeamMember(
  teamLeaderId: string,
  month?: number,
  year?: number
) {
  const currentDate = new Date();

  let currentMonth = month || currentDate.getMonth() + 1;
  currentMonth = month?currentMonth+1:currentMonth;
  const currentYear = year || currentDate.getFullYear();

  // Get all descendants (direct + indirect)
  const teamMembers = await this.workflowHierarchyRepo
    .createQueryBuilder("wh")
    .leftJoinAndSelect("wh.descendant", "descendant")
    .where("wh.ancestor.id = :teamLeaderId", {
      teamLeaderId,
    })
    .andWhere("wh.depth > 0")
    .getMany();

  // Remove duplicates
  const uniqueMembers = Array.from(
    new Map(
      teamMembers.map((item) => [
        item.descendant.id,
        item.descendant,
      ])
    ).values()
  );

  const hasChildNodes = uniqueMembers.length > 0;
  // Include self + all descendants
  // If no descendants, use only self
  const memberIds =
    uniqueMembers.length > 0
      ? [
          teamLeaderId,
          ...uniqueMembers.map((member) => member.id),
        ]
      : [teamLeaderId];

  const stats = await this.customerRepo
    .createQueryBuilder("customer")
    .leftJoin("customer.createdBy", "user")

    .select("user.id", "userId")

    .addSelect(
      `CONCAT(
        COALESCE(user.firstName, ''),
        ' ',
        COALESCE(user.lastName, '')
      )`,
      "employeeName"
    )

    .addSelect(
      "COUNT(customer.id)",
      "total"
    )

    .addSelect(
      `
      COUNT(
        CASE
          WHEN customer.status = :approved
          AND EXTRACT(MONTH FROM customer.createdAt) = :month
          AND EXTRACT(YEAR FROM customer.createdAt) = :year
          THEN 1
        END
      )
      `,
      "thisMonth"
    )

    .addSelect(
      `
      COUNT(
        CASE
          WHEN customer.status = :approved
          THEN 1
        END
      )
      `,
      "approved"
    )

    .addSelect(
      `
      COUNT(
        CASE
          WHEN customer.status = :pending
          THEN 1
        END
      )
      `,
      "pending"
    )

    .addSelect(
      `
      COUNT(
        CASE
          WHEN customer.status = :rejected
          THEN 1
        END
      )
      `,
      "rejected"
    )

    .where("user.id IN (:...memberIds)", {
      memberIds,
    })

    .setParameters({
      month: currentMonth,
      year: currentYear,
      approved: Status.APPROVED,
      pending: Status.PENDING,
      rejected: Status.REJECTED,
    })

    .groupBy("user.id")
    .addGroupBy("user.firstName")
    .addGroupBy("user.lastName")

    .getRawMany();

if (!hasChildNodes) {
  const userData = stats[0];

  return {
  
    data: {
      totalRegistered: Number(userData?.total || 0),
      registeredThisMonth: Number(userData?.thisMonth || 0),
      approved: Number(userData?.approved || 0),
      pending: Number(userData?.pending || 0),
      rejected: Number(userData?.rejected || 0),
    },
  };
}

return {
 
  data: stats.map((item) => ({
    userId: item.userId,
    employeeName: item.employeeName,
    total: Number(item.total || 0),
    thisMonth: Number(item.thisMonth || 0),
    approved: Number(item.approved || 0),
    pending: Number(item.pending || 0),
    rejected: Number(item.rejected || 0),
  })),
};
}

public async getEmployeeCountByDept(query: any): Promise<any> {
    const userId:     string | undefined = query.userId     as string | undefined;
    const rawDept:    string | undefined = query.department as string | undefined;
    const deptParam:  DepartmentEnum | undefined = rawDept
      ? normalizeDepartment(rawDept)
      : undefined;

    // helper to build a single dept block from a raw rows array
    const buildBlock = (rows: any[]) => {
      const activeMembers   = rows
        .filter((r) => r.isOnline === true || r.isOnline === "true")
        .map((r) => ({
          id:     r.empId,
          name:   r.fullName?.replace(/\s+/g, " ").trim() || "Unknown",
          status: "active",
        }));

      const inactiveMembers = rows
        .filter((r) => r.isOnline === false || r.isOnline === "false")
        .map((r) => ({
          id:     r.empId,
          name:   r.fullName?.replace(/\s+/g, " ").trim() || "Unknown",
          status: "inactive",
        }));

      return {
        total:          rows.length,
        active:         activeMembers.length,
        inactive:       inactiveMembers.length,
        activeMembers,
        inactiveMembers,
      };
    };

    // ── helper: fetch rows from workflow_hierarchy for a given dept ──────────
    const fetchHierarchyRows = async (dept: string | null) => {
      const qb = this.dataSource
        .getRepository(WorkflowHierarchy)
        .createQueryBuilder("wh")
        .innerJoin("wh.descendant", "emp")
        .select([
          "emp.id                                                        AS \"empId\"",
          "emp.isOnline                                                  AS \"isOnline\"",
          "CONCAT(emp.firstName, ' ', emp.middleName, ' ', emp.lastName) AS \"fullName\"",
          "wh.department                                                 AS \"dept\"",
        ])
        .distinct(true)
        .where("wh.ancestor_id = :userId", { userId })
        .andWhere("wh.depth > 0")
        .andWhere("wh.isDeleted = false")
        .andWhere("emp.isDeleted = false");

      if (dept) {
        qb.andWhere("wh.department = :dept", { dept });
      }

      return qb.getRawMany();
    };

    // ── helper: fetch rows from employees table for a given dept ─────────────
    const fetchGlobalRows = async (dept: string | null) => {
      const qb = this.dataSource
        .getRepository(User)
        .createQueryBuilder("emp")
        .select([
          "emp.id                                                        AS \"empId\"",
          "emp.isOnline                                                  AS \"isOnline\"",
          "CONCAT(emp.firstName, ' ', emp.middleName, ' ', emp.lastName) AS \"fullName\"",
          "emp.department                                                AS \"dept\"",
        ])
        .where("emp.isDeleted = false");

      if (dept) {
        qb.andWhere("emp.department LIKE :deptPattern", {
          deptPattern: `%${dept}%`,
        });
      }

      return qb.getRawMany();
    };

    // ── CASE 1: userId + department ──────────────────────────────────────────
    if (userId && deptParam) {
      const rows   = await fetchHierarchyRows(deptParam);
      const unique = Array.from(new Map(rows.map((r) => [r.empId, r])).values());
      return buildBlock(unique);
    }

    // ── CASE 2: userId only — all depts merged ───────────────────────────────
    if (userId) {
      const rows   = await fetchHierarchyRows(null);
      const unique = Array.from(new Map(rows.map((r) => [r.empId, r])).values());
      return buildBlock(unique);
    }

    // ── CASE 3: global — all employees merged ────────────────────────────────
    const rows   = await fetchGlobalRows(null);
    const unique = Array.from(new Map(rows.map((r) => [r.empId, r])).values());
    return buildBlock(unique);
  }
  // public async getTop5Customer(query: any): Promise<any> {
  //   const teamLeaderId: string | undefined = query.teamLeaderId as string | undefined;

  //   let employeeIds: string[] | null = null;

  //   if (teamLeaderId) {
  //     employeeIds = await this.getEmployeeIds(teamLeaderId);

  //     if (employeeIds.length === 0) {
  //       return {
  //         teamLeaderId,
  //         top5Customers: [],
  //         message: "No employees found under this team leader",
  //       };
  //     }
  //   }

  //   // Subquery: Invoice IDs whose document status is COMPLETE
  //   const completedInvoiceIds = this.dataSource
  //     .getRepository(Documentb)
  //     .createQueryBuilder("doc")
  //     .select("doc.document_type_id")
  //     .where("doc.type = :invType", { invType: DocumentTypeEnum.FINAL_INVOICE })
  //     .andWhere("doc.status = :invStatus", { invStatus: DocumentStatus.COMPLETE })
  //     .andWhere("doc.isDeleted = false");

  //   const invoiceQuery = this.dataSource
  //     .getRepository(Invoice)
  //     .createQueryBuilder("invoice")
  //     .innerJoin("invoice.customerName", "customer")
  //     .leftJoin("invoice.invoiceProducts", "invoiceProduct")
  //     .leftJoin("invoiceProduct.productName", "product")
  //     .select([
  //       "customer.id                                          AS \"customerId\"",
  //       "customer.organisationName                            AS \"customerName\"",
  //       "customer.customerCode                                AS \"customerCode\"",
  //       "customer.primaryContactNo                            AS \"primaryContactNo\"",
  //       "COALESCE(SUM(invoice.totalAmount), 0)                AS \"totalSalesAmount\"",
  //       "COUNT(DISTINCT invoice.id)                           AS \"totalInvoices\"",
  //       "COALESCE(SUM(invoiceProduct.grossWeight), 0)         AS \"totalSalesQuantity\"",
  //       "STRING_AGG(DISTINCT product.name, ',')               AS \"productsSold\"",
  //     ])
  //     .where("invoice.isDeleted = false")
  //     .andWhere("customer.isDeleted = false")
  //     .andWhere("customer.id IS NOT NULL")
  //     .andWhere(`CAST(invoice.id AS varchar) IN (${completedInvoiceIds.getQuery()})`)
  //     .setParameters(completedInvoiceIds.getParameters());

  //   if (employeeIds) {
  //     invoiceQuery.andWhere("invoice.createdBy IN (:...employeeIds)", { employeeIds });
  //   }

  //   const results = await invoiceQuery
  //     .groupBy("customer.id, customer.organisationName, customer.customerCode, customer.primaryContactNo")
  //     .orderBy("\"totalSalesAmount\"", "DESC")
  //     .limit(5)
  //     .getRawMany();

  //   const top5 = results.map((row) => ({
  //     customerId: row.customerId,
  //     customerName: row.customerName,
  //     customerCode: row.customerCode,
  //     primaryContactNo: row.primaryContactNo,
  //     totalSalesAmount: Number(row.totalSalesAmount),
  //     totalSalesQuantity: Number(row.totalSalesQuantity),
  //     totalInvoices: Number(row.totalInvoices),
  //     productsSold: row.productsSold
  //       ? row.productsSold.split(",").map((p: string) => p.trim()).filter(Boolean)
  //       : [],
  //   }));

  //   return {
  //     teamLeaderId: teamLeaderId || null,
  //     top5Customers: top5,
  //   };
  // }

  /**
   * Top 5 farmers by highest purchase quantity (netWeight).
   * Only GRNs whose document status is COMPLETE are counted.
   *
   * Query params:
   *  - teamLeaderId (optional): scopes to employees under that team leader.
   */
  // public async getTop5Farmer(query: any): Promise<any> {
  //   const teamLeaderId: string | undefined = query.teamLeaderId as string | undefined;

  //   let employeeIds: string[] | null = null;

  //   if (teamLeaderId) {
  //     employeeIds = await this.getEmployeeIds(teamLeaderId);

  //     if (employeeIds.length === 0) {
  //       return {
  //         teamLeaderId,
  //         top5Farmers: [],
  //         message: "No employees found under this team leader",
  //       };
  //     }
  //   }

  //   const completedGrnIds = this.dataSource
  //     .getRepository(Documentb)
  //     .createQueryBuilder("doc")
  //     .select("doc.document_type_id")
  //     .where("doc.type = :type", { type: DocumentTypeEnum.GRN })
  //     .andWhere("doc.status = :status", { status: DocumentStatus.COMPLETE })
  //     .andWhere("doc.isDeleted = false");

  //   const grnQuery = this.dataSource
  //     .getRepository(GRN)
  //     .createQueryBuilder("grn")
  //     .innerJoin("grn.grnProducts", "grnProduct")
  //     .innerJoin("grn.selectedFarmer", "farmer")
  //     .leftJoin("grnProduct.productName", "product")
  //     .select([
  //       "farmer.id                                                                        AS \"farmerId\"",
  //       "CONCAT(farmer.farmerfName, ' ', farmer.farmermName, ' ', farmer.farmerlName)     AS \"farmerName\"",
  //       "farmer.farmerCode                                                                AS \"farmerCode\"",
  //       "farmer.primaryMobileNo                                                           AS \"primaryMobileNo\"",
  //       "COALESCE(SUM(grnProduct.netWeight), 0)                                           AS \"totalQuantity\"",
  //       "COUNT(DISTINCT grn.id)                                                           AS \"totalGRNs\"",
  //       "COALESCE(SUM(grn.totalAmt), 0)                                                   AS \"totalPurchaseAmount\"",
  //       "STRING_AGG(DISTINCT product.name, ',')                                           AS \"productsProcured\"",
  //     ])
  //     .where("grn.isDeleted = false")
  //     .andWhere("farmer.isDeleted = false")
  //     .andWhere("farmer.id IS NOT NULL")
  //     .andWhere("grn.source = :source", { source: "farmer" })
  //     .andWhere("grn.grnType = :grnType", { grnType: "purchase" })
  //     .andWhere(`CAST(grn.id AS varchar) IN (${completedGrnIds.getQuery()})`)
  //     .setParameters(completedGrnIds.getParameters());

  //   if (employeeIds) {
  //     grnQuery.andWhere("grn.createdBy IN (:...employeeIds)", { employeeIds });
  //   }

  //   const results = await grnQuery
  //     .groupBy("farmer.id, farmer.farmerfName, farmer.farmermName, farmer.farmerlName, farmer.farmerCode, farmer.primaryMobileNo")
  //     .orderBy("\"totalQuantity\"", "DESC")
  //     .limit(5)
  //     .getRawMany();

  //   const top5 = results.map((row) => ({
  //     farmerId: row.farmerId,
  //     farmerName: row.farmerName?.trim() || "Unknown",
  //     farmerCode: row.farmerCode,
  //     primaryMobileNo: row.primaryMobileNo,
  //     productsProcured: row.productsProcured
  //       ? row.productsProcured.split(",").map((p: string) => p.trim()).filter(Boolean)
  //       : [],
  //     totalQuantity: Number(row.totalQuantity),
  //     totalGRNs: Number(row.totalGRNs),
  //     totalPurchaseAmount: Number(row.totalPurchaseAmount),
  //   }));

  //   return {
  //     teamLeaderId: teamLeaderId || null,
  //     top5Farmers: top5,
  //   };
  // }

  /**
   * Top 5 vendors by highest purchase quantity (netWeight).
   * Only GRNs whose document status is COMPLETE are counted.
   *
   * Query params:
   *  - teamLeaderId (optional): scopes to employees under that team leader.
   */
  // public async getTop5Vendor(query: any): Promise<any> {
  //   const teamLeaderId: string | undefined = query.teamLeaderId as string | undefined;

  //   let employeeIds: string[] | null = null;

  //   if (teamLeaderId) {
  //     employeeIds = await this.getEmployeeIds(teamLeaderId);

  //     if (employeeIds.length === 0) {
  //       return {
  //         teamLeaderId,
  //         top5Vendors: [],
  //         message: "No employees found under this team leader",
  //       };
  //     }
  //   }

  //   const completedGrnIds = this.dataSource
  //     .getRepository(Documentb)
  //     .createQueryBuilder("doc")
  //     .select("doc.document_type_id")
  //     .where("doc.type = :type", { type: DocumentTypeEnum.GRN })
  //     .andWhere("doc.status = :status", { status: DocumentStatus.COMPLETE })
  //     .andWhere("doc.isDeleted = false");

  //   const grnQuery = this.dataSource
  //     .getRepository(GRN)
  //     .createQueryBuilder("grn")
  //     .innerJoin("grn.grnProducts", "grnProduct")
  //     .innerJoin("grn.selectedVendor", "vendor")
  //     .leftJoin("grnProduct.productName", "product")
  //     .select([
  //       "vendor.id                              AS \"vendorId\"",
  //       "vendor.companyName                     AS \"vendorName\"",
  //       "vendor.vendorCode                      AS \"vendorCode\"",
  //       "vendor.officeContactNo                 AS \"officeContactNo\"",
  //       "COALESCE(SUM(grnProduct.netWeight), 0)  AS \"totalQuantity\"",
  //       "COUNT(DISTINCT grn.id)                 AS \"totalGRNs\"",
  //       "COALESCE(SUM(grn.totalAmt), 0)         AS \"totalPurchaseAmount\"",
  //       "STRING_AGG(DISTINCT product.name, ',') AS \"productsProcured\"",
  //     ])
  //     .where("grn.isDeleted = false")
  //     .andWhere("vendor.isDeleted = false")
  //     .andWhere("vendor.id IS NOT NULL")
  //     .andWhere("grn.source = :source", { source: "vendor" })
  //     .andWhere("grn.grnType = :grnType", { grnType: "purchase" })
  //     .andWhere(`CAST(grn.id AS varchar) IN (${completedGrnIds.getQuery()})`)
  //     .setParameters(completedGrnIds.getParameters());

  //   if (employeeIds) {
  //     grnQuery.andWhere("grn.createdBy IN (:...employeeIds)", { employeeIds });
  //   }

  //   const results = await grnQuery
  //     .groupBy("vendor.id, vendor.companyName, vendor.vendorCode, vendor.officeContactNo")
  //     .orderBy("\"totalQuantity\"", "DESC")
  //     .limit(5)
  //     .getRawMany();

  //   const top5 = results.map((row) => ({
  //     vendorId: row.vendorId,
  //     vendorName: row.vendorName || "Unknown",
  //     vendorCode: row.vendorCode,
  //     officeContactNo: row.officeContactNo,
  //     productsProcured: row.productsProcured
  //       ? row.productsProcured.split(",").map((p: string) => p.trim()).filter(Boolean)
  //       : [],
  //     totalQuantity: Number(row.totalQuantity),
  //     totalGRNs: Number(row.totalGRNs),
  //     totalPurchaseAmount: Number(row.totalPurchaseAmount),
  //   }));

  //   return {
  //     teamLeaderId: teamLeaderId || null,
  //     top5Vendors: top5,
  //   };
  // }

  //TODO:Get procurement team members performance metrics for a manager
  async getProcurementTeamMembersPerformance(
  userId: string,
  month?: number,  // 1-indexed (January = 1); optional — defaults to current month
  year?: number,   // 4-digit year; optional — defaults to current year
): Promise<any> {
  // Resolve month/year
  let resolvedMonth = month ?? (new Date().getMonth() + 1); // 1-indexed
  resolvedMonth = month ? resolvedMonth + 1 : resolvedMonth; // If month provided, increment by 1 to align with target table
  const resolvedYear  = year  ?? new Date().getFullYear();
  const targetMonth   = resolvedMonth - 1; // target table is 0-indexed

  // Get all descendants (direct + indirect)
  const teamMembers = await this.workflowHierarchyRepo
    .createQueryBuilder("wh")
    .leftJoinAndSelect("wh.descendant", "descendant")
    .where("wh.ancestor.id = :userId", { userId })
    .andWhere("wh.department = :dept", { dept: DepartmentEnum.PURCHASE })
    .andWhere("wh.depth > 0")
    .getMany();

  // Remove duplicates
  const uniqueMembers = Array.from(
    new Map(teamMembers.map((item) => [item.descendant.id, item.descendant])).values()
  );

  const hasChildNodes = uniqueMembers.length > 0;

  // If no descendants → scope to self only; otherwise include self + all descendants
  const memberIds = hasChildNodes
    ? [userId, ...uniqueMembers.map((m) => m.id)]
    : [userId];

  const performanceData = [];

  for (const memberId of memberIds) {
    const employee = await this.userRepo.findOne({
      where: { id: memberId },
      select: ["id", "firstName", "lastName"],
    });
    const employeeName = employee
      ? `${employee.firstName} ${employee.lastName}`
      : "Unknown";

    // Total procurement amount
    const amountResult = await this.grnRepo
      .createQueryBuilder("grn")
      .innerJoin("documents", "doc",
        "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
        { type: "grn", status: "COMPLETE" })
      .select("COALESCE(SUM(grn.totalAmt), 0)", "totalAmount")
      .where("grn.createdby_id::text = :id", { id: memberId })
      .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: resolvedMonth })
      .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: resolvedYear })
      .getRawOne();

    const totalProcurementAmount = Number(amountResult?.totalAmount || 0);

    // Total procurement quantity
    const qtyResult = await this.grnRepo
      .createQueryBuilder("grn")
      .innerJoin("documents", "doc",
        "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
        { type: "grn", status: "COMPLETE" })
      .leftJoin("grn.grnProducts", "product")
      .select("COALESCE(SUM(product.netWeight), 0)", "totalQty")
      .where("grn.createdby_id::text = :id", { id: memberId })
      .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: resolvedMonth })
      .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: resolvedYear })
      .getRawOne();

    // Assigned target
    const targets = await this.procurementTargetRepo
      .createQueryBuilder("target")
      .select("SUM(target.monthlyTotalQty)", "totalTarget")
      .where("target.employee_id::text = :id", { id: memberId })
      .andWhere("target.month = :targetMonth", { targetMonth })
      .andWhere("target.year = :year", { year: resolvedYear })
      .getRawOne();

    const assignedTargetQty = Number(targets?.totalTarget || 0);

    // Achieved quantity
    const achievedResult = await this.grnRepo
      .createQueryBuilder("grn")
      .innerJoin("documents", "doc",
        "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
        { type: "grn", status: "COMPLETE" })
      .leftJoin("grn.grnProducts", "product")
      .select("COALESCE(SUM(product.netWeight), 0)", "achievedQty")
      .where("grn.createdby_id::text = :id", { id: memberId })
      .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: resolvedMonth })
      .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: resolvedYear })
      .getRawOne();

    const achievedQty     = Number(achievedResult?.achievedQty || 0);
    const achievementRate = assignedTargetQty > 0 ? (achievedQty / assignedTargetQty) * 100 : 0;
    const variance        = achievedQty - assignedTargetQty;

    // GRN count
    const grnCountResult = await this.grnRepo
      .createQueryBuilder("grn")
      .innerJoin("documents", "doc",
        "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
        { type: "grn", status: "COMPLETE" })
      .select("COUNT(grn.id)", "grnCount")
      .where("grn.createdby_id::text = :id", { id: memberId })
      .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: resolvedMonth })
      .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: resolvedYear })
      .getRawOne();

    const noOfGRNs = Number(grnCountResult?.grnCount || 0);

    performanceData.push({
      employeeName,
      totalProcurementAmount,
      totalProcurementQty: Number(qtyResult?.totalQty || 0),
      noOfGRNs,
      assignedTargetQty,
      achievedQty,
      achievementRate,
      variance,
    });
  }

  // No children → return single object (self only)
  if (!hasChildNodes) {
    return performanceData[0];
  }

  // Has children → return array
  return performanceData;
}


// async getProcurementTeamMembersPerformance(userId: string, month?: number, year?: number): Promise<any> {
//   const teamMembers = await this.workflowHierarchyRepo.find({
//   where: {
//     ancestor: { id: userId },
//     department: DepartmentEnum.PURCHASE,
//    //depth: 1 // direct team members
//   },
//   relations: ["descendant"]
// });

// const memberIds = [
//   ...new Set(teamMembers.map(t => String(t.descendant.id)))
// ];

// const currentMonth = new Date().getMonth();
// const newCurrenetMonth=new Date().getMonth()+1;
// const currentYear = new Date().getFullYear();

// const currentDate = new Date();

//   const selectedMonth =
//     month || currentDate.getMonth() + 1;

//   const selectedYear =
//     year || currentDate.getFullYear();

// const performanceData = [];
// for (const memberId of memberIds) {

//   const employee = await this.userRepo.findOne({
//   where: { id: memberId },
//   select: ["id", "firstName", "lastName"]
// });

// const employeeName = employee
//   ? `${employee.firstName} ${employee.lastName}`
//   : "Unknown";

//    // 👉 Amount query (NO JOIN)
// //   const amountResult = await this.grnRepo
// //     .createQueryBuilder("grn")
// //     .innerJoin(
// //       "documents",
// //       "doc",
// //       "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
// //       {
// //         type: "grn",
// //         status: "COMPLETE"
// //       }
// //     )
// //     .select("COALESCE(SUM(grn.totalAmt), 0)", "totalAmount")
// //     .where("grn.createdby_id::text = :id", { id: memberId })
// //     .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: newCurrenetMonth })
// //     .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: currentYear })
// //     .getRawOne();

// //  const totalProcurementAmount= Number(amountResult?.totalAmount || 0)

//   // 👉 Quantity query (WITH JOIN)
//   const qtyResult = await this.grnRepo
//     .createQueryBuilder("grn")
//     .innerJoin(
//       "documents",
//       "doc",
//       "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
//       {
//         type: "grn",
//         status: "COMPLETE"
//       }
//     )
//     .leftJoin("grn.grnProducts", "product")
//     .select("COALESCE(SUM(product.netWeight), 0)", "totalQty")
//     .where("grn.createdby_id::text = :id", { id: memberId })
//     .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: selectedMonth })
//     .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: selectedYear })
//     .getRawOne();

//  const targets = await this.procurementTargetRepo
//   .createQueryBuilder("target")
//   .select("SUM(target.monthlyTotalQty)", "totalTarget")
//   .where("target.employee_id::text = :id", { id: memberId })
//   .andWhere("target.month = :month", { month: selectedMonth })
//   .andWhere("target.year = :year", { year: selectedYear })
//   .getRawOne();
//   const AsignedTargetQty = Number(targets?.totalTarget || 0);

//   const result1 = await this.grnRepo
//   .createQueryBuilder("grn")
//   .innerJoin(
//     "documents",
//     "doc",
//     "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
//     {
//       type: "grn",
//       status: "COMPLETE"
//     }
//   )
//   .leftJoin("grn.grnProducts", "product")
//   .select("SUM(product.netWeight)", "achievedQty")
//   .where("grn.createdby_id::text = :id", { id: memberId })
//   .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: selectedMonth })
//   .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: selectedYear })
//   .getRawOne();

//   const achievedQty = Number(result1?.achievedQty || 0);

//   const achievementRate = AsignedTargetQty > 0
//   ? (achievedQty / AsignedTargetQty) * 100
//   : 0;

//    const variance = AsignedTargetQty - achievedQty;

//    const grnCountResult = await this.grnRepo
//   .createQueryBuilder("grn")
//   .innerJoin(
//     "documents",
//     "doc",
//     "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
//     {
//       type: "grn",
//       status: "COMPLETE"
//     }
//   )
//   .select("COUNT(grn.id)", "grnCount")
//   .where("grn.createdby_id::text = :id", { id: memberId })
//   .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: selectedMonth })
//   .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: selectedYear })
//   .getRawOne();

// const grnCount = Number(grnCountResult?.grnCount || 0);

//  performanceData.push({
//   employeeName: employeeName,
//   //totalProcurementAmount: totalProcurementAmount,
//   totalProcuredQty: Number(qtyResult?.totalQty || 0),
//   AsignedTargetQty: AsignedTargetQty,
//   achievedQty: achievedQty,
//   achievementRate: achievementRate,
//   variance: variance,
//    totalGRNs: grnCount
//  });
// }
// return performanceData;
// }


 


//TODO:Get sale team members performance metrics for a manager
async getSaleTeamMembersPerformance(
  userId: string,
  month?: number,  // 1-indexed (January = 1); optional — defaults to current month
  year?: number,   // 4-digit year; optional — defaults to current year
): Promise<any> {
  // Resolve month/year
  let resolvedMonth = month ?? (new Date().getMonth() + 1); // 1-indexed
    resolvedMonth = month ? resolvedMonth + 1 : resolvedMonth; // If month provided, increment by 1 to align with target table
  const resolvedYear  = year  ?? new Date().getFullYear();
  const targetMonth   = resolvedMonth - 1; // target table is 0-indexed

  // Get all descendants (direct + indirect)
  const teamMembers = await this.workflowHierarchyRepo
    .createQueryBuilder("wh")
    .leftJoinAndSelect("wh.descendant", "descendant")
    .where("wh.ancestor.id = :userId", { userId })
    .andWhere("wh.department = :dept", { dept: DepartmentEnum.SALE })
    .andWhere("wh.depth > 0")
    .getMany();

  // Remove duplicates
  const uniqueMembers = Array.from(
    new Map(teamMembers.map((item) => [item.descendant.id, item.descendant])).values()
  );

  const hasChildNodes = uniqueMembers.length > 0;

  // If no descendants → scope to self only; otherwise include self + all descendants
  const memberIds = hasChildNodes
    ? [userId, ...uniqueMembers.map((m) => m.id)]
    : [userId];

  const performanceData = [];

  for (const memberId of memberIds) {
    const employee = await this.userRepo.findOne({
      where: { id: memberId },
      select: ["id", "firstName", "lastName"],
    });
    const employeeName = employee
      ? `${employee.firstName} ${employee.lastName}`
      : "Unknown";

    // Assigned target
    const targets = await this.saleTargetRepo
      .createQueryBuilder("target")
      .select("SUM(target.totalMonthlySale)", "totalTarget")
      .where("target.employee_id::text = :ids", { ids: memberId })
      .andWhere("target.month = :targetMonth", { targetMonth })
      .andWhere("target.year = :year", { year: resolvedYear })
      .getRawOne();

    const assignedTargetQty = Number(targets?.totalTarget || 0);

    // Total sale amount + achieved qty (netProductWeight)
    const result1 = await this.finalInvoiceRepo
      .createQueryBuilder("invoice")
      .innerJoin("documents", "doc",
        "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
        { type: "final-invoice", status: "COMPLETE" })
      .select("COALESCE(SUM(invoice.netProductWeight), 0)", "achievedQty")
      .addSelect("COALESCE(SUM(invoice.totalAmount), 0)", "totalAmount")
      .where("invoice.created_by::text = :ids", { ids: memberId })
      .andWhere("EXTRACT(MONTH FROM invoice.createdAt) = :month", { month: resolvedMonth })
      .andWhere("EXTRACT(YEAR FROM invoice.createdAt) = :year", { year: resolvedYear })
      .getRawOne();

    const achievedQty     = Number(result1?.achievedQty || 0);
    const totalSaleAmount = Number(result1?.totalAmount || 0);

    // Total sale qty (gross weight from invoice products)
    const result3 = await this.finalInvoiceRepo
      .createQueryBuilder("invoice")
      .innerJoin("documents", "doc",
        "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
        { type: "final-invoice", status: "COMPLETE" })
      .leftJoin("invoice.invoiceProducts", "invoiceProduct")
      .select("COALESCE(SUM(invoiceProduct.grossWeight), 0)", "totalQty")
      .where("invoice.created_by::text = :ids", { ids: memberId })
      .andWhere("EXTRACT(MONTH FROM invoice.createdAt) = :month", { month: resolvedMonth })
      .andWhere("EXTRACT(YEAR FROM invoice.createdAt) = :year", { year: resolvedYear })
      .getRawOne();

    const totalSaleQty = Number(result3?.totalQty || 0);

    const achievementRate = assignedTargetQty > 0
      ? (achievedQty / assignedTargetQty) * 100
      : 0;
    const variance = achievedQty - assignedTargetQty;

    // Invoice count
    const result2 = await this.finalInvoiceRepo
      .createQueryBuilder("invoice")
      .innerJoin("documents", "doc",
        "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
        { type: "final-invoice", status: "COMPLETE" })
      .select("COUNT(invoice.id)", "invoiceCount")
      .where("invoice.created_by::text = :ids", { ids: memberId })
      .andWhere("EXTRACT(MONTH FROM invoice.createdAt) = :month", { month: resolvedMonth })
      .andWhere("EXTRACT(YEAR FROM invoice.createdAt) = :year", { year: resolvedYear })
      .getRawOne();

    const noOfInvoices = Number(result2?.invoiceCount || 0);

    performanceData.push({
      employeeName,
      totalSaleAmount,
      totalSaleQty,
      noOfInvoices,
      assignedTargetQty,
      achievedQty,
      achievementRate,
      variance,
    });
  }

  // No children → return single object (self only)
  if (!hasChildNodes) {
    return performanceData[0];
  }

  // Has children → return array
  return performanceData;
}
// async getSaleTeamMembersPerformance(userId: string, month?: number, year?: number): Promise<any> {
//   const currentDate = new Date();
  
//   const selectedMonth =
//     month || currentDate.getMonth() + 1;
  
//   const selectedYear =
//     year || currentDate.getFullYear();

//    const teamMembers = await this.workflowHierarchyRepo.find({
//   where: {
//     ancestor: { id: userId },
//     department: DepartmentEnum.SALE,
//    //depth: 1 // direct team members
//   },
//   relations: ["descendant"]
// });

// const memberIds = [
//   ...new Set(teamMembers.map(t => String(t.descendant.id)))
// ];

// const currentMonth = new Date().getMonth();
// const newCurrenetMonth=new Date().getMonth()+1;
// const currentYear = new Date().getFullYear();

// const performanceData = [];

// for (const memberId of memberIds) {

//   const employee = await this.userRepo.findOne({
//   where: { id: memberId },
//   select: ["id", "firstName", "lastName"]
// });

// const employeeName = employee
//   ? `${employee.firstName} ${employee.lastName}`
//   : "Unknown";

// const targets = await this.saleTargetRepo
//   .createQueryBuilder("target")
//   .select("SUM(target.totalMonthlySale)", "totalTarget")
//   .where("target.employee_id::text =:ids", { ids: memberId })
//   .andWhere("target.month = :month", { month: selectedMonth })
//   .andWhere("target.year = :year", { year: selectedYear })
//   .getRawOne();
//   const AsignedTargetQty = Number(targets?.totalTarget || 0);

//  const result1 = await this.finalInvoiceRepo
//   .createQueryBuilder("invoice")
//   .innerJoin(
//     "documents",
//     "doc",
//     "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
//     {
//       type: "final-invoice",
//       status: "COMPLETE"
//     }
//   )
//   .select("SUM(invoice.netProductWeight)", "totalQty")
//   .addSelect("SUM(invoice.totalAmount)", "totalAmount")
//   .where("invoice.created_by::text = :ids", { ids: memberId })
//   .andWhere("EXTRACT(MONTH FROM invoice.createdAt) = :month", { month: selectedMonth })
//   .andWhere("EXTRACT(YEAR FROM invoice.createdAt) = :year", { year: selectedYear })
//   .getRawOne();

//   const achievedQty = Number(result1?.totalQty || 0);


//   const totalSaleAmount= Number(result1?.totalAmount || 0)

//   const result3 = await this.finalInvoiceRepo
//   .createQueryBuilder("invoice")
//   .innerJoin(
//     "documents",
//     "doc",
//     "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
//     {
//       type: "final-invoice",
//       status: "COMPLETE",
//     }
//   )
//   .leftJoin("invoice.invoiceProducts", "invoiceProduct")
//   .select("SUM(invoiceProduct.grossWeight)", "totalQty")
//  // .addSelect("SUM(invoice.totalAmount)", "totalAmount")
//   .where("invoice.created_by::text = :ids", { ids: memberId })
//   .andWhere(
//     "EXTRACT(MONTH FROM invoice.createdAt) = :month",
//     { month: selectedMonth }
//   )
//   .andWhere(
//     "EXTRACT(YEAR FROM invoice.createdAt) = :year",
//     { year: selectedYear }
//   )
//   .getRawOne();

//    const totalSaleQty= Number(result3?.totalQty || 0)

//    const achievementRate = AsignedTargetQty > 0
//   ? (achievedQty / AsignedTargetQty) * 100
//   : 0;

//    const variance = AsignedTargetQty - achievedQty;

//  const result2 = await this.finalInvoiceRepo
//   .createQueryBuilder("invoice")
//   .innerJoin(
//     "documents",
//     "doc",
//     "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
//     {
//       type: "final-invoice",
//       status: "COMPLETE"
//     }
//   )
//   .select("COUNT(invoice.id)", "invoiceCount")
//   .where("invoice.created_by::text = :ids", { ids: memberId })
//   .andWhere("EXTRACT(MONTH FROM invoice.createdAt) = :month", { month: selectedMonth })
//   .andWhere("EXTRACT(YEAR FROM invoice.createdAt) = :year", { year: selectedYear })
//   .getRawOne();

//   const invoiceCount = Number(result2?.invoiceCount || 0);

//   performanceData.push({
//   employeeName: employeeName,
//  // totalSaleAmount: totalSaleAmount,
//  totalSoldQty: totalSaleQty,
//   AsignedTargetQty: AsignedTargetQty,
//   achievedQty: achievedQty,
//   achievementRate: achievementRate,
//   variance: variance,
//   totalInvoices: invoiceCount
//  });
// }
// return performanceData; 
// }


//procurement team performance api replace
 //TODO:Get procurement team performance metrics for a manager
  async getProcurementTeamPerformance(userId: string, month?: number, year?: number): Promise<any> {
const teamMembers = await this.workflowHierarchyRepo.find({
  where: {
    ancestor: { id: userId },
    department: DepartmentEnum.PURCHASE,
    //depth: 1 // direct team members
  },
  relations: ["descendant"]
});

console.log("Team Members in DashboardService:", teamMembers.length);
const memberIds = [
  ...new Set(teamMembers.map(t => String(t.descendant.id)))
];
console.log("Team Member IDs in DashboardService:", memberIds);
const totalTeamMembers = memberIds.length;

// const currentMonth = new Date().getMonth();
// const currentYear = new Date().getFullYear();

const currentDate = new Date();

  const selectedMonth =
    month || currentDate.getMonth() + 1;

  const selectedYear =
    year || currentDate.getFullYear();

console.log("Current Month in DashboardService:", selectedMonth);
console.log("Current year",selectedYear);

const activeMembers = await this.procurementTargetRepo
  .createQueryBuilder("target")
  .select("DISTINCT target.employee_id", "employeeId")
  .where("target.employee_id::text IN (:...ids)", { ids: memberIds })
  .andWhere("target.month = :month", { month: selectedMonth })
  .andWhere("target.year = :year", { year: selectedYear })
  .getRawMany();

  const activeIds = activeMembers.map(a => a.employeeId);
  const activeMemberCount = activeIds.length;
  const inactiveMemberCount = memberIds.length - activeMemberCount;
  console.log("Active Member IDs in DashboardService:", activeIds);
  console.log("Active Member Count in DashboardService:", activeMemberCount);
  console.log("Inactive Member Count in DashboardService:", inactiveMemberCount);

   // 👉 Amount query (NO JOIN)
  const amountResult = await this.grnRepo
    .createQueryBuilder("grn")
    .innerJoin(
      "documents",
      "doc",
      "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
      {
        type: "grn",
        status: "COMPLETE"
      }
    )
    .select("COALESCE(SUM(grn.totalAmt), 0)", "totalAmount")
    .where("grn.createdby_id::text IN (:...ids)", { ids: memberIds })
     .andWhere("grn.createdAt <= :today", { today: new Date() })
    .getRawOne();

  // 👉 Quantity query (WITH JOIN)
  const qtyResult = await this.grnRepo
    .createQueryBuilder("grn")
    .innerJoin(
      "documents",
      "doc",
      "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
      {
        type: "grn",
        status: "COMPLETE"
      }
    )
    .leftJoin("grn.grnProducts", "product")
    .select("COALESCE(SUM(product.netWeight), 0)", "totalQty")
    .where("grn.createdby_id::text IN (:...ids)", { ids: memberIds })
    .andWhere("grn.createdAt <= :today", { today: new Date() })
    .getRawOne();

 const totalProcurementAmount= Number(amountResult?.totalAmount || 0)
 const totalProcurementQty= Number(qtyResult?.totalQty || 0)
console.log("Total Procurement Amount in DashboardService:", totalProcurementAmount);
console.log("Total Procurement Quantity in DashboardService:", totalProcurementQty);

const targets = await this.procurementTargetRepo
  .createQueryBuilder("target")
  .select("SUM(target.monthlyTotalQty)", "totalTarget")
  .where("target.employee_id::text IN (:...ids)", { ids: memberIds })
  .andWhere("target.month = :month", { month: month?selectedMonth:selectedMonth-1 })  ////
  .andWhere("target.year = :year", { year: selectedYear })
  .getRawOne();
  const asignedTargetQty = Number(targets?.totalTarget || 0);

const newCurrentMnth=new Date().getMonth()+1;
  const result1 = await this.grnRepo
  .createQueryBuilder("grn")
  .innerJoin(
    "documents",
    "doc",
    "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
    {
      type: "grn",
      status: "COMPLETE"
    }
  )
  .leftJoin("grn.grnProducts", "product")
  .select("SUM(product.netWeight)", "achievedQty")
  .where("grn.createdby_id::text IN (:...ids)", { ids: memberIds })
  .andWhere("EXTRACT(MONTH FROM grn.createdAt) = :month", { month: month?selectedMonth+1:selectedMonth })  ////
  .andWhere("EXTRACT(YEAR FROM grn.createdAt) = :year", { year: selectedYear })
  .getRawOne();

  const achievedQty = Number(result1?.achievedQty || 0);

  const achievementRate = asignedTargetQty > 0
  ? (achievedQty / asignedTargetQty) * 100
  : 0;

   const variance = achievedQty - asignedTargetQty;

   const totalRegisteredFarmers = await this.farmerRepo
  .createQueryBuilder("farmer")
  .select("COUNT(farmer.id)", "count")
  .where(
    "farmer.created_by::text IN (:...ids)",
    { ids: memberIds }
  )
  .andWhere(
    "farmer.status = :status",
    { status: "approved" }
  )
  .andWhere(
    "EXTRACT(MONTH FROM farmer.createdAt)=:month",
    { month: month?selectedMonth+1:selectedMonth}
  )
  .andWhere(
    "EXTRACT(YEAR FROM farmer.createdAt)=:year",
    { year: selectedYear }
  )
  .getRawOne();


const totalRegisteredVendors = await this.vendorRepo
  .createQueryBuilder("vendor")
  .select("COUNT(vendor.id)", "count")
  .where(
    "vendor.created_by::text IN (:...ids)",
    { ids: memberIds }
  )
  .andWhere(
    "vendor.status = :status",
    { status: "approved" }
  )
  .andWhere(
    "EXTRACT(MONTH FROM vendor.createdAt)=:month",
    { month: month?selectedMonth+1:selectedMonth}
  )
  .andWhere(
    "EXTRACT(YEAR FROM vendor.createdAt)=:year",
    { year: selectedYear }
  )
  .getRawOne();

  const farmerCount =
  Number(totalRegisteredFarmers?.count || 0);

const vendorCount =
  Number(totalRegisteredVendors?.count || 0);

   return{
    totalProcurementAmount:totalProcurementAmount,  
    totalProcurementQty:totalProcurementQty,
    asignedTargetQty:asignedTargetQty,
    achievedQty:achievedQty,
    achievementRate:achievementRate,
    variance:variance,
    totalRegisteredFarmers: farmerCount,
   totalRegisteredVendors: vendorCount
   }
  }

//sale team performance api replace
 //TODO:Get Sale team performance metrics for a manager
async getSaleTeamPerformance(userId: string, month?: number, year?: number): Promise<any> {
const teamMembers = await this.workflowHierarchyRepo.find({
  where: {
    ancestor: { id: userId },
    department: DepartmentEnum.SALE,
    //depth: 1 // direct team members
  },
  relations: ["descendant"]
});

const memberIds = [
  ...new Set(teamMembers.map(t => String(t.descendant.id)))
];
//const memberIds = teamMembers.map(t => t.descendant.id);
const totalTeamMembers = memberIds.length;

const currentMonth = new Date().getMonth();
const currentYear = new Date().getFullYear();

const currentDate = new Date();

  const selectedMonth =
    month || currentDate.getMonth() + 1;

  const selectedYear =
    year || currentDate.getFullYear();

const activeMembers = await this.saleTargetRepo
  .createQueryBuilder("target")
  .select("DISTINCT target.employee_id", "employeeId")
  .where("target.employee_id::text IN (:...ids)", { ids: memberIds })
  .andWhere("target.month = :month", { month: selectedMonth })
  .andWhere("target.year = :year", { year: selectedYear })
  .getRawMany();

  const activeIds = activeMembers.map(a => a.employeeId);
  const activeMemberCount = activeIds.length;
  const inactiveMemberCount = memberIds.length - activeMemberCount;

  const result = await this.finalInvoiceRepo
  .createQueryBuilder("invoice")
  .innerJoin(
    "documents",
    "doc",
    "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
    {
      type: "final-invoice",
      status: "COMPLETE"
    }
  )
  .select("SUM(invoice.totalAmount)", "totalAmount")
  .addSelect("SUM(invoice.netProductWeight)", "totalQty")
  .where("invoice.created_by::text IN (:...ids)", { ids: memberIds })
  .andWhere("invoice.createdAt <= :today", { today: new Date() })
  .getRawOne();

 const totalSaleAmount= Number(result?.totalAmount || 0)
 const totalSaleQty= Number(result?.totalQty || 0)

const targets = await this.saleTargetRepo
  .createQueryBuilder("target")
  .select("SUM(target.totalMonthlySale)", "totalTarget")
  .where("target.employee_id::text IN (:...ids)", { ids: memberIds })
  .andWhere("target.month = :month", { month: month?selectedMonth:selectedMonth-1 })
  .andWhere("target.year = :year", { year: selectedYear })
  .getRawOne();
  const asignedTargetQty = Number(targets?.totalTarget || 0);

  const newCurrentMnth=new Date().getMonth()+1;
  const result1 = await this.finalInvoiceRepo
  .createQueryBuilder("invoice")
  .innerJoin(
    "documents",
    "doc",
    "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
    {
      type: "final-invoice",
      status: "COMPLETE"
    }
  )
  .select("SUM(invoice.netProductWeight)", "totalQty")
  .where("invoice.created_by::text IN (:...ids)", { ids: memberIds })
  .andWhere("EXTRACT(MONTH FROM invoice.createdAt) = :month", { month: month?selectedMonth+1:selectedMonth })
  .andWhere("EXTRACT(YEAR FROM invoice.createdAt) = :year", { year: selectedYear })
  .getRawOne();

  const achievedQty = Number(result1?.totalQty || 0);

  const achievementRate = asignedTargetQty > 0
  ? (achievedQty / asignedTargetQty) * 100
  : 0;

   const variance = achievedQty - asignedTargetQty;

   const totalRegisteredCutomers = await this.customerRepo
  .createQueryBuilder("customer")
  .select("COUNT(customer.id)", "count")
  .where(
    "customer.created_by::text IN (:...ids)",
    { ids: memberIds }
  )
  .andWhere(
    "customer.status = :status",
    { status: "approved" }
  )
  .andWhere(
    "EXTRACT(MONTH FROM customer.createdAt)=:month",
    { month: month?selectedMonth+1:selectedMonth }
  )
  .andWhere(
    "EXTRACT(YEAR FROM customer.createdAt)=:year",
    { year: selectedYear }
  )
  .getRawOne();
  
  const cutomerCount =
  Number(totalRegisteredCutomers?.count || 0);

   return{
    totalSaleAmount:totalSaleAmount,  
    totalSaleQty:totalSaleQty,
    asignedTargetQty:asignedTargetQty,
    achievedQty:achievedQty,
    achievementRate:achievementRate,
    variance:variance,
    totalRegisteredCutomers: cutomerCount,
   }
  }

  //TODO:Get Procurement Overview for all team in dashboard
async getProcurementOverview(): Promise<any> {
     // 👉 Amount query (NO JOIN)
  const amountResult = await this.grnRepo
    .createQueryBuilder("grn")
    .innerJoin(
      "documents",
      "doc",
      "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
      {
        type: "grn",
        status: "COMPLETE"
      }
    )
    .select("COALESCE(SUM(grn.totalAmt), 0)", "totalAmount")
    .andWhere("grn.createdAt <= :today", { today: new Date() })
    .getRawOne();

    // 👉 Quantity query (WITH JOIN)
  const qtyResult = await this.grnRepo
    .createQueryBuilder("grn")
    .innerJoin(
      "documents",
      "doc",
      "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
      {
        type: "grn",
        status: "COMPLETE"
      }
    )
    .leftJoin("grn.grnProducts", "product")
    .select("COALESCE(SUM(product.netWeight), 0)", "totalQty")
    .andWhere("grn.createdAt <= :today", { today: new Date() })
    .getRawOne();

 const totalProcurementAmount= Number(amountResult?.totalAmount || 0)
 const totalProcurementQty= Number(qtyResult?.totalQty || 0)
console.log("Total Procurement Amount in DashboardService:", totalProcurementAmount);
console.log("Total Procurement Quantity in DashboardService:", totalProcurementQty);

return{
  procurementQuantity: totalProcurementQty,
  procurementAmount: totalProcurementAmount
}
}

//TODO:Get Sale Overview for all team in Dashboard
async getSaleOverview(): Promise<any> {
  const result = await this.finalInvoiceRepo
  .createQueryBuilder("invoice")
  .innerJoin(
    "documents",
    "doc",
    "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
    {
      type: "final-invoice",
      status: "COMPLETE"
    }
  )
  .select("SUM(invoice.totalAmount)", "totalAmount")
  .addSelect("SUM(invoice.netProductWeight)", "totalQty")
  .andWhere("invoice.createdAt <= :today", { today: new Date() })
  .getRawOne();

 const totalSaleAmount= Number(result?.totalAmount || 0)
 const totalSaleQty= Number(result?.totalQty || 0)

 return{
  saleQuantity: totalSaleQty,
  saleAmount: totalSaleAmount
 }
}

//TODO:Get GRN Overview for all team in Dashboard
async getGRNOverview(): Promise<any> {
  const grnCountResult = await this.grnRepo
  .createQueryBuilder("grn")
  .select("COUNT(grn.id)", "grnCount")
  .andWhere("grn.createdAt <= :today", { today: new Date() })
  .getRawOne();

const totalGrnCount = Number(grnCountResult?.grnCount || 0);

const pendingGrnCountResult = await this.grnRepo
  .createQueryBuilder("grn")
  .innerJoin(
    "documents",
    "doc",
    "doc.document_type_id = grn.id::text AND doc.type = :type",
    { type: "grn" }
  )
  .select("COUNT(grn.id)", "grnCount")
  .where("doc.status != :status", { status: "COMPLETE" })
  .andWhere("grn.createdAt <= :today", { today: new Date() })
  .getRawOne();

  return{
    totalGrnCount: totalGrnCount,
    pendingGrnCount: Number(pendingGrnCountResult?.grnCount || 0)
  }
}

//TODO:Get Invoice Overview for all team in Dashboard
async getInvoiceOverview(): Promise<any> {
const result2 = await this.finalInvoiceRepo
  .createQueryBuilder("invoice")
  .select("COUNT(invoice.id)", "invoiceCount")
  .andWhere("invoice.createdAt <= :today", { today: new Date() })
  .getRawOne();

  const invoiceCount = Number(result2?.invoiceCount || 0);

  const pendingInvoiceCount = await this.finalInvoiceRepo
  .createQueryBuilder("invoice")
  .innerJoin(
    "documents",
    "doc",
    "doc.document_type_id = invoice.id::text AND doc.type = :type",
    {
      type: "final-invoice",
    }
  )
  .select("COUNT(invoice.id)", "invoiceCount")
  .where("doc.status != :status", { status: "COMPLETE" })
  .andWhere("invoice.createdAt <= :today", { today: new Date() })
  .getRawOne();

  return {
    totalInvoicesCount: invoiceCount,
    pendingInvoiceCount: Number(pendingInvoiceCount?.invoiceCount || 0)
  };
}

//TODO:Get sale overview by customer type wise in Dashboard
async getCustomerTypeWiseSaleOverview(): Promise<any> {
  const result = await this.finalInvoiceRepo
  .createQueryBuilder("invoice")
  .innerJoin(
    "documents",
    "doc",
    "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
    {
      type: "final-invoice",
      status: "COMPLETE"
    }
  )
  .innerJoin("invoice.customerName", "customer")
  .innerJoin("customer.customerTypes", "customerType")
  .where("invoice.invoiceDate <= CURRENT_DATE") // ✅ Till today
  .select([
    "customerType.id AS customerTypeId",
    "COALESCE(customerType.name) AS customerTypeName",
    "COALESCE(SUM(invoice.netProductWeight), 0) AS totalQty",
    "COALESCE(SUM(invoice.totalAmount), 0) AS totalAmount"
  ])
  .groupBy("customerType.id")
  .addGroupBy("customerType.name")
  .getRawMany();

const formattedResult = result.map(r => ({
  customerTypeName: r.customertypename || "Unknown",
  totalSaleQuantity: Number(r.totalqty) || 0,
  totalSaleAmount: Number(r.totalamount) || 0
}));
 return formattedResult;
}

//TODO:Get sale overview by customer category wise in Dashboard
async getCustomerCategoryWiseSaleOverview(): Promise<any> {
  const result = await this.finalInvoiceRepo
  .createQueryBuilder("invoice")
  .innerJoin(
    "documents",
    "doc",
    "doc.document_type_id = invoice.id::text AND doc.type = :type AND doc.status = :status",
    {
      type: "final-invoice",
      status: "COMPLETE"
    }
  )
  .innerJoin("invoice.customerName", "customer")
  .innerJoin("customer.customerCategory", "customerCategory")
  .where("invoice.invoiceDate <= CURRENT_DATE") // ✅ Till today
  .select([
    "customerCategory.id AS customerCategoryId",
    "COALESCE(customerCategory.name) AS customerCategoryName",
    "COALESCE(SUM(invoice.netProductWeight), 0) AS totalQty",
    "COALESCE(SUM(invoice.totalAmount), 0) AS totalAmount"
  ])
  .groupBy("customerCategory.id")
  .addGroupBy("customerCategory.name")
  .getRawMany();

const formattedResult = result.map(r => ({
  customerCategoryName: r.customercategoryname || "Unknown",
  totalSaleQuantity: Number(r.totalqty) || 0,
  totalSaleAmount: Number(r.totalamount) || 0
}));
 return formattedResult;
}

//TODO:Get Procurement Overview by vendor category wise in Dashboard
async getVendorCategoryWiseProcurementOverview(): Promise<any> {
  const result = await this.grnRepo
  .createQueryBuilder("grn")
  .innerJoin(
    "documents",
    "doc",
    "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
    {
      type: "grn",
      status: "COMPLETE",
    }
  )
  .innerJoin("grn.selectedVendor", "vendor") // ✅ only vendor GRNs
  .innerJoin("vendor.category", "category")  // ✅ only category mapped vendors
  .leftJoin("grn.grnProducts", "product")
  .select([
    "grn.id AS grnId",
    "category.id AS categoryId",
    "category.name AS categoryName",
    "product.netWeight AS netWeight",
    "grn.totalAmt AS totalAmount",
  ])
  .where("DATE(grn.createdAt) <= CURRENT_DATE")
  .getRawMany();

console.log("RAW DATA:", result);
//return result;
const aggregated = Object.values(
  result.reduce((acc: any, row: any) => {
    const key = row.categoryid;

    if (!acc[key]) {
      acc[key] = {
        categoryId: row.categoryid,
        categoryName: row.categoryname,
        totalProcurementQty: 0,
        totalProcurementAmount: 0,
        processedGrns: new Set(),
      };
    }

    acc[key].totalProcurementQty += Number(row.netweight || 0);

    // ✅ avoid duplicate amount
    if (!acc[key].processedGrns.has(row.grnid)) {
      acc[key].totalProcurementAmount += Number(row.totalamount || 0);
      acc[key].processedGrns.add(row.grnid);
    }

    return acc;
  }, {})
).map((item: any) => {
  delete item.processedGrns;
  return item;
});

return aggregated;
}

//TODO:Get Procurement Overview by vendor Subcategory wise in Dashboard
async getVendorSubcategoryWiseProcurementOverview(): Promise<any> {
  const result = await this.grnRepo
  .createQueryBuilder("grn")
  .innerJoin(
    "documents",
    "doc",
    "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
    {
      type: "grn",
      status: "COMPLETE",
    }
  )
  .innerJoin("grn.selectedVendor", "vendor") // ✅ only vendor GRNs
  .innerJoin("vendor.category", "category") 
  .innerJoin("vendor.subcategory", "subcategory") // ✅ only subcategory mapped vendors
  .leftJoin("grn.grnProducts", "product")
  .select([
    "grn.id AS grnId",
    "category.id AS categoryId",
    "category.name AS categoryName",
    "subcategory.id AS subcategoryId",
    "subcategory.name AS subcategoryName",
    "product.netWeight AS netWeight",
    "grn.totalAmt AS totalAmount",
  ])
  .where("DATE(grn.createdAt) <= CURRENT_DATE")
  .getRawMany();

console.log("RAW DATA:", result);
//return result;
const aggregated = Object.values(
  result.reduce((acc: any, row: any) => {
    const key = row.subcategoryid;

    if (!acc[key]) {
      acc[key] = {
        subcategoryId: row.subcategoryid,
        subcategoryName: row.subcategoryname,
        totalProcurementQty: 0,
        totalProcurementAmount: 0,
        processedGrns: new Set(),
      };
    }

    acc[key].totalProcurementQty += Number(row.netweight || 0);

    // ✅ avoid duplicate amount
    if (!acc[key].processedGrns.has(row.grnid)) {
      acc[key].totalProcurementAmount += Number(row.totalamount || 0);
      acc[key].processedGrns.add(row.grnid);
    }

    return acc;
  }, {})
).map((item: any) => {
  delete item.processedGrns;
  return item;
});

return aggregated;
}


//TODO:Get Location Wise sale overview in Dashboard (Sale Distribution by location)
async getLocationWiseSaleOverview(): Promise<any> {
  const result = await this.finalInvoiceRepo
  .createQueryBuilder("inv")
  .innerJoin(
    "documents",
    "doc",
    "doc.document_type_id = inv.id::text AND doc.type = :type AND doc.status = :status",
    {
      type: "final-invoice",
      status: "COMPLETE",
    }
  )
  .leftJoin("inv.deliveryChallan", "dc")
  .leftJoin("dc.fromLocation", "location") // 🔥 Location
  .select([
    "inv.id AS invoiceId",
    "dc.id AS dcId",
    "location.id AS locationId",
    "location.name AS locationName",
    "inv.totalAmount AS totalAmount",
    "inv.netProductWeight AS netWeight",
  ])
  .getRawMany();

console.log("RAW:", result);

const aggregated = Object.values(
  result.reduce((acc: any, row: any) => {
    const key = row.locationid || "UNKNOWN";
    if (!acc[key]) {
      acc[key] = {
        locationId: row.locationid,
        locationName: row.locationname || "Unknown Location",
        totalInvoices: 0,
        totalDCs: new Set(),
        totalSaleAmount: 0,
        totalQuantity: 0,
        processedInvoices: new Set(),
      };
    }
    // ✅ Count unique invoices
    if (!acc[key].processedInvoices.has(row.invoiceid)) {
      acc[key].totalInvoices += 1;
      acc[key].totalSaleAmount += Number(row.totalamount || 0);
      acc[key].totalQuantity += Number(row.netweight || 0);
      acc[key].processedInvoices.add(row.invoiceid);
    }
    // ✅ Count unique DCs
    if (row.dcid) {
      acc[key].totalDCs.add(row.dcid);
    }
    return acc;
  }, {})
).map((item: any) => {
  item.totalDCs = item.totalDCs.size;
  delete item.processedInvoices;
  return item;
});
return aggregated;
}

//TODO:Get Location Wise procurement overview in Dashboard (Procurement Distribution by location)
async getLocationWiseProcurementOverview(): Promise<any> {
 const result = await this.grnRepo
  .createQueryBuilder("grn")
  .innerJoin(
    "documents",
    "doc",
    "doc.document_type_id = grn.id::text AND doc.type = :type AND doc.status = :status",
    {
      type: "grn",
      status: "COMPLETE",
    }
  )
  .leftJoin("grn.purchaseLocation", "location")
  .leftJoin("grn.grnProducts", "product")
  .select([
    "grn.id AS grnId",
    "location.id AS locationId",
    "location.name AS locationName",
    "grn.totalAmt AS totalAmount",
    "product.netWeight AS netWeight",
  ])
  .getRawMany();

console.log("RAW:", result);

const aggregated = Object.values(
  result.reduce((acc: any, row: any) => {
    const key = row.locationid || "UNKNOWN";

    if (!acc[key]) {
      acc[key] = {
        locationId: row.locationid,
        locationName: row.locationname || "Unknown Location",
        totalGrns: 0,
        totalProcurementAmount: 0,
        totalQuantity: 0,
        processedGrns: new Set(),
      };
    }

    // ✅ ALWAYS add quantity (product level)
    acc[key].totalQuantity += Number(row.netweight || 0);

    // ✅ Add amount only once per GRN
    if (!acc[key].processedGrns.has(row.grnid)) {
      acc[key].totalGrns += 1;
      acc[key].totalProcurementAmount += Number(row.totalamount || 0);
      acc[key].processedGrns.add(row.grnid);
    }

    return acc;
  }, {})
).map((item: any) => {
  delete item.processedGrns;
  return item;
});
return aggregated;
}

private async getEmployeeIds(teamLeaderId: string): Promise<string[]> {
    const rows = await this.dataSource
      .getRepository(WorkflowHierarchy)
      .createQueryBuilder("wh")
      .select("wh.descendant_id", "descendantId")
      .where("wh.ancestor_id = :teamLeaderId", { teamLeaderId })
      .andWhere("wh.depth > 0")
      .andWhere("wh.isDeleted = false")
      .getRawMany();

    return rows.map((r) => r.descendantId);
  }

  /**
   * Top 5 customers by highest sales (final invoices with COMPLETE document status).
   *
   * Query params:
   *  - teamLeaderId (optional): scopes to employees under that team leader.
   */
  public async getTop5Customer(query: any): Promise<any> {
    const teamLeaderId: string | undefined = query.teamLeaderId as string | undefined;

    let employeeIds: string[] | null = null;

    if (teamLeaderId) {
      employeeIds = await this.getEmployeeIds(teamLeaderId);

      if (employeeIds.length === 0) {
        return {
          teamLeaderId,
          top5Customers: [],
          message: "No employees found under this team leader",
        };
      }
    }

    // Subquery: Invoice IDs whose document status is COMPLETE
    const completedInvoiceIds = this.dataSource
      .getRepository(Documentb)
      .createQueryBuilder("doc")
      .select("doc.document_type_id")
      .where("doc.type = :invType", { invType: DocumentTypeEnum.FINAL_INVOICE })
      .andWhere("doc.status = :invStatus", { invStatus: DocumentStatus.COMPLETE })
      .andWhere("doc.isDeleted = false");

    const invoiceQuery = this.dataSource
      .getRepository(Invoice)
      .createQueryBuilder("invoice")
      .innerJoin("invoice.customerName", "customer")
      .select([
        "customer.id                           AS \"customerId\"",
        "customer.organisationName             AS \"customerName\"",
        "customer.customerCode                 AS \"customerCode\"",
        "customer.primaryContactNo             AS \"primaryContactNo\"",
        "COALESCE(SUM(invoice.totalAmount), 0) AS \"totalSalesAmount\"",
        "COUNT(invoice.id)                     AS \"totalInvoices\"",
      ])
      .where("invoice.isDeleted = false")
      .andWhere("customer.isDeleted = false")
      .andWhere("customer.id IS NOT NULL")
      .andWhere(`CAST(invoice.id AS varchar) IN (${completedInvoiceIds.getQuery()})`)
      .setParameters(completedInvoiceIds.getParameters());

    if (employeeIds) {
      invoiceQuery.andWhere("invoice.createdBy IN (:...employeeIds)", { employeeIds });
    }

    const results = await invoiceQuery
      .groupBy("customer.id, customer.organisationName, customer.customerCode, customer.primaryContactNo")
      .orderBy("\"totalSalesAmount\"", "DESC")
      .limit(5)
      .getRawMany();

    const top5 = results.map((row) => ({
      customerId: row.customerId,
      customerName: row.customerName,
      customerCode: row.customerCode,
      primaryContactNo: row.primaryContactNo,
      totalSalesAmount: Number(row.totalSalesAmount),
      totalInvoices: Number(row.totalInvoices),
    }));

    return {
      teamLeaderId: teamLeaderId || null,
      top5Customers: top5,
    };
  }

  /**
   * Top 5 farmers by highest purchase quantity (netWeight).
   * Only GRNs whose document status is COMPLETE are counted.
   *
   * Query params:
   *  - teamLeaderId (optional): scopes to employees under that team leader.
   */
  public async getTop5Farmer(query: any): Promise<any> {
    const teamLeaderId: string | undefined = query.teamLeaderId as string | undefined;

    let employeeIds: string[] | null = null;

    if (teamLeaderId) {
      employeeIds = await this.getEmployeeIds(teamLeaderId);

      if (employeeIds.length === 0) {
        return {
          teamLeaderId,
          top5Farmers: [],
          message: "No employees found under this team leader",
        };
      }
    }

    const completedGrnIds = this.dataSource
      .getRepository(Documentb)
      .createQueryBuilder("doc")
      .select("doc.document_type_id")
      .where("doc.type = :type", { type: DocumentTypeEnum.GRN })
      .andWhere("doc.status = :status", { status: DocumentStatus.COMPLETE })
      .andWhere("doc.isDeleted = false");

    const grnQuery = this.dataSource
      .getRepository(GRN)
      .createQueryBuilder("grn")
      .innerJoin("grn.grnProducts", "grnProduct")
      .innerJoin("grn.selectedFarmer", "farmer")
      .select([
        "farmer.id                                                                        AS \"farmerId\"",
        "CONCAT(farmer.farmerfName, ' ', farmer.farmermName, ' ', farmer.farmerlName)     AS \"farmerName\"",
        "farmer.farmerCode                                                                AS \"farmerCode\"",
        "farmer.primaryMobileNo                                                           AS \"primaryMobileNo\"",
        "COALESCE(SUM(grnProduct.netWeight), 0)                                           AS \"totalQuantity\"",
        "COUNT(DISTINCT grn.id)                                                           AS \"totalGRNs\"",
        "COALESCE(SUM(grn.totalAmt), 0)                                                   AS \"totalPurchaseAmount\"",
      ])
      .where("grn.isDeleted = false")
      .andWhere("farmer.isDeleted = false")
      .andWhere("farmer.id IS NOT NULL")
      .andWhere("grn.source = :source", { source: "farmer" })
      .andWhere("grn.grnType = :grnType", { grnType: "purchase" })
      .andWhere(`CAST(grn.id AS varchar) IN (${completedGrnIds.getQuery()})`)
      .setParameters(completedGrnIds.getParameters());

    if (employeeIds) {
      grnQuery.andWhere("grn.createdBy IN (:...employeeIds)", { employeeIds });
    }

    const results = await grnQuery
      .groupBy("farmer.id, farmer.farmerfName, farmer.farmermName, farmer.farmerlName, farmer.farmerCode, farmer.primaryMobileNo")
      .orderBy("\"totalQuantity\"", "DESC")
      .limit(5)
      .getRawMany();

    const top5 = results.map((row) => ({
      farmerId: row.farmerId,
      farmerName: row.farmerName?.trim() || "Unknown",
      farmerCode: row.farmerCode,
      primaryMobileNo: row.primaryMobileNo,
      totalQuantity: Number(row.totalQuantity),
      totalGRNs: Number(row.totalGRNs),
      totalPurchaseAmount: Number(row.totalPurchaseAmount),
    }));

    return {
      teamLeaderId: teamLeaderId || null,
      top5Farmers: top5,
    };
  }

  /**
   * Top 5 vendors by highest purchase quantity (netWeight).
   * Only GRNs whose document status is COMPLETE are counted.
   *
   * Query params:
   *  - teamLeaderId (optional): scopes to employees under that team leader.
   */
  public async getTop5Vendor(query: any): Promise<any> {
    const teamLeaderId: string | undefined = query.teamLeaderId as string | undefined;

    let employeeIds: string[] | null = null;

    if (teamLeaderId) {
      employeeIds = await this.getEmployeeIds(teamLeaderId);

      if (employeeIds.length === 0) {
        return {
          teamLeaderId,
          top5Vendors: [],
          message: "No employees found under this team leader",
        };
      }
    }

    const completedGrnIds = this.dataSource
      .getRepository(Documentb)
      .createQueryBuilder("doc")
      .select("doc.document_type_id")
      .where("doc.type = :type", { type: DocumentTypeEnum.GRN })
      .andWhere("doc.status = :status", { status: DocumentStatus.COMPLETE })
      .andWhere("doc.isDeleted = false");

    const grnQuery = this.dataSource
      .getRepository(GRN)
      .createQueryBuilder("grn")
      .innerJoin("grn.grnProducts", "grnProduct")
      .innerJoin("grn.selectedVendor", "vendor")
      .select([
        "vendor.id                              AS \"vendorId\"",
        "vendor.companyName                     AS \"vendorName\"",
        "vendor.vendorCode                      AS \"vendorCode\"",
        "vendor.officeContactNo                 AS \"officeContactNo\"",
        "COALESCE(SUM(grnProduct.netWeight), 0)  AS \"totalQuantity\"",
        "COUNT(DISTINCT grn.id)                 AS \"totalGRNs\"",
        "COALESCE(SUM(grn.totalAmt), 0)         AS \"totalPurchaseAmount\"",
      ])
      .where("grn.isDeleted = false")
      .andWhere("vendor.isDeleted = false")
      .andWhere("vendor.id IS NOT NULL")
      .andWhere("grn.source = :source", { source: "vendor" })
      .andWhere("grn.grnType = :grnType", { grnType: "purchase" })
      .andWhere(`CAST(grn.id AS varchar) IN (${completedGrnIds.getQuery()})`)
      .setParameters(completedGrnIds.getParameters());

    if (employeeIds) {
      grnQuery.andWhere("grn.createdBy IN (:...employeeIds)", { employeeIds });
    }

    const results = await grnQuery
      .groupBy("vendor.id, vendor.companyName, vendor.vendorCode, vendor.officeContactNo")
      .orderBy("\"totalQuantity\"", "DESC")
      .limit(5)
      .getRawMany();

    const top5 = results.map((row) => ({
      vendorId: row.vendorId,
      vendorName: row.vendorName || "Unknown",
      vendorCode: row.vendorCode,
      officeContactNo: row.officeContactNo,
      totalQuantity: Number(row.totalQuantity),
      totalGRNs: Number(row.totalGRNs),
      totalPurchaseAmount: Number(row.totalPurchaseAmount),
    }));

    return {
      teamLeaderId: teamLeaderId || null,
      top5Vendors: top5,
    };
  }

  async getWeeklyProcurementPerformance(
  userId: string,
  month?: number,
  year?: number
) {
  const currentDate = new Date();

  const selectedMonth =
    month || currentDate.getMonth() + 1;

  const selectedYear =
    year || currentDate.getFullYear();

  const target = await this.procurementTargetRepo
    .createQueryBuilder("pt")
    .leftJoinAndSelect("pt.products", "products")
    .leftJoinAndSelect(
      "products.weeklyProcurement",
      "weeklyProcurement"
    )
    .leftJoin("pt.employee", "employee")
    .where("employee.id = :userId", {
      userId,
    })
    .andWhere("pt.month = :month", {
      month: selectedMonth,
    })
    .andWhere("pt.year = :year", {
      year: selectedYear,
    })
    .getOne();

  if (!target) {
    return [];
  }

  const allWeeks =
    target.products?.flatMap(
      product => product.weeklyProcurement || []
    ) || [];

  if (!allWeeks.length) {
    return [];
  }

  const minStartDate = allWeeks.reduce(
    (min, week) =>
      week.weekStartDate < min
        ? week.weekStartDate
        : min,
    allWeeks[0].weekStartDate
  );

  const maxEndDate = allWeeks.reduce(
    (max, week) =>
      week.weekEndDate > max
        ? week.weekEndDate
        : max,
    allWeeks[0].weekEndDate
  );

  const grnProducts = await this.grnProductRepo
    .createQueryBuilder("gp")
    .leftJoinAndSelect("gp.grn", "grn")
    .where("grn.createdby_id = :userId", {
      userId,
    })
    .andWhere(
      "grn.createdAt BETWEEN :startDate AND :endDate",
      {
        startDate: minStartDate,
        endDate: maxEndDate,
      }
    )
    .getMany();

  const weeklyPerformance = [];

  for (let weekNo = 1; weekNo <= 5; weekNo++) {
    const weekRecords = allWeeks.filter(
      week => Number(week.weekNo) === weekNo
    );

    if (!weekRecords.length) {
      continue;
    }

    const assignedTargetQty = weekRecords.reduce(
      (sum, week) =>
        sum + Number(week.qty || 0),
      0
    );

    const weekStartDate = new Date(
      weekRecords[0].weekStartDate
    );

    const weekEndDate = new Date(
      weekRecords[0].weekEndDate
    );

    const achievedQty = grnProducts
      .filter(gp => {
        const createdAt = new Date(
          gp.grn.createdAt
        );

        return (
          createdAt >= weekStartDate &&
          createdAt <= weekEndDate
        );
      })
      .reduce(
        (sum, gp) =>
          sum + Number(gp.netWeight || 0),
        0
      );

    weeklyPerformance.push({
      period: `Week - ${weekNo}`,
      assignedTargetQty,
      achievedQty,
    });
  }
  return weeklyPerformance;
}

async getWeeklySalesPerformance(
  userId: string,
  month?: number,
  year?: number
) {
  const currentDate = new Date();

  const selectedMonth =
    month || currentDate.getMonth() + 1;

  const selectedYear =
    year || currentDate.getFullYear();

  const target = await this.salesTargetRepo
    .createQueryBuilder("st")
    .leftJoinAndSelect(
      "st.employee",
      "employee"
    )
    .leftJoinAndSelect(
      SalesTargetProduct,
      "product",
      "product.target.id = st.id"
    )
    .leftJoinAndSelect(
      SalesTargetWeek,
      "week",
      "week.productTarget.id = product.id"
    )
    .where("employee.id = :userId", {
      userId,
    })
    .andWhere("st.month = :month", {
      month: selectedMonth,
    })
    .andWhere("st.year = :year", {
      year: selectedYear,
    })
    .getOne();

  if (!target) {
    return [];
  }

  const allWeeks = await this.salesTargetWeekRepo
    .createQueryBuilder("week")
    .leftJoin(
      "week.productTarget",
      "productTarget"
    )
    .leftJoin(
      "productTarget.target",
      "target"
    )
    .where("target.id = :targetId", {
      targetId: target.id,
    })
    .getMany();

  if (!allWeeks.length) {
    return [];
  }

  const minStartDate = allWeeks.reduce(
    (min, week) =>
      week.weekStartDate < min
        ? week.weekStartDate
        : min,
    allWeeks[0].weekStartDate
  );

  const maxEndDate = allWeeks.reduce(
    (max, week) =>
      week.weekEndDate > max
        ? week.weekEndDate
        : max,
    allWeeks[0].weekEndDate
  );

  const invoices = await this.finalInvoiceRepo
    .createQueryBuilder("invoice")
    .leftJoin(
      "invoice.createdBy",
      "createdBy"
    )
    .where("createdBy.id = :userId", {
      userId,
    })
    .andWhere(
      "invoice.invoiceDate BETWEEN :startDate AND :endDate",
      {
        startDate: minStartDate,
        endDate: maxEndDate,
      }
    )
    .getMany();

  const weeklyPerformance = [];

  for (let weekNo = 1; weekNo <= 5; weekNo++) {
    const weekRecords = allWeeks.filter(
      week => Number(week.weekNo) === weekNo
    );

    if (!weekRecords.length) {
      continue;
    }

    const assignedTargetQty =
      weekRecords.reduce(
        (sum, week) =>
          sum + Number(week.saleAmount || 0),
        0
      );

    const weekStartDate = new Date(
      weekRecords[0].weekStartDate
    );

    const weekEndDate = new Date(
      weekRecords[0].weekEndDate
    );

    const achievedQty = invoices
      .filter(invoice => {
        const invoiceDate = new Date(
          invoice.invoiceDate
        );

        return (
          invoiceDate >= weekStartDate &&
          invoiceDate <= weekEndDate
        );
      })
      .reduce(
        (sum, invoice) =>
          sum +
          Number(
            invoice.netProductWeight || 0
          ),
        0
      );

    weeklyPerformance.push({
      period: `Week - ${weekNo}`,
      assignedTargetQty,
      achievedQty,
    });
  }

  return weeklyPerformance;
}

}
