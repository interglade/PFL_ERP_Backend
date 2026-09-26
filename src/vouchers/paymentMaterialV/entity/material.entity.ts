import {
    Entity,
    Column,
    ManyToOne,
    JoinColumn,
  } from 'typeorm';

import { PMPVoucher } from './packingMaterialVoucher.entity';
import Model from '../../../global/model.entity';
import { UOM } from '../../../uom/entity/uom.entity';

 
  
  @Entity("material_use_for_packing_voucher")
  export class Materials extends Model{
    
    @Column({nullable:true})
    itemName: string;
  
    @Column('int',{nullable:true})
    itemQty: number;
  
    @ManyToOne(() => UOM, { nullable: true ,onDelete: "SET NULL",cascade:true})
    @JoinColumn({ name: "uom_id" })
    itemUom: UOM;

    @Column('decimal', { precision: 10, scale: 2 ,nullable:true})
    rate: number;
  
    @Column('decimal', { precision: 10, scale: 2 ,nullable:true})
    amt: number;
  
    @ManyToOne(() => PMPVoucher, (pmVoucher) => pmVoucher.materials, { onDelete: "SET NULL" })
    pmVoucher: PMPVoucher;
  }
  