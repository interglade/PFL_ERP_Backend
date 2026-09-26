import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';

import { Company } from './company.entity';
import Model from '../../global/model.entity';


@Entity("bank_details_from_company")
export class BankDetails extends Model {
   
   

    @Column({nullable:true})
    accountNo: string;
    @Column({nullable:true})
    bankName: string;

    @Column({nullable:true})
    branch: string;

    @Column({nullable:true})
    ifscCode: string;

    @ManyToOne(() => Company, (company) => company.bankDetails)
    company: Company;
}
