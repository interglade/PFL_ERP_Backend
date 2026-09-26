import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';

import { ApprovalFlow } from './approvalFlow.entity';
import Model from '../../global/model.entity';
import { ApproverBlock } from './approvalBlock.entity';

@Entity('approval_levels')
export class ApprovalLevel extends Model {
  @ManyToOne(() => ApprovalFlow, (flow) => flow.approvers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'approval_flow_id' })
  approvalFlow: ApprovalFlow;

  @OneToOne(() => ApproverBlock, { cascade: true, nullable: true })
  @JoinColumn({ name: 'first_approver_block_id' }) 
  firstApprover: ApproverBlock;

  @OneToOne(() => ApproverBlock, { cascade: true, nullable: true })
  @JoinColumn({ name: 'second_approver_block_id' }) 
  secondApprover: ApproverBlock;

  @OneToOne(() => ApproverBlock, { cascade: true, nullable: true })
@JoinColumn({ name: 'third_approver_block_id' }) 
  thirdApprover: ApproverBlock;

  @OneToOne(() => ApproverBlock, { cascade: true, nullable: true })
  @JoinColumn({ name: 'fourth_approver_block_id' }) 
  fourthApprover: ApproverBlock;

  @OneToOne(() => ApproverBlock, { cascade: true, nullable: true })
  @JoinColumn({ name: 'fifth_approver_block_id' }) 
  fifthApprover: ApproverBlock;

  @OneToOne(() => ApproverBlock, { cascade: true, nullable: true })
  @JoinColumn({ name: 'sixth_approver_block_id' }) 
  sixthApprover: ApproverBlock;
}
