/**
 * D-6: one live voucher of each type per GRN.
 *
 * All four voucher forms filtered their GRN picker on a "voucher already
 * created" flag (`grns.is*VoucherCreated`), i.e. the intent is one voucher of
 * each type per GRN. Those flags were never written, so the rule is derived
 * instead: a GRN "has" a voucher of a type when a live (not deleted),
 * non-rejected voucher of that type references it through `grn_id`. The flag
 * columns are left untouched and no longer read.
 */

import { EntityManager } from 'typeorm';
import { DocumentTypeEnum } from '../approvalFlow/entity/docuemnt.entity';
import AppError from '../utils/appError';
import { isUuid, liveRowSql, notRejectedSql, relationIdOf } from '../grn/grnLinks.sql';

export type VoucherKind = 'mc' | 'tp' | 'pmp' | 'lp';

export const VOUCHER_GRN_LINK: Record<VoucherKind, { table: string; documentType: DocumentTypeEnum; label: string }> = {
  mc: { table: 'multiple_cash_voucher', documentType: DocumentTypeEnum.MULTI_CASH_VOUCHER, label: 'Multi-Cash Voucher' },
  tp: { table: 'transport_payment_voucher', documentType: DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER, label: 'Transport Payment Voucher' },
  pmp: { table: 'packing_material_payment', documentType: DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER, label: 'Packing Material Payment Voucher' },
  lp: { table: 'labour_payment_voucher', documentType: DocumentTypeEnum.LABOR_PAYMENT_VOUCHER, label: 'Labour Payment Voucher' },
};

export const VOUCHER_KINDS = Object.keys(VOUCHER_GRN_LINK) as VoucherKind[];

export function isVoucherKind(value: unknown): value is VoucherKind {
  return typeof value === 'string' && (VOUCHER_KINDS as string[]).includes(value);
}

/** Legacy picker flag (`isMCVoucherCreated=false` ...) -> voucher kind, so older clients get the derived rule too. */
const LEGACY_FLAG: Record<VoucherKind, string> = {
  mc: 'isMCVoucherCreated',
  tp: 'isTPVoucherCreated',
  pmp: 'isPMPVoucherCreated',
  lp: 'isLPVoucherCreated',
};

/** The single voucher kind whose legacy "created" flag is requested as false, if exactly one is. */
export function voucherKindFromLegacyFlags(filter: Record<string, unknown>): VoucherKind | undefined {
  const kinds = VOUCHER_KINDS.filter((kind) => filter[LEGACY_FLAG[kind]] === false || filter[LEGACY_FLAG[kind]] === 'false');
  return kinds.length === 1 ? kinds[0] : undefined;
}

/**
 * `EXISTS (...)`: a live, non-rejected voucher of `kind` references the GRN.
 * `excludeVoucherIdExpr` (e.g. `$2::uuid`) leaves one voucher out (the one being edited).
 */
export function liveVoucherForGrnExistsSql(grnIdExpr: string, kind: VoucherKind, excludeVoucherIdExpr?: string): string {
  const spec = VOUCHER_GRN_LINK[kind];
  const alias = `vg_${kind}`;
  const exclude = excludeVoucherIdExpr ? ` AND ${alias}.id <> ${excludeVoucherIdExpr}` : '';
  return (
    `EXISTS (SELECT 1 FROM ${spec.table} ${alias} WHERE ${alias}.grn_id = (${grnIdExpr}) AND ${liveRowSql(alias)}${exclude} ` +
    `AND ${notRejectedSql(`${alias}.id`, spec.documentType, `${alias}_d`)})`
  );
}

export function duplicateVoucherMessage(kind: VoucherKind, grnNo: string | null, voucherNo: string | null): string {
  const label = VOUCHER_GRN_LINK[kind].label;
  const grn = grnNo ? `GRN ${grnNo}` : 'This GRN';
  const existing = voucherNo ? ` (${voucherNo})` : '';
  return `${grn} already has a ${label}${existing}. Only one ${label} is allowed per GRN; reject or delete the existing one first.`;
}

/**
 * Throws 409 when another live, non-rejected voucher of `kind` already references the GRN.
 * Serialises on an advisory lock held until the caller's transaction ends, so call it
 * inside the transaction that saves the voucher.
 */
export async function assertGrnFreeForVoucher(
  manager: EntityManager,
  kind: VoucherKind,
  grnId: string,
  excludeVoucherId?: string | null,
): Promise<void> {
  if (!isUuid(grnId)) throw new AppError(400, 'Invalid GRN id');
  const spec = VOUCHER_GRN_LINK[kind];
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [`grn-voucher-${kind}`, grnId]);
  const rows: Array<{ voucher_no: string | null; grn_no: string | null }> = await manager.query(
    `SELECT v."voucherNo" AS voucher_no, g."grnNo" AS grn_no
       FROM ${spec.table} v JOIN grns g ON g.id = v.grn_id
      WHERE v.grn_id = $1::uuid AND ${liveRowSql('v')}
        AND ($2::uuid IS NULL OR v.id <> $2::uuid)
        AND ${notRejectedSql('v.id', spec.documentType, 'v_d')}
      ORDER BY v."createdAt" ASC LIMIT 1`,
    [grnId, isUuid(excludeVoucherId) ? excludeVoucherId : null],
  );
  if (rows.length) throw new AppError(409, duplicateVoucherMessage(kind, rows[0].grn_no, rows[0].voucher_no));
}

/**
 * Resolves the GRN a voucher update points at. The edit forms send the GRN id;
 * older callers sent the GRN number, so both are accepted. Null when blank or unknown.
 */
export async function resolveVoucherGrn<T extends { id: string }>(
  repository: { findOne(options: any): Promise<T | null> },
  value: unknown,
): Promise<T | null> {
  const ref = relationIdOf(value);
  if (!ref) return null;
  return repository.findOne({ where: isUuid(ref) ? { id: ref } : { grnNo: ref } });
}
