import { inject } from 'inversify';
import {
  controller,
  httpGet,
  httpPost,
  httpPatch,
  httpDelete,
  requestBody,
  requestParam,
  response,
  next,
  request,
  httpPut,
} from 'inversify-express-utils';

import { NextFunction, Request, Response } from 'express';
import { captureUser, deserializeUser, requireUser } from '../../../middleware/deserializeUser';
import { TYPES } from '../../../types';
import { ProductService } from '../service/product.service';
import { PdfGeneratorService } from '../../../utils/pdfGenerator';
import { NotificationService } from '../../../notification/service/notification.service';
import { PaginationOptions } from '../../../utils/pagination';
import logger from '../../../utils/logger';
import { ControllerLogger } from '../../../utils/controllerLogger';
import AppError from '../../../utils/appError';
import { uploadSingle } from '../../../middleware/uploadsingle.middleware';
import { CreateProductDto } from '../dto/createProduct.dto';




 @controller('/products', deserializeUser, requireUser)
export class ProductController {
  constructor(
    @inject(TYPES.ProductService) private productService: ProductService,
    @inject(TYPES.PdfGeneratorService)
            private readonly pdfGeneratorService: PdfGeneratorService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,

  ) {}

  @httpGet('/')
  public async getAll(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { page, limit, search, sort } = req.query;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        //searchFields: ['product.name'],
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };
      logger.info('Fetching all products');
      const products = await this.productService.getAll(queryOptions);
      logger.info(`Fetched ${products.data.length} products successfully`);
      ControllerLogger.logList('Product', req, res);

      // Send notification for product list access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     'Product records list accessed successfully',
      //     userId
      //   );
      // }

