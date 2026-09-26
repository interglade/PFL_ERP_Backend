import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";

import { SaleOrder } from "./saleOrder.entity";
import Model from "../../global/model.entity";
import { UOM } from "../../uom/entity/uom.entity";



@Entity({ name: "sale_order_product" })
export class SaleOrderProduct extends Model {
  
      // @ManyToOne(() => Product, { onDelete: "SET NULL",cascade: true })
      // @JoinColumn({ name: "product_id" })
      // product: Product;
      @Column({ name: "productName" ,nullable:true})
      productName:string
    @Column({ name: "quantity", type: "float" ,nullable:true})
    quantity: number;

    @Column({ name: "price_per_unit", type: "decimal", precision: 10, scale: 2 ,nullable:true})
    pricePerUnit: number;

  // Relation to UOM entity
   @ManyToOne(() => UOM, { onDelete: "SET NULL",nullable:true ,cascade: true})
   @JoinColumn({ name: "uom_id" })
   uom: UOM;
 

    @Column({ name: "gst", type: "decimal", precision: 5, scale: 2 ,nullable:true})
    gst: number;

    @Column({ name: "total_amount", type: "decimal", precision: 15, scale: 2 ,nullable:true})
    totalAmount: number;

    @Column({ name: "tax_amount", type: "decimal", precision: 15, scale: 2 ,nullable:true})
    taxAmount: number;

    @Column({ name: "grand_total_amount", type: "decimal", precision: 15, scale: 2 ,nullable:true})
    grandTotalAmount: number;

    @ManyToOne(() => SaleOrder, (saleOrder) => saleOrder.saleProducts, {
        nullable: true,
        onDelete: "CASCADE",
      })
      saleOrder: SaleOrder;
}
