/**
 * Pure helpers of the GRN edit rules (docs/grn-edit-rules-plan.md):
 *  - money totals are computed on the server (S2)
 *  - line changes are diffed for the history (S3)
 *  - approval restarts only when something actually changed (S1)
 */

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const idOf = (value: any): string | null => {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'object' ? value.id ?? null : String(value);
};
const dateOnly = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = String(value);
  const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
};
const textOrNull = (value: unknown): string | null =>
  value === null || value === undefined || value === '' ? null : String(value);

// ─── Totals (S2) ─────────────────────────────────────────────────────────────

/** Indian-system rupee words, the same wording the GRN form produced ("One Lakh Twenty Thousand Rupees"). */
export function amountInWords(amount: number): string {
  let n = Math.round(Math.abs(num(amount)));
  if (n === 0) return 'Zero Rupees';
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const scales = ['', 'Thousand', 'Lakh', 'Crore'];
  const chunkWords = (c: number): string => {
    const parts: string[] = [];
    if (c >= 100) {
      parts.push(`${ones[Math.floor(c / 100)]} Hundred`);
      c %= 100;
    }
    if (c >= 20) {
      parts.push(tens[Math.floor(c / 10)]);
      c %= 10;
    }
    if (c > 0) parts.push(ones[c]);
    return parts.join(' ');
  };
  const chunks: number[] = [n % 1000];
  n = Math.floor(n / 1000);
  while (n > 0) {
    chunks.push(n % 100);
    n = Math.floor(n / 100);
  }
  // Above crores the scale repeats (the form did the same): keep the last name.
  const words: string[] = [];
  chunks.forEach((chunk, index) => {
    if (!chunk) return;
    const scale = scales[Math.min(index, scales.length - 1)];
    words.unshift(scale ? `${chunkWords(chunk)} ${scale}` : chunkWords(chunk));
  });
  return `${words.join(' ')} Rupees`;
}

export interface GrnTotals {
  /** amount of each line, in the order given */
  lineAmounts: number[];
  subTotalAmt: number;
  totalAmt: number;
  amtWords: string;
  /** null when the GRN has no payment info */
  remainingAmt: number | null;
}

/** Line amount = quantity x unit price; total = subtotal + freight + other charges; remaining = total - advance. */
export function computeGrnTotals(input: {
  lines: Array<{ quantity?: unknown; unitPrice?: unknown }>;
  freight?: unknown;
  otherCharges?: unknown;
  advancePaidAmt?: unknown;
  hasPaymentInfo: boolean;
}): GrnTotals {
  const lineAmounts = input.lines.map((l) => round2(num(l.quantity) * num(l.unitPrice)));
  const subTotalAmt = round2(lineAmounts.reduce((sum, a) => sum + a, 0));
  const totalAmt = round2(subTotalAmt + num(input.freight) + num(input.otherCharges));
  return {
    lineAmounts,
    subTotalAmt,
    totalAmt,
    amtWords: amountInWords(totalAmt),
    remainingAmt: input.hasPaymentInfo ? round2(totalAmt - num(input.advancePaidAmt)) : null,
  };
}

// ─── Line history (S3) ───────────────────────────────────────────────────────

/** A GRN line reduced to what the history tracks (relations as ids). */
export interface GrnLineState {
  id: string;
  productId: string | null;
  variantId: string | null;
  uomId: string | null;
  quantity: number | null;
  unitPrice: number | null;
  grossWeight: number | null;
  packingMaterialWeight: number | null;
  netWeight: number | null;
  purchaseDate: string | null;
  dispatchDate: string | null;
  deliveryDate: string | null;
  expectedHarvestDate: string | null;
  packagingMaterialId: string | null;
}

/** Fields whose change writes a history row: quantity, rate, unit, weights, the four dates, packaging. */
export const TRACKED_LINE_FIELDS = [
  'quantity', 'unitPrice', 'uomId', 'grossWeight', 'packingMaterialWeight', 'netWeight',
  'purchaseDate', 'dispatchDate', 'deliveryDate', 'expectedHarvestDate', 'packagingMaterialId',
] as const;

