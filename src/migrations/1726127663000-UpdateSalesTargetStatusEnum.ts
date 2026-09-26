import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateSalesTargetStatusEnum1726127663000 implements MigrationInterface {
    name = 'UpdateSalesTargetStatusEnum1726127663000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // First, update all existing 'draft' values to 'pending'
        await queryRunner.query(`
            UPDATE sales_targets 
            SET status = 'pending' 
            WHERE status = 'draft'
        `);

        // Update the enum type to remove 'draft'
        await queryRunner.query(`
            ALTER TYPE sales_targets_status_enum RENAME TO sales_targets_status_enum_old
        `);

        await queryRunner.query(`
            CREATE TYPE sales_targets_status_enum AS ENUM('pending', 'rejected', 'approved')
        `);

        await queryRunner.query(`
            ALTER TABLE sales_targets 
            ALTER COLUMN status TYPE sales_targets_status_enum 
            USING status::text::sales_targets_status_enum
        `);

        await queryRunner.query(`
            DROP TYPE sales_targets_status_enum_old
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Recreate the old enum with 'draft'
        await queryRunner.query(`
            ALTER TYPE sales_targets_status_enum RENAME TO sales_targets_status_enum_new
        `);

        await queryRunner.query(`
            CREATE TYPE sales_targets_status_enum AS ENUM('draft', 'pending', 'rejected', 'approved')
        `);

        await queryRunner.query(`
            ALTER TABLE sales_targets 
            ALTER COLUMN status TYPE sales_targets_status_enum 
            USING status::text::sales_targets_status_enum
        `);

        await queryRunner.query(`
            DROP TYPE sales_targets_status_enum_new
        `);
    }
}