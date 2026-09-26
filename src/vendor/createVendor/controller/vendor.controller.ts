import { Request, Response, NextFunction } from "express";

import {
  controller,
  httpGet,
  httpPost,
  httpDelete,
  request,
  response,
  requestParam,
  next,
  httpPatch,
  httpPut,
} from "inversify-express-utils";
import { inject } from "inversify";


import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { deserializeUser, requireUser } from "../../../middleware/deserializeUser";
import { TYPES } from "../../../types";
import { VendorService } from "../service/vendor.service";
import { NotificationService } from "../../../notification/service/notification.service";
import { Role } from "../../../employee/entity/user.entity";
import AppError from "../../../utils/appError";
import { ControllerLogger } from "../../../utils/controllerLogger";
import { PaginationOptions } from "../../../utils/pagination";
import { upload } from "../../../middleware/upload.middleware";
import { CreateVendorDto, UpdateVendorDto } from "../dto/vendor.dto";
import { uploadSingle } from "../../../middleware/uploadsingle.middleware";
import { Status } from "../../../utils/status.enum";
import { s3 } from "../../../middleware/spaces.config";



@controller("/vendors", deserializeUser, requireUser)
export class VendorController {
  constructor(
    @inject(TYPES.VendorService)
    private vendorService: VendorService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService
  ) {}

  @httpGet("/:id")
  public async getVendorById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const vendor = await this.vendorService.getVendorById(id);
      if (!vendor) {
        return next(new AppError(404, "Vendor not found"));
      }
      ControllerLogger.logView('Vendor', id, req, res);

