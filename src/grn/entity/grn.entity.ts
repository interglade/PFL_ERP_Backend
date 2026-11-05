import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
} from 'typeorm';

import { GrnProduct } from './grnProduct.entity';

import { toZonedTime } from 'date-fns-tz';
import { parse, format } from 'date-fns';
import Model from '../../global/model.entity';
import { Company } from '../../company/entity/company.entity';
import { User } from '../../employee/entity/user.entity';
import { GrnPaymentStatus, Source } from '../../utils/status.enum';
import { DealSlip } from '../../dealSlip/entity/dealSlip.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { Vendor } from '../../vendor/createVendor/entity/vendor.entity';
import { Farmer } from '../../farmer/entity/farmer.entity';
import { PaymentInfoForGRN } from './grnPaymentInfo.entity';
import { Levels } from '../../levels/entity/levels.entity';


export enum PurchaseType {
  FixedPriceSales = 'fixed price sales',
  ConsignmentSalesBikri = 'consignment sales / bikri',
  MGPSales = 'mgp sales',
}
export enum LocationType {
  CC = 'cc',
  DC = 'dc',
}

export enum GrnType {
  Tranfer = 'transfer',
  Purchase = 'purchase',
}

/**
 * Where the goods physically go; it drives the workflow and the colour of the GRN print
 * (`cc` red, `dc` and `direct-to-customer` green). `cc` and `dc` GRNs are received at that
 * centre (AQR / Inward / Dump / RTV); `direct-to-customer` GRNs bypass the centres and never
 * appear on the Arrivals worklist or in the receiving pickers.
 */
export enum GrnDeliveryMode {
  CC = 'cc',
  DC = 'dc',
  DIRECT_TO_CUSTOMER = 'direct-to-customer',
}

/** Modes whose goods are received at a collection / distribution centre. */
export const CENTRE_DELIVERY_MODES: readonly GrnDeliveryMode[] = [GrnDeliveryMode.CC, GrnDeliveryMode.DC];

@Entity('grns')
// Dashboard / report filters
@Index(['createdAt'])
@Index(['companyName'])
@Index(['purchaseLocation'])
@Index(['createdBy'])
// Batch no lookups per company. Uniqueness (one live, non-rejected GRN per
// company + batch no) is enforced by GrnService.assertBatchNoUnique: a rejected
// GRN must release its batch no, which a partial index cannot express.
@Index('IDX_grns_company_batch_no', ['companyName', 'batchNo'])
export class GRN extends Model {
  /** Transaction number of the deal this document belongs to (docs/transaction-tracking-plan.md §9). */
  @Index('IDX_grns_txn_no')
  // Written only by src/transactions (raw SQL); never from a request body through an entity save.
  @Column({ name: 'txn_no', type: 'varchar', length: 13, nullable: true, insert: false, update: false })
  txnNo: string | null;

  @ManyToOne(() => Company, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'company_id' })
  companyName: Company;

  // @Column({ nullable: true })
  // purchaseInstructionsBy: string;
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'purchaseInstructionsBy_id' })
  purchaseInstructionsBy: User;

  @Column({ nullable: true })
  grnNo: string;

  /** Typed by the user (alphanumeric); required on new GRNs; unique per company among live, non-rejected GRNs. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  batchNo: string | null;

  /** Σ line gross weight (kg). Calculated by the backend on create / update. */
  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  totalGrossWeight: number | null;

  /** Σ line net weight (kg). Calculated by the backend on create / update. */
  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  totalNetWeight: number | null;

  @Column({
    type: 'enum',
    nullable: true,
    enum: LocationType,
  })
  locationType: LocationType;

  @Column({
    type: 'enum',
    nullable: true,
    enum: GrnType,
  })
  grnType: GrnType;

  @Column({
    type: 'enum',
    nullable: true,
    enum: PurchaseType,
  })
  purchaseType: PurchaseType;

  @Column({
    type: 'enum',
    enum: GrnDeliveryMode,
    default: GrnDeliveryMode.CC,
    nullable: false,
  })
  deliveryMode: GrnDeliveryMode;

  @ManyToOne(() => DealSlip, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'deal_slip_id' })
  dealSlipId: DealSlip;

  @Column({ nullable: true })
  securityPerson: string;

  @Column({ nullable: true })
  specialReq: string;

  @ManyToOne(() => Branches, {
    nullable: true,
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'purchaselocation_id' })
  purchaseLocation: Branches;

  @ManyToOne(() => Branches, {
    nullable: true,
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'purchaseforwhich_id' })
  purchaseForSalesLocation: Branches;

  @Column({ nullable: true })
  otherPurchaseLoc: string;

  @Column({ nullable: true })
  otherPurchaseForSalesLoc: string;

  @Column({
    type: 'enum',
    enum: Source,
    nullable: true,
  })
  source: Source;

  @ManyToOne(() => Vendor, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'vendor_id' })
  selectedVendor: Vendor;

  @ManyToOne(() => Farmer, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'farmer_id' })
  selectedFarmer: Farmer;

  @Column({ nullable: true })
  billNo: string;

  @Column({ nullable: true })
  billImage: string;

  @Column('decimal', { precision: 12, scale: 2, default: 0, nullable: true })
  subTotalAmt: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0, nullable: true })
  freight: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0, nullable: true })
  otherCharges: number;

  @Column('decimal', { precision: 12, scale: 2, nullable: true })
  totalAmt: number;

  @Column({ nullable: true })
  amtWords: string;

  @Column({ nullable: true })
  purchasedBy: string;

  @Column({ nullable: true })
  approvalNote: string;

