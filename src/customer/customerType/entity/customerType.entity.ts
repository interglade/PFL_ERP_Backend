import { Entity, Column, OneToMany } from "typeorm";
import Model from "../../../global/model.entity";
import { Customer } from "../../addcustomer/entity/customer.entity";



@Entity("customer_type")
export class CustomerType extends Model {
  @Column()
  name: string;

  
  @OneToMany(() => Customer, (customer) => customer.customerTypes,{ onDelete: "SET NULL" })
  customers: Customer[];
}
