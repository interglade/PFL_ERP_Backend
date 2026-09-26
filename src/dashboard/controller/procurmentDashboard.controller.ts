import {
  controller,
  httpGet,
  next,
  request,
  requestParam,
  response,
} from "inversify-express-utils";
import ExcelJS from "exceljs";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { NextFunction, Response, Request } from "express";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { ProcurmentDashService } from "../service/procurmentDashbord.service";
import { inject } from "inversify";
import { TYPES } from "../../types";
import AppError from "../../utils/appError";
import logger from "../../utils/logger";


@controller("/api/procurment", deserializeUser, requireUser)
export class ProcurmentDashController {
  private s3Client: S3Client;
  private bucketName: string;
  constructor(
    @inject(TYPES.ProcurmentDashService)
    private readonly procurmentDashService: ProcurmentDashService
  ) {
    this.s3Client = new S3Client({
      credentials: {
        accessKeyId: process.env.ACCESS_KEY!,
        secretAccessKey: process.env.ACCESS_SECRET!,
      },
      region: process.env.REGION!,
    });
    this.bucketName = process.env.BUCKET_NAME!;
  }
  @httpGet("/getGrns/procurment")
  public async getProcurementDashboard(
    @request() req: Request,

    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      // Convert query parameters properly

      const startDate = req.query.startDate
        ? new Date(req.query.startDate as string)
        : undefined;
      const endDate = req.query.endDate
        ? new Date(req.query.endDate as string)
        : undefined;
      const specificDate = req.query.specificDate
        ? new Date(req.query.specificDate as string)
        : undefined;

      const filterType = req.query.filterType?.toString();
      const locationId = req.query.locationId?.toString();
      const companyName = req.query.companyName?.toString();
      const grns = await this.procurmentDashService.getProcurementDashboard(
        filterType,
        startDate,
        endDate,
        specificDate,
        locationId as string | undefined,
        companyName as string | undefined
      );
      //console.log(grns);
      if (!grns) {
        return next(new AppError(404, "GRN not found"));
      }
      res.status(200).json({
        status: "success",
        data: grns,
      });
    } catch (error) {
      next(error);
    }
  }

  @httpGet("/getGrn/startdate/:startdate/enddate/:enddate")
  public async getGrnByDateRange(
    @requestParam("startdate") startdate: string,
    @requestParam("enddate") enddate: string,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const startObj = new Date(startdate);
      const endObj = new Date(enddate);
      const grn = await this.procurmentDashService.getTotalQtyAndAmount(
        startObj,
        endObj
      );
      //  const grn = await this.grnService.getTotalQtyAndAmount(startObj,endObj)
      if (!grn) {
        return next(new AppError(404, "GRN not found"));
      }
      res.status(200).json({
        status: "success",
        data: grn,
      });
    } catch (error) {
      next(error);
    }
  }

  @httpGet("/getGrns/companyName/:companyName")
  public async getGrnByCompanyName(
    @request() req: Request,
    @requestParam("companyName")
    @response()
    res: Response,
    @next() next: NextFunction
  ) {
    try {
      const companyName = req.params.id;
      // console.log(vednorId);
      const grns = await this.procurmentDashService.getGrnByCompanyName(
        companyName
      );
      if (!grns) {
        return next(new AppError(404, "GRN not found"));
      }
      res.status(200).json({
        status: "success",
        data: grns,
      });
    } catch (error) {
      next(error);
    }
  }
  @httpGet("/calculation/tilldate")
  public async getGrnTillDate(
    @request() req: Request,

    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { filterType, filterValue } = req.query; // Get filter type and value from query params
      const grns = await this.procurmentDashService.getDataForTillDate(
        filterType as string,
        filterValue as string
      );

      if (!grns) {
      }
      const overallTotal = grns.reduce(
        (acc, row) => {
          acc.quantity += Number(row.quantity);
          acc.amount += Number(row.amount);
          return acc;
        },
        { quantity: 0, amount: 0 }
      );
      res.status(200).json({
        message: "GRN calculations fetched successfully.",
        data: {
          totalQuantityInKg: overallTotal.quantity,
          totalAmount: overallTotal.amount,
          dateWise: grns,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  @httpGet("/calculations/dates")
  public async getDataForDates(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { filterType, startDate, endDate } = req.query;
      const data = await this.procurmentDashService.getDataForDates(
        filterType as string | undefined,
        startDate as string | undefined,
        endDate as string | undefined
      );

      const overallTotal = data.reduce(
        (acc, row) => {
          acc.quantity += Number(row.quantity);
          acc.amount += Number(row.amount);
          return acc;
        },
        { quantity: 0, amount: 0 }
      );
      res.status(200).json({
        message: "GRN calculations fetched successfully.",
        data: overallTotal,
      });
    } catch (error) {
      console.error("Error fetching data:", error);
      next(error);
    }
  }

  @httpGet("/all/getreports")
  public async getDrillDownGRNReport(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Fetching Drill-Down GRN Report...");
      // Extract filters from query params
      const filters: any = {
        source: req.query.source as string | undefined,
        grnNo: req.query.grnNo as string | undefined,
        purchaseInstructionsBy: req.query.purchaseInstructionsBy as
          | string
          | undefined,
        companyName: req.query.companyName as string | undefined,
        locationType: req.query.locationType as string | undefined,
        dealSlipId: req.query.dealSlipId as string | undefined,
        grnType: req.query.grnType as string | undefined,
        purchaseType: req.query.purchaseType as string | undefined,
        purchaseLocation: req.query.purchaseLocation as string | undefined,
        vendorId: req.query.vendorId as string | undefined,
        farmerId: req.query.farmerId as string | undefined,
        vendorcategoryId: req.query.categoryId as string | undefined,
        vendorsubcategoryId: req.query.subcategoryId as string | undefined,
        productId: req.query.productId as string | undefined,
        productCategoryId: req.query.productCategoryId as string | undefined,
        productSubCategoryId: req.query.productSubCategoryId as
          | string
          | undefined,
        approvalStatus: req.query.approvalStatus as string | undefined,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
      };
      //console.log(filters)
      // // Validate required filters if necessary
      // if (!filters.dateFrom || !filters.dateTo) {
      //   logger.error("Missing date range filters.");
      //   return next(new AppError(400, "dateFrom and dateTo are required."));
      // }

      // Fetch GRN report based on filters
      const grnRecords = await this.procurmentDashService.getFilteredGRNs(
        filters
      );
      if (grnRecords.length === 0) {
        return next(new AppError(404, "GRN not found"));
      }
      // Define columns dynamically from GRN entity
      const worksheetColumns = [
        { header: "GRN No", key: "grnNo", width: 15 },
        { header: "Company Name", key: "companyName", width: 20 },
        {
          header: "Purchase Instructions By",
          key: "purchaseInstructionsBy",
          width: 25,
        },

        { header: "Location Type", key: "locationType", width: 15 },
        { header: "GRN Type", key: "grnType", width: 15 },
        { header: "Purchase Type", key: "purchaseType", width: 20 },

        { header: "Security Person", key: "securityPerson", width: 20 },
        { header: "Special Req", key: "specialReq", width: 25 },
        { header: "Purchase Location", key: "purchaseLocation", width: 20 },
        {
          header: "Purchase For Sales Location",
          key: "purchaseForSalesLocation",
          width: 20,
        },
        { header: "source", key: "source", width: 20 },
        {
          header: "Party Name (Vendor/Farmer)",
          key: "selectedParty",
          width: 20,
        },
        { header: "Bill No", key: "billNo", width: 15 },
        { header: "Subtotal Amount", key: "subTotalAmt", width: 15 },
        { header: "Freight", key: "freight", width: 15 },
        { header: "Other Charges", key: "otherCharges", width: 15 },
        { header: "Total Amount", key: "totalAmt", width: 15 },
        { header: "Amount In Words", key: "amtWords", width: 30 },
        { header: "Purchased By", key: "purchasedBy", width: 20 },
        { header: "Approval Status", key: "approvalStatus", width: 20 },
        { header: "Approval Note", key: "approvalNote", width: 20 },
        { header: "Received Through", key: "receivedThrough", width: 20 },
        { header: "Vehicle No", key: "vehicleNo", width: 15 },
        { header: "Time In", key: "timeIn", width: 15 },
        { header: "Crates In", key: "cratesIn", width: 15 },
        {
          header: "Delivery Receiving Person",
          key: "deliveryReceivingPerson",
          width: 20,
        },
        { header: "RMN", key: "rmn", width: 15 },
      ];

      // Create workbook and worksheet
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("GRN Report");

      // Add column headers
      worksheet.columns = worksheetColumns;

      // Apply bold styling to headers
      worksheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "0073e6" },
        };
      });

      // Add data rows dynamically
      grnRecords.forEach((grn) => {
        worksheet.addRow({
          grnNo: grn.grnNo.toUpperCase(),
          companyName: grn.companyName, // Extracting from relation
          purchaseInstructionsBy: grn.purchaseInstructionsBy,

          locationType: grn.locationType,
          grnType: grn.grnType,
          purchaseType: grn.purchaseType,

          securityPerson: grn.securityPerson,
          specialReq: grn.specialReq,
          purchaseLocation: grn.purchaseLocation || "",
          purchaseForSalesLocation: grn.purchaseForSalesLocation || "",
          source: grn.source || "",
          partyName: grn.selectedVendor
            ? grn.selectedVendor.name
            : grn.selectedFarmer
            ? grn.selectedFarmer.name
            : "",
          billNo: grn.billNo.toUpperCase(),
          subTotalAmt: grn.subTotalAmt,
          freight: grn.freight,
          otherCharges: grn.otherCharges,
          totalAmt: grn.totalAmt,
          amtWords: grn.amtWords,
          purchasedBy: grn.purchasedBy,
          approvalStatus: grn.approvalStatus,
          approvalNote: grn.approvalNote,
          receivedThrough: grn.receivedThrough,
          vehicleNo: grn.vehicleNo.toUpperCase(),
          timeIn: grn.timeIn,
          cratesIn: grn.cratesIn,
          deliveryReceivingPerson: grn.deliveryReceivingPerson,
          rmn: grn.rmn,
          grnProduct: grn.grnProducts,
        });
      });

      // Generate Excel file in memory
      const buffer = await workbook.xlsx.writeBuffer();

      // Upload to S3
      const fileKey = `reports/GRN_Report_${Date.now()}.xlsx`;
      const uploadParams = {
        Bucket: this.bucketName,
        Key: fileKey,
        Body: new Uint8Array(buffer),
        ContentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };

      await this.s3Client.send(new PutObjectCommand(uploadParams));

      // Generate file URL
      const fileUrl = `https://${this.bucketName}.s3.${process.env.REGION}.amazonaws.com/${fileKey}`;

      return res.status(200).json({
        success: true,
        data: grnRecords, // JSON response
        excelFileUrl: fileUrl, // S3 file URL
      });
    } catch (error) {
      console.error("Error generating GRN report:", error);
      return res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  }
  @httpGet("/get/dashboard/calculation")
  async getDashboardMetrics(req: Request, res: Response): Promise<Response> {
    try {
      const { startDate, endDate } = req.query;
      const metrics = await this.procurmentDashService.getDashboardMetrics(
        startDate ? new Date(startDate as string) : new Date(0),
        endDate ? new Date(endDate as string) : new Date()
      );
      return res.status(200).json(metrics);
    } catch (error) {
      console.error("Error fetching dashboard metrics:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  }

  @httpGet("/getdata/for/sourcefarmer")
  async getFarmerAnalytics(req: Request, res: Response): Promise<Response> {
    try {
      const { startDate, endDate } = req.query;

      const filters = {
        startDate: startDate
          ? new Date(startDate as string).toISOString()
          : undefined,
        endDate: endDate
          ? new Date(endDate as string).toISOString()
          : undefined,
      };

      const analytics = await this.procurmentDashService.getFarmerAnalytics(
        filters
      );
      return res.status(200).json(analytics);
    } catch (error) {
      console.error("Error fetching farmer analytics:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  }
}
