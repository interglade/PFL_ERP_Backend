import { Repository} from 'typeorm';
import { AppDataSource } from '../utils/data-source';
import Model from './model.entity';
import { refreshTransaction } from '../transactions/transaction.core';

export class OverdueDeletionService {
//     // Helper method to get the repository for any entity that extends Model
     private getRepositoryForEntity<T extends Model>(entity: { new(): T }): Repository<T> {
        return AppDataSource.getRepository(entity);
    }
 

    async deleteOverdueRecordsForEntity<T extends Model>(entity: { new(): T }): Promise<void> {
        try {
            // Get the repository for the entity
            const repo = this.getRepositoryForEntity(entity);

            // Transactions of the rows about to go: refreshed after the delete so they turn Cancelled / move on.
            const hasTxnNo = repo.metadata.columns.some((c) => c.databaseName === 'txn_no');
            const txnNos: string[] = hasTxnNo
                ? (await repo.createQueryBuilder('rec')
                    .select('DISTINCT rec.txn_no', 'txn_no')
                    .where('rec.deletionScheduledAt <= :date', { date: new Date() })
                    .andWhere('rec.txn_no IS NOT NULL')
                    .getRawMany<{ txn_no: string }>()).map((r) => r.txn_no)
                : [];

            const result = await repo
                .createQueryBuilder()
                .delete()  // Directly delete records in one operation
                .where('deletionScheduledAt <= :date', { date: new Date() })
                .execute();
    
            for (const txnNo of txnNos) await refreshTransaction(AppDataSource.manager, txnNo);

            if (result.affected) {
                console.log(`Deleted ${result.affected} overdue records for ${entity.name}.`);
            } else {
                console.log(`No overdue records found for ${entity.name}.`);
            }
        } catch (error) {
            console.error(`Error during overdue deletion for ${entity.name}:`, error);
        }
    }
    
}
    
//     // Method to delete overdue records for a given entity
//     async deleteOverdueRecordsForEntity<T extends Model>(entity: { new(): T }): Promise<void> {
//         try {
//             // Get the repository for the entity
//             const repo = this.getRepositoryForEntity(entity);
            
//            // Find records where deletionScheduledAt is past and deletionScheduledAt is set
//            const recordsToDelete = await repo.find({
//             where: {
//                 deletionScheduledAt: LessThanOrEqual(new Date()) // This should be wrapped in the FindOptionsWhere properly
//             } as FindOptionsWhere<T> // Type assertion to specify correct structure
//         });
//             console.log(recordsToDelete )
//             console.log(`Found ${recordsToDelete.length} overdue records to delete for ${entity.name}.`);

//             // Perform the actual deletion
//             if (recordsToDelete.length > 0) {
//                 for (const record of recordsToDelete) {
//                     await this.removeRecord(repo, record);
//                 }
//             } else {
//                 console.log(`No overdue records found for ${entity.name}.`);
//             }
//         } catch (error) {
//             console.error(`Error during overdue deletion for ${entity.name}:`, error);
//         }
//     }

//     // Helper method to remove a record with a transaction
//     private async removeRecord<T extends Model>(repo: Repository<T>, record: T): Promise<void> {
//         const queryRunner = AppDataSource.createQueryRunner();
//         await queryRunner.startTransaction();

//         try {
//             await queryRunner.manager.remove(record);  // Delete the record
//             console.log(`Deleted record with ID: ${record['id']}`); // Assuming 'id' is the common field
//             await queryRunner.commitTransaction();
//         } catch (error) {
//             console.error('Error during record deletion:', error);
//             await queryRunner.rollbackTransaction();
//         } finally {
//             await queryRunner.release();
//         }
//     }

//     // Helper method to get the repository for any entity that extends Model
//     private getRepositoryForEntity<T extends Model>(entity: { new(): T }): Repository<T> {
//         return AppDataSource.getRepository(entity);
//     }
// }
