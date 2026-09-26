import { Column, Entity, ManyToOne } from "typeorm";
import Model from "../../global/model.entity";
import { Aqr} from "./aqr.entity";

enum QualityParameterType {
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
   

}
//@JoinColumn({ name: "aqr_id" })