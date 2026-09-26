import { Entity, Column} from "typeorm";

import { format } from "date-fns-tz";
import Model from "../../global/model.entity";

@Entity("payment_info_for_grn")
export class PaymentInfoForGRN extends Model {
  
  @Column("character varying", { name: "payment_mode", length: 100 ,nullable:true})
  paymentMode: string;

  @Column({ type:'date',name: "payment_date", nullable: true,
  //   transformer : {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
  // },
}) 
  paymentDate: Date;

  @Column("numeric", { name: "advance_paid_amount", precision: 10, scale: 2,nullable:true })
  advancePaidAmt: number;
   @Column("numeric", { name: "remaining_amount", precision: 10, scale: 2,nullable:true })
  remainingAmt: number;

  @Column("text", { name: "payment_terms", nullable: true })
  paymentTerms: string;

  @Column( {type:'date', name: "payment_dute_date", nullable: true ,
  //    transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
  // },
})
  dueDate: Date;
  @Column({ name: "credite_period", nullable: true })
  creditPeriod: number;
}