@Column({
  type: 'timestamp',
  nullable: true,
  transformer: {
    from: (value: string | null) => {
      if (!value) return null;
      try {
        const istDate = toZonedTime(new Date(value), 'Asia/Kolkata');
        return format(istDate, 'HH:mm');
      } catch (error) {
        console.error('Date transformation error (from DB):', error);
        return null;
      }
    },
    to: (value: string | null) => {
      if (!value) return null;
      try {
        // handle both '11:43' (24h) and '11:43 am' formats without relying on date-fns parse overloads
        let parsedDate: Date | null = null;
        const input = value.trim();
        const lower = input.toLowerCase();

        if (lower.includes('am') || lower.includes('pm')) {
          // match "h:mm am/pm" or "hh:mm am/pm"
          const match = input.match(/^\s*(\d{1,2}):(\d{2})\s*(am|pm)\s*$/i);
          if (match) {
            let hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const meridiem = match[3].toLowerCase();
            if (meridiem === 'pm' && hours !== 12) hours += 12;
            if (meridiem === 'am' && hours === 12) hours = 0;
            parsedDate = new Date();
            parsedDate.setHours(hours, minutes, 0, 0);
          }
        } else {
          // match "HH:mm" (24-hour)
          const match = input.match(/^\s*(\d{1,2}):(\d{2})\s*$/);
          if (match) {
            const hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            parsedDate = new Date();
            parsedDate.setHours(hours, minutes, 0, 0);
          }
        }

        if (!parsedDate) {
          // fallback: try to construct Date directly
          parsedDate = new Date(input);
          if (isNaN(parsedDate.getTime())) {
            throw new Error('Unable to parse time input: ' + value);
          }
        }

        const istDate = toZonedTime(parsedDate, 'Asia/Kolkata');
        return format(istDate, 'yyyy-MM-dd HH:mm:ss');
      } catch (error) {
        console.error('Date transformation error (to DB):', error);
        return null;
      }
    },
  },
})
timeIn: string | null;


  @Column('int', { nullable: true })
  cratesIn: number;

  /** Person who received the delivery. (Formerly `delivery_receiving_person`.) */
  @Column({ type: 'varchar', nullable: true })
  receivingPerson: string;

  @Column({ name: 'rmn', nullable: true })
  rmn: string;

  @OneToMany(() => GrnProduct, (grnProduct) => grnProduct.grn, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'grnProduct_id' })
  grnProducts: GrnProduct[];

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdby_id' })
  createdBy: User;

  @Column({ type: 'text', nullable: true })
  remark: string;

  // @OneToMany(() => Requests, (request) => request, {
  //   cascade: true,
  //   onDelete: 'SET NULL',
  // })
  // requests: Requests[];

  @ManyToOne(() => Levels, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'current_level_id' })
  currentLevel: Levels;

  @OneToOne(() => PaymentInfoForGRN, { onDelete: 'SET NULL', cascade: true })
  @JoinColumn({ name: 'payment_info_id' })
  paymentInfo: PaymentInfoForGRN;

  @Column({ default: false })
  isAQRCreated: boolean;
  
   @Column({ default: false })
  isInwardCreated: boolean;

   @Column({ default: false })
  isDumpCreated: boolean;

   @Column({ default: false })
  isDCForCustomerCreated: boolean;

   @Column({ default: false })
  isMCVoucherCreated: boolean;

   @Column({ default: false })
  isTPVoucherCreated: boolean;

   @Column({ default: false })
  isPMPVoucherCreated: boolean;

   @Column({ default: false })
    isLPVoucherCreated: boolean;

  /**
   * A live Purchase vehicle dispatch (not deleted, approval not rejected) exists for
   * this GRN. Maintained by VehicleDispatchService / the approval engine through
   * `syncGrnVehicleDispatchFlag`; the dispatch table stays the source of truth.
   */
  @Column({ default: false })
  isVehicleDispatchCreated: boolean;

  /** Unpaid / Partial / Paid, worked out from the GRN's payments (GrnPaymentService). */
  @Column({
    type: 'enum',
    enum: GrnPaymentStatus,
    enumName: 'grns_ammountstatus_enum',
    default: GrnPaymentStatus.UNPAID,
    nullable: true,
  })
  ammountStatus: GrnPaymentStatus;

  /** Sum of the live (not voided) recorded payments; the advance is not included. */
  @Column('decimal', { name: 'paid_amount', precision: 15, scale: 2, default: 0 })
  paidAmt: number;
}
// @Column({
//   type: "timestamp",
//   nullable: true,
//   transformer: {
//     // Convert DB value (ISO format) to "hh:mm a" IST format
//     from: (value: string | null) => {
//       if (!value) return null; // Handle null values

//       try {
//         const istDate = toZonedTime(new Date(value), "Asia/Kolkata");
//         return format(istDate, "hh:mm a");
//       } catch (error) {
//         console.error("Date transformation error (from DB):", error);
//         return null;
//       }
//     },
//     // Convert input "hh:mm a" to DB-compatible timestamp
//     to: (value: string | null) => {
//       if (!value) return null; // Handle null values

//       try {

//         const parsedDate = parse(value);

//         const istDate = toZonedTime(parsedDate, "Asia/Kolkata");
//         return format(istDate, "yyyy-MM-dd HH:mm:ss");
//       } catch (error) {
//         console.error("Date transformation error (to DB):", error);
//         return null;
//       }
//     },
//   },
// })
// timeIn: string | null;
// @Column({
//   type: "enum",
//   enum: ApprovalStatus,
//   default: ApprovalStatus.PENDING,
//   name: "approval_status",
// })
// approvalStatus: ApprovalStatus;

// @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
// @JoinColumn({ name: "requested_id" })
// requestedBy: User;
