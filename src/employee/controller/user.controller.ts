import { assertActivationAllowed, assertEmployeeChangeAllowed, assertEmployeeCreateAllowed } from '../employeeAccessGuard';
import { EmployeeStatus, Role } from '../../employee/entity/user.entity';
import { parseStatus, requireStatus } from '../../utils/status.enum';
import { requireRole } from '../../middleware/requireRole';
import { Request, Response, NextFunction } from "express";
import {
  controller,
  httpGet,
  httpPost,
  request,
  response,
  requestParam,
  next,
  httpDelete,
  httpPatch,
  httpPut,
} from "inversify-express-utils";
import { inject } from "inversify";

import {
  CreateUserDto,
  UpdateUserDto,
  UserListResponseDto,
  UserViewResponseDto,
  UserUpdateFormDto,
  UserPartialResponseDto,
  UpdateUserStatusDto,
  BulkDeleteUsersDto,
} from "../dto/user.dto";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { UserService } from "../service/user.service";
import { OfficesService } from "../../office/service/office.service";
import { BranchessService } from "../../branch/service/branches.service";
import { NotificationService } from "../../notification/service/notification.service";
import AppError from "../../utils/appError";
import logger from "../../utils/logger";
import { ControllerLogger } from "../../utils/controllerLogger";
import { PaginationOptions } from "../../utils/pagination";


 @controller("/employee" , deserializeUser, requireUser)
//@controller("/employee")
export class UserController {
  constructor(@inject(TYPES.UserService) private userService: UserService,
  @inject(TYPES.OfficesService) private officeService: OfficesService,
  @inject(TYPES.BranchessService) private branchService: BranchessService,
  @inject(TYPES.NotificationService) private notificationService: NotificationService
) {}
async resolveLocation(id: string): Promise<{
  type: 'BRANCH' | 'OFFICE';
  entity: { id: string };
}> {
  const branch = await this.branchService.getBranchByIdAndType(id);
  if (branch) {
    return { type: 'BRANCH', entity: branch };
  }

  const office = await this.officeService.getOfficeById(id);
  if (office) {
    return { type: 'OFFICE', entity: office };
  }

  throw new AppError(400, 'Invalid Branch/Office ID');
}

