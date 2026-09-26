import {
  Column,
  Entity,
  ManyToOne,
  OneToOne,
  JoinColumn,
  OneToMany,
  BeforeInsert,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import Model from '../../../global/model.entity';
import { Address } from '../../../address/entity/address.entity';
import { User } from '../../../employee/entity/user.entity';
import { format } from 'date-fns';
import { Product } from '../../../product/createproduct/entity/product.entity';
import { Status } from '../../../utils/status.enum';
import { VendorSubcategory } from '../../vendorSubcategory/entity/vendorSubcategory.entity';
import { VendorCategory } from '../../vendorCategory/entity/vendorCategory.entity';
import { PackingMaterial } from '../../../packingMaterial/entity/packingMaterial.entity';
import { VendorSaleInfo } from './vendorsaleinfo.entity';
import { BankDetailsvend } from './bankDetailsVend.entity';

export enum VendorClassification {
  FRESH_FRUITS = 'fresh fruits',
  MANGOES = 'mangoes',
  VEGETABLES = 'vegetables',
  ONION = 'onion',
  POTATO = 'potato',
  TOMATO = 'tomato',
  VALUE_ADDED_PRODUCT = 'Value Added Product (Processed & Frozen)',
  SERVICE = 'service',
  STATIONARY = 'stationary',
  PACKING_MATERIAL = 'packing material',
   CROCKERY = 'crockery',
  MARKETING_PRODUCT = 'marketing product',
  STAFF_WELFARE = 'staff welfare',
}

// export enum VendorOthersSubType {
//   CROCKERY = 'crockery',
//   MARKETING_PRODUCT = 'marketing product',
//   STAFF_WELFARE = 'staff welfare',
// }
export enum ApprovalStatus1 {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('vendor')
export class Vendor extends Model {
  // Existing fields
  @Column('character varying', {
    name: 'company_name',
    // unique: true,
    length: 100,
    nullable: true,
  })
  companyName: string;

  
  @OneToOne(() => Address, { onDelete: 'SET NULL', cascade: true })
  @JoinColumn({ name: 'office_address_id' })
  officeAddress: Address;
  @Column('character varying', {
    name: 'office_contact_number',
    length: 100,
    nullable: true,
  })
  officeContactNo: string;

  @Column('character varying', { name: 'email', length: 100, nullable: true })
  officeEmail: string;

  @Column('character varying', { name: 'gstn', nullable: true })
  gstn: string;
  @Column('character varying', { name: 'gstncopy', nullable: true })
  gstnCopy: string;
  @Column({
    name: 'if_gstn_Copy',
    nullable: true,
  })
  ifGstnCopy: boolean;
  @Column('character varying', {
    name: 'pan_number',
    length: 100,
    nullable: true,
  })
  panNo: string;
  @Column('character varying', {
    name: 'pan_card_copy',
    length: 200,
    nullable: true,
  })
  panCardCopy: string;
  @Column({
    name: 'if_pan_cardCopy',
    nullable: true,
  })
  ifPanCardCopy: boolean;
  @Column('character varying', {
    name: 'MSME_Number',

    nullable: true,
  })
  msmeNo: string;
  @Column('character varying', {
    name: 'MSME_copy',

    nullable: true,
  })
  msmeCopy: string;

  @Column({
    name: 'if_mameCopy',
    nullable: true,
  })
  ifMsmeCopy: boolean;

  @Column('character varying', { name: 'website', length: 100, nullable: true })
  website: string;
  @Column({
    name: 'vendor_credit_terms',
    type: 'integer',
    nullable: true,
  })
  creditTerms: number | null;

  @Column({
    type: 'enum',
    enum: VendorClassification,
    nullable: true,
  })
  classification: VendorClassification;

  // @Column({
  //   type: 'enum',
  //   enum: VendorOthersSubType,
  //   nullable: true,
  // })
  // othersSubType?: VendorOthersSubType;

  @Column('character varying', {
    name: 'vendor_code',
    length: 200,
    unique: true,
    nullable: true,
  })
  vendorCode: string;

  @Column('character varying', {
    name: 'vendor_grade',
    length: 100,
    nullable: true,
  })
  vendorGrade: string;

  // @Column('character varying', {
  //   name: 'registered_by',
  //   length: 100,
  //   nullable: true,
  // })
  // registeredBy: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approvedBy: User;

  // @Column('date', {
  //   name: 'registered_date',
  //   nullable: true,
  //   transformer: {
  //     to: (value: Date) => value,
  //     from: (value: string) =>
  //       value ? format(new Date(value), 'dd-MM-yyyy') : null, // Convert to DD-MM-YYYY format
  //   },
  // })
  // registeredDate: Date;

  @Column('date', {
    name: 'date_of_incorporation',
    nullable: true,
    transformer: {
      to: (value: Date) => value,
      from: (value: string) =>
        value ? format(new Date(value), 'yyyy-MM-dd') : null, // Convert to YYYY-MM-DD format
    },
  })
  dateOfIncorporation: Date;

  @Column('character varying', {
    name: 'in_f_and_v_business_since',
    length: 400,
    nullable: true,
  })
  inFandVBusinessSince: string;

  // @Column("text", {
  //   name: "main_products_to_be_supplied",
  //   nullable: true,
  // })
  // mainProduct: string;

  @ManyToOne(() => Product, { nullable: true })
  @JoinColumn({ name: 'main_products_to_be_supplied' })
  mainProduct: Product;

  // @Column("text", {
  //   name: "list_of_all_products",
  //   nullable: true,
  // })
  // listOfAllProducts: string[];
  // Instead of storing string[], create a relation to Product
  @ManyToMany(() => Product, { cascade: true })
  @JoinTable({
    name: 'vendor_products', // join table name
    joinColumn: { name: 'vendor_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'product_id', referencedColumnName: 'id' },
  })
  listOfAllProducts: Product[];

  @Column('character varying', {
    name: 'dispatch_center',
    length: 100,
    nullable: true,
  })
  dispatchCenter: string;

  @Column('text', {
    name: 'warehouse_locations',
    nullable: true,
  })
  warehouseLocations: string;

  @Column('text', {
    name: 'packing_center_location',
    nullable: true,
  })
  packingCenterLocation: string;

  @Column('character varying', {
    name: 'trade_license_number',
    length: 200,
    nullable: true,
  })
  tradeLicenseNumber: string;

  @Column({
    name: 'proposed_payment_terms',
    type: 'integer',
    nullable: true,
  })
  proposedPaymentTerms: number | null;

  @Column('text', {
    name: 'any_other_details_regarding_team_and_infrastructure',
    nullable: true,
  })
  anyDetailsTeamAndInfra: string;

  // @Column('character varying', {
  //   name: 'submitted_by',
  //   length: 100,
  //   nullable: true,
  // })
  // submittedBy: string;


  @Column({
    type: 'enum',
    enum: Status,
    default: Status.PENDING,
    name: 'status',
  })
  status: Status;

  @ManyToOne(() => VendorSubcategory, {
    onDelete: 'SET NULL',
    nullable: true,
    cascade: true,
  })
  @JoinColumn({ name: 'vendor_subcategory_id' })
  subcategory: VendorSubcategory;

  @ManyToOne(() => VendorCategory, {
    onDelete: 'SET NULL',
    nullable: true,
    cascade: true,
  })
  @JoinColumn({ name: 'vendor_category_id' })
  category: VendorCategory;

  
  @ManyToMany(() => PackingMaterial, { cascade: true })
  @JoinTable({
    name: 'vendor_packing_materials',
    joinColumn: { name: 'vendor_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'packing_material_id', referencedColumnName: 'id' },
  })
  listOfPackingMaterial: PackingMaterial[];

  @ManyToOne(() => PackingMaterial, { nullable: true })
  @JoinColumn({ name: 'main_packing_material_id' })
  mainPackingMaterial: PackingMaterial;

  @Column('character varying', {
    name: 'other_product_or_service',
    length: 400,
    nullable: true,
  })
  otherProductOrService: string;

  @Column('character varying', {
    name: 'payment_mode',
    length: 200,
    nullable: true,
  })
  paymentMode: string;

  @OneToOne(() => VendorSaleInfo, (vendorSaleInfo) => vendorSaleInfo.vendor, {
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'vendor_sale_id' })
  vendorSaleInfo: VendorSaleInfo;
  // OneToOne relation with VendorSaleInfo
  @OneToOne(() => BankDetailsvend, {
    cascade: true,
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'bank_details_vendor_id' }) // Specifies the foreign key column
  vendorBankDetails: BankDetailsvend;

  // Reference 1 fields
  @Column('character varying', {
    name: 'ref_one_first_name',
    length: 400,
    nullable: true,
  })
  ref1FName: string;

  @Column('character varying', {
    name: 'ref_one_middle_name',
    length: 400,
    nullable: true,
  })
  ref1MName: string;

  @Column('character varying', {
    name: 'ref_one_last_name',
    length: 400,
    nullable: true,
  })
  ref1LName: string;
  @Column('character varying', {
    name: 'ref_one_primary_contact_number',
    length: 150,
    nullable: true,
  })
  ref1PrimaryCNumb: string;
  @Column('character varying', {
    name: 'ref_one_alternate_contact_number',
    length: 150,
    nullable: true,
  })
  ref1AltrCNumb: string;

  @OneToOne(() => Address, { cascade: true, nullable: true })
  @JoinColumn({ name: 'ref1_address_id' })
  ref1Address: Address;

  @Column('character varying', {
    name: 'ref1_email',
    length: 100,
    nullable: true,
  })
  ref1Email: string;

  // Reference 2 fields
  @Column('character varying', {
    name: 'ref_two_first_name',
    length: 400,
    nullable: true,
  })
  ref2FName: string;

  @Column('character varying', {
    name: 'ref_two_middle_name',
    length: 400,
    nullable: true,
  })
  ref2MName: string;

  @Column('character varying', {
    name: 'ref_two_last_name',
    length: 400,
    nullable: true,
  })
  ref2LName: string;
  @Column('character varying', {
    name: 'ref_two_primary_contact_number',
    length: 150,
    nullable: true,
  })
  ref2PrimaryCNumb: string;
  @Column('character varying', {
    name: 'ref_two_alternate_contact_number',
    length: 150,
    nullable: true,
  })
  ref2AltrCNumb: string;

  @OneToOne(() => Address, { cascade: true, nullable: true })
  @JoinColumn({ name: 'ref2_address_id' })
  ref2Address: Address;

  @Column('character varying', {
    name: 'ref2_email',
    length: 100,
    nullable: true,
  })
  ref2Email: string;

  // @BeforeInsert()
  // async setVendorCode() {
  //   // Use the createdAt field which is set by TypeORM before insertion
  //   this.vendorCode = await generateIncrementalCode('vendor');
  // }
}
