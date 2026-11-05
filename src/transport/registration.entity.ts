import { Column, JoinColumn, ManyToOne } from 'typeorm';
import Model from '../global/model.entity';
import { Status } from '../utils/status.enum';
import { User } from '../employee/entity/user.entity';

/**
 * Columns shared by the Transporter, Vehicle and Driver registrations: the same
 * draft → pending → approved / rejected life cycle and creator / approver links
 * the Farmer and Vendor registrations use.
 */
export abstract class RegistrationModel extends Model {
  @Column({
    type: 'enum',
    enum: Status,
    default: Status.PENDING,
    name: 'status',
  })
  status: Status;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by' })
  approvedBy: User;

  @Column({ type: 'text', nullable: true })
  remarks: string;
}
