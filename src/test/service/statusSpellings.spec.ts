/**
 * Statuses are Title Case and are only ever matched exactly (docs/status-title-case.md):
 * an old spelling or another case is refused, never mapped.
 */
import 'reflect-metadata';
import AppError from '../../utils/appError';
import { DocumentStatus } from '../../approvalFlow/entity/docuemnt.entity';
import { ApproverStatus, parseApproverDecision } from '../../approvalFlow/entity/approvalname.entity';
import { EmployeeStatus } from '../../employee/entity/user.entity';
import { parseStatus, requireStatus, Status, TARGET_DECISIONS } from '../../utils/status.enum';
import { parseDocumentFilters } from '../../global/filters/documentFilter.parser';

describe('status spellings', () => {
  it('accepts a status only as written', () => {
    expect(parseStatus(DocumentStatus, 'Complete')).toBe(DocumentStatus.COMPLETE);
    expect(['complete', 'COMPLETE', 'hold', 'REJECT', 'reject', ' Complete'].map((v) => parseStatus(DocumentStatus, v))).toEqual(
      [undefined, undefined, undefined, undefined, undefined, undefined],
    );
    expect(parseStatus(Status, 'notapproved')).toBeUndefined();
    expect(parseStatus(EmployeeStatus, 'ACTIVE')).toBeUndefined();
    expect(parseStatus(TARGET_DECISIONS, 'approved')).toBeUndefined();
  });

  it('refuses an unknown status with a 400 that lists the allowed values', () => {
    expect(requireStatus(Status, 'Rejected', 'status')).toBe(Status.REJECTED);
    expect(() => requireStatus(Status, 'notapproved', 'status')).toThrow(AppError);
    expect(() => requireStatus(Status, 'notapproved', 'status')).toThrow(/Allowed values: Draft, Pending, Approved, Rejected/);
  });

  it('takes only Approved or Rejected as an approver decision', () => {
    expect(parseApproverDecision('Approved')).toBe(ApproverStatus.APPROVED);
    expect(parseApproverDecision('Rejected')).toBe(ApproverStatus.REJECTED);
    expect(['approved', 'reject', 'Hold', 'query'].map(parseApproverDecision)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('matches document status filters exactly', () => {
    expect(parseDocumentFilters({ status: 'Rejected,Hold' }, 'grn').criteria.status).toEqual(['Rejected', 'Hold']);
    expect(() => parseDocumentFilters({ status: 'reject' }, 'grn')).toThrow(/Invalid status 'reject'/);
    expect(() => parseDocumentFilters({ status: 'complete' }, 'grn')).toThrow(/Invalid status 'complete'/);
  });
});
