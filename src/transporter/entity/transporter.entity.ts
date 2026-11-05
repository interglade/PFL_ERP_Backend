import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';
import { RegistrationModel } from '../../transport/registration.entity';
import { Address } from '../../address/entity/address.entity';

export enum TransporterType {
  FLEET_OWNER = 'fleet-owner',
  BROKER = 'broker',
  OWN_FLEET = 'own-fleet',
}

/**
 * Transport company / agency a vehicle can belong to. Registered like a Vendor or
 * Farmer: draft → pending → approved / rejected (see TransportRegistrationService).
 */
@Entity('transporters')
@Index('UQ_transporters_code', ['transporterCode'], { unique: true, where: '"deletedAt" IS NULL' })
@Index(['status'])
@Index(['name'])
export class Transporter extends RegistrationModel {
  @Column({ type: 'varchar', length: 20, nullable: true })
  transporterCode: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  name: string;

  @Column({ type: 'enum', enum: TransporterType, nullable: true })
  transporterType: TransporterType;

  @Column({ type: 'varchar', length: 100, nullable: true })
  contactPerson: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  primaryPhone: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  altPhone: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string;

  @OneToOne(() => Address, { cascade: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'address_id' })
  address: Address;

  @Column({ type: 'varchar', length: 15, nullable: true })
  gstin: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  pan: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  bankName: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  accountHolderName: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  accountNo: string;

  @Column({ type: 'varchar', length: 11, nullable: true })
  ifsc: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  upiId: string;

  @Column({ type: 'text', nullable: true })
  paymentTerms: string;

  @Column({ type: 'int', nullable: true })
  creditDays: number;
}
