import { Column, Entity, Index, OneToMany } from 'typeorm';
import Model from '../../../global/model.entity';
import { ProductAttributeValue } from './productAttributeValue.entity';

/**
 * The legacy text columns on `productVarient` a value of this attribute is
 * copied into, so reports and exports that read `variant.count` etc. keep
 * working. An attribute added later has no code and lives only in the
 * variant's values and name.
 */
export const VARIANT_FIELDS = ['count', 'size', 'variety', 'origin', 'brand'] as const;
export type VariantField = (typeof VARIANT_FIELDS)[number];

/**
 * A dimension a product can vary by - Count, Size, Variety, Origin, Brand.
 * docs/product-variant-plan.md §1.
 */
@Entity('product_attribute')
export class ProductAttribute extends Model {
  @Index('UQ_product_attribute_name', { unique: true })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  code: VariantField | null;

  /** Order of the attribute in variant names and on the product form. */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => ProductAttributeValue, (value) => value.attribute)
  values: ProductAttributeValue[];
}
