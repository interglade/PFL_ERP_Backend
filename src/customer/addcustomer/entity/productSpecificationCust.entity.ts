import { Column, Entity, ManyToOne } from "typeorm";
import Model from "../../../global/model.entity";
import { Customer } from "./customer.entity";


@Entity("customer_product_specification")
export class ProductSpecification extends Model{
    @Column({ name: 'artical_Names', nullable: true})
    articleName: string;
    @Column({ name: 'specification', nullable: true})
    specifications: string;
    @Column({ name: 'packing_material_specfication', nullable: true})
    packingMaterialSpec: string;
    @Column({ name: 'packing_parameters', nullable: true})
    parameters: string;
    @Column({ name: 'rejection_criteria', nullable: true})
    rejectionCriteria: string;
    @Column({ name: 'comment', nullable: true})
    comment: string;
    @ManyToOne(() => Customer, (customer) => customer.productSpecification,{ onDelete: "SET NULL" })
    customer: Customer;
}

