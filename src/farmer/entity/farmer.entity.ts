import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  OneToMany,
  JoinColumn,
  OneToOne,
  BeforeInsert,
  ManyToOne,
} from "typeorm";
import { Crop } from "./crop.entity";

import { generateIncrementalCode } from "../../utils/codeGeneration";
import { format } from "date-fns-tz";
import { Status } from "../../utils/status.enum";
import Model from "../../global/model.entity";
import { Address } from "../../address/entity/address.entity";
import { User } from "../../employee/entity/user.entity";


export enum LandHoldingStatus {
  OWNED = 'Owned',
  LEASED = 'Leased',
  SHARED = 'Shared',
  ENCUMBERED = 'Encumbered',
}

export enum LandStatus {
  CULTIVABLE = 'Cultivable',
  FALLOW = 'Fallow',
  IRRIGATED = 'Irrigated',
  NON_IRRIGATED = 'Non-Irrigated',
}

@Entity("farmer")
export class Farmer extends Model {
  @Column("character varying", { name: 'farmerfName',length: 100, nullable: true })
  farmerfName: string;

  @Column("character varying", {name: 'farmermName', length: 100, nullable: true })
  farmermName: string;

  @Column("character varying", {name: 'farmerlName', length: 100, nullable: true })
  farmerlName: string;

  @Column("character varying", { length: 15, nullable: true })
  primaryMobileNo: string;

  @Column("character varying", { length: 15, nullable: true })
  secondaryMobileNo: string;

  @Column("character varying", { length: 100, nullable: true })
  email: string;

  @Column("character varying", { length: 100, nullable: true })
  gender: string;

  // One-to-One relation with Address for residensialAddress
  @OneToOne(() => Address, { cascade: true, nullable: true,onDelete: 'SET NULL', })
  @JoinColumn()
  residensialAddress: Address;

  @Column({type:'date' ,nullable: true ,
  //    transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "yyyy-MM-dd") : null, // Convert to YYYY-MM-DD format
  // },
})
  dob: Date;

  @Column({ nullable:true })
  landHoldingStatus:string;

  @Column({ nullable:true,})
  landStatus: string;

  // One-to-One relation with Address for farmAddress (Geofenced)
  @OneToOne(() => Address, { cascade: true, nullable: true,onDelete: 'SET NULL', })
  @JoinColumn()
  farmAddress: Address;

  @Column("decimal", { precision: 100, scale: 6, nullable: true })
totalLandArea: number;


  @Column("decimal", { precision: 7, scale: 2, nullable: true })
  cultivationArea: number;

  

  @Column("text", { nullable: true })
  farmerCode: string;

  // @Column("text", { nullable: true })
  // farmerType: string;

  @Column("text", { nullable: true })
  farmerGrading: string;

  @Column("text", { nullable: true })
  sevenTwelveCopy: string; // Fixed invalid variable name

  @Column("text", { nullable: true })
  sevenTwelveNo: string; // Fixed invalid variable name

  @Column("text", { nullable: true })
  idProofCopy: string;

  @Column("text", { nullable: true })
  idProofNo: string;

  @Column( {type:'date', nullable: true, 
  //   transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
  // },
}) 
  dateOfVisit: Date;

  @Column("text", { nullable: true })
  howDoYouSell: string;

//   @Column("text", { nullable: true })
//   registerBy:string;

//   @Column( {type:'date' ,nullable: true, transformer: {
//     to: (value: Date) => value, 
//     from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
//   },
// }) 
//   registerDate:Date;

  @Column("text", { nullable: true })
  farmerPhoto:string;
  
  @Column("text", { nullable: true })
  farmPhoto:string;
  
  @OneToMany(() => Crop, (crop) => crop.farmer, { cascade: true , orphanedRowAction: 'delete',onDelete: 'SET NULL', })
  crops: Crop[];
   @Column({
    type: 'enum',
    enum: Status,
    default: Status.PENDING,
    name: 'status',
  })
  status: Status;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approvedBy: User;
 
}
