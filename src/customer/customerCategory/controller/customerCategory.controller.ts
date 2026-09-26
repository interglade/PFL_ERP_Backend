import { Request, Response, NextFunction } from "express";
import {
  controller,
  httpGet,
  httpPost,
  
  httpDelete,
  requestBody,
  requestParam,
  response,
  request,
  next,
  httpPatch,
} from "inversify-express-utils";
import { inject } from "inversify";
import { captureUser, deserializeUser, requireUser } from "../../../middleware/deserializeUser";
import { TYPES } from "../../../types";
import { CustomerCategoryService } from "../service/customerCategory.service";
import { NotificationService } from "../../../notification/service/notification.service";
import { UserActivityLogService } from "../../../employeeActivity/service/userActivityLog.service";
import { PaginationOptions } from "../../../utils/pagination";
import { ControllerLogger } from "../../../utils/controllerLogger";
import AppError from "../../../utils/appError";
import { CreateCustomerCategoryDto } from "../../addcustomer/dto/createCustomer.dto";
import { ActivityAction, ActivityModule } from "../../../employeeActivity/entity/userActivityLog.entity";


@controller("/customerCategory",deserializeUser,requireUser)
export class CustomerCategoryController {
  constructor(
    @inject(TYPES.CustomerCategoryService)
    private customerCategoryService: CustomerCategoryService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService)
    private activityLogService: UserActivityLogService,
  ) {}

  @httpGet("/")
  public async getAll(
    @request() req: Request,
    @response() res: Response, 
    @next() next: NextFunction) {
    try {
      const { page, limit, search, sort } = req.query;
                
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,  
        limit: limit ? Number(limit) : undefined,
        filters: {},
        sort: sort as string || undefined,
        search: search as string|| '',
      };
      
      const categories = await this.customerCategoryService.getAll(queryOptions);
      
      if (!categories || !categories.data || categories.data.length === 0) {
        return res.status(200).json({
          status: "success",
          data: [],
          allRecords: 0,
          totalPages: 0,
          page: queryOptions.page || 1,
        });
      }
      
      // 🔔 Send notification for get all customer categories
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Retrieved ${categories.meta.total} customer categories`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Get all customer categories notification error:', notifError);
      // }
      
      // Log successful retrieval with specific message
      ControllerLogger.logGetAllRecords('Customer Category', req, res);
      
      res.status(200).json({
        status: "success",
        data: categories.data,
        allRecords: categories.meta.total,
        totalPages: categories.meta.pages,     
        page: categories.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Customer Category retrieval', err, req, res);
      next(err);
    }
  }

  @httpGet("/:id")
  public async getById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const category = await this.customerCategoryService.getById(id);
      
      if (!category) {
        ControllerLogger.logNotFound('Customer Category', id, req, res);
        return next(new AppError(404, "Customer category not found"));
      }
      
      // 🔔 Send notification for customer category view
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Viewed customer category "${category.name}" details`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Customer category view notification error:', notifError);
      // }
      
      // Log successful view
      ControllerLogger.logView('Customer Category', id, req, res);
      
      res.status(200).json({
        status: "success",
        data: category,
      });
    } catch (err) {
      ControllerLogger.logError('Customer Category view', err, req, res);
      next(err);
    }
  }

  @httpPost("/")
  public async create(
    @requestBody() categoryData: CreateCustomerCategoryDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const category = await this.customerCategoryService.create(categoryData);
      
      if (!category) {
        ControllerLogger.logOperationFailed('Create', 'Customer Category', 'could not be created', req, res);
        return res.status(400).json({
          status: "error",
          message: "Customer Category could not be created",
        });
      }
      
      // 🔔 Send notification for customer category creation
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          const categoryName = categoryData.name || 'New Category';
          await this.notificationService.createNoti(
            `Customer category "${categoryName}" created successfully`,
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
        entityName: 'CustomerCategory',
        entityId: (category as any)?.id,
        description: `${userName} created customer category "${category.name}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 201,
      }).catch(() => {});
    }
      
      // Log successful creation
      ControllerLogger.logSuccess('Customer Category created', (category as any)?.id || 'unknown', req, res);
      
      res.status(201).json({
        status: "success",
        message: "Customer Category created successfully",
      });
    } catch (err) {
      ControllerLogger.logError('Customer Category creation', err, req, res);
      next(err);
    }
  }

  @httpPatch("/:id",captureUser)
  public async update(
    @requestParam("id") id: string,
    @requestBody() categoryData:CreateCustomerCategoryDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const updatedBy = res.locals.updatedBy;
      const category = await this.customerCategoryService.update(
        id,
        categoryData,
        updatedBy
      );
      
      if (!category) {
        ControllerLogger.logOperationFailed('Update', 'Customer Category', 'not found or could not be updated', req, res);
        return next(
          new AppError(404, "Customer category not found or update failed")
        );
      }
      
      // 🔔 Send notification for customer category update
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          const categoryName = categoryData.name || category.name || 'Category';
          await this.notificationService.createNoti(
            `Customer category "${categoryName}" updated successfully`,
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
        entityName: 'CustomerCategory',
        entityId: id,
        description: `${userName} updated customer category "${categoryData.name || category.name}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    }
      
      // Log successful update
      ControllerLogger.logSuccess('Customer Category updated', id, req, res);
      
      res.status(200).json({
        status: "success",
        message: "Customer Category updated successfully",
      });
    } catch (err) {
      ControllerLogger.logError('Customer Category update', err, req, res);
      next(err);
    }
  }

  @httpDelete("/:id")
  public async delete(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const success = await this.customerCategoryService.deleteCustomerCategory(id);
      
      if (!success) {
        ControllerLogger.logOperationFailed('Delete', 'Customer Category', 'not found or could not be deleted', req, res);
        return res.status(404).json({ message: 'Customer Category not found' });
      }

      // � Activity log
      // Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = res.locals.user?.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {

      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.DELETE,
        module: ActivityModule.CUSTOMER,
        entityName: 'CustomerCategory',
        entityId: id,
        description: `${userName} deleted customer category "${success.name}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    }
      
      // Log successful deletion
      ControllerLogger.logSuccess('Customer Category deleted', id, req, res);
     
      res.status(200).json({
        status: "success",
        message: "Customer Category deleted successfully",
      });
    } catch (err) {
      ControllerLogger.logError('Customer Category deletion', err, req, res);
      next(err);
    }
  }
  @httpDelete("/delete/multiple")
public async softDeleteMultipleCustomerCategory(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {

    const { ids } = req.body;
    const customerCategoryIds=ids;

    if (!Array.isArray(customerCategoryIds) || customerCategoryIds.length === 0) {
      ControllerLogger.logError(
        "CustomerCategory bulk deletion",
        new AppError(400, "customerCategoryIds must be a non-empty array"),
        req,
        res
      );
      return next(new AppError(400, "customerCategoryIds must be a non-empty array"));
    }

    const result = await this.customerCategoryService.softDeleteCustomerCategory(customerCategoryIds);

    // 📝 Activity log
    // Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = res.locals.user?.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
    const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
    const deletedList = result.deleted.map(c => `"${c.name}"`).join(', ');
    this.activityLogService.logActivity({
      userId: res.locals.user.id,
      userName,
      action: ActivityAction.DELETE,
      module: ActivityModule.CUSTOMER,
      entityName: 'CustomerCategory',
      description: `${userName} bulk deleted ${result.deleted.length} customer category(s): ${deletedList}`,
      metadata: { ids: customerCategoryIds, count: customerCategoryIds.length },
      ipAddress: req.ip || '',
      userAgent: req.get('user-agent'),
      endpoint: req.originalUrl,
      httpMethod: req.method,
      statusCode: 200,
    }).catch(() => {});
  }

    ControllerLogger.logSuccess(
      "CustomerCategory bulk soft deleted",
      customerCategoryIds.join(","),
      req,
      res
    );

    return res.status(200).json({
      status: "success",
      message: "CustomerCategory soft deleted successfully",
      affected: result.affected,
    });

  } catch (err) {
    ControllerLogger.logError("CustomerCategory bulk deletion", err, req, res);
    next(err);
  }
}
}
