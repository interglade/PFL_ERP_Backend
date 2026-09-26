import { Column, DeleteDateColumn, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";

import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

import { ProductReturnToVendor } from "./productReturnToVendor.entity";
import Model from "../../global/model.entity";
import { User } from "../../employee/entity/user.entity";
import { Documentb } from "../../approvalFlow/entity/docuemnt.entity";
import { DocumentDefinition } from "../../documentDef/entity/documentdef.entity";
import { GRN } from "../../grn/entity/grn.entity";
import { Company } from "../../company/entity/company.entity";
import { Branches } from "../../branch/entity/branches.entity";
import { Vendor } from "../../vendor/createVendor/entity/vendor.entity";


@Entity('return_to_vendor')
export class ReturnToVendor extends Model {

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'createdBy_id' })
    createdBy?: User | null;
    @ManyToOne(() => Documentb, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'document_id' })
    document?: Documentb;

     @ManyToOne(() => DocumentDefinition, { nullable: true, onDelete: 'SET NULL' })
     @JoinColumn({ name: 'documentDef_id' })
    documentDef?: DocumentDefinition;

    @ManyToOne(() => GRN, { nullable: true, cascade: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'grn_id' })
     grnNo: GRN;


     @ManyToOne(() => Company, {
         cascade: true,
         nullable: true,
         onDelete: 'SET NULL',
       })
       @JoinColumn({ name: 'company_id' })
     companyName: Company;

        @ManyToOne(()=> Branches,{
            cascade: true,
            nullable: true,
            onDelete: 'SET NULL',
        })
        @JoinColumn({name:'branch_id' })
     location: Branches;

     @ManyToOne(()=> Vendor,{
            cascade: true,
            nullable: true,
            onDelete: 'SET NULL',
        })
        @JoinColumn({name:'vendor_id' })
     selectedVendor: Vendor;
     
     @OneToMany(() => ProductReturnToVendor, (rtvProducts) => rtvProducts.returnToVendor, {cascade: true,
    nullable: true,
    onDelete: 'SET NULL',})
    @JoinColumn({ name: 'rtvProducts_id' })
     rtvProducts: ProductReturnToVendor[];

     @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
     returnedGrossWeight: number | null;
       
     @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
     returnedNetWeight: number | null;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
     totalAmt: number | null;

      @Column({ type: 'date', nullable: true, default: null , 
      //   transformer: {
      //   to: (value: Date) => value,
      //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
      // },
      })
      returnDate: Date | null;
       
      @Column({ type: 'varchar', length: 255, nullable: true })
      amtWords: string | null;

      @Column({ type: 'varchar', length: 255, nullable: true })
      rtvNo: string | null;

      @Column({ type: 'varchar', length: 255, nullable: true })
      remark: string | null;

      @DeleteDateColumn({ name: "deleted_at_new", nullable: true })
      deletedAtNew: Date;
   
}