  @httpPost("/", requireRole(Role.ADMIN))
  public async createUser(
    @request() req: Request<{}, {}, CreateUserDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      console.log(req.body)
      logger.info("Creating a new Employee");
      const result: CreateUserDto & Record<string, any> = req.body;
      result.createdBy = res.locals.user?.id;
      result.permissions = assertEmployeeCreateAllowed(res.locals.user, result) as any;
      await this.userService.assertContactsUnique(result as any);
     // Handle joining location
if (result.joiningLocation) {
  try {
    const resolved = await this.resolveLocation(result.joiningLocation);
    if (resolved.type === 'BRANCH') {
      result.joiningLocation = resolved.entity.id;
      result.joiningOffice = null;
    } else {
      result.joiningOffice = resolved.entity.id;
      result.joiningLocation = null;
    }
  } catch (err) {
    logger.warn("Invalid joining location ID provided. Setting to null.");
    result.joiningLocation = null;
    result.joiningOffice = null;
  }
}

// Handle current work location
if (result.currentWorkLocation) {
  try {
    const resolved = await this.resolveLocation(result.currentWorkLocation);
    if (resolved.type === 'BRANCH') {
      result.currentWorkLocation = resolved.entity.id;
      result.currentOfficeLocation = null;
    } else {
      result.currentOfficeLocation = resolved.entity.id;
      result.currentWorkLocation = null;
    }
  } catch (err) {
    logger.warn("Invalid current work location ID provided. Setting to null.");
    result.currentWorkLocation = null;
    result.currentOfficeLocation = null;
  }
}


      
      const user = await this.userService.createUser(result);
     // console.log(user);
      if (!user) {
        logger.error("Failed to create Employee");
        ControllerLogger.logError('Employee creation', new AppError(400, "Employee could not be created"), req, res);
        return next(new AppError(400, "Employee could not be created"));
      }
      // logger.info("Employee created successfully", { userId: user.id });
      ControllerLogger.logSuccess('Employee created', user.id, req, res);

      // Send notification for employee creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Employee created successfully`,
          userId
        );
      }

      res.status(201).json({
        status: "success",
        message: "Employee created successfully",
        data: user,
      });
    } catch (err) {
      logger.error("Error in create Employee", { error: err });
      ControllerLogger.logError('Employee creation', err, req, res);
      next(err);
    }
  }

  @httpGet("/", requireRole(Role.ADMIN))
  public async getAllUsers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Getting All Employee");
      const { page, limit, search, sort } = req.query;
    

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
        limit: limit ? Number(limit) : undefined,
        searchFields: ['user.firstName'],
        filters: {},
        sort: sort as string || undefined, // Adjust this line to match your sorting requirements
        search: search as string|| '',
      };
      // ?permissions=notSet: users still waiting for Permission Configuration (after an import)
      const permissions =
        req.query.permissions === 'notSet' || req.query.permissions === 'set' ? req.query.permissions : undefined;
      const users: UserListResponseDto = await this.userService.getAllUsers(queryOptions, res.locals.user?.id, {
        permissions,
      });
      // An empty filtered list is a normal answer (everyone has permissions), not an error
      if (!users || (users.data.length === 0 && !permissions)) {
        logger.error("Employee Not Found");
        ControllerLogger.logError('Employee list retrieval', new AppError(404, "Employee Not Found"), req, res);
        return next(new AppError(404, "Employee Not Found"));
      }
      logger.info("Employee Getting successfully");
      ControllerLogger.logList('Employee', req, res);

      // Send notification for employee list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Employee records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: users.data,
        allRecords: users.meta.total,
        totalPages: users.meta.pages,
        page: users.meta.page,
        
      });
    } catch (err) {
      logger.error("Error To Get Employee", { error: err });
      ControllerLogger.logError('Employee list retrieval', err, req, res);
      next(err);
    }
  }

  @httpGet("/:id", requireRole(Role.ADMIN))
  public async getUserById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const user: UserViewResponseDto = await this.userService.findUserById(id);

      if (!user) {
        ControllerLogger.logError('Employee view', new AppError(404, "User not found"), req, res);
        return next(new AppError(404, "User not found"));
      }

      ControllerLogger.logView('Employee', id, req, res);

      // Send notification for employee view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Employee viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data:user,
        
      });
    } catch (err) {
      ControllerLogger.logError('Employee view', err, req, res);
      next(err);
    }
  }


  @httpGet("/:id/view", requireRole(Role.ADMIN))
  public async getUserByIdForView(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const user: UserViewResponseDto = await this.userService.findUserByIdForView(id);

      if (!user) {
        ControllerLogger.logError('Employee view', new AppError(404, "User not found"), req, res);
        return next(new AppError(404, "User not found"));
      }

      ControllerLogger.logView('Employee (for view)', id, req, res);
      res.status(200).json({
        status: "success",
        data:user,
        
      });
    } catch (err) {
      ControllerLogger.logError('Employee view', err, req, res);
      next(err);
    }
  }

  @httpGet("/:id/update", requireRole(Role.ADMIN))
  public async getUserByIdForUpdate(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const user: UserUpdateFormDto = await this.userService.findUserByIdForUpdate(id);

      if (!user) {
        ControllerLogger.logError('Employee retrieval for update', new AppError(404, "User not found"), req, res);
        return next(new AppError(404, "User not found"));
      }

      ControllerLogger.logView('Employee (for update)', id, req, res);
      res.status(200).json({
        status: "success",
        data:user,
        
      });
    } catch (err) {
      ControllerLogger.logError('Employee retrieval for update', err, req, res);
      next(err);
    }
  }
    @httpPut("/:id", requireRole(Role.ADMIN))
