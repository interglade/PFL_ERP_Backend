import { inject } from "inversify";
import {
  controller,
  httpDelete,
  httpGet,
  httpPost,
  httpPut,
  requestBody,
  requestParam,
  response,
  next,
  httpPatch,
  request,
  all,
} from "inversify-express-utils";
import { captureUser, deserializeUser, requireUser } from "../../../middleware/deserializeUser";
import { TYPES } from "../../../types";
import { ProductSubcategoryService } from "../service/product_subcategory.service";
import { NotificationService } from "../../../notification/service/notification.service";
import { NextFunction,Request,Response } from "express";
import { PaginationOptions } from "../../../utils/pagination";
import AppError from "../../../utils/appError";
import { ControllerLogger } from "../../../utils/controllerLogger";
import { CreateProductSubcategoryDto } from "../../createproduct/dto/product.dto";
import logger from "../../../utils/logger";



@controller("/productSubcategory", deserializeUser, requireUser)
export class ProductSubcategoryController {
  constructor(
    @inject(TYPES.ProductSubcategoryService)
    private productSubcategoryService: ProductSubcategoryService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService
  ) { }

  @httpGet("/")
  public async getAll(
    @request() req: Request,
    @response() res: Response, @next() next: NextFunction) {
    try {
      const { page, limit, search, sort, name } = req.query;


      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        searchFields: ['subCategory.name'],
        filters: {},
        sort: sort as string || undefined, // Adjust this line to match your sorting requirements
        search: search as string || '',
      };
      const subcategories = await this.productSubcategoryService.getAll(queryOptions);
      if (!subcategories.data.length) {
        ControllerLogger.logError('Product Subcategory list retrieval', new AppError(404, "No product subcategories found"), req, res);
        return next(new AppError(404, "No product subcategories found"));
      }
      ControllerLogger.logList('Product Subcategory', req, res);

      // Send notification for product subcategory list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Product Subcategory records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: subcategories.data,
        allRecords: subcategories.meta.total,
        totalPages: subcategories.meta.pages,
        page: subcategories.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Product Subcategory list retrieval', err, req, res);
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
      const subcategory = await this.productSubcategoryService.getById(id);
      if (!subcategory) {
        ControllerLogger.logError('Product Subcategory view', new AppError(404, "Product subcategory not found"), req, res);
        return next(new AppError(404, "Product subcategory not found"));
      }
      ControllerLogger.logView('Product Subcategory', id, req, res);

      // Send notification for product subcategory view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Product Subcategory viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({ status: "success", data: subcategory });
    } catch (err) {
      ControllerLogger.logError('Product Subcategory view', err, req, res);
      next(err);
    }
  }

  @httpPost("/")
  public async create(
    @requestBody() subcategoryData:CreateProductSubcategoryDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const { name, category } = subcategoryData;
      const subcategory = await this.productSubcategoryService.create(
        name,
        category
      );
      ControllerLogger.logSuccess('Product Subcategory created', subcategory.id, req, res);

      // Send notification for product subcategory creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Product Subcategory created successfully`,
          userId
        );
      }

      res.status(201).json({
        status: "success",
        message: "Product subcategory created successfully",
        //data: subcategory,
      });
    } catch (err) {
      ControllerLogger.logError('Product Subcategory creation', err, req, res);
      next(err);
    }
  }

  @httpPatch("/:id", captureUser)
  public async update(
    @requestParam("id") id: string,
    @requestBody() subcategoryData: CreateProductSubcategoryDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const updatedBy = res.locals.updatedBy
      const subcategory = await this.productSubcategoryService.update(
        id,
        subcategoryData,
        updatedBy
      );
      if (!subcategory) {
        ControllerLogger.logError('Product Subcategory update', new AppError(404, "Product subcategory not found or update failed"), req, res);
        return next(
          new AppError(404, "Product subcategory not found or update failed")
        );
      }
      ControllerLogger.logSuccess('Product Subcategory updated', id, req, res);

      // Send notification for product subcategory update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Product Subcategory updated successfully`,
          userId
        );
      }

      res.status(200).json({
        status: "success",
        message: "Product subcategory updated successfully",
        //data: subcategory,
      });
    } catch (err) {
      ControllerLogger.logError('Product Subcategory update', err, req, res);
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
      logger.info(`Deleting voucher with ID: ${id}`);
      const success = await this.productSubcategoryService.delete(id);
      if (success) {
        ControllerLogger.logSuccess('Product Subcategory deleted', id, req, res);

        // Send notification for product subcategory deletion
        // const userId = res.locals.user?.id;
        // if (userId) {
        //   await this.notificationService.createNoti(
        //     `Product Subcategory deleted successfully`,
        //     userId
        //   );
        // }

        res.status(200).json({
          status: "success",
          message: "Product subcategory deleted successfully",
        });
      } else {
        ControllerLogger.logError('Product Subcategory deletion', new AppError(404, "Product subcategory not found"), req, res);
        return next(new AppError(404, "Product subcategory not found"));
      }
    } catch (err) {
      ControllerLogger.logError('Product Subcategory deletion', err, req, res);
      next(err);
    }
  }
  @httpDelete("/delete/multiple")
  public async softDeleteMultipleProductSubcategory(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {

      const {ids} = req.body;
      const productSubcategoryIds=ids; 

      if (!Array.isArray(productSubcategoryIds) || productSubcategoryIds.length === 0) {
        ControllerLogger.logError(
          "ProductSubcategory bulk deletion",
          new AppError(400, "productSubcategoryIds must be a non-empty array"),
          req,
          res
        );
        return next(new AppError(400, "productSubcategoryIds must be a non-empty array"));
      }

      const result = await this.productSubcategoryService.softDeleteSubcategory(productSubcategoryIds);

      ControllerLogger.logSuccess(
        "ProductSubcategory bulk soft deleted",
        productSubcategoryIds.join(","),
        req,
        res
      );

      // Send notification
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Multiple ProductSubcategory soft deleted: ${productSubcategoryIds.length}`,
      //     userId
      //   );
      // }

      return res.status(200).json({
        status: "success",
        message: "ProductSubcategory soft deleted successfully",
        affected: result.affected,
      });

    } catch (err) {
      ControllerLogger.logError("ProductSubcategory bulk deletion", err, req, res);
      next(err);
    }
  }
}
