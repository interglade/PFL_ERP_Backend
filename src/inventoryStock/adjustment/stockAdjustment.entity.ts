import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type AdjustmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type AdjustmentReason = 'COUNT_DIFFERENCE' | 'DAMAGE_IN_STORAGE' | 'SAMPLE' | 'OPENING' | 'OTHER';
export const ADJUSTMENT_REASONS: AdjustmentReason[] = ['COUNT_DIFFERENCE', 'DAMAGE_IN_STORAGE', 'SAMPLE', 'OPENING', 'OTHER'];

/**
 * C10 — Stock Adjustment: a batch-level correction (count difference, damage
 * in storage, sample, opening stock …) with a reason and a single approval by
 * someone other than the requester. A reduction holds its quantity while
 * pending; an addition can create a new batch (opening stock).
 */
@Entity('stock_adjustment')
@Index('IDX_stock_adjustment_status', ['status', 'createdAt'])
export class StockAdjustment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'adjustment_no', type: 'varchar', length: 40, nullable: true })
  adjustmentNo: string | null;

  /** Existing batch adjusted; null for an addition into a new batch. */
  @Column({ name: 'stock_batch_id', type: 'uuid', nullable: true })
  stockBatchId: string | null;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId: string | null;

  @Column({ name: 'uom_id', type: 'uuid', nullable: true })
  uomId: string | null;

  @Column({ name: 'batch_no', type: 'varchar', length: 100 })
  batchNo: string;

  @Column({ name: 'stock_type', type: 'varchar', length: 10, default: 'FRESH' })
  stockType: string;

  /** + adds to the batch, − takes out (units of `uomId`). */
  @Column({ name: 'qty_delta', type: 'decimal', precision: 16, scale: 3 })
  qtyDelta: string;

  @Column({ name: 'kg_delta', type: 'decimal', precision: 16, scale: 3, default: 0 })
  kgDelta: string;

  /** ₹ per unit for an addition (default: the batch cost); a reduction leaves at the batch cost. */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 16, scale: 4, nullable: true })
  unitCost: string | null;

  /** Value moved, set at approval. */
  @Column({ name: 'value_delta', type: 'decimal', precision: 18, scale: 2, nullable: true })
  valueDelta: string | null;

  @Column({ type: 'varchar', length: 30 })
  reason: string;

  @Column({ type: 'text', nullable: true })
  remark: string | null;

  @Column({ type: 'varchar', length: 10, default: 'PENDING' })
  status: AdjustmentStatus;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  requestedBy: string | null;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'decision_remark', type: 'text', nullable: true })
  decisionRemark: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/**
 * C9 — Repack / unit conversion within one batch: N units (and their kg) of
 * the from-batch become M units of another unit in the same batch no; the
 * value carries across and the kg difference is the repack loss.
 */
@Entity('stock_repack')
@Index('IDX_stock_repack_status', ['status', 'createdAt'])
export class StockRepack {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'repack_no', type: 'varchar', length: 40, nullable: true })
  repackNo: string | null;

  @Column({ name: 'stock_batch_id', type: 'uuid' })
  stockBatchId: string;

  @Column({ name: 'from_qty', type: 'decimal', precision: 16, scale: 3 })
  fromQty: string;

  @Column({ name: 'from_kg', type: 'decimal', precision: 16, scale: 3, default: 0 })
  fromKg: string;

  @Column({ name: 'to_uom_id', type: 'uuid' })
  toUomId: string;

  @Column({ name: 'to_qty', type: 'decimal', precision: 16, scale: 3 })
  toQty: string;

  @Column({ name: 'to_kg', type: 'decimal', precision: 16, scale: 3, default: 0 })
  toKg: string;

  /** from_kg − to_kg (repack weight loss). */
  @Column({ name: 'loss_kg', type: 'decimal', precision: 16, scale: 3, default: 0 })
  lossKg: string;

  /** Value carried from the from-unit to the to-unit, set at approval. */
  @Column({ name: 'value', type: 'decimal', precision: 18, scale: 2, nullable: true })
  value: string | null;

  @Column({ type: 'text', nullable: true })
  remark: string | null;

  @Column({ type: 'varchar', length: 10, default: 'PENDING' })
  status: AdjustmentStatus;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  requestedBy: string | null;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'decision_remark', type: 'text', nullable: true })
  decisionRemark: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
