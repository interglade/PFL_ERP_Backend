import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateProcurementTargetStatusEnum1726127664000 implements MigrationInterface {
    name = 'UpdateProcurementTargetStatusEnum1726127664000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // First, update all existing 'draft' values to 'pending'
        await queryRunner.query(`
            UPDATE procurement_targets 
            SET status = 'pending' 
            WHERE status = 'draft'
        `);

        // Check if the enum exists and update it
        const enumExistsQuery = await queryRunner.query(`
            SELECT 1 FROM pg_type WHERE typname = 'procurement_targets_status_enum'
        `);

        if (enumExistsQuery.length > 0) {
            // Update the enum type to remove 'draft' and 'submitted'
            await queryRunner.query(`
                ALTER TYPE procurement_targets_status_enum RENAME TO procurement_targets_status_enum_old
            `);

            await queryRunner.query(`
                CREATE TYPE procurement_targets_status_enum AS ENUM('pending', 'approved', 'rejected')
            `);

            await queryRunner.query(`
                ALTER TABLE procurement_targets 
                ALTER COLUMN status TYPE procurement_targets_status_enum 
                USING status::text::procurement_targets_status_enum
            `);

            await queryRunner.query(`
                DROP TYPE procurement_targets_status_enum_old
            `);
        } else {
            // If enum doesn't exist, create it
            await queryRunner.query(`
                CREATE TYPE procurement_targets_status_enum AS ENUM('pending', 'approved', 'rejected')
            `);
            
            await queryRunner.query(`
                ALTER TABLE procurement_targets 
                ALTER COLUMN status TYPE procurement_targets_status_enum 
                USING status::text::procurement_targets_status_enum
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Recreate the old enum with 'draft' and 'submitted'
        await queryRunner.query(`
            ALTER TYPE procurement_targets_status_enum RENAME TO procurement_targets_status_enum_new
        `);

        await queryRunner.query(`
            CREATE TYPE procurement_targets_status_enum AS ENUM('draft', 'pending', 'submitted', 'approved', 'rejected')
        `);

        await queryRunner.query(`
            ALTER TABLE procurement_targets 
            ALTER COLUMN status TYPE procurement_targets_status_enum 
            USING status::text::procurement_targets_status_enum
        `);

        await queryRunner.query(`
            DROP TYPE procurement_targets_status_enum_new
        `);
    }
}