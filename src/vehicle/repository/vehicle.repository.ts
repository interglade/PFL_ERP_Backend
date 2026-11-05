import { Repository } from 'typeorm';
import { Vehicle } from '../entity/vehicle.entity';

export class VehicleRepository extends Repository<Vehicle> {}
