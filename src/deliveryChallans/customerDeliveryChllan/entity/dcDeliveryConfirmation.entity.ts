import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type DeliveryOutcome = 'DELIVERED_NO_RETURN' | 'DELIVERED_WITH_RETURN';

/**
 * Delivery confirmation of a Customer DC (Phase D-1 / D-3, client decision
 * 2026-10-15): recorded by the app user once the goods are delivered.
 *   - "Delivered – no return": no live RBC exists for the DC.
 *   - "Delivered – with return": the DC's RBC exists and is approved.
 * After it, no RBC can be raised and the Final Invoice may be created.
 * An undo (by an approver of the DC, never by the confirming user, only while
 * no live invoice exists) keeps the row and stamps `undone_*`.
 */
@Entity('dc_delivery_confirmation')
@Index('IDX_dc_delivery_confirmation_dc', ['dcId', 'undoneAt'])
export class DcDeliveryConfirmation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dc_id', type: 'uuid' })
  dcId: string;

  @Column({ type: 'varchar', length: 30 })
  outcome: DeliveryOutcome;

  /** The approved RBC when the outcome is "with return". */
  @Column({ name: 'rbc_id', type: 'uuid', nullable: true })
  rbcId: string | null;

  @Column({ name: 'rbc_no', type: 'varchar', length: 60, nullable: true })
  rbcNo: string | null;

  @Column({ name: 'receiver_name', type: 'varchar', length: 150, nullable: true })
  receiverName: string | null;

  @Column({ type: 'text', nullable: true })
  remark: string | null;

  /** Optional photo / signed DC (URL of an uploaded file). */
  @Column({ name: 'proof_url', type: 'text', nullable: true })
  proofUrl: string | null;

  @Column({ name: 'confirmed_by', type: 'uuid' })
  confirmedBy: string;

  @CreateDateColumn({ name: 'confirmed_at', type: 'timestamptz' })
  confirmedAt: Date;

  @Column({ name: 'undone_by', type: 'uuid', nullable: true })
  undoneBy: string | null;

  @Column({ name: 'undone_at', type: 'timestamptz', nullable: true })
  undoneAt: Date | null;

  @Column({ name: 'undo_reason', type: 'text', nullable: true })
  undoReason: string | null;
}
