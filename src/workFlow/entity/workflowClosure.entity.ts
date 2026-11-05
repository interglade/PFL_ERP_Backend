import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import Model from "../../global/model.entity";
import { User } from "../../employee/entity/user.entity";


export enum DepartmentEnum {
  PURCHASE = "procurement",
  SALE = "sale",
  OPERATIONS = "operations",
  QUALITY_CHECKING = "quality_checking",
  BUSINESS_DEVELOPMENT = "business_development",
  BRANDING_MARKETING = "Branding_&_Marketing",
  EXPORTS = "exports",
  FARMING = "farming",
  ACCOUNTS = "accounts",
  FINANCE = "finance",
  HR = "hr",
  IT = "it",
  ADMIN = "admin",
  SUPERADMIN="superAdmin"
}

// Maps legacy/alias department strings to the current enum values
const departmentAliasMap: Record<string, DepartmentEnum> = {
  purchase: DepartmentEnum.PURCHASE,
  procurement: DepartmentEnum.PURCHASE,
  sales: DepartmentEnum.SALE,
  sale: DepartmentEnum.SALE,
  operation: DepartmentEnum.OPERATIONS,
  operations: DepartmentEnum.OPERATIONS,
  quality_checking: DepartmentEnum.QUALITY_CHECKING,
  qualitychecking: DepartmentEnum.QUALITY_CHECKING,
  business_development: DepartmentEnum.BUSINESS_DEVELOPMENT,
  businessdevelopment: DepartmentEnum.BUSINESS_DEVELOPMENT,
  branding_marketing: DepartmentEnum.BRANDING_MARKETING,
  "branding_&_marketing": DepartmentEnum.BRANDING_MARKETING,
  exports: DepartmentEnum.EXPORTS,
  farming: DepartmentEnum.FARMING,
  accounts: DepartmentEnum.ACCOUNTS,
  finance: DepartmentEnum.FINANCE,
  hr: DepartmentEnum.HR,
  it: DepartmentEnum.IT,
  admin: DepartmentEnum.ADMIN,
  superadmin: DepartmentEnum.SUPERADMIN,
};

/**
 * Normalizes an incoming department string to a valid DepartmentEnum value.
 * Handles legacy values (e.g. "purchase" → "procurement") and case variations.
 */
export function normalizeDepartment(value: string): DepartmentEnum {
  const lower = value?.toLowerCase?.();
  if (lower && departmentAliasMap[lower]) {
    return departmentAliasMap[lower];
  }
  const enumValues = Object.values(DepartmentEnum) as string[];
  if (enumValues.includes(value)) {
    return value as DepartmentEnum;
  }
  throw new Error(`Invalid department value: "${value}"`);
}


/**
 * Closure table of each department's reporting tree. The depth-1 rows (who reports to whom)
 * are the source of truth; every write rebuilds the department's other rows from them
 * (WorkflowHierarchyService).
 *
 * The two unique indexes are created by migration 1792801400000-WorkflowHierarchyIntegrity
 * (it removes duplicates first). `synchronize: false` keeps TypeORM sync from creating them on
 * a database that still has duplicates, or dropping them as unknown.
 */
@Entity("workflow_hierarchy")
// (department, ancestor_id, descendant_id) unique
@Index("UQ_workflow_hierarchy_pair", { synchronize: false })
// (department, descendant_id) unique WHERE depth = 1: one direct manager
@Index("UQ_workflow_hierarchy_one_manager", { synchronize: false })
export class WorkflowHierarchy extends Model
 {
    


  @Column({
    type: "enum",
    enum: DepartmentEnum
  })
  department: DepartmentEnum;


  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ancestor_id" })
  ancestor: User;


  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "descendant_id" })
  descendant: User;


    @Column()
    depth: number; // 0=self, 1=direct, 2=indirect
}
