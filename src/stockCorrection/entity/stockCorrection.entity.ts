import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import Model from "../../global/model.entity";
import { InventoryStock } from "../../inventoryStock/entity/inventoryStock.entity";
import { Company } from "../../company/entity/company.entity";
import { Branches } from "../../branch/entity/branches.entity";
import { Product } from "../../product/createproduct/entity/product.entity";
import { ProductVarient } from "../../product/productVarient/entity/productVarient.entity";
import { User } from "../../employee/entity/user.entity";


export enum CorrectionStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
}

export enum CorrectionType {
  PHYSICAL_COUNT = "physical_count",
  DAMAGE_WRITE_OFF = "damage_write_off",
  SYSTEM_ERROR = "system_error",
  OTHER = "other",
}

export enum DumpReason {
  DAMAGE = "damage",
  EXPIRY = "expiry",
  PEST = "pest",
  FIRE = "fire",
  OTHER = "other",
}

@Entity("stock_correction")
export class StockCorrection extends Model {

  @ManyToOne(() => InventoryStock, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "inventory_stock_id" })
  inventoryStock: InventoryStock;

  // Denormalized for easy querying
  @ManyToOne(() => Company, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "company_id" })
  company: Company;

  @ManyToOne(() => Branches, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "location_id" })
  location: Branches;

  @ManyToOne(() => Product, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "product_id" })
  product: Product;

  @ManyToOne(() => ProductVarient, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "variant_id" })
  variant: ProductVarient;

  // --- Inward correction numbers ---
  @Column("decimal", { precision: 10, scale: 2 })
  systemQty: number;        // DB madhe jo inwardQty hota

  @Column("decimal", { precision: 10, scale: 2 })
  physicalQty: number;      // Physical count madhe jo aala

  @Column("decimal", { precision: 10, scale: 2 })
  correctionDelta: number;  // physicalQty - systemQty (positive or negative)

  @Column("decimal", { precision: 12, scale: 2, default: 0 })
  correctionAmt: number;    // inwardAmt adjustment

  // --- Dump / Damage specific ---
  @Column({ type: "enum", enum: DumpReason, nullable: true })
  dumpReason: DumpReason;

  @Column("decimal", { precision: 10, scale: 2, default: 0 })
  dumpQty: number;          // Qty being written off (e.g. 200 bags)

  @Column("decimal", { precision: 12, scale: 2, default: 0 })
  dumpAmt: number;          // Amount loss for this dump

  @Column({ nullable: true })
  dumpRemarks: string;

  @Column({ type: "date", nullable: true })
  dumpDate: Date;

  // --- Metadata ---
  @Column({ type: "enum", enum: CorrectionType, default: CorrectionType.PHYSICAL_COUNT })
  correctionType: CorrectionType;

  @Column({ type: "enum", enum: CorrectionStatus, default: CorrectionStatus.PENDING })
  status: CorrectionStatus;

  @Column({ nullable: true })
  reason: string;

  @Column({ nullable: true })
  remarks: string;

  // --- Who did what ---
  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  createdBy: User;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "approved_by" })
  approvedBy: User;

  @Column({ type: "timestamp", nullable: true })
  approvedAt: Date;

  @Column({ type: "date", nullable: true })
  correctionDate: Date;
}
