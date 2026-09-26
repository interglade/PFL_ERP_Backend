import { Repository } from "typeorm";
import { StockReportEod } from "../entity/eodReportforinvendtory.entity";



export class EodRepository extends Repository<StockReportEod> {}
