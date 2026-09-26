import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';

import { User } from './user.entity';
import { format } from 'date-fns';
import Model from '../../global/model.entity';


@Entity("employee_transfers")
export class Transfer extends Model {


  @Column()
  fromLocation: string;

  @Column() //relocation location
  reLocation: string;

  @Column({ type: 'date',  
  //   transformer: {
  //     to: (value: Date) => value, 
  //     from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
  //   },
  })
  transferDate: Date;

  @ManyToOne(() => User, (employee) => employee.transfers)
  employee: User;
}
