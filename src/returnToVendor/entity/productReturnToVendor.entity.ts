import { ManyToOne, JoinColumn, Column, Entity } from "typeorm";

import { ReturnToVendor } from "./returnToVendor.entity";


import { format } from "date-fns";
import Model from "../../global/model.entity";
import { Product } from "../../product/createproduct/entity/product.entity";
import { ProductVarient } from "../../product/productVarient/entity/productVarient.entity";
import { UOM } from "../../uom/entity/uom.entity";

@Entity('return_to_vendor_product') 
export class ProductReturnToVendor extends Model {

    @ManyToOne(() => ReturnToVendor, (rtv) => rtv.rtvProducts,{nullable: true,onDelete: "SET NULL"})
      @JoinColumn({ name: "return_to_vendor_id" })
      returnToVendor: ReturnToVendor;

      @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
      @JoinColumn({ name: 'product_id' })
      productName: Product;

       @ManyToOne(() => ProductVarient, { onDelete: 'SET NULL', cascade: true })
       @JoinColumn({ name: 'varient_id' })
       variant: ProductVarient ;

       @ManyToOne(() => UOM, { nullable: true,onDelete: "SET NULL",cascade: true})
        @JoinColumn({ name: "uom_id" })
        uom: UOM;

        @Column('decimal', { precision: 10, scale: 2 ,nullable: true})
        quantity: number | null;

       @Column('decimal', { precision: 10, scale: 2 ,nullable: true})
       unitPrice: number | null;

         @Column('decimal', { precision: 10, scale: 2 ,nullable: true})
        amount: number | null;
        
        @Column('decimal', { precision: 10, scale: 2 ,nullable: true})
        grossWeight: number | null;

        @Column('decimal', { precision: 10, scale: 2 ,nullable: true})
        packingMaterialWeight: number | null;

        @Column('decimal', { precision: 10, scale: 2 ,nullable: true})
        netWeight: number | null;

        @Column({ nullable: true, transformer: { from: (value: any) => value === 1, to: (value: boolean) => value ? 1 : 0 }})
         rtv: boolean;

         @Column({ type: 'date', nullable: true, default: null ,
          //  transformer: {
          //        to: (value: Date) => value, 
          //        from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
          //      },
               })
          purchaseDate: Date | null; 

          @Column({ type: 'date', nullable: true, default: null , 
            // transformer: {
            //       to: (value: Date) => value, 
            //       from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
            //     },
                })
          dispatchDate: Date | null; 

          @Column({ type: 'date', nullable: true, default: null , 
            // transformer: {
                //   to: (value: Date) => value, 
                //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
                // },
                })
          deliveryDate: Date | null; 

          @Column({ type: 'varchar', length: 255, nullable: true })
          deliveryLocation: string | null; 

           @Column({ type: 'varchar', length: 255, nullable: true })
          reason: string | null; 


}