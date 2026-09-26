import { Repository } from "typeorm";
import { CashVoucher } from "../entity/mCashVoucher.entity";



export class MultiCashVoucherRepository extends Repository<CashVoucher> {}