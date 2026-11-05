import { guardEmployeeScopeIn, guardPlanRecord } from '../../workFlow/planAccess';
import { Role } from '../../employee/entity/user.entity';
import { DepartmentEnum } from '../../workFlow/entity/workflowClosure.entity';
import { checkPermission } from '../../middleware/checkPermission';
import { Request, Response, NextFunction } from 'express';
import { inject } from 'inversify';
import {
  controller,
  httpPost,
  httpGet,
  httpPatch,
  request,
  response,
  next,
  requestParam,
} from 'inversify-express-utils';import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { TYPES } from '../../types';
import { ProcurementTargetService } from '../service/procurementTarget.service';
import AppError from '../../utils/appError';
import logger from '../../utils/logger';
import { parseStatus, TARGET_DECISIONS } from '../../utils/status.enum';



@controller(
  '/procurement-target',
  deserializeUser,
  requireUser,
)
export class ProcurementTargetController {
  constructor(
    @inject(TYPES.ProcurementTargetService)
    private readonly procurementTargetService: ProcurementTargetService,
  ) {}
  
  //TODO: Create Procurement Target
  @httpPost('/create/monthly-plan', checkPermission('procurement-business-plan', 'create'))
public async createTarget(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction,
) {
  try {
    const loggedInUserId = res.locals.user.id;
    const payload = req.body;

    // resolve employeeId — frontend पाठवेल नाहीतर loggedIn user
    const employeeId = payload.employee ?? loggedInUserId;
    // who may create it and its status come from the reporting tree (planStatusOnSave)

    if (!employeeId) {
      throw new AppError(400, 'EmployeeId is required');
    }

    const target = await this.procurementTargetService.create({
      ...payload,
      employeeId,
      employee: employeeId,
      createdBy: loggedInUserId, // नेहमी logged-in user = creator
    });

    return res.status(201).json({
      status: 'success',
      message: 'Procurement target created successfully',
      data: target,
    });
  } catch (error) {
    logger.error('Error creating procurement target', error);
    next(error);
  }
}



//TODO: Get all procurement targets
@httpGet("/getAll", checkPermission('procurement-business-plan', 'view'))
async getAllTargets(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const employeeId = res.locals.user?.id;
    const pageRaw = req.query.page as string | undefined;
    const limitRaw = req.query.limit as string | undefined;
    const page = pageRaw ? parseInt(pageRaw) : undefined;
    const limit = limitRaw ? parseInt(limitRaw) : undefined;

    const filters = {
      employeeId: req.query.employeeId as string | undefined,
      // Legacy single month/year filters (kept for backward compatibility)
      month: req.query.month ? parseInt(req.query.month as string) : undefined,
      year: req.query.year ? parseInt(req.query.year as string) : undefined,
      // Date range filters
      fromMonth: req.query.fromMonth ? parseInt(req.query.fromMonth as string) : undefined,
      fromYear: req.query.fromYear ? parseInt(req.query.fromYear as string) : undefined,
      toMonth: req.query.toMonth ? parseInt(req.query.toMonth as string) : undefined,
      toYear: req.query.toYear ? parseInt(req.query.toYear as string) : undefined,
    };

    const data = await this.procurementTargetService.getalltargets(employeeId, (res.locals.user?.roles ?? []).includes(Role.ADMIN), page, limit, filters);

    return res.status(200).json({
      status: "success",
      data: data.targets,
       allRecords:  data.totalItems,
        totalPages:   data.totalPages,
        page:  data.currentPage,
    });
  } catch (error) {
    logger.error('Error fetching all procurement targets', error);
    next(error);
  }
}





