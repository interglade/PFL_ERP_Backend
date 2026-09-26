//sale target week wise entity
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import Model from "../../global/model.entity";
import { SalesTargetProduct } from "./salesTargetProduct.entity";

export enum WeekNo {
  WEEK_1 = 1,
  WEEK_2 = 2,
  WEEK_3 = 3,
  WEEK_4 = 4,
  WEEK_5 = 5
}

@Entity("sales_target_weeks")
export class SalesTargetWeek extends Model {

  @ManyToOne(() => SalesTargetProduct, { onDelete: "CASCADE" })
  @JoinColumn({ name: "sales_target_product_id" })
  productTarget: SalesTargetProduct;

  @Column({ type: "enum", enum: WeekNo })
  weekNo: WeekNo; // 1,2,3,4

  @Column({ name: "week_start_date", nullable: true })
  weekStartDate: Date;

  @Column({ name: "week_end_date", nullable: true })
  weekEndDate: Date;

  @Column({ type: "decimal", default: 0, name: "sale_amount" })
  saleAmount: number; // INR
}
