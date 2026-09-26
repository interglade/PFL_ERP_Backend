import {
    Entity,
    Column,
    
    OneToMany,
    ManyToOne,
    JoinColumn,
  } from 'typeorm';

import Model from '../../../global/model.entity';

import { Department, Status } from '../../../utils/status.enum';
import { Company } from '../../../company/entity/company.entity';
import { GRN } from '../../../grn/entity/grn.entity';
import { MVItems } from './mvoucher.entity';
import { DeliveryChallanPurchase } from '../../../deliveryChallans/deliverychllan/entity/deliveryChallan.entity';
import { User } from '../../../employee/entity/user.entity';
import { Branches } from '../../../branch/entity/branches.entity';

 
  
  @Entity("multiple_cash_voucher")
  export class CashVoucher  extends Model{
    @Column({
      type: 'enum',
      enum: Department,
      nullable: true
    })
    requestingDepartment: Department;

  
   @ManyToOne(() => Company, {cascade: true,nullable: true,onDelete: "SET NULL" })
   @JoinColumn({name: "company_id"})
    companyName: Company;
    @ManyToOne(() => GRN, {nullable:true,onDelete: "SET NULL",cascade:true})
    @JoinColumn({ name: "grn_id" })
    grnNo: GRN;
  
    @Column({nullable:true})
    debitCreditTo: string;
    @Column({nullable:true})
    voucherNo: string;
  
    @Column({nullable:true})
    payReceivedFrom: string;
  
    @ManyToOne(() => Branches, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'location_id' })
    location: Branches;
  
    @OneToMany(() => MVItems, (mvItem) => mvItem.cashVoucher, {
      onDelete: "SET NULL",
      cascade:true,
      nullable: true,
    })
    particulars: MVItems[]; 
    @ManyToOne(() => DeliveryChallanPurchase, { nullable: true,onDelete: "SET NULL" ,cascade:true})
    @JoinColumn({ name: "delivery_challan_id" }) 
    challanNo: DeliveryChallanPurchase;
    
    @Column('decimal', { precision: 10, scale: 2, nullable: true })
    totalAmt: number;
  
    @Column({nullable:true})
    amtWords: string;
  
    @Column({nullable:true})
    paymentMode: string;
  
    @Column({nullable:true})
    receiverName: string;
  
    @Column('simple-array', { nullable: true })
    anyAttachment: string[] | null;
     @Column({
      type: "enum",
      enum: Status,
      default: Status.PENDING,
      name: "approval_status",
      nullable:true
    })
    approvalStatus: Status;
    
  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true ,cascade:true}) 
  @JoinColumn({ name: "requested_by_employee_id" })  
  requestedBy: User;
  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true ,cascade:true})
  @JoinColumn({ name: "pass_by_employee_id" }) 
  passBy: User;
  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true ,cascade:true})
  @JoinColumn({ name: "approved_by_employee_id" })  
  approveBy: User;
  @Column({ type: 'text', nullable: true })
  remark: string;

  }
  