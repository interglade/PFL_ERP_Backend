import { inject } from 'inversify';
import {
  controller,
  httpDelete,
  httpGet,
  httpPatch,
  httpPost,
  httpPut,
  next,
  request,
  requestParam,
  response,
} from 'inversify-express-utils';

import { TYPES } from '../../../types';
import AppError from '../../../utils/appError';
import { NextFunction, Request, Response } from 'express';


import { ControllerLogger } from '../../../utils/controllerLogger';
import { PaginationOptions } from '../../../utils/pagination';

import { Status } from '../../../utils/status.enum';

import { CustomerService } from '../service/customer.service';
import { deserializeUser, requireUser } from '../../../middleware/deserializeUser';
import { NotificationService } from '../../../notification/service/notification.service';
import { Role } from '../../../employee/entity/user.entity';
import { UserActivityLogService } from '../../../employeeActivity/service/userActivityLog.service';
import { handleMulterFields, upload } from '../../../middleware/upload.middleware';
import { CreateCustomerDto } from '../dto/createCustomer.dto';
import { ActivityAction, ActivityModule } from '../../../employeeActivity/entity/userActivityLog.entity';
import { StatutoryDetailsDto } from '../dto/statutoryDetails.dto';
import { BillingDetailsDto } from '../dto/billingDetails.dto';
import { DeliveryDetailsDto } from '../dto/deliveryDetails.dto';
import { PaymentTermsDto } from '../dto/paydetails.dto';
import { KeyMobileNoDto } from '../dto/keyMobileNo.dto';
import { BankDetailsDto } from '../dto/bankDetails.dto';


