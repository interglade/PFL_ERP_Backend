/**
 * AQR request validation — pure functions, no database
 * (docs/receiving-links-plan.md §2.4).
 *
 * An AQR is submitted complete-or-nothing: every problem in the header and in
 * the product lines is collected and the request is rejected with one 400
 * listing all of them, so the user fixes the form once. The receiving guard
 * then checks the lines against the source (R1–R7) inside the transaction.
 */

// Type-only: pulling the entity in at runtime would load the whole entity
// graph (and the data source) into a module that must stay pure.
import type { AqrFor } from '../entity/aqr.entity';
import { ReceivingSourceType } from '../../receiving/receiving.types';
import { productKey } from '../../receiving/receiving.helpers';

export type AqrSourceRefKey = 'grnNo' | 'deliveryChallanNo' | 'rbcNo';

/** The `AqrFor` enum values, as strings. */
export const AQR_FOR_VALUES: readonly string[] = ['purchase', 'transfer', 'returned-by-customer'];

/** Which header reference each `aqrFor` must carry, and the source type it maps to. */
export const AQR_SOURCE_BY_FOR: Record<AqrFor, { ref: AqrSourceRefKey; sourceType: ReceivingSourceType; label: string }> = {
  purchase: { ref: 'grnNo', sourceType: 'grn', label: 'GRN' },
  transfer: { ref: 'deliveryChallanNo', sourceType: 'stock-transfer-dc', label: 'Transfer DC' },
  'returned-by-customer': { ref: 'rbcNo', sourceType: 'rbc', label: 'Return By Customer' },
};

const SOURCE_REF_KEYS: AqrSourceRefKey[] = ['grnNo', 'deliveryChallanNo', 'rbcNo'];
const SOURCE_REF_LABEL: Record<AqrSourceRefKey, string> = {
  grnNo: 'GRN',
  deliveryChallanNo: 'Transfer DC',
  rbcNo: 'Return By Customer',
};

export const AQR_PARAMETER_TYPES = ['good', 'bad', 'average'] as const;

/** A `{ id }` reference or a bare id string, as the form may send either. */
export type RefLike = { id?: string | null } | string | null | undefined;

export interface AqrHeaderInput {
  aqrFor?: AqrFor | string | null;
  grnNo?: RefLike;
  deliveryChallanNo?: RefLike;
  rbcNo?: RefLike;
}

export interface AqrParameterInput {
  qualityParameterId?: string | null;
  qualityParameterName?: string | null;
  qualityParameterType?: string | null;
  quantity?: number | string | null;
  percentage?: number | string | null;
}

export interface AqrLineInput {
  id?: string | null;
  product?: RefLike;
  variant?: RefLike;
  uom?: RefLike;
  arrivedQty?: number | string | null;
  samplingQty?: number | string | null;
  totalQty?: number | string | null;
  totalpercent?: number | string | null;
  remark?: string | null;
  parameters?: AqrParameterInput[] | null;
}

export interface AqrSourceRef {
  sourceType: ReceivingSourceType;
  sourceId: string;
}

export interface AqrValidationResult {
  errors: string[];
  /** Set when the header names exactly one valid source. */
  source: AqrSourceRef | null;
}

/** Reads an id out of `{ id }` or a bare string; null when empty. */
export function refIdOf(value: RefLike): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() ? value.trim() : null;
  if (typeof value === 'object' && typeof value.id === 'string' && value.id.trim()) return value.id.trim();
  return null;
}

/**
 * Parses a quantity the form sent as a number or a numeric string.
 * `undefined` = missing; `NaN` = present but not a number.
 */
export function parseQuantity(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    if (!value.trim()) return undefined;
    return Number(value);
  }
  if (typeof value === 'number') return value;
  return NaN;
}

/** Legacy varchar quantity → number; anything unparseable becomes 0. */
export function legacyQuantityToNumber(value: unknown): number {
  const n = parseQuantity(value);
  return n === undefined || !Number.isFinite(n) ? 0 : n;
}

export function isAqrFor(value: unknown): value is AqrFor {
  return typeof value === 'string' && AQR_FOR_VALUES.includes(value);
}

/**
 * Header rule: `aqrFor` is one of the three purposes and exactly the matching
 * source reference is present (`grnNo` ↔ purchase, `deliveryChallanNo` ↔
 * transfer, `rbcNo` ↔ returned-by-customer).
 */
export function validateAqrSourceRef(header: AqrHeaderInput): AqrValidationResult {
  const errors: string[] = [];
  const present = SOURCE_REF_KEYS.filter((key) => refIdOf(header[key]) !== null);

  if (!isAqrFor(header.aqrFor)) {
    errors.push('AQR for must be purchase, transfer or returned-by-customer');
    return { errors, source: null };
  }

  const expected = AQR_SOURCE_BY_FOR[header.aqrFor];
  const sourceId = refIdOf(header[expected.ref]);
  if (!sourceId) {
    errors.push(`Select the ${expected.label} this AQR is for`);
  }
  const extra = present.filter((key) => key !== expected.ref);
  if (extra.length > 0) {
    const forLabel = (header.aqrFor as string) === 'returned-by-customer' ? 'return-by-customer' : header.aqrFor;
    errors.push(`A ${forLabel} AQR can only reference a ${expected.label}, not ${extra.map((k) => SOURCE_REF_LABEL[k]).join(' or ')}`);
  }

  return {
    errors,
    source: errors.length === 0 && sourceId ? { sourceType: expected.sourceType, sourceId } : null,
  };
}