public async updateUser(
  @requestParam("id") id: string,
  @request() req: Request<{}, {}, UpdateUserDto>,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {

    if (Object.keys(req.body).length === 0) {
      ControllerLogger.logError('Employee update', new AppError(400, "User Data is Empty"), req, res);
      return next(new AppError(400, "User Data is Empty"));
    }

    const updateBy = res.locals.user.id;

    if ((req.body as any).status !== undefined) requireStatus(EmployeeStatus, (req.body as any).status, 'status');

    const guardedPermissions = await assertEmployeeChangeAllowed(res.locals.user, [id], {
      roles: (req.body as any).roles,
      status: (req.body as any).status,
      permissions: (req.body as any).permissions,
    });
    if ((req.body as any).permissions !== undefined) (req.body as any).permissions = guardedPermissions;
    await assertActivationAllowed(id, {
      status: (req.body as any).status,
      roles: (req.body as any).roles,
      permissions: (req.body as any).permissions,
    });
    await this.userService.assertContactsUnique(req.body as any, id);

    const joiningLocationId = req.body.joiningLocation;
    const currentLocationId = req.body.currentWorkLocation;

    // Handle joining location
    if (joiningLocationId !== undefined) {
      try {
        const resolved = await this.resolveLocation(joiningLocationId as string);
        if (resolved.type === "BRANCH") {
          req.body.joiningLocation = resolved.entity.id;
          req.body.joiningOffice = null;
        } else {
          req.body.joiningOffice = resolved.entity.id;
          req.body.joiningLocation = null;
        }
      } catch (err) {
        logger.warn("Invalid joining location ID during update. Setting both to null.");
        req.body.joiningLocation = null;
        req.body.joiningOffice = null;
      }
    }

    // Handle current work location
    if (currentLocationId !== undefined) {
      try {
        const resolved = await this.resolveLocation(currentLocationId as string);
        if (resolved.type === "BRANCH") {
          req.body.currentWorkLocation = resolved.entity.id;
          req.body.currentOfficeLocation = null;
        } else {
          req.body.currentOfficeLocation = resolved.entity.id;
          req.body.currentWorkLocation = null;
        }
      } catch (err) {
        logger.warn("Invalid current work location ID during update. Setting both to null.");
        req.body.currentWorkLocation = null;
        req.body.currentOfficeLocation = null;
      }
    }


    const updatedUser = await this.userService.updateUser(id, req.body, updateBy);

    if (!updatedUser) {
      ControllerLogger.logError('Employee update', new AppError(404, "User not found or could not be updated"), req, res);
      return next(new AppError(404, "User not found or could not be updated"));
    }


    ControllerLogger.logSuccess('Employee updated', id, req, res);

    // Send notification for employee update
    const userId = res.locals.user?.id;
    if (userId) {
      await this.notificationService.createNoti(
        `Employee updated successfully`,
        userId
      );
    }

    res.status(200).json({
      status: "success",
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    console.error("Error updating user:", err);
    ControllerLogger.logError('Employee update', err, req, res);
    next(err);
  }
}

  @httpDelete("/:id", requireRole(Role.SUPER_ADMIN))
  public async deleteUser(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      if (!id) {
        logger.warn("User ID not provided");
        ControllerLogger.logError('Employee deletion', new AppError(400, "User ID is required"), req, res);
        return next(new AppError(400, "User ID is required"));
      }
      await assertEmployeeChangeAllowed(res.locals.user, [id], { deleting: true });
      const result = await this.userService.deleteUser(id);

      if (!result) {
        ControllerLogger.logError('Employee deletion', new AppError(404, "User not found or could not be deleted"), req, res);
        return next(
          new AppError(404, "User not found or could not be deleted")
        );
      }

      ControllerLogger.logSuccess('Employee deleted', id, req, res);

      // Send notification for employee deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Employee deleted successfully`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        message: "Employee has been deleted",
      });
    } catch (err) {
      ControllerLogger.logError('Employee deletion', err, req, res);
      next(err);
    }
  }

  /**
   * PATCH /employees/submit/:id
   * Submits the employee draft (sets status to "Inactive" for admin review).
   * Frontend calls this when user clicks "Submit".
   */
  @httpPatch('/submit/:id', requireRole(Role.ADMIN))
  public async submitEmployee(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const body = req.body;

      // Remove any fields that should not be updated on submit
      const employeeData = { ...body };
      const guardedPermissions = await assertEmployeeChangeAllowed(res.locals.user, [id], {
        roles: body.roles,
        status: EmployeeStatus.ACTIVE,
        permissions: body.permissions,
      });
      if (body.permissions !== undefined) employeeData.permissions = guardedPermissions;

      const employee = await this.userService.submitEmployee(id, employeeData);
      ControllerLogger.logSuccess('Employee submitted', id, req, res);
      return res.status(200).json({
        status: 'success',
        message: 'Employee submitted successfully',
        data: { id: employee.id, status: employee.status },
      });
    } catch (err) {
      ControllerLogger.logError('Submit Employee', err, req, res);
      next(err);
    }
  }

