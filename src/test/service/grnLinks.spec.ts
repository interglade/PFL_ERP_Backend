import { isUuid, latestDocumentStatusSql, notRejectedSql, relationIdOf } from '../../grn/grnLinks.sql';
import {
  assertDealSlipUsableForGrn,
  dealSlipAvailableSql,
  dealSlipGrnBlockReason,
  liveGrnForDealSlipExistsSql,
  syncDealSlipGrnFlags,
} from '../../dealSlip/dealSlipGrnLink';
import {
  assertGrnFreeForVoucher,
  duplicateVoucherMessage,
  isVoucherKind,
  liveVoucherForGrnExistsSql,
  resolveVoucherGrn,
  voucherKindFromLegacyFlags,
} from '../../vouchers/voucherGrnLink';

const SLIP = '11111111-1111-4111-8111-111111111111';
const GRN = '22222222-2222-4222-8222-222222222222';

/** EntityManager stand-in: answers lock calls with [] and every other query from `results` in order. */
function fakeManager(results: unknown[][]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const queue = [...results];
  return {
    calls,
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return [];
      return queue.shift() ?? [];
    }),
  };
}

describe('grnLinks.sql helpers', () => {
  it('recognises uuids', () => {
    expect(isUuid(SLIP)).toBe(true);
    expect(isUuid('DL2026101500001')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it('reads a relation id from a string or { id }', () => {
    expect(relationIdOf(` ${SLIP} `)).toBe(SLIP);
    expect(relationIdOf({ id: GRN })).toBe(GRN);
    expect(relationIdOf('')).toBeNull();
    expect(relationIdOf(null)).toBeNull();
    expect(relationIdOf(42)).toBeNull();
  });

  it('takes the newest non-deleted document and treats "no document" as not rejected', () => {
    const latest = latestDocumentStatusSql('g.id', 'grn', 'x');
    expect(latest).toContain(`x.type::text = 'grn'`);
    expect(latest).toContain('x."deletedAt" IS NULL');
    expect(latest).toContain('ORDER BY x."createdAt" DESC LIMIT 1');
    expect(notRejectedSql('g.id', 'grn')).toMatch(/^COALESCE\(.*, ''\) <> 'REJECT'$/);
  });
});

describe('deal slip -> GRN rule', () => {
  it('counts only live, non-rejected GRNs and can leave the edited GRN out', () => {
    const sql = liveGrnForDealSlipExistsSql('ds.id', '$2::uuid');
    expect(sql).toContain('dsg.deal_slip_id = (ds.id)');
    expect(sql).toContain('dsg."isDeleted" = false AND dsg."deletedAt" IS NULL');
    expect(sql).toContain('dsg.id <> $2::uuid');
    expect(sql).toContain(`<> 'REJECT'`);
    expect(liveGrnForDealSlipExistsSql('ds.id')).not.toContain('<> $2');
  });

  it('available = approved (COMPLETE) and unused', () => {
    const sql = dealSlipAvailableSql('ds');
    expect(sql).toContain(`= 'COMPLETE'`);
    expect(sql).toContain(`type::text = 'deal-slip'`);
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM grns dsg');
  });

  it.each([
    [undefined, 404, /not found/],
    [{ deal_slip_no: 'DL1', live: false, status: 'COMPLETE', used_by_grn_no: null }, 400, /deleted/],
    [{ deal_slip_no: 'DL1', live: true, status: 'hold', used_by_grn_no: null }, 400, /not approved yet/],
    [{ deal_slip_no: 'DL1', live: true, status: 'REJECT', used_by_grn_no: null }, 400, /rejected/],
    [{ deal_slip_no: 'DL1', live: true, status: null, used_by_grn_no: null }, 400, /not approved yet/],
    [{ deal_slip_no: 'DL1', live: true, status: 'COMPLETE', used_by_grn_no: 'PFL-00007' }, 409, /already used by GRN PFL-00007/],
  ])('blocks %#', (row, status, message) => {
    const block = dealSlipGrnBlockReason(row as any);
    expect(block?.status).toBe(status);
    expect(block?.message).toMatch(message);
  });

  it('lets an approved, unused deal slip through', () => {
    expect(dealSlipGrnBlockReason({ deal_slip_no: 'DL1', live: true, status: 'COMPLETE', used_by_grn_no: null })).toBeNull();
  });

  it('locks, then checks the slip excluding the edited GRN', async () => {
    const manager = fakeManager([[{ deal_slip_no: 'DL1', live: true, status: 'COMPLETE', used_by_grn_no: null }]]);
    await expect(assertDealSlipUsableForGrn(manager as any, SLIP, GRN)).resolves.toBeUndefined();
    expect(manager.calls[0].sql).toContain('pg_advisory_xact_lock');
    expect(manager.calls[1].params).toEqual([SLIP, GRN]);
  });

  it('rejects a used deal slip with 409 and a bad id with 400 (no query)', async () => {
    const manager = fakeManager([[{ deal_slip_no: 'DL1', live: true, status: 'COMPLETE', used_by_grn_no: 'G1' }]]);
    await expect(assertDealSlipUsableForGrn(manager as any, SLIP)).rejects.toMatchObject({ statusCode: 409 });
    const untouched = fakeManager([]);
    await expect(assertDealSlipUsableForGrn(untouched as any, 'nope')).rejects.toMatchObject({ statusCode: 400 });
    expect(untouched.query).not.toHaveBeenCalled();
  });

  it('syncs the legacy flag only for real ids', async () => {
    const manager = fakeManager([]);
    await syncDealSlipGrnFlags(manager as any, [null, undefined, '']);
    expect(manager.query).not.toHaveBeenCalled();
    await syncDealSlipGrnFlags(manager as any, [SLIP, SLIP, null]);
    expect(manager.calls[0].sql).toContain('UPDATE deal_slips ds SET "isGrnCreated" = EXISTS');
    expect(manager.calls[0].params).toEqual([[SLIP]]);
  });
});

describe('GRN -> voucher rule', () => {
  it('knows the four voucher kinds', () => {
    expect(['mc', 'tp', 'pmp', 'lp'].every(isVoucherKind)).toBe(true);
    expect(isVoucherKind('aqr')).toBe(false);
  });

  it('maps exactly one legacy "created=false" flag to its kind', () => {
    expect(voucherKindFromLegacyFlags({ isPMPVoucherCreated: false, overAllStatus: 'COMPLETE' })).toBe('pmp');
    expect(voucherKindFromLegacyFlags({ isMCVoucherCreated: 'false' })).toBe('mc');
    expect(voucherKindFromLegacyFlags({ isMCVoucherCreated: true })).toBeUndefined();
    expect(voucherKindFromLegacyFlags({ isMCVoucherCreated: false, isTPVoucherCreated: false })).toBeUndefined();
    expect(voucherKindFromLegacyFlags({ isAQRCreated: false })).toBeUndefined();
  });

  it.each([
    ['mc', 'multiple_cash_voucher', 'multi-cash-voucher'],
    ['tp', 'transport_payment_voucher', 'transport-payment-voucher'],
    ['pmp', 'packing_material_payment', 'packaging-material-voucher'],
    ['lp', 'labour_payment_voucher', 'labor-payment-voucher'],
  ] as const)('%s checks its own table and document type', (kind, table, docType) => {
    const sql = liveVoucherForGrnExistsSql('grn.id', kind);
    expect(sql).toContain(`FROM ${table} vg_${kind}`);
    expect(sql).toContain(`vg_${kind}.grn_id = (grn.id)`);
    expect(sql).toContain(`type::text = '${docType}'`);
    expect(sql).toContain(`<> 'REJECT'`);
  });

  it('builds a clear duplicate message', () => {
    expect(duplicateVoucherMessage('tp', 'PFL-00001', 'TV-20261015-00002')).toBe(
      'GRN PFL-00001 already has a Transport Payment Voucher (TV-20261015-00002). Only one Transport Payment Voucher is allowed per GRN; reject or delete the existing one first.',
    );
  });

  it('refuses a second live voucher with 409', async () => {
    const manager = fakeManager([[{ voucher_no: 'CV-1', grn_no: 'PFL-1' }]]);
    await expect(assertGrnFreeForVoucher(manager as any, 'mc', GRN)).rejects.toMatchObject({ statusCode: 409 });
    expect(manager.calls[1].sql).toContain('FROM multiple_cash_voucher v');
    expect(manager.calls[1].params).toEqual([GRN, null]);
  });

  it('passes when no other voucher exists, excluding the edited one', async () => {
    const manager = fakeManager([[]]);
    await expect(assertGrnFreeForVoucher(manager as any, 'lp', GRN, SLIP)).resolves.toBeUndefined();
    expect(manager.calls[1].params).toEqual([GRN, SLIP]);
  });

  it('resolves the GRN of an update by id or by number', async () => {
    const repo = { findOne: jest.fn(async (opts: any) => ({ id: GRN, ...opts.where })) };
    await resolveVoucherGrn(repo, GRN);
    expect(repo.findOne).toHaveBeenLastCalledWith({ where: { id: GRN } });
    await resolveVoucherGrn(repo, 'PFL-00001');
    expect(repo.findOne).toHaveBeenLastCalledWith({ where: { grnNo: 'PFL-00001' } });
    expect(await resolveVoucherGrn(repo, '')).toBeNull();
    expect(repo.findOne).toHaveBeenCalledTimes(2);
  });
});
