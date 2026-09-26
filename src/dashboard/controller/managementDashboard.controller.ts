import { controller, httpGet, next, request, requestParam, response } from "inversify-express-utils";

import { S3Client } from "@aws-sdk/client-s3";
import { inject } from "inversify";

;
import AppError from "../../utils/appError";
import { NextFunction,Response,Request } from "express";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { ManagementDashService } from "../service/managementDashboard.service";

@controller("/api/management", deserializeUser, requireUser)
export class ManagementDashController {
  private s3Client: S3Client;
  private bucketName: string;
  constructor(
    @inject(TYPES.ManagementDashService) private readonly managementDashService:ManagementDashService
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

@httpGet("/getGrns/management")
    public async getProcurementDashboard(
      @request() req: Request,
     
      @response() res:Response,
      @next() next:NextFunction

    ){
try {
  // Convert query parameters properly
  
  const startDate = req.query.startDate ? new Date(req.query.startDate.toString()) : new Date(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }).split(',')[0]);
  const endDate = req.query.endDate ? new Date(req.query.endDate.toString()) : new Date(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }).split(',')[0]);
  const specificDate = req.query.specificDate ? new Date(req.query.specificDate.toString()) : new Date(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }).split(',')[0]);
  
  
  //onsole.log(startDate,endDate,specificDate)
  const filterType = req.query.filterType?.toString();
  const locationId = req.query.locationId?.toString();
  const companyName = req.query.companyName?.toString();

  // const grns = await this.managementDashService.getManagementDashboard(
  //     filterType,
  //     startDate,
  //     endDate,
  //     specificDate,
  //     locationId as string | undefined,
  //     companyName as string | undefined
  //   );
  //   const deliverychallan=await this.managementDashService.getManagementDashboardForDeliveryChallan(filterType,startDate,endDate,specificDate,locationId as string | undefined,companyName as string | undefined)

  //   const dump=await this.managementDashService.getTotalQtyAndAmountForDump(filterType,startDate,endDate,specificDate,locationId as string | undefined,companyName as string | undefined)
  //   const rejection=await this.managementDashService.getTotalQtyAndAmountForReturnByCustomer(filterType,startDate,endDate,specificDate,locationId as string | undefined,companyName as string | undefined)
  
  // if (!grns && !deliverychallan) {
  //   return next(new AppError(404, "GRN and Delivery Challans not found"));
  // }
  res.status(200).json({
    status: "success",
    // data: {
    //   grns,
    //   deliverychallan,
    //   dump,
    //   rejection
    // },
  });
} catch (error) {
    //console.log(error)
  next(error);
}
}


@httpGet("/getGrns/management/vender/:vendorId")
    public async getProcurementDataByVendor(
      @requestParam('vendorId') vendorId: string,
      @request() req: Request,
      @response() res:Response,
      @next() next:NextFunction
    ){
try {
  const procurementVendorData = await this.managementDashService.getProcurementDataByVendor(
      vendorId,
    );

  res.status(200).json({
    status: "success",
    data: procurementVendorData,
  });
} catch (error) {
    //console.log(error)
  next(error);
}
}


//TODO: For Farmer
@httpGet("/getGrns/management/farmer/:farmerId")
    public async getProcurementDataByFarmer(
      @requestParam('farmerId') farmerId: string,
      @request() req: Request,
      @response() res:Response,
      @next() next:NextFunction
    ){
try {
  const procurementFarmerData = await this.managementDashService.getProcurementDataByFarmer(
      farmerId,
    );

  res.status(200).json({
    status: "success",
    data: procurementFarmerData,
  });
} catch (error) {
    //console.log(error)
  next(error);
}
}

//TODO:Get Total Amount And Quantity by Product
@httpGet("/getGrns/management/product/:productId")
    public async getTotalAmountAndQuantityByProduct(
      @requestParam('productId') productId: string,
      @request() req: Request,
      @response() res:Response,
      @next() next:NextFunction
    ){
try {
  const procurementFarmerData = await this.managementDashService.getTotalAmountAndQuantityByProduct(
      productId,
    );

  res.status(200).json({
    status: "success",
    data: procurementFarmerData,
  });
} catch (error) {
    //console.log(error)
  next(error);
}
}

}