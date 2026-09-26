import {
  Column,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import Model from '../../../global/model.entity';
import { Product } from './product.entity';

export enum Acceptability {
  ACCEPTABLE = 'good',
  NON_ACCEPTABLE = 'bad',
  AVERAGE = 'average',
}

@Entity('quality_parameters')
export class QualityParameter extends Model {
  @Index()
  @Column({ name: 'parameter_name', type: 'varchar', length: 100 })
  name: string;

  @Index()
  @Column({
    type: 'enum',
    enum: Acceptability,
    default: Acceptability.ACCEPTABLE,
  })
  type: Acceptability;

  @ManyToOne(() => Product, (product) => product.qualityParameters, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'product_id' })
  product: Product;
}
