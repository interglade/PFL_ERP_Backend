// import { inject, injectable } from "inversify";
// import { TYPES } from "../types";
// import { Equal } from "typeorm";
// import { DailyDumpSummaryRepository } from "../repositories/dailyDumpSummary.repository";
// import { DailyDumpSummary } from "../entities/dumpSummary.entity";


// @injectable()
// export class DailyDumpSummaryService {

//     constructor(
//         @inject(TYPES.DailyDumpSummaryRepository) private readonly dumpRegisterRepository: DailyDumpSummaryRepository,
      
        
//       ) {}

//     public async getbylocation(location:string):Promise<DailyDumpSummary[]>{
//         return this.dumpRegisterRepository.find({ where: { location: Equal(location) } })
      

//     }

//     public async getAll():Promise<DailyDumpSummary[]>{
//         return this.dumpRegisterRepository.find()}

      
//         public async getGlobalTotalsBetweenDates(this: any, 
//             startDate: string,
//             endDate: string,
           
//           ) {
//             const result = await this.dumpRegisterRepository
//               .createQueryBuilder("dump")
//               .select([
//                 "SUM(dump.dailyTotalAmountWithoutLocation) AS totalAmount",
//                 "SUM(dump.dailyTotalQuantityWithoutLocation) AS totalQuantity",
//                 "SUM(dump.cumulativeTotalAmountWithoutLocation) AS cumulativeAmount",
//                 "SUM(dump.cumulativeTotalQuantityWithoutLocation) AS cumulativeQuantity"
//               ])
//               .where("dump.date BETWEEN :startDate AND :endDate", { startDate, endDate })
//               .getRawOne();
          
//             return result;
//           }
// }