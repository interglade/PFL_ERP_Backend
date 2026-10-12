import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import Model from "../../global/model.entity";
import { Aqr} from "./aqr.entity";
import { AqrProduct } from "./aqrProduct.entity";

export enum QualityParameterType {
     GOOD = "good",
     BAD = "bad",
    AVERAGE="average"

}
@Entity("aqr_parameter")
export class AqrParameter extends Model {

    @Column()
    qualityParameterId: string;

    @Column()
    qualityParameterName: string;

    @Column({
        type: "enum",
        enum: QualityParameterType
    })
    qualityParameterType: QualityParameterType;

    @Column("float")
    quantity: number;

    @Column("float")
    percentage: number;

   @ManyToOne(() => Aqr, (aqr) => aqr.parameters,{ onDelete: "SET NULL" })
   aqr: Aqr;

   /** The AQR line this parameter was measured on (null on legacy header-level rows). */
   @ManyToOne(() => AqrProduct, (aqrProduct) => aqrProduct.parameters, { nullable: true, onDelete: "CASCADE" })
   @JoinColumn({ name: "aqr_product_id" })
   aqrProduct: AqrProduct;

}
//@JoinColumn({ name: "aqr_id" })