@controller('/customers', deserializeUser, requireUser)
export class CustomerController {
  constructor(
    @inject(TYPES.CustomerService)
    private customerService: CustomerService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.UserActivityLogService)
    private activityLogService: UserActivityLogService,
  ) {}

  @httpPost(
    '/',
    handleMulterFields([
      { name: 'customerImage', maxCount: 1 },
      { name: 'bankDetails[cancelledChequeCopy]', maxCount: 1 },
      { name: 'bankDetails[bankStatementCopy]', maxCount: 1 },
      { name: 'statutoryDetails[panCopy]', maxCount: 1 },
      { name: 'statutoryDetails[aadharCopy]', maxCount: 1 },
      { name: 'billBookCopy', maxCount: 1 },
      { name: 'statutoryDetails[incorpoCertificateCopy]', maxCount: 1 },
      { name: 'statutoryDetails[regiCertificateCopy]', maxCount: 1 },
      { name: 'billingFormatCopy', maxCount: 1 },
      { name: 'billingAddressProofCopy', maxCount: 1 },
      { name: 'deliveryAddressProofCopy', maxCount: 1 },
      { name: 'docEvidenceCopy', maxCount: 1 },
      { name: 'keyMobileNumbers[mandiLicenceCopy]', maxCount: 1 },
      { name: 'keyMobileNumbers[regiCopy]', maxCount: 1 },
      { name: 'electricityBillCopy', maxCount: 1 },
      { name: 'visitingCardCopy', maxCount: 1 },
      { name: 'lc', maxCount: 1 },
      { name: 'bg', maxCount: 1 },
    ]),
  )
  public async create(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      // Parse the customer data using Zod schema
      

      const files = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };
      const customerData: CreateCustomerDto = req.body;
      console.log('Received customer data:', customerData);
      console.log(typeof customerData.emailPrimary);
      customerData.createdBy = res.locals.user.id;
      // Assign DigitalOcean Spaces URLs to customer data
      if (files.customerImage?.[0])
        customerData.customerImage = (files.customerImage[0] as any).location;
      if (files['bankDetails[cancelledChequeCopy]']?.[0])
        customerData.bankDetails = { ...customerData.bankDetails, cancelledChequeCopy: (files['bankDetails[cancelledChequeCopy]'][0] as any).location };
      if (files['bankDetails[bankStatementCopy]']?.[0])
        customerData.bankDetails = { ...customerData.bankDetails, bankStatementCopy: (files['bankDetails[bankStatementCopy]'][0] as any).location };
      if (files['statutoryDetails[panCopy]']?.[0])
        customerData.statutoryDetails = { ...customerData.statutoryDetails, panCopy: (files['statutoryDetails[panCopy]'][0] as any).location };
      if (files['statutoryDetails[aadharCopy]']?.[0])
        customerData.statutoryDetails = { ...customerData.statutoryDetails, aadharCopy: (files['statutoryDetails[aadharCopy]'][0] as any).location };
      if (files.billBookCopy?.[0])
        customerData.statutoryDetails = { ...customerData.statutoryDetails, billBookCopy: (files.billBookCopy[0] as any).location };
      if (files['statutoryDetails[incorpoCertificateCopy]']?.[0])
        customerData.statutoryDetails = { ...customerData.statutoryDetails, incorpoCertificateCopy: (files['statutoryDetails[incorpoCertificateCopy]'][0] as any).location };
      if (files['statutoryDetails[regiCertificateCopy]']?.[0])
        customerData.statutoryDetails = { ...customerData.statutoryDetails, regiCertificateCopy: (files['statutoryDetails[regiCertificateCopy]'][0] as any).location };
      if (files.billingFormatCopy?.[0])
        customerData.billingDetails = { ...customerData.billingDetails, billingFormatCopy: (files.billingFormatCopy[0] as any).location };
      if (files.billingAddressProofCopy?.[0])
        customerData.billingDetails = { ...customerData.billingDetails, billingAddressProofCopy: (files.billingAddressProofCopy[0] as any).location };
      if (files.deliveryAddressProofCopy?.[0])
        customerData.deliveryDetails = { ...customerData.deliveryDetails, deliveryAddressProofCopy: (files.deliveryAddressProofCopy[0] as any).location };
      if (files.lc?.[0])
        customerData.paymentTerms = { ...customerData.paymentTerms, lc: (files.lc[0] as any).location };
      if (files.bg?.[0])
        customerData.paymentTerms = { ...customerData.paymentTerms, bg: (files.bg[0] as any).location };
      if (files.docEvidenceCopy?.[0])
        customerData.paymentTerms = { ...customerData.paymentTerms, docEvidenceCopy: (files.docEvidenceCopy[0] as any).location };
      if (files['keyMobileNumbers[mandiLicenceCopy]']?.[0])
        customerData.keyMobileNumbers = { ...customerData.keyMobileNumbers, mandiLicenceCopy: (files['keyMobileNumbers[mandiLicenceCopy]'][0] as any).location };
      if (files['keyMobileNumbers[regiCopy]']?.[0])
        customerData.keyMobileNumbers = { ...customerData.keyMobileNumbers, regiCopy: (files['keyMobileNumbers[regiCopy]'][0] as any).location };
      if (files.electricityBillCopy?.[0])
        customerData.keyMobileNumbers = { ...customerData.keyMobileNumbers, electricityBillCopy: (files.electricityBillCopy[0] as any).location };
      if (files.visitingCardCopy?.[0])
        customerData.keyMobileNumbers = { ...customerData.keyMobileNumbers, visitingCardCopy: (files.visitingCardCopy[0] as any).location };

      const customer = await this.customerService.create(customerData);


      if (!customer) {
        ControllerLogger.logOperationFailed('Create', 'Customer', 'could not be created', req, res);
        return res.status(400).json({
          status: 'error',
          message: 'Customer could not be created',
        });
      }
      
      // 📝 Activity log
      // Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = res.locals.user?.roles?.some((role: any) =>
        (role?.name ?? role)?.toLowerCase() === 'admin',
      );
      if (!isAdmin) {
      const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
      this.activityLogService.logActivity({
        userId: res.locals.user.id,
        userName,
        action: ActivityAction.CREATE,
        module: ActivityModule.CUSTOMER,
        entityName: 'Customer',
        entityId: customer.id,
        description: `${userName} created customer "${customer.organisationName}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 201,
      }).catch(() => {});
    }
      
      // Log successful creation
      const customerId = customer?.id || 'unknown';
      ControllerLogger.logSuccess('Customer created', customerId, req, res);
      
      // Create a clean response object without circular references
      const responseData = {
        id: customer.id,
        organisationName: customer.organisationName,
        customerCode: customer.customerCode,
        organisationType: customer.organisationType,
        primaryContactNo: customer.primaryContactNo,
        emailPrimary: customer.emailPrimary,
        status: customer.status,
        createdAt: customer.createdAt,
        message: 'Customer created successfully'
      };
      
      res.status(201).json({
        status: 'success',
        message: 'Customer created successfully',
        data: responseData,
      });
    } catch (err) {
     
      ControllerLogger.logError('Customer creation', err, req, res);
      next(err);
    }
  }

  // @httpGet('/')
  // public async getAllCustomers(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     logger.info('Fetching all customers');
  //     const { page, limit, search, sort, organisationName } = req.query;

  //     const queryOptions: PaginationOptions = {
  //       page: page ? Number(page) : undefined,
  //       limit: limit ? Number(limit) : undefined,
  //       //searchFields: ['cutomer.organisationName'],
  //       filters: {},
  //       sort: (sort as string) || undefined,
  //       search: (search as string) || '',
  //     };
  //     const customers = await this.customerService.findAllCustomers(
  //       queryOptions,
  //     );
  //     logger.info('Customers retrieved successfully', { customers });

  //     res.status(200).json({
  //       status: 'success',
  //       data: customers.data,
  //       allRecords: customers.meta.total,
  //       totalPages: customers.meta.pages,
  //       page: customers.meta.page,
  //     });
  //   } catch (err) {
  //     logger.error('Error fetching customers', { error: err });
  //     next(err);
  //   }
  // }

  /**
   * PATCH /customers/submit/:id
   * Submits the customer (sets status to "pending"). Frontend calls this when user clicks "Create".
   * - req.files madhe file asel → S3 var juna delete, nava upload
   * - req.body madhe URL string asel → existing URL tashi rahu de
   */
  @httpPatch('/submit/:id',
    handleMulterFields([
      { name: 'customerImage', maxCount: 1 },
      { name: 'bankDetails[cancelledChequeCopy]', maxCount: 1 },
      { name: 'bankDetails[bankStatementCopy]', maxCount: 1 },
      { name: 'statutoryDetails[panCopy]', maxCount: 1 },
      { name: 'statutoryDetails[aadharCopy]', maxCount: 1 },
      { name: 'billBookCopy', maxCount: 1 },
      { name: 'statutoryDetails[incorpoCertificateCopy]', maxCount: 1 },
      { name: 'statutoryDetails[regiCertificateCopy]', maxCount: 1 },
      { name: 'billingFormatCopy', maxCount: 1 },
      { name: 'billingAddressProofCopy', maxCount: 1 },
      { name: 'deliveryAddressProofCopy', maxCount: 1 },
      { name: 'docEvidenceCopy', maxCount: 1 },
      { name: 'mandiLicenceCopy', maxCount: 1 },
      { name: 'regiCopy', maxCount: 1 },
      { name: 'electricityBillCopy', maxCount: 1 },
      { name: 'visitingCardCopy', maxCount: 1 },
      { name: 'lc', maxCount: 1 },
      { name: 'bg', maxCount: 1 },
    ]),
  )
  public async submitCustomer(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const files = req.files as { [fieldname: string]: any[] } | undefined;
      const body = req.body;
console.log("submitCustomer body",body);
      const fileUpdates: Record<string, string | null> = {};

      const handleField = async (fieldName: string, bodyPath?: string) => {
        const fileKey = fieldName;
        if (files?.[fileKey]?.[0]) {
          // New file → delete old from S3 if old URL exists
          let oldUrl: string | undefined;
          if (bodyPath) {
            // nested path like "bankDetails.cancelledChequeCopy"
            const parts = bodyPath.split('.');
            oldUrl = parts.reduce((obj: any, key) => obj?.[key], body);
          } else {
            oldUrl = body[fieldName];
          }
          if (oldUrl && typeof oldUrl === 'string' && oldUrl.startsWith('http')) {
            try {
              const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
              const { s3 } = await import('../../../middleware/spaces.config');
              const key = new URL(oldUrl).pathname.replace(/^\//, '');
              await s3.send(new DeleteObjectCommand({ Bucket: process.env.DO_SPACES_BUCKET!, Key: key }));
            } catch (e) {
              console.warn(`Could not delete old ${fieldName} from S3:`, e);
            }
          }
          fileUpdates[fieldName] = files[fileKey][0].location;
        } else {
          // No new file → keep existing URL from body
          let existingUrl: string | undefined;
          if (bodyPath) {
            const parts = bodyPath.split('.');
            existingUrl = parts.reduce((obj: any, key) => obj?.[key], body);
          } else {
            existingUrl = body[fieldName];
          }
          if (existingUrl && typeof existingUrl === 'string') {
            fileUpdates[fieldName] = existingUrl;
          }
        }
      };

      await handleField('customerImage');
      await handleField('bankDetails[cancelledChequeCopy]',        'bankDetails.cancelledChequeCopy');
      await handleField('bankDetails[bankStatementCopy]',          'bankDetails.bankStatementCopy');
      await handleField('statutoryDetails[panCopy]',               'statutoryDetails.panCopy');
      await handleField('statutoryDetails[aadharCopy]',            'statutoryDetails.aadharCopy');
      await handleField('billBookCopy',                            'statutoryDetails.billBookCopy');
      await handleField('statutoryDetails[incorpoCertificateCopy]','statutoryDetails.incorpoCertificateCopy');
      await handleField('statutoryDetails[regiCertificateCopy]',   'statutoryDetails.regiCertificateCopy');
      await handleField('billingFormatCopy',                       'billingDetails.billingFormatCopy');
      await handleField('billingAddressProofCopy',                 'billingDetails.billingAddressProofCopy');
      await handleField('deliveryAddressProofCopy',                'deliveryDetails.deliveryAddressProofCopy');
      await handleField('docEvidenceCopy',                         'paymentTerms.docEvidenceCopy');
      await handleField('mandiLicenceCopy',                        'keyMobileNumbers.mandiLicenceCopy');
      await handleField('regiCopy',                                'keyMobileNumbers.regiCopy');
      await handleField('electricityBillCopy',                     'keyMobileNumbers.electricityBillCopy');
      await handleField('visitingCardCopy',                        'keyMobileNumbers.visitingCardCopy');
      await handleField('lc',                                      'paymentTerms.lc');
      await handleField('bg',                                      'paymentTerms.bg');

      // body मधली बाकी customer info pass करा
      const customerData = { ...body };
      // file fields काढा
      const fileFieldKeys = [
        'customerImage',
        'bankDetails[cancelledChequeCopy]', 'bankDetails[bankStatementCopy]',
        'statutoryDetails[panCopy]', 'statutoryDetails[aadharCopy]', 'billBookCopy',
        'statutoryDetails[incorpoCertificateCopy]', 'statutoryDetails[regiCertificateCopy]',
        'billingFormatCopy', 'billingAddressProofCopy', 'deliveryAddressProofCopy',
        'docEvidenceCopy', 'mandiLicenceCopy', 'regiCopy', 'electricityBillCopy',
        'visitingCardCopy', 'lc', 'bg',
      ];
      for (const key of fileFieldKeys) delete customerData[key];

      const customer = await this.customerService.submitCustomer(id, fileUpdates, customerData, res.locals.user.id);
      ControllerLogger.logSuccess('Customer submitted', id, req, res);
      return res.status(200).json({
        status: 'success',
        message: 'Customer submitted successfully',
        data: { id: customer.id, status: customer.status },
      });
    } catch (err) {
      ControllerLogger.logError('Submit Customer', err, req, res);
      next(err);
    }
  }

@httpPatch("/approve/:id")
async approveCustomer(
  @request() req: Request, 
  @response() res: Response, 
  @next() next: NextFunction
) {
  try {
    const customerId = req.params.id;
    const adminUser = res.locals.user.id;
    const status = req.query.status as Status;

    const approvedCustomer = await this.customerService.approveCustomer(customerId, adminUser, status);

    if (!approvedCustomer) {
      ControllerLogger.logOperationFailed('Approve', 'Customer', 'not found or could not be approved', req, res);
      return res.status(404).json({ message: "Customer not found or could not be approved" });
    }

    // Log successful approval
    ControllerLogger.logSuccess('Customer approved', customerId, req, res);
    return res.status(200).json({ message: "Customer approved successfully", customer: approvedCustomer });
  } catch (error: any) {
    ControllerLogger.logError('Customer approval', error, req, res);
    next(error);
  }
}
  @httpGet('/')
  public async getAllCustomers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      
      const { page, limit, search, sort } = req.query;
      const userId=res.locals.user.id;
      const queryOptions: PaginationOptions = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        searchFields: ['organisationName', 'customerCategory.name', 'customerTypes.name'],
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };
      const customers = await this.customerService.findAllCustomers(
        queryOptions,
        userId
      );
      
      if (!customers || customers.data.length === 0) {
        return res.status(200).json({
          status: 'success',
          data: [],
          allRecords: 0,
          totalPages: 0,
          page: queryOptions.page || 1,
        });
      }

      // 🔔 Send notification for get all customers
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Retrieved ${customers.meta.total} customers`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Get all customers notification error:', notifError);
      // }

      // Log successful retrieval with specific message
      ControllerLogger.logGetAllRecords('Customer', req, res);

      res.status(200).json({
        status: 'success',
        data: customers.data,
        allRecords: customers.meta.total,
        totalPages: customers.meta.pages,
        page: customers.meta.page,
      });
    } catch (err) {
      ControllerLogger.logError('Customer retrieval', err, req, res);
      next(err);
    }
  }


  @httpGet('/names/all')
  public async getAllCustomersNames(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const customers = await this.customerService.getCustomersName();
      
      if (!customers || customers.length === 0) {
        ControllerLogger.logNotFound('Customer', 'names', req, res);
        return res.status(404).json({
          status: 'error',
          message: 'Customer names not found',
        });
      }
      
      // 🔔 Send notification for customer names retrieval
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Retrieved ${customers.length} customer names`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Customer names notification error:', notifError);
      // }
      
      // Log successful retrieval
      ControllerLogger.logGetAllRecords('Customer', req, res);

      res.status(200).json({
        status: 'success',
        data: customers,
      });
    } catch (err) {
      ControllerLogger.logError('Customer names retrieval', err, req, res);
      next(err);
    }
  }

  @httpGet('/partial/all/:id')
  public async getCustomerByIdName(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const customer = await this.customerService.getCustomerFilterById(id);

      if (!customer) {
        ControllerLogger.logNotFound('Customer', id, req, res);
        throw new AppError(404, 'Customer not found');
      }
      
      // // 🔔 Send notification for customer partial view
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     const customerName = customer.customer?.organisationName || 'Customer';
      //     await this.notificationService.createNoti(
      //       `Viewed partial details of "${customerName}"`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Customer partial view notification error:', notifError);
      // }
      
      // Log successful view
      ControllerLogger.logView('Customer', id, req, res);

      res.status(200).json({
        status: 'success',
        data: customer.customer,
      });
    } catch (err) {
      ControllerLogger.logError('Customer partial view', err, req, res);
      next(err);
    }
  }

  @httpGet('/:id')
  public async getCustomerById(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const customer = await this.customerService.findCustomerById(id);

      if (!customer) {
        ControllerLogger.logNotFound('Customer', id, req, res);
        throw new AppError(404, 'Customer not found');
      }
      
      // 🔔 Send notification for customer view
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     const customerName = customer?.organisationName || 'Customer';
      //     await this.notificationService.createNoti(
      //       `Viewed details of "${customerName}"`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Customer view notification error:', notifError);
      // }
      
      // Log successful view
      ControllerLogger.logView('Customer', id, req, res);

      res.status(200).json({
        status: 'success',
        data: customer,
      });
    } catch (err) {
      ControllerLogger.logError('Customer view', err, req, res);
      next(err);
    }
  }


  @httpGet('/view/:id')
  public async getCustomerByIdforview(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const customer = await this.customerService.findCustomerByIdforview(id);

      if (!customer) {
        ControllerLogger.logNotFound('Customer', id, req, res);
        throw new AppError(404, 'Customer not found');
      }
      
      // 🔔 Send notification for customer view
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     const customerName = customer?.organisationName || 'Customer';
      //     await this.notificationService.createNoti(
      //       `Viewed full details of "${customerName}"`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Customer view notification error:', notifError);
      // }
      
      // Log successful view
      ControllerLogger.logView('Customer', id, req, res);

      res.status(200).json({
        status: 'success',
        data: customer,
      });
    } catch (err) {
      ControllerLogger.logError('Customer view', err, req, res);
      next(err);
    }
  }



  @httpGet('/update/:id')
  public async getCustomerByIdforUpdate(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const customer = await this.customerService.findCustomerByIdforupdate(id);

      if (!customer) {
        ControllerLogger.logNotFound('Customer', id, req, res);
        throw new AppError(404, 'Customer not found');
      }
      
      // 🔔 Send notification for customer update view
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     const customerName = customer?.organisationName || 'Customer';
      //     await this.notificationService.createNoti(
      //       `Opened "${customerName}" for editing`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Customer update view notification error:', notifError);
      // }
      
      // Log successful view for update
      ControllerLogger.logView('Customer', id, req, res);

      res.status(200).json({
        status: 'success',
        data: customer,
      });
    } catch (err) {
      ControllerLogger.logError('Customer update view', err, req, res);
      next(err);
    }
  }


  @httpPut(
    '/:id',
  handleMulterFields([
      { name: 'customerImage', maxCount: 1 },
      { name: 'bankDetails[cancelledChequeCopy]', maxCount: 1 },
      { name: 'bankDetails[bankStatementCopy]', maxCount: 1 },
      { name: 'statutoryDetails[panCopy]', maxCount: 1 },
      { name: 'statutoryDetails[aadharCopy]', maxCount: 1 },
      { name: 'billBookCopy', maxCount: 1 },
      { name: 'statutoryDetails[incorpoCertificateCopy]', maxCount: 1 },
      { name: 'statutoryDetails[regiCertificateCopy]', maxCount: 1 },
      { name: 'billingFormatCopy', maxCount: 1 },
      { name: 'billingAddressProofCopy', maxCount: 1 },
      { name: 'deliveryAddressProofCopy', maxCount: 1 },
      { name: 'docEvidenceCopy', maxCount: 1 },
      { name: 'mandiLicenceCopy', maxCount: 1 },
      { name: 'regiCopy', maxCount: 1 },
      { name: 'electricityBillCopy', maxCount: 1 },
      { name: 'visitingCardCopy', maxCount: 1 },
      { name: 'lc', maxCount: 1 },
      { name: 'bg', maxCount: 1 },
    ]),
  )
  public async updateCustomer(
    @request() req: Request, 
    @response() res: Response, 
    @next() next: NextFunction
  ) {
    try {
      
      const { id } = req.params;
      const updatedBy = res.locals.updatedBy;
      const customerData: CreateCustomerDto = req.body;
      console.log("customerData",customerData);
      const files = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };

      customerData.statutoryDetails ??= {} as StatutoryDetailsDto;
customerData.billingDetails ??= {} as BillingDetailsDto;
customerData.deliveryDetails ??= {} as DeliveryDetailsDto;
customerData.paymentTerms ??= {} as PaymentTermsDto;
customerData.keyMobileNumbers ??= {} as KeyMobileNoDto;
customerData.bankDetails ??= {} as BankDetailsDto;
      if (files) {
        // Assign DigitalOcean Spaces URLs to customer data
        if (files.customerImage?.[0]) customerData.customerImage = (files.customerImage[0] as any).location;
        if (files.cancelledChequeCopy?.[0])
          customerData.bankDetails.cancelledChequeCopy =
            (files.cancelledChequeCopy[0] as any).location;
        if (files.bankStatementCopy?.[0])
          customerData.bankDetails.bankStatementCopy =
            (files.bankStatementCopy[0] as any).location;
        if (files.panCopy?.[0])
          customerData.statutoryDetails.panCopy = (files.panCopy[0] as any).location;
        if (files.aadharCopy?.[0])
          customerData.statutoryDetails.aadharCopy =
            (files.aadharCopy[0] as any).location;
        if (files.billBookCopy?.[0])
          customerData.statutoryDetails.billBookCopy =
            (files.billBookCopy[0] as any).location;
        if (files.incorpoCertificateCopy?.[0])
          customerData.statutoryDetails.incorpoCertificateCopy =
            (files.incorpoCertificateCopy[0] as any).location;
        if (files.regiCertificateCopy?.[0])
          customerData.statutoryDetails.regiCertificateCopy =
            (files.regiCertificateCopy[0] as any).location;
        if (files.billingFormatCopy?.[0])
          customerData.billingDetails.billingFormatCopy =
            (files.billingFormatCopy[0] as any).location;
        if (files.billingAddressProofCopy?.[0])
          customerData.billingDetails.billingAddressProofCopy =
            (files.billingAddressProofCopy[0] as any).location;
        if (files.deliveryAddressProofCopy?.[0])
          customerData.deliveryDetails.deliveryAddressProofCopy =
            (files.deliveryAddressProofCopy[0] as any).location;
        if (files.lc?.[0]) customerData.paymentTerms.lc = (files.lc[0] as any).location;
        if (files.bg?.[0]) customerData.paymentTerms.bg = (files.bg[0] as any).location;
        if (files.docEvidenceCopy?.[0])
          customerData.paymentTerms.docEvidenceCopy =
            (files.docEvidenceCopy[0] as any).location;
        if (files.mandiLicenceCopy?.[0])
          customerData.keyMobileNumbers.mandiLicenceCopy =
            (files.mandiLicenceCopy[0] as any).location;
        if (files.regiCopy?.[0])
          customerData.keyMobileNumbers.regiCopy = (files.regiCopy[0] as any).location;
        if (files.electricityBillCopy?.[0])
          customerData.keyMobileNumbers.electricityBillCopy =
            (files.electricityBillCopy[0] as any).location;
        if (files.visitingCardCopy?.[0])
          customerData.keyMobileNumbers.visitingCardCopy =
            (files.visitingCardCopy[0] as any).location;
      }
      const updatedCustomer = await this.customerService.updateCustomer(
        id,
        customerData,
        updatedBy,
      );

      if (!updatedCustomer) {
        ControllerLogger.logOperationFailed('Update', 'Customer', 'not found or could not be updated', req, res);
        return res.status(404).json({ message: 'Customer not found' });
      }
      
      // 🔔 Send notification for customer update
      const userId2 = res.locals.user?.id;
      if (userId2) {
        const customerName = customerData.organisationName || updatedCustomer?.organisationName || 'Customer';
        this.notificationService.createNoti(`Customer "${customerName}" updated successfully`, userId2).catch(() => {});
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
        entityName: 'Customer',
        entityId: id,
        description: `${userName} updated customer "${updatedCustomer?.organisationName || id}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    }
      
      // Log successful update
      ControllerLogger.logSuccess('Customer updated', id, req, res);
      
      return res.status(200).json({
        message: 'Customer updated successfully',
        data: updatedCustomer,
      });
    } catch (error) {
      ControllerLogger.logError('Customer update', error, req, res);
      next(error);
    }
  }

  @httpDelete('/:id')
  public async deleteCustomer(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ): Promise<Response | void> {
    try {
      const { id } = req.params;

      const deletedCustomer = await this.customerService.deleteCustomer(id);
      
      if (!deletedCustomer) {
        ControllerLogger.logOperationFailed('Delete', 'Customer', 'not found or could not be deleted', req, res);
        return res.status(404).json({ message: 'Customer not found' });
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
        entityName: 'Customer',
        entityId: id,
        description: `${userName} deleted customer "${deletedCustomer.organisationName}"`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl,
        httpMethod: req.method,
        statusCode: 200,
      }).catch(() => {});
    }
      
      // Log successful deletion
      ControllerLogger.logSuccess('Customer deleted', id, req, res);
     
      return res.status(200).json({
        message: 'Customer deleted successfully',
      });
    } catch (error) {
      ControllerLogger.logError('Customer deletion', error, req, res);
      next(error);
    }
  }
  @httpPost("/upload/customerdata", upload.single('file'))
    public async uploadFile(@request() req: Request, @response() res: Response, @next() next: NextFunction) {
            if (!req.file) {
                ControllerLogger.logValidationError('Customer file upload', 'No file uploaded', req, res);
                return res.status(400).send("No file uploaded");
            }
            try {
                const userId = res.locals.user?.id;
                if (!userId) {
                    return next(new AppError(401, 'User not authenticated'));
                }

                // Every imported customer is owned by whoever ran the import -
                // the sheet has no say in it.
                const summary = await this.customerService.upload(
                    (req.file as any).location,
                    userId,
                );
                
                // 🔔 Send notification for file upload
                // try {
                //   const userId = res.locals.user?.id;
                //   if (userId) {
                //     await this.notificationService.createNoti(
                //       `Customer data file "${req.file.filename}" uploaded successfully`,
                //       userId
                //     );
                //   }
                // } catch (notifError) {
                //   console.log('Customer file upload notification error:', notifError);
                // }
                
                // Log successful upload
                ControllerLogger.logSuccess('Customer file uploaded', req.file.filename || 'unknown', req, res);
                
                return res.status(200).json({
                    status: 'success',
                    message:
                        `${summary.created} customer(s) imported` +
                        (summary.skipped.length ? `, ${summary.skipped.length} skipped` : '') +
                        (summary.failed.length ? `, ${summary.failed.length} failed` : ''),
                    data: summary,
                });
            } catch (error) {
                ControllerLogger.logError('Customer file upload', error, req, res);
                console.error(error);
                return res.status(500).send("Error uploading file");
            }
        }


  @httpGet('/export/excel')
  public async exportCustomersExcel(
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
        searchFields: [
          'organisationName',
          'customerCategory.name',
          'customerTypes.name',
        ],
        filters: {},
        sort: (sort as string) || undefined,
        search: (search as string) || '',
      };

      const file = await this.customerService.exportToExcel(queryOptions, userId);

      try {
        await this.notificationService.createNoti(
          `Customer Excel export ready (${file.rowCount} customers)`,
          userId,
        );
      } catch (notifError) {
        // A failed notification must not fail the export.
      }

      ControllerLogger.logList('Customer Excel Export', req, res);

      return res.status(200).json({
        status: 'success',
        message: `${file.rowCount} customer(s) exported successfully`,
        data: {
          downloadUrl: file.downloadUrl,
          fileName: file.fileName,
          totalRecords: file.rowCount,
        },
      });
    } catch (error) {
      ControllerLogger.logError('Customer Excel export', error, req, res);
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
      const file = await this.customerService.buildExcelTemplate();

      try {
        const userId = res.locals.user?.id;
        if (userId) {
          await this.notificationService.createNoti(
            `Customer template "${file.fileName}" generated`,
            userId,
          );
        }
      } catch (notifError) {
        // A failed notification must not fail the download.
      }

      ControllerLogger.logList('Customer Template Generated', req, res);

      res.status(200).json({
        status: 'success',
        message: 'Template URL generated successfully',
        data: {
          downloadUrl: file.downloadUrl,
          fileName: file.fileName,
        },
      });
    } catch (error) {
      ControllerLogger.logError('Generate Customer Template URL', error, req, res);
      next(error);
    }
  }

  @httpDelete("/delete/multiple")
