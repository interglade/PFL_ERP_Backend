import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { BankDetails } from './bankDetailsCompany.entity';
import Model from '../../global/model.entity';
;

@Entity('company')
export class Company extends Model {
  @Column({ nullable: true })
  name: string;
  @Column({ nullable: true })
  officeAddress: string;

  @Column({ nullable: true })
  gstNo: string;

  @Column({ nullable: true })
  fassaiNo: string;

  @Column({ nullable: true })
  logo: string;
  @OneToMany(() => BankDetails, (bankDetails) => bankDetails.company, {
    cascade: true, 
    nullable: true,
  })
  bankDetails: BankDetails[];
}
