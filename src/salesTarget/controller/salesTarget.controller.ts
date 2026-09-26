import { controller, httpGet, httpPatch, httpPost, httpPut, next, request, requestParam, response } from "inversify-express-utils";
import { Request,Response,NextFunction } from "express";

import { inject } from "inversify";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { SalesTargetService } from "../service/salesTarget.service";
import logger from "../../utils/logger";


@controller('/sales-target',deserializeUser,requireUser)
export class SalesTargetController {

    constructor(
        @inject(TYPES.SalesTargetService)
        private salesTargetService: SalesTargetService
    ){
        
    }

@httpPost('/create/monthly-plan')
async createMonthlySalesPlan (@request() req: Request, @response() res: Response,@next() next:NextFunction)  {
  try {
   const loggedInUserId = res.locals.user.id;
    const payload = req.body;

    // resolve employeeId — frontend पाठवेल नाहीतर loggedIn user
    const employeeId = payload.employee ?? loggedInUserId;
   
    const result = await this.salesTargetService.create({
      ...payload,
      employeeId,
      employee: employeeId,
      createdBy: loggedInUserId, // नेहमी logged-in user = creator
    });
    return res.status(201).json({
      success: true,
      message: "Monthly sales plan created successfully",
      data: result
    });
  } catch (error: any) {
    next(error)
  }
};

@httpGet('/monthly-plan-view/:id')
async getMonthlyPlanViewStructured(
  @request() req: Request,
  @response() res: Response
) {
  try {
    const  targetId  = req.params.id;

    if (!targetId) {
      return res.status(400).json({
        success: false,
        message: "targetId is required"
      });
    }

    const data = await this.salesTargetService.getMonthlyPlanViewStructured(
      targetId as string
    );

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}


@httpGet('/monthly-plan-update/:id')
async getMonthlyPlanUpdateStructured(
  @request() req: Request,
  @response() res: Response
) {
  try {
    const  targetId  = req.params.id;

    if (!targetId) {
      return res.status(400).json({
        success: false,
        message: "targetId is required"
      });
    }

    const data = await this.salesTargetService.getMonthlyPlanUpdateStructured(
      targetId as string
    );

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}







//TODO: Get all sales targets
@httpGet("/getAll")
async getAllTargets(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const employeeid = res.locals.user?.id;
    const pageRaw = req.query.page as string | undefined;
    const limitRaw = req.query.limit as string | undefined;
    const page = pageRaw ? parseInt(pageRaw) : undefined;
    const limit = limitRaw ? parseInt(limitRaw) : undefined;

    const filters = {
      employeeId: req.query.employeeId as string | undefined,
      customerId: req.query.customerId as string | undefined,
      // Legacy single month/year filters (kept for backward compatibility)
      month: req.query.month ? parseInt(req.query.month as string) : undefined,
      year: req.query.year ? parseInt(req.query.year as string) : undefined,
      // Date range filters
      fromMonth: req.query.fromMonth ? parseInt(req.query.fromMonth as string) : undefined,
      fromYear: req.query.fromYear ? parseInt(req.query.fromYear as string) : undefined,
      toMonth: req.query.toMonth ? parseInt(req.query.toMonth as string) : undefined,
      toYear: req.query.toYear ? parseInt(req.query.toYear as string) : undefined,
    };

    const data = await this.salesTargetService.getalltargets(employeeid, page, limit, filters);

    return res.status(200).json({
      status: "success",
      data: data.targets,
      allRecords:  data.totalItems,
        totalPages:   data.totalPages,
        page:  data.currentPage,
     
    });
  } catch (error: any) {
    logger.error('Error fetching all sales targets', error);
    next(error);
  }
}





//TODO: Generate Excel for View Plan Only (single sheet)
@httpGet('/view-plan-excel/:id')
async generateViewPlanExcel(
  @request() req: Request,
  @response() res: Response
) {
  try {
    const targetId = req.params.id;

    if (!targetId) {
      return res.status(400).json({
        success: false,
        message: "targetId is required"
      });
    }

    const excelData = await this.salesTargetService.generateViewPlanExcel(targetId);

    // Set headers for file download
    res.setHeader('Content-Type', excelData.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${excelData.filename}"`);
    res.setHeader('Content-Length', Buffer.byteLength(excelData.buffer));

    // Log the file creation
    logger.info(`View Plan Excel file generated and saved: ${excelData.relativePath}`);

    // Send the Excel file
    return res.send(excelData.buffer);

  } catch (error: any) {
    logger.error('Error generating view plan Excel', error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error"
    });
  }
}


//TODO: Serve Excel file by filename (for direct file access)
@httpGet('/files/:folder/:filename')
async serveExcelFile(
  @requestParam("folder") folder: string,
  @requestParam("filename") filename: string,
  @response() res: Response
) {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Validate folder to prevent directory traversal
    const allowedFolders = ['monthly-plans', 'view-plans', 'plan-sheets'];
    if (!allowedFolders.includes(folder)) {
      return res.status(400).json({
        success: false,
        message: "Invalid folder specified"
      });
    }

    // Validate filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        success: false,
        message: "Invalid filename"
      });
    }

    const filePath = path.join(process.cwd(), 'exports', folder, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: "File not found"
      });
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    
    // Set headers for Excel file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (error: any) => {
      logger.error('Error streaming file', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "Error streaming file"
        });
      }
    });

  } catch (error: any) {
    logger.error('Error serving Excel file', error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error"
    });
  }
}



