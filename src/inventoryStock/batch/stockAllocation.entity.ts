import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type AllocationStatus = 'RESERVED' | 'CONSUMED' | 'RELEASED';

/**
 * Which batch a stock-out document line takes, and how much (Phase C3/C4).
 * RESERVED while the document is pending (counted in `stock_batch.reserved_qty`),
 * CONSUMED when it is approved (stock taken out), RELEASED when it is
 * rejected, deleted or its lines are replaced.
 */
@Entity('stock_allocation')
@Index('IDX_stock_allocation_doc', ['docType', 'docId', 'status'])
@Index('IDX_stock_allocation_batch', ['stockBatchId', 'status'])
export class StockAllocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** DocumentTypeEnum value of the document (DC_TYPE_CUSTOMER, second-sale …). */
  @Column({ name: 'doc_type', type: 'varchar', length: 60 })
  docType: string;

  @Column({ name: 'doc_id', type: 'uuid' })
  docId: string;

  @Column({ name: 'doc_no', type: 'varchar', length: 120, nullable: true })
  docNo: string | null;

  /** The document line (e.g. `item.id`). */
  @Column({ name: 'line_id', type: 'uuid', nullable: true })
  lineId: string | null;

  @Column({ name: 'stock_batch_id', type: 'uuid' })
  stockBatchId: string;

  @Column({ name: 'batch_no', type: 'varchar', length: 100 })
  batchNo: string;

  @Column({ type: 'decimal', precision: 16, scale: 3 })
  qty: string;

  /** Net kg of the line that goes with this allocation (share of the line by quantity). */
  @Column({ name: 'net_kg', type: 'decimal', precision: 16, scale: 3, default: 0 })
  netKg: string;

  /** Batch unit cost when consumed (₹ per unit). */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 16, scale: 4, nullable: true })
  unitCost: string | null;

  @Column({ type: 'varchar', length: 10, default: 'RESERVED' })
  status: AllocationStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
