import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import Model from '../../global/model.entity';
import { GRN } from './grn.entity';
import { User } from '../../employee/entity/user.entity';
import type { GrnPaymentMode, GrnPaymentType } from '../grnPayment';

/**
 * One payment made to the GRN's vendor or farmer (docs/grn-payment-history-plan.md). A GRN can be
 * paid in several partial payments; the one that clears the balance is Full. A wrong payment is
 * edited or voided, never deleted: a voided payment stays in the history and stops counting.
 */
@Entity('grn_payments')
@Index('UQ_grn_payments_grn_payment_no', ['grn', 'paymentNo'], { unique: true })
export class GrnPayment extends Model {
  @ManyToOne(() => GRN, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grn_id' })
  grn: GRN;

  /** 1, 2, 3… per GRN in the order recorded (voided payments keep their number). */
  @Column({ name: 'payment_no', type: 'int' })
  paymentNo: number;

  @Column({ name: 'payment_date', type: 'date' })
  paymentDate: string;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  amount: number;

  /** Set by the server: `full` for the payment that brings the balance to 0, else `partial`. */
  @Column({ name: 'payment_type', type: 'varchar', length: 10, default: 'partial' })
  paymentType: GrnPaymentType;

  @Column({ name: 'payment_mode', type: 'varchar', length: 50 })
  paymentMode: GrnPaymentMode;

  /** The vendor's / farmer's account the money went to (free text: the masters don't hold it). */
  @Column({ name: 'paid_to_account_no', type: 'varchar', length: 34, nullable: true })
  paidToAccountNo: string | null;

  @Column({ name: 'paid_to_ifsc', type: 'varchar', length: 11, nullable: true })
  paidToIfsc: string | null;

  @Column({ name: 'paid_to_bank_name', type: 'varchar', length: 150, nullable: true })
  paidToBankName: string | null;

  /** UTR / cheque no / UPI reference. */
  @Column({ name: 'reference_no', type: 'varchar', length: 100, nullable: true })
  referenceNo: string | null;

  @Column({ type: 'text', nullable: true })
  remarks: string | null;

  /** Balance left after this payment, in payment order; set by the server. */
  @Column({ name: 'balance_after', type: 'numeric', precision: 15, scale: 2, default: 0 })
  balanceAfter: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recorded_by_id' })
  recordedBy: User | null;

  @Column({ name: 'voided_at', type: 'timestamp', nullable: true })
  voidedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'voided_by_id' })
  voidedBy: User | null;

  @Column({ name: 'void_reason', type: 'text', nullable: true })
  voidReason: string | null;
}
