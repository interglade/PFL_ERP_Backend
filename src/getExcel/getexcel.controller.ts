import {
  controller,
  httpGet,
  next,
  request,
  response,
} from 'inversify-express-utils';
import { deserializeUser, requireUser } from '../middleware/deserializeUser';
import { inject } from 'inversify';
import { PdfGeneratorService } from '../utils/pdfGenerator';
import { TYPES } from '../types';
import { NextFunction, Request, Response } from 'express';

@controller('/excel')
export class ExcelController {
  constructor(
    @inject(TYPES.PdfGeneratorService)
    private readonly pdfGeneratorService: PdfGeneratorService,
  ) {}

  @httpGet('/download/product/template')
  public async downloadExcelTemplate(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    const key = 'formats/Product_Template.xlsx';
    //const bucket = process.env.AWS_S3_BUCKET!;

    const fileBuffer = await this.pdfGeneratorService.getExcelFromS3(key);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${key.split('/').pop()}"`,
    );
    res.send(fileBuffer);
  }
  @httpGet('/download/farmer/template')
  public async downloadFarmerExcelTemplate(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    const key = 'formats/FarmerDetailsTemplate.xlsx';
    //const bucket = process.env.AWS_S3_BUCKET!;

    const fileBuffer = await this.pdfGeneratorService.getExcelFromS3(key);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${key.split('/').pop()}"`,
    );
    res.send(fileBuffer);
  }
  @httpGet('/download/vendor/template')
  public async downloadVendorExcelTemplate(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    const key = 'formats/Vendor_Form.xlsx';
    //const bucket = process.env.AWS_S3_BUCKET!;

    const fileBuffer = await this.pdfGeneratorService.getExcelFromS3(key);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${key.split('/').pop()}"`,
    );
    res.send(fileBuffer);
  }

  @httpGet('/download/employee/template')
  public async downloadEmployeeExcelTemplate(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    const key = 'formats/EmployeeData.xlsx';
    //const bucket = process.env.AWS_S3_BUCKET!;

    const fileBuffer = await this.pdfGeneratorService.getExcelFromS3(key);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${key.split('/').pop()}"`,
    );
    res.send(fileBuffer);
  }

  @httpGet('/download/customer/template')
  public async downloadCustomerExcelTemplate(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    const key = 'formats/CustomerData.xlsx';
    //const bucket = process.env.AWS_S3_BUCKET!;

    const fileBuffer = await this.pdfGeneratorService.getExcelFromS3(key);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${key.split('/').pop()}"`,
    );
    res.send(fileBuffer);
  }
}
