import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';

import { format, toZonedTime } from 'date-fns-tz';
import Model from '../../global/model.entity';
import { GRN } from '../../grn/entity/grn.entity';
import { User } from '../../employee/entity/user.entity';

@Entity("payment_request")
export class PaymentRequest extends Model {
  @CreateDateColumn({type: "date",
      transformer: {
        from: (value: string) => {
          return value ? format(toZonedTime(value, "Asia/Kolkata"), "dd-MM-yyyy hh:mm a", { timeZone: "Asia/Kolkata" }) : null;
        },
        to: (value: Date) => value, // Store raw Date object
      },
    })
  paymentDate: Date;

  @Column({ type: 'varchar', length: 100 })
  partyName: string;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 20 })
  bankAccNo: string;

  @Column({ type: 'varchar', length: 11 })
  ifscCode: string;

  @Column({ type: 'varchar', length: 50 })
  paymentMode: string;

  @Column({ type: 'varchar', length: 50 })
  typesOfTransaction: string;
  @Column({ type: 'varchar', length: 50 ,nullable:true})
  otherTransaction: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  vehicleNo: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  placeOfPurchase: string;

  @Column({ type: 'varchar', length: 100 })
  contactpersonRec: string;
  @Column({ type: 'varchar', length: 100 })
  contactpersonSen: string;
  @Column({ type: 'varchar', length: 100 })
  costCenter: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  kycByEmail: string;

  @Column({ type: 'text', nullable: true })
  remark: string;
  @ManyToOne(() => GRN, {nullable:true,onDelete: "SET NULL"})
  @JoinColumn({ name: "grn_id" })
  grn: GRN;
  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true})
  @JoinColumn({ name: "requested_by_employee_id" })  // Define the foreign key column
  requestedBy: User;
}
