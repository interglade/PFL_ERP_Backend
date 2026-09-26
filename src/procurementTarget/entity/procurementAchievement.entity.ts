import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn
} from "typeorm";
import Model from "../../global/model.entity";
import { ProcurementTargetWeek } from "./procurementTargetWeek.entity";
import { GRN } from "../../grn/entity/grn.entity";



@Entity("procurement_achievements")
export class ProcurementAchievement extends Model {
  // Link to planned weekly target
  @ManyToOne(() => ProcurementTargetWeek, { onDelete: "CASCADE" })
  @JoinColumn({ name: "weekly_procurement_id" })
  weeklyProcurement: ProcurementTargetWeek;

  // Actual procurement achieved
  @Column({ type: "decimal", default: 0 })
  achievedQty: number;

  // Date on which procurement happened
  @Column({ type: "date" })
  procurementDate: Date;

  @ManyToOne(() => GRN, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grn_id' })
  grn: GRN;
}