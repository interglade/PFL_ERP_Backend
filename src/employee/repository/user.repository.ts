// UserRepository.ts
import { Repository } from "typeorm";
import { User } from "../entity/user.entity";
import { injectable } from "inversify";

@injectable()
export class UserRepository extends Repository<User> {}
