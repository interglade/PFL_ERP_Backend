import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * "Not needed" mark on an optional receiving step (Phase D-8): the Dump
 * Register or the Return To Vendor of a source was intentionally skipped.
 * Informational only — the receiving `done` rule (an Inward counts and every
 * product's difference is 0) is unchanged. One row per source + step; un-skip
 * deletes the row.
 */
@Entity('receiving_skip')
@Unique('uq_receiving_skip_source_doc', ['sourceType', 'sourceId', 'docType'])
@Index('idx_receiving_skip_source', ['sourceType', 'sourceId'])
export class ReceivingSkip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** `grn` | `stock-transfer-dc` | `rbc` */
  @Column({ name: 'source_type', type: 'varchar', length: 32 })
  sourceType: string;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  /** `dump` | `rtv` */
  @Column({ name: 'doc_type', type: 'varchar', length: 16 })
  docType: string;

  /** employees.id of the user who skipped the step (no FK: the mark outlives user changes). */
  @Column({ name: 'skipped_by', type: 'uuid', nullable: true })
  skippedBy: string | null;

  @CreateDateColumn({ name: 'skipped_at', type: 'timestamp' })
  skippedAt: Date;
}