//TODO: Get target performance by customer, product, and employee
@httpGet('/performance/:employeeId/:month/:year')
async getTargetPerformance(
  @requestParam("employeeId") employeeId: string,
  @requestParam("month") month: string,
  @requestParam("year") year: string,
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const { customerId, productId } = req.query;

    const data = await this.salesTargetService.getTargetPerformance(
      employeeId,
      Number(month),
      Number(year),
      customerId as string | undefined,
      productId as string | undefined
    );

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error: any) {
    logger.error('Error fetching target performance', error);
    next(error);
  }
}

//TODO: Get sales per customer
@httpGet('/sales-per-customer/:employeeId/:month/:year')
async getSalesPerCustomer(
  @requestParam("employeeId") employeeId: string,
  @requestParam("month") month: string,
  @requestParam("year") year: string,
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const data = await this.salesTargetService.getSalesPerCustomer(
      employeeId,
      Number(month),
      Number(year)
    );

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error: any) {
    logger.error('Error fetching sales per customer', error);
    next(error);
  }
}


//TODO: Get sales per product
@httpGet('/sales-per-product/:employeeId/:month/:year')
async getSalesPerProduct(
  @requestParam("employeeId") employeeId: string,
  @requestParam("month") month: string,
  @requestParam("year") year: string,
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const data = await this.salesTargetService.getSalesPerProduct(
      employeeId,
      Number(month),
      Number(year)
    );

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error: any) {
    logger.error('Error fetching sales per product', error);
    next(error);
  }
}

  //TODO: Approve / Reject Sales Target
  // PATCH /sales-target/:id/approve
  // Body: { action: 'approved' | 'rejected' }
  @httpPatch('/:id/approve')
  async approveTarget(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const managerId = res.locals.user.id;
      const { action } = req.body;

      if (!action || !['approved', 'rejected'].includes(action)) {
        return res.status(400).json({
          status: 'error',
          message: "action must be 'approved' or 'rejected'",
        });
      }

      const result = await this.salesTargetService.approveTarget(id, managerId, action);

      return res.status(200).json({
        status: 'success',
        message: `Sales target ${action} successfully`,
        data: { id: result.id, status: result.status },
      });
    } catch (error: any) {
      logger.error('Error approving sales target', error);
      next(error);
    }
  }

  //TODO: Get all targets pending approval for logged-in manager
  // GET /sales-target/manager/pending-approval
  @httpGet('/manager/pending-approval')
  async getPendingApprovalTargets(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const managerId = res.locals.user.id;
      const data = await this.salesTargetService.getPendingTargetsForManager(managerId);

      return res.status(200).json({
        status: 'success',
        data,
      });
    } catch (error: any) {
      logger.error('Error fetching pending approval sales targets', error);
      next(error);
    }
  }

  //TODO: Get sales summary statistics