//TODO: Get Monthly Plan View for Procurement Target
@httpGet('/monthly-plan-view', guardEmployeeScopeIn(DepartmentEnum.PURCHASE), checkPermission('procurement-business-plan', 'view'))
async getMonthlyPlanView(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const { employee, month, year } = req.query;

    if (!employee || !month || !year) {
      return res.status(400).json({
        success: false,
        message: "employee, month and year are required"
      });
    }

    const data = await this.procurementTargetService.getMonthlyPlanView(
      employee as string,
      parseInt(month as string),
      parseInt(year as string)
    );

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error: any) {
    logger.error('Error fetching procurement monthly plan view', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

@httpGet('/monthly-plan-view/:id', guardPlanRecord('procurement'), checkPermission('procurement-business-plan', 'view'))
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

    const data = await this.procurementTargetService.getMonthlyPlanViewStructured(
      targetId as string,
      res.locals.user?.id,
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



/** The employee or their direct manager edits a plan; an edit by the employee goes back to Pending. */
@httpPatch('/update/monthly-plan/:id', guardPlanRecord('procurement'), checkPermission('procurement-business-plan', 'edit'))
async updateMonthlyPlan(
  @requestParam('id') id: string,
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction,
) {
  try {
    const target = await this.procurementTargetService.update(id, req.body, res.locals.user.id);
    return res.status(200).json({
      status: 'success',
      message: target.status === 'Pending'
        ? 'Procurement plan saved and sent to your reporting manager for approval'
        : 'Procurement plan saved',
      data: { id: target.id, status: target.status },
    });
  } catch (error) {
    next(error);
  }
}

@httpGet('/monthly-plan-update/:id', guardPlanRecord('procurement'), checkPermission('procurement-business-plan', 'edit'))
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

    const data = await this.procurementTargetService.getMonthlyPlanUpdateStructured(
      targetId as string,
      res.locals.user?.id,
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


//TODO:Get Plane In Brif excel format
@httpGet('/dashboard-summary/plan-in-brief/download')
public async downloadPlanInBriefExcel(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const { startDate, endDate, employeeId, locationId } = req.query;
    const result = await this.procurementTargetService.generatePlanInBriefExcel({
      startDate: startDate as string,
      endDate: endDate as string,
      employeeId: employeeId as string,
      locationId: locationId as string,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${result.fileName}`
    );

    return res.send({ fileName: result.fileName, filePath: result.filePath });
  } catch (error: any) {
    logger.error('Error generating plan in brief Excel', error);
    next(error);
  }
}

  //TODO: Generate Monthly Business Plan Excel
  @httpGet('/excel/monthly-plan/:id', guardPlanRecord('procurement'), checkPermission('procurement-business-plan', 'export'))
  async generateMonthlyBusinessPlanExcel(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const result = await this.procurementTargetService.generateMonthlyBusinessPlanExcel(id);

      return res.status(200).json({
        status: 'success',
        message: 'Monthly business plan Excel generated successfully',
        data: result
      });
    } catch (error: any) {
      logger.error('Error generating monthly business plan Excel', error);
      next(error);
    }
  }

  //TODO: Get target performance by employee (weekly breakdown)
  @httpGet('/performance/:employeeId/:month/:year', guardEmployeeScopeIn(DepartmentEnum.PURCHASE))
  async getTargetPerformance(
    @requestParam("employeeId") employeeId: string,
    @requestParam("month") month: string,
    @requestParam("year") year: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { productId } = req.query;
      const data = await this.procurementTargetService.getTargetPerformance(
        employeeId,
        Number(month),
        Number(year),
        productId as string | undefined
      );

      return res.status(200).json({
        success: true,
        data
      });
    } catch (error: any) {
      logger.error('Error fetching procurement target performance', error);
      next(error);
    }
  }

  //TODO: Get procurement per product
  @httpGet('/procurement-per-product/:employeeId/:month/:year', guardEmployeeScopeIn(DepartmentEnum.PURCHASE))
  async getProcurementPerProduct(
    @requestParam("employeeId") employeeId: string,
    @requestParam("month") month: string,
    @requestParam("year") year: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const data = await this.procurementTargetService.getProcurementPerProduct(
        employeeId,
        Number(month),
        Number(year)
      );

      return res.status(200).json({
        success: true,
        data
      });
    } catch (error: any) {
      logger.error('Error fetching procurement per product', error);
      next(error);
    }
  }

  //TODO: Approve / Reject Procurement Target
  // PATCH /procurement-target/:id/approve
  // Body: { action: 'approved' | 'rejected', remark?: string }
  @httpPatch('/:id/approve')
  public async approveTarget(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const managerId = res.locals.user.id;
      const { remark } = req.body;
      const action = parseStatus(TARGET_DECISIONS, req.body.action);

      if (!action) {
        throw new AppError(400, "action must be 'Approved' or 'Rejected'");
      }

      const result = await this.procurementTargetService.approveTarget(
        id,
        managerId,
        action,
        remark,
      );

      return res.status(200).json({
        status: 'success',
        message: `Procurement target ${action} successfully`,
        data: { id: result.id, status: result.status },
      });
    } catch (error) {
      logger.error('Error approving procurement target', error);
      next(error);
    }
  }

  //TODO: Get all targets pending approval for logged-in manager
  // GET /procurement-target/manager/pending-approval
  @httpGet('/manager/pending-approval')
  public async getPendingApprovalTargets(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const managerId = res.locals.user.id;

      const data = await this.procurementTargetService.getPendingTargetsForManager(managerId);

      return res.status(200).json({
        status: 'success',
        data,
      });
    } catch (error) {
      logger.error('Error fetching pending approval targets', error);
      next(error);
    }
  }
  async getProcurementSummary(
    @requestParam("employeeId") employeeId: string,
    @requestParam("month") month: string,
    @requestParam("year") year: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const data = await this.procurementTargetService.getProcurementSummary(
        employeeId,
        Number(month),
        Number(year)
      );

      return res.status(200).json({
        success: true,
        data
      });
    } catch (error: any) {
      logger.error('Error fetching procurement summary', error);
      next(error);
    }
  }
}


//  //TODO: Update Procurement Target Status (Approve/Reject) and also can update target quantity  by Manager
// @httpPatch('/get/:id')
// async updateSalesTargetStatus(
//   @requestParam('id') id: string,
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction
// ) {
//   try {
  
//     const result =
//       await this.procurementTargetService.updateStatus(
//         id,
//         req.body,
//       );

//     return res.status(200).json({
//       status: 'success',
//       data: result,
//     });
//   } catch (error) {
//     next(error);
//   }
// }


// //TODO: Debug endpoint to get ALL targets without filtering
// @httpGet("/debug")
// async getAllTargetsDebug(
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction
// ) {
//   try {
//     const data = await this.procurementTargetService.getAllTargetsDebug();

//     return res.status(200).json({
//       status: "success",
//       data,
//     });
//   } catch (error) {
//     logger.error('Error in debug endpoint', error);
//     next(error);
//   }
// }


// @httpGet("/getAllSimple")
// async getAllTargetsSimple(
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction
// ) {
//   try {
//     const employeeId = res.locals.user?.id; 
//     const data = await this.procurementTargetService.getAllTargetsSimple(employeeId);

//     return res.status(200).json({
//       status: "success",
//       data: data.targets,
//     });
//   } catch (error) {
//     logger.error('Error fetching all procurement targets (simple)', error);
//     next(error);
//   }
// }



// //TODO: Get all procurement targets (simple version for debugging)


// //TODO: Update Procurement Target Status (Approve/Reject) and also can update target quantity by Manager
// @httpPatch('/:id')
// async updateTargetStatus(
//   @requestParam('id') id: string,
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction
// ) {
//   try {
//     // const managerId = res.locals.user.id;
//     // const payload = req.body;

//     // TODO: Implement the update logic
//     // const updatedTarget = await this.procurementTargetService.updateTargetStatus(
//     //   id,
//     //   managerId,
//     //   payload
//     // );

//     return res.status(200).json({
//       status: "success",
//       message: "Update functionality not yet implemented"
//       //data: updatedTarget
//     });
//   } catch (error) {
//     logger.error('Error updating procurement target status', error);
//     next(error);
//   }
// }



// //TODO: Get Procurement Target of all employees of logged in manager
// @httpGet("/manager/pending")
// async getPendingTargets(@request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction) {
//   const managerId = res.locals.user.id;

//   const data = await this.procurementTargetService
//     .getTargetsForManagerApproval(
//       managerId,
//       DepartmentEnum.PURCHASE
//     );

//   return res.status(200).json({
//     status: "success",
//     data,
//   });
// }


