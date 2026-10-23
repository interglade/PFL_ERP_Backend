import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type StockMovementType =
  | 'INWARD_PURCHASE'
  | 'INWARD_TRANSFER'
  | 'INWARD_RETURN'
  | 'DC_CUSTOMER'
  | 'DC_TRANSFER'
  | 'DC_OTHER'
  | 'SECOND_SALE'
  | 'REPACK_OUT'
  | 'REPACK_IN'
  | 'ADJUSTMENT'
  | 'OPENING';

/**
 * Append-only movement ledger (one row per batch per document line). Rows are
 * never updated or deleted; `doc_no` is kept as text so history survives a
 * deleted document.
 */
@Entity('stock_ledger')
@Index('IDX_stock_ledger_batch', ['stockBatchId', 'postedAt'])
@Index('IDX_stock_ledger_doc', ['docType', 'docId'])
@Index('IDX_stock_ledger_place', ['companyId', 'locationId', 'productId', 'postedAt'])
export class StockLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'posted_at', type: 'timestamptz', default: () => 'now()' })
  postedAt: Date;

  @Column({ name: 'posted_by', type: 'uuid', nullable: true })
  postedBy: string | null;

  @Column({ name: 'stock_batch_id', type: 'uuid' })
  stockBatchId: string;

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

  @Column({ name: 'stock_type', type: 'varchar', length: 10 })
  stockType: string;

  @Column({ name: 'movement_type', type: 'varchar', length: 30 })
  movementType: StockMovementType;

  @Column({ name: 'doc_type', type: 'varchar', length: 60 })
  docType: string;

  @Column({ name: 'doc_id', type: 'uuid', nullable: true })
  docId: string | null;

  @Column({ name: 'doc_no', type: 'varchar', length: 120, nullable: true })
  docNo: string | null;

  @Column({ name: 'doc_line_id', type: 'uuid', nullable: true })
  docLineId: string | null;

  @Column({ name: 'qty_in', type: 'decimal', precision: 16, scale: 3, default: 0 })
  qtyIn: string;

  @Column({ name: 'qty_out', type: 'decimal', precision: 16, scale: 3, default: 0 })
  qtyOut: string;

  @Column({ name: 'kg_in', type: 'decimal', precision: 16, scale: 3, default: 0 })
  kgIn: string;

  @Column({ name: 'kg_out', type: 'decimal', precision: 16, scale: 3, default: 0 })
  kgOut: string;

  @Column({ name: 'value_in', type: 'decimal', precision: 18, scale: 2, default: 0 })
  valueIn: string;

  @Column({ name: 'value_out', type: 'decimal', precision: 18, scale: 2, default: 0 })
  valueOut: string;

  /** Batch balance after this movement. */
  @Column({ name: 'qty_after', type: 'decimal', precision: 16, scale: 3, default: 0 })
  qtyAfter: string;

  @Column({ name: 'kg_after', type: 'decimal', precision: 16, scale: 3, default: 0 })
  kgAfter: string;

  @Column({ name: 'value_after', type: 'decimal', precision: 18, scale: 2, default: 0 })
  valueAfter: string;

  @Column({ type: 'text', nullable: true })
  remark: string | null;
}
