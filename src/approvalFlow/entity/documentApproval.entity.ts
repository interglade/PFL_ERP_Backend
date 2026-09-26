import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import Model from '../../global/model.entity';

import { Departments } from '../entity/deparmentforapproval.entity';

// import { DocumentApprovalComment } from './documentComment.entity';
import { dateTransformer } from '../../utils/dateTransformer';
import { User } from '../../employee/entity/user.entity';
import { DocumentDefinition } from '../../documentDef/entity/documentdef.entity';

export enum DocumentApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  IN_PROGRESS = 'IN_PROGRESS',
  ESCALATED = 'ESCALATED',
}

export enum ApprovalStage {
  CREATE_LEVEL= 'CREATE_LEVEL',
  FIRST_LEVEL = 'FIRST_LEVEL',
  SECOND_LEVEL = 'SECOND_LEVEL',
  COMPLETED = 'COMPLETED',
}

@Entity('document_approvals')
export class DocumentApprove extends Model {
  @Column({
    type: 'enum',
    enum: DocumentApprovalStatus,
    default: DocumentApprovalStatus.PENDING,
  })
  approvalStatus: DocumentApprovalStatus;

  @Column({
    type: 'enum',
    enum: ApprovalStage,
    default: ApprovalStage.CREATE_LEVEL,
  })
  currentStage: ApprovalStage;

  @Column({ nullable: true })
  documentRefId: string;

  @Column({ default: false })
  isEscalated: boolean;
 @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;
  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'requested_by_id' })
  requestedBy: User;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'authorised_by_id' })
  authorisedBy: User;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'verified_by_id' })
  verifiedBy: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'rejected_by_id' })
  rejectedBy: User;

  @Column({ nullable: true })
  rejectionReason: string;

  @ManyToOne(() => DocumentDefinition)
  @JoinColumn({ name: 'document_definition_id' })
  documentdef: DocumentDefinition;

  @Column({ type: 'timestamp', nullable: true, transformer: dateTransformer })
  authorisedAt: Date;

  @Column({ type: 'timestamp', nullable: true, transformer: dateTransformer })
  verifiedAt: Date;

  @Column({ type: 'timestamp', nullable: true, transformer: dateTransformer })
  rejectedAt: Date;

  @Column({ type: 'timestamp', nullable: true, transformer: dateTransformer })
  escalationDeadline: Date;

  // @OneToMany(
  //   () => DocumentApprovalComment,
  //   (comment) => comment.documentApproval,
  // )
  // comments: DocumentApprovalComment[];

  @Column({ nullable: true })
  currentApproverId: string;
  @Column({ nullable: true })
  isUpdated?: boolean;
}
