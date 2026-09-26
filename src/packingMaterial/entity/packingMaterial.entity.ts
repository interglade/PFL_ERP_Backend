import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import Model from '../../global/model.entity';
import { UOM } from '../../uom/entity/uom.entity';



export enum UseFor {
  PURCHASE = 'for purchase',
  SALE = 'for sale',
}

@Entity('post_packaging_material')
export class PackingMaterial extends Model {
  @Column({
    type: 'enum',
    enum: UseFor,
    nullable:true
  })
  useFor: UseFor;

 
  @Column({ type: 'text', nullable: true })
  packagingMaterialName: string;

  @Column('decimal', { precision: 10, scale: 3, nullable: true })
  packagingMaterialWeight: number;

  @Column({ type: 'text', nullable: true })
  packagingMaterialDescription: string;

  @Column('decimal', { precision: 10, scale: 3, nullable: true })
  containsQuantity: number;

  @ManyToOne(() => UOM, {
    nullable: true,
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'uom_id' })
  uom: UOM;
}
