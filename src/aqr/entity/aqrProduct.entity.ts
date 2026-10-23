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

  /** Net kg that arrived (weighed at the receiving CC/DC). */
  @Column("decimal", { precision: 12, scale: 3, nullable: true })
  arrivedQty: number;

  /** Quantity of the source line in its unit (boxes, crates …) at the time the AQR was made. */
  @Column("decimal", { precision: 12, scale: 3, nullable: true })
  sentUnits: number | null;

  /** Units that arrived (counted lines); null for lines counted in kg. */
  @Column("decimal", { precision: 12, scale: 3, nullable: true })
  arrivedUnits: number | null;

  /** Transit loss, set by the server: sent − arrived kg (negative = excess). */
  @Column("decimal", { precision: 12, scale: 3, nullable: true })
  lossKg: number | null;

  /** Transit loss in units: sent − arrived units. */
  @Column("decimal", { precision: 12, scale: 3, nullable: true })
  lossUnits: number | null;

  /** Transit loss value: lost units × unit price of the source line. */
  @Column("decimal", { precision: 14, scale: 2, nullable: true })
  lossValue: number | null;

  /** Batch of the source line (transfer lines carry the batch the Transfer DC took). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  batchNo: string | null;

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
