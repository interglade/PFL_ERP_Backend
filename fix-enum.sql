-- Fix SalesTarget enum
-- First, update all existing 'draft' values to 'pending'
UPDATE sales_targets 
SET status = 'pending' 
WHERE status = 'draft';

-- Update the sales_targets enum type to remove 'draft'
ALTER TYPE sales_targets_status_enum RENAME TO sales_targets_status_enum_old;

CREATE TYPE sales_targets_status_enum AS ENUM('pending', 'rejected', 'approved');

ALTER TABLE sales_targets 
ALTER COLUMN status TYPE sales_targets_status_enum 
USING status::text::sales_targets_status_enum;

DROP TYPE sales_targets_status_enum_old;

-- Fix ProcurementTarget enum (if exists)
-- First, update all existing 'draft' values to 'pending'
UPDATE procurement_targets 
SET status = 'pending' 
WHERE status = 'draft';

-- Check if enum exists, then update it
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'procurement_targets_status_enum') THEN
        -- Update the procurement_targets enum type
        ALTER TYPE procurement_targets_status_enum RENAME TO procurement_targets_status_enum_old;
        
        CREATE TYPE procurement_targets_status_enum AS ENUM('pending', 'approved', 'rejected');
        
        ALTER TABLE procurement_targets 
        ALTER COLUMN status TYPE procurement_targets_status_enum 
        USING status::text::procurement_targets_status_enum;
        
        DROP TYPE procurement_targets_status_enum_old;
    END IF;
END $$;