/**
 * What a Deal Slip edit may change (client rules R4 / D4 / D6 / D7, docs/rfpa-deal-slip-sync-plan.md):
 *  - header: lotNo, loadingLocation (both required), specialRequest, remark
 *  - on the product lines copied from the RFPA (matched by id; none added or removed): uom, quantity,
 *    unitPrice and the four dates. Product, variant and grade stay as copied.
 * Everything else the request carries is rejected with 400, except meta keys the edit form echoes back.
 * Pure: the service loads the slip and applies the returned plan.
 */
import AppError from '../utils/appError';

export const EDITABLE_HEADER_FIELDS = ['lotNo', 'loadingLocation', 'specialRequest', 'remark'] as const;
export const EDITABLE_LINE_FIELDS = [
  'uom', 'quantity', 'unitPrice', 'purchaseDate', 'dispatchDate', 'deliveryDate', 'expectedHarvestDate',
] as const;
/** Copied from the RFPA; accepted only when the value sent equals the stored one. */
const LOCKED_LINE_FIELDS = ['productName', 'variant', 'grade'] as const;

/** Read-only keys the edit form gets from GET /dealSlip/:id/update and may send back unchanged. */
const IGNORED_HEADER_KEYS = new Set([
  'id', 'dealSlipNo', 'rfpa', 'documentId', 'overAllStatus', 'createdBy', 'createdDate', 'createdTime',
  'approvalSummary', 'approvalStatus', 'approvalNote', 'dealSlipCreatedAt', 'dealSlipApprovedAt',
]);
const IGNORED_LINE_KEYS = new Set(['id', 'amount', 'rfpaQuantity', 'rfpaUnitPrice', 'rfpaUom']);

type LineDateField = 'purchaseDate' | 'dispatchDate' | 'deliveryDate' | 'expectedHarvestDate';

/** A stored line, reduced to the values the rules look at (relation values as ids). */
export interface DealSlipLineState {
  id: string;
  productName: string | null;
  variant: string | null;
  grade: string | null;
  uom: string | null;
  quantity: number;
  unitPrice: number;
  purchaseDate: string | null;
  dispatchDate: string | null;
  deliveryDate: string | null;
  expectedHarvestDate: string | null;
}

export interface DealSlipState {
  source: string | null;
  lotNo: string | null;
  loadingLocation: string | null;
  specialRequest: string | null;
  remark: string | null;
  lines: DealSlipLineState[];
}

export interface DealSlipEditPlan {
  header: Partial<Record<(typeof EDITABLE_HEADER_FIELDS)[number], string>>;
  /** Resulting values of every line that the request touched. */
  lines: DealSlipLineState[];
  /** Uom ids the lines end up with; the caller checks they exist. */
  uomIds: string[];
}

const fail = (message: string): never => {
  throw new AppError(400, message);
};

const refId = (value: any): string | null => {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'object' ? value.id ?? null : String(value);
};

/** 'yyyy-MM-dd' (dd-MM-yyyy and ISO timestamps accepted); '' / null -> null. */
export function toDateOnly(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fail('Invalid date') : value.toISOString().slice(0, 10);
  const text = String(value).trim();
  const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return iso ? iso[1] : fail(`Invalid date: ${text}`);
}

const textOf = (value: any): string => (value === null || value === undefined ? '' : String(value));

