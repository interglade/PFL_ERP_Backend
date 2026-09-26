import { Request, Response, NextFunction } from "express";
import {
  controller,
  httpGet,
  httpPost,
  httpDelete,
  response,
  requestParam,
  next,
  httpPatch,
  request,
} from "inversify-express-utils";
import { inject } from "inversify";
import { deserializeUser, requireUser } from "../../../middleware/deserializeUser";
import { TYPES } from "../../../types";
import { VendorCategoryService } from "../service/vendorCategory.service";
import { NotificationService } from "../../../notification/service/notification.service";
import { validate } from "../../../middleware/validate";
import { PaginationOptions } from "../../../utils/pagination";
import { BulkDeleteVendorCategoryDto, CreateVendorCategoryDto, UpdateVendorCategoryDto, createVendorCategorySchema, getAllVendorCategoriesSchema, getVendorCategoryByIdSchema, updateVendorCategorySchema, deleteVendorCategorySchema } from "../dto/vendorCategory.dto";
import AppError from "../../../utils/appError";
import { ControllerLogger } from "../../../utils/controllerLogger";




@controller("/vendor-categories", deserializeUser, requireUser)
export class VendorCategoryController {
  constructor(
    @inject(TYPES.VendorCategoryService)
    private vendorCategoryService: VendorCategoryService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService
  ) {}

  @httpPost("/", validate(createVendorCategorySchema))
  public async createCategory(
    @request() req: Request<{}, {}, CreateVendorCategoryDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { name } = req.body; // `name` should now be correctly set
  
      if (!name) {
        return next(new AppError(400, "Category name is required"));
      }
  
      const category = await this.vendorCategoryService.create({ name });
  
      if (!category) {
        return next(new AppError(400, "Category not created"));
      }
  
      ControllerLogger.logSuccess('Vendor category created', category.id, req, res);

      // Send notification for vendor category creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Vendor Category created successfully`,
          userId
        );
      }

      res.status(201).json({
        status: "success",
        message: `Vendor category created successfully`,
        data: category,
      });
    } catch (err) {
      ControllerLogger.logError('Vendor category creation', err, req, res);
      next(err);
    }
  }
  
  @httpGet("/", validate(getAllVendorCategoriesSchema))
  public async getCategories(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
       const { page, limit, search, sort,categoryId} = req.query;
                
            
                  const queryOptions: PaginationOptions = {
                    page: page ? Number(page) : undefined,  
                    limit: limit ? Number(limit) : undefined,
                    searchFields: ['category.name'],
                    filters: {},
                    sort: sort as string || undefined, // Adjust this line to match your sorting requirements
                    search: search as string|| '',
                  };
      const categories = await this.vendorCategoryService.getCategories(queryOptions);
      if (!categories.data.length) {
        return next(new AppError(404, "No categories found"));
      }

      ControllerLogger.logList('Vendor categories', req, res);

      // Send notification for vendor categories list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Vendor Category records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: categories.data,
        allRecords: categories.meta.total,
        totalPages: categories.meta.pages,
        page: categories.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Vendor categories retrieval', err, req, res);
      next(err);
    }
  }

  @httpGet("/:id", validate(getVendorCategoryByIdSchema))
  public async getCategoryById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const category = await this.vendorCategoryService.getById(id);
      if (!category) {
        return next(new AppError(404, "Category not found"));
      }

      ControllerLogger.logView('Vendor category', id, req, res);

      // Send notification for vendor category view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Vendor Category viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: category,
      });
    } catch (err) {
      ControllerLogger.logError('Vendor category view', err, req, res);
      next(err);
    }
  }

  @httpPatch("/:id", validate(updateVendorCategorySchema))
  public async updateCategory(
    @requestParam("id") id: string,
    @request() req: Request<{ id: string }, {}, UpdateVendorCategoryDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
  try {
    const updateBy = res.locals.user?.id; // Ensure you extract the user ID from the locals


    const updatedCategory = await this.vendorCategoryService.update(
      id,
      req.body,
      updateBy
    );

    if (!updatedCategory) {
      return next(new AppError(404, "Category not found or update failed"));
    }

    ControllerLogger.logSuccess('Vendor category updated', id, req, res);

    // Send notification for vendor category update
    const userId = res.locals.user?.id;
    if (userId) {
      await this.notificationService.createNoti(
        `Vendor Category updated successfully`,
        userId
      );
    }

    res.status(200).json({
      status: "success",
      message: "Vendor category updated successfully",
    });
  } catch (err) {
    ControllerLogger.logError('Vendor category update', err, req, res);
    next(err);
  }
}


  @httpDelete("/:id",validate(deleteVendorCategorySchema))
  public async deleteCategory(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      if (!id) {
        return next(new AppError(400, "Vendor Category ID is required"));
      }
      const success = await this.vendorCategoryService.delete(id);
      if (!success) {
        return next(new AppError(404, "Vendor Category not found"));
      }
      ControllerLogger.logSuccess('Vendor category deleted', id, req, res);

      // Send notification for vendor category deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Vendor Category deleted successfully`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        message: `Vendor category  deleted successfully`,
      });
    } catch (err) {
      ControllerLogger.logError('Vendor category deletion', err, req, res);
      next(err);
    }
  }
  @httpDelete("/delete/multiple")
  public async softDeleteMultipleVendorCategory(
    @request() req: Request<{}, {}, BulkDeleteVendorCategoryDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      ControllerLogger.logError(
        "VendorCategory bulk deletion",
        new AppError(400, "categoryIds must be a non-empty array"),
        req,
        res
      );
      return next(new AppError(400, "categoryIds must be a non-empty array"));
    }

    const result = await this.vendorCategoryService.softDeleteCategory(ids);

    ControllerLogger.logSuccess(
      "VendorCategory bulk soft deleted",
      ids.join(","),
      req,
      res
    );

    // Send notification
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     `Multiple VendorCategory soft deleted: ${resolvedIds.length}`,
    //     userId
    //   );
    // }

    return res.status(200).json({
      status: "success",
      message: "VendorCategory soft deleted successfully",
      affected: result.affected,
    });

  } catch (err) {
    ControllerLogger.logError("VendorCategory bulk deletion", err, req, res);
    next(err);
  }
}
}
