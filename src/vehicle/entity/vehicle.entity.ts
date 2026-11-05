import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { RegistrationModel } from '../../transport/registration.entity';
import { Transporter } from '../../transporter/entity/transporter.entity';

/**
 * A registered vehicle. It may belong to a transporter or be independent (a local
 * driver's own vehicle). Usable in other forms while still pending approval.
 */
@Entity('vehicles')
@Index('UQ_vehicles_code', ['vehicleCode'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('UQ_vehicles_vehicle_no', ['vehicleNoNormalized'], { unique: true, where: '"deletedAt" IS NULL' })
@Index(['status'])
export class Vehicle extends RegistrationModel {
  @Column({ type: 'varchar', length: 20, nullable: true })
  vehicleCode: string;

  /** As typed by the user, for display. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  vehicleNo: string;

  /** Upper case without spaces or dashes; the uniqueness key. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  vehicleNoNormalized: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  vehicleType: string;

  @Column({ type: 'decimal', precision: 12, scale: 3, nullable: true })
  capacityKg: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  rcNumber: string;

  @ManyToOne(() => Transporter, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'transporter_id' })
  transporter: Transporter;
}
