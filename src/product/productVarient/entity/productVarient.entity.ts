import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from 'typeorm';

import { Exclude } from 'class-transformer';
import Model from '../../../global/model.entity';
import { Product } from '../../createproduct/entity/product.entity';
import { ProductAttributeValue } from '../../productAttribute/entity/productAttributeValue.entity';

/**
 * One sellable combination of a product's attribute values, e.g. Imported Green
 * Kiwi with Origin New Zealand and Size 33. Generated from the product's allowed
 * values, never typed (docs/product-variant-plan.md §3).
 */
@Entity('productVarient')
@Index('UQ_product_variant_combination', ['product', 'combinationKey'], {
  unique: true,
  where: '"combination_key" IS NOT NULL',
})
export class ProductVarient extends Model {
  @ManyToOne(() => Product, (product) => product.variant, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Exclude()
  @Column({ type: 'varchar', length: 200, nullable: true })
  productName?: string;

  /** Product name plus the values, rebuilt when either is renamed. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  variantName?: string;

  /** Product code plus `sequence`; assigned once and never changed. */
  @Column({
    name: 'varient_code',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  variantCode: string;

  @Column({ name: 'sequence', type: 'int', nullable: true })
  sequence: number | null;

  @ManyToMany(() => ProductAttributeValue)
  @JoinTable({
    name: 'product_variant_value',
    joinColumn: { name: 'variant_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'attribute_value_id', referencedColumnName: 'id' },
  })
  values: ProductAttributeValue[];

  /** The sorted value ids, so the same combination cannot be saved twice. */
  @Column({ name: 'combination_key', type: 'varchar', length: 1000, nullable: true })
  combinationKey: string | null;

  /** Inactive variants stay on old documents but are not offered for new ones. */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // Read-only copies of the values of the five standard attributes, kept so
  // reports and exports that read these columns keep working.
  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true })
  count: string | null;

  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true })
  size: string | null;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  variety: string | null;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  origin: string | null;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  brand: string | null;
}
