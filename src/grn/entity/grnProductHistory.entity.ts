import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import Model from '../../global/model.entity';
import { GRN } from './grn.entity';
import { GrnProduct } from './grnProduct.entity';
import { Product } from '../../product/createproduct/entity/product.entity';
import { ProductVarient } from '../../product/productVarient/entity/productVarient.entity';
import { User } from '../../employee/entity/user.entity';
import { UOM } from '../../uom/entity/uom.entity';
import { PackingMaterial } from '../../packingMaterial/entity/packingMaterial.entity';

export type GrnLineChangeType = 'updated' | 'added' | 'removed';

/**
 * Immutable audit trail of a GRN product line: one row per edit that added or removed the line
 * or changed its quantity, rate, unit, weights, dates or packaging. Version is kept per line.
 */
@Entity({ name: 'grn_product_history' })
export class GrnProductHistory extends Model {
  // ── Foreign keys ────────────────────────────────────────────────────────────

  @ManyToOne(() => GRN, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grn_id' })
  grn: GRN;

  /** Becomes null once a removed line is deleted; product / variant keep the snapshot. */
  @ManyToOne(() => GrnProduct, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'grn_product_id' })
  grnProduct: GrnProduct | null;

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

  /** Starts at 1 for the line's first history row; increments with every later one. */
  @Column({ type: 'int', default: 1 })
  version: number;

  /** `added` (old values empty), `removed` (new values empty) or `updated`. */
  @Column({ type: 'varchar', length: 10, default: 'updated' })
  changeType: GrnLineChangeType;

  // ── Snapshot of what changed ─────────────────────────────────────────────────

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  oldQuantity: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  newQuantity: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  oldRate: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  newRate: number;

  @ManyToOne(() => UOM, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'old_uom_id' })
  oldUom: UOM | null;

  @ManyToOne(() => UOM, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'new_uom_id' })
  newUom: UOM | null;

  @Column('decimal', { precision: 14, scale: 3, nullable: true })
  oldGrossWeight: number | null;

  @Column('decimal', { precision: 14, scale: 3, nullable: true })
  newGrossWeight: number | null;

  @Column('decimal', { precision: 14, scale: 3, nullable: true })
  oldPackingMaterialWeight: number | null;

  @Column('decimal', { precision: 14, scale: 3, nullable: true })
  newPackingMaterialWeight: number | null;

  @Column('decimal', { precision: 14, scale: 3, nullable: true })
  oldNetWeight: number | null;

  @Column('decimal', { precision: 14, scale: 3, nullable: true })
  newNetWeight: number | null;

  @Column({ type: 'date', nullable: true })
  oldPurchaseDate: string | null;

  @Column({ type: 'date', nullable: true })
  newPurchaseDate: string | null;

  @Column({ type: 'date', nullable: true })
  oldDispatchDate: string | null;

  @Column({ type: 'date', nullable: true })
  newDispatchDate: string | null;

  @Column({ type: 'date', nullable: true })
  oldDeliveryDate: string | null;

  @Column({ type: 'date', nullable: true })
  newDeliveryDate: string | null;

  @Column({ type: 'date', nullable: true })
  oldExpectedHarvestDate: string | null;

  @Column({ type: 'date', nullable: true })
  newExpectedHarvestDate: string | null;

  @ManyToOne(() => PackingMaterial, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'old_packing_material_id' })
  oldPackagingMaterial: PackingMaterial | null;

  @ManyToOne(() => PackingMaterial, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'new_packing_material_id' })
  newPackagingMaterial: PackingMaterial | null;

  /** Timestamp when this history record was created (= when the edit happened). */
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  modifiedAt: Date;
}
