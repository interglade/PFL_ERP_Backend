import AppError from './appError';

// status.enum.ts
/** Registration status (vendor, farmer, customer, transporter, vehicle, driver). */
export enum Status {
  DRAFT = "Draft",
  PENDING = "Pending",
  APPROVED = "Approved",
  REJECTED = "Rejected",
}

/**
 * `input` when it is exactly one of the status `values`, else undefined. Statuses are Title Case
 * (docs/status-title-case.md) and are never matched loosely: "approved" is not "Approved".
 */
export function parseStatus<E extends string>(values: Record<string, E> | readonly E[], input: unknown): E | undefined {
  const allowed: readonly E[] = Array.isArray(values) ? values : Object.values(values);
  return typeof input === 'string' && allowed.includes(input as E) ? (input as E) : undefined;
}

/** The status a request names, exactly; anything else is a 400 listing the allowed values. */
export function requireStatus<E extends string>(values: Record<string, E> | readonly E[], input: unknown, param: string): E {
  const status = parseStatus(values, input);
  if (status === undefined) {
    const allowed: readonly E[] = Array.isArray(values) ? values : Object.values(values);
    throw new AppError(400, `Invalid ${param} '${String(input)}'. Allowed values: ${allowed.join(', ')}`);
  }
  return status;
}

/** The approve / reject decision on a sales or procurement target. */
export const TARGET_DECISIONS = ['Approved', 'Rejected'] as const;
export type TargetDecision = (typeof TARGET_DECISIONS)[number];

// src/utils/approvalStatus.enum.ts
export enum ApprovalStatus {
  PENDING = 'Pending',
  APPROVED = 'Approved',
  REJECTED = 'Rejected',
 
}


export enum FileType {
  IMAGE = 'image',
  PDF = 'pdf',
}
  
export enum Department {
  ADMIN='admin',
  HR='hr',
  OPERATIONS = 'operations',
  SALE = 'sale',
  PROCUREMENT = 'procurement',
  IT='it',
  BUSINESS_DEVELOPMENT='business_development',
  EXPORTS='exports',
  BRANDING_MARKETING='branding_&_marketing',
  FARMING='farming',
  QUALITY_CHECKING='quality_checking',
  // In the user form's list; were dropped on save until the user import added them (2026-11-03)
  ACCOUNTS='accounts',
  FINANCE='finance',
  // INVENTORY='inventory',
  OTHER='other'
}

export enum CompanyName {
  PrimeFreshLimited = 'prime fresh limited',
  FlorensFreshSupplySolutionsPvtLtd = 'florens fresh supply solutions pvt. ltd.',
  FlorensFarmingPrivateLimited = 'florens farming private limited',
  PrimeFreshRetailIPrivateLimited = 'prime fresh retail (i) private limited'
}

// src/utils/source.enum.ts
export enum Source {
  VENDOR = 'vendor',
  FARMER = 'farmer',
}


/**
 * A GRN's payment status, worked out from its recorded payments (docs/grn-payment-history-plan.md B2).
 * Final Invoices use the same values (docs/grn-payment-history-plan.md, invoice payments).
 */
export enum GrnPaymentStatus {
    UNPAID = 'Unpaid',
    PARTIAL = 'Partial',
    PAID = 'Paid',
}




