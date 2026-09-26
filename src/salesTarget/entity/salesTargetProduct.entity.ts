//sale product target entity
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";


import { extend } from "lodash";
import Model from "../../global/model.entity";
import { SalesTarget } from "./salesTarget.entity";
import { Customer } from "../../customer/addcustomer/entity/customer.entity";
import { Product } from "../../product/createproduct/entity/product.entity";

@Entity("sales_target_products")
export class SalesTargetProduct extends Model {


  @ManyToOne(() => SalesTarget)
  @JoinColumn({ name: "monthly_sales_plan_id" })
  target: SalesTarget;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: "customer_id" })
  customer: Customer;

  @ManyToOne(() => Product)
  @JoinColumn({ name: "product_id" })
  product: Product;

  @Column({ type: "decimal", default: 0 })
  totalProductSale: number; // sum of weeks
}
