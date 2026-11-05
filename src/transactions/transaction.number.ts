/**
 * Transaction numbers (docs/transaction-tracking-plan.md §3, §9.2):
 * prefix + yyMMdd (Asia/Kolkata business date) + 5-digit serial, the serial
 * restarting every day per prefix. Pure helpers; the serial itself comes from
 * `nextSerial` (document_sequences) in transaction.core.ts.
 */

import moment from 'moment-timezone';
import { TXN_NO_MAX_LENGTH, TXN_SERIAL_WIDTH, TXN_TIME_ZONE, TxnPrefix } from './transaction.types';

export const TXN_PREFIXES: TxnPrefix[] = ['R', 'G', 'T', 'S', 'SO', 'SS'];
export const TXN_MAX_SERIAL = 10 ** TXN_SERIAL_WIDTH - 1;

/** Matches a complete transaction number (two-letter prefixes first, so `SO…` is not read as `S` + `O…`). */
export const TXN_NO_PATTERN = /^(SO|SS|R|G|T|S)(\d{6})(\d{5})$/;

export interface BusinessDate {
  /** `YYYY-MM-DD` in Asia/Kolkata. */
  date: string;
  /** `yyMMdd` used inside the number. */
  compact: string;
}

/** The business date (Asia/Kolkata) of an instant. */
export function businessDateOf(now: Date = new Date()): BusinessDate {
  const ist = moment(now).tz(TXN_TIME_ZONE);
  return { date: ist.format('YYYY-MM-DD'), compact: ist.format('YYMMDD') };
}

/** `document_sequences.scope` of a prefix and day. */
export function txnSequenceScope(prefix: TxnPrefix, compactDate: string): string {
  return `txn:${prefix}:${compactDate}`;
}

/** Regex (one capture group: the serial) of the numbers of a prefix and day, for seeding a new series. */
export function txnSeedPattern(prefix: TxnPrefix, compactDate: string): string {
  return `^${prefix}${compactDate}([0-9]{${TXN_SERIAL_WIDTH}})$`;
}

export function formatTxnNo(prefix: TxnPrefix, compactDate: string, serial: number): string {
  if (!TXN_PREFIXES.includes(prefix)) throw new Error(`Unknown transaction prefix "${prefix}"`);
  if (!/^\d{6}$/.test(compactDate)) throw new Error(`Transaction date must be yyMMdd, got "${compactDate}"`);
  if (!Number.isSafeInteger(serial) || serial < 1 || serial > TXN_MAX_SERIAL) {
    throw new Error(`Transaction serial ${serial} is out of range for ${prefix}${compactDate} (1-${TXN_MAX_SERIAL})`);
  }
  const txnNo = `${prefix}${compactDate}${String(serial).padStart(TXN_SERIAL_WIDTH, '0')}`;
  if (txnNo.length > TXN_NO_MAX_LENGTH) throw new Error(`Transaction number ${txnNo} is longer than ${TXN_NO_MAX_LENGTH}`);
  return txnNo;
}

export interface ParsedTxnNo {
  prefix: TxnPrefix;
  compactDate: string;
  serial: number;
}

export function parseTxnNo(text: string | null | undefined): ParsedTxnNo | null {
  const match = TXN_NO_PATTERN.exec((text ?? '').trim().toUpperCase());
  if (!match) return null;
  return { prefix: match[1] as TxnPrefix, compactDate: match[2], serial: Number(match[3]) };
}

export const isTxnNo = (text: string | null | undefined): boolean => parseTxnNo(text) !== null;
