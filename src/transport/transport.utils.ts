import AppError from '../utils/appError';

/** Indian mobile number, same rule as the frontend (REGEX.CONTACT_NO). */
export const PHONE_REGEX = /^[6-9]\d{9}$/;
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Registration plate once normalized (no spaces / dashes): MH12AB1234, plus the BH series. */
export const VEHICLE_NO_REGEX = /^([A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/;

/** Trims a string; blank / non-string input becomes null so optional columns stay NULL, not ''. */
export function blankToNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' || text === 'null' || text === 'undefined' ? null : text;
}

export function upperOrNull(value: unknown): string | null {
  const text = blankToNull(value);
  return text ? text.toUpperCase() : null;
}

export function numberOrNull(value: unknown): number | null {
  const text = blankToNull(value);
  if (text === null) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `mh 12-ab 1234` → `MH12AB1234` */
export function normalizeVehicleNo(value: unknown): string | null {
  const text = blankToNull(value);
  return text ? text.replace(/[\s-]/g, '').toUpperCase() : null;
}

/** Keeps only the digits of a phone number and drops a leading 91 / 0 country or trunk prefix. */
export function normalizePhone(value: unknown): string | null {
  const text = blankToNull(value);
  if (!text) return null;
  let digits = text.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

export function requireText(value: string | null | undefined, message: string): void {
  if (!value) throw new AppError(400, message);
}

export function assertMatches(value: string | null | undefined, regex: RegExp, message: string): void {
  if (value && !regex.test(value)) throw new AppError(400, message);
}

/** `YYYY-MM-DD` or null; anything else is rejected. */
export function dateOrNull(value: unknown, label: string): string | null {
  const text = blankToNull(value);
  if (text === null) return null;
  const day = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) {
    throw new AppError(400, `${label} must be a valid date (YYYY-MM-DD)`);
  }
  return day;
}

export function fullName(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ').trim();
}

export function formatAddress(addr: any): string {
  return addr
    ? [addr.address1, addr.address2, addr.location, addr.city, addr.state, addr.pincode].filter(Boolean).join(' ')
    : '';
}

export interface AddressPayload {
  id?: string;
  address1: string | null;
  address2: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export function mapAddress(addr: any): AddressPayload | null {
  return addr?.id
    ? {
        id: addr.id,
        address1: addr.address1 ?? null,
        address2: addr.address2 ?? null,
        location: addr.location ?? null,
        city: addr.city ?? null,
        state: addr.state ?? null,
        pincode: addr.pincode ?? null,
      }
    : null;
}

/** Address from a request body, or null when the body carries nothing meaningful. */
export function readAddress(raw: any): Omit<AddressPayload, 'id'> | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const address = {
    address1: blankToNull(value.address1),
    address2: blankToNull(value.address2),
    location: blankToNull(value.location),
    city: blankToNull(value.city),
    state: blankToNull(value.state),
    pincode: blankToNull(value.pincode),
  };
  return Object.values(address).some((v) => v !== null) ? address : null;
}

/** True for a Postgres unique-violation raised by TypeORM. */
export function isUniqueViolation(error: any): boolean {
  return error?.driverError?.code === '23505' || error?.code === '23505';
}

export function uniqueViolationText(error: any): string {
  return `${error?.driverError?.constraint ?? ''} ${error?.driverError?.detail ?? ''} ${error?.message ?? ''}`;
}
