import { Request, Response, NextFunction } from "express";
import {
  controller,
  httpGet,
  httpPost,
  httpPatch,
  httpDelete,
  request,
  response,
  requestParam,
  next,
} from "inversify-express-utils";
import { inject } from "inversify";
import { captureUser, deserializeUser, requireUser } from "../../../middleware/deserializeUser";
import { TYPES } from "../../../types";
import { CustomerTypeService } from "../service/customerType.service";
import { NotificationService } from "../../../notification/service/notification.service";
import { UserActivityLogService } from "../../../employeeActivity/service/userActivityLog.service";
import { PaginationOptions } from "../../../utils/pagination";
import { ControllerLogger } from "../../../utils/controllerLogger";
import AppError from "../../../utils/appError";
import { CreateCustomerTypeDto } from "../../addcustomer/dto/createCustomer.dto";
import { ActivityAction, ActivityModule } from "../../../employeeActivity/entity/userActivityLog.entity";



@controller("/customerType",deserializeUser,requireUser)
export class CustomerTypeController {
  constructor(
    @inject(TYPES.CustomerTypeService)
    private customerTypeService: CustomerTypeService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService)
    private activityLogService: UserActivityLogService,
  ) {}

  @httpGet("/")
  public async getAllCustomerTypes(
    @request() req:Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { page, limit, search, sort } = req.query;
      
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
        limit: limit ? Number(limit) : undefined,
        filters: {},
        sort: sort as string || undefined,
        search: search as string|| '',
      };
      
      const customerTypes =
        await this.customerTypeService.getAllCustomerTypes(queryOptions);
      if (!customerTypes.data.length) {
        ControllerLogger.logOperationFailed('Get All', 'Customer Types', 'No records found', req, res);
        return next(new AppError(204, "No customer types found"));
      }
     
      // 🔔 Send notification for get all customer types
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Retrieved ${customerTypes.meta.total} customer types`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Get all customer types notification error:', notifError);
      // }
     
      ControllerLogger.logGetAllRecords('Customer Types', req, res);
      res.status(200).json({
        status: "success",
        data: customerTypes.data,
        allRecords:  customerTypes.meta.total,
        totalPages:  customerTypes.meta.pages,
        page:  customerTypes.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Get All Customer Types', err, req, res);
      next(err);
    }
  }

  @httpGet("/:id")
  public async getCustomerTypeById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const customerType = await this.customerTypeService.getCustomerTypeById(id);
      
      if (!customerType) {
        ControllerLogger.logNotFound('Customer Type', id, req, res);
        return next(new AppError(404, "Customer type not found"));
      }
     
      // 🔔 Send notification for customer type view
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Viewed customer type "${customerType.name}" details`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Customer type view notification error:', notifError);
      // }
     
      ControllerLogger.logView('Customer Type', id, req, res);
      res.status(200).json({
        status: "success",
        data: customerType,
      });
    } catch (err) {
      ControllerLogger.logError('Get Customer Type by ID', err, req, res);
      next(err);
    }
  }

  @httpPost("/")
  public async createCustomerType(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { name } = req.body;

      const dto: CreateCustomerTypeDto = req.body;
     
      if (!name || typeof name !== 'string' || name.trim() === '') {
        ControllerLogger.logValidationError('Create Customer Type', 'Name is required and must be a non-empty string', req, res);
        return next(new AppError(400, "Customer type 'name' is required and must be a non-empty string"));
      }
      
      const customerType = await this.customerTypeService.createCustomerType(dto);

      // 🔔 Send notification for customer type creation
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Customer type "${name}" created successfully`,
            userId
          );
        }
      } catch (notifError) {
      }

      // 📝 Activity log
      // Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = res.locals.user?.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.CREATE,
        module: ActivityModule.CUSTOMER,
        entityName: 'CustomerType',
        entityId: customerType.id,
        description: `${userName} created customer type "${customerType.name}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 201,
      }).catch(() => {});
    }

      ControllerLogger.logSuccess('Customer Type created', customerType.id, req, res);
      res.status(201).json({
        status: "success",
        message: "Customer type created successfully",
      });
    } catch (err) {
      ControllerLogger.logError('Create Customer Type', err, req, res);
      next(err);
    }
  }

  @httpPatch("/:id",captureUser)
  public async updateCustomerType(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) 
  {
    try {
      const updatedBy=res.locals.updatedBy;
      const { name } = req.body;
     const dto: CreateCustomerTypeDto = req.body;
      const updatedCustomerType =
        await this.customerTypeService.updateCustomerType(id, dto, updatedBy);
      
      if (!updatedCustomerType) {
        ControllerLogger.logNotFound('Customer Type', id, req, res);
        return next(
          new AppError(404, "Customer type not found or update failed")
        );
      }

      // 🔔 Send notification for customer type update
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Customer type "${name || updatedCustomerType.name}" updated successfully`,
            userId
          );
        }
      } catch (notifError) {
      }

      // 📝 Activity log
      // Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = res.locals.user?.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.UPDATE,
        module: ActivityModule.CUSTOMER,
        entityName: 'CustomerType',
        entityId: id,
        description: `${userName} updated customer type "${updatedCustomerType.name}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    }

      ControllerLogger.logSuccess('Customer Type updated', id, req, res);
      res.status(200).json({
        status: "success",
        message: "Customer type updated successfully",
      });
    } catch (err) {
      ControllerLogger.logError('Update Customer Type', err, req, res);
      next(err);
    }
  }

  @httpDelete("/:id")
  public async deleteCustomerType(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) 
  {
    try {
      const success = await this.customerTypeService.deleteCustomerType(id);
      
      if (!success) {
        ControllerLogger.logNotFound('Customer Type', id, req, res);
        return res.status(404).json({ message: 'Customer Type not found' });
      }

      // 📝 Activity log
      // Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = res.locals.user?.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.CUSTOMER,
        entityName: 'CustomerType',
        entityId: id,
        description: `${userName} deleted customer type "${success.name}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    }
    
      ControllerLogger.logSuccess('Customer Type deleted', id, req, res);
      res.status(200).json({
        status: "success",
        message: "Customer Type deleted successfully",
      });
      
    } catch (err) {
      ControllerLogger.logError('Delete Customer Type', err, req, res);
      next(err);
    }
  }
   @httpDelete("/delete/multiple")
public async softDeleteMultipleCustomerType(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {

    const {ids} = req.body;
    const customerTypeIds=ids;

    if (!Array.isArray(customerTypeIds) || customerTypeIds.length === 0) {
      ControllerLogger.logError(
        "CustomerType bulk deletion",
        new AppError(400, "customerTypeIds must be a non-empty array"),
        req,
        res
      );
      return next(new AppError(400, "customerTypeIds must be a non-empty array"));
    }

    const result = await this.customerTypeService.softDeleteCustomerType(customerTypeIds);

    // 📝 Activity log
    // Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = res.locals.user?.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
    const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
    const deletedList = result.deleted.map(t => `"${t.name}"`).join(', ');
    this.activityLogService.logActivity({
      userId: res.locals.user.id,
      userName,
      action: ActivityAction.DELETE,
      module: ActivityModule.CUSTOMER,
      entityName: 'CustomerType',
      description: `${userName} bulk deleted ${result.deleted.length} customer type(s): ${deletedList}`,
      metadata: { ids: customerTypeIds, count: customerTypeIds.length },
      ipAddress: req.ip || '',
      userAgent: req.get('user-agent'),
      endpoint: req.originalUrl,
      httpMethod: req.method,
      statusCode: 200,
    }).catch(() => {});
  }
    ControllerLogger.logSuccess(
      "CustomerType bulk soft deleted",
      customerTypeIds.join(","),
      req,
      res
    );

    return res.status(200).json({
      status: "success",
      message: "CustomerType soft deleted successfully",
      affected: result.affected,
    });

  } catch (err) {
    ControllerLogger.logError("CustomerType bulk deletion", err, req, res);
    next(err);
  }
}
}
