import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";

import { LaborDetail } from "./labourForAttendance.entity";

import { format } from "date-fns-tz";
import Model from "../../global/model.entity";
import { Company } from "../../company/entity/company.entity";
import { Branches } from "../../branch/entity/branches.entity";
import { User } from "../../employee/entity/user.entity";

@Entity('labor_attendance_for_temporary_and_permanent')
export class LaborAttendance extends Model {
  //@Column({ nullable: true })
  //companyName: string;
  @ManyToOne(() => Company, {cascade: true,nullable: true,onDelete: "SET NULL" })
  @JoinColumn({name: "company_id"})
   companyName: Company;

  @ManyToOne(() => Branches, { nullable: true, onDelete: "SET NULL", cascade: true })
  @JoinColumn({ name: 'location_id' })  
  location: Branches;

  @Column({ type: "date", nullable: false, 
  //   transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
  // },
}) 
  date: Date;

  @OneToMany(() => LaborDetail, (laborDetail) => laborDetail.attendance, { cascade: true,nullable:true})
  @JoinColumn({ name: 'labour_details_id' })
  labourDetails: LaborDetail[];
  

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "checkedBy_id" })
  checkedBy: User;

  @Column({ type: 'text', nullable: true })
  remarks: string;
}


// @Entity('labor_attendance_for_temporary_and_permanent')
// export class LaborAttendance extends Model {
//   @Column({
//     // type: 'enum',
//     // enum: CompanyName,
//     nullable: true
//   })
//   companyName: string;
//   // Many-to-One relation with Branches
// @ManyToOne(() => Branches, { nullable: true,onDelete: "SET NULL" ,cascade: true})
// @JoinColumn({ name: 'location_id' })  
// location: Branches; 
//   @Column({ type: "date", nullable: false })
//   date: Date; // Date of the record
//   @Column({
//     type: "enum",
//     enum: LaborType,
//   })
//   type: LaborType; // Temporary or Permanent
//   @Column({ nullable: false ,name:"labor_id"})
//   labor: string; // ID of the associated labor (temporary or permanent)
  

//   @Column({ type: "time", nullable: true })
//   inTime: string; // Labor's in time

//   @Column({ type: "time", nullable: true })
//   outTime: string; // Labor's out time

//   @Column('decimal', { precision: 12, scale: 2, nullable: true })
//   amount: number; // Daily wage for the laborer

//   // @Column({ nullable: true })
//   // checkedBy: string; // Supervisor who checked the laborer
//   @ManyToOne(() => User, { nullable: true,onDelete: "SET NULL" }) // Associate with User entity
//   @JoinColumn({ name: "checkedBy_id" })
//   checkedBy: User; // PFL/Employee who checked the attendance

//   @Column({ type: 'text', nullable: true })
//   remarks: string; // Remarks about the laborer's work

 
// }
