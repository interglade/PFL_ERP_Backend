/**
 * Columns and joins shared by the four voucher types. Every voucher table
 * (`multiple_cash_voucher`, `labour_payment_voucher`, `transport_payment_voucher`,
 * `packing_material_payment`) carries the same approval/party/audit block.
 */

import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { ExportColumn } from '../../excel/export/exportTypes';
import { BRANCH_COLUMNS, COMPANY_COLUMNS, USER_COLUMNS, joinSelect } from '../../excel/export/exportQuery';
import { DocumentRow } from '../../excel/export/documentMeta';
import { auditColumns, branchColumn, companyColumns, userColumns } from '../../excel/export/commonColumns';

/** Voucher types, as `ExportRef.kind` in the combined export. */
export const VOUCHER_KINDS = {
  MULTI_CASH: 'multi-cash-voucher',
  LABOUR_PAYMENT: 'labour-payment-voucher',
  TRANSPORT_PAYMENT: 'transport-payment-voucher',
  PACKING_MATERIAL: 'packing-material-voucher',
} as const;

export const VOUCHER_TYPE_LABELS: Record<string, string> = {
  [VOUCHER_KINDS.MULTI_CASH]: 'Multi Cash Voucher',
  [VOUCHER_KINDS.LABOUR_PAYMENT]: 'Labour Payment Voucher',
  [VOUCHER_KINDS.TRANSPORT_PAYMENT]: 'Transport Payment Voucher',
  [VOUCHER_KINDS.PACKING_MATERIAL]: 'Packing Material Voucher',
};

/** The block every voucher entity shares. */
export interface VoucherBase {
  id: string;
  voucherNo: string;
  requestingDepartment?: string;
  debitCreditTo?: string;
  payReceivedFrom?: string;
  paymentMode?: string;
  amtWords?: string;
  receiverName?: string;
  anyAttachment?: string[] | null;
  approvalStatus?: string;
  remark?: string;
  companyName?: any;
  location?: any;
  grnNo?: any;
  requestedBy?: any;
  passBy?: any;
  approveBy?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

export function joinVoucherCommon<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias: string): SelectQueryBuilder<T> {
  joinSelect(qb, `${alias}.companyName`, 'company', COMPANY_COLUMNS);
  joinSelect(qb, `${alias}.location`, 'location', BRANCH_COLUMNS);
  joinSelect(qb, `${alias}.grnNo`, 'grn', ['id', 'grnNo']);
  joinSelect(qb, `${alias}.requestedBy`, 'requestedBy', USER_COLUMNS);
  joinSelect(qb, `${alias}.passBy`, 'passBy', USER_COLUMNS);
  joinSelect(qb, `${alias}.approveBy`, 'approveBy', USER_COLUMNS);
  return qb;
}

/** Identity columns placed first on each voucher header sheet. */
export function voucherIdentityColumns<T extends VoucherBase>(table: string): ExportColumn<DocumentRow<T>>[] {
  return [
    { header: 'Voucher No', maps: `${table}.voucherNo`, get: (r) => r.record.voucherNo },
    { header: 'Voucher Record ID', maps: `${table}.id`, get: (r) => r.record.id },
    { header: 'Requesting Department', maps: `${table}.requestingDepartment`, get: (r) => r.record.requestingDepartment },
    ...companyColumns<DocumentRow<T>>((r) => r.record.companyName),
    branchColumn<DocumentRow<T>>('Location', (r) => r.record.location, `${table}.location`),
    { header: 'GRN No', maps: `${table}.grnNo -> grns.grnNo`, get: (r) => r.record.grnNo?.grnNo },
    { header: 'Debit / Credit To', maps: `${table}.debitCreditTo`, get: (r) => r.record.debitCreditTo },
    { header: 'Pay / Received From', maps: `${table}.payReceivedFrom`, get: (r) => r.record.payReceivedFrom },
  ];
}

/** Payment, approval and audit columns placed after the type-specific ones. */
export function voucherTrailingColumns<T extends VoucherBase>(table: string): ExportColumn<DocumentRow<T>>[] {
  type Row = DocumentRow<T>;
  return [
    { header: 'Payment Mode', maps: `${table}.paymentMode`, get: (r) => r.record.paymentMode },
    { header: 'Amount In Words', maps: `${table}.amtWords`, get: (r) => r.record.amtWords },
    { header: 'Receiver Name', maps: `${table}.receiverName`, get: (r) => r.record.receiverName },
    { header: 'Voucher Approval Status', maps: `${table}.approvalStatus`, get: (r) => r.record.approvalStatus },
    ...userColumns<Row>('Requested By', (r) => r.record.requestedBy, `${table}.requestedBy`),
    ...userColumns<Row>('Passed By', (r) => r.record.passBy, `${table}.passBy`),
    ...userColumns<Row>('Approved By (Voucher)', (r) => r.record.approveBy, `${table}.approveBy`),
    { header: 'Attachments', maps: `${table}.anyAttachment`, get: (r) => r.record.anyAttachment },
    { header: 'Remark', maps: `${table}.remark`, get: (r) => r.record.remark },
    ...auditColumns<Row>((r) => r.record, table),
  ];
}
