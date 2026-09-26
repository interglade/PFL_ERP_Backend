import { inject } from 'inversify';

import {
  controller,
  httpGet,
  next,
  request,
  response,
} from 'inversify-express-utils';

import { NextFunction, Request, Response } from 'express';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { TYPES } from '../../types';
import { AdminDashboardService } from '../service/adminDashboardService.service';
import logger from '../../utils/logger';


@controller('/admin/dashboard', deserializeUser, requireUser)
export class AdminDashboardController {
  constructor(
    @inject(TYPES.AdminDashboardService)
    private readonly adminDashboardService: AdminDashboardService,
  ) {}

  //TODO:By Vaishali....Get Total Count Of Employee
  @httpGet('/employee/total-count')
  async getTotalEmployeeCount(req: Request, res: Response) {
    try {
      const totalCount =
        await this.adminDashboardService.getTotalEmployeeCount();
      return res.status(200).json({ TotalEmployees: totalCount });
    } catch (error) {
      console.error('Error fetching total employee count:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  //TODO:By Vaishali..Get Total count Of Product
  @httpGet('/product/total-count')
  async getAllProductStats(req: Request, res: Response, next: NextFunction) {
    try {
      const totalCount = await this.adminDashboardService.getAllProductStats();
      return res.status(200).json(totalCount);
    } catch (error) {
      console.error('Error fetching total product count:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
  //TODO:By Vaishali..Get Total count Of Branches
  @httpGet('/branch/total-count')
  async getAllBranchStats(req: Request, res: Response, next: NextFunction) {
    try {
      const totalCount = await this.adminDashboardService.getAllBranchStats();
      return res.status(200).json(totalCount);
    } catch (error) {
      console.error('Error fetching total branch count:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  //TODO:By Vaishali....Get Total Count Of Farmer

  @httpGet('/farmer/total-count')
  async getTotalFarmerCount(req: Request, res: Response) {
    try {
      const totalCount = await this.adminDashboardService.getTotalFarmerCount();
      return res.status(200).json({ totalFarmers: totalCount });
    } catch (error) {
      console.error('Error fetching total farmers count:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  //TODO:By Vaishali  get Total count of Customer by customerType wise and Customercategory wise

  @httpGet('/customer/total-count')
  public async getCustomerStats(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const stats = await this.adminDashboardService.getCustomerStats();
      return res.status(200).json(stats);
    } catch (error) {
      console.error('Error fetching customer stats:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  //TODo:By Vaishali Get all Vender count and count by vender category wise
  @httpGet('/vender/total-count')
  public async getVendorStats(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const stats = await this.adminDashboardService.getVendorStats();
      return res.status(200).json(stats);
    } catch (error) {
      console.error('Error fetching vendor stats:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
  @httpGet('/top5vendor')
  public async getTop5Vendors(
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const topVendors = await this.adminDashboardService.getTop5Vendors();
      res.status(200).json({ status: 'success', data: topVendors });
    } catch (error) {
      next(error);
    }
  }
@httpGet('/top5farmer')
  public async getTop5Farmers(
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const topFarmers = await this.adminDashboardService.getTop5Farmers();
      res.status(200).json({ status: 'success', data: topFarmers });
    }
    catch (error) {
      next(error);
    }
  }




   @httpGet('/top5/customer')
  public async getTop5CustomersByNetProductWeight(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,)
    {

      //const limit=req.query.limit as number || 5;
      const limit=5;
      try {
        const customers = await this.adminDashboardService.getTop5CustomersByNetProductWeight(limit);
        res.status(200).json({
          status: 'success',
          data: customers,
        });
      } catch (error) {
      logger.error('Error fetching top 5 customers by net product weight', { error: error });
      next(error);
      }
  }

  @httpGet('/active-users')
  public async getActiveUsers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {

      const activeUsers = await this.adminDashboardService.getActiveUsers();
      //console.log("Active Users:", activeUsers);
      if (!activeUsers) {
        return res.status(200).json({ message: 'No active users found' });
      }

      return res.status(200).json({ data: activeUsers });
    } catch (error) {
      console.error('Error fetching active users:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  @httpGet('/sale/top5products')
  public async getTop5ProductsByNetWeight(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,)
    {

      //const limit=req.query.limit as number || 5;
      const limit=5;
      try {
        const customers = await this.adminDashboardService.getTopProductsByWeight(limit);
        res.status(200).json({
          status: 'success',
          data: customers,
        });
      } catch (error) {
      logger.error('Error fetching top 5 customers by net product weight', { error: error });
      next(error);
      }
  }
}


  // @httpGet('/document/total-count/:documentType')
  // public async getDocumentStats(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const documentType = req.params.documentType;
  //     if (!documentType) {
  //       return res.status(400).json({ message: 'Document type is required' });
  //     }
  //     if (
  //       !Object.values(DocumentTypeEnum).includes(
  //         documentType as DocumentTypeEnum,
  //       )
  //     ) {
  //       return res.status(400).json({ message: 'Invalid document type' });
  //     }
  //     const stats = await this.adminDashboardService.getDocumentStats(
  //       documentType as DocumentTypeEnum,
  //     );
  //     return res.status(200).json(stats);
  //   } catch (error) {
  //     console.error('Error fetching document stats:', error);
  //     return res.status(500).json({ message: 'Internal server error' });
  //   }
  // }


  // @httpGet('/registrations')
  // public async registrations(
  //   @request() req: Request,
  //   @response() res: Response,
  // ) {
  //   const { entity, from, to, search, page, limit } = req.query;
  //   if (!entity)
  //     return res
  //       .status(400)
  //       .json({
  //         message: 'entity is required (farmer|vendor|supplier|customer)',
  //       });
  //   const data = await this.adminDashboardService.listRegistrations({
  //     entity: entity as any,
  //     from: from as string,
  //     to: to as string,
  //     search: search as string,
  //     page: Number(page) || 1,
  //     limit: Number(limit) || 20,
  //   });
  //   return res.json(data);
  // }


  // @httpGet('/summary')
  // public async summary(@request() req: Request, @response() res: Response) {
  //   const data = await this.adminDashboardService.getSummary();
  //   return res.json(data);
  // }


  // @httpGet('/purchase/top5product')
  // public async getTop5Products(
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const topProducts = await this.adminDashboardService.getTop5Products();
  //     res.status(200).json({ status: 'success', data: topProducts });
  //   }
  //   catch (error) {
  //     next(error);
  //   }
  // }

