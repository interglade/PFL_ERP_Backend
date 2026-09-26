
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn
} from "typeorm";
import Model from "../../global/model.entity";
import { SalesTargetWeek } from "./salesTargetWeek.entity";



@Entity("sales_achievements")
export class SalesAchievement extends Model {

  

  // Link to planned weekly target
  @ManyToOne(() => SalesTargetWeek, { onDelete: "CASCADE" })
  @JoinColumn({ name: "weekly_sales_id" })
  weeklySales: SalesTargetWeek;

  // Actual sale achieved
  @Column({ type: "decimal", default: 0 })
  achievedAmount: number;

  // Date on which sale happened
  @Column({ type: "date" })
  saleDate: Date;

  
}

