import {
    Entity,

    Column,
    ManyToOne,
    JoinColumn,
    OneToMany,
    OneToOne,

  } from 'typeorm';
import Model from '../../global/model.entity';
import { RFPA } from '../../rfpa/entity/rfpa.entity';
import { Department, Status } from '../../utils/status.enum';
import { User } from '../../employee/entity/user.entity';
import { Company } from '../../company/entity/company.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { Vendor } from '../../vendor/createVendor/entity/vendor.entity';
import { Farmer } from '../../farmer/entity/farmer.entity';
import { PaymentInfoForRFPA } from '../../rfpa/entity/rfpaPayementInfo.entity';
import { DealSlipProduct } from './dealSlipProduct.entity';


  @Entity('deal_slips')
  export class DealSlip extends Model {
   // Relation to RFPA
   @ManyToOne(() => RFPA, { cascade: true,onDelete: "SET NULL"})
   @JoinColumn({ name: 'rfpa_id' })
   rfpa: RFPA; // Relation to RFPA entity

    @Column()
    lotNo: string;

    @Column({ type: 'text', nullable: true })
    approvalNote: string; // Note added when approving or rejecting the GRN

    @Column()
    loadingLocation: string;

    @Column('text', { nullable: true })
    remark: string;

    @Column()
    specialRequest: string;

    @Column({
      type: 'enum',
      enum: Department,
      nullable: true
    })
    requestingDepartment: Department;

    // ── RFPA details, copied when the deal slip is created ───────────────────
    // Read-only afterwards (only the product quantity / unit price can be edited).

    @ManyToOne(() => Company, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'company_id' })
    companyName: Company;

    @ManyToOne(() => Branches, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'purchaselocation_id' })
    purchaseLocation: Branches;

    @ManyToOne(() => Branches, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'purchaseforwhich_id' })
    purchaseForSalesLocation: Branches;

    @Column({ nullable: true })
    otherPurchaseLoc: string;

    @Column({ nullable: true })
    otherPurchaseForSalesLoc: string;

    @Column('character varying', { name: 'delivery_receiving_person', nullable: true })
    deliveryReceivingPerson: string;

    @Column('character varying', { name: 'packing_instruction', nullable: true })
    packingInstruction: string;

    @ManyToOne(() => Vendor, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'vendor_id' })
    selectedVendor: Vendor;

    @ManyToOne(() => Farmer, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'farmer_id' })
    selectedFarmer: Farmer;

    /** 'vendor' | 'farmer' (RFPA's Source enum value) */
    @Column({ type: 'varchar', nullable: true })
    source: string;

    /** A copy of the RFPA's payment info row, so later edits never touch the RFPA's. */
    @OneToOne(() => PaymentInfoForRFPA, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'payment_info_id' })
    paymentInfo: PaymentInfoForRFPA;

    @OneToMany(() => DealSlipProduct, (product) => product.dealSlip)
    dealSlipProducts: DealSlipProduct[];

  // @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true})
  // @JoinColumn({ name: "requested" })  // Define the foreign key column
  // requestedBy: User;

  @Column({
    type: "enum",
    enum: Status,
    default: Status.PENDING,
    name: "approval_status",
  })
  approvalStatus: Status;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  dealSlipCreatedAt: Date; // Column to store creation date and time

  @Column({ type: "timestamp", nullable: true })
  dealSlipApprovedAt: Date; // Column to store approval date and time

    @Column({nullable:true})
    dealSlipNo: string; // Column to store creation date and time
    @Column({ default: false })
  isGrnCreated: boolean;



  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User;

  }
