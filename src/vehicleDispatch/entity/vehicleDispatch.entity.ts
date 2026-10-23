import {
    Entity,
    Column,
    OneToMany,
    JoinColumn,
    OneToOne,
    ManyToOne,
    Index,
  } from "typeorm";
  

  import { DispatchProduct } from "./dispatchProduct.entity";

import { format, parse } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import Model from "../../global/model.entity";
import { Company } from "../../company/entity/company.entity";
import { Address } from "../../address/entity/address.entity";
import { DeliveryChallanPurchase } from "../../deliveryChallans/deliverychllan/entity/deliveryChallan.entity";
import { GRN } from "../../grn/entity/grn.entity";
import { Branches } from "../../branch/entity/branches.entity";
import { Customer } from "../../customer/addcustomer/entity/customer.entity";
import { Vendor } from "../../vendor/createVendor/entity/vendor.entity";
import { Farmer } from "../../farmer/entity/farmer.entity";
import { Transporter } from "../../transporter/entity/transporter.entity";
import { Vehicle } from "../../vehicle/entity/vehicle.entity";
import { Drivers } from "../../driver/entity/driver.entity";
import { User } from "../../employee/entity/user.entity";
import { Source } from "../../utils/status.enum";

/** Which register a dispatch belongs to; each has its own source document. */
export enum DispatchType {
  PURCHASE = "purchase",         // source: GRN
  STOCK_TRANSFER = "stock-transfer", // source: Stock Transfer DC
  SALES = "sales",               // source: Customer DC
}

  /**
   * Vehicle Dispatch Register (docs/vehicle-dispatch-plan.md). Three registers share
   * this table, told apart by `dispatchType`, and share the approval document type
   * `vehicle-dispatch-register`.
   *
   * Columns dropped from use on 2026-10-13 (payment discussed, transportation bill,
   * advance paid, accounts verification, transporter-owner feedback, net inward qty,
   * rejection, shrinkage / dump, payment terms, client GRN no, supervisor name) stay in
   * the table so old rows keep their values; nothing reads or writes them any more.
   * Existing column types must not change: TypeORM `synchronize` would drop and
   * recreate such a column and lose its data.
   */
  @Entity({ name: "dispatch" })
  @Index(["dispatchType"])
  @Index(["grn"])
  @Index(["deliveryChallanNo"])
  export class VehicleDispatch extends Model {

    @Column({ type: "enum", enum: DispatchType, default: DispatchType.SALES })
    dispatchType: DispatchType;

    @Column({ type: "varchar", length: 100, nullable: true })
    batchNo: string;

    /** Purchase: the GRN. Sales / stock transfer use `deliveryChallanNo`. */
    @ManyToOne(() => GRN, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: "grn_id" })
    grn: GRN;

    /** Purchase only: the GRN's party. */
    @Column({ type: "enum", enum: Source, nullable: true })
    source: Source;

    @ManyToOne(() => Vendor, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: "vendor_id" })
    vendor: Vendor;

    @ManyToOne(() => Farmer, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: "farmer_id" })
    farmer: Farmer;

    @ManyToOne(() => Branches, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: "from_location_id" })
    fromLocation: Branches;

    /** From when it is not a branch (vendor / farmer site, GRN "other" location). */
    @Column({ type: "varchar", length: 255, nullable: true })
    fromText: string;

    @ManyToOne(() => Branches, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: "to_location_id" })
    toLocation: Branches;

    /** Sales, and purchase delivered direct to a customer. */
    @ManyToOne(() => Customer, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: "customer_id" })
    customer: Customer;

    /** The effective destination: the typed current shipping address, else a copy of the customer's registered delivery address. */
    @ManyToOne(() => Address, { nullable: true, onDelete: "SET NULL", cascade: true })
    @JoinColumn({ name: "to_address_id" })
    toAddress: Address;

    @Column({ type: "boolean", default: false })
    usesCurrentShippingAddress: boolean;

    @ManyToOne(() => Transporter, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: "transporter_id" })
    transporter: Transporter;

    @ManyToOne(() => Vehicle, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: "vehicle_id" })
    vehicle: Vehicle;

    @ManyToOne(() => Drivers, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: "driver_id" })
    driver: Drivers;

    // Snapshot of the transport masters at save time (vehicleNo, vehicleType,
    // driverName, driverMobNo are the pre-existing columns below).
    @Column({ type: "varchar", length: 150, nullable: true })
    transporterName: string;

    @Column({ type: "varchar", length: 15, nullable: true })
    transporterContact: string;

    @Column({ type: "decimal", precision: 12, scale: 3, nullable: true })
    vehicleCapacityKg: string;

    @Column({ type: "varchar", length: 15, nullable: true })
    driverAltMobNo: string;

    @Column({ type: "varchar", length: 30, nullable: true })
    licenseNo: string;

    @Column({ type: "timestamp", nullable: true })
    arrivedAt: Date;

    @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: "arrived_by" })
    arrivedBy: User;

    @OneToMany(() => DispatchProduct, (line) => line.dispatch, { cascade: true })
    products: DispatchProduct[];

    @Column({ type: "decimal", precision: 20, scale: 3, nullable: true })
    totalQuantity: string;

    @Column({ type: "decimal", precision: 20, scale: 4, nullable: true })
    totalGrossWeight: string;

    @Column({ type: "decimal", precision: 20, scale: 4, nullable: true })
    totalNetWeight: string;

    @Column({ type: "decimal", precision: 20, scale: 4, nullable: true })
    totalAmount: string;

      @ManyToOne(() => Company, {cascade: true,nullable: true,onDelete: "SET NULL" })
       @JoinColumn({name: "company_id"})
        companyName: Company;
    @Column({ type: "date" ,nullable :true
      // ,transformer: {
      //   to: (value: Date) => value, 
      //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null,
      // },
    })
    date: Date;
  
    @Column({ nullable: true })
    vehicleType: string;
  
    @Column({ nullable: true })
    vehicleNo: string;
  
    @Column({ nullable: true })
    driverName: string;
     @Column({ nullable: true })
  vehicleDispatchNo: string;
  
    @Column({ type: "float", nullable: true })
    paymentDiscussed: number;
  
    @Column({ nullable: true })
    driverMobNo: string;
  
    // @Column({
    //   type: "time",
    //   nullable: true,
    //   transformer: {
    //     from: (value: string) => {
    //       if (!value) return null;
    //       try {
    //         //const parsedTime = parse(value, "HH:mm:ss", new Date());
    //         return format(new Date(`1970-01-01T${value}`), "HH:mm:ss");

    //         //return format(parsedTime, "HH:mm:ss"); // Convert to 12-hour format with AM/PM
    //       } catch (error) {
    //         console.error("Invalid time format for outTime:", value);
    //         return null;
    //       }
    //     },
    //     to: (value: string) => {
    //       if (!value) return null;
    //       try {
    //         //const parsedTime = parse(value, "HH:mm:ss", new Date());
    //         return format(new Date(`1970-01-01T${value}`), "HH:mm:ss");

    //       } catch (error) {
    //         console.error("Invalid time format for outTime:", value);
    //         return null;
    //       }
    //     },
    //   },
    // })
    // outTime: string;
    
    @Column({
      type: "time",
      nullable: true,
      transformer: {
        from: (value: string) => {
          if (!value) return null;
          try {
            //const parsedTime = parse(value, "HH:mm:ss", new Date());
            return format(new Date(`1970-01-01T${value}`), "HH:mm:ss");

          } catch (error) {
            console.error("Invalid time format for reachingTime:", value);
            return null;
          }
        },
        to: (value: string) => {
          if (!value) return null;
          try {
            // const parsedTime = parse(value, "HH:mm:ss", new Date());
            return format(new Date(`1970-01-01T${value}`), "HH:mm:ss");

          } catch (error) {
            console.error("Invalid time format for reachingTime:", value);
            return null;
          }
        },
      },
    })
    reachingTime: string;
    @Column({
      type: "time",
      nullable: true,
      transformer: {
        from: (value: string) => {
          if (!value) return null;
          try {
            //const parsedTime = parse(value, "HH:mm:ss", new Date());
            return format(new Date(`1970-01-01T${value}`), "HH:mm:ss");

          } catch (error) {
            console.error("Invalid time format for reachingTime:", value);
            return null;
          }
        },
        to: (value: string) => {
          if (!value) return null;
          try {
            // const parsedTime = parse(value, "HH:mm:ss", new Date());
            return format(new Date(`1970-01-01T${value}`), "HH:mm:ss");

          } catch (error) {
            console.error("Invalid time format for outTime:", value);
            return null;
          }
        },
      },
    })
    outTime: string;

    /** Date the vehicle left. Entered together with `outTime`. */
    @Column({ type: "date", nullable: true })
    outDate: string | null;

    /** Date the vehicle is expected to reach. Entered together with `reachingTime` (the expected reaching time). */
    @Column({ type: "date", nullable: true })
    expectedReachingDate: string | null;

    /** Legacy free-text client; new sales dispatches copy the customer name here. */
    @Column({ nullable: true })
    clientName: string;
  
    // @Column({ nullable: true })
    // clientAddress: string;

     // One-to-One relation with Address for residensialAddress
  @OneToOne(() => Address, {  nullable: true,onDelete: 'SET NULL', cascade: true })
  @JoinColumn({ name: 'client_address_id' })
  clientAddress: Address;
  
    @Column({ nullable: true })
    receivingPerson: string;
  
    
    
    @Column({ nullable: true })
    supervisorName: string;
  
    @Column({ nullable: true })
    accDeptVerification: string;
  
    @Column({ type: "float", nullable: true })
    transportationBillAmt: number;
  
    @Column({ type: "float", nullable: true })
    advancePaid: number;
  
    @Column({ nullable: true })
    remarksPFL: string;
  
    @Column({ nullable: true })
    feedbackbyTransporterOwner  : string;
  
  
    @Column({ type: "float", nullable: true })
    netInwardQty: number;
  
    @Column({ nullable: true })
    clientGRNNo: string;
  
    @Column({ nullable: true })
    paymentTerms: string;
  
      // @ManyToOne(() => GRN, {nullable:true,onDelete: "SET NULL"})
      //   @JoinColumn({ name: "grn_id" })
      //   clientGRNNo: GRN;
        @ManyToOne(() => DeliveryChallanPurchase, { nullable: true,onDelete: "SET NULL",cascade:true })
        @JoinColumn({ name: "delivery_challan_id" }) // Define the foreign key column
        deliveryChallanNo: DeliveryChallanPurchase;
    // @Column({ type: "date", nullable: true })
    // paymentReceivedDate: Date;
  
    // @Column({ nullable: true })
    // accDeptRemarks: string;
  
    @Column({ nullable: true })
    rejection: string;
   
  
    @Column({ nullable: true })
    shrinkageDump : string;
  }
  