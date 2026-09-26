import { controller, httpGet, next, queryParam, request, requestParam, response } from "inversify-express-utils";
import { inject } from "inversify"
import { NextFunction,Request,Response } from "express";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { InventoryStockService } from "../service/inventoryStock.service";
import { NotificationService } from "../../notification/service/notification.service";






@controller("/inventoryStock", deserializeUser, requireUser)
export class InventoryStockController {

    constructor(
        @inject(TYPES.InventoryStockService)
        private readonly inventoryStockService: InventoryStockService,
        @inject(TYPES.NotificationService)
        private notificationService: NotificationService,
      ) {}


    

  














     @httpGet("/stock/filter/report")
  public async getStockReport(
    @queryParam("companyName") companyName: string,
    @queryParam("locationId") locationId: string,
    @queryParam("startDate") startDate: string,
    @queryParam("endDate") endDate: string,
      @response() res: Response
  ) {
    try {
      const report = await this.inventoryStockService.getStockReport(
        companyName,
        locationId,
        startDate,
        endDate
      );
      return res.json({
        success: true,
        data: report,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch stock report",
      });
    }
  }

  @httpGet("/endoftheday/eod-report")
  public async getEndOfDayReport(
    @queryParam("companyId") companyId: string,
    @queryParam("locationId") locationId: string,
    @queryParam("startDate") startDate: string,
    @queryParam("endDate") endDate: string,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      

      const report = await this.inventoryStockService.getEndOfDayReport(
        companyId,
        locationId,
        startDate,
        endDate
      );

     
      return res.status(200).json({
        status: "success",
        data: report,
      });
    } catch (error: any) {
      
      next(error);
    }
  }

  @httpGet('/stock/locationwise-companywise')
  public async getlocationcompanywisestock(
    @request() req : Request,
    @response() res: Response,
    @next() next: NextFunction
  ){
    try{
      const {company, location, page, limit, search, sort} = req.query;

      const queryOptions = {
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 10,
       
      };

      const result = await this.inventoryStockService.getlocationcompanywisestock(
        queryOptions,
        company as string,
        location as string,
        search as string
      );

     
      return res.status(200).json({
        status: 'success',
        data: result.data,
        // meta: result.meta,
         allRecords: result.meta.total,
        totalPages: result.meta.pages,
        page: result.meta.page,
      });

    }catch(error){
     
      next(error);
    }
  }
  @httpGet('/stock/locationwise-companywise-productwise')
  public async getlocationcompanyproductwisestock(
    @request() req : Request,
    @response() res: Response,
    @next() next: NextFunction
  ){
    try{
      const {company, location, product, page, limit, search, sort} = req.query;

      const queryOptions = {
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        search: search as string,
        sort: sort as string,
      };

      const result = await this.inventoryStockService.getlocationcompanyproductwisestock(
        queryOptions,
        company as string,
        location as string,
        product as string
      );

     
      return res.status(200).json({
        status: 'success',
        data: result.data,
       // meta: result.meta,
       allRecords: result.meta.total,
        totalPages: result.meta.pages,
        page: result.meta.page,
      });

    }catch(error){
      
      next(error);
    }
  }

    }


        // @httpGet("/stock/varient-wise")
    // public async gettingStockVarientWise(
    //   @request() req: Request,
    //   @response() res: Response,
    //   @next() next: NextFunction
    // ) {
    //   try {
    //     const {  locationName, companyName, productName } = req.query;
      
       
    //     const stock = await this.inventoryStockService.getVariantGroupedInventoryStock( 
    //       locationName ? String(locationName) : undefined,
    //       companyName ? String(companyName) : undefined,
    //       productName ? String(productName) : undefined
    //     )
     
    //     if (!stock) {
    //       return next(new AppError(404, "Inventory Stock not found with given filters"));
    //     }
    
       
    //     return res.status(200).json({
    //       status: "success",
    //       data: stock,
    //     });
    
    //   } catch (error) {
       
    //     next(error);
    //   }
    // }


        //     @httpGet("/stock/product-wise")
    // public async gettingStockProductWise(
    //   @request() req: Request,
    //   @response() res: Response,
    //   @next() next: NextFunction
    // ) {
    //   try {
    //     const {  locationName, companyName} = req.query;
      
       
    //     const stock = await this.inventoryStockService.getProductGroupedInventoryStock( 
    //       locationName ? String(locationName) : undefined,
    //       companyName ? String(companyName) : undefined
    //     )
     
    //     if (!stock) {
    //       return next(new AppError(404, "Inventory Stock not found with given filters"));
    //     }
    
        
    //     return res.status(200).json({
    //       status: "success",
    //       data: stock,
    //     });
    
    //   } catch (error) {
        
    //     next(error);
    //   }
    // }



    // @httpGet("/stock/accesslocation")
// public async gettingStocksaccessLocation(
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction
// ) {
//   try {
//     const location = req.query.location as string | undefined;
//     const id = res.locals.user?.id;

   

//     const stock = await this.inventoryStockService.getProductByAccessLocation(location, id);

//     if (!stock.length) {
//       return next(new AppError(404, "Inventory Stock not found with given filters"));
//     }

    
//     return res.status(200).json({
//       status: "success",
//       data: stock,
//     });
//   } catch (error) {
   
