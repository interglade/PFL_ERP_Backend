import { formatUserNames, NamedUser } from './userNames';

/** A newly created document plus the names of the users it was sent to for approval. */
export interface CreatedWithApproval<T> {
  record: T;
  /** e.g. "Ravi Patil and Neha Joshi"; empty when nobody was assigned. */
  sentTo: string;
}

/** Pairs a created record with whoever startApprovalFlow assigned it to. */
export const withApproval = <T>(
  record: T,
  assignment: { users?: NamedUser[] | null } | null | undefined,
): CreatedWithApproval<T> => ({ record, sentTo: formatUserNames(assignment?.users) });

/**
 * "GRN with GRNNo=GRN-0042 is created successfully and sent to Ravi Patil for approval."
 * Without anyone assigned: "GRN with GRNNo=GRN-0042 is created successfully."
 */
export const createdMessage = (
  docName: string,
  noLabel: string,
  docNo: string | null | undefined,
  sentTo: string,
): string => {
  const base = `${docName} with ${noLabel}=${docNo ?? ''} is created successfully`;
  return sentTo ? `${base} and sent to ${sentTo} for approval.` : `${base}.`;
};
