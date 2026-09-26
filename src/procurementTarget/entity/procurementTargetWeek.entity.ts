import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { ProcurementTargetProduct } from './procurementTargetProduct.entity';
import Model from '../../global/model.entity';


export enum WeekNo {
  WEEK_1 = 1,
  WEEK_2 = 2,
  WEEK_3 = 3,
  WEEK_4 = 4,
  WEEK_5 = 5,
}

@Entity('procurement_target_weeks')
export class ProcurementTargetWeek extends Model {

  @ManyToOne(
    () => ProcurementTargetProduct,
    product => product.weeklyProcurement,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'product_target_id' })
  productTarget: ProcurementTargetProduct;

  @Column({ type: 'enum', enum: WeekNo, nullable: true })
  weekNo: WeekNo;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  qty: number;

  @Column({ type: 'date', nullable: true })
  weekStartDate: Date;

  @Column({ type: 'date', nullable: true })
  weekEndDate: Date;
}
