//sale target entity
import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";

import { SalesTargetProduct } from "./salesTargetProduct.entity";
import { User } from "../../employee/entity/user.entity";
import Model from "../../global/model.entity";

export enum Status {
  PENDING = "Pending",
  REJECTED = "Rejected",
  APPROVED = "Approved"
}

@Entity("sales_targets")
export class SalesTarget extends Model {

  @ManyToOne(() => User)
  @JoinColumn({ name: "employee_id" })
  employee: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "created_by_id" })
  createdBy: User;

  @Column({ nullable: true })
  month: number;

  @Column({ nullable: true })
  year: number;

  @Column({ type: "decimal", default: 0 })
  totalMonthlySale: number; // auto-calculated

  @Column({ type: 'enum', enum: Status, default: Status.PENDING })
  status: Status;

  /** Who approved or rejected the plan (the creating manager when it was approved automatically). */
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "approved_by_id" })
  approvedBy: User | null;

  @Column({ name: "approved_at", type: "timestamp", nullable: true })
  approvedAt: Date | null;

  @Column({ name: "approval_remark", type: "text", nullable: true })
  approvalRemark: string | null;

}