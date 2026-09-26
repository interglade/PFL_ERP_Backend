import { controller, httpGet, next ,response,request} from "inversify-express-utils";
import { NextFunction, Request,  Response } from "express";

import { inject } from "inversify";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { UserReportService } from "../service/userreport.service";
import { ControllerLogger } from "../../utils/controllerLogger";


 @controller("/userreport" , deserializeUser, requireUser)
export class UserReportController {
  constructor(@inject(TYPES.UserReportService) private userReportService: UserReportService) {}
  
@httpGet('/user-counts')
  public async getUserCounts(req: Request, res: Response): Promise<Response> {
    try {
        const { createdBy, startDate, endDate } = req.query;

      const filters: any = {};
      if (createdBy) filters.createdBy = createdBy;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
      const data = await this.userReportService.countofregisteredusers(filters);
      ControllerLogger.logList('User counts report', req, res);
      return res.status(200).json({
        //success: true,
        message: 'User counts fetched successfully',
        data,
      });
    } catch (error: any) {
      console.error('Error fetching user counts:', error);
      ControllerLogger.logError('User counts report', error, req, res);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user counts',
        error: error.message,
      });
    }
  }
@httpGet('/total-purchase')
  async getTotalPurchase(req: Request, res: Response, next: NextFunction) {
    try {
      const filters = {
        createdBy: req.query.createdBy as string,
        date: req.query.date as string,
        month: req.query.month ? Number(req.query.month) : undefined,
        year: req.query.year ? Number(req.query.year) : undefined,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        productId: req.query.product as string,
        source: req.query.source as string,
        farmer:req.query.farmer as string,
        vendor:req.query.vendor as string,
        companyId: req.query.company as string,
        fromLocationId: req.query.fromLocation as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 10,
      };

      const result = await this.userReportService.totalPurchase(filters);

      const page = filters.page ?? 1;

      res.status(200).json({
        success: true,
        data: {
          overallTotalQty: result.overallTotalQty,
          overallTotalAmount: result.overallTotalAmount,
          dateWise: result.dateWise,
        },
        allRecords: result.pagination.totalRecords,
        totalPages: result.pagination.totalPages,
        page: Number(page),
      });
    } catch (error) {
      console.error('Error fetching total purchase:', error);
      next(error);
    }
  }

  @httpGet('/total-sale')
  async getTotalSale(req: Request, res: Response, next: NextFunction) {
    try {
      const filters = {
        createdBy: req.query.createdBy as string,
        date: req.query.date as string,
        month: req.query.month ? Number(req.query.month) : undefined,
        year: req.query.year ? Number(req.query.year) : undefined,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        productId: req.query.product as string,
        source: req.query.source as string,
        farmer:req.query.farmer as string,
        vendor:req.query.vendor as string,
        companyId: req.query.company as string,
         page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 10,
      
      };

      const result = await this.userReportService.totalSale(filters);

      const page = filters.page ?? 1;

      res.status(200).json({
        success: true,
        data: {
          overallTotalQty: result.overallTotalQty,
          overallTotalAmount: result.overallTotalAmount,
          dateWise: result.dateWise,
        },
        allRecords: result.pagination.totalRecords,
        totalPages: result.pagination.totalPages,
        page: Number(page),
      });
    } catch (error) {
      console.error('Error fetching total purchase:', error);
      next(error);
    }
  }

  @httpGet("/getCountsbystatus")
public async getCountOfAllDocumentsByStatus(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {

      // Fetch from query params instead of URL params
      let { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      let startDate1: Date | undefined;
      let endDate1: Date | undefined;
      if(startDate && endDate){
         startDate1 = parseDateDDMMYYYY(startDate!);
      startDate1.setHours(0, 0, 0, 0);

      endDate1 = parseDateDDMMYYYY(endDate!);
      endDate1.setHours(23, 59, 59, 999);
      }
     
  try {
    const count = await this.userReportService.getCountOfAllDocumentsByStatus(
      startDate1,
      endDate1
    );

    res.status(200).json({
      status: "success",
      startDate: startDate || null,
      endDate: endDate || null ,
      data: count,
    });
  } catch (error) {
     console.error("Error fetching document status counts:", error);
      return res.status(500).json({
        message: "Error fetching document status counts",
        error: (error as Error).message,
      });
  }
}



}

function parseDateDDMMYYYY(dateStr: string): Date {
  const [day, month, year] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day); // month is 0-indexed

}