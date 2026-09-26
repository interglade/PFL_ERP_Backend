import { Entity, Column, OneToMany, JoinColumn, ManyToOne } from 'typeorm';

import { format } from 'date-fns';
import { truncate } from 'node:fs';
import Model from '../../global/model.entity';
import { Company } from '../../company/entity/company.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { SkuEodReport } from './skuStock.entity';

@Entity({ name: 'stock_report' })
export class StockReportEod extends Model {
   @ManyToOne(() => Company, { cascade: true, nullable: true, onDelete: "SET NULL" })
   @JoinColumn({ name: "company_id" })
   companyName: Company;

  @ManyToOne(() => Branches, {
    cascade:true,
     nullable: true,
     onDelete: "SET NULL",
   })
   @JoinColumn({ name: "branch_id" })
   location: Branches;

  @Column({ name: 'stock_date', type: 'date', nullable: true, 
  //   transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null,
  // },
})
  stockDate: Date;

  @Column({ nullable: true })
  submission: string; 

   @Column({ nullable: true })
    eodNo: string;

  @Column({ name: 'comments', nullable: true })
  comments: string; 

  @Column({ name: 'submitted_by', nullable: true })
  submittedBy: string; 
 

  @OneToMany(() => SkuEodReport, eodReport => eodReport.stockReport, { cascade: true })
  eodProducts: SkuEodReport[];
}
