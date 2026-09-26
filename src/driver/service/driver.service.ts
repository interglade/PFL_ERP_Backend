import { injectable, inject } from 'inversify';

import {  Drivers } from '../entity/driver.entity';
import { DataSource } from 'typeorm';
import { TYPES } from '../../types';

import AppError from '../../utils/appError';
import { DriverRepository } from '../repository/driver.repository';
import { AddressService } from '../../address/service/address.service';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';

@injectable()
export class DriversService {
    private driverRepository: DriverRepository
    private addressService: AddressService;
  
  constructor(@inject(TYPES.DataSource) private dataSource: DataSource,
   @inject(TYPES.AuditLogService)
              private readonly auditLogService: AuditLogService,
  @inject(TYPES.AddressService) addressService: AddressService) {
    this.driverRepository = this.dataSource.getRepository(
      Drivers
    ) as DriverRepository;
    this.addressService = addressService;
  }
  // async createDriver(driverData: Partial<Drivers>): Promise<Drivers> {
  //   const driver = this.driverRepository.create(driverData);
  //   return await this.driverRepository.save(driver);
  // }

  async createDriver(driverData: Partial<Drivers>): Promise<Drivers> {
    //console.log('Driver data received:', driverData);
    const driver = this.driverRepository.create(driverData);

    // Check if address is provided in driverData
    if (driverData.address) {
        // Ensure the address is properly created or updated
        driver.address = driverData.address;
    }

    return await this.driverRepository.save(driver);
}


  // async findDriverById(id: string): Promise<Drivers | null> {
  //   return await this.driverRepository.findOneBy({ id });
  // }
  async findDriverById(id: string): Promise<Drivers | null> {
    return await this.driverRepository.findOne({
        where: { id },
        relations: ['address'], // Load the related Address entity
    });
}


public async updateDriver(
  id: string,
  driversData: any,
  updatedBy: string
): Promise<Drivers | null> {
  const { address, ...rest } = driversData;

  // Fetch the driver record with the address relationship
  const drivers = await this.driverRepository.findOne({
    where: { id },
    relations: ['address']
  });

  if (!drivers) {
    throw new AppError(404, "Driver not found");
  }

  // Save the original data for audit logging
  const oldData = { ...drivers };

  // Handle address update or creation
  if (address) {
    let existingAddress = drivers.address;

    if (!existingAddress) {
      // Create a new address if it does not exist
      existingAddress = await this.addressService.create(address);
    } else {
      // Update existing address with the provided fields
      const updatedAddressData = {
        address1: address.address1 ?? existingAddress.address1,
        address2: address.address2 ?? existingAddress.address2,
        location: address.location ?? existingAddress.location,
        city: address.city ?? existingAddress.city,
        state: address.state ?? existingAddress.state,
        pincode: address.pincode ?? existingAddress.pincode,
      };

      existingAddress = await this.addressService.update(existingAddress.id, updatedAddressData);

      if (!existingAddress) {
        throw new AppError(400, "Address update failed");
      }
    }

    // Update the driver's address
    drivers.address = existingAddress;
  }

  // Update the driver record with the new data
  Object.assign(drivers, rest);

  // Save the updated driver record
  const updatedDriver = await this.driverRepository.save(drivers);

  // Log the changes using AuditLogService
  await this.auditLogService.logChange(
    'Driver',            // Entity name
    id,                  // Entity ID
    oldData,             // Original data
    { ...updatedDriver }, // Updated data
    updatedBy            // User who made the update
  );

  return updatedDriver;
}


  // Delete a driver with scheduled deletion
async deleteDriver(id: string): Promise<boolean> {
  // Find the driver by ID
  const driver = await this.driverRepository.findOne({
    where: { id },
  });

  if (!driver) {
    throw new AppError(404, `Driver with ID ${id} not found`);
  }

  // Calculate the date 6 months ahead
  const now = new Date();
  const sixMonthsFromNow = new Date(now);
  sixMonthsFromNow.setMonth(now.getMonth() + 6); // Adds 6 months to the current date
  sixMonthsFromNow.setHours(0, 0, 0, 0); // Optionally, set the time to midnight (00:00:00)

  // Log the scheduled deletion
  //console.log(`Driver with ID ${id} marked for deletion in 6 months at ${sixMonthsFromNow}`);

  // Set the deletionScheduledAt field for the driver
  driver.deletionScheduledAt = sixMonthsFromNow;

  // Save the updated driver with the scheduled deletion date
  await this.driverRepository.save(driver);

  //console.log(`Driver with ID ${id} marked for deletion in 6 months.`);
  return true;
}


  async getAllDrivers ():Promise<Drivers[]>{
    return await this.driverRepository.find( {relations: [ 'address'],
      order: {
        createdAt: 'DESC', // Assuming createdAt is a timestamp field 
      },
    })
  }
}
