import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import Model from '../../global/model.entity';
import { Invoice } from './invoice.entity';
import { Product } from '../../product/createproduct/entity/product.entity';
import { ProductVarient } from '../../product/productVarient/entity/productVarient.entity';
import { UOM } from '../../uom/entity/uom.entity';



@Entity('invoice_products')
export class InvoiceProduct extends Model {

  @ManyToOne(() => Product, { cascade: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  productName: Product;

  @ManyToOne(() => ProductVarient, { onDelete: 'SET NULL', cascade: true })
  @JoinColumn({ name: 'varient_id' })
  variant: ProductVarient;

 @Column('decimal', { precision: 20, scale: 3, nullable: true })
  quantity: number;

  @Column({ type: 'decimal', precision: 20, scale: 4, nullable: true })
  acceptedQty?: number | null;

  @Column({ type: 'decimal', precision: 20, scale: 4, nullable: true })
  rejectedQty?: number | null;

  @Column({ type: 'decimal', precision: 20, scale: 4, nullable: true })
  returnedQty?: number | null;

  @ManyToOne(() => UOM, { cascade: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'saleuom_id' })
  saleUoM: UOM;
  /** 'per_unit' (quantity × unit price) or 'per_kg' (net kg × unit price). */
  @Column({ type: 'varchar', length: 10, default: 'per_unit' })
  pricingBasis: 'per_unit' | 'per_kg';

 @Column('decimal', { precision: 20, scale: 4, nullable: true })
  amount: number;
  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  unitPrice: number;
  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  grossWeight: number;
 @Column('decimal', { precision: 20, scale: 4, nullable: true })
  netWeight: number;
 @Column({ nullable: true })
  hsnCode: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @ManyToOne(() => Invoice, (invoice) => invoice.invoiceProducts, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;
}