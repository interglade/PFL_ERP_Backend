// UserRepository.ts
import { Repository } from "typeorm";

import { UOM } from "../entity/uom.entity";

export class UOMRepository extends Repository<UOM> {}
