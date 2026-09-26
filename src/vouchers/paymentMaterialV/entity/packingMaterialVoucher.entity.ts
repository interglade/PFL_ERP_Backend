import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    OneToMany,
    ManyToOne,
    JoinColumn,
  } from 'typeorm';

import { Materials } from './material.entity';
import Model from '../../../global/model.entity';

import { Department, Status } from '../../../utils/status.enum';
import { truncate } from 'fs';
import { GRN } from '../../../grn/entity/grn.entity';
import { Address } from '../../../address/entity/address.entity';
import { Company } from '../../../company/entity/company.entity';
import { User } from '../../../employee/entity/user.entity';
import { Branches } from '../../../branch/entity/branches.entity';

 
  @Entity("packing_material_payment")
  export class PMPVoucher extends Model {
   
    @Column({nullable:true})
    voucherNo: string;
    @ManyToOne(() => GRN, {nullable:true,onDelete: "SET NULL"})
    @JoinColumn({ name: "grn_id" })
    grnNo: GRN;
    @Column({
      type: "enum",
      enum: Status,
      default: Status.PENDING,
      name: "approval_status",
      nullable:true
    })
    approvalStatus: Status;
    @Column({nullable:true})
    debitCreditTo: string;
  
    @Column({nullable:true})
    payReceivedFrom: string;
  
  
    @Column({nullable:true})
    sellerName: string;
  
    @ManyToOne(() => Address, { onDelete: "SET NULL",cascade:true, nullable: true })
    @JoinColumn({name:'address_id'})
    address: Address;
  
    @Column({nullable:true})
    contactNo: string;
  
    @Column({ nullable: true })
    altContactNo: string;
  
    @Column({nullable:true})
    purpose: string;
  
    @OneToMany(() => Materials, (materials) => materials.pmVoucher, { onDelete: "SET NULL", nullable: true ,cascade:true})
    materials: Materials[];
  
    @Column({nullable:true})
    paymentMode: string;
  
    // @Column('decimal', { precision: 10, scale: 2 , nullable: true})
    // ratePerLabour: number;
  
    @Column('decimal', { precision: 10, scale: 2 , nullable: true})
    totalAmt: number;
  
    @Column({nullable:true})
    amtWords: string;
  
    @Column({nullable:true})
    receiverName: string;
    @Column({nullable:true})
    kyc: boolean;
    
    @Column('simple-array', { nullable: true })
    anyAttachment: string[] | null;

    @Column({
      type: 'enum',
      enum: Department,
      nullable: true
    })
    requestingDepartment: Department;
    @ManyToOne(() => Company, {cascade: true,nullable: true,onDelete: "SET NULL" })
    @JoinColumn({name: "company_id"})
     companyName: Company;
    
   

       // Many-to-One relation with Employee (requested by)
  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "requested_by_employee_id" })  // Define the foreign key column
  requestedBy: User;
  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "pass_by_employee_id" })  // Define the foreign key column
  passBy: User;
  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "approved_by_employee_id" })  // Define the foreign key column
  approveBy: User;
  @Column({ type: 'text', nullable: true })
  remark: string;

  @ManyToOne(() => Branches, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'location_id' })
  location: Branches;

  }
  