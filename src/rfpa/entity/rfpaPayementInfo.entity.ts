import { Entity, Column } from "typeorm";

import { format } from "date-fns";
import Model from "../../global/model.entity";

@Entity("payment_info_for_rfpa")
export class PaymentInfoForRFPA extends Model {
  
  @Column("character varying", { name: "payment_mode", length: 100 })
  paymentMode: string;

  @Column( { name: "payment_date", type: 'date', nullable: true, 
  //   transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, 
  // },
})
  paymentDate: Date;



  @Column("numeric", { name: "advance_paid_amount", precision: 10, scale: 2 ,nullable: true })
  advancePaidAmt: number;

  @Column("numeric", { name: "payment_terms",  precision: 10, scale: 2 ,nullable: true })
  paymentTerms: number;

  @Column( { name: "payment_dute_date", nullable: true, type: 'date', 
  //   transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, 
  // },
}) 
  dueDate: Date;


  @Column({ name: "credite_period", nullable: true })
  creditPeriod: number;
  @Column("character varying", { name: "validity_of_quote", nullable: true })
  validityOfQuote: string;
}

//   @Column({ 
//   type: 'date', 
//   nullable: true,
//   transformer: {
//     // TO database: convert string to Date object
//     to: (value: string | Date) => {
//       if (!value) return null;
//       if (value instanceof Date) return value;
      
//       // Parse dd-MM-yyyy format to Date
//       const [day, month, year] = value.split('-');
//       return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
//     },
//     // FROM database: convert Date to formatted string for display
//     from: (value: Date) => {
//       if (!value) return null;
//       return format(new Date(value), "dd-MM-yyyy");
//     }
//   }
// })
//  paymentDate: Date;

//   @Column({ 
//   type: 'date', 
//   nullable: true,
//   transformer: {
//     // TO database: convert string to Date object
//     to: (value: string | Date) => {
//       if (!value) return null;
//       if (value instanceof Date) return value;
      
//       // Parse dd-MM-yyyy format to Date
//       const [day, month, year] = value.split('-');
//       return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
//     },
//     // FROM database: convert Date to formatted string for display
//     from: (value: Date) => {
//       if (!value) return null;
//       return format(new Date(value), "dd-MM-yyyy");
//     }
//   }
// })
//  dueDate: Date;
