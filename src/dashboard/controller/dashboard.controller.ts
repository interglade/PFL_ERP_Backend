import { controller, httpGet, request, response } from "inversify-express-utils";
import { Request, Response } from "express";
import { inject } from "inversify";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { DashboardService } from "../service/dashboard.service";
import { WeeklyBusinessPlanService } from "../service/weeklyBusinessPlan.service";
import { TYPES } from "../../types";

@controller('/dashboard', deserializeUser, requireUser)
export class DashboardController {
    
    constructor(
        @inject(TYPES.DashboardService)
        private dashboardService: DashboardService,
        @inject(TYPES.WeeklyBusinessPlanService)
        private weeklyBusinessPlanService: WeeklyBusinessPlanService
    ) { }

    // ─── Weekly business plan achievement ─────────────────────────────────
    //
    // Four views, one response shape, so the dashboard renders them with a
    // single component:
    //   [{ week: 'week-1', assignedQuantity, achievedQuantity, achievedAmount }]
    //
    // `month` and `year` default to the current month when not supplied.

    /** Own procurement plan versus own procurement, week by week. */
    @httpGet('/business-plan/weekly/procurement/own')
    async getOwnWeeklyProcurement(
        @request() req: Request,
        @response() res: Response
    ) {
        return this.respondWithWeekly(req, res, 'own procurement', (userId, month, year) =>
            this.weeklyBusinessPlanService.getOwnProcurement(userId, month, year)
        );
    }

    /** Own sales plan versus own invoicing, week by week. */
    @httpGet('/business-plan/weekly/sales/own')
    async getOwnWeeklySales(
        @request() req: Request,
        @response() res: Response
    ) {
        return this.respondWithWeekly(req, res, 'own sales', (userId, month, year) =>
            this.weeklyBusinessPlanService.getOwnSales(userId, month, year)
        );
    }

    /** The team's procurement plan versus the team's procurement. */
    @httpGet('/business-plan/weekly/procurement/team')
    async getTeamWeeklyProcurement(
        @request() req: Request,
        @response() res: Response
    ) {
        return this.respondWithWeekly(req, res, 'team procurement', (userId, month, year) =>
            this.weeklyBusinessPlanService.getTeamProcurement(userId, month, year)
        );
    }

    /** The team's sales plan versus the team's invoicing. */
    @httpGet('/business-plan/weekly/sales/team')
    async getTeamWeeklySales(
        @request() req: Request,
        @response() res: Response
    ) {
        return this.respondWithWeekly(req, res, 'team sales', (userId, month, year) =>
            this.weeklyBusinessPlanService.getTeamSales(userId, month, year)
        );
    }

    /**
     * Shared plumbing for the four weekly endpoints: reads and validates the
     * month/year filter, then wraps whatever the service returns.
     */
    private async respondWithWeekly(
        req: Request,
        res: Response,
        label: string,
        load: (userId: string, month: number, year: number) => Promise<unknown>
    ) {
        const userId = res.locals.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated" });
        }

        const now = new Date();
        const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
        const year = req.query.year ? Number(req.query.year) : now.getFullYear();

