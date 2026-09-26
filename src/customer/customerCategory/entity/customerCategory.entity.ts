import { Entity, Column, OneToMany, ManyToOne } from "typeorm";
import { Customer } from "../../addcustomer/entity/customer.entity";
import Model from "../../../global/model.entity";



@Entity("customer_category")
export class CustomerCategory extends Model {
  @Column()
  name: string;
  @OneToMany(() => Customer, (customer) => customer.customerCategory,{ onDelete: "SET NULL" })
  customers: Customer[];

}
