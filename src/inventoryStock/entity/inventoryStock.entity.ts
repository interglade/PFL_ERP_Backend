import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import Model from "../../global/model.entity";
import { Branches } from "../../branch/entity/branches.entity";
import { Company } from "../../company/entity/company.entity";
import { Product } from "../../product/createproduct/entity/product.entity";
import { ProductVarient } from "../../product/productVarient/entity/productVarient.entity";


@Entity("inventory_stock")
export class InventoryStock extends Model {

  @ManyToOne(() => Branches, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "location_id" })
  location: Branches;

  @ManyToOne(() => Company, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "company_id" })
  company: Company;

  @ManyToOne(() => Product, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "product_id" })
  product: Product;

  @ManyToOne(() => ProductVarient, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "variant_id" })
  variant: ProductVarient;




  // Purchase (Opening Inward from GRN / Purchase)
  // @Column("decimal", { precision: 10, scale: 2, default: 0 })
  // purchaseQty: number;

  // @Column("decimal", { precision: 12, scale: 2, default: 0 })
  // purchaseAmt: number;


  // Inward (Inward Register, Production, Transfers)
  @Column("decimal", { precision: 10, scale: 2, default: 0 })
  inwardQty: number;

  @Column("decimal", { precision: 12, scale: 2, default: 0 })
  inwardAmt: number;


  // Dump / Wastage
  @Column("decimal", { precision: 10, scale: 2, default: 0 })
  dumpQty: number;

  @Column("decimal", { precision: 12, scale: 2, default: 0 })
  dumpAmt: number;


  
}
