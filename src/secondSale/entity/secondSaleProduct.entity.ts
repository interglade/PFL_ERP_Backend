import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import Model from '../../global/model.entity';
import { SecondSale } from './secondSale.entity';
import { Product } from '../../product/createproduct/entity/product.entity';
import { ProductVarient } from '../../product/productVarient/entity/productVarient.entity';
import { UOM } from '../../uom/entity/uom.entity';
import { PackingMaterial } from '../../packingMaterial/entity/packingMaterial.entity';


@Entity({ name: 'second_sale_product' })
export class SecondSaleProduct extends Model {
  @ManyToOne(() => Product, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'product_id' })
  productName: Product;

   @ManyToOne(() => ProductVarient, { onDelete: 'SET NULL', cascade: true })
      @JoinColumn({ name: 'varient_id' })
      variant: ProductVarient;

  

  
  @Column('int', { nullable: true })
  quantity: number;

  @Column('decimal', { nullable: true })
  unitPrice: number;

  @Column('decimal', { nullable: true })
  amount: number;
  @Column({ nullable: true, type: 'decimal', precision: 10, scale: 3 })
  netWeight: number;
  @Column({ nullable: true, type: 'decimal', precision: 10, scale: 3 })
  packagingMaterialWeight: number;
  @Column({ nullable: true, type: 'decimal', precision: 10, scale: 3 })
  grossWeight: number;

  @ManyToOne(() => UOM, { cascade: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'saleuom_id' })
  saleUoM: UOM;
  @ManyToOne(() => UOM, { cascade: true, nullable: true, onDelete: 'SET NULL' })
  packagingMaterialUoM: UOM;
  @Column({ nullable: true })
  packagingMaterialQuantity: number;
  @Column({ nullable: true })
  packagingMaterialUnitPrice: number;
  @Column({ nullable: true })
  packagingMaterialAmount: number;
  @Column({ nullable: true })
  packagingMaterialTotalWeight: number;
  @ManyToOne(() => PackingMaterial, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'packing_material_id' })
  packagingMaterial: PackingMaterial;

  
  @ManyToOne(
    () => SecondSale,
    (saleRegister) => saleRegister.secondSaleProducts,
    { onDelete: 'SET NULL' },
  )
  @JoinColumn({ name: 'second_sale_register_id' })
  secondSaleRegister: SecondSale;
}
