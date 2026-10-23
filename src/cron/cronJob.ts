import cron from 'node-cron';
import { AppDataSource } from '../utils/data-source';
import { OverdueDeletionService } from '../global/overdueDeletion.service';

import logger from '../utils/logger';
import { InwardRegister } from '../inwardRegister/entity/inwardRegister.entity';
import { Farmer } from '../farmer/entity/farmer.entity';
import { Product } from '../product/createproduct/entity/product.entity';
import { purgeOldExports } from '../excel/excelCleanup.service';

const entitiesToCheck = [InwardRegister, Farmer, Product];

cron.schedule('0 0 1 * *', async () => {
  //console.log('Starting overdue deletion checks...');
  try {
    logger.info(`Cron job triggered at: ${new Date().toISOString()}`);

    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
  //  console.log('DataSource initialized');
    }

    const overdueDeletionService = new OverdueDeletionService();

    for (const entity of entitiesToCheck) {
      await overdueDeletionService.deleteOverdueRecordsForEntity(entity as any);
    }
  } catch (error) {
    //console.error('Error in cron job:', error);
    logger.error('Error in cron job:', error);
  }
});

// Generated Excel exports are handed to the client as a Spaces URL, so unlike
// import uploads they cannot be deleted at the end of the request. Sweep them
// nightly instead - they carry PAN, bank and contact data.
cron.schedule('30 1 * * *', async () => {
  try {
    await purgeOldExports();
  } catch (error) {
    logger.error('Error purging old Excel exports:', error);
  }
});

// D-9: every morning, remind the people of each source whose goods are ready
// to receive but whose receiving has not started or is still open.
cron.schedule('0 9 * * *', async () => {
  try {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    // Loaded lazily: the container imports most of the app.
    const { container } = await import('../inversify.config');
    const { TYPES } = await import('../types');
    const { remindOpenReceiving } = await import('../notification/flowNotifications');
    const receiving = container.get<{ listArrivals: (f: any) => Promise<any> }>(TYPES.ReceivingStatusService);
    const notifier = container.get<{ createBatchNoti: (m: string, ids: string[]) => Promise<void> }>(TYPES.NotificationService);
    const sent = await remindOpenReceiving(AppDataSource, notifier, (f) => receiving.listArrivals(f));
    logger.info(`Open receiving reminders sent: ${sent}`);
  } catch (error) {
    logger.error('Open receiving reminder failed:', error);
  }
});
