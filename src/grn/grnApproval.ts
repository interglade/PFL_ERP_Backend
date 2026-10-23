/**
 * When a GRN's goods may move on (client decision 2026-10-15, replacing the
 * earlier "approved, finalisation pending" rule of the same day): only once the
 * GRN's whole approval process is complete (overall status COMPLETE), the
 * purchase dispatch can be approved and the goods received at the CC/DC.
 *
 * GRN lifecycle:
 *   - editable only while the approval is not complete;
 *   - receiving only after COMPLETE;
 *   - payment status starts UNPAID and can change only after COMPLETE and
 *     once the goods are received (an approved Inward Register exists).
 */

import { DocumentStatus } from '../approvalFlow/entity/docuemnt.entity';

export const RECEIVABLE_GRN_STATUSES: string[] = [DocumentStatus.COMPLETE];

export function isGrnReceivableStatus(status: string | null | undefined): boolean {
  return !!status && RECEIVABLE_GRN_STATUSES.includes(status);
}
