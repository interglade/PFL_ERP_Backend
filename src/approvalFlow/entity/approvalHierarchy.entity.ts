import { Column, Entity, OneToMany } from "typeorm";
import { ApprovalLevel } from "./approvalLevel.entity";
import Model from "../../global/model.entity";


@Entity('hierarchy')
export class ApprovalHierarchy  extends Model{
 

  @Column()
  name: string;

  @Column()
  description: string;

  @OneToMany(() => ApprovalLevel, "hierarchy")
  levels: ApprovalLevel[];
}