// UserRepository.ts
import { Repository } from "typeorm";

import { CustomerCategory } from "../entity/customerCategory.entity";

export class CustomerCategoryRepository extends Repository<CustomerCategory> {}
