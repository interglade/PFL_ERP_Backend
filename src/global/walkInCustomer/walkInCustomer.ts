/**
 * Walk-in (unregistered) customer details typed on a sale document - Other DC and Second Sale:
 * customer type, alternate contact, PAN, billing / shipping address and place of supply.
 * Shared by create and update of both documents so they store the addresses the same way.
 */

import { EntityManager } from 'typeorm';
import { Address } from '../../address/entity/address.entity';
import AppError from '../../utils/appError';

export const WALK_IN_CUSTOMER_TYPES = ['individual', 'business'] as const;
export type WalkInCustomerType = (typeof WALK_IN_CUSTOMER_TYPES)[number];

export const ADDRESS_FIELDS = ['address1', 'address2', 'location', 'city', 'state', 'pincode'] as const;
type AddressValues = Record<(typeof ADDRESS_FIELDS)[number], string | null>;
type SavedAddress = { id: string; state: string | null };

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Trimmed text, or null for empty / 'null' (multipart sends everything as text). */
const text = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed && trimmed !== 'null' && trimmed !== 'undefined' ? trimmed : null;
};

/** true / 'true' / '1' → true; false / 'false' / '0' → false; missing → `fallback`. */
export const toBool = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === 'true' || value === '1';
};

export function parseCustomerType(value: unknown, fallback: WalkInCustomerType = 'individual'): WalkInCustomerType {
  const type = text(value)?.toLowerCase() ?? fallback;
  if (!(WALK_IN_CUSTOMER_TYPES as readonly string[]).includes(type)) {
    throw new AppError(400, 'Customer type must be Individual or Business');
  }
  return type as WalkInCustomerType;
}

export function parsePan(value: unknown): string | null {
  const pan = text(value)?.toUpperCase() ?? null;
  if (pan && !PAN_PATTERN.test(pan)) throw new AppError(400, 'Enter a valid PAN No (e.g. ABCDE1234F)');
  return pan;
}

const addressValues = (input: Record<string, unknown>): AddressValues =>
  Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, text(input[field])])) as AddressValues;

/**
 * Stores an address typed on the form in its six columns. An unchanged address keeps its row; a
 * changed one gets a new row, so an address row shared with another record is never overwritten.
 * A string is the id of an existing address. Returns null when nothing was entered.
 */
async function saveAddress(manager: EntityManager, input: unknown, current: Address | null | undefined): Promise<SavedAddress | null> {
  if (typeof input === 'string') {
    const id = text(input);
    if (!id) return null;
    const found = await manager.findOne(Address, { where: { id } });
    if (!found) throw new AppError(400, 'Address not found');
    return { id, state: found.state ?? null };
  }
  if (!input || typeof input !== 'object') return null;

  const values = addressValues(input as Record<string, unknown>);
  if (ADDRESS_FIELDS.every((field) => values[field] === null)) return null;
  if (current && ADDRESS_FIELDS.every((field) => (text(current[field]) ?? null) === values[field])) {
    return { id: current.id, state: values.state };
  }
  // Empty parts are stored as NULL (the entity types them as plain strings).
  const saved = await manager.save(manager.create(Address, values as Partial<Address>));
  return { id: saved.id, state: values.state };
}

/** The document's current customer details, needed when updating (the addresses as loaded rows). */
export type CurrentCustomer = {
  customerType?: WalkInCustomerType | null;
  billingAddress?: Address | null;
  shippingAddress?: Address | null;
  shipToSameAsBilling?: boolean | null;
};

/**
 * Customer fields to save on the document. On update (`current` given) an address that is not sent
 * stays as it is; the optional text fields are taken as sent (the forms always send the whole document).
 */
