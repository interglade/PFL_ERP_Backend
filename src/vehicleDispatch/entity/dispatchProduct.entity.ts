import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import Model from '../../global/model.entity';
import { VehicleDispatch } from './vehicleDispatch.entity';
import { Product } from '../../product/createproduct/entity/product.entity';
import { ProductVarient } from '../../product/productVarient/entity/productVarient.entity';
import { UOM } from '../../uom/entity/uom.entity';
import { PackingMaterial } from '../../packingMaterial/entity/packingMaterial.entity';

/**
 * One product line of a dispatch: a read-only copy of the source line (GRN
 * product or delivery challan item) taken when the dispatch is created, so the
 * dispatch keeps what was loaded even if the source is edited later.
 */
@Entity('dispatch_product')
@Index(['dispatch'])
export class DispatchProduct extends Model {
  @ManyToOne(() => VehicleDispatch, (dispatch) => dispatch.products, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispatch_id' })
  dispatch: VehicleDispatch;

  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  productName: Product;

  @ManyToOne(() => ProductVarient, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'varient_id' })
  variant: ProductVarient;

  @ManyToOne(() => UOM, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uom_id' })
  uom: UOM;

  @Column('decimal', { precision: 20, scale: 3, nullable: true })
  quantity: string;

  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  unitPrice: string;

  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  amount: string;

  /** Not recorded on GRN lines, so empty for purchase dispatches. */
  @ManyToOne(() => PackingMaterial, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'packaging_material_id' })
  packagingMaterial: PackingMaterial;

  /** Weight of one packaging unit, in grams. */
  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  packingMaterialWeight: string;

  /** kg */
  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  grossWeight: string;

  /** kg */
  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  netWeight: string;
}
