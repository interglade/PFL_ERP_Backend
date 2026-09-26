// UserRepository.ts
import { Repository } from "typeorm";
import { TPVoucher } from "../entity/transportPaymentvoucher.entity";




export class TPVoucherRepository extends Repository<TPVoucher> {}
