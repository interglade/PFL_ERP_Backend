import { Column, Entity, JoinColumn, ManyToOne, Unique } from "typeorm";
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


@Entity("workflow_hierarchy")
// @Unique(["department", "ancestor", "descendant", "depth"]) // TODO: Uncomment after running cleanDuplicateWorkflowHierarchy script
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
