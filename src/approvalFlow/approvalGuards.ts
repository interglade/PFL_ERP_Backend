import AppError from '../utils/appError';
import { DocumentStatus, DocumentTypeEnum } from './entity/docuemnt.entity';

/**
 * Which document types each approval endpoint serves. A document sent to the wrong endpoint
 * could skip stages (e.g. a GRN through the two-level endpoint skips verifier and finalizers).
 */
export const APPROVAL_ENGINE_TYPES = {
  /** PATCH /documents/update — verifier, approvers by amount, finalizers */
  multi: [
    DocumentTypeEnum.GRN,
    DocumentTypeEnum.MULTI_CASH_VOUCHER,
    DocumentTypeEnum.LABOR_PAYMENT_VOUCHER,
    DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER,
    DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER,
  ],
  /** PATCH /documents/updatesecondlevel — first and second approver */
  double: [
    DocumentTypeEnum.DC_TYPE_CUSTOMER,
    DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER,
    DocumentTypeEnum.DC_TYPE_OTHER,
    DocumentTypeEnum.DUMP_REGISTER,
    DocumentTypeEnum.FINAL_INVOICE,
    DocumentTypeEnum.RETURN_TO_VENDOR,
    DocumentTypeEnum.RETURN_BY_CUSTOMER,
    DocumentTypeEnum.SECOND_SALE,
    DocumentTypeEnum.EOD_REPORT,
    DocumentTypeEnum.STOCK_ADJUSTMENT,
    DocumentTypeEnum.STOCK_REPACK,
  ],
  /** PATCH /documents/updatefirstlevel — first approver only */
  single: [
    DocumentTypeEnum.RFPA,
    DocumentTypeEnum.DEAL_SLIP,
    DocumentTypeEnum.AQR,
    DocumentTypeEnum.INWARD_REGISTER,
    DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER,
  ],
};

export function assertEngineAccepts(engine: keyof typeof APPROVAL_ENGINE_TYPES, type: DocumentTypeEnum): void {
  if (!APPROVAL_ENGINE_TYPES[engine].includes(type)) {
    throw new AppError(400, 'This document cannot be approved through this action');
  }
}

/** The creator (lastActionBy is set to the creator when the document is created) never acts on it. */
export function assertNotCreator(document: { lastActionBy?: { id?: string } | null }, userId: string): void {
  if (document.lastActionBy?.id && document.lastActionBy.id === userId) {
    throw new AppError(403, 'You cannot approve or reject a document you created');
  }
}

export function assertNotClosed(document: { status: DocumentStatus }): void {
  if (document.status === DocumentStatus.COMPLETE) {
    throw new AppError(400, 'Document is already fully approved');
  }
  if (document.status === DocumentStatus.REJECT) {
    throw new AppError(400, 'Document is already rejected');
  }
}

/** One person acts at one step of a document only (verifier, approver levels, finalizers). */
export function assertNotActedBefore(
  approvalInfo: Record<string, any> | null | undefined,
  userId: string,
  stages: string[],
): void {
  if (!approvalInfo) return;
  for (const stage of stages) {
    if (approvalInfo[stage]?.userId === userId) {
      throw new AppError(403, 'You have already acted on this document at another step');
    }
  }
}
