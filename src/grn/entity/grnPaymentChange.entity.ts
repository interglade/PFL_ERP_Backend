import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import Model from '../../global/model.entity';
import { User } from '../../employee/entity/user.entity';
import { GrnPayment } from './grnPayment.entity';

export type GrnPaymentAction = 'recorded' | 'edited' | 'voided';

/** Immutable trail of a GRN payment: who recorded, edited or voided it, what changed and why. */
@Entity('grn_payment_changes')
export class GrnPaymentChange extends Model {
  @ManyToOne(() => GrnPayment, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grn_payment_id' })
  payment: GrnPayment;

  @Column({ type: 'varchar', length: 10 })
  action: GrnPaymentAction;

  /** Edited fields as { field: { oldValue, newValue } }; the full payment for `recorded`. */
  @Column({ type: 'jsonb', nullable: true })
  changes: Record<string, { oldValue: unknown; newValue: unknown }> | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'changed_by_id' })
  changedBy: User | null;
}
