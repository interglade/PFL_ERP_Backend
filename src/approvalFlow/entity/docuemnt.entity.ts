// document.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToOne,
} from 'typeorm';
import Model from '../../global/model.entity';
import { ApprovalFlow } from './approvalFlow.entity';

import { nullable } from 'zod';
import { DocumentApprovalFlow } from './documentApproveBy.entity';
import { User } from '../../employee/entity/user.entity';

export enum DocumentStatus {
  HOLD = 'hold',
  QUERY = 'query',
  APPROVED = 'approved',
  DISAPPROVED = 'disapproved',
  FINALIZING = "FINALIZING",
  FINALIZED = "FINALIZED",
  COMPLETE = "COMPLETE",
  REJECT = "REJECT",
  VERIFIED = "VERIFIED",
}

export enum DocumentTypeEnum {
  GRN = 'grn',
  RFPA = 'rfpa',
  DEAL_SLIP = 'deal-slip',
  INWARD_REGISTER = 'inward-register',
  AQR = 'aqr',
  DUMP_REGISTER = 'dump-register',
  VEHICLE_DISPATCH_REGISTER = 'vehicle-dispatch-register',
  RETURN_BY_CUSTOMER = 'return-by-customer',
  RETURN_TO_VENDOR = 'return-to-vendor',
  SECOND_SALE = 'second-sale',
  EOD_REPORT = 'eod-report',
  PROFORMA_INVOICE = 'proforma-invoice',
  FINAL_INVOICE = 'final-invoice',
  MULTI_CASH_VOUCHER = 'multi-cash-voucher',
  LABOR_PAYMENT_VOUCHER = 'labor-payment-voucher',
  TRANSPORT_PAYMENT_VOUCHER = 'transport-payment-voucher',
  PACKAGING_MATERIAL_VOUCHER = 'packaging-material-voucher',
  DC_TYPE_CUSTOMER = "DC_TYPE_CUSTOMER",
  DC_TYPE_STOCK_TRANSFER = "DC_TYPE_STOCK_TRANSFER",
  DC_TYPE_OTHER="DC_TYPE_OTHER"
}

@Entity('documents')
export class Documentb extends Model {
  @Column({
    type: 'enum',
    enum: DocumentTypeEnum,
  })
  type: DocumentTypeEnum;

  @Column({ type: 'decimal', nullable: true })
  totalAmt: number;

  @Column({
    type: 'enum',
    enum: DocumentStatus,
    default: DocumentStatus.HOLD,
  })
  status: DocumentStatus;

  @Column({ nullable: true })
  remarks: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'last_action_by' })
  lastActionBy: User;

  @ManyToOne(() => ApprovalFlow, { cascade: true, nullable: true })
  @JoinColumn({ name: 'approval_flow_id' })
  approvalFlow: ApprovalFlow;

  @ManyToOne(() => DocumentApprovalFlow, { nullable: true })
  @JoinColumn({ name: 'approval_info_id' })
  approvalInfo: DocumentApprovalFlow;

  // @Column({ name: 'approval_info_id', nullable: true })
  // approvalInfoId: string;


   @Column({ type: 'varchar', nullable: true })
   document_type_id: string | null;

  /**
   * True once this document's stock movement has been written to inventory_stock.
   * Set inside the same transaction that moves the status to COMPLETE, so a
   * repeated / concurrent approval call can never apply the movement twice.
   */
  @Column({ default: false })
  inventoryProcessed: boolean;
  
}
