import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";

import { ProcurementTarget } from "./procurmentTarget.entity";

import { ProcurementTargetWeek } from "./procurementTargetWeek.entity";
import { Product } from "../../product/createproduct/entity/product.entity";
import Model from "../../global/model.entity";

@Entity('procurement_target_products')
export class ProcurementTargetProduct extends Model {

  @ManyToOne(
    () => ProcurementTarget,
    target => target.products,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'target_id' })
  target: ProcurementTarget;

  @ManyToOne(() => Product, { nullable: false })
  @JoinColumn({ name: 'product_id' })
  product: Product;

   @Column({
  name: 'weekly_total_qty',
  type: 'decimal',
  precision: 10,
  scale: 2,
  default: 0,
})
    weeklyTotalQtyPerProduct: number;

    @Column({type: 'text', nullable: true})
    remark : string;

  @OneToMany(
    () => ProcurementTargetWeek,
    week => week.productTarget,
    { cascade: true },
  )
  weeklyProcurement: ProcurementTargetWeek[];
}