/**
 * Line rules: at least one line; every line has a product, numeric
 * `arrivedQty ≥ 0`, numeric `samplingQty ≥ 0` not above `arrivedQty`, optional
 * numeric totals, and every parameter has an id, a name, a known type and a
 * numeric `quantity ≥ 0`. A product + variant may appear once.
 */
export function validateAqrLines(products: AqrLineInput[] | null | undefined): string[] {
  const errors: string[] = [];
  if (!Array.isArray(products) || products.length === 0) {
    errors.push('Add one product line per product of the source');
    return errors;
  }

  const firstLineByKey = new Map<string, number>();

  products.forEach((line, index) => {
    const n = index + 1;
    const where = `Product line ${n}`;
    if (!line || typeof line !== 'object') {
      errors.push(`${where}: invalid line`);
      return;
    }

    const productId = refIdOf(line.product);
    if (!productId) {
      errors.push(`${where}: product is required`);
    } else {
      const key = productKey(productId, refIdOf(line.variant));
      const first = firstLineByKey.get(key);
      if (first !== undefined) {
        errors.push(`${where}: repeats the product of line ${first}`);
      } else {
        firstLineByKey.set(key, n);
      }
    }

    const arrived = parseQuantity(line.arrivedQty);
    if (arrived === undefined) {
      errors.push(`${where}: arrived quantity is required`);
    } else if (!Number.isFinite(arrived) || arrived < 0) {
      errors.push(`${where}: arrived quantity must be a number of 0 or more`);
    }

    const sampling = parseQuantity(line.samplingQty);
    if (sampling === undefined) {
      errors.push(`${where}: sampling quantity is required`);
    } else if (!Number.isFinite(sampling) || sampling < 0) {
      errors.push(`${where}: sampling quantity must be a number of 0 or more`);
    } else if (arrived !== undefined && Number.isFinite(arrived) && arrived >= 0 && sampling > arrived) {
      errors.push(`${where}: sampling quantity (${sampling}) cannot exceed arrived quantity (${arrived})`);
    }

    const totalQty = parseQuantity(line.totalQty);
    if (totalQty !== undefined && !Number.isFinite(totalQty)) {
      errors.push(`${where}: total quantity must be a number`);
    }
    const totalPercent = parseQuantity(line.totalpercent);
    if (totalPercent !== undefined && !Number.isFinite(totalPercent)) {
      errors.push(`${where}: total percent must be a number`);
    }

    if (line.parameters != null && !Array.isArray(line.parameters)) {
      errors.push(`${where}: parameters must be a list`);
      return;
    }
    (line.parameters ?? []).forEach((param, pIndex) => {
      const pn = pIndex + 1;
      const name = typeof param?.qualityParameterName === 'string' ? param.qualityParameterName.trim() : '';
      const label = name ? `parameter "${name}"` : `parameter ${pn}`;
      if (!param || typeof param !== 'object') {
        errors.push(`${where}: parameter ${pn} is invalid`);
        return;
      }
      if (!name) errors.push(`${where}: parameter ${pn} has no name`);
      if (typeof param.qualityParameterId !== 'string' || !param.qualityParameterId.trim()) {
        errors.push(`${where}: ${label} has no quality parameter id`);
      }
      if (!(AQR_PARAMETER_TYPES as readonly string[]).includes(String(param.qualityParameterType ?? ''))) {
        errors.push(`${where}: ${label} type must be good, bad or average`);
      }
      const quantity = parseQuantity(param.quantity);
      if (quantity === undefined) {
        errors.push(`${where}: ${label} quantity is required`);
      } else if (!Number.isFinite(quantity) || quantity < 0) {
        errors.push(`${where}: ${label} quantity must be a number of 0 or more`);
      }
      const percentage = parseQuantity(param.percentage);
      if (percentage !== undefined && !Number.isFinite(percentage)) {
        errors.push(`${where}: ${label} percentage must be a number`);
      }
    });
  });

  return errors;
}

/** Header + lines together; the caller throws one 400 with `errors.join('; ')`. */
export function validateAqrRequest(header: AqrHeaderInput, products: AqrLineInput[] | null | undefined): AqrValidationResult {
  const ref = validateAqrSourceRef(header);
  const lineErrors = validateAqrLines(products);
  return { errors: [...ref.errors, ...lineErrors], source: ref.source };
}

/** Percentage of the sample a parameter quantity represents, when the form did not send one. */
export function defaultPercentage(quantity: number, samplingQty: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(samplingQty) || samplingQty <= 0) return 0;
  return Math.round((quantity / samplingQty) * 100 * 100) / 100;
}
