import { Column, Entity, OneToMany } from "typeorm";
import Model from "../../global/model.entity";



@Entity('labor_temporary_register')
export class LaborRegister extends Model {

 

  @Column({ nullable: false })
  laborName: string; // Name of the laborer

  @Column({ nullable: false })
  contactNo: string; // Contact Number of the laborer

  @Column({ nullable: true, default: 'temporary' })
  type: string; // Type of labor, defaults to 'temporary'


  
}
