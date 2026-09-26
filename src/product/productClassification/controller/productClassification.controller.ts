import { Request, Response, NextFunction } from "express";
import { inject } from "inversify";
import { TYPES } from "../../../types";
import { ProductClassification } from "../entity/product_classification.entity";
import AppError from "../../../utils/appError";
import { controller, httpGet, httpPost, httpPatch, httpDelete, request, response, requestParam, requestBody, next } from "inversify-express-utils";
import { captureUser, deserializeUser, requireUser } from "../../../middleware/deserializeUser";
import { PaginationOptions } from "../../../utils/pagination";
import { ControllerLogger } from "../../../utils/controllerLogger";
import { ProductClassificationService } from "../service/product_classification.service";
import { NotificationService } from "../../../notification/service/notification.service";
import { CreateProductClassificationDto } from "../../createproduct/dto/product.dto";


@controller("/productClassification", deserializeUser, requireUser)
export class ProductClassificationController {
  constructor(
    @inject(TYPES.ProductClassificationService) 
    private productClassificationService: ProductClassificationService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService
  ) {}

  @httpGet("/")
  public async findAll(
    @request() req:Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      const { page, limit, search, sort,name} = req.query;
                
            
                  const queryOptions: PaginationOptions = {
                    page: page ? Number(page) : undefined,  
                    limit: limit ? Number(limit) : undefined,
                    searchFields: ['product.name'],
                    filters: {},
                    sort: sort as string || undefined, // Adjust this line to match your sorting requirements
                    search: search as string|| '',
                  };
      const classifications = await this.productClassificationService.findAll(queryOptions);
      //console.log(classifications)
      if (!classifications.data.length) {
        ControllerLogger.logError('Product Classification list retrieval', new AppError(404, "No classifications found"), req, res);
        return next(new AppError(404, "No classifications found"));
      }
      ControllerLogger.logList('Product Classification', req, res);

      // Send notification for product classification list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Product Classification records list accessed successfully',
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: classifications.data,
        allRecords:classifications.meta.total,
        totalPages:classifications.meta.pages,
        page:classifications.meta.page,
      });
    } catch (error) {
      ControllerLogger.logError('Product Classification list retrieval', error, req, res);
      next(new AppError(500, "Error fetching classifications"));
    }
  }

  @httpGet("/:id")
  public async findById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      const classification = await this.productClassificationService.findById(id);
      if (!classification) {
        ControllerLogger.logError('Product Classification view', new AppError(404, "Classification not found"), req, res);
        return next(new AppError(404, "Classification not found"));
      }
      ControllerLogger.logView('Product Classification', id, req, res);

      // Send notification for product classification view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Product Classification viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: classification,
      });
    } catch (error) {
      ControllerLogger.logError('Product Classification view', error, req, res);
      next(new AppError(500, "Error fetching classification"));
    }
  }

  @httpPost("/")
  public async create(
    @requestBody() classificationData: CreateProductClassificationDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      const newClassification = await this.productClassificationService.create(classificationData);
      ControllerLogger.logSuccess('Product Classification created', newClassification.id, req, res);

      // Send notification for product classification creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Product Classification created successfully`,
          userId
        );
      }

      res.status(201).json({
        status: "success",
        message: "Product classification created successfully",
        data: newClassification,
      });
    } catch (error) {
      ControllerLogger.logError('Product Classification creation', error, req, res);
      next(new AppError(500, "Error creating classification"));
    }
  }

  @httpPatch("/:id",captureUser)
  public async update(
    @requestParam("id") id: string,
    @requestBody() classificationData: CreateProductClassificationDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      const updatedBy=res.locals.updatedBy
      const updatedClassification = await this.productClassificationService.update(id, classificationData,updatedBy);
      if (!updatedClassification) {
        ControllerLogger.logError('Product Classification update', new AppError(404, "Classification not found"), req, res);
        return next(new AppError(404, "Classification not found"));
      }
      ControllerLogger.logSuccess('Product Classification updated', id, req, res);

      // Send notification for product classification update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Product Classification updated successfully`,
          userId
        );
      }

      res.status(200).json({
        status: "success",
        message: "Product classification updated successfully",
        data: updatedClassification,
      });
    } catch (error) {
      ControllerLogger.logError('Product Classification update', error, req, res);
      next(new AppError(500, "Error updating classification"));
    }
  }

  @httpDelete("/:id")
  public async delete(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      const success = await this.productClassificationService.delete(id);
      if (!success) {
        ControllerLogger.logError('Product Classification deletion', new AppError(404, "Classification not found"), req, res);
        return next(new AppError(404, "Classification not found"));
      }
      ControllerLogger.logSuccess('Product Classification deleted', id, req, res);

      // Send notification for product classification deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Product Classification deleted successfully`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        message: "Product classification deleted successfully",
      });
    } catch (error) {
      ControllerLogger.logError('Product Classification deletion', error, req, res);
      next(new AppError(500, "Error deleting classification"));
    }
  }
   @httpDelete("/delete/multiple")
public async softDeleteMultipleProductClassification(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {

    const { ids } = req.body;
    const productClassificationIds=ids;

    if (!Array.isArray(productClassificationIds) || productClassificationIds.length === 0) {
      ControllerLogger.logError(
        "Classification bulk deletion",
        new AppError(400, "productClassificationIds must be a non-empty array"),
        req,
        res
      );
      return next(new AppError(400, "productClassificationIds must be a non-empty array"));
    }

    const result = await this.productClassificationService.softDeleteClassification(productClassificationIds);

    ControllerLogger.logSuccess(
      "Classification bulk soft deleted",
      productClassificationIds.join(","),
      req,
      res
    );

    // Send notification
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     `Multiple classification soft deleted: ${productClassificationIds.length}`,
    //     userId
    //   );
    // }

    return res.status(200).json({
      status: "success",
      message: "ProductClassification soft deleted successfully",
      affected: result.affected,
    });

  } catch (err) {
    ControllerLogger.logError("ProductClassification bulk deletion", err, req, res);
    next(err);
  }
}
}
