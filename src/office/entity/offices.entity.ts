import { Column, Entity, ManyToOne } from "typeorm";
import Model from "../../global/model.entity";
import { Address } from "../../address/entity/address.entity";


export enum OFFICE_TYPE {
REGISTERED_OFFICE = "registered-office",
  CORPORATE_OFFICE ="corporate-office",
}
@Entity("offices")
export class OfficesData extends Model {
 
    @Column()
    name: string;
    @Column({ type: 'varchar', nullable: true })
    officeEmail?: string; 
    @ManyToOne(() => Address, (address) => address.officeData, { nullable: false })
    address: Address;
    @Column({ nullable: true })
    contactNumber?: string;
    @Column({ nullable: true })
    cFirstName: string;
    @Column({ nullable: true })
    cMiddleName: string;
    @Column({ nullable: true })
    cLastName: string;
    @Column({ type: "text", nullable: true })
    notes?: string;
  
    // @Column()
    // capacity: number; // Maximum capacity in terms of storage units or volume
  
    //@Column({ default: true })
    //isActive: boolean; // Indicates if the warehouse is currently active or not

    @Column({
        type: "enum",
        enum: OFFICE_TYPE,
        default: OFFICE_TYPE.REGISTERED_OFFICE, // Set a default type if needed
      })
      type: OFFICE_TYPE; // Location type (e.g., Collection Center, Distribution Center)
    
  }