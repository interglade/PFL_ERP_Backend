// UserRepository.ts
import { Repository } from "typeorm";

import { DealSlip } from "../entity/dealSlip.entity";




export class DealSlipRepository extends Repository<DealSlip> {}