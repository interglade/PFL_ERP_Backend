import { Column, Entity } from 'typeorm';
import Model from '../../global/model.entity';

export enum ApproverStatus {
  HOLD = 'hold',
  APPROVED = 'approved',
  REJECTED = 'reject',
  VERIFIED = 'verified',
  UNVERIFIED = 'unverified',
  FINALIZING = 'FINALIZING',
}
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
