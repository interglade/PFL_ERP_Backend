import { Entity,  Column, ManyToOne, JoinColumn, OneToOne } from 'typeorm';
import Model from '../../../global/model.entity';

import { Customer } from './customer.entity';
import { format, parse } from "date-fns";
import { toZonedTime } from 'date-fns-tz';
import { Address } from '../../../address/entity/address.entity';
@Entity('customer_delivery_details')
export class DeliveryDetails extends Model{
  

  @ManyToOne(() => Address, { cascade: true, nullable: true,onDelete: "SET NULL" })
  @JoinColumn()
  deliveryAddress: Address;
  @Column({ name: 'delivery_address_copy', nullable: true })
  deliveryAddressProofCopy:string
  // @Column({ nullable: true }) 
  // deliveryTime: Date ; 

  

      @Column({
  type: 'timestamp',
  nullable: true,
  transformer: {
    from: (value: string | null) => {
      if (!value) return null;
      try {
        const istDate = toZonedTime(new Date(value), 'Asia/Kolkata');
        return format(istDate, 'HH:mm');
      } catch (error) {
        console.error('Date transformation error (from DB):', error);
        return null;
      }
    },
    to: (value: string | null) => {
      if (!value) return null;
      try {
        // handle both '11:43' (24h) and '11:43 am' formats without relying on date-fns parse overloads
        let parsedDate: Date | null = null;
        const input = value.trim();
        const lower = input.toLowerCase();

        if (lower.includes('am') || lower.includes('pm')) {
          // match "h:mm am/pm" or "hh:mm am/pm"
          const match = input.match(/^\s*(\d{1,2}):(\d{2})\s*(am|pm)\s*$/i);
          if (match) {
            let hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const meridiem = match[3].toLowerCase();
            if (meridiem === 'pm' && hours !== 12) hours += 12;
            if (meridiem === 'am' && hours === 12) hours = 0;
            parsedDate = new Date();
            parsedDate.setHours(hours, minutes, 0, 0);
          }
        } else {
          // match "HH:mm" (24-hour)
          const match = input.match(/^\s*(\d{1,2}):(\d{2})\s*$/);
          if (match) {
            const hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            parsedDate = new Date();
            parsedDate.setHours(hours, minutes, 0, 0);
          }
        }

        if (!parsedDate) {
          // fallback: try to construct Date directly
          parsedDate = new Date(input);
          if (isNaN(parsedDate.getTime())) {
            throw new Error('Unable to parse time input: ' + value);
          }
        }

        const istDate = toZonedTime(parsedDate, 'Asia/Kolkata');
        return format(istDate, 'yyyy-MM-dd HH:mm:ss');
      } catch (error) {
        console.error('Date transformation error (to DB):', error);
        return null;
      }
    },
  },
})
deliveryTime: string | null;


  @Column({ name: 'delivery_details_receiving_person_fname', nullable: true})
  receivingPersonFName: string;
  @Column({ name: 'delivery_details_receiving_person_mname', nullable: true})
  receivingPersonMName: string;
  
    @Column({ name: 'delivery_details_receiving_person_lname', nullable: true })
  receivingPersonLName: string;
  @Column({ name: 'delivery_details_receiving_person_primary_mobile_no', nullable: true })
  primaryContactNo: string;

  @Column({ name: 'delivery_details_receiving_person_alternate_no', nullable: true })
  secondaryContactNo: string;

  @Column({ name: 'delivery_details_email_primary', nullable: true })
  emailPrimary: string;

  @Column({ name: 'delivery_details_email_secondary', nullable: true })
  emailSecondary: string;

  @OneToOne(() => Customer, (customer) => customer.deliveryDetails,{ onDelete: "SET NULL" })
  customer: Customer;
}