export function toGrnLineState(line: any): GrnLineState {
  return {
    id: String(line.id),
    productId: idOf(line.productName),
    variantId: idOf(line.variant),
    uomId: idOf(line.uom),
    quantity: numOrNull(line.quantity),
    unitPrice: numOrNull(line.unitPrice),
    grossWeight: numOrNull(line.grossWeight),
    packingMaterialWeight: numOrNull(line.packingMaterialWeight),
    netWeight: numOrNull(line.netWeight),
    purchaseDate: dateOnly(line.purchaseDate),
    dispatchDate: dateOnly(line.dispatchDate),
    deliveryDate: dateOnly(line.deliveryDate),
    expectedHarvestDate: dateOnly(line.expectedHarvestDate),
    packagingMaterialId: idOf(line.packagingMaterial),
  };
}

export type LineChangeType = 'updated' | 'added' | 'removed';

export interface GrnLineChange {
  changeType: LineChangeType;
  before: GrnLineState | null;
  after: GrnLineState | null;
}

/** Lines matched by id: added (only after), removed (only before), updated (a tracked field differs). */
export function diffGrnLines(before: GrnLineState[], after: GrnLineState[]): GrnLineChange[] {
  const beforeById = new Map(before.map((l) => [l.id, l]));
  const afterIds = new Set(after.map((l) => l.id));
  const changes: GrnLineChange[] = [];
  for (const line of after) {
    const old = beforeById.get(line.id);
    if (!old) {
      changes.push({ changeType: 'added', before: null, after: line });
    } else if (TRACKED_LINE_FIELDS.some((field) => old[field] !== line[field])) {
      changes.push({ changeType: 'updated', before: old, after: line });
    }
  }
  for (const line of before) {
    if (!afterIds.has(line.id)) changes.push({ changeType: 'removed', before: line, after: null });
  }
  return changes;
}

// ─── Change detection (S1) ───────────────────────────────────────────────────

/** Header fields a user can change on a GRN (relations as ids). */
const HEADER_FIELDS = [
  'locationType', 'grnType', 'purchaseType', 'deliveryMode', 'securityPerson', 'specialReq',
  'otherPurchaseLoc', 'otherPurchaseForSalesLoc', 'source', 'billNo', 'billImage', 'purchasedBy',
  'approvalNote', 'timeIn', 'receivingPerson', 'rmn', 'remark', 'batchNo',
] as const;
const HEADER_NUMBERS = ['freight', 'otherCharges', 'cratesIn'] as const;
const HEADER_RELATIONS = [
  'companyName', 'purchaseInstructionsBy', 'purchaseLocation', 'purchaseForSalesLocation',
  'dealSlipId', 'selectedVendor', 'selectedFarmer',
] as const;
const PAYMENT_FIELDS = ['paymentMode', 'paymentTerms'] as const;
const PAYMENT_NUMBERS = ['advancePaidAmt', 'creditPeriod'] as const;
const PAYMENT_DATES = ['paymentDate', 'dueDate'] as const;

/**
 * What a user can change on a GRN, normalised so that the same data compares equal whatever its
 * runtime form (numeric strings, Date objects, relation objects). Calculated values (totals,
 * amounts, words, remaining amount) follow from these and are left out.
 */
export function grnEditSnapshot(grn: any): string {
  const header: Record<string, unknown> = {};
  for (const f of HEADER_FIELDS) header[f] = textOrNull(grn?.[f]);
  for (const f of HEADER_NUMBERS) header[f] = numOrNull(grn?.[f]);
  for (const f of HEADER_RELATIONS) header[f] = idOf(grn?.[f]);
  const payment = grn?.paymentInfo;
  const paymentState: Record<string, unknown> | null = payment
    ? Object.fromEntries([
        ...PAYMENT_FIELDS.map((f) => [f, textOrNull(payment[f])]),
        ...PAYMENT_NUMBERS.map((f) => [f, numOrNull(payment[f])]),
        ...PAYMENT_DATES.map((f) => [f, dateOnly(payment[f])]),
      ])
    : null;
  const lines = [...(grn?.grnProducts ?? [])]
    .map((l: any) => ({ ...toGrnLineState(l), grade: textOrNull(l.grade), rtv: Boolean(l.rtv) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ header, payment: paymentState, lines });
}
