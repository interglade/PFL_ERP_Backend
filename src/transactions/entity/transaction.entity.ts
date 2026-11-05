import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';
import type { TxnPartyType, TxnPrefix, TxnStatus, TxnSummary, TxnType } from '../transaction.types';

/**
 * One business deal (docs/transaction-tracking-plan.md §5.1, §9.2). The
 * number is prefix + yyMMdd (Asia/Kolkata) + 5-digit serial, issued once and
 * never reused. `stage`, `stage_label`, `status` and `summary` are a cache
 * recomputed by `refreshTransaction`.
 */
@Entity('transactions')
@Unique('UQ_transactions_prefix_date_serial', ['prefix', 'businessDate', 'serial'])
@Index('IDX_transactions_type_status', ['txnType', 'status'])
@Index('IDX_transactions_opened_at', ['openedAt'])
@Index('IDX_transactions_origin', ['originDocType', 'originDocId'])
export class Transaction {
  @PrimaryColumn({ name: 'txn_no', type: 'varchar', length: 13 })
  txnNo: string;

  @Column({ name: 'txn_type', type: 'varchar', length: 20 })
  txnType: TxnType;

  @Column({ type: 'varchar', length: 2 })
  prefix: TxnPrefix;

  /** Business date (Asia/Kolkata) the number was issued on. */
  @Column({ name: 'business_date', type: 'date' })
  businessDate: string;

  @Column({ type: 'int' })
  serial: number;

  @Column({ name: 'origin_doc_type', type: 'varchar', length: 30 })
  originDocType: string;

  @Column({ name: 'origin_doc_id', type: 'uuid' })
  originDocId: string;

  @Index('IDX_transactions_company')
  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  /** Purchase: receiving location; transfer: from-location; sale / other / second: the selling location. */
  @Index('IDX_transactions_location')
  @Column({ name: 'location_id', type: 'uuid', nullable: true })
  locationId: string | null;

  /** Transfer only: the To-location. */
  @Column({ name: 'to_location_id', type: 'uuid', nullable: true })
  toLocationId: string | null;

  @Column({ name: 'party_type', type: 'varchar', length: 20, nullable: true })
  partyType: TxnPartyType | null;

  @Column({ name: 'party_id', type: 'uuid', nullable: true })
  partyId: string | null;

  /** Party name as shown when the deal started (walk-in customers have no master row). */
  @Column({ name: 'party_name', type: 'varchar', length: 255, nullable: true })
  partyName: string | null;

  @Column({ type: 'varchar', length: 12, default: 'Open' })
  status: TxnStatus;

  /** Current step key (first step not done), `done` when closed, `cancelled` when cancelled. */
  @Column({ type: 'varchar', length: 40, default: '' })
  stage: string;

  @Column({ name: 'stage_label', type: 'varchar', length: 80, default: '' })
  stageLabel: string;

  @Column({ name: 'opened_at', type: 'timestamptz', default: () => 'now()' })
  openedAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  /** Cached totals `{ productCount, totalQty, totalKg, totalValue, daysOpen }`. */
  @Column({ type: 'jsonb', nullable: true })
  summary: TxnSummary | null;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
