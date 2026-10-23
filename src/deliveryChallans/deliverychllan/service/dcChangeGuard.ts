/**
 * Edit / delete guard shared by the three delivery challan types.
 *
 * - An approved (COMPLETE) DC has already moved stock; editing its lines or
 *   deleting it would leave stock out of step with the documents. Corrections
 *   go through a return or a stock adjustment instead.
 * - A Customer DC with a live Final Invoice or Return By Customer is locked
 *   until those are rejected or deleted.
 */

import { EntityManager } from 'typeorm';
import { DocumentStatus, DocumentTypeEnum } from '../../../approvalFlow/entity/docuemnt.entity';
import AppError from '../../../utils/appError';

const DC_LABEL: Partial<Record<DocumentTypeEnum, string>> = {
  [DocumentTypeEnum.DC_TYPE_CUSTOMER]: 'Customer DC',
  [DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER]: 'Stock transfer DC',
  [DocumentTypeEnum.DC_TYPE_OTHER]: 'Other DC',
};

/** Why `dcId` may not be edited / deleted, or null when it may. */
export async function dcChangeBlockedReason(
  manager: EntityManager,
  dcType: DocumentTypeEnum,
  dcId: string,
  action: 'edit' | 'delete',
): Promise<string | null> {
  const rows: Array<{ no: string | null; status: string | null; invoiced: boolean | null; returned: boolean | null }> = await manager.query(
    `SELECT dc."challanNo" AS no,
            dc."isInvoiceCreated" AS invoiced,
            dc."isReturnByCustomerCreated" AS returned,
            (SELECT d.status::text FROM documents d
              WHERE d.document_type_id = dc.id::text AND d.type::text = $2
              ORDER BY d."createdAt" DESC LIMIT 1) AS status
       FROM delivery_challan_purchase dc
      WHERE dc.id = $1`,
    [dcId, dcType],
  );
  const row = rows[0];
  if (!row) return null;
  const label = `${DC_LABEL[dcType] ?? 'Delivery challan'}${row.no ? ` ${row.no}` : ''}`;
  const verb = action === 'edit' ? 'edited' : 'deleted';
  if (row.status === DocumentStatus.COMPLETE) {
    return `${label} is approved and its stock has already moved, so it cannot be ${verb}. Record a return or a stock adjustment instead.`;
  }
  if (dcType === DocumentTypeEnum.DC_TYPE_CUSTOMER && (row.invoiced || row.returned)) {
    const what = [row.invoiced ? 'a Final Invoice' : null, row.returned ? 'a Return By Customer' : null].filter(Boolean).join(' and ');
    return `${label} has ${what} against it, so it cannot be ${verb}. Reject or delete ${row.invoiced && row.returned ? 'them' : 'it'} first.`;
  }
  return null;
}

/** Throws 409 with the reason when `dcId` may not be edited / deleted. */
export async function assertDcChangeable(
  manager: EntityManager,
  dcType: DocumentTypeEnum,
  dcId: string,
  action: 'edit' | 'delete',
): Promise<void> {
  const reason = await dcChangeBlockedReason(manager, dcType, dcId, action);
  if (reason) throw new AppError(409, reason);
}
