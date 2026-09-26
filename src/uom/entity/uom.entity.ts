import { Entity, Column } from "typeorm";
import Model from "../../global/model.entity";


@Entity("uom")
export class UOM extends Model {
  @Column({ type: "varchar", length: 50 })
  unit: string;

  @Column({ type: "varchar", length: 10,nullable:true })
  abbreviation: string;

  @Column({ type: "text", nullable: true })
  description: string;
}
