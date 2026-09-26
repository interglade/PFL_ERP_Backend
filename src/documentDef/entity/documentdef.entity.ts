import { Column, Entity, OneToMany } from "typeorm";
import Model from "../../global/model.entity";
import { DocumentPermission } from "../../employee/entity/permission.entity";



// export enum DocumentTypeEnum {
//     PROCUREMENT = 'procurement',
//     SALE = 'sale',
//     OPERATION = 'operation',
//   }

  export enum DocumentTypeEnum {
    PROCUREMENT = 'Procurement',
    SALE = 'Sale',
    OPERATION = 'Operation',
    GRN = "GRN",
    MULTI_CASH_VOUCHER = "multi-cash-voucher",
    TRANSPORT_PAYMENT_VOUCHER = "transport-payment-voucher",
    DEAL_SLIP = "DEAL_SLIP",
    RFPA = "RFPA",
    DC_TYPE_CUSTOMER = "DC_TYPE_CUSTOMER",
    DC_TYPE_STOCK_TRANSFER = "DC_TYPE_STOCK_TRANSFER",
    DC_TYPE_OTHER = "DC_TYPE_OTHER",
    SECOND_SALE = 'second-sale',
    PACKAGING_MATERIAL_VOUCHER = 'packaging-material-voucher',
    VEHICLE_DISPATCH_REGISTER = 'vehicle-dispatch-register',
    // REPORT = "REPORT",
    // INVENTORY = "INVENTORY",
  }
  
@Entity("document_definitions")
export class DocumentDefinition extends Model {
  @Column({ nullable: false, unique: true })
  uniqueKey: string;

  @Column({ nullable: false })
  name: string;

  @Column({
    type: 'enum',
    enum: DocumentTypeEnum,
    nullable: false,
  })
  documentType: DocumentTypeEnum;

  @OneToMany(() => DocumentPermission, (permission) => permission.documentDefinition)
  permissions: DocumentPermission[];
}
