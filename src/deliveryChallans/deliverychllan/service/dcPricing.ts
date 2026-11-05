/**
 * Per-line pricing basis of sale lines (Customer / Transfer / Other DC, Final
 * Invoice, Second Sale): a line is priced per unit of its UoM (10 boxes ×
 * ₹1,250) or per kg of its net weight (52 kg × ₹240, while 10 boxes leave
 * stock). The amount is always computed here, never taken from the client.
 */

import AppError from '../../../utils/appError';

export type PricingBasis = 'per_unit' | 'per_kg';
export const PRICING_BASES: PricingBasis[] = ['per_unit', 'per_kg'];

export function normalizePricingBasis(value: unknown): PricingBasis {
  if (value === null || value === undefined || value === '') return 'per_unit';
  if (value === 'per_unit' || value === 'per_kg') return value;
  throw new AppError(400, `Pricing basis must be one of ${PRICING_BASES.join(', ')}`);
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** quantity × unit price, or net kg × unit price when priced per kg. */
export function lineAmount(basis: PricingBasis, quantity: unknown, netWeight: unknown, unitPrice: unknown): number {
  const price = Number(unitPrice) || 0;
  const measure = basis === 'per_kg' ? Number(netWeight) || 0 : Number(quantity) || 0;
  return round2(measure * price);
}

/**
 * Sets `pricingBasis` and `amount` on every DC line and returns Σ amounts (the
 * DC's `totalProductAmount`). Lines are mutated in place.
 */
export function priceDcLines(
  lines: Array<{ pricingBasis?: unknown; quantity?: unknown; netWeight?: unknown; unitPrice?: unknown; amount?: unknown }> | null | undefined,
): number {
  let total = 0;
  for (const line of lines ?? []) {
    const basis = normalizePricingBasis(line.pricingBasis);
    line.pricingBasis = basis;
    line.amount = lineAmount(basis, line.quantity, line.netWeight, line.unitPrice);
    total += Number(line.amount);
  }
  return round2(total);
}
