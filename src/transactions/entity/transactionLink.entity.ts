import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/**
 * Transactions connected through batches (§5.1, §9.4): `from_txn` created the
 * batch, `to_txn` consumed it (or, kind `direct-sale`, a Customer DC raised
 * from a GRN delivered straight to the customer). Quantities are summed per
 * batch; `batch_no` is '' when there is none.
 */
@Entity('transaction_links')
@Unique('UQ_transaction_links', ['fromTxn', 'toTxn', 'kind', 'batchNo'])
@Index('IDX_transaction_links_from', ['fromTxn'])
@Index('IDX_transaction_links_to', ['toTxn'])
export class TransactionLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'from_txn', type: 'varchar', length: 13 })
  fromTxn: string;

  @Column({ name: 'to_txn', type: 'varchar', length: 13 })
  toTxn: string;

  /** transferred, sold, sold-other, resold, direct-sale */
  @Column({ type: 'varchar', length: 20 })
  kind: string;

  @Column({ name: 'batch_no', type: 'varchar', length: 100, default: '' })
  batchNo: string;

  @Column({ type: 'decimal', precision: 16, scale: 3, default: 0 })
  qty: string;

  @Column({ name: 'net_kg', type: 'decimal', precision: 16, scale: 3, default: 0 })
  netKg: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
