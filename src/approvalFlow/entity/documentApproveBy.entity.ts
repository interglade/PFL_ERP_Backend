// import { Column, Entity } from 'typeorm';
// import { ApprovalStageInfo } from './approvalname.entity';
// import Model from './model.entity';
// import { nullable } from 'zod';

// @Entity('documents_approve_by_whom')
// export class DocumentApprovalFlow extends Model {
//   @Column(() => ApprovalStageInfo, { prefix: 'first_finalized' })
//   firstFinalized: ApprovalStageInfo;

//   @Column(() => ApprovalStageInfo, { prefix: 'second_finalized' })
//   secondFinalized: ApprovalStageInfo;

//   @Column(() => ApprovalStageInfo, { prefix: 'first_approved' })
//   firstApproved: ApprovalStageInfo;

//   @Column(() => ApprovalStageInfo, { prefix: 'second_approved' })
//   secondApproved: ApprovalStageInfo;

//   @Column(() => ApprovalStageInfo, { prefix: 'third_approved' })
//   thirdApproved: ApprovalStageInfo;

//   @Column(() => ApprovalStageInfo, { prefix: 'verified' })
//   verified: ApprovalStageInfo;
//   document: import("d:/Interglade/Prime Fresh/primefresh-backend/primefresh1/primefresh1/src/entities/docuemnt.entity").Documentb;
// }


import { Entity, JoinColumn, OneToOne } from 'typeorm';
import { ApprovalStageInfo } from '../entity/approvalname.entity';
import Model from '../../global/model.entity';

@Entity('documents_approve_by_whom')
export class DocumentApprovalFlow extends Model {
  @OneToOne(() => ApprovalStageInfo, { cascade: true, nullable: true })
  @JoinColumn({ name: 'verified_id' })
  verified: ApprovalStageInfo;

  @OneToOne(() => ApprovalStageInfo, { cascade: true, nullable: true })
  @JoinColumn({ name: 'first_finalized_id' })
  firstFinalized: ApprovalStageInfo;

  @OneToOne(() => ApprovalStageInfo, { cascade: true, nullable: true })
  @JoinColumn({ name: 'second_finalized_id' })
  secondFinalized: ApprovalStageInfo;

  @OneToOne(() => ApprovalStageInfo, { cascade: true, nullable: true })
  @JoinColumn({ name: 'first_approved_id' })
  firstApproved: ApprovalStageInfo;

  @OneToOne(() => ApprovalStageInfo, { cascade: true, nullable: true })
  @JoinColumn({ name: 'second_approved_id' })
  secondApproved: ApprovalStageInfo;

  @OneToOne(() => ApprovalStageInfo, { cascade: true, nullable: true })
  @JoinColumn({ name: 'third_approved_id' })
  thirdApproved: ApprovalStageInfo;
}

