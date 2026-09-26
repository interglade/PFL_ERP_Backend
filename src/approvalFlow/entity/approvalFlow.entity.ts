import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  ManyToMany,
  JoinTable,
  OneToOne,
} from 'typeorm';

import { ApprovalLevel } from './approvalLevel.entity';
// import { ApprovalVerifier } from './approvalVerifier.entity';
import { FinalizerBlock } from './finalizerBlock.entity';
import { DocumentTypeEnum } from '../../documentDef/entity/documentdef.entity';
import { User } from '../../employee/entity/user.entity';
import Model from '../../global/model.entity';


@Entity('approval_flows')
export class ApprovalFlow extends Model {
  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'creator_id' })
  creator: User;

  @Column({
    type: 'enum',
    enum: DocumentTypeEnum,
    nullable: true,
  })
  type: DocumentTypeEnum;

  @ManyToMany(() => User, { cascade: true })
  @JoinTable({
    name: 'approval_flow_verifiers',
    joinColumn: { name: 'approval_flow_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'user_id', referencedColumnName: 'id' },
  })
  verifiers: User[];

  @ManyToOne(() => ApprovalLevel, (level) => level.approvalFlow, {
    ///cascade: true,
  })
  @JoinColumn({ name: 'approval_level_id' })
  approvers: ApprovalLevel;

  @OneToOne(() => FinalizerBlock, { cascade: true, nullable: true })
  @JoinColumn({ name: 'finalizer_block_id' })
  finalizers: FinalizerBlock;
}
