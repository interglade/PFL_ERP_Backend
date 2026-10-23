/**
 * D-6: Deal Slip -> GRN chain.
 *
 * Rule: a GRN may reference a deal slip only when the slip is live (not
 * deleted), its latest `documents` row is COMPLETE (approved; the single
 * approver engine sets COMPLETE on approval) and no other live, non-rejected
 * GRN references it. One GRN per deal slip: the RFPA -> Deal Slip step is
 * one-to-one as well (`rfpa.isDealSlipCreated`), and nothing in the code or
 * docs/context.md describes split GRNs against one slip.
 *
 * `deal_slips.isGrnCreated` is kept only as a denormalised copy for readers
 * outside this module (document filter definitions); it is recomputed from the
 * derived rule whenever a GRN is created, re-pointed or bulk-deleted
 * ({@link syncDealSlipGrnFlags}). Code here never reads it.
 */

import { EntityManager } from 'typeorm';
import { DocumentStatus, DocumentTypeEnum } from '../approvalFlow/entity/docuemnt.entity';
import AppError from '../utils/appError';
import { isUuid, latestDocumentStatusSql, liveRowSql, notRejectedSql, sqlLiteral } from '../grn/grnLinks.sql';

/**
 * `EXISTS (...)`: a live, non-rejected GRN references the deal slip.
 * `excludeGrnIdExpr` (e.g. `$2::uuid`) leaves one GRN out (the one being edited).
 */
export function liveGrnForDealSlipExistsSql(dealSlipIdExpr: string, excludeGrnIdExpr?: string): string {
  const exclude = excludeGrnIdExpr ? ` AND dsg.id <> ${excludeGrnIdExpr}` : '';
  return (
    `EXISTS (SELECT 1 FROM grns dsg WHERE dsg.deal_slip_id = (${dealSlipIdExpr}) AND ${liveRowSql('dsg')}${exclude} ` +
    `AND ${notRejectedSql('dsg.id', DocumentTypeEnum.GRN, 'dsg_d')})`
  );
}

/** The deal slip (alias `ds` by default) is live and its latest document is COMPLETE. */
export function dealSlipApprovedSql(alias = 'ds'): string {
  return (
    `${liveRowSql(alias)} AND ` +
    `${latestDocumentStatusSql(`${alias}.id`, DocumentTypeEnum.DEAL_SLIP, `${alias}_d`)} = ${sqlLiteral(DocumentStatus.COMPLETE)}`
  );
}

/** Deal slip usable by a new GRN: approved and not used by a live, non-rejected GRN. */
export function dealSlipAvailableSql(alias = 'ds'): string {
  return `${dealSlipApprovedSql(alias)} AND NOT ${liveGrnForDealSlipExistsSql(`${alias}.id`)}`;
}

export interface DealSlipGrnCheckRow {
  deal_slip_no: string | null;
  live: boolean;
  status: string | null;
  used_by_grn_no: string | null;
}

/** Why a deal slip cannot back a GRN, or null when it can. Pure; `row` undefined = no such slip. */
export function dealSlipGrnBlockReason(row: DealSlipGrnCheckRow | undefined): { status: number; message: string } | null {
  if (!row) return { status: 404, message: 'Deal slip not found' };
  const label = row.deal_slip_no ? `Deal slip ${row.deal_slip_no}` : 'The deal slip';
  if (!row.live) return { status: 400, message: `${label} has been deleted` };
  if (row.status !== DocumentStatus.COMPLETE) {
    const state = row.status === DocumentStatus.REJECT || row.status === DocumentStatus.DISAPPROVED ? 'rejected' : 'not approved yet';
    return { status: 400, message: `${label} is ${state}; a GRN can only be raised against an approved deal slip` };
  }
  if (row.used_by_grn_no !== null && row.used_by_grn_no !== undefined) {
    return { status: 409, message: `${label} is already used by GRN ${row.used_by_grn_no}`.trim() };
  }
  return null;
}

/**
 * Throws unless `dealSlipId` may back the GRN `excludeGrnId` (or a new GRN).
 * Serialises GRNs of the same slip on an advisory lock held until the caller's
 * transaction ends, so call it inside the transaction that saves the GRN.
 */
export async function assertDealSlipUsableForGrn(
  manager: EntityManager,
  dealSlipId: string,
  excludeGrnId?: string | null,
): Promise<void> {
  if (!isUuid(dealSlipId)) throw new AppError(400, 'Invalid deal slip id');
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext('grn-deal-slip'), hashtext($1))`, [dealSlipId]);
  const rows: DealSlipGrnCheckRow[] = await manager.query(
    `SELECT ds."dealSlipNo" AS deal_slip_no,
            (${liveRowSql('ds')}) AS live,
            ${latestDocumentStatusSql('ds.id', DocumentTypeEnum.DEAL_SLIP, 'ds_d')} AS status,
            (SELECT COALESCE(g."grnNo", '') FROM grns g
              WHERE g.deal_slip_id = ds.id AND ${liveRowSql('g')}
                AND ($2::uuid IS NULL OR g.id <> $2::uuid)
                AND ${notRejectedSql('g.id', DocumentTypeEnum.GRN, 'g_d')}
              ORDER BY g."createdAt" ASC LIMIT 1) AS used_by_grn_no
       FROM deal_slips ds WHERE ds.id = $1::uuid`,
    [dealSlipId, isUuid(excludeGrnId) ? excludeGrnId : null],
  );
  const block = dealSlipGrnBlockReason(rows[0]);
  if (block) throw new AppError(block.status, block.message);
}

/** Recomputes `deal_slips.isGrnCreated` for the given slips from the derived rule. */
export async function syncDealSlipGrnFlags(manager: EntityManager, dealSlipIds: Array<string | null | undefined>): Promise<void> {
  const ids = Array.from(new Set(dealSlipIds.filter(isUuid)));
  if (!ids.length) return;
  await manager.query(
    `UPDATE deal_slips ds SET "isGrnCreated" = ${liveGrnForDealSlipExistsSql('ds.id')} WHERE ds.id = ANY($1::uuid[])`,
    [ids],
  );
}

/** Same as {@link syncDealSlipGrnFlags} for the slips referenced by these GRNs. */
export async function syncDealSlipGrnFlagsForGrns(manager: EntityManager, grnIds: string[]): Promise<void> {
  const ids = Array.from(new Set(grnIds.filter(isUuid)));
  if (!ids.length) return;
  await manager.query(
    `UPDATE deal_slips ds SET "isGrnCreated" = ${liveGrnForDealSlipExistsSql('ds.id')}
      WHERE ds.id IN (SELECT g.deal_slip_id FROM grns g WHERE g.id = ANY($1::uuid[]) AND g.deal_slip_id IS NOT NULL)`,
    [ids],
  );
}
