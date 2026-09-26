import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import Model from "../../global/model.entity";
import { Product } from "../../product/createproduct/entity/product.entity";
import { UOM } from "../../uom/entity/uom.entity";
import { StockReportEod } from "./eodReportforinvendtory.entity";
;

@Entity({ name: "sku_eod_report" })
export class SkuEodReport extends Model {
 
  @ManyToOne(() => Product, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "sku_id" })
  sku: Product;
 
  @ManyToOne(() => UOM, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "uom_id" })
  uom: UOM;

  @Column({ name: "uom_quantity", nullable: true, type: "float" })
  qty: number;

  @Column({ name: "total_weight_in_kg", nullable: true, type: "float" })
  totalWeightInKg: number;

  @ManyToOne(() => StockReportEod, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "stock_report_id" }) // Explicit join column
  stockReport: StockReportEod;
}
