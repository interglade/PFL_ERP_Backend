import { inject } from "inversify";
import {
  controller,
  httpDelete,
  httpGet,
  httpPost,
  httpPatch,
  request,
  requestParam,
  requestBody,
  response,
  next,
} from "inversify-express-utils";
import { TYPES } from "../../../types";
import AppError from "../../../utils/appError";
import { NextFunction, Response, Request } from "express";

import { captureUser, deserializeUser, requireUser } from "../../../middleware/deserializeUser";

import logger from "../../../utils/logger";
import { PaginationOptions } from "../../../utils/pagination";
import { ControllerLogger } from "../../../utils/controllerLogger";
import { ProductCategoryService } from "../service/product_category.service";
import { NotificationService } from "../../../notification/service/notification.service";
import { CreateProductCategoryDto } from "../../createproduct/dto/product.dto";


@controller("/productCategory", deserializeUser, requireUser)
export class ProductCategoryController {
  constructor(
    @inject(TYPES.ProductCategoryService)
    private productCategoryService: ProductCategoryService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService
  ) {}

  // Get all product categories
  @httpGet("/")
  public async getAll(
    @request() req:Request,
    @response() res: Response, @next() next: NextFunction) {
    try {
      logger.info("Fetching all product categories");

      const { page, limit, search, sort,name} = req.query;
                      
                  
                        const queryOptions: PaginationOptions = {
                          page: page ? Number(page) : undefined,  
                          limit: limit ? Number(limit) : undefined,
                          searchFields: ['category.name'],
                          filters: {},
                          sort: sort as string || undefined, // Adjust this line to match your sorting requirements
                          search: search as string|| '',
                        };
      const categories = await this.productCategoryService.getAll(queryOptions);
      if (!categories.data.length) {
        logger.warn("No product categories found");
        ControllerLogger.logError('Product Category list retrieval', new AppError(404, "No product categories found"), req, res);
        return next(new AppError(404, "No product categories found"));
      }
      logger.info("Successfully fetched product categories", { count: categories.data.length });
      ControllerLogger.logList('Product Category', req, res);

      // Send notification for product category list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Product Category records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({ status: "success",
         data: categories.data ,
         allRecords: categories.meta.total,
         totalPages: categories.meta.pages,
         page: categories.meta.page,
        });
    } catch (err) {
      logger.error("Error fetching product categories", { error: err });
      ControllerLogger.logError('Product Category list retrieval', err, req, res);
      next(err);
    }
  }

  // Get product category by ID
  @httpGet("/:id")
  public async getById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      logger.info("Fetching product category by ID", { id });
      const category = await this.productCategoryService.getById(id);
      if (!category) {
        logger.warn("Product category not found", { id });
        ControllerLogger.logError('Product Category view', new AppError(404, "Product category not found"), req, res);
        return next(new AppError(404, "Product category not found"));
      }
      logger.info("Successfully fetched product category", { id });
      ControllerLogger.logView('Product Category', id, req, res);

      // Send notification for product category view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Product Category viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({ status: "success", data: category });
    } catch (err) {
      logger.error("Error fetching product category by ID", {  error: err });
      ControllerLogger.logError('Product Category view', err, req, res);
      next(err);
    }
  }

  // Create a new product category
  @httpPost("/")
  public async create(
    @requestBody() categoryData: CreateProductCategoryDto,
   @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {  logger.info("Creating a new product category");
    try {
      const category = await this.productCategoryService.create(categoryData);
      logger.info("Product category created successfully", { category });
      ControllerLogger.logSuccess('Product Category created', category.id, req, res);

      // Send notification for product category creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Product Category created successfully`,
          userId
        );
      }

      res.status(201).json({
        status: "success",
        message: "Product category created successfully",
        data: category,
      });
    } catch (err) {
      logger.error("Error creating product category", { error: err});
      ControllerLogger.logError('Product Category creation', err, req, res);
      next(err);
    }
  }

  // Update product category by ID
  @httpPatch("/:id",captureUser)
  public async update(
    @requestParam("id") id: string,
    @requestBody() categoryData: CreateProductCategoryDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    logger.info("Updating product category");
    try {
      const updatedBy=res.locals.updatedBy
      const category = await this.productCategoryService.update(id, categoryData,updatedBy);
      if (!category) {
        logger.warn("Product category not found or update failed", { id });
        ControllerLogger.logError('Product Category update', new AppError(404, "Product category not found or update failed"), req, res);
        return next(new AppError(404, "Product category not found or update failed"));
      }
      logger.info("Product category updated successfully", { id });
      ControllerLogger.logSuccess('Product Category updated', id, req, res);

      // Send notification for product category update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Product Category updated successfully`,
          userId
        );
      }

      res.status(200).json({
        status: "success",
        message: "Product category updated successfully",
        data: category,
      });
    } catch (err) {
      logger.error("Error updating product category", { id, error: err });
      ControllerLogger.logError('Product Category update', err, req, res);
      next(err);
    }
  }

  // Delete product category by ID
  @httpDelete("/:id")
  public async delete(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {logger.info("Deleting product category", { id });
    try {
      const success = await this.productCategoryService.delete(id);
      if (!success) {
        logger.info("Product category deleted successfully", { id });
        ControllerLogger.logSuccess('Product Category deleted', id, req, res);

        // Send notification for product category deletion
        // const userId = res.locals.user?.id;
        // if (userId) {
        //   await this.notificationService.createNoti(
        //     `Product Category deleted successfully`,
        //     userId
        //   );
        // }

        res.status(200).json({
          status: "success",
          message: "Product category deleted successfully",
        });
      } else {
        logger.warn("Product category not found", { id });
        ControllerLogger.logError('Product Category deletion', new AppError(404, "Product category not found"), req, res);
        return next(new AppError(404, "Product category not found"));
      }
    } catch (err) {
      logger.error("Error deleting product category", { id, error: err });
      ControllerLogger.logError('Product Category deletion', err, req, res);
      next(err);
    }
  }
   @httpDelete("/delete/multiple")
public async softDeleteMultipleProductCategory(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {

    const { ids } = req.body;
    const productCategoryIds=ids;

    if (!Array.isArray(productCategoryIds) || productCategoryIds.length === 0) {
      ControllerLogger.logError(
        "ProductCategory bulk deletion",
        new AppError(400, "productCategoryIds must be a non-empty array"),
        req,
        res
      );
      return next(new AppError(400, "productCategoryIds must be a non-empty array"));
    }

    const result = await this.productCategoryService.softDeleteCategory(productCategoryIds);

    ControllerLogger.logSuccess(
      "ProductCategory bulk soft deleted",
      productCategoryIds.join(","),
      req,
      res
    );

    // Send notification
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     `Multiple ProductCategory soft deleted: ${productCategoryIds.length}`,
    //     userId
    //   );
    // }

    return res.status(200).json({
      status: "success",
      message: "ProductCategory soft deleted successfully",
      affected: result.affected,
    });

  } catch (err) {
    ControllerLogger.logError("ProductCategory bulk deletion", err, req, res);
    next(err);
  }
}
}
