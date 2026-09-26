import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import Model from '../../global/model.entity';

import { RFPA } from './rfpa.entity';
import { format } from 'date-fns';
import { Product } from '../../product/createproduct/entity/product.entity';
import { ProductVarient } from '../../product/productVarient/entity/productVarient.entity';
import { UOM } from '../../uom/entity/uom.entity';


@Entity('rfpa_product')
export class RFPAProduct extends Model {
  @ManyToOne(() => Product, { onDelete: 'SET NULL', cascade: true })
  @JoinColumn({ name: 'product_id' })
  productName: Product;

  @ManyToOne(() => ProductVarient, { onDelete: 'SET NULL', cascade: true })
  @JoinColumn({ name: 'varient_id' })
  variant: ProductVarient;

  @Column('character varying', { name: 'grade', nullable: true, length: 100 })
  grade: string;

  @Column('integer', { name: 'quantity' })
  quantity: number;

  @ManyToOne(() => UOM, { onDelete: 'SET NULL', nullable: true, cascade: true })
  @JoinColumn({ name: 'uom_id' })
  uom: UOM;

  @Column('numeric', { name: 'unit_price', precision: 10, scale: 2 })
  unitPrice: number;
  @Column('character varying', { name: 'count', nullable: true, length: 100 })
  count: string;

  @Column('character varying', { name: 'size', nullable: true, length: 100 })
  size: string;
  @Column('character varying', { name: 'origin', nullable: true, length: 100 })
  origin: string;
  @Column('character varying', { name: 'variety', nullable: true, length: 100 })
  variety: string;

  // @Column({ name: 'description', nullable: true })
  // description: string;
  @Column('numeric', { name: 'total_value', precision: 10, scale: 2 })
  amount: number;

  @Column({
    type: 'date',
    nullable: true,
    default: null,
    // transformer: {
    //   to: (value: Date) => value,
    //   from: (value: string) =>
    //     value ? format(new Date(value), 'dd-MM-yyyy') : null,
    // },
  })
  purchaseDate: Date;
  @Column({
    type: 'date',
    nullable: true,
    default: null,
    // transformer: {
    //   to: (value: Date) => value,
    //   from: (value: string) =>
    //     value ? format(new Date(value), 'dd-MM-yyyy') : null,
    // },
  })
  expectedHarvestDate: Date;

  @Column({
    type: 'date',
    nullable: true,
    // transformer: {
    //   to: (value: Date) => value,
    //   from: (value: string) =>
    //     value ? format(new Date(value), 'dd-MM-yyyy') : null,
    // },
  })
  dispatchDate: Date;

  @Column({
    type: 'date',
    nullable: true,
    // transformer: {
    //   to: (value: Date) => value,
    //   from: (value: string) =>
    //     value ? format(new Date(value), 'dd-MM-yyyy') : null,
    // },
  })
  deliveryDate: Date;

  @ManyToOne(() => RFPA, (rfpa) => rfpa.rfpaProducts, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'rfpa_id' })
  rfpa: RFPA;
}
// @Column({
//   type: 'date',
//   nullable: true,
//   transformer: {
//     // TO database: convert string to Date object
//     to: (value: string | Date) => {
//       if (!value) return null;
//       if (value instanceof Date) return value;

//       // Parse dd-MM-yyyy format to Date
//       const [day, month, year] = value.split('-');
//       return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
//     },
//     // FROM database: convert Date to formatted string for display
//     from: (value: Date) => {
//       if (!value) return null;
//       return format(new Date(value), "dd-MM-yyyy");
//     }
//   }
// })
// purchaseDate: Date;

// @Column({
//   type: 'date',
//   nullable: true,
//   transformer: {
//     // TO database: convert string to Date object
//     to: (value: string | Date) => {
//       if (!value) return null;
//       if (value instanceof Date) return value;

//       // Parse dd-MM-yyyy format to Date
//       const [day, month, year] = value.split('-');
//       return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
//     },
//     // FROM database: convert Date to formatted string for display
//     from: (value: Date) => {
//       if (!value) return null;
//       return format(new Date(value), "dd-MM-yyyy");
//     }
//   }
// })
// deliveryDate: Date;

// @Column({
//   type: 'date',
//   nullable: true,
//   transformer: {
//     // TO database: convert string to Date object
//     to: (value: string | Date) => {
//       if (!value) return null;
//       if (value instanceof Date) return value;

//       // Parse dd-MM-yyyy format to Date
//       const [day, month, year] = value.split('-');
//       return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
//     },
//     // FROM database: convert Date to formatted string for display
//     from: (value: Date) => {
//       if (!value) return null;
//       return format(new Date(value), "dd-MM-yyyy");
//     }
//   }
// })
// dispatchDate: Date;

//  @Column({
//   type: 'date',
//   nullable: true,
//   transformer: {
//     // TO database: convert string to Date object
//     to: (value: string | Date) => {
//       if (!value) return null;
//       if (value instanceof Date) return value;

//       // Parse dd-MM-yyyy format to Date
//       const [day, month, year] = value.split('-');
//       return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
//     },
//     // FROM database: convert Date to formatted string for display
//     from: (value: Date) => {
//       if (!value) return null;
//       return format(new Date(value), "dd-MM-yyyy");
//     }
//   }
// })
// expectedHarvestDate: Date;
