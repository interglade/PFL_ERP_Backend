import { Entity, Column, OneToOne, JoinColumn, ManyToOne, Index } from 'typeorm';
import { RegistrationModel } from '../../transport/registration.entity';
import { Address } from '../../address/entity/address.entity';
import { Transporter } from '../../transporter/entity/transporter.entity';

/**
 * A registered driver. May work for a transporter or be independent (a local
 * driver). Registered like a Vendor or Farmer: draft → pending → approved / rejected
 * (see TransportRegistrationService); usable in other forms while still pending.
 *
 * NOTE for schema changes: the pre-existing columns (`firstName`, `lastName`, `email`,
 * `phoneNumber`, `vehicleType`, `vehicleNo`) deliberately keep their original type
 * and length. TypeORM `synchronize` recreates a column when its type or length
 * changes, which would erase the stored data; relaxing `nullable` is a plain ALTER.
 */
@Entity('drivers')
@Index('UQ_drivers_code', ['driverCode'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('UQ_drivers_phone', ['phoneNumber'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('UQ_drivers_email', ['email'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('UQ_drivers_license', ['licenseNo'], { unique: true, where: '"deletedAt" IS NULL' })
@Index(['status'])
export class Drivers extends RegistrationModel {
  @Column({ type: 'varchar', length: 20, nullable: true })
  driverCode: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  phoneNumber: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  altPhoneNumber: string;

  @OneToOne(() => Address, { cascade: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  address: Address;

  @Column({ type: 'varchar', length: 30, nullable: true })
  licenseNo: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  licenseType: string;

  @Column({ type: 'date', nullable: true })
  licenseExpiry: string;

  @ManyToOne(() => Transporter, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'transporter_id' })
  transporter: Transporter;

  /** @deprecated Vehicles are registered separately now; kept so old rows keep their values. */
  @Column({ nullable: true })
  vehicleType: string;

  /** @deprecated See `vehicleType`. */
  @Column({ nullable: true })
  vehicleNo: string;
}
