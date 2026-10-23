/**
 * Receiving links — pure functions (no database access).
 *
 * Everything here is deterministic and unit-tested in
 * `src/test/service/receiving.helpers.spec.ts`. The services feed these with
 * rows they load and persist nothing from here.
 */

import {
  AggregatedDocLine,
  AggregatedSourceLine,
  CountingDocumentLike,
  DocLineInput,
  DuplicateLineInput,
  GuardLine,
  ProcessingDocType,
  ReceivingProductRow,
  ReceivingSourceType,
  ReceivingState,
  SlotState,
  SourceLineInput,
} from './receiving.types';

export const REJECTED_STATUS = 'REJECT';
export const COMPLETE_STATUS = 'COMPLETE';

export const PROCESSING_DOC_LABEL: Record<ProcessingDocType, string> = {
  aqr: 'Arrival Quality Report',
  inward: 'Inward Register',
  dump: 'Dump Register',
  rtv: 'Return To Vendor',
};

export const SOURCE_TYPE_LABEL: Record<ReceivingSourceType, string> = {
  grn: 'GRN',
  'stock-transfer-dc': 'Transfer DC',
  rbc: 'RBC',
};

/** Rounds to 3 decimals (kg) and normalises -0 to 0. */
export function round3(value: number): number {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Parses decimals that Postgres returns as strings; NaN / null / undefined → 0. */
export function toKg(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Line key of receiving: product + variant + unit. One GRN may carry the same
 * product in two units (Mango in Box and Mango in kg); those are two lines.
 */
export function productKey(productId: string, variantId?: string | null, uomId?: string | null, batchNo?: string | null): string {
  const base = `${productId}:${variantId ? variantId : 'null'}:${uomId ? uomId : 'null'}`;
  // Only lines that carry their own batch (transfer lines) get a batch segment.
  return batchNo ? `${base}:${batchNo}` : base;
}

/** Product + variant only (used to fall back for lines without a matching unit). */
export function productVariantKey(productId: string, variantId?: string | null): string {
  return `${productId}:${variantId ? variantId : 'null'}`;
}

/**
 * The source line a document line belongs to: the exact product + variant +
 * unit, otherwise the only source line of that product + variant (documents
 * written before the unit was part of the key, or with a unit changed by
 * hand). Returns the line's own key when nothing matches.
 */
export function matchSourceKey(
  sourceAgg: Map<string, { productId: string; variantId: string | null; uomId?: string | null; batchNo?: string | null }>,
  productId: string,
  variantId?: string | null,
  uomId?: string | null,
  batchNo?: string | null,
): string {
  const exact = productKey(productId, variantId, uomId, batchNo);
  if (sourceAgg.has(exact)) return exact;
  // Narrow step by step: same product + variant, then the unit, then the batch
  // (each only when it still leaves a candidate); one candidate left wins.
  const wanted = productVariantKey(productId, variantId);
  let candidates = Array.from(sourceAgg.entries()).filter(([, line]) => productVariantKey(line.productId, line.variantId) === wanted);
  const narrow = (keep: (line: { uomId?: string | null; batchNo?: string | null }) => boolean) => {
    const left = candidates.filter(([, line]) => keep(line));
    if (left.length) candidates = left;
  };
  if (uomId) narrow((line) => (line.uomId ?? null) === uomId);
  if (batchNo) narrow((line) => (line.batchNo ?? '').toUpperCase() === batchNo.toUpperCase());
  return candidates.length === 1 ? candidates[0][0] : exact;
}

/** `Tomato (Grade A)` or `Tomato` when there is no variant. */
export function productLabel(productName: string | null | undefined, variantName?: string | null): string {
  const name = productName && productName.trim() ? productName.trim() : 'Unknown product';
  return variantName && variantName.trim() ? `${name} (${variantName.trim()})` : name;
}

/**
 * Sums received kg per product + variant. Legacy sources may list the same
 * product + variant twice (D6 is a service check, not a DB index); those rows
 * aggregate into one line. Lines without a product are ignored.
 */
export function aggregateSourceLines(lines: SourceLineInput[]): Map<string, AggregatedSourceLine> {
  const result = new Map<string, AggregatedSourceLine>();
  for (const line of lines ?? []) {
    if (!line || !line.productId) continue;
    const variantId = line.variantId ? line.variantId : null;
    const batchNo = line.batchNo ? line.batchNo : null;
    const key = productKey(line.productId, variantId, line.uomId ?? null, batchNo);
    const kg = toKg(line.kg);
    const qty = toKg(line.qty);
    const grossKg = toKg(line.grossKg);
    const existing = result.get(key);
    if (existing) {
      existing.receivedKg = round3(existing.receivedKg + kg);
      existing.receivedQty = round3(existing.receivedQty + qty);
      existing.receivedGrossKg = round3(existing.receivedGrossKg + grossKg);
      if (existing.productName == null && line.productName) existing.productName = line.productName;
      if (existing.variantName == null && line.variantName) existing.variantName = line.variantName;
      if (existing.uomId == null && line.uomId) {
        existing.uomId = line.uomId;
        existing.uomName = line.uomName ?? null;
      }
      if (existing.unitPrice == null && line.unitPrice != null) existing.unitPrice = Number(line.unitPrice);
      continue;
    }
    result.set(key, {
      key,
      productId: line.productId,
      productName: line.productName ?? null,
      variantId,
      variantName: line.variantName ?? null,
      uomId: line.uomId ?? null,
      uomName: line.uomName ?? null,
      batchNo,
      unitPrice: line.unitPrice != null && line.unitPrice !== '' ? Number(line.unitPrice) : null,
      receivedQty: round3(qty),
      receivedGrossKg: round3(grossKg),
      receivedKg: round3(kg),
    });
  }
  return result;
}

/**
 * Sums kg, quantity and sample kg per line key across the lines of one or more
 * documents. With `sourceAgg`, each line is keyed by the source line it
 * belongs to ({@link matchSourceKey}).
 */
export function aggregateDocLines(
  lines: DocLineInput[],
  sourceAgg?: Map<string, AggregatedSourceLine>,
): Map<string, AggregatedDocLine> {
  const result = new Map<string, AggregatedDocLine>();
  for (const line of lines ?? []) {
    if (!line || !line.productId) continue;
    const variantId = line.variantId ? line.variantId : null;
    const key = sourceAgg
      ? matchSourceKey(sourceAgg, line.productId, variantId, line.uomId ?? null, line.batchNo ?? null)
      : productKey(line.productId, variantId, line.uomId ?? null, line.batchNo ?? null);
    const kg = toKg(line.kg);
    const hasQty = line.qty !== null && line.qty !== undefined && line.qty !== '';
    const qty = hasQty ? toKg(line.qty) : null;
    const sampleKg = toKg(line.sampleKg);
    const existing = result.get(key);
    if (existing) {
      existing.kg = round3(existing.kg + kg);
      if (qty !== null) existing.qty = round3((existing.qty ?? 0) + qty);
      existing.sampleKg = round3(existing.sampleKg + sampleKg);
      existing.legacy = existing.legacy || Boolean(line.legacy);
      if (existing.productName == null && line.productName) existing.productName = line.productName;
      if (existing.variantName == null && line.variantName) existing.variantName = line.variantName;
      continue;
    }
    result.set(key, {
      key,
      productId: line.productId,
      productName: line.productName ?? null,
      variantId,
      variantName: line.variantName ?? null,
      kg: round3(kg),
      qty: qty === null ? null : round3(qty),
      sampleKg: round3(sampleKg),
      legacy: Boolean(line.legacy),
    });
  }
  return result;
}

function neverBelowZero(value: number): number {
  const rounded = round3(value);
  return rounded < 0 ? 0 : rounded;
}

/**
 * One row per product of the source (plus any product that only appears on a
 * processing document — legacy data — so nothing is hidden). Suggested kg:
 * inward = basis − dump − rtv, dump = basis − inward − rtv,
 * rtv = basis − inward − dump, never below 0, where basis is the arrived kg
 * of the AQR when one counts and the source kg otherwise.
 */
export function buildProductRows(
  sourceAgg: Map<string, AggregatedSourceLine>,
  aqrAgg: Map<string, AggregatedDocLine> | null,
  inwardAgg: Map<string, AggregatedDocLine>,
  dumpAgg: Map<string, AggregatedDocLine>,
  rtvAgg: Map<string, AggregatedDocLine>,
): ReceivingProductRow[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };
  sourceAgg.forEach((_, key) => push(key));
  (aqrAgg ?? new Map()).forEach((_, key) => push(key));
  inwardAgg.forEach((_, key) => push(key));
  dumpAgg.forEach((_, key) => push(key));
  rtvAgg.forEach((_, key) => push(key));

  const rows: ReceivingProductRow[] = [];
  for (const key of keys) {
    const source = sourceAgg.get(key) ?? null;
    const aqr = aqrAgg ? aqrAgg.get(key) ?? null : null;
    const inward = inwardAgg.get(key) ?? null;
    const dump = dumpAgg.get(key) ?? null;
    const rtv = rtvAgg.get(key) ?? null;
    const fallback = source ?? aqr ?? inward ?? dump ?? rtv;
    if (!fallback) continue;

    const receivedKg = source ? source.receivedKg : 0;
    const arrivedKg = aqr ? aqr.kg : null;
    const arrivedQty = aqr ? aqr.qty : null;
    // What arrived is what must be accounted for; until an AQR counts, the source kg.
    const basisKg = arrivedKg !== null ? arrivedKg : receivedKg;
    const inwardKg = inward ? inward.kg : 0;
    const dumpKg = dump ? dump.kg : 0;
    const rtvKg = rtv ? rtv.kg : 0;
    const loss = source && arrivedKg !== null ? transitLoss(source, arrivedKg, arrivedQty) : null;

    rows.push({
      key,
      productId: fallback.productId,
      productName: source?.productName ?? aqr?.productName ?? inward?.productName ?? dump?.productName ?? rtv?.productName ?? null,
      variantId: fallback.variantId,
      variantName: source?.variantName ?? aqr?.variantName ?? inward?.variantName ?? dump?.variantName ?? rtv?.variantName ?? null,
      uomId: source?.uomId ?? null,
      uomName: source?.uomName ?? null,
      batchNo: source?.batchNo ?? null,
      unitPrice: source?.unitPrice ?? null,
      receivedQty: source ? source.receivedQty : 0,
      receivedGrossKg: source ? source.receivedGrossKg : 0,
      receivedKg,
      arrivedKg,
      arrivedQty,
      sampleKg: aqr ? aqr.sampleKg : null,
      inwardKg,
      dumpKg,
      rtvKg,
      basisKg,
      differenceKg: round3(basisKg - inwardKg - dumpKg - rtvKg),
      transitLossKg: loss ? loss.lossKg : null,
      transitLossQty: loss ? loss.lossQty : null,
      transitLossValue: loss ? loss.lossValue : null,
      suggested: {
        inwardKg: neverBelowZero(basisKg - dumpKg - rtvKg),
        dumpKg: neverBelowZero(basisKg - inwardKg - rtvKg),
        rtvKg: neverBelowZero(basisKg - inwardKg - dumpKg),
      },
    });
  }
  return rows;
}

export interface DeriveStateInput {
  /** The source's `documents.status` is COMPLETE. */
  isComplete: boolean;
  /** At least one counting processing document exists (any type). */
  hasCountingDocument: boolean;
  /** A counting Inward Register exists. */
  hasInward: boolean;
  /** A counting Dump Register has a line without net weight (pre-change row). */
  hasLegacyDumpLine: boolean;
  products: Pick<ReceivingProductRow, 'differenceKg'>[];
}

/**
 * `not-received` if the source is not COMPLETE; `not-started` if no counting
 * document; `done` if an Inward exists and every differenceKg is 0; `legacy`
 * if any counting dump line has no netWeight; else `open`.
 */
export function deriveState(input: DeriveStateInput): ReceivingState {
  if (!input.isComplete) return 'not-received';
  if (!input.hasCountingDocument) return 'not-started';
  if (input.hasInward && input.products.every((p) => round3(p.differenceKg) === 0)) return 'done';
  if (input.hasLegacyDumpLine) return 'legacy';
  return 'open';
}

/** A document counts when its `documents.status` is not REJECT and the business row is not deleted. */
export function isCountingDocument(doc: CountingDocumentLike): boolean {
  if (!doc) return false;
  if (doc.isDeleted) return false;
  if (doc.deletedAt) return false;
  return doc.status !== REJECTED_STATUS;
}

function createdAtMs(doc: CountingDocumentLike): number {
  if (!doc.createdAt) return 0;
  const ms = doc.createdAt instanceof Date ? doc.createdAt.getTime() : new Date(doc.createdAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export interface SlotPick<T extends CountingDocumentLike> {
  /** Newest counting document; when none counts, the newest rejected (not deleted) document so the UI can show "rejected"; else null. */
  slot: T | null;
  /** Older counting documents (pre-change data with several Inwards / Dumps per source). */
  legacy: T[];
  /** All counting documents, newest first. */
  counting: T[];
}

/** Newest counting document is the slot, older counting ones are legacy. */
export function pickSlotAndLegacy<T extends CountingDocumentLike>(docs: T[]): SlotPick<T> {
  const live = (docs ?? []).filter((d) => d && !d.isDeleted && !d.deletedAt);
  const byNewest = [...live].sort((a, b) => createdAtMs(b) - createdAtMs(a));
  const counting = byNewest.filter((d) => d.status !== REJECTED_STATUS);
  if (counting.length > 0) {
    return { slot: counting[0], legacy: counting.slice(1), counting };
  }
  const rejected = byNewest.find((d) => d.status === REJECTED_STATUS) ?? null;
  return { slot: rejected, legacy: [], counting: [] };
}

/** Arrivals chip for a slot. */
export function slotState(slot: CountingDocumentLike | null): SlotState {
  if (!slot) return 'missing';
  if (slot.status === REJECTED_STATUS) return 'rejected';
  if (slot.status === COMPLETE_STATUS) return 'approved';
  return 'pending';
}

export interface ValidateContext {
  /** Needed for R7 (RTV only for GRN). */
  sourceType?: ReceivingSourceType | null;
  /** Source number used in messages, e.g. `GRN-00012`. */
  sourceNo?: string | null;
}

function formatKg(value: number): string {
  const rounded = round3(value);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * Rules R4, R5 and R7 of docs/receiving-links-plan.md §2.2. Returns the list
 * of error messages (empty when the lines are valid).
 *
 * - R4: lines equal the source product + variant set exactly, each once,
 *   kg ≥ 0, and at least one kg > 0 for inward / dump / rtv.
 * - R5: per line `kg + consumedByOthers ≤ basis`, basis = the AQR's arrived
 *   kg when an AQR counts (`source.arrivedKg`), otherwise the source kg.
 *   AQR: `consumedByOthers ≤ arrived ≤ receivedKg`; AQR kg is never consumed.
 * Lines are matched to the source by product + variant + unit
 * ({@link matchSourceKey}).
 * - R7: RTV only for GRN sources.
 */
export function validateLinesAgainstSource(
  docType: ProcessingDocType,
  sourceAgg: Map<string, AggregatedSourceLine>,
  lines: GuardLine[],
  consumedByOthers: Map<string, number>,
  context: ValidateContext = {},
): string[] {
  const errors: string[] = [];
  const sourceNo = context.sourceNo && String(context.sourceNo).trim() ? String(context.sourceNo).trim() : 'the source';

  if (docType === 'rtv' && context.sourceType && context.sourceType !== 'grn') {
    errors.push('Return To Vendor can only be raised against a GRN');
    return errors;
  }

  const label = (key: string, fallbackProductId?: string | null, fallbackVariantId?: string | null): string => {
    const source = sourceAgg.get(key);
    if (source) return productLabel(source.productName, source.variantName);
    // Same product under another (or no) variant: we still know its name.
    let productName: string | null = null;
    sourceAgg.forEach((line) => {
      if (productName == null && fallbackProductId && line.productId === fallbackProductId && line.productName) {
        productName = line.productName;
      }
    });
    return productLabel(
      productName ?? (fallbackProductId ? `product ${fallbackProductId}` : null),
      fallbackVariantId ? `variant ${fallbackVariantId}` : null,
    );
  };

  if (!Array.isArray(lines) || lines.length === 0) {
    errors.push(`Add one line per product of ${sourceNo}`);
    return errors;
  }

  const seen = new Set<string>();
  const kgByKey = new Map<string, number>();
  let anyPositive = false;

  for (const line of lines) {
    if (!line || !line.productId) {
      errors.push('Every line needs a product');
      continue;
    }
    const variantId = line.variantId ? line.variantId : null;
    const key = matchSourceKey(sourceAgg, line.productId, variantId, line.uomId ?? null, line.batchNo ?? null);
    if (seen.has(key)) {
      errors.push(`${label(key, line.productId, variantId)} is listed more than once`);
      continue;
    }
    seen.add(key);

    if (!sourceAgg.has(key)) {
      errors.push(`${label(key, line.productId, variantId)} is not part of ${sourceNo}`);
      continue;
    }

    const raw = line.kg;
    const kg = raw === null || raw === undefined || raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(kg)) {
      errors.push(`Enter a valid quantity for ${label(key)}`);
      continue;
    }
    if (kg < 0) {
      errors.push(`Quantity for ${label(key)} cannot be negative`);
      continue;
    }
    if (kg > 0) anyPositive = true;
    kgByKey.set(key, kg);
  }

  sourceAgg.forEach((source, key) => {
    if (!seen.has(key)) {
      errors.push(`${productLabel(source.productName, source.variantName)} from ${sourceNo} is missing from the lines`);
    }
  });

  if (docType !== 'aqr' && !anyPositive && errors.length === 0) {
    errors.push('Enter a quantity greater than 0 for at least one product');
  }

  // R5 — per-product cap. The basis is what arrived (AQR) once an AQR counts,
  // otherwise what the source sent.
  kgByKey.forEach((kg, key) => {
    const source = sourceAgg.get(key);
    if (!source) return;
    const consumed = consumedByOthers.get(key) ?? 0;
    if (docType === 'aqr') {
      // Arrived kg: not more than was sent, not less than Inward + Dump + RTV already record.
      if (round3(kg) > round3(source.receivedKg)) {
        errors.push(
          `Only ${formatKg(source.receivedKg)} kg of ${label(key)} was sent on ${sourceNo}; you entered ${formatKg(kg)} kg arrived`,
        );
      } else if (round3(kg) < round3(consumed)) {
        errors.push(
          `Inward / Dump / RTV already account for ${formatKg(consumed)} kg of ${label(key)} on ${sourceNo}; arrived kg cannot be lower`,
        );
      }
      return;
    }
    const arrived = source.arrivedKg ?? null;
    const basis = arrived !== null ? arrived : source.receivedKg;
    const available = round3(basis - consumed);
    if (round3(kg) > available) {
      const left = formatKg(available < 0 ? 0 : available);
      errors.push(
        arrived !== null
          ? `Only ${left} kg of the ${formatKg(arrived)} kg of ${label(key)} that arrived on ${sourceNo} is unaccounted for; you entered ${formatKg(kg)} kg`
          : `Only ${left} kg of ${label(key)} is unaccounted for ${sourceNo}; you entered ${formatKg(kg)} kg`,
      );
    }
  });

  return errors;
}

/**
 * R11 — a source (GRN, Transfer DC, RBC) may list each product + variant +
 * unit once (Mango in Box and Mango in kg are two lines).
 * Returns the human-readable message or null when there are no duplicates.
 * Lines without a product are ignored (the caller's own validation handles those).
 */
export function findDuplicateLines(lines: DuplicateLineInput[]): string | null {
  const firstIndex = new Map<string, number>();
  const duplicates: string[] = [];
  (lines ?? []).forEach((line, index) => {
    if (!line || !line.productId) return;
    const key = productKey(line.productId, line.variantId ? line.variantId : null, line.uomId ?? null);
    const seenAt = firstIndex.get(key);
    if (seenAt === undefined) {
      firstIndex.set(key, index);
    } else {
      duplicates.push(`rows ${seenAt + 1} and ${index + 1}`);
    }
  });
  if (duplicates.length === 0) return null;
  return `The same product, variant and unit is listed more than once (${duplicates.join(', ')}); merge the rows`;
}

/** Strips a possibly-object id reference (`'id'` or `{ id }`) down to the id string. */
export function refId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'id' in (value as Record<string, unknown>)) {
    const id = (value as Record<string, unknown>).id;
    return id === null || id === undefined || id === '' ? null : String(id);
  }
  return null;
}

/** Rounds money to 2 decimals. */
export function round2(value: number): number {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export interface SourcePricedLine {
  uomId: string | null;
  /** The source line's own batch (transfer lines); null otherwise. */
  batchNo: string | null;
  unitPrice: number | null;
  quantity: number;
  amount: number;
}

/**
 * Unit, price and amount of one Inward / Dump / RTV line, taken from the
 * source line of the same product + variant. The unit and unit price are the
 * source's (the user cannot change them); the quantity is the user's, in that
 * unit, and the amount is always `quantity × unit price`. Without a matching
 * source line (legacy rows) the line's own values are kept.
 *
 * Returns an error message when the quantity exceeds the source quantity.
 */
export function priceLineFromSource(
  products: AggregatedSourceLine[],
  line: { productId: string | null | undefined; variantId?: string | null; uomId?: string | null; batchNo?: string | null; unitPrice?: number | string | null; quantity?: number | string | null },
  sourceNo?: string | null,
): { line: SourcePricedLine; error: string | null } {
  const quantity = round3(toKg(line.quantity));
  const byKey = new Map(products.map((p) => [p.key, p]));
  const source = line.productId
    ? byKey.get(matchSourceKey(byKey, line.productId, line.variantId ?? null, line.uomId ?? null, line.batchNo ?? null))
    : undefined;
  if (!source) {
    const unitPrice = line.unitPrice != null && line.unitPrice !== '' ? Number(line.unitPrice) : null;
    return {
      line: { uomId: line.uomId ?? null, batchNo: line.batchNo ?? null, unitPrice, quantity, amount: round2(quantity * (unitPrice ?? 0)) },
      error: null,
    };
  }
  const unitPrice = source.unitPrice ?? (line.unitPrice != null && line.unitPrice !== '' ? Number(line.unitPrice) : null);
  let error: string | null = null;
  const arrivedQty = source.arrivedQty ?? null;
  const capQty = arrivedQty !== null ? arrivedQty : source.receivedQty;
  if (capQty > 0 && quantity > capQty) {
    const unit = source.uomName ? ` ${source.uomName}` : '';
    const where = arrivedQty !== null ? 'that arrived' : `on ${sourceNo ?? 'the source'}`;
    error = `${productLabel(source.productName, source.variantName)}: quantity ${quantity}${unit} is more than the ${capQty}${unit} ${where}`;
  }
  return {
    line: { uomId: source.uomId ?? line.uomId ?? null, batchNo: source.batchNo ?? null, unitPrice, quantity, amount: round2(quantity * (unitPrice ?? 0)) },
    error,
  };
}

/**
 * True when the source line is counted in kg (its quantity equals its net kg,
 * or it has no quantity): units and kg are then the same number.
 */
export function isKgCounted(source: Pick<AggregatedSourceLine, 'receivedQty' | 'receivedKg'>): boolean {
  return !(source.receivedQty > 0) || round3(source.receivedQty) === round3(source.receivedKg);
}

export interface TransitLoss {
  /** sent − arrived kg (negative = excess) */
  lossKg: number;
  /** sent − arrived units; null when the arrived units are unknown (counted lines) */
  lossQty: number | null;
  /** lost units × unit price (kg lines: lost kg × unit price); null when not computable */
  lossValue: number | null;
}

/**
 * Transport loss of one source line from what arrived. For lines counted in
 * kg the units follow the kg. For counted units (boxes, crates …) the value
 * needs the arrived units: weight loss alone (a lighter box) has no value.
 */
export function transitLoss(
  source: Pick<AggregatedSourceLine, 'receivedQty' | 'receivedKg' | 'unitPrice'>,
  arrivedKg: number,
  arrivedQty: number | null | undefined,
): TransitLoss {
  const lossKg = round3(source.receivedKg - arrivedKg);
  const price = source.unitPrice ?? null;
  if (isKgCounted(source)) {
    return { lossKg, lossQty: lossKg, lossValue: price === null ? null : round2(lossKg * price) };
  }
  if (arrivedQty === null || arrivedQty === undefined) {
    return { lossKg, lossQty: null, lossValue: null };
  }
  const lossQty = round3(source.receivedQty - arrivedQty);
  return { lossKg, lossQty, lossValue: price === null ? null : round2(lossQty * price) };
}
