// UserRepository.ts
import { Repository } from "typeorm";
import { SystemLog } from "../entity/userSystemInfo.entity";



export class UserSystemInfoRepository extends Repository<SystemLog> {}
