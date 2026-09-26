import { controller, httpPost, httpGet, httpPatch, httpDelete, requestParam, requestBody, request, response, next } from 'inversify-express-utils';
import { Request, Response, NextFunction } from 'express';
import { inject } from 'inversify';
import { DriversService } from '../service/driver.service';
import { Drivers } from '../entity/driver.entity';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';

import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { NotificationService } from '../../notification/service/notification.service';
;

@controller('/drivers',deserializeUser,requireUser)
export class DriverController {
  constructor(
    @inject(TYPES.DriversService)
    private driversService: DriversService,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
  ) {}

  @httpGet('/')
  public async getDrivers(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      const driver = await this.driversService.getAllDrivers();
      if (!driver) {
        return next(new AppError(404, 'Driver not found'));
      }
      
      // 🔔 Send notification for get all drivers
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Retrieved ${driver.length} drivers`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Get all drivers notification error:', notifError);
      // }
      
      res.status(200).json({
        status: 'success',
        data: driver,
      });
    } catch (error) {
      next(error);
    }
  }

  @httpPost('/')
  public async createDriver(
    @requestBody() driverData: Partial<Drivers>,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      const driver = await this.driversService.createDriver(driverData);
      
      // 🔔 Send notification for driver creation
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          const driverName = driverData.firstName|| 'New Driver';
          await this.notificationService.createNoti(
            `Driver "${driverName}" created successfully`,
            userId
          );
        }
      } catch (notifError) {
      }
      
      res.status(201).json({
        status: 'success',
        message: 'Driver created successfully',
        // data: driver,
      });
    } catch (error) {
      next(error);
    }
  }

  @httpGet('/:id')
  public async getDriver(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      const driver = await this.driversService.findDriverById(id);
      if (!driver) {
        return next(new AppError(404, 'Driver not found'));
      }
      
      // 🔔 Send notification for driver view
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Viewed driver "${driver.firstName}" details`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Driver view notification error:', notifError);
      // }
      
      res.status(200).json({
        status: 'success',
        data: driver,
      });
    } catch (error) {
      next(error);
    }
  }

  @httpPatch('/:id')
  public async updateDriver(
    @requestParam('id') id: string,
    @request() req: Request<{}, {}, any>,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      const driverData = req.body;
      const parsedData = driverData;
      const updatedBy = res.locals.user?.id

      const updatedDriver = await this.driversService.updateDriver(id, parsedData,updatedBy);
      if (!updatedDriver) {
        return next(new AppError(404, 'Driver not found or update failed'));
      }
      
      // 🔔 Send notification for driver update
      try {
        const userId = res.locals.user?.id;
        if (userId) {
          const driverName = parsedData.firstName || updatedDriver.firstName|| 'Driver';
          await this.notificationService.createNoti(
            `Driver "${driverName}" updated successfully`,
            userId
          );
        }
      } catch (notifError) {
      }
      
      res.status(200).json({
        status: 'success',
        message: 'Driver updated successfully',
        // data: updatedDriver,
      });
    } catch (error) {
      next(error);
    }
  }

  @httpDelete('/:id')
  public async deleteDriver(
    @requestParam('id') id: string,
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ): Promise<void> {
    try {
      const driver = await this.driversService.findDriverById(id);
      if (!driver) {
        return next(new AppError(404, 'Driver not found'));
      }

      await this.driversService.deleteDriver(id);
      
      // 🔔 Send notification for driver deletion
      // try {
      //   const userId = res.locals.user?.id;
      //   if (userId) {
      //     await this.notificationService.createNoti(
      //       `Driver "${driver.firstName}" deleted successfully`,
      //       userId
      //     );
      //   }
      // } catch (notifError) {
      //   console.log('Driver deletion notification error:', notifError);
      // }
      
      res.status(200).json({
        status: 'success',
        message: 'Driver deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}
