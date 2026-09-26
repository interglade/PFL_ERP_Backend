import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Labor } from "./labor.entity";
import Model from "../../global/model.entity";


@Entity()
export class FamilyDetails  extends Model{
 
  // @ManyToOne(() => Labor, (labor) => labor.familyDetails)
  // labor: Labor;
  @ManyToOne(() => Labor, (labor) => labor.familyDetails, { onDelete: "SET NULL" ,nullable: true})
@JoinColumn({ name: "laborId" })
labor: Labor;


  @Column()
  relation: "Father" | "Mother" | "Spouse";

  @Column()
  nameAsPerAadhar: string;

  @Column()
  mobileNumber: string;

  @Column()
  age: number;
}
