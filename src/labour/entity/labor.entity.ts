import { Entity, Column, OneToOne, JoinColumn, OneToMany, ManyToOne } from "typeorm";
import { BankDetails } from "./laborBankDetails.entity";
import { FamilyDetails } from "./laborfamilyDetails.entity";
import { WorkExperience } from "./laborWorkEx.entity";

import { format } from "date-fns-tz";
import Model from "../../global/model.entity";
import { Company } from "../../company/entity/company.entity";
import { Branches } from "../../branch/entity/branches.entity";
import { Address } from "../../address/entity/address.entity";

@Entity("permenat_labor")
export class Labor extends Model {

// @Column({
     // type: 'enum',
     // enum: CompanyName,
    // nullable: true
  // })
  // companyName: string;

  @ManyToOne(() => Company, {cascade: true,nullable: true,onDelete: "SET NULL" })
  @JoinColumn({name: "company_id"})
   companyName: Company;
   // Many-to-One relation with Branches
 @ManyToOne(() => Branches, { nullable: true,onDelete: "SET NULL" ,cascade: true})
 @JoinColumn({ name: 'location_id' })  
 location: Branches;
  @Column({ nullable: true })
  representativeName: string;

  @Column()
  siteName: string;

  @Column()
  laborType: "Skilled" | "Semi-skilled" | "Unskilled";

  @Column()
  laborName: string;

  @Column()
  nameAsPerAadhar: string;

  @Column()
  nameAsPerBank: string;

  @OneToOne(() => Address, { cascade:true,nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "present_address_id" })
  presentAddress: Address;

  @OneToOne(() => Address, { cascade:true, nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "permanent_address_id" })
  permanentAddress: Address;
  @Column()
  mobileNumber: string;

  @Column()
  emergencyContactNo: string;

  @Column()
  emergencyContactName: string;

  @Column()
  relationWithEmergencyContact: string;

  @Column({ nullable: true })
  healthIssues: string;

  @Column({ type: "date", 
  //   transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
  // },
}) 
  birthDate: Date;

  @Column()
  gender: "Male" | "Female";

  @Column()
  bloodGroup: string;

  @Column()
  educationQualification: string;

  @Column({ nullable: true })
  pfUanNo: string;

  @Column()
  maritalStatus: "Married" | "Unmarried";

  @Column({ nullable: true })
  email: string;

  @OneToOne(() => BankDetails, { cascade: true,onDelete: "SET NULL" })
  @JoinColumn()
  bankDetails: BankDetails;

  @OneToMany(() => FamilyDetails, (familyDetails) => familyDetails.labor, {
    
    onDelete: "SET NULL",
    nullable: true
  })
  familyDetails: FamilyDetails[];
  

  @OneToMany(() => WorkExperience, (workExperience) => workExperience.labor, {
    cascade: true,
    onDelete: "SET NULL"
  })
  workExperience: WorkExperience[];

  @Column()
  preferredWorkingLocation: string;

  @Column()
  preferredWorkType: string;

  @Column()
  referenceName: string;

  @Column()
  referencePosition: string;

  @Column()
  referenceMobileNumber: string;
}
