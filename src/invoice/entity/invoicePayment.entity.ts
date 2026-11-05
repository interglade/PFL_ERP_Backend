import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import Model from '../../global/model.entity';
import { Invoice } from './invoice.entity';
import { User } from '../../employee/entity/user.entity';
import type { GrnPaymentMode, GrnPaymentType } from '../../grn/grnPayment';

/**
 * One payment received against a Final Invoice (client decision 2026-10-29: part payments exactly
 * like GRN payments, docs/grn-payment-history-plan.md). The payment that clears the balance is Full.
 * A wrong payment is edited or voided, never deleted: a voided payment stays and stops counting.
 */
@Entity('invoice_payments')
@Index('UQ_invoice_payments_invoice_payment_no', ['invoice', 'paymentNo'], { unique: true })
export class InvoicePayment extends Model {
  @ManyToOne(() => Invoice, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  /** 1, 2, 3… per invoice in the order recorded (voided payments keep their number). */
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

  /** The account the money was paid into (free text). */
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