//     next(error);
//   }
// }


        // @httpGet("/stock/accesslocation-wise")
    // public async gettingStockaccessLocation(
    //   @response() res: Response,
    //   @next() next: NextFunction
    // ) {
    //   try {
      
    //    const id = res.locals.user?.id
       
    //     const stock = await this.inventoryStockService.getInventoryStockbyuserAccesslocation(id)
     
    //     if (!stock) {
    //       return next(new AppError(404, "Inventory Stock not found with given filters"));
    //     }
       
    //     return res.status(200).json({
    //       status: "success",
    //       data: stock,
    //     });
    
    //   } catch (error) {
        
    //     next(error);
    //   }
    // }


        // @httpGet("/stock/location-wise")
    // public async gettingStockForCompanyOrLocation(
    //   @response() res: Response,
    //   @next() next: NextFunction
    // ) {
    //   try {
     
       
    //     const stock = await this.inventoryStockService.getGroupedInventoryStock()
     
    //     if (!stock) {
    //       return next(new AppError(404, "Inventory Stock not found with given filters"));
    //     }
    
        
    //     return res.status(200).json({
    //       status: "success",
    //       data: stock,
    //     });
    
    //   } catch (error) {
       
    //     next(error);
    //   }
    // }


        // @httpGet("/filter/all/stock")
    // public async filterStock(
    //   @request() req: Request,
    //   @response() res: Response,
    //   @next() next: NextFunction
    // ) {
    //   try {
       
   
       
     
    //     const stock = await this.inventoryStockService.filterStock(
    //       req.query

    //       )
     
    //     if (!stock) {
    //       return next(new AppError(404, "Inventory Stock not found with given filters"));
    //     }
    
    //     ControllerLogger.logList('Inventory Stock (Filter)', req, res);
      
    //     return res.status(200).json({
    //       status: "success",
    //       data: stock,
    //     });
    
    //   } catch (error) {
    //     ControllerLogger.logError('Inventory Stock filter', error, req, res);
    //     next(error);
    //   }
    // }


        // @httpGet("/search")
    // public async searchStock(
    //   @request() req: Request,
    //   @response() res: Response,
    //   @next() next: NextFunction
    // ) {
    //   try {
    //     const { id, varientId, productId, locationId, companyId } = req.query;
    
    //     if (!id) {
    //       return next(new AppError(400, "Inventory Stock ID is required"));
    //     }
    
       
    
    //     const stock = await this.inventoryStockService.searchStock(
    //       id ? String(id) : undefined,
    //       varientId ? String(varientId) : undefined,
    //       productId ? String(productId) : undefined,
    //       locationId ? String(locationId) : undefined,
    //       companyId ? String(companyId) : undefined
    //     );
     
    //     if (!stock) {
    //       return next(new AppError(404, "Inventory Stock not found with given filters"));
    //     }
    
    //     ControllerLogger.logList('Inventory Stock (Search)', req, res);
        
    //     // Send notification for inventory stock search
    //     // const userId = res.locals.user?.id;
    //     // if (userId) {
    //     //   await this.notificationService.createNoti(
    //     //     'Inventory stock search performed successfully',
    //     //     userId
    //     //   );
    //     // }
       
    //     return res.status(200).json({
    //       status: "success",
    //       data: stock,
    //     });
    
    //   } catch (error) {
    //     ControllerLogger.logError('Inventory Stock search', error, req, res);
    //     next(error);
    //   }
    // }


          // @httpGet("/:id")
      // public async getInventoryStockById(
      //   @requestParam("id") id: string,
      //   @request() req: Request,
      //   @response() res: Response,
      //   @next() next: NextFunction
      // ) {
      //   try {
         
      //     const stock = await this.inventoryStockService.getInventoryStockById(id);
    
      //     if (!stock) {
      //       return next(new AppError(404, "Inventory Stock not found"));
      //     }
    
      //     ControllerLogger.logView('Inventory Stock', id, req, res);
          
      //     // Send notification for inventory stock view
      //     const userId = res.locals.user?.id;
      //     // if (userId) {
      //     //   await this.notificationService.createNoti(
      //     //     `Inventory stock item viewed: ${id}`,
      //     //     userId
      //     //   );
      //     // }
         
      //     res.status(200).json({
      //       status: "success",
      //       data: stock,
      //     });
      //   } catch (error) {
      //     ControllerLogger.logError('Inventory Stock view', error, req, res);
      //     next(error);
      //   }
      // }



      // @httpGet("/")
      // public async getAllInventoryStocks(
      //   @request() req: Request,
      //   @response() res: Response,
      //   @next() next: NextFunction
      // ) {
      //   try {
         
    
      //     const { page, limit, search, sort } = req.query;
    
      //     const queryOptions: PaginationOptions = {
      //       page: page ? Number(page) : undefined,
      //       limit: limit ? Number(limit) : undefined,
      //       //searchFields: ["product.name", "location.name", "varients.name"],
      //       filters: {},
      //       sort: sort as string || undefined,
      //       search: search as string || "",
      //     };
    
      //     const stocks = await this.inventoryStockService.getAllInventoryStocks(queryOptions);
    
      //     if (!stocks) {
            
      //       return next(new AppError(404, "No Inventory Stock found"));
      //     }
    
      //     ControllerLogger.logList('Inventory Stock', req, res);
          
      //     // Send notification for inventory stock access
      //     // const userId = res.locals.user?.id;
      //     // if (userId) {
      //     //   await this.notificationService.createNoti(
      //     //     'Inventory stock list accessed successfully',
      //     //     userId
      //     //   );
      //     // }
         
      //     res.status(200).json({
      //       status: "success",
      //       data: stocks.data,
      //       allRecords: stocks.meta.total,
      //       totalPages: stocks.meta.pages,
      //       page: stocks.meta.page,
      //     });
      //   } catch (error) {
      //     ControllerLogger.logError('Inventory Stock list retrieval', error, req, res);
      //     next(error);
      //   }
      // }

