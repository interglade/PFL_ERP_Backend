import { Column, Entity, OneToMany } from "typeorm";
import Model from "../../global/model.entity";


@Entity("departmentsForApprove")
export class Departments extends Model {
    @Column()
    name: string;  


    // @OneToMany(() => Levels, (level) => level.department)
    // levels: Levels[];
 }