export async function resolveWalkInCustomer(manager: EntityManager, data: Record<string, any>, current?: CurrentCustomer) {
  const shipToSameAsBilling = toBool(data.shipToSameAsBilling, current?.shipToSameAsBilling ?? true);

  const billing =
    data.billingAddress !== undefined
      ? await saveAddress(manager, data.billingAddress, current?.billingAddress)
      : current?.billingAddress
        ? { id: current.billingAddress.id, state: current.billingAddress.state ?? null }
        : null;

  let shipping: SavedAddress | null = null;
  if (!shipToSameAsBilling) {
    shipping =
      data.shippingAddress !== undefined
        ? await saveAddress(manager, data.shippingAddress, current?.shippingAddress)
        : current?.shippingAddress
          ? { id: current.shippingAddress.id, state: current.shippingAddress.state ?? null }
          : null;
    if (!shipping) {
      throw new AppError(400, 'Enter the shipping address, or tick "Shipping address same as billing address"');
    }
  }

  return {
    customerType: parseCustomerType(data.customerType, current?.customerType ?? 'individual'),
    customerAltContactNo: text(data.customerAltContactNo),
    customerPanNo: parsePan(data.customerPanNo),
    billingAddress: billing ? ({ id: billing.id } as Address) : null,
    shipToSameAsBilling,
    shippingAddress: shipping ? ({ id: shipping.id } as Address) : null,
    placeOfSupply: text(data.placeOfSupply) ?? (shipToSameAsBilling ? billing?.state : shipping?.state) ?? null,
  };
}

/** One-line address for lists, views and the printout. */
export const formatWalkInAddress = (address: Partial<Address> | null | undefined): string | null =>
  address
    ? [address.address1, address.address2, address.location, address.city, address.state, address.pincode]
        .filter(Boolean)
        .join(' ') || null
    : null;

/** Address as an object for the edit form. */
export const addressForForm = (address: Address | null | undefined) =>
  address
    ? {
        id: address.id,
        address1: address.address1, address2: address.address2, location: address.location,
        city: address.city, state: address.state, pincode: address.pincode,
      }
    : null;

/** Request keys handled by resolveWalkInCustomer (never copied onto the record directly). */
export const WALK_IN_CUSTOMER_KEYS = [
  'billingAddress', 'shippingAddress', 'shipToSameAsBilling',
  'customerType', 'customerAltContactNo', 'customerPanNo', 'placeOfSupply',
] as const;

/** Splits an update body into the customer input for resolveWalkInCustomer and everything else. */
export function splitWalkInCustomer(data: Record<string, any>): { customer: Record<string, any>; rest: Record<string, any> } {
  const customer: Record<string, any> = {};
  const rest: Record<string, any> = { ...data };
  for (const key of WALK_IN_CUSTOMER_KEYS) {
    customer[key] = rest[key];
    delete rest[key];
  }
  return { customer, rest };
}

// ─── Reading: query columns and response shapes ──────────────────────────────

/** The walk-in customer columns of `alias` (name, contact no and email are per document). */
export const walkInCustomerColumns = (alias: string): string[] =>
  ['customerType', 'customerAltContactNo', 'customerPanNo', 'shipToSameAsBilling', 'placeOfSupply'].map((field) => `${alias}.${field}`);

/** The columns of an address joined as `alias`. */
export const walkInAddressColumns = (alias: string): string[] => ['id', ...ADDRESS_FIELDS].map((field) => `${alias}.${field}`);

type WalkInRecord = {
  customerType?: WalkInCustomerType | null;
  customerAltContactNo?: string | null;
  customerPanNo?: string | null;
  billingAddress?: Address | null;
  shipToSameAsBilling?: boolean | null;
  shippingAddress?: Address | null;
  placeOfSupply?: string | null;
};

/** Customer fields with the addresses as objects (edit form, and views that show the six parts). */
export const walkInCustomerForForm = (record: WalkInRecord) => ({
  customerType: record.customerType ?? 'individual',
  customerAltContactNo: record.customerAltContactNo ?? null,
  customerPanNo: record.customerPanNo ?? null,
  billingAddress: addressForForm(record.billingAddress),
  shipToSameAsBilling: record.shipToSameAsBilling ?? true,
  // Null when the goods go to the billing address.
  shippingAddress: record.shipToSameAsBilling === false ? addressForForm(record.shippingAddress) : null,
  placeOfSupply: record.placeOfSupply ?? null,
});

/** Customer fields with the addresses as one line each; shipping is the billing address when "same as billing". */
export const walkInCustomerForList = (record: WalkInRecord) => {
  const billingAddress = formatWalkInAddress(record.billingAddress);
  return {
    customerType: record.customerType ?? null,
    customerAltContactNo: record.customerAltContactNo ?? null,
    customerPanNo: record.customerPanNo ?? null,
    billingAddress,
    shipToSameAsBilling: record.shipToSameAsBilling ?? true,
    shippingAddress: record.shipToSameAsBilling === false ? formatWalkInAddress(record.shippingAddress) : billingAddress,
    placeOfSupply: record.placeOfSupply ?? null,
  };
};