      res
        .status(200)
        .json({
          status: 'success',
          data: products.data,
          allRecords: products.meta.total,
          totalPages: products.meta.pages,
          page: products.meta.page,
        });
    } catch (err) {
      logger.error('Error fetching all products', { error: err });
      ControllerLogger.logError('Product list retrieval', err, req, res);
      next(err);
    }
  }
  @httpGet('/partial/data')
  public async getAllPartial(
    @response() res: Response,
    @next() next: NextFunction,
    @request() req: Request,
  ) {
    try {
      logger.info('Fetching all products');
      const { page, limit, search, sort } = req.query;

      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        // searchFields: ['product.name'],
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };
      const products = await this.productService.getAllByFilter(queryOptions);
      logger.info(`Fetched ${products.length} products successfully`);
      res
        .status(200)
        .json({
          status: 'success',
          data: products.data,
          totalRecords: products.meta.total,
          totalPages: products.meta.pages,
          page: products.meta.page,
        });
    } catch (err) {
      logger.error('Error fetching all products', { error: err });
      next(err);
    }
  }
  @httpGet('/serachData/product')
  public async getAllBySearch(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info('Fetching all products');
      const search = req.query.search as string;
      const products = await this.productService.getAllwithSearch(search);
      logger.info(`Fetched ${products.length} products successfully`);
      res.status(200).json({ status: 'success', data: products });
    } catch (err) {
      logger.error('Error fetching all products', { error: err });
      next(err);
    }
  }
  @httpGet('/partial/:id')
  public async getPartialById(
    @requestParam('id') id: string,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info('Fetching all products');
      const products = await this.productService.getPartialByID(id);
      logger.info(`Fetched ${products.length} products successfully`);
      res.status(200).json({ status: 'success', data: products });
    } catch (err) {
      logger.error('Error fetching all products', { error: err });
      next(err);
    }
  }
  @httpGet('/productname/')
  async searchProductByName(req: Request, res: Response): Promise<any> {
    try {
      logger.info('searching  all products');
      const { search } = req.query; 
      if (!search || typeof search !== 'string') {
        return res
          .status(400)
          .json({ message: 'Search query is required and must be a string' });
      }

      const products = await this.productService.getByproductNameFilter(search);
      //console.log(products)
      return res.status(200).json({ success: true, data: products });
    } catch (error) {
      return res.status(500).json({ success: false, message: error });
    }
  }

  @httpGet('/getVarient/:id')
  async getVarientWithProductId(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<any> {
    try {
      logger.info('searching  all products');
      const { id } = req.params;
      if (!id || typeof id !== 'string') {
        return res
          .status(400)
          .json({ message: 'Product ID is required and must be a string' });
      }

      const products = await this.productService.getVarientsByProductId(id);

      return res.status(200).json({ status: 'success', data: products });
    } catch (error) {
      logger.error('Error fetching product variants', { error });
      next(error);
    }
  }

  @httpGet('/:id')
  public async getById(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info(`Fetching product with ID`);
      const product = await this.productService.getById(id);
      if (!product) {
        logger.warn(`Product with ID not found`);
        ControllerLogger.logError('Product view', new AppError(404, 'Product not found'), req, res);
        return next(new AppError(404, 'Product not found'));
      }
      logger.info(`Product with ID fetched successfully`);
      ControllerLogger.logView('Product', id, req, res);

      // Send notification for product view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Product viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({ status: 'success', data: product });
    } catch (err) {
      logger.error(`Error fetching product with ID`, { error: err });
      ControllerLogger.logError('Product view', err, req, res);
      next(err);
    }
  }

  @httpGet('/getall/getvarient/:id')
  public async getvarientByID(
    @requestParam('id') id: string,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info(`Fetching product with ID`);
      console.log("product id",id);
      const product = await this.productService.getVarientByProductId(id);
      if (!product) {
        logger.warn(`Product with ID not found`);
        return next(new AppError(404, 'Product not found'));
      }
      logger.info(`Product with ID fetched successfully`);
      res.status(200).json({ status: 'success', data: product });
    } catch (err) {
      logger.error(`Error fetching product with ID`, { error: err });
      next(err);
    }
  }

  @httpPost('/getproduct/byids')
  public async getProductsByIds(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<void> {
    try {
      const { ids } = req.body;

      if (!Array.isArray(ids)) {
        throw new AppError(400, 'ids must be an array');
      }

      // Filter empty strings before passing to service
      const validIds = ids.filter((id: any) => id && String(id).trim() !== '');
      if (validIds.length === 0) {
        res.status(200).json({ status: 'success', data: [] });
        return;
      }

      const products = await this.productService.getProductsByIds(validIds);

      res.status(200).json({
        status: 'success',
        data: products,
      });
    } catch (error) {
      logger.error('Error fetching products by ids:', error);
      next(error);
    }
  }

  @httpPost('/', uploadSingle.single('image'))
  public async create(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info('Creating a new product');
      const productData:CreateProductDto = req.body;

      if (req.file) {
        const imageUrl = (req.file as any).location;
        if (imageUrl) {
          productData.image = imageUrl;
        }
      }

      const product = await this.productService.create(productData);
      logger.info('Product created successfully');
      ControllerLogger.logSuccess('Product created', product.id, req, res);

      // Send notification for product creation
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Product created successfully: ${product.name}`,
          userId
        );
      }

      res.status(201).json({
        status: 'success',
        message: 'Product created successfully',
        data: product.id,
        image: product.image,
      });
    } catch (err) {
      logger.error('Error creating product', { error: err });
      ControllerLogger.logError('Product creation', err, req, res);
      next(err);
    }
  }

  
  @httpPut('/:id', uploadSingle.single('image'), captureUser)
  public async update(
    @requestParam('id') id: string,
    @requestBody() productData: CreateProductDto,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      // Log incoming data for debugging

      if (req.file) {
        const imageUrl = (req.file as any).location;
        productData.image = imageUrl;
      }
      const updatedData = {
        ...productData,
        //   qualityParameters: Array.isArray(productData.qualityParameters)
        // ? productData.qualityParameters
        // : JSON.parse(productData.qualityParameters), // Convert back to array
      };

      logger.info(`Updating product with ID`);
      const updatedBy = res.locals.updatedBy;
      const product = await this.productService.update(
        id,
        updatedData,
        updatedBy,
      );
      if (!product) {
        logger.warn(`Product with ID not found or update failed`);
        ControllerLogger.logError('Product update', new AppError(404, 'Product not found or update failed'), req, res);
        return next(new AppError(404, 'Product not found or update failed'));
      }
      ControllerLogger.logSuccess('Product updated', id, req, res);

      // Send notification for product update
      const userId = res.locals.user?.id;
      if (userId) {
        await this.notificationService.createNoti(
          `Product updated successfully`,
          userId
        );
      }

      res.status(200).json({
        status: 'success',
        message: 'Product updated successfully',
        data: product,
      });
    } catch (err) {
      logger.error(`Error updating product with ID: ${id}`, { error: err });
      ControllerLogger.logError('Product update', err, req, res);
      next(err);
    }
  }
   @httpDelete("/delete/multiple")
public async softDeleteMultipleProducts(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {

    const { ids } = req.body;
    const productIds=ids;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      ControllerLogger.logError(
        "Product bulk deletion",
        new AppError(400, "productIds must be a non-empty array"),
        req,
        res
      );
      return next(new AppError(400, "productIds must be a non-empty array"));
    }

    const result = await this.productService.softDeleteProducts(productIds);

    ControllerLogger.logSuccess(
      "Product bulk soft deleted",
      productIds.join(","),
      req,
      res
    );

    // Send notification
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     `Multiple product soft deleted: ${productIds.length}`,
    //     userId
    //   );
    // }

    return res.status(200).json({
      status: "success",
      message: "Products soft deleted successfully",
      affected: result.affected,
    });

  } catch (err) {
    ControllerLogger.logError("Product bulk deletion", err, req, res);
    next(err);
  }
}

  @httpPost("/upload-product", uploadSingle.single('file'))
  public async uploadProductsExcel(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      
      if (!req.file) {
        ControllerLogger.logValidationError('Product Excel upload', 'No file uploaded', req, res);
        return next(new AppError(400, 'No file uploaded'));
      }
      
      const fileUrl = (req.file as any).location;
      
      if (!fileUrl) {
        return next(new AppError(400, 'File URL is required'));
      }
      
      const summary = await this.productService.createProductWithExcel(fileUrl);
      
      // 🔔 Send notification for product Excel upload
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Product Excel imported: ${summary.created} created, ` +
              `${summary.skipped.length} skipped, ${summary.failed.length} failed`,
            userId
          );
        }
      } catch (notifError) {
      }
      
      ControllerLogger.logSuccess('Product Excel uploaded', 'bulk', req, res);
      res.status(200).json({
        status: 'success',
        message:
          `${summary.created} product(s) imported` +
          (summary.skipped.length ? `, ${summary.skipped.length} skipped` : '') +
          (summary.failed.length ? `, ${summary.failed.length} failed` : ''),
        data: summary,
      });
    } catch (err) {
      ControllerLogger.logError('Product Excel upload', err, req, res);
      next(err);
    }
  }
  @httpGet('/export/excel')
  public async exportProductsExcel(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { search, sort } = req.query;

      // Same options the list endpoint builds, minus page/limit — an export
      // covers the whole filtered set, not one page of it.
      const queryOptions: PaginationOptions = {
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      const file = await this.productService.exportToExcel(queryOptions);

      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Product Excel export ready (${file.rowCount} products)`,
            userId,
          );
        }
      } catch (notifError) {
        logger.warn('Could not create product export notification', {
          error: notifError,
        });
      }

      ControllerLogger.logList('Product Excel Export', req, res);

      return res.status(200).json({
        status: 'success',
        message: `${file.rowCount} product(s) exported successfully`,
        data: {
          downloadUrl: file.downloadUrl,
          fileName: file.fileName,
          totalRecords: file.rowCount,
        },
      });
    } catch (error) {
      ControllerLogger.logError('Product Excel export', error, req, res);
      next(error);
    }
  }

  @httpGet('/download/template')
  public async downloadExcelTemplate(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      // Generated from the same column map the importer reads, so the template
      // can never drift out of sync with what the upload endpoint accepts.
      const file = await this.productService.buildExcelTemplate();
console.log("in controller");
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Product template "${file.fileName}" generated`,
            userId,
          );
        }
      } catch (notifError) {
        logger.warn('Could not create product template notification', {
          error: notifError,
        });
      }

      ControllerLogger.logList('Product Template Generated', req, res);

      res.status(200).json({
        status: 'success',
        message: 'Template URL generated successfully',
        data: {
          downloadUrl: file.downloadUrl,
          fileName: file.fileName,
        },
      });
    } catch (error) {
      ControllerLogger.logError('Generate product Template URL', error, req, res);
      next(error);
    }
  }

  @httpDelete('/:id')
  public async delete(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      logger.info(`Deleting product with ID: ${id}`);
      const success = await this.productService.delete(id);
      if (!success) {
        logger.warn(`Product with ID: ${id} not found`);
        ControllerLogger.logError('Product deletion', new AppError(404, 'Product not found'), req, res);
        return next(new AppError(404, 'Product not found'));
      }
      logger.info(`Product with ID: ${id} deleted successfully`);
      ControllerLogger.logSuccess('Product deleted', id, req, res);

      // Send notification for product deletion
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Product deleted successfully`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: 'success',
        message: 'Product deleted successfully',
      });
    } catch (err) {
      logger.error(`Error deleting product with ID: ${id}`, { error: err });
      ControllerLogger.logError('Product deletion', err, req, res);
      next(err);
    }
  }

  

  
 
}


function jsonStringify(data: any): string {
  try {
    return JSON.stringify(data);
  } catch (error) {
    logger.error('Error stringifying data', { error });
    throw new Error('Failed to stringify data');
  }

}


  // @httpPost("/uploadcsv",upload.single('file'))
  // public async postallproduct(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ){
  //   try{
  //     const file=req.file?.path
  //     if (!file) {
  //       return next(new AppError(400, "File path is required"));
  //     }
  //     const success = await this.productService.uploadProducts(file);
  //   }catch{

  //   }
  // }


// @httpPatch('/:id', uploadFile.single('image'), captureUser)
  // public async update(
  //   @requestParam('id') id: string,
  //   @requestBody() productData: any,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     //console.log(productData);
  //     if (req.file) {
  //       const imageUrl = req.file.path;
  //       productData.image = imageUrl;
  //     }
  //     const updatedData = {
  //       ...productData,
  //       //   qualityParameters: Array.isArray(productData.qualityParameters)
  //       // ? productData.qualityParameters
  //       // : JSON.parse(productData.qualityParameters), // Convert back to array
  //     };

  //     logger.info(`Updating product with ID`);
  //     const updatedBy = res.locals.updatedBy;
  //     const product = await this.productService.update(
  //       id,
  //       updatedData,
  //       updatedBy,
  //     );
  //     if (!product) {
  //       logger.warn(`Product with ID not found or update failed`);
  //       return next(new AppError(404, 'Product not found or update failed'));
  //     }
  //     res.status(200).json({
  //       status: 'success',
  //       message: 'Product updated successfully',
  //       data: product,
  //     });
  //   } catch (err) {
  //     logger.error(`Error updating product with ID: ${id}`, { error: err });
  //     console.log(err);
  //     next(err);
  //   }
  // }

