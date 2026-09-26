//sale target entity
import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";

import { SalesTargetProduct } from "./salesTargetProduct.entity";
import { User } from "../../employee/entity/user.entity";
import Model from "../../global/model.entity";

export enum Status {
  PENDING = "pending", 
  REJECTED = "rejected",
  APPROVED = "approved"
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
  status: Status; // DRAFT, PENDING, APPROVED, REJECTED


}