/** Line rules on the resulting values (same rules as the RFPA form). */
export function validateDealSlipLine(line: DealSlipLineState, source: string | null, position: number): void {
  const at = `Product line ${position}`;
  if (!line.uom) fail(`${at}: unit is required`);
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) fail(`${at}: quantity must be a whole number greater than 0`);
  if (!Number.isFinite(line.unitPrice) || line.unitPrice <= 0) fail(`${at}: unit price must be greater than 0`);
  if (!line.purchaseDate) fail(`${at}: purchase date is required`);
  if (!line.dispatchDate) fail(`${at}: dispatch date is required`);
  if (!line.deliveryDate) fail(`${at}: expected delivery date is required`);
  if (source === 'farmer' && !line.expectedHarvestDate) fail(`${at}: expected harvest date is required`);
  // yyyy-MM-dd strings compare correctly as text.
  if (line.expectedHarvestDate && line.purchaseDate! <= line.expectedHarvestDate) {
    fail(`${at}: purchase date must be after the expected harvest date`);
  }
  if (line.dispatchDate! < line.purchaseDate!) fail(`${at}: dispatch date must be on or after the purchase date`);
  if (line.deliveryDate! < line.dispatchDate!) fail(`${at}: expected delivery date must be on or after the dispatch date`);
}

/** Validates an edit request against the slip's current state and returns what to save. Throws AppError(400). */
export function planDealSlipEdit(body: Record<string, any>, current: DealSlipState): DealSlipEditPlan {
  const locked = Object.keys(body ?? {}).filter(
    (key) => !IGNORED_HEADER_KEYS.has(key) && key !== 'dealSlipProducts' && !(EDITABLE_HEADER_FIELDS as readonly string[]).includes(key),
  );

  const header: DealSlipEditPlan['header'] = {};
  for (const field of EDITABLE_HEADER_FIELDS) {
    if (body[field] !== undefined) header[field] = textOf(body[field]).trim();
  }

  const lineEdits = body.dealSlipProducts;
  if (lineEdits !== undefined && !Array.isArray(lineEdits)) fail('dealSlipProducts must be a list');

  const byId = new Map(current.lines.map((line) => [line.id, line]));
  const touched = new Map<string, DealSlipLineState>();
  (lineEdits ?? []).forEach((edit: Record<string, any>, index: number) => {
    if (!edit?.id) fail('Product lines cannot be added to a Deal Slip; every line needs the id of an existing line');
    const stored = byId.get(edit.id) ?? fail(`Product line ${edit.id} does not belong to this Deal Slip`);
    if (touched.has(edit.id)) fail(`Product line ${edit.id} is sent more than once`);

    for (const key of Object.keys(edit)) {
      if (IGNORED_LINE_KEYS.has(key) || (EDITABLE_LINE_FIELDS as readonly string[]).includes(key)) continue;
      const isLockedField = (LOCKED_LINE_FIELDS as readonly string[]).includes(key);
      const unchanged =
        isLockedField &&
        (key === 'grade' ? textOf(edit[key]) === textOf(stored.grade) : refId(edit[key]) === (stored as any)[key]);
      if (!unchanged) locked.push(`dealSlipProducts[${index}].${key}`);
    }

    const next: DealSlipLineState = { ...stored };
    if (edit.uom !== undefined) next.uom = refId(edit.uom);
    if (edit.quantity !== undefined) next.quantity = Number(edit.quantity);
    if (edit.unitPrice !== undefined) next.unitPrice = Number(edit.unitPrice);
    for (const field of ['purchaseDate', 'dispatchDate', 'deliveryDate', 'expectedHarvestDate'] as LineDateField[]) {
      if (edit[field] !== undefined) next[field] = toDateOnly(edit[field]);
    }
    touched.set(edit.id, next);
  });

  if (locked.length) fail(`${locked.join(', ')} cannot be changed on a Deal Slip`);

  if (!(header.lotNo ?? textOf(current.lotNo).trim()) || !(header.loadingLocation ?? textOf(current.loadingLocation).trim())) {
    fail('Lot no and loading location are required to submit the Deal Slip');
  }

  // Every line is checked on its resulting values, so a slip can only be submitted complete.
  current.lines.forEach((line, index) => validateDealSlipLine(touched.get(line.id) ?? line, current.source, index + 1));

  const lines = [...touched.values()];
  return { header, lines, uomIds: [...new Set(lines.map((l) => l.uom).filter((id): id is string => !!id))] };
}
