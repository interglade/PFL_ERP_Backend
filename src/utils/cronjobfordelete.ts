import cron from 'node-cron';
import { LessThan } from 'typeorm';

import { AppDataSource } from './data-source';

import { CashVoucher } from '../vouchers/multiCashV/entity/mCashVoucher.entity';

import { TPVoucher } from '../vouchers/tranportPaymentV/entity/transportPaymentvoucher.entity';
import logger from './logger';
import { GRN } from '../grn/entity/grn.entity';
import { RFPA } from '../rfpa/entity/rfpa.entity';
import { DealSlip } from '../dealSlip/entity/dealSlip.entity';
import { InwardRegister } from '../inwardRegister/entity/inwardRegister.entity';
import { VehicleDispatch } from '../vehicleDispatch/entity/vehicleDispatch.entity';
import { Aqr } from '../aqr/entity/aqr.entity';
import { PackingMaterial } from '../packingMaterial/entity/packingMaterial.entity';
import { DumpRegister } from '../dumpRegister/entity/dumpRegister.entity';
import { SecondSale } from '../secondSale/entity/secondSale.entity';
import { PostReturnByCustomer } from '../returnByCustomer/entity/postReturnByCustomer.entity';
import { StockReportEod } from '../eodStock/entity/eodReportforinvendtory.entity';
import { Invoice } from '../invoice/entity/invoice.entity';



export const startAutoDeleteJob = () => {
  cron.schedule('*/5 * * * *', async () => {  // runs every 5 minutes
    logger.info('Running auto-delete job...');

    const repositories = [
      AppDataSource.getRepository(GRN),
      AppDataSource.getRepository(RFPA),
      AppDataSource.getRepository(DealSlip),
      AppDataSource.getRepository(InwardRegister),
      AppDataSource.getRepository(VehicleDispatch), 
      AppDataSource.getRepository(Aqr), 
      AppDataSource.getRepository(PackingMaterial), 
      AppDataSource.getRepository(CashVoucher), 
      AppDataSource.getRepository(TPVoucher), 
      AppDataSource.getRepository(TPVoucher), 
      AppDataSource.getRepository(DumpRegister), 
      AppDataSource.getRepository(StockReportEod), 
      AppDataSource.getRepository(PostReturnByCustomer), 
      AppDataSource.getRepository(SecondSale), 
      AppDataSource.getRepository(Invoice), 

    ];

    const cutoffDate = new Date();
    cutoffDate.setMinutes(cutoffDate.getMinutes() - 5);

    for (const repo of repositories as any[]) {
      const oldRecords = await repo.find({
        where: {
          isDeleted: true,
          deletedAt: LessThan(cutoffDate),
        },
      });

      if (oldRecords.length > 0) {
        if (oldRecords.length > 0) {
          await repo.remove(oldRecords);
          logger.info(`Deleted ${oldRecords.length} old records from ${repo.metadata.name}`);
        }
      }
    }
  });
};
