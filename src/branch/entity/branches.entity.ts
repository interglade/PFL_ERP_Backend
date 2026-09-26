import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';

import Model from '../../global/model.entity';

import { ApprovalLevel } from '../../approvalFlow/entity/approvalLevel.entity';
import { Address } from '../../address/entity/address.entity';
import { User } from '../../employee/entity/user.entity';
import { GRN } from '../../grn/entity/grn.entity';


export enum BranchType {
  COLLECTION_CENTER = 'collection-center',
  DISTRIBUTION_CENTER = 'distribution-center',
  SEASONAL_COLLECTION_CENTER = 'seasonal-collection-center',
  WAREHOUSE = 'warehouse',
}

@Entity('branches')
export class Branches extends Model {
  @Column()
  name: string;

  @ManyToOne(() => Address, (address) => address.branches, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  address: Address;

  @Column({ nullable: true })
  cFirstName: string;

  @Column({ nullable: true })
  cMiddleName: string;

  @Column({ nullable: true })
  cLastName: string;

  @Column({ nullable: true })
  contactNumber?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ nullable: true })
  totalCapacity: number;
  @Column({ nullable: true })
  currentCapacity: number;
  @Column({ nullable: true })
  balanceCapacity: number;
  @Column({
    type: 'enum',
    enum: BranchType,
    default: BranchType.COLLECTION_CENTER,
  })
  type: BranchType;
  @Column({ type: 'text', nullable: true })
  prefix: string;

  @OneToMany(() => GRN, (grn) => grn.location, { onDelete: 'SET NULL' })
  grns: GRN[];
  // @OneToMany(() => ApprovalLevel, (level) => level.location)
  // approvalLevels: ApprovalLevel[];

  @ManyToOne(() => User, (user) => user.accessLocation, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
