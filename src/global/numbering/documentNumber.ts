/**
 * Collision-free document numbers.
 *
 * Every series keeps its last serial in `document_sequences`, advanced with one
 * atomic UPDATE … RETURNING (or an INSERT … ON CONFLICT for the first number
 * of a series). Two creates can no longer read the same COUNT / MAX and get the
 * same number, and a deleted document never frees its number. The first time a
 * series is used, it is seeded from the highest serial already stored in the
 * business table (deleted rows included), so numbering continues where it was.
 *
 * Called with the caller's transaction manager the increment commits or rolls
 * back with the document (no gaps; concurrent creates of the same series wait
 * for each other). Called outside a transaction it commits at once.
 */

import { EntityManager } from 'typeorm';
import { returnedRows } from '../../utils/queryRows';

/** Business tables / number columns that may be seeded from (never user input). */
export type NumberSeries =
  | { table: 'rfpa'; column: 'rfpaId' }
  | { table: 'deal_slips'; column: 'dealSlipNo' }
  | { table: 'aqr'; column: 'aqrNo' }
  | { table: 'inward_register'; column: 'inwardNo' }
  | { table: 'dump_register'; column: 'dumpNo' }
  | { table: 'return_to_vendor'; column: 'rtvNo' }
  | { table: 'return_by_customer'; column: 'rbcNo' }
  | { table: 'second_sale_document'; column: 'secondSaleNo' }
  | { table: 'delivery_challan_purchase'; column: 'challanNo' }
  | { table: 'invoices'; column: 'invoiceNo' }
  | { table: 'stock_report'; column: 'eodNo' }
  | { table: 'labour_payment_voucher'; column: 'voucherNo' }
  | { table: 'multiple_cash_voucher'; column: 'voucherNo' }
  | { table: 'packing_material_payment'; column: 'voucherNo' }
  | { table: 'transport_payment_voucher'; column: 'voucherNo' }
  | { table: 'stock_adjustment'; column: 'adjustment_no' }
  | { table: 'stock_repack'; column: 'repack_no' };

export const SERIES = {
  rfpa: { table: 'rfpa', column: 'rfpaId' },
  dealSlip: { table: 'deal_slips', column: 'dealSlipNo' },
  aqr: { table: 'aqr', column: 'aqrNo' },
  inward: { table: 'inward_register', column: 'inwardNo' },
  dump: { table: 'dump_register', column: 'dumpNo' },
  rtv: { table: 'return_to_vendor', column: 'rtvNo' },
  rbc: { table: 'return_by_customer', column: 'rbcNo' },
  secondSale: { table: 'second_sale_document', column: 'secondSaleNo' },
  deliveryChallan: { table: 'delivery_challan_purchase', column: 'challanNo' },
  invoice: { table: 'invoices', column: 'invoiceNo' },
  eod: { table: 'stock_report', column: 'eodNo' },
  labourVoucher: { table: 'labour_payment_voucher', column: 'voucherNo' },
  multiCashVoucher: { table: 'multiple_cash_voucher', column: 'voucherNo' },
  packingVoucher: { table: 'packing_material_payment', column: 'voucherNo' },
  transportVoucher: { table: 'transport_payment_voucher', column: 'voucherNo' },
  stockAdjustment: { table: 'stock_adjustment', column: 'adjustment_no' },
  stockRepack: { table: 'stock_repack', column: 'repack_no' },
} as const satisfies Record<string, NumberSeries>;

/** Escapes a literal for use inside a POSIX regular expression. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Next serial of `scope`. `seedPattern` is a POSIX regex with one capture
 * group (the serial) matched against `series.column`; it is used only when the
 * series has no row yet.
 */
export async function nextSerial(
  manager: EntityManager,
  scope: string,
  series: NumberSeries,
  seedPattern: string,
): Promise<number> {
  const bumped = returnedRows<{ last_serial: string }>(
    await manager.query(
      `UPDATE document_sequences SET last_serial = last_serial + 1, updated_at = now()
        WHERE scope = $1 RETURNING last_serial`,
      [scope],
    ),
  );
  if (bumped.length) return toSerial(bumped[0].last_serial, scope);

  const seeded: Array<{ max: string | null }> = await manager.query(
    `SELECT MAX((regexp_match("${series.column}", $1))[1]::bigint) AS max
       FROM "${series.table}" WHERE "${series.column}" ~ $1`,
    [seedPattern],
  );
  const start = Number(seeded[0]?.max ?? 0) + 1;
  const inserted = returnedRows<{ last_serial: string }>(
    await manager.query(
      `INSERT INTO document_sequences (scope, last_serial, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (scope) DO UPDATE
         SET last_serial = GREATEST(document_sequences.last_serial + 1, EXCLUDED.last_serial), updated_at = now()
       RETURNING last_serial`,
      [scope, start],
    ),
  );
  return toSerial(inserted[0]?.last_serial, scope);
}

function toSerial(value: unknown, scope: string): number {
  const serial = Number(value);
  if (!Number.isSafeInteger(serial) || serial < 1) {
    throw new Error(`Document number sequence "${scope}" returned an invalid serial (${String(value)})`);
  }
  return serial;
}

/**
 * `prefix` + zero-padded serial, the serial running per prefix
 * (e.g. `IWD20261015` + `0001`).
 */
export async function nextDocumentNumber(
  manager: EntityManager,
  series: NumberSeries,
  prefix: string,
  width: number,
): Promise<string> {
  const serial = await nextSerial(manager, `${series.table}:${prefix}`, series, `^${escapeRegex(prefix)}([0-9]+)$`);
  return `${prefix}${String(serial).padStart(width, '0')}`;
}

/** `yyyyMMdd` of today (server time, as the existing numbers use). */
export function compactDate(now: Date = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}
