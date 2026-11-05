import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Last serial issued per number series (e.g. `inward_register:IWD20261015`).
 * Written only by {@link nextDocumentNumber}; one row per prefix.
 */
@Entity('document_sequences')
export class DocumentSequence {
  @PrimaryColumn({ type: 'varchar', length: 200 })
  scope: string;

  @Column({ name: 'last_serial', type: 'bigint' })
  lastSerial: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
