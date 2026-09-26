// UserRepository.ts
import { Repository } from "typeorm";

import { Customer } from "../entity/customer.entity";

export class CustomerRepository extends Repository<Customer> {}
