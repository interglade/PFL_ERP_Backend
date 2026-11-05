import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import Model from '../../global/model.entity';
import { User } from '../../employee/entity/user.entity';
import { InvoicePayment } from './invoicePayment.entity';

export type InvoicePaymentAction = 'recorded' | 'edited' | 'voided';

/** Immutable trail of an invoice payment: who recorded, edited or voided it, what changed and why. */
@Entity('invoice_payment_changes')
export class InvoicePaymentChange extends Model {
  @ManyToOne(() => InvoicePayment, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_payment_id' })
  payment: InvoicePayment;

  @Column({ type: 'varchar', length: 10 })
  action: InvoicePaymentAction;

  /** Edited fields as { field: { oldValue, newValue } }; the full payment for `recorded`. */
  @Column({ type: 'jsonb', nullable: true })
  changes: Record<string, { oldValue: unknown; newValue: unknown }> | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'changed_by_id' })
  changedBy: User | null;
}