        if (!Number.isInteger(month) || month < 1 || month > 12) {
            return res.status(400).json({
                success: false,
                message: "month must be a whole number between 1 and 12"
            });
        }

        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
            return res.status(400).json({
                success: false,
                message: "year must be a whole number between 2000 and 2100"
            });
        }

        try {
            const data = await load(userId, month, year);
            return res.status(200).json({
                success: true,
                data,
                message: `Weekly ${label} achievement retrieved successfully`
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }


    //TODO:Get Procurement Team Performance 
    @httpGet('/midlevel/procurement/team-performance')
    async getProcurementTeamPerformance(
        @request() req: Request,
        @response() res: Response
    ) {
        const userId = res.locals.user.id;
        const month = req.query.month
      ? Number(req.query.month)
      : undefined;

    const year = req.query.year
      ? Number(req.query.year)
      : undefined;
        console.log("User ID in DashboardController:", userId);
        try {
            const data = await this.dashboardService.getProcurementTeamPerformance(userId, month, year);
            return res.status(200).json({
                success: true,
                data,
                message: "Procurement team performance data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    //TODO:Get Sale Team Performance
    @httpGet('/midlevel/sale/team-performance')
    async getSaleTeamPerformance(
        @request() req: Request,
        @response() res: Response
    ) {
        const userId = res.locals.user?.id;
        const month = req.query.month
      ? Number(req.query.month)
      : undefined;

    const year = req.query.year
      ? Number(req.query.year)
      : undefined;
        try {
            const data = await this.dashboardService.getSaleTeamPerformance(userId, month, year);
            return res.status(200).json({
                success: true,
                data,
                message: "Sale team performance data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    //TODO:Get Total Procurement Amt And Qty By Source Wise For Current Month
    @httpGet('/midlevel/procurement/source-wise')
    async getProcurementSourceWise(
        @request() req: Request,
        @response() res: Response
    ) {
        const userId = res.locals.user?.id;
        const month = req.query.month
      ? Number(req.query.month)
      : undefined;

    const year = req.query.year
      ? Number(req.query.year)
      : undefined;
        try {
            const data = await this.dashboardService.getProcurementSourceWise(userId,month,year);
            return res.status(200).json({
                success: true,
                data,
                message: "Procurement source-wise data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    //TODO:Get Procurement Team Memebers Performance Overview in Deashboard
    @httpGet('/midlevel/procurement/team-members-performance')
    async getProcurementTeamMembersPerformance(
        @request() req: Request,
        @response() res: Response
    ) {
        const userId = res.locals.user.id;
        try {
            const monthParam = req.query.month ? Number(req.query.month) : undefined;
            const yearParam  = req.query.year  ? Number(req.query.year)  : undefined;

            if ((monthParam === undefined) !== (yearParam === undefined)) {
                return res.status(400).json({
                    success: false,
                    message: "Please provide both 'month' and 'year' query params, or neither."
                });
            }
            if (monthParam !== undefined && (isNaN(monthParam) || monthParam < 1 || monthParam > 12)) {
                return res.status(400).json({ success: false, message: "'month' must be between 1 and 12." });
            }
            if (yearParam !== undefined && (isNaN(yearParam) || yearParam < 2000)) {
                return res.status(400).json({ success: false, message: "'year' must be a valid 4-digit year." });
            }

            const data = await this.dashboardService.getProcurementTeamMembersPerformance(userId, monthParam, yearParam);
            return res.status(200).json({
                success: true,
                data,
                message: "Procurement team members performance data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
    // @httpGet('/midlevel/procurement/team-members-performance')
    // async getProcurementTeamMembersPerformance(
    //     @request() req: Request,
    //     @response() res: Response
    // ) {
    //     const userId = res.locals.user.id;
    //     const month = req.query.month
    //   ? Number(req.query.month)
    //   : undefined;

    // const year = req.query.year
    //   ? Number(req.query.year)
    //   : undefined;
    //     console.log("User ID in DashboardController:", userId);
    //     try {
    //         const data = await this.dashboardService.getProcurementTeamMembersPerformance(userId, month, year);
    //         return res.status(200).json({
    //             success: true,
    //             data,
    //             message: "Procurement team members performance data retrieved successfully"
    //         });
    //     } catch (error: any) {
    //         return res.status(500).json({
    //             success: false,
    //             message: error.message
    //         });
    //     }
    // }

    //TODO:Get Sale Team Memebers Performance Overview in Deashboard
    @httpGet('/midlevel/sale/team-members-performance')
    async getSaleTeamMembersPerformance(
        @request() req: Request,
        @response() res: Response
    ) {
        const userId = res.locals.user.id;
        try {
            const monthParam = req.query.month ? Number(req.query.month) : undefined;
            const yearParam  = req.query.year  ? Number(req.query.year)  : undefined;

            if ((monthParam === undefined) !== (yearParam === undefined)) {
                return res.status(400).json({
                    success: false,
                    message: "Please provide both 'month' and 'year' query params, or neither."
                });
            }
            if (monthParam !== undefined && (isNaN(monthParam) || monthParam < 1 || monthParam > 12)) {
                return res.status(400).json({ success: false, message: "'month' must be between 1 and 12." });
            }
            if (yearParam !== undefined && (isNaN(yearParam) || yearParam < 2000)) {
                return res.status(400).json({ success: false, message: "'year' must be a valid 4-digit year." });
            }

            const data = await this.dashboardService.getSaleTeamMembersPerformance(userId, monthParam, yearParam);
            return res.status(200).json({
                success: true,
                data,
                message: "Sale team members performance data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
    // @httpGet('/midlevel/sale/team-members-performance')
    // async getSaleTeamMembersPerformance(
    //     @request() req: Request,
    //     @response() res: Response
    // ) {
    //     const userId = res.locals.user.id;
    //     const month = req.query.month
    //   ? Number(req.query.month)
    //   : undefined;

    // const year = req.query.year
    //   ? Number(req.query.year)
    //   : undefined;

    //     console.log("User ID in DashboardController:", userId);
    //     try {
    //         const data = await this.dashboardService.getSaleTeamMembersPerformance(userId, month, year);
    //         return res.status(200).json({
    //             success: true,
    //             data,
    //             message: "Sale team members performance data retrieved successfully"
    //         });
    //     } catch (error: any) {
    //         return res.status(500).json({
    //             success: false,
    //             message: error.message
    //         });
    //     }
    //     }
    //TODO:Get Farmer Registration Overview of Team in Dashboard
      @httpGet("/registration-insight/farmer-registration")
    async getFarmerRegistrationOverviewOfTeam(
        @request() req: Request,
        @response() res: Response
    ) {
       const teamLeaderId = res.locals.user?.id as string;
       const month = req.query.month
      ? Number(req.query.month)
      : undefined;

    const year = req.query.year
      ? Number(req.query.year)
      : undefined;
        try {
            const data = await this.dashboardService.getFarmerRegistrationOverviewOfTeam(teamLeaderId, month, year);
            return res.status(200).json(data);
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    //TODO:Get Vendor Registration Overview of Team in Dashboard
      @httpGet("/registration-insight/vendor-registration")
    async getVendorRegistrationOverviewOfTeam(
        @request() req: Request,
        @response() res: Response
    ) {
       const teamLeaderId = res.locals.user?.id as string;
       const month = req.query.month
      ? Number(req.query.month)
      : undefined;

    const year = req.query.year
      ? Number(req.query.year)
      : undefined;
        try {
            const data = await this.dashboardService.getVendorRegistrationOverviewOfTeam(teamLeaderId, month, year);
            // return res.status(200).json({
            //     success: true,
            //     data,
            //     message: "Vendor registration overview data retrieved successfully"
            // });
            return res.status(200).json(data);
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    //TODO:Get Customer Registration Overview of Team in Dashboard
      @httpGet("/registration-insight/customer-registration")
    async getCustomerRegistrationOverviewOfTeam(
        @request() req: Request,
        @response() res: Response
    ) {
       const teamLeaderId = res.locals.user?.id as string;
       const month = req.query.month
      ? Number(req.query.month)
      : undefined;

    const year = req.query.year
      ? Number(req.query.year)
      : undefined;
        try {
            const data = await this.dashboardService.getCustomerRegistrationOverviewOfTeam(teamLeaderId, month, year);
            // return res.status(200).json({
            //     success: true,
            //     data,
            //     message: "Customer registration overview data retrieved successfully"
            // });
            return res.status(200).json(data);
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

     //TODO:Get Farmer Registration Overview of Each Team Member Of A Team in Dashboard
      @httpGet("/registration-insight/farmer-registration/team-members-performance")
    async getFarmerRegistrationOverviewOfEachTeamMember(
        @request() req: Request,
        @response() res: Response
    ) {
       const teamLeaderId = res.locals.user?.id as string;
       const month = req.query.month
      ? Number(req.query.month)
      : undefined;

    const year = req.query.year
      ? Number(req.query.year)
      : undefined;
        try {
            const data = await this.dashboardService.getFarmerRegistrationOverviewOfEachTeamMember(teamLeaderId, month, year);
            return res.status(200).json({
                success: true,
                data:data.data,
                message: "Farmer registration overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

     //TODO:Get Vendor Registration Overview of Each Team Member Of A Team in Dashboard
      @httpGet("/registration-insight/vendor-registration/team-members-performance")
    async getVendorRegistrationOverviewOfEachTeamMember(
        @request() req: Request,
        @response() res: Response
    ) {
       const teamLeaderId = res.locals.user?.id as string;
       const month = req.query.month
      ? Number(req.query.month)
      : undefined;

    const year = req.query.year
      ? Number(req.query.year)
      : undefined;

        try {
            const data = await this.dashboardService.getVendorRegistrationOverviewOfEachTeamMember(teamLeaderId, month, year);
            return res.status(200).json({
                success: true,
                data:data.data,
                message: "Vendor registration overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

     //TODO:Get Customer Registration Overview of Each Team Member Of A Team in Dashboard
      @httpGet("/registration-insight/customer-registration/team-members-performance")
    async getCustomerRegistrationOverviewOfEachTeamMember(
        @request() req: Request,
        @response() res: Response
    ) {
       const teamLeaderId = res.locals.user?.id as string;
       const month = req.query.month
      ? Number(req.query.month)
      : undefined;

    const year = req.query.year
      ? Number(req.query.year)
      : undefined;
        try {
            const data = await this.dashboardService.getCustomerRegistrationOverviewOfEachTeamMember(teamLeaderId, month, year);
            return res.status(200).json({
                success: true,
                data: data.data,
                message: "Customer registration overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    @httpGet("/employee-count/by-dept")
    public async getEmployeeCountByDept(
        @request() req: Request,
        @response() res: Response,
    ) {
        try {
            const { department } = req.query;
            const userId = res.locals.user?.id;

            const data = await this.dashboardService.getEmployeeCountByDept({ userId, department });
console.log(data);
            return res.status(200).json({
                success: true,
                message: userId
                    ? `Employee team stats for user ${userId}`
                    : "Global employee team stats",
                data,
            });
        } catch (error: any) {
            console.log(error);
            return res.status(500).json({
                success: false,
                message: error.message || "Failed to fetch employee team stats",
            });
        }
    }
//TODO:Get Procurement Overview for all team in Dashboard
    @httpGet('/upper-level/procurement-overview')
    async getProcurementOverview(
        @request() req: Request,
        @response() res: Response
    ) {
        try {
            const data = await this.dashboardService.getProcurementOverview();
            return res.status(200).json({
                success: true,
                data,
                message: "Procurement overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

     //TODO:Get Sale Overview for all team in Dashboard
    @httpGet('/upper-level/sale-overview')
    async getSaleOverview(
        @request() req: Request,
        @response() res: Response
    ) {
        try {
            const data = await this.dashboardService.getSaleOverview();
            return res.status(200).json({
                success: true,
                data,
                message: "Sale overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    //TODO:Get GRN Overview for all team in Dashboard
    @httpGet('/upper-level/grn-overview')
    async getGRNOverview(
        @request() req: Request,
        @response() res: Response
    ) {
        try {
            const data = await this.dashboardService.getGRNOverview();
            return res.status(200).json({
                success: true,
                data,
                message: "GRN overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    //TODO:Get Invoice Overview for all team in Dashboard
    @httpGet('/upper-level/invoice-overview')
    async getInvoiceOverview(
        @request() req: Request,
        @response() res: Response
    ) {
        try {
            const data = await this.dashboardService.getInvoiceOverview();
            return res.status(200).json({
                success: true,
                data,
                message: "Invoice overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    //TODO:Get sale overview by customer type wise in Dashboard
    @httpGet('/upper-level/customer-type-wise/sale-overview')
    async getCustomerTypeWiseSaleOverview(
        @request() req: Request,
        @response() res: Response
    ) {
        try {
            const data = await this.dashboardService.getCustomerTypeWiseSaleOverview();
            return res.status(200).json({
                success: true,
                data,
                message: "Customer type wise sale overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    //TODO:Get sale overview by customer category wise in Dashboard
    @httpGet('/upper-level/customer-category-wise/sale-overview')
    async getCustomerCategoryWiseSaleOverview(
        @request() req: Request,
        @response() res: Response
    ) {
        try {
            const data = await this.dashboardService.getCustomerCategoryWiseSaleOverview();
            return res.status(200).json({
                success: true,
                data,
                message: "Customer Category wise sale overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    //TODO:Get Procurement Overview by vendor category wise in Dashboard
    @httpGet('/upper-level/vendor-category-wise/procurement-overview')
    async getVendorCategoryWiseProcurementOverview(
        @request() req: Request,
        @response() res: Response
    ) {
        try {
            const data = await this.dashboardService.getVendorCategoryWiseProcurementOverview();
            return res.status(200).json({
                success: true,
                data,
                message: "Vendor Category wise procurement overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

        //TODO:Get Procurement Overview by vendor subcategory wise in Dashboard
    @httpGet('/upper-level/vendor-subcategory-wise/procurement-overview')
    async getVendorSubcategoryWiseProcurementOverview(
        @request() req: Request,
        @response() res: Response
    ) {
        try {
            const data = await this.dashboardService.getVendorSubcategoryWiseProcurementOverview();
            return res.status(200).json({
                success: true,
                data,
                message: "Vendor Subcategory wise procurement overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    //TODO:Get Location Wise sale overview in Dashboard (Sale Distribution by location)
    @httpGet('/upper-level/location-wise/sale-distribution')
    async getLocationWiseSaleOverview(
        @request() req: Request,
        @response() res: Response
    ) {
        try {
            const data = await this.dashboardService.getLocationWiseSaleOverview();
            return res.status(200).json({
                success: true,
                data,
                message: "Location wise sale overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

        //TODO:Get Location Wise procurement overview in Dashboard (Procurement Distribution by location)
    @httpGet('/upper-level/location-wise/procurement-distribution')
    async getLocationWiseProcurementOverview(
        @request() req: Request,
        @response() res: Response
    ) {
        try {
            const data = await this.dashboardService.getLocationWiseProcurementOverview();
            return res.status(200).json({
                success: true,
                data,
                message: "Location wise procurement overview data retrieved successfully"
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    //Top 5 customer
    @httpGet("/top5/customer")
    public async getTop5Customer(
        @request() req: Request,
        @response() res: Response,
    ) {
        try {
            const { teamLeaderId } = req.query;

            const data = await this.dashboardService.getTop5Customer({ teamLeaderId });

            return res.status(200).json({
                success: true,
                message: teamLeaderId
                    ? `Top 5 customers for team leader`
                    : "Global top 5 customers",
                data,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message || "Failed to fetch top 5 customers",
            });
        }
    }

    // Top 5 farmers
    @httpGet("/top5/farmer")
    public async getTop5Farmer(
        @request() req: Request,
        @response() res: Response,
    ) {
        try {
            const { teamLeaderId } = req.query;

            const data = await this.dashboardService.getTop5Farmer({ teamLeaderId });

            return res.status(200).json({
                success: true,
                message: teamLeaderId
                    ? `Top 5 farmers for team leader`
                    : "Global top 5 farmers",
                data,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message || "Failed to fetch top 5 farmers",
            });
        }
    }

    // Top 5 vendors
    @httpGet("/top5/vendor")
    public async getTop5Vendor(
        @request() req: Request,
        @response() res: Response,
    ) {
        try {
            const { teamLeaderId } = req.query;

            const data = await this.dashboardService.getTop5Vendor({ teamLeaderId });

            return res.status(200).json({
                success: true,
                message: teamLeaderId
                    ? `Top 5 vendors for team leader`
                    : "Global top 5 vendors",
                data,
            });
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message || "Failed to fetch top 5 vendors",
            });
        }
    }

//TODO:Get week wise Procurement Overview for Employee in Dashboard
 @httpGet("/weekly-procurement-performance")
async getWeeklyProcurementPerformance(
  @request() req: Request,
  @response() res: Response
) {
  try {
    const userId = res.locals.user?.id as string;

    const month = req.query.month
      ? Number(req.query.month)
      : undefined;

    const year = req.query.year
      ? Number(req.query.year)
      : undefined;

    const data =
      await this.dashboardService.getWeeklyProcurementPerformance(
        userId,
        month,
        year
      );

    return res.status(200).json({
      success: true,
      data,
      message:
        "Weekly procurement performance retrieved successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

@httpGet("/weekly-sales-performance")
async getWeeklySalesPerformance(
  @request() req: Request,
  @response() res: Response
) {
  try {
    const userId = res.locals.user?.id as string;

    const month = req.query.month
      ? Number(req.query.month)
      : undefined;

    const year = req.query.year
      ? Number(req.query.year)
      : undefined;

    const data =
      await this.dashboardService.getWeeklySalesPerformance(
        userId,
        month,
        year
      );

    return res.status(200).json({
      success: true,
      data,
      message:
        "Weekly sales performance retrieved successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}
}