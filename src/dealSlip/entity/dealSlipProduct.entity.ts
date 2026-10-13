import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import Model from '../../global/model.entity';
import { DealSlip } from './dealSlip.entity';
import { RFPAProduct } from '../../rfpa/entity/rfpaProduct.entity';
import { Product } from '../../product/createproduct/entity/product.entity';
import { ProductVarient } from '../../product/productVarient/entity/productVarient.entity';
import { UOM } from '../../uom/entity/uom.entity';

/**
 * A product line of a Deal Slip. Copied from the RFPA's lines when the deal slip is
 * created, so the agreed quantity/price can differ from the RFPA's planned ones without
 * touching the RFPA. Only quantity and unit price are editable afterwards.
 */
@Entity('deal_slip_product')
export class DealSlipProduct extends Model {
  @ManyToOne(() => Product, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'product_id' })
  productName: Product;

  @ManyToOne(() => ProductVarient, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'varient_id' })
  variant: ProductVarient;

  @Column('character varying', { name: 'grade', nullable: true, length: 100 })
  grade: string;

  @Column('integer', { name: 'quantity' })
  quantity: number;

  @ManyToOne(() => UOM, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'uom_id' })
  uom: UOM;

  @Column('numeric', { name: 'unit_price', precision: 10, scale: 2 })
  unitPrice: number;

  @Column('character varying', { name: 'count', nullable: true, length: 100 })
  count: string;

  @Column('character varying', { name: 'size', nullable: true, length: 100 })
  size: string;

  @Column('character varying', { name: 'origin', nullable: true, length: 100 })
  origin: string;

  @Column('character varying', { name: 'variety', nullable: true, length: 100 })
  variety: string;

  @Column('numeric', { name: 'total_value', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'date', nullable: true, default: null })
  purchaseDate: Date;

  @Column({ type: 'date', nullable: true, default: null })
  expectedHarvestDate: Date;

  @Column({ type: 'date', nullable: true })
  dispatchDate: Date;

  @Column({ type: 'date', nullable: true })
  deliveryDate: Date;

  @ManyToOne(() => DealSlip, (dealSlip) => dealSlip.dealSlipProducts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deal_slip_id' })
  dealSlip: DealSlip;

  /** The RFPA line this was copied from, kept to compare planned vs agreed quantity. */
  @ManyToOne(() => RFPAProduct, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'rfpa_product_id' })
  rfpaProduct: RFPAProduct;
}
