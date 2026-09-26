import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";
import { Labor } from "./labor.entity";
import Model from "../../global/model.entity";


@Entity()
export class WorkExperience  extends Model{
  
  @ManyToOne(() => Labor, (labor) => labor.workExperience,{ onDelete: "SET NULL" })
  labor: Labor;

  @Column()
  previousFarmOrWorkPlace: string;

  @Column()
  workType: string;

  @Column()
  workLocation: string;

  @Column()
  workDuration: string;

  @Column()
  wagesPerDayOrMonth: string;
}