@httpGet('/sales-summary/:employeeId/:month/:year')
async getSalesSummary(
  @requestParam("employeeId") employeeId: string,
  @requestParam("month") month: string,
  @requestParam("year") year: string,
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const data = await this.salesTargetService.getSalesSummary(
      employeeId,
      Number(month),
      Number(year)
    );

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error: any) {
    logger.error('Error fetching sales summary', error);
    next(error);
  }
}
}


// //TODO: Generate Enhanced Monthly Business Plan Excel with Business Intelligence
// @httpGet('/excel/monthly-business-plan/:id')
// async generateMonthlyBusinessPlanExcel(
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction
// ) {
//   try {
//     const targetId = req.params.id;
//     const loggedInUserId = res.locals.user.id;
//     const userName = res.locals.user.firstName + ' ' + res.locals.user.lastName;

//     logger.info(`${userName}: Generating enhanced monthly business plan Excel for target ${targetId}`, {
//       userId: loggedInUserId,
//       targetId,
//       ip: req.ip
//     });

//     const result = await this.salesTargetService.generateMonthlyBusinessPlanExcel(targetId);

//     logger.info(`${userName}: Enhanced monthly business plan Excel generated successfully`, {
//       userId: loggedInUserId,
//       targetId,
//       fileName: result.fileName,
//       ip: req.ip
//     });

//     return res.status(200).json({
//       success: true,
//       message: "Enhanced monthly business plan Excel generated successfully",
//       data: {
//         fileName: result.fileName,
//         filePath: result.filePath,
//         downloadUrl: `/api/sales-target/download/${result.fileName}`
//       }
//     });
//   } catch (error: any) {
//     logger.error(`Error generating enhanced monthly business plan Excel: ${error.message}`, {
//       userId: res.locals.user?.id,
//       targetId: req.params.id,
//       error: error.message,
//       stack: error.stack,
//       ip: req.ip
//     });
//     next(error);
//   }
// }


// //TODO: Get file info for View Plan Excel (single sheet)
// @httpGet('/view-plan-excel-info/:id')
// async getViewPlanExcelInfo(
//   @request() req: Request,
//   @response() res: Response
// ) {
//   try {
//     const targetId = req.params.id;

//     if (!targetId) {
//       return res.status(400).json({
//         success: false,
//         message: "targetId is required"
//       });
//     }

//     const excelData = await this.salesTargetService.generateViewPlanExcel(targetId);

//     // Get the base URL from request headers
//     const protocol = req.get('X-Forwarded-Proto') || req.protocol;
//     const host = req.get('Host');
//     const baseUrl = `${protocol}://${host}`;

//     // Return file information with accessible URLs
//     return res.status(200).json({
//       success: true,
//       data: {
//         filename: excelData.filename,
//         filePath: excelData.relativePath,
//         targetId: targetId,
//         generatedAt: new Date().toISOString(),
//         message: "View Plan Excel file generated and saved successfully",
//         // URLs for frontend access
//         downloadUrl: `${baseUrl}/sales-target/view-plan-excel/${targetId}`,
//         fileUrl: `${baseUrl}/files/${excelData.relativePath}`,
//         // Alternative streaming URL for large files
//         streamUrl: `${baseUrl}/stream/sales-target/view-plan-excel/${targetId}`
//       }
//     });

//   } catch (error: any) {
//     logger.error('Error generating view plan Excel info', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || "Internal server error"
//     });
//   }
// }



// //TODO: Generate Excel for Monthly Plan View (3 sheets)
// @httpGet('/monthly-plan-excel/:id')
// async generateMonthlyPlanExcel(
//   @request() req: Request,
//   @response() res: Response
// ) {
//   try {
//     const targetId = req.params.id;

//     if (!targetId) {
//       return res.status(400).json({
//         success: false,
//         message: "targetId is required"
//       });
//     }

