import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";

import { ProcurementTargetProduct } from "./procurementTargetProduct.entity";
import Model from "../../global/model.entity";
import { User } from "../../employee/entity/user.entity";
import { Levels } from "../../levels/entity/levels.entity";



export enum ProcurementStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('procurement_targets')
@Index(['employee', 'month', 'year'], { unique: true })
export class ProcurementTarget extends Model {

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'employee_id' })
  employee: User;

  // Procurement workflow / team
  @ManyToOne(() => Levels, { nullable: true })
  @JoinColumn({ name: 'workflow_team_id' })
  workflowTeam: Levels;

  @Column({ nullable: true })
  month: number;

  @Column({ nullable: true })
  year: number;
  @Column({ default: ProcurementStatus.PENDING, type: 'enum', enum: ProcurementStatus })
  status: ProcurementStatus;

  // ✅ TOTAL of ALL PRODUCTS (WEEK-WISE)
  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  week1TotalQty: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  week2TotalQty: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  week3TotalQty: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  week4TotalQty: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  week5TotalQty: number;


  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  monthlyTotalQty: number;


  @OneToMany(
    () => ProcurementTargetProduct,
    product => product.target,
    { cascade: true },
  )
  products: ProcurementTargetProduct[];

  @ManyToOne(() => User, { nullable: true})
  @JoinColumn({ name: 'createdby_id' })
  creatdeBy: User;
  
}