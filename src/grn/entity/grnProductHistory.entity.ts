import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import Model from '../../global/model.entity';
import { GRN } from './grn.entity';
import { GrnProduct } from './grnProduct.entity';
import { Product } from '../../product/createproduct/entity/product.entity';
import { ProductVarient } from '../../product/productVarient/entity/productVarient.entity';
import { User } from '../../employee/entity/user.entity';


/**
 * Stores an immutable audit trail for every quantity/rate change on a GRN product.
 * Version is maintained per grn_product (not per GRN).
 */
@Entity({ name: 'grn_product_history' })
export class GrnProductHistory extends Model {
  // ── Foreign keys ────────────────────────────────────────────────────────────

  @ManyToOne(() => GRN, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grn_id' })
  grn: GRN;

  @ManyToOne(() => GrnProduct, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grn_product_id' })
  grnProduct: GrnProduct;

  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @ManyToOne(() => ProductVarient, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'variant_id' })
  variant: ProductVarient;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'modified_by_id' })
  modifiedBy: User;

  // ── Version counter (per grn_product) ───────────────────────────────────────

  /** Starts at 1 for the first edit; increments with every subsequent change. */
  @Column({ type: 'int', default: 1 })
  version: number;

  // ── Snapshot of what changed ─────────────────────────────────────────────────

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  oldQuantity: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  newQuantity: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  oldRate: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  newRate: number;

  /** Timestamp when this history record was created (= when the edit happened). */
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  modifiedAt: Date;
}
