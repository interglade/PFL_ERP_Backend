import { Request, Response, NextFunction } from "express";
import {
  controller,
  httpGet,
  httpPost,
  httpDelete,
  request,
  response,
  requestBody,
  requestParam,
  next,
  httpPatch,
} from "inversify-express-utils";
import { inject } from "inversify";
import { deserializeUser, requireUser } from "../../../middleware/deserializeUser";
import { TYPES } from "../../../types";
import { VendorSubcategoryService } from "../service/vendorSubcategory.service";
import { NotificationService } from "../../../notification/service/notification.service";
import { BulkDeleteVendorSubcategoryDto, CreateVendorSubcategoryDto, UpdateVendorSubcategoryDto } from "../dto/vendorSubcategory.dto";
import AppError from "../../../utils/appError";
import { ControllerLogger } from "../../../utils/controllerLogger";
import { PaginationOptions } from "../../../utils/pagination";




@controller("/vendor-subcategories", deserializeUser, requireUser)
export class VendorSubcategoryController {
  constructor(
    @inject(TYPES.VendorSubcategoryService)
    private subcategoryService: VendorSubcategoryService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService
  ) {}

  @httpPost("/")
  public async createSubcategory(
    @request() req: Request<{}, {}, CreateVendorSubcategoryDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
  try {
    const subcategoryData = req.body; // Ensure subcategoryData is extracted

    const subcategory = await this.subcategoryService.create(subcategoryData);
if(!subcategory) {
    return next(new AppError(400, "Subcategory not created"));
  }

    ControllerLogger.logSuccess('Vendor subcategory created', subcategory.id, req, res);

    // Send notification for vendor subcategory creation
    const userId = res.locals.user?.id;
    if (userId) {
      await this.notificationService.createNoti(
        `Vendor Subcategory created successfully`,
        userId
      );
    }

    res.status(201).json({
      status: "success",
      message: `Vendor subcategory created successfully`,
    });
  } catch (err) {
    ControllerLogger.logError('Vendor subcategory creation', err, req, res);
    next(err);
  }
}


  @httpGet("/")
public async getAllSubcategories(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const { page, limit, search, sort,subcategoryId} = req.query;
          
      
    const queryOptions: PaginationOptions = {
      page: page ? Number(page) : undefined,  
      limit: limit ? Number(limit) : undefined,
      searchFields: ['subCategory.name'],
      filters: {},
      sort: sort as string || undefined, // Adjust this line to match your sorting requirements
      search: search as string|| '',
    };
    const subcategories = await this.subcategoryService.getByall(queryOptions);

    if (!subcategories || subcategories.data.length === 0) {
      return next(new AppError(404, "Subcategories not found"));
    }

    ControllerLogger.logList('Vendor subcategories', req, res);

    // Send notification for vendor subcategories list access
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     'Vendor Subcategory records list accessed successfully',
    //     userId
    //   );
    // }

    res.status(200).json({
      status: "success",
      data: subcategories.data,
      allRecords:  subcategories.meta.total,
        totalPages:  subcategories.meta.pages,
        page:  subcategories.meta.page,
     
    });
  } catch (err) {
    ControllerLogger.logError('Vendor subcategories retrieval', err, req, res);
    next(err);
  }
}

@httpGet("/getSubcategories")
public async getAllSubcategories1(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    
     const categoryId = req.query.search as string; // Get categoryId from query
    const subcategories = await this.subcategoryService.getSubcategories(categoryId);
    // if (!subcategories || subcategories.length === 0) {
    //   return next(new AppError(404, "Subcategories not found"));
    // }

    ControllerLogger.logList('Vendor subcategories by category', req, res);
    res.status(200).json({
      status: "success",
      data: subcategories,
    });
  } catch (err) {
    ControllerLogger.logError('Vendor subcategories by category retrieval', err, req, res);
    next(err);
  }
}

  @httpGet("/:id")
  public async getSubcategoryById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const subcategory = await this.subcategoryService.getById(id);
      if (!subcategory) {
        return next(new AppError(404, "Subcategory not found"));
      }
      ControllerLogger.logView('Vendor subcategory', id, req, res);

      // Send notification for vendor subcategory view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Vendor Subcategory viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: subcategory,
      });
    } catch (err) {
      ControllerLogger.logError('Vendor subcategory view', err, req, res);
      next(err);
    }
  }

  @httpPatch("/:id")
  public async updateSubcategory(
    @requestParam("id") id: string,
    @requestBody() body: UpdateVendorSubcategoryDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const updateBy=res.locals.user.id;

      const updatedSubcategory = await this.subcategoryService.update(id, body,updateBy);
      if (!updatedSubcategory) {
        return next(new AppError(404, "Subcategory not found"));
      }
      ControllerLogger.logSuccess('Vendor subcategory updated', id, req, res);

      // Send notification for vendor subcategory update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Vendor Subcategory updated successfully`,
          userId
        );
      }

      res.status(200).json({
        status: "success",
        //data: updatedSubcategory,
        message: `Vendor subcategory updated successfully`,
      });
    } catch (err) {
      ControllerLogger.logError('Vendor subcategory update', err, req, res);
      next(err);
    }
  }

  @httpDelete("/:id")
  public async deleteSubcategory(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      if (!id) {
        return next(new AppError(400, "Subcategory ID is required"));
      }
      const success = await this.subcategoryService.delete(id);
      if (!success) {
        return next(new AppError(404, "Subcategory not found"));
      }
      ControllerLogger.logSuccess('Vendor subcategory deleted', id, req, res);

      // Send notification for vendor subcategory deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Vendor Subcategory deleted successfully`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        message: `Vendor subcategory deleted successfully`,
      });
    } catch (err) {
      ControllerLogger.logError('Vendor subcategory deletion', err, req, res);
      next(err);
    }
  }
  @httpDelete("/delete/multiple")
  public async softDeleteMultipleVendorSubcategory(
    @request() req: Request<{}, {}, BulkDeleteVendorSubcategoryDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      ControllerLogger.logError(
        "VendorSubcategory bulk deletion",
        new AppError(400, "subCategoryIds must be a non-empty array"),
        req,
        res
      );
      return next(new AppError(400, "subCategoryIds must be a non-empty array"));
    }

    const result = await this.subcategoryService.softDeleteSubcategory(ids);

    ControllerLogger.logSuccess(
      "VendorSubcategory bulk soft deleted",
      ids.join(","),
      req,
      res
    );

    // Send notification
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     `Multiple VendorSubcategory soft deleted: ${subCategoryIds.length}`,
    //     userId
    //   );
    // }

    return res.status(200).json({
      status: "success",
      message: "VendorSubcategory soft deleted successfully",
      affected: result.affected,
    });

  } catch (err) {
    ControllerLogger.logError("VendorSubcategory bulk deletion", err, req, res);
    next(err);
  }
}
}