public async softDeleteMultipleCustomers(
  @request() req: Request,
  @response() res: Response,
  @next() next: NextFunction
) {
  try {

    const { ids } = req.body;
    console.log('reqboy',ids);
    if (!Array.isArray(ids) || ids.length === 0) {
      ControllerLogger.logError(
        "Customer bulk deletion",
        new AppError(400, "customerIds must be a non-empty array"),
        req,
        res
      );
      return next(new AppError(400, "customerIds must be a non-empty array"));
    }

    const result = await this.customerService.softDeleteCustomers(ids);

    // 📝 Activity log
    // Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = res.locals.user?.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
    const userName = `${res.locals.user.firstName || ''} ${res.locals.user.lastName || ''}`.trim() || res.locals.user.username || 'Unknown User';
    const deletedList = result.deleted.map(c => `"${c.organisationName}"`).join(', ');
    this.activityLogService.logActivity({
      userId: res.locals.user.id,
      userName,
      action: ActivityAction.DELETE,
      module: ActivityModule.CUSTOMER,
      entityName: 'Customer',
      description: `${userName} bulk deleted ${result.deleted.length} customer(s): ${deletedList}`,
      metadata: { ids, count: ids.length },
      ipAddress: req.ip || '',
      userAgent: req.get('user-agent'),
      endpoint: req.originalUrl,
      httpMethod: req.method,
      statusCode: 200,
    }).catch(() => {});
  }

    ControllerLogger.logSuccess(
      "Customer bulk soft deleted",
      ids.join(","),
      req,
      res
    );

    // Send notification
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     `Multiple customers soft deleted: ${customerIds.length}`,
    //     userId
    //   );
    // }

    return res.status(200).json({
      status: "success",
      message: "Customers soft deleted successfully",
      affected: result.affected,
    });

  } catch (err) {
    ControllerLogger.logError("Customer bulk deletion", err, req, res);
    next(err);
  }
}
}