@httpPatch("/status/:id", requireRole(Role.ADMIN))
  public async updateEmployeeStatus  (
    @request() req: Request, 
    @response() res: Response,
  @next() next: NextFunction) {
  try {
    const { id } = req.params;
   

     const status = parseStatus([EmployeeStatus.ACTIVE, EmployeeStatus.INACTIVE, EmployeeStatus.SUSPENDED], req.query.status);
     if (!status) {
       ControllerLogger.logError('Employee status update', new Error('Invalid status value'), req, res);
       return res.status(400).json({ message: 'Invalid status value' });
     }
     await assertEmployeeChangeAllowed(res.locals.user, [id], { status });
     await assertActivationAllowed(id, { status });
     const updatedUser = await this.userService.updateStatus(id, status);

    ControllerLogger.logSuccess('Employee status updated', id, req, res);

    // Send notification for employee status update
    const userId = res.locals.user?.id;
    if (userId) {
      await this.notificationService.createNoti(
        `Employee status updated to ${status}: ${id}`,
        userId
      );
    }

    return res.status(200).json({ message: 'Status updated', user: updatedUser });
  } 
  catch (err:any) 
  {
    ControllerLogger.logError('Employee status update', err, req, res);
    next(err);
  }
};
@httpGet("/all/partial")
public async partialAllUser(
  @request() req :Request,
  @response() res:Response,
  @next() next: NextFunction,
){
  try{
     const { page, limit, search, sort, id} = req.query;
    
    // If id is provided, return workflow hierarchy
    if (id) {
      const { department, maxDepth } = req.query;
      const queryOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        searchFields: ['fullName', 'employeeId'],
        filters: {},
        sort: sort as string || undefined,
        search: search as string || '',
        department: department as string || undefined,
        maxDepth: maxDepth !== undefined && maxDepth !== '' ? Number(maxDepth) : undefined,
      };

      const workflowHierarchy = await this.userService.getWorkflowHierarchy(id as string, queryOptions);
      
      if(!workflowHierarchy || workflowHierarchy.data.length === 0){
        logger.error("Workflow hierarchy not found for the given employee");
        ControllerLogger.logError('Workflow hierarchy retrieval', new AppError(404, "Workflow hierarchy not found"), req, res);
        return next(new AppError(404, "Workflow hierarchy not found"));
      }
      
      logger.info("Workflow hierarchy retrieved successfully");
      ControllerLogger.logView('Workflow hierarchy', id as string, req, res);
      
      return res.status(200).json({
        status: "success",
        data: workflowHierarchy.data,
        allRecords: workflowHierarchy.meta.total,
        totalPages: workflowHierarchy.meta.pages,
        page: workflowHierarchy.meta.page,
      });
    }

    // If no id, return all employees (existing behavior)
    const queryOptions: PaginationOptions = {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      searchFields: ['user.firstName'],
      filters: {},
      sort: sort as string || undefined,
      search: search as string|| '',
    };

    // Optional pickers' filters: ?role=approver, ?activeOnly=true, ?ids=a,b (or ids=a&ids=b)
    const role = Object.values(Role).find((r) => r === req.query.role);
    const ids = ([] as string[])
      .concat((req.query.ids as string | string[] | undefined) ?? [])
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim())
      .filter((value) => /^[0-9a-f-]{36}$/i.test(value));

    const users: UserPartialResponseDto = await this.userService.filterUser(queryOptions, {
      role,
      ids: req.query.ids !== undefined ? ids : undefined,
      activeOnly: req.query.activeOnly === 'true',
    });
    // A search that matches nobody is an empty list, not an error
    if(!users){
      logger.error("Employee Not Found");
      ControllerLogger.logError('Employee partial list retrieval', new AppError(404, "Employee Not Found"), req, res);
      return next(new AppError(404, "Employee Not Found"));
    }
    logger.info("Employee Getting successfully");
    ControllerLogger.logList('Employee (partial)', req, res);
    res.status(200).json({
      status: "success",
      data: users.data,
      allRecords: users.meta.total,
      totalPages: users.meta.pages,
      page: users.meta.page,
    })

  }
  catch(err){
    ControllerLogger.logError('Employee partial list retrieval', err, req, res);
    next(err);
  }
}

/** Retired 2026-11-03: Users are imported from the Users list (Template / Check file / Import). */
@httpPost("/user/upload", requireRole(Role.ADMIN))
public async upload(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
    ControllerLogger.logValidationError('Employee upload', 'Retired endpoint', req, res);
    return next(new AppError(410, 'This upload has been replaced. Use Users → Template / Import.'));
  };

   //TODO:Delete Mutilple
  @httpDelete("/delete/multiple", requireRole(Role.SUPER_ADMIN))
public async softDeleteMultipleEmployees(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {

    const { ids }: BulkDeleteUsersDto = req.body;
    const userIds=ids;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      ControllerLogger.logError(
        "Employee bulk deletion",
        new AppError(400, "userIds must be a non-empty array"),
        req,
        res
      );
      return next(new AppError(400, "userIds must be a non-empty array"));
    }

    await assertEmployeeChangeAllowed(res.locals.user, userIds, { deleting: true });
    const result = await this.userService.softDeleteEmployees(userIds);

    ControllerLogger.logSuccess(
      "Employee bulk soft deleted",
      userIds.join(","),
      req,
      res
    );

    // Send notification
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     `Multiple employees soft deleted: ${userIds.length}`,
    //     userId
    //   );
    // }

    return res.status(200).json({
      status: "success",
      message: "Employees soft deleted successfully",
      affected: result.affected,
    });

  } catch (err) {
    ControllerLogger.logError("Employee bulk deletion", err, req, res);
    next(err);
  }
}
}
