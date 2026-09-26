import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

import { User } from './user.entity';
import { DocumentDefinition } from '../../documentDef/entity/documentdef.entity';
import Model from '../../global/model.entity';

/**
 * PERMISSION DESIGN
 * -----------------
 * One table handles document, report, and inventory permissions.
 *
 * documentDefinition → points to a DocumentDefinition row whose
 *   documentType can be:
 *     - Procurement / Sale / Operation / GRN / etc.  → document permission
 *     - REPORT       → report permission
 *     - INVENTORY    → inventory permission
 *
 * Inventory location filtering:
 *   canViewAllLocations = true  → user sees inventory for ALL locations
 *   canViewAllLocations = false → query filters by:
 *       location.id = user.currentWorkLocation.id
 *       OR location.id IN (user.accessLocation[].id)
 */
@Entity('document_permissions')
export class DocumentPermission extends Model {

  @ManyToOne(() => DocumentDefinition, (docDef) => docDef.permissions)
  @JoinColumn({ name: 'document_definition_id' })
  documentDefinition: DocumentDefinition;

  @ManyToOne(() => User)
  employee: User;

  @Column({ default: false })
  canCreate: boolean;

  @Column({ default: false })
  canView: boolean;

  @Column({ default: false })
  canEdit: boolean;

  @Column({ default: false })
  canDelete: boolean;

  @Column({ default: false })
  canDownload: boolean;

  /**
   * Only relevant when documentDefinition.documentType === 'INVENTORY'
   * true  → show inventory across all locations
   * false → filter by user.currentWorkLocation + user.accessLocation
   */
  // @Column({ default: false })
  // canViewAllLocations: boolean;
}
