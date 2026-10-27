import { EntityManager } from 'typeorm';
import AppError from '../utils/appError';
import { Documentb, DocumentStatus, DocumentTypeEnum } from './entity/docuemnt.entity';

/** Statuses after which a document's data may no longer change, for any user (admins included). */
const LOCKED_STATUSES: ReadonlyArray<string> = [DocumentStatus.COMPLETE, DocumentStatus.REJECT];

/** Why a document in `status` cannot be edited, or null when it can. */
export function editLockMessage(label: string, status: string | null | undefined, isDeleted = false): string | null {
  if (isDeleted) return `${label} has been deleted; it can no longer be changed`;
  if (status === DocumentStatus.COMPLETE) return `${label} is approved; it can no longer be changed`;
  if (status === DocumentStatus.REJECT) return `${label} was rejected; it can no longer be changed`;
  return null;
}

export function isDocumentLocked(status: string | null | undefined): boolean {
  return !!status && LOCKED_STATUSES.includes(status);
}

/**
 * Loads the approval document of a record and throws 409 when the record may no longer be edited
 * (approval complete, rejected, or deleted). Returns the document so callers can use its status.
 */
export async function assertDocumentEditable(
  manager: EntityManager,
  type: DocumentTypeEnum,
  recordId: string,
  label: string,
): Promise<Documentb | null> {
  const document = await manager.findOne(Documentb, {
    where: { type, document_type_id: recordId },
    order: { createdAt: 'DESC' },
    withDeleted: true,
  });
  const message = editLockMessage(label, document?.status, !!document && (document.isDeleted || !!document.deletedAt));
  if (message) throw new AppError(409, message);
  return document;
}
