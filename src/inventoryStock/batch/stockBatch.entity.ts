import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type StockType = 'FRESH' | 'RETURNED';
export type StockOriginType = 'GRN' | 'TRANSFER' | 'RBC' | 'OPENING' | 'REPACK' | 'ADJUSTMENT' | 'INWARD';

/**
 * Current balance of one batch of one product in one unit at one location
 * (docs/batch-stock-plan.md §4, Phase C1). The quantity is in the unit of the
 * documents that moved it (box, crate, kg …); net kg is kept alongside.
 *
 * `stockKey` is the unique identity: company | location | product | variant |
 * unit | batch no | stock type (NULL variant / unit spelled `-`), so the
 * uniqueness also holds for rows without a variant or a unit.
 */
@Entity('stock_batch')
@Index('IDX_stock_batch_lookup', ['companyId', 'locationId', 'productId', 'variantId', 'uomId', 'stockType'])
@Index('IDX_stock_batch_batch_no', ['batchNo'])
export class StockBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'stock_key', type: 'varchar', length: 400, unique: true })
  stockKey: string;

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
  stockType: StockType;

  @Column({ name: 'origin_type', type: 'varchar', length: 20, nullable: true })
  originType: StockOriginType | null;

  @Column({ name: 'origin_id', type: 'uuid', nullable: true })
  originId: string | null;

  @Column({ name: 'origin_no', type: 'varchar', length: 120, nullable: true })
  originNo: string | null;

  /** On hand, in the unit `uomId`. */
  @Column({ type: 'decimal', precision: 16, scale: 3, default: 0 })
  qty: string;

  /** Held by pending documents (DC / Second Sale / Repack allocations). */
  @Column({ name: 'reserved_qty', type: 'decimal', precision: 16, scale: 3, default: 0 })
  reservedQty: string;

  @Column({ name: 'net_kg', type: 'decimal', precision: 16, scale: 3, default: 0 })
  netKg: string;

  /** ₹ per unit `uomId` (value / qty while qty > 0; last cost otherwise). */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 16, scale: 4, default: 0 })
  unitCost: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  value: string;

  @Column({ name: 'first_in_at', type: 'timestamptz', nullable: true })
  firstInAt: Date | null;

  @Column({ name: 'last_movement_at', type: 'timestamptz', nullable: true })
  lastMovementAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
