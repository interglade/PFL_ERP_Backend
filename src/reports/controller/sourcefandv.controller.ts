import { controller, httpGet, next, request, response } from "inversify-express-utils";

import { inject } from "inversify";

import { NextFunction,Request,Response } from "express";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { VendorService } from "../../vendor/createVendor/service/vendor.service";
import { FarmerService } from "../../farmer/service/farmer.service";
import logger from "../../utils/logger";


@controller('/source',deserializeUser, requireUser)
export class SourceController {

    constructor(
        @inject(TYPES.VendorService)
        private readonly vendorService: VendorService,
        @inject(TYPES.FarmerService)
        private readonly farmerService: FarmerService,
        
      ) {}


      // Get all RFPAs
  @httpGet("/:source")
  public async getAllfandv(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
     const source = req.params.source; 
     let filter
        if(source === 'vendor'){
            logger.info("Fetching all Vendors")
            filter = await this.vendorService.getAllVendorsbyfilter({ page: 1, limit: 1000 });
            // Check if no RFPAs found
        }else if(source === 'farmer'){
            logger.info("Fetching all Farmers")
            filter= await this.farmerService.getAllFarmer({ page: 1, limit: 1000 })
            // Check if no RFPAs
        }
            logger.info("Successfully fetched all Vendors");
            res.status(200).json({
           
            data: filter,
            }); 
      
    } catch (error) {
      logger.error("Error fetching all RFPAs", error);
      next(error); // Pass the error to the global error handler
    }
  }

      
     
}