import {
    Entity,
    Column,
    OneToMany,
    JoinColumn,
    OneToOne,
    ManyToOne,
  } from "typeorm";
  

  import { SKU } from "./skuDispatch.entity";

import { format, parse } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import Model from "../../global/model.entity";
import { Company } from "../../company/entity/company.entity";
import { Address } from "../../address/entity/address.entity";
import { DeliveryChallanPurchase } from "../../deliveryChallans/deliverychllan/entity/deliveryChallan.entity";
  
  @Entity({ name: "dispatch" })
  export class VehicleDispatch extends Model {

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
  
    @Column()
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
  
    // @OneToMany(() => SKU, (sku) => sku.dispatch, { cascade: true })
    // skus: SKU[];
  
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
  