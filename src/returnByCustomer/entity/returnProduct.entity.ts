import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { PostReturnByCustomer } from './postReturnByCustomer.entity';
import { Product } from '../../product/createproduct/entity/product.entity';
import { ProductVarient } from '../../product/productVarient/entity/productVarient.entity';
import Model from '../../global/model.entity';
import { UOM } from '../../uom/entity/uom.entity';


@Entity('returned_products_by_customer')
export class ReturnedProducts extends Model {
  @ManyToOne(() => Product, { nullable: false, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  productName: Product;

 @ManyToOne(() => ProductVarient, { onDelete: 'SET NULL', cascade: true })
  @JoinColumn({ name: 'varient_id' })
  variant: ProductVarient;
  // @Column({ type: 'text', nullable: true })
  // origin: string;

  // @Column({ type: 'text', nullable: true })
  // variety: string;

  // @Column({ type: 'text', nullable: true })
  // count: string;

  // @Column({ type: 'text', nullable: true })
  // size: string;

  @ManyToOne(() => UOM, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'saleuom_id' })
  saleUoM: UOM;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  unitPrice: number;
  //Returned Product Details

  // @ManyToOne(() => UOM, { nullable: false, onDelete: 'SET NULL' })
  //   @JoinColumn({ name: 'uom_id' })
  //   returnedUOM: UOM;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  returnedQty: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  returnedQtyAmt: number;
  //   @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  // returnedUnitPrice: number;

  // @Column('decimal', { precision: 10, scale: 3, nullable: true })
  // grossWeight: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  returnedPackingMaterialWt: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  returnedNetWt: number;
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  returnedGrossWt: number;

  //  //rejected product details
  //  @ManyToOne(() => UOM, { nullable: false, onDelete: 'SET NULL' })
  //   @JoinColumn({ name: 'uom_id' })
  //   rejectedUoM: UOM;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  rejectedQty: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  rejectedQtyAmt: number;

  // @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  // rejectedUnitPrice: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  rejectedPackingMaterialWt: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  rejectedGrossWt: number;
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  rejectedNetWt: number;

  @Column({ default: false })
  isChanged: boolean;

  @ManyToOne(
    () => PostReturnByCustomer,
    (postReturn) => postReturn.returnedProducts,
  )
  postReturn: PostReturnByCustomer;
}
