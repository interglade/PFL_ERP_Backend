/**
 * Who approved a Deal Slip. It is a single-approval document, so the approver is the first-approved
 * stage of its approval record. Only an `approved` stage counts: on a rejected slip the stage holds
 * the person who rejected it.
 */
export interface ApprovalStageLike {
  userId?: string | null;
  status?: string | null;
}

export function dealSlipApproverId(
  document: { approvalInfo?: { firstApproved?: ApprovalStageLike | null } | null } | null | undefined,
): string | null {
  const stage = document?.approvalInfo?.firstApproved;
  return stage?.status === 'approved' && stage.userId ? stage.userId : null;
}
