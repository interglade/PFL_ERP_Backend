import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";

import Model from "../../global/model.entity";
import { Aqr } from "./aqr.entity";
import { AqrParameter } from "./aqrQuality.entity";
import { Product } from "../../product/createproduct/entity/product.entity";
import { ProductVarient } from "../../product/productVarient/entity/productVarient.entity";
import { UOM } from "../../uom/entity/uom.entity";

/**
 * One line of an Arrival Quality Report: one product (+ variant) of the
 * source GRN / Transfer DC / RBC with its arrived and sampled kg and the
 * quality parameters measured on that sample.
 *
 * Legacy AQRs (created before receiving links) have no lines; their single
 * product lives in the header columns of `aqr` and is synthesised into one
 * line by the AQR service and the receiving status.
 */
@Entity("aqr_product")
@Index(["aqr"])
export class AqrProduct extends Model {
  @ManyToOne(() => Aqr, (aqr) => aqr.products, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "aqr_id" })
  aqr: Aqr;

  @ManyToOne(() => Product, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "product_id" })
  productName: Product;

  @ManyToOne(() => ProductVarient, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "varient_id" })
  variant: ProductVarient;

  @ManyToOne(() => UOM, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "uom_id" })
  uom: UOM;

  /** Net kg of this product on the source document at the time the AQR was made. */
  @Column("decimal", { precision: 12, scale: 3, nullable: true })
  receivedQty: number;

  @Column("decimal", { precision: 12, scale: 3, nullable: true })
  arrivedQty: number;

  @Column("decimal", { precision: 12, scale: 3, nullable: true })
  samplingQty: number;

  @Column("decimal", { precision: 12, scale: 3, nullable: true })
  totalQty: number;

  @Column("decimal", { precision: 6, scale: 2, nullable: true })
  totalpercent: number;

  @Column({ type: "text", nullable: true })
  remark: string;

  @OneToMany(() => AqrParameter, (parameter) => parameter.aqrProduct, { cascade: true })
  parameters: AqrParameter[];
}
