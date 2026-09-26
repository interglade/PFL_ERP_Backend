import { Entity, Column, ManyToOne, OneToOne, OneToMany } from 'typeorm';
import { Customer } from '../../customer/addcustomer/entity/customer.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { User } from '../../employee/entity/user.entity';
import { OfficesData } from '../../office/entity/offices.entity';
import { DeliveryDetails } from '../../customer/addcustomer/entity/deliveryDetailsCust.entity';
import { SecondSale } from '../../secondSale/entity/secondSale.entity';
import Model from '../../global/model.entity';
import { Farmer } from '../../farmer/entity/farmer.entity';


@Entity('addresses')
export class Address extends Model {
  @Column({ name: 'address1',nullable:true})
  address1: string;

  @Column({ name: 'address2', nullable: true })
  address2: string;

  @Column({ name: 'location', nullable: true })
  location: string;

  @Column({ name: 'city', nullable: true })
  city: string;

  @Column({ name: 'state', nullable: true})
  state: string;

  @Column({ name: 'pincode', nullable: true })
  pincode: string;

  @OneToOne(() => Customer, (customer) => customer.customerAddress,{ onDelete: "SET NULL" })
  customer: Customer;
  
  @OneToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  user?: User;

  
  // One-to-Many relationship with Branches
  @OneToMany(() => Branches, (branch) => branch.address, { onDelete: "SET NULL" })
  branches: Branches[];

  // One-to-Many relationship with OfficesData
  @OneToMany(() => OfficesData, (officeData) => officeData.address, { onDelete: "SET NULL" })
  officeData: OfficesData[];

  @OneToMany(() => DeliveryDetails, (deliveryDetails) => deliveryDetails.deliveryAddress,{ onDelete: "SET NULL" })
  deliveryDetails: DeliveryDetails[];
  @OneToOne(() => Farmer, (farmer) => farmer.residensialAddress,{ onDelete: "SET NULL" })
  farmer: Farmer;

  @OneToOne(() => SecondSale, (secondSale) => secondSale.customerAddress, { onDelete: "SET NULL" })
  secondSaleRegister: SecondSale;
}