      // Send notification for vendor view
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Vendor viewed: ${id}`,
      //     userId
      //   );
      // }

      res.status(200).json({
        status: "success",
        data: vendor,
      });
    } catch (error) {
      ControllerLogger.logError('Vendor view', error, req, res);
      next(error);
    }
  }
  @httpGet("/view/:id")
  public async getVendorByIdforview(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const vendor = await this.vendorService.getVendorByIdforview(id);
      if (!vendor) {
        return next(new AppError(404, "Vendor not found"));
      }
      ControllerLogger.logView('Vendor', id, req, res);
      res.status(200).json({
        status: "success",
        data: vendor,
      });
    } catch (error) {
      ControllerLogger.logError('Vendor view', error, req, res);
      next(error);
    }
  }

  @httpGet("/update/:id")
  public async getVendorByIdforupdate(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const vendor = await this.vendorService.getVendorByIdforupdate(id);
      if (!vendor) {
        return next(new AppError(404, "Vendor not found"));
      }
      ControllerLogger.logView('Vendor (for update)', id, req, res);
      res.status(200).json({
        status: "success",
        data: vendor,
      });
    } catch (error) {
      ControllerLogger.logError('Vendor update view', error, req, res);
      next(error);
    }
  }





  @httpGet("/")
public async getAllVendors(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const { page, limit, search, sort} = req.query;
            
        const userId=res.locals.user.id;
              const queryOptions: PaginationOptions = {
                page: page ? Number(page) : undefined,  
                limit: limit ? Number(limit) : undefined,
               // searchFields: ['vendor.companyName'],
                filters: {},
                sort: sort as string || undefined, 
                search: search as string|| '',
              };
    //const subcategoryId = req.query.search as string; // Extract subcategoryId from query
    const vendors = await this.vendorService.getAllVendors1(queryOptions,userId); // Correct method name

    // Send notification for vendor list access
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     'Vendor records list accessed successfully',
    //     userId
    //   );
    // }

    ControllerLogger.logList('Vendor', req, res);
    res.status(200).json({
      status: "success",
      data: vendors.data,
      allRecords: vendors.meta.total,
      totalPages: vendors.meta.pages,
      page: vendors.meta.page,
    });
  } catch (error) {
    next(error);
  }
}

@httpGet("/filterVendor/all")
  public async getAllVendor(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {

       const { page, limit, search, sort} = req.query;
          
                const queryOptions: PaginationOptions = {
                page: page ? Number(page) : undefined,  
                limit: limit ? Number(limit) : undefined,
                //searchFields: ['companyName'],
                filters: {},
                sort: sort as string || undefined, 
                search: search as string|| '',
              };

      const vendors = await this.vendorService.getAllVendorsbyfilter(queryOptions);
      res.status(200).json({
        status: "success",
        data: vendors.data,
        meta:vendors.meta
      });
    } catch (error) {
      next(error);
    }
  }
@httpGet("/bysearch/getvendors")
public async getAllVendorsWithselectedSub(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {
    const subcategoryId = req.query.search as string; // Extract subcategoryId from query
    const vendors = await this.vendorService.getAllVendor(subcategoryId); // Correct method name
    res.status(200).json({
      status: "success",
      data: vendors,
    });
  } catch (error) {
    next(error);
  }
}



  


  @httpPost(
    "/",
    upload.fields([
      { name: "gstnCopy", maxCount: 1 },
      { name: "panCardCopy", maxCount: 1 },
      { name: "msmeCopy", maxCount: 1 },
      { name: "cancelledChequeCopy", maxCount: 1 },
    ])
  )

  //TODO: Create vendor
  public async createVendor(
    @request() req: Request<{}, {}, CreateVendorDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      
      const vendorData: CreateVendorDto & Record<string, any> = req.body;
      vendorData.createdBy = res.locals.user.id;
      vendorData.registeredDate = new Date();

      // Parse all JSON string fields (sent as strings in multipart/form-data)
      const jsonFields = [
        'officeAddress', 'ref1Address', 'ref2Address',
        'vendorSaleInfo', 'vendorBankDetails',
        'mainProduct', 'listOfAllProducts',
        'mainPackingMaterial', 'listOfPackingMaterial',
        'subcategory', 'category',
      ];
      for (const field of jsonFields) {
        if (vendorData[field] && typeof vendorData[field] === 'string') {
          try {
            vendorData[field] = JSON.parse(vendorData[field]);
          } catch {
            // not JSON, leave as-is
          }
        }
      }
     

      const files = req.files as {
        gstnCopy?: Express.Multer.File[];
        panCardCopy?: Express.Multer.File[];
        msmeCopy?: Express.Multer.File[];
        cancelledChequeCopy?: Express.Multer.File[];
      };

     
    if (files.gstnCopy) vendorData.gstnCopy = (files.gstnCopy[0] as any).location;
    if (files.panCardCopy) vendorData.panCardCopy = (files.panCardCopy[0] as any).location;
    if (files.msmeCopy) vendorData.msmeCopy = (files.msmeCopy[0] as any).location;
    //if (files.cancelledChequeCopy) vendorData.bankDetailsVend.cancelledChequeCopy = files.cancelledChequeCopy[0].path;

    

  if (files.cancelledChequeCopy) {
    if (!vendorData.vendorBankDetails) vendorData.vendorBankDetails = {};
    (vendorData.vendorBankDetails as Record<string, any>).cancelledChequeCopy = (files.cancelledChequeCopy[0] as any).location;
  }
    if (vendorData.dateOfIncorporation === 'null' || vendorData.dateOfIncorporation === '') {
      vendorData.dateOfIncorporation = null;
    }
      const newVendor = await this.vendorService.createVendor(vendorData);
      if( !newVendor){
        return next(new AppError(400, "Vendor not created"));
      }
      
      ControllerLogger.logSuccess('Vendor created', newVendor.id, req, res);

      console.log("......................................................")
      console.log("new cendor............",newVendor);
      console.log("......................................................")

      res.status(201).json({
        status: "success",
        data: newVendor.id,
        message: "Vendor created successfully",
      });
    } catch (err) {
      ControllerLogger.logError('Vendor creation', err, req, res);
      next(err);
    }
  }
@httpPost("/upload-vendor", uploadSingle.single("file"))
  public async uploadVendorExcel(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      if (!req.file) {
        ControllerLogger.logValidationError('Vendor Excel upload', 'No file uploaded', req, res);
        return next(new AppError(400, "No file uploaded"));
      }

      const filePath = (req.file as any).location;

      const userId = res.locals.user?.id;
      if (!userId) {
        return next(new AppError(401, 'User not authenticated'));
      }

      // Every imported vendor is owned by whoever ran the import - the sheet
      // has no say in it.
      const summary = await this.vendorService.createVendorWithExcel(filePath, userId);
      
      // 🔔 Send notification for vendor Excel upload
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Vendor Excel imported: ${summary.created} created, ` +
              `${summary.skipped.length} skipped, ${summary.failed.length} failed`,
            userId
          );
        }
      } catch (notifError) {
      }
      
      ControllerLogger.logSuccess('Vendor Excel uploaded', 'bulk', req, res);
      res.status(200).json({
        status: "success",
        message:
          `${summary.created} vendor(s) imported` +
          (summary.skipped.length ? `, ${summary.skipped.length} skipped` : '') +
          (summary.failed.length ? `, ${summary.failed.length} failed` : ''),
        data: summary,
      });
    } catch (error) {
      ControllerLogger.logError('Vendor Excel upload', error, req, res);
      next(error);
    }
  }
  
  @httpPut("/:id",
      upload.fields([
      { name: "gstnCopy", maxCount: 1 },
      { name: "panCardCopy", maxCount: 1 },
      { name: "msmeCopy", maxCount: 1 },
      { name: "cancelledChequeCopy", maxCount: 1 },
    ])
  )
  public async updateVendor(
    @requestParam("id") id: string,
    @request() req: Request<{}, {}, UpdateVendorDto>,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const updateBy = res.locals.user.id;

      const vendorUpdateData: UpdateVendorDto & Record<string, any> = { ...req.body };

      // Parse JSON strings for nested objects (sent as strings in multipart/form-data)
      const jsonFields = [
        'officeAddress', 'ref1Address', 'ref2Address',
        'vendorSaleInfo', 'vendorBankDetails',
        'mainProduct', 'listOfAllProducts',
        'mainPackingMaterial', 'listOfPackingMaterial',
        'subcategory', 'category',
      ];
      for (const field of jsonFields) {
        if (vendorUpdateData[field] && typeof vendorUpdateData[field] === 'string') {
          try {
            vendorUpdateData[field] = JSON.parse(vendorUpdateData[field]);
          } catch {
            // not JSON, leave as-is
          }
        }
      }
      
      if(req.files){
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      vendorUpdateData.gstnCopy = files.gstnCopy ? (files.gstnCopy[0] as any).location : vendorUpdateData.gstnCopy;
      vendorUpdateData.panCardCopy = files.panCardCopy ? (files.panCardCopy[0] as any).location : vendorUpdateData.panCardCopy;
      vendorUpdateData.msmeCopy = files.msmeCopy ? (files.msmeCopy[0] as any).location : vendorUpdateData.msmeCopy;
      if (files.cancelledChequeCopy) {
        vendorUpdateData.vendorBankDetails = {
          ...(vendorUpdateData.vendorBankDetails || {}),
          cancelledChequeCopy: (files.cancelledChequeCopy[0] as any).location,
        };
      }
      }
      
      
      const updatedVendor = await this.vendorService.updateVendor(
        id,
        vendorUpdateData,
        updateBy
      );
      if (!updatedVendor) {
        return next(new AppError(404, "Vendor not found or update failed"));
      }
      ControllerLogger.logSuccess('Vendor updated', id, req, res);
      res.status(200).json({
        status: "success",
        message: "Vendor updated successfully",
        data: updatedVendor, // Return updated vendor data
      });
    } catch (error) {
      ControllerLogger.logError('Vendor update', error, req, res);
      next(error);
    }
  }
  /**
   * PATCH /vendors/submit/:id
   * Submits the vendor (sets status to "pending"). Frontend calls this when user clicks "Create".
   * - req.files madhe file asel → S3 var juna delete, nava upload
   * - req.body madhe URL string asel → existing URL tashi rahu de
   */
  @httpPatch('/submit/:id',
    upload.fields([
      { name: 'gstnCopy', maxCount: 1 },
      { name: 'panCardCopy', maxCount: 1 },
      { name: 'msmeCopy', maxCount: 1 },
      { name: 'cancelledChequeCopy', maxCount: 1 },
    ]),
  )
  public async submitVendor(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const files = req.files as { [fieldname: string]: any[] } | undefined;
      const body = req.body;

      const fileUpdates: Record<string, string | null> = {};

      const handleField = async (fieldName: string) => {
        if (files?.[fieldName]?.[0]) {
          const oldUrl = body[fieldName];
          if (oldUrl && typeof oldUrl === 'string' && oldUrl.startsWith('http')) {
            try {
              const key = new URL(oldUrl).pathname.replace(/^\//, '');
              await s3.send(new DeleteObjectCommand({ Bucket: process.env.DO_SPACES_BUCKET!, Key: key }));
            } catch (e) {
              console.warn(`Could not delete old ${fieldName} from S3:`, e);
            }
          }
          fileUpdates[fieldName] = files[fieldName][0].location;
        } else if (body[fieldName] && typeof body[fieldName] === 'string') {
          fileUpdates[fieldName] = body[fieldName];
        }
      };

      await handleField('gstnCopy');
      await handleField('panCardCopy');
      await handleField('msmeCopy');
      await handleField('cancelledChequeCopy');

      // body मधली बाकी vendor info pass करा
      const vendorData = { ...body };
      // file fields काढा
      delete vendorData.gstnCopy;
      delete vendorData.panCardCopy;
      delete vendorData.msmeCopy;
      delete vendorData.cancelledChequeCopy;

      // JSON strings parse करा (multipart madhe strings astat)
      const jsonFields = [
        'officeAddress', 'ref1Address', 'ref2Address',
        'vendorSaleInfo', 'vendorBankDetails',
        'mainProduct', 'listOfAllProducts',
        'mainPackingMaterial', 'listOfPackingMaterial',
        'subcategory', 'category',
      ];
      for (const field of jsonFields) {
        if (vendorData[field] && typeof vendorData[field] === 'string') {
          try { vendorData[field] = JSON.parse(vendorData[field]); } catch { /* leave as-is */ }
        }
      }

      const vendor = await this.vendorService.submitVendor(id, fileUpdates, vendorData, res.locals.user.id);
      ControllerLogger.logSuccess('Vendor submitted', id, req, res);
      return res.status(200).json({
        status: 'success',
        message: 'Vendor submitted successfully',
        data: { id: vendor.id, status: vendor.status },
      });
    } catch (err) {
      ControllerLogger.logError('Submit Vendor', err, req, res);
      next(err);
    }
  }

  @httpPatch("/approve/:id")
  async approveVendor(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const vendorId = req.params.id;
      const adminUser = res.locals.user.id;
      const status = req.query.status as Status;

      const approvedVendor = await this.vendorService.approveVendor(vendorId, adminUser, status);
      ControllerLogger.logSuccess('Vendor approved', vendorId, req, res);
      return res.status(200).json({ message: "Vendor approved successfully", vendor: approvedVendor });
    } catch (error: any) {
      next(error);
    }
  }

  @httpDelete("/:id")
  public async deleteVendor(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      if (!id) {
        return next(new AppError(400, "Vendor ID is required"));
      }
      const result = await this.vendorService.deleteVendor(id);
      if (!result) {
        return next(new AppError(404, "Vendor not found or could not be deleted"));
      }
      ControllerLogger.logSuccess('Vendor deleted', id, req, res);
      res.status(200).json({
        status: "success",
        message: "Vendor deleted successfully",
      });
    } catch (error) {
      ControllerLogger.logError('Vendor deletion', error, req, res);
      next(error);
    }
  }

 
  @httpGet("/filterData/:id")
  public async getFilterVendorById(
    @requestParam("id") id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const vendor = await this.vendorService.getVendorByIdWithFilter(id);
      if (!vendor) {
        return next(new AppError(404, "Vendor not found"));
      }
      ControllerLogger.logView('Vendor filter', id, req, res);
      res.status(200).json({
        status: "success",
        data: vendor,
      });
    } catch (error) {
      ControllerLogger.logError('Vendor filter view', error, req, res);
      next(error);
    }
  }

  @httpGet("/filterVendor/withfilter")
  public async getpartialVendor(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const filter = req.query.search as string;
      const vendors = await this.vendorService.getAllVendorsbyquery(filter);
      ControllerLogger.logList('Vendor partial', req, res);
      res.status(200).json({
        status: "success",
        data: vendors,
      });
    } catch (error) {
      ControllerLogger.logError('Vendor partial list', error, req, res);
      next(error);
    }
  }




  @httpGet('/export/excel')
  public async exportVendorsExcel(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const userId = res.locals.user?.id;
      if (!userId) {
        return next(new AppError(401, 'User not authenticated'));
      }

      const { search, sort } = req.query;

      // Same options the list endpoint builds, minus page/limit - an export
      // covers the whole filtered set, not one page of it.
      const queryOptions: PaginationOptions = {
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      const file = await this.vendorService.exportToExcel(queryOptions, userId);

      try {
        await this.notificationService.createNoti(
          `Vendor Excel export ready (${file.rowCount} vendors)`,
          userId,
        );
      } catch (notifError) {
        // A failed notification must not fail the export.
      }

      ControllerLogger.logList('Vendor Excel Export', req, res);

      return res.status(200).json({
        status: 'success',
        message: `${file.rowCount} vendor(s) exported successfully`,
        data: {
          downloadUrl: file.downloadUrl,
          fileName: file.fileName,
          totalRecords: file.rowCount,
        },
      });
    } catch (error) {
      ControllerLogger.logError('Vendor Excel export', error, req, res);
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
      const file = await this.vendorService.buildExcelTemplate();

      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Vendor template "${file.fileName}" generated`,
            userId,
          );
        }
      } catch (notifError) {
        // A failed notification must not fail the download.
      }

      ControllerLogger.logList('Vendor Template Generated', req, res);

      res.status(200).json({
        status: 'success',
        message: 'Template URL generated successfully',
        data: {
          downloadUrl: file.downloadUrl,
          fileName: file.fileName,
        },
      });
    } catch (error) {
      ControllerLogger.logError('Generate Vendor Template URL', error, req, res);
      next(error);
    }
  }

 @httpDelete("/delete/multiple")
public async softDeleteMultipleVendors(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {

    const  {  ids } = req.body;
    const vendorIds  =  ids;
   

    if (!Array.isArray(vendorIds) || vendorIds.length === 0) {
      ControllerLogger.logError(
        "Vendor bulk deletion",
        new AppError(400, "vendorIds must be a non-empty array"),
        req,
        res
      );
      return next(new AppError(400, "vendorIds must be a non-empty array"));
    }

    const result = await this.vendorService.softDeleteVendors(vendorIds);

    ControllerLogger.logSuccess(
      "Vendor bulk soft deleted",
      vendorIds.join(","),
      req,
      res
    );

    // Send notification
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     `Multiple vendor soft deleted: ${vendorIds.length}`,
    //     userId
    //   );
    // }

    return res.status(200).json({
      status: "success",
      message: "Vendor soft deleted successfully",
      affected: result.affected,
    });

  } catch (err) {
    ControllerLogger.logError("Vendor bulk deletion", err, req, res);
    next(err);
  }
}
}


//   @httpGet("/filter/vendors")
// public async filterVendors(req: Request, res: Response, next: NextFunction) {
//     try {

//       const {
//         classification,
//         category,
//         subcategory,
//         pincode,
//         city,
//         state,
//         product,
//         page,
//         limit,
//       } = req.query;

//       const filters: VendorFilterDto = {
//         classification: classification as string,
//         categoryId: category as string,
//         subcategoryId: subcategory as string,
//         pincode: pincode as string,
//         city: city as string,
//         state: state as string,
//         productId: product as string,
//         page: page ? Number(page) : 1,
//         limit: limit ? Number(limit) : 10,
//       };

//       const vendors = await this.vendorService.filterVendors(filters);
//       if(!vendors){
//         return next(new AppError(404, "No vendors found with the given filters"));
//       }

//       return res.status(200).json({
       
//         status: "success",
//       data:vendors.data,
//       allRecords: vendors.pagination?.total,
//       totalPages: vendors.pagination?.totalPages,
//       page: vendors.pagination?.page,
//       });
//     } catch (error) {
//       console.error('Error filtering vendors:', error);
//       return next(error);
//     }
//   }


// @httpGet("/byquery/getvendor")
// public async getVendorsWithId(
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction
// ) {
//   try {
//     const id = req.query.search as string; // Extract subcategoryId from query
//     const vendors = await this.vendorService.getvendorwithid(id); // Correct method name
//     res.status(200).json({
//       status: "success",
//       data: vendors,
//     });
//   } catch (error) {
//     next(error);
//   }
// }


  // @httpGet("/vendorname/:companyName")
  // public async getVendorBycompanyName(
  //   @requestParam("companyName") companyName: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const vendor = await this.vendorService.getVendorByVendorName(companyName);
  //     ControllerLogger.logView('Vendor by name', companyName, req, res);
  //     res.status(200).json({
  //       status: "success",
  //       data: vendor,
  //     });
  //   } catch (error) {
  //     ControllerLogger.logError('Vendor by name', error, req, res);
  //     next(error);
  //   }
  // }


  // @httpGet("/vendorcode/:vendorCode")
  // public async getVendorByVendorCode(
  //   @requestParam("vendorCode") vendorCode: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const vendor = await this.vendorService.getVendorByVendorCode(vendorCode);
  //     ControllerLogger.logView('Vendor by code', vendorCode, req, res);
  //     res.status(200).json({
  //       status: "success",
  //       data: vendor,
  //     });
  //   } catch (error) {
  //     ControllerLogger.logError('Vendor by code', error, req, res);
  //     next(error);
  //   }
  // }


