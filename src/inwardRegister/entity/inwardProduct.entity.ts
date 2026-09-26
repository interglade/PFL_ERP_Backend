import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import Model from '../../global/model.entity';
import { Product } from '../../product/createproduct/entity/product.entity';
import { ProductVarient } from '../../product/productVarient/entity/productVarient.entity';
import { UOM } from '../../uom/entity/uom.entity';
import { InwardRegister } from './inwardRegister.entity';


@Entity('inwardProduct') // Table for GRN-Product relationship
export class InwardProduct extends Model {
  // Relation to Product entity
  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  productName: Product;
  @ManyToOne(() => ProductVarient, { onDelete: 'SET NULL', cascade: true })
  @JoinColumn({ name: 'varient_id' })
  variant: ProductVarient;

  

  @ManyToOne(() => UOM, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uom_id' })
  uom: UOM;

  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  packingMaterialWeight: number;

  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  quantity: number;
  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  weight: number;

  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  unitPrice: number;
  
  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  amount: number;

  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  netWeight: number;

  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  grossWeight: number;
  @ManyToOne(
    () => InwardRegister,
    (inwardRegister) => inwardRegister.inwardProducts,
    { nullable: true, onDelete: 'SET NULL' },
  )
  inwardRegister: InwardRegister; // This is where the foreign key resides
}
