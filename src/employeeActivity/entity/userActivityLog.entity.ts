import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../employee/entity/user.entity';
import Model from '../../global/model.entity';


export enum ActivityAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  VIEW = 'VIEW',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  EXPORT = 'EXPORT',
  PRINT = 'PRINT',
  DOWNLOAD = 'DOWNLOAD',
  ERROR = 'ERROR',
}

export enum ActivityModule {
  OTHER_DELIVERY_CHALLAN= 'OTHER_DELIVERY_CHALLAN',
  STOCK_TRANSFER_DELIVERY_CHALLAN= 'STOCK_TRANSFER_DELIVERY_CHALLAN',
  PMP_VOUCHER= 'PMP_VOUCHER',
  PACKING_MATERIAL= 'PACKING_MATERIAL',
  EOD_STOCK= 'EOD_STOCK',
  SECOND_SALES= 'SECOND_SALES',
  VEHICAL_DISPATCH= 'VEHICAL_DISPATCH',
  RETURN_TO_VENDOR= 'RETURN_TO_VENDOR',
  RETURN_BY_CUSTOMER= 'RETURN_BY_CUSTOMER',
  DUMP_REGISTER= 'DUMP_REGISTER',
  AQR= 'AQR',
  GRN = 'GRN',
  RFPA = 'RFPA',
  
  DEAL_SLIP = 'DEAL_SLIP',
  INVOICE = 'INVOICE',
  CUSTOMER = 'CUSTOMER',
  VENDOR = 'VENDOR',
  PRODUCT = 'PRODUCT',
  USER = 'USER',
  REPORT = 'REPORT',
  SETTINGS = 'SETTINGS',
  DASHBOARD = 'DASHBOARD',
  CUSTOMER_DELIVERY_CHALLAN = 'CUSTOMER_DELIVERY_CHALLAN',
  MULTI_CASH_VOUCHER = 'MULTI_CASH_VOUCHER',
  LABOUR_PAYMENT = 'LABOUR_PAYMENT',
  LABOUR_REGISTER = 'LABOUR_REGISTER',
  LABOUR_ATTENDANCE = 'LABOUR_ATTENDANCE',
  TRANSPORT_PAYMENT = 'TRANSPORT_PAYMENT',
  OFFICE = 'OFFICE',
  LEVELS = 'LEVELS',
  INWARD_REGISTER = 'INWARD_REGISTER',
  INVENTORY = 'INVENTORY',
  VOUCHER = 'VOUCHER',
  
  UOM = 'UOM',
  SECOND_SALE = 'SECOND_SALE',
  RETURN = 'RETURN',
 
  OTHER = 'OTHER',
}

@Entity('user_activity_logs')
@Index(['userId', 'createdAt'])
@Index(['action', 'createdAt'])
@Index(['module', 'createdAt'])
export class UserActivityLog extends Model {
  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  @Index()
  userId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userName: string;

  @Column({
    type: 'enum',
    enum: ActivityAction,
  })
  action: ActivityAction;

  @Column({
    type: 'enum',
    enum: ActivityModule,
  })
  module: ActivityModule;

  @Column({ type: 'varchar', length: 255, nullable: true })
  entityName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  entityId: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  changes: Record<string, { oldValue: any; newValue: any }>;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  endpoint: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  httpMethod: string;

  @Column({ type: 'int', nullable: true })
  statusCode: number;

  @Column({ type: 'int', nullable: true })
  responseTime: number; 

  @Column({ type: 'boolean', default: false })
  isError: boolean;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;
}
