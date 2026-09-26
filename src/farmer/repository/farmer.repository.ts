import { Repository } from "typeorm";
import { Farmer } from "../entity/farmer.entity";

export class FarmerRepository extends Repository<Farmer> {}
