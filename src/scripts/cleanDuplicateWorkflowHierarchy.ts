import { AppDataSource } from "../utils/data-source";

/**
 * Script to remove duplicate entries from workflow_hierarchy table
 * Run this before adding the unique constraint
 */
async function cleanDuplicates() {
  try {
    //console.log("🔍 Checking for duplicates in workflow_hierarchy...");

    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    // Find duplicates
    const duplicates = await AppDataSource.query(`
      SELECT 
        department, 
        ancestor_id, 
        descendant_id, 
        depth, 
        COUNT(*) as count
      FROM workflow_hierarchy
      GROUP BY department, ancestor_id, descendant_id, depth
      HAVING COUNT(*) > 1
    `);

   // console.log(`📊 Found ${duplicates.length} duplicate combinations`);

    if (duplicates.length === 0) {
      //console.log("✅ No duplicates found!");
      await AppDataSource.destroy();
      return;
    }

    // Show duplicates
    //console.log("\n🔴 Duplicate entries:");
    duplicates.forEach((dup: any) => {
     // console.log(`  - Department: ${dup.department}, Depth: ${dup.depth}, Count: ${dup.count}`);
    });

    // Remove duplicates, keeping only the oldest entry (lowest ID)
    //console.log("\n🧹 Cleaning duplicates...");
    
    const result = await AppDataSource.query(`
      DELETE FROM workflow_hierarchy
      WHERE id IN (
        SELECT id
        FROM (
          SELECT 
            id,
            ROW_NUMBER() OVER (
              PARTITION BY department, ancestor_id, descendant_id, depth 
              ORDER BY "createdAt" ASC, id ASC
            ) as row_num
          FROM workflow_hierarchy
        ) t
        WHERE row_num > 1
      )
    `);

    //console.log(`✅ Removed ${result[1]} duplicate entries`);

    // Verify cleanup
    const remainingDuplicates = await AppDataSource.query(`
      SELECT 
        department, 
        ancestor_id, 
        descendant_id, 
        depth, 
        COUNT(*) as count
      FROM workflow_hierarchy
      GROUP BY department, ancestor_id, descendant_id, depth
      HAVING COUNT(*) > 1
    `);

    if (remainingDuplicates.length === 0) {
      //console.log("✅ All duplicates cleaned successfully!");
    } else {
      //console.log(`⚠️  Still ${remainingDuplicates.length} duplicates remaining`);
    }

    await AppDataSource.destroy();
    //console.log("\n✅ Script completed");

  } catch (error) {
    //console.error("❌ Error cleaning duplicates:", error);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }
}

// Run the script
cleanDuplicates();
