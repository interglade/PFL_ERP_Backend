import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import Model from '../../../global/model.entity';
import { ProductAttribute } from './productAttribute.entity';

/**
 * One allowed value of an attribute - "New Zealand" for Origin, "40" for Count.
 *
 * `valueKey` is the value with case and spacing ignored, unique per attribute,
 * so "New zealand" and "New Zealand" can only ever be one value.
 */
@Entity('product_attribute_value')
@Index('UQ_product_attribute_value_key', ['attribute', 'valueKey'], { unique: true })
export class ProductAttributeValue extends Model {
  @ManyToOne(() => ProductAttribute, (attribute) => attribute.values, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'attribute_id' })
  attribute: ProductAttribute;

  @Column({ type: 'varchar', length: 100 })
  value: string;

  @Column({ name: 'value_key', type: 'varchar', length: 100 })
  valueKey: string;

  /** Inactive values stay on existing variants but cannot be newly picked. */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
