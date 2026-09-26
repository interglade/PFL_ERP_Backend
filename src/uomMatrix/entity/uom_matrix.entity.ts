import { Entity, Column, ManyToOne } from "typeorm";
import { UOM } from "../../uom/entity/uom.entity";
import Model from "../../global/model.entity";


@Entity("UOM_conversion_matrix")
export class UOMConversionMatrix extends Model {
  @ManyToOne(() => UOM, { nullable: false,onDelete: "SET NULL" })
  fromUOM: UOM;

  @ManyToOne(() => UOM, { nullable: false,onDelete: "SET NULL" })
  toUOM: UOM;

  @Column({ type: "decimal", precision: 10, scale: 4 })
  conversionFactor: number;
}
