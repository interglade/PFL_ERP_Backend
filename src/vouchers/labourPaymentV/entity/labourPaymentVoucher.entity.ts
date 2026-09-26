import {
    Entity,
    Column,
   
    ManyToOne,
    JoinColumn,
  } from 'typeorm';

import Model from '../../../global/model.entity';

import { Department, Status } from '../../../utils/status.enum';

import { format } from 'date-fns-tz';
import { GRN } from '../../../grn/entity/grn.entity';
import { User } from '../../../employee/entity/user.entity';
import { Company } from '../../../company/entity/company.entity';
import { Branches } from '../../../branch/entity/branches.entity';
  
  @Entity("labour_payment_voucher")
  export class LPVoucher  extends Model {
    @Column({nullable:true})
    voucherNo: string;
    @Column({
      type: "enum",
      enum: Status,
      default: Status.PENDING,
      name: "approval_status",
      nullable:true
    })
    approvalStatus: Status;
    @ManyToOne(() => GRN, {nullable:true,onDelete: "SET NULL"})
    @JoinColumn({ name: "grn_id" })
    grnNo: GRN;
  
    @Column({nullable:true})
    debitCreditTo: string;
  
    @Column({nullable:true})
    payReceivedFrom: string;
  
    @ManyToOne(() => Branches, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'location_id' })
    location: Branches;
  
    @Column('int',{nullable:true})
    noOfLabours: number;
  
    @Column({nullable:true, type: 'date', 
    //   transformer: {
    //   to: (value: Date) => value, 
    //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
    // },
  })
    loadingDate: Date;
  
    // @Column({nullable:true})
    // workLocation: string;
  
    @Column({nullable:true})
    contactNo: string;
  
    @Column({ nullable: true })
    altContactNo: string;
  
    @Column({nullable:true})
    products: string;
  
    @Column({nullable:true})
    paymentMode: string;
  
    @Column('decimal', { precision: 10, scale: 2 , nullable: true})
    ratePerLabour: number;
  
    @Column('decimal', { precision: 10, scale: 2 , nullable: true})
    totalAmt: number;
  
    @Column({nullable:true})
    amtWords: string;
    @Column({nullable:true})
    receiverName: string;
    @Column({nullable:true})
    kyc: boolean;
    


   
  
    // Many-to-One relation with Employee (requested by)
  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true,cascade:true })
  @JoinColumn({ name: "requested_by_employee_id" })  // Define the foreign key column
  requestedBy: User;

  
  @Column('simple-array', { nullable: true })
  anyAttachment: string[] | null;

  @Column({
    type: 'enum',
    enum: Department,
    nullable: true
  })
  requestingDepartment: Department;
  // @Column({
  //   // type: 'enum',
  //   // enum: CompanyName,
  //   nullable: true
  // })
  // companyName: string;
   @ManyToOne(() => Company, {cascade: true,nullable: true,onDelete: "SET NULL" })
     @JoinColumn({name: "company_id"})
      companyName: Company;
    @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "pass_by_employee_id" })  // Define the foreign key column
  passBy: User;
  @ManyToOne(() => User, {onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "approved_by_employee_id" })  // Define the foreign key column
  approveBy: User;
  @Column({ type: 'text', nullable: true })
  remark: string;
  }
  