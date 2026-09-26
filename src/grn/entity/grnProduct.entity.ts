import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";

import { GRN } from './grn.entity';
import Model from "../../global/model.entity";
import { format } from "date-fns-tz";
import { Product } from "../../product/createproduct/entity/product.entity";
import { ProductVarient } from "../../product/productVarient/entity/productVarient.entity";
import { UOM } from "../../uom/entity/uom.entity";



@Entity({ name: 'grn_products' }) // Table for GRN-Product relationship
export class GrnProduct extends Model {
  

  // Relation to GRN entity
  @ManyToOne(() => GRN, (grn) => grn.grnProducts,{nullable: true,onDelete: "SET NULL"})
  @JoinColumn({ name: "grn_id" })
  grn: GRN;

  // Relation to Product entity
  @ManyToOne(() => Product, { nullable: true})
  @JoinColumn({ name: "product_id" })
  productName: Product;
 

   @ManyToOne(() => ProductVarient, { onDelete: 'SET NULL', cascade: true })
    @JoinColumn({ name: 'varient_id' })
    variant: ProductVarient;
  
  // Relation to UOM entity
  @ManyToOne(() => UOM, { nullable: true,onDelete: "SET NULL",cascade: true})
  @JoinColumn({ name: "uom_id" })
  uom: UOM;

  // @Column("character varying", { name: "count", nullable: true, length: 100 })
  // count: string;

  // @Column("character varying", { name: "size", nullable: true, length: 100 })
  // size:string;

  // @Column("character varying", { name: "origin", nullable: true, length: 100 })
  // origin: string;
  
  // @Column("character varying", { name: "variety", nullable: true, length: 100 })
  // variety:string;
  @Column('decimal', { precision: 10, scale: 2,nullable: true })
  quantity: number; // Quantity of the product in the GRN
  @Column('decimal', { precision: 10, scale: 2,nullable: true })
  revisedQuantity: number; // Quantity of the product in the GRN

  // @Column({ name: 'product_origin', nullable: true })
  // productOrigin: string;
  @Column('decimal', { precision: 10, scale: 2 ,nullable: true})
  unitPrice: number; // Rate of the product per unit
  @Column('decimal', { precision: 10, scale: 2 ,nullable:true})
  revisedRate: number; // Rate of the product per unit
  @Column("decimal", { precision: 12, scale: 2, default: 0 })
  amount: number;
  
  // Product details
  // @Column("character varying", { name: "grade", nullable: true, length: 100 })
  // grade: string;

  @Column("decimal", { precision: 100, scale: 3 ,nullable:true})
  grossWeight: number;

  @Column("decimal", { precision: 100, scale: 3 ,nullable:true})
  packingMaterialWeight: number;

  @Column("decimal", { precision: 100, scale: 3,nullable:true })
  netWeight: number;
  // New fields
  @Column('boolean', { name: "rtv", nullable: true})
  rtv: boolean;
 @Column({ type: 'date', nullable: true, 
//   transformer: {
//   to: (value: Date) => value, 
//   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
// },
}) // Purchase Date
 purchaseDate: Date|null;

 @Column({ type: 'date', nullable: true ,
//    transformer: {
//   to: (value: Date) => value, 
//   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
// },
}) // Expected Harvest Date
 expectedHarvestDate: Date|null;

 @Column({ type: 'date', nullable: true , 
//   transformer: {
//   to: (value: Date) => value, 
//   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
// },
}) // Dispatch Date
 dispatchDate: Date|null;

 @Column({ type: 'date', nullable: true,
//    transformer: {
//   to: (value: Date) => value, 
//   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
// },
}) // Delivery Date
 deliveryDate: Date|null;

}


