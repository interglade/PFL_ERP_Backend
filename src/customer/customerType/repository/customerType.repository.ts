// UserRepository.ts
import { Repository } from "typeorm";

import { CustomerType } from "../entity/customerType.entity";

export class CustomerTypeRepository extends Repository<CustomerType> {}
