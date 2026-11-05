import { AppDataSource } from "../utils/data-source";
import { repairAllDepartments } from "../workFlow/closure";

/**
 * Repairs workflow_hierarchy the same way migration 1792801400000-WorkflowHierarchyIntegrity
 * does (duplicates, several managers, cycles, deleted employees). Safe to run any time.
 *
 * Run with: npm run clean:workflow-duplicates
 */
async function repair() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  try {
    const report = await AppDataSource.transaction((manager) => repairAllDepartments(manager));
    console.table(report);
  } finally {
    await AppDataSource.destroy();
  }
}

repair().catch((error) => {
  console.error("Workflow repair failed:", error);
  process.exit(1);
});
