import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    ManyToOne,
    JoinColumn,
  } from 'typeorm';
import Model from '../../../global/model.entity';
import { CashVoucher } from './mCashVoucher.entity';
;
  
  
  @Entity("material_for_the_multi_cash_voucher")
  export class MVItems extends Model {
   
  
    @Column({nullable:true})
    description: string;
  
    
    @Column('decimal', { precision: 10, scale: 2 })
    amt: number;
  
    @ManyToOne(() => CashVoucher, (cashVoucher) => cashVoucher.particulars,{ onDelete: "SET NULL" }) // Linked with 'particulars'
  cashVoucher: CashVoucher;
  }
  