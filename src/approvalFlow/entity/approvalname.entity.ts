import { Column, Entity } from 'typeorm';
import Model from '../../global/model.entity';

/** One approver's decision at one step (verifier, approver levels, finalizers); Hold until they act. */
export enum ApproverStatus {
  HOLD = 'Hold',
  APPROVED = 'Approved',
  REJECTED = 'Rejected',
}

/** The decision an approve request names: exactly Approved or Rejected. */
export const parseApproverDecision = (input: unknown): ApproverStatus.APPROVED | ApproverStatus.REJECTED | undefined =>
  input === ApproverStatus.APPROVED || input === ApproverStatus.REJECTED ? input : undefined;
@Entity('approval_stage_info')
export class ApprovalStageInfo extends Model {
  @Column({ nullable: true })
  userId: string;

  @Column({ nullable: true })
  userName: string;

  @Column({ type: 'enum', enum: ApproverStatus, default: ApproverStatus.HOLD })
  status: ApproverStatus;

  @Column({ nullable: true })
  reason: string;

  @Column({ type: 'timestamp', nullable: true })
  statusChangedAt: Date;
}