//     const excelData = await this.salesTargetService.generateMonthlyPlanExcel(targetId);

//     // Set headers for file download
//     res.setHeader('Content-Type', excelData.contentType);
//     res.setHeader('Content-Disposition', `attachment; filename="${excelData.filename}"`);
//     res.setHeader('Content-Length', Buffer.byteLength(excelData.buffer));

//     // Log the file creation
//     logger.info(`Excel file generated and saved: ${excelData.relativePath}`);

//     // Send the Excel file
//     return res.send(excelData.buffer);

//   } catch (error: any) {
//     logger.error('Error generating monthly plan Excel', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || "Internal server error"
//     });
//   }
// }


// //TODO: Get file info for Monthly Plan Excel (3 sheets)
// @httpGet('/monthly-plan-excel-info/get/:id')
// async getMonthlyPlanExcelInfo(
//   @request() req: Request,
//   @response() res: Response
// ) {
//   try {
//     const targetId = req.params.id;

//     if (!targetId) {
//       return res.status(400).json({
//         success: false,
//         message: "targetId is required"
//       });
//     }

//     const excelData = await this.salesTargetService.generateMonthlyPlanExcel(targetId);

//     // Get the base URL from request headers
//     const protocol = req.get('X-Forwarded-Proto') || req.protocol;
//     const host = req.get('Host');
//     const baseUrl = `${protocol}://${host}`;

//     // Return file information with accessible URLs
//     return res.status(200).json({
//       success: true,
//       data: {
//         filename: excelData.filename,
//         filePath: excelData.relativePath,
//         targetId: targetId,
//         generatedAt: new Date().toISOString(),
//         message: "Excel file generated and saved successfully",
//         // URLs for frontend access
//         downloadUrl: `${baseUrl}/sales-target/monthly-plan-excel/${targetId}`,
//         fileUrl: `${baseUrl}/files/${excelData.relativePath}`,
//         // Alternative streaming URL for large files
//         streamUrl: `${baseUrl}/stream/sales-target/monthly-plan-excel/${targetId}`
//       }
//     });

//   } catch (error: any) {
//     logger.error('Error generating monthly plan Excel info', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || "Internal server error"
//     });
//   }
// }


// @httpPatch('/:id/status')
// async updateSalesTargetStatus(
//   @request() req: Request,
//   @response() res: Response
// ) {
//   try {
//     const targetId = req.params.id;
//     const { status } = req.body;
//     const managerId = res.locals.user.id;

//     const result = await this.salesTargetService.updateStatus(
//       targetId,
//       status,
//       managerId
//     );

//     return res.status(200).json({
//       success: true,
//       message: result.message
//     });
//   } catch (error: any) {
//     return res.status(400).json({
//       success: false,
//       message: error.message
//     });
//   }
// }


// @httpPut("/:id/review")
// async reviewSalesTarget(
//   @requestParam("id") targetId: string,
//   @request() req: Request,
//   @response() res: Response
// ) {
//   try {
//     const data = await this.salesTargetService.reviewTarget(
//       targetId,
//       req.body,
//       res.locals.user.id
//     );
    
//     return res.status(200).json({
//       status: "success",
//       data,
//     });
//   } catch (error: any) {
//     logger.error('Error reviewing sales target', error);
//     return res.status(500).json({
//       status: "error",
//       message: "Internal server error"
//     });
//   }
// }


// @httpGet("/:employeeId/customer-product-sales")
// async getCustomerWiseProductSales(
//   @requestParam("employeeId") employeeId: string,
//   @request() req: Request,
//   @response() res: Response
// ) {
//   try {
//     const { month, year } = req.query;
//     const data = await this.salesTargetService.getCustomerWiseProductSales(
//       employeeId,
//       Number(month),
//       Number(year)
//     );
    
//     return res.status(200).json({
//       status: "success",
//       data,
//     });
//   } catch (error: any) {
//     logger.error('Error fetching customer-wise product sales', error);
//     return res.status(500).json({
//       status: "error",
//       message: "Internal server error"
//     });
//   }
// }

