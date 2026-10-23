/**
 * Receiving links — shared types (docs/receiving-links-plan.md §2.2).
 *
 * A *source* is a document that brings goods to a CC/DC: a GRN, a Stock
 * Transfer DC or a Return By Customer. A *processing document* is one of the
 * four documents raised against a source: AQR, Inward Register, Dump Register
 * and Return To Vendor. Lines are matched by product + variant; the unit is
 * net kg.
 */

import { EntityManager } from 'typeorm';

export type ReceivingSourceType = 'grn' | 'stock-transfer-dc' | 'rbc';
export type ProcessingDocType = 'aqr' | 'inward' | 'dump' | 'rtv';

export const RECEIVING_SOURCE_TYPES: ReceivingSourceType[] = ['grn', 'stock-transfer-dc', 'rbc'];
export const PROCESSING_DOC_TYPES: ProcessingDocType[] = ['aqr', 'inward', 'dump', 'rtv'];

export type ReceivingState = 'not-received' | 'not-started' | 'open' | 'done' | 'legacy';
export const RECEIVING_STATES: ReceivingState[] = ['not-received', 'not-started', 'open', 'done', 'legacy'];

export type PartyType = 'vendor' | 'farmer' | 'customer' | 'branch' | null;

/**
 * Vehicle dispatch of a source (docs/vehicle-dispatch-plan.md §3.2): purchase
 * dispatches for GRNs, stock transfer dispatches for transfer DCs. Informational
 * only - receiving never waits for it.
 */
export type DispatchState = 'none' | 'in-transit' | 'arrived';
export const DISPATCH_STATES: DispatchState[] = ['none', 'in-transit', 'arrived'];

export interface DispatchSummary {
  id: string;
  dispatchNo: string | null;
  /** `documents.id` of the dispatch (detail route key). */
  documentId: string | null;
  status: string | null;
  vehicleNo: string | null;
  vehicleType: string | null;
  driverName: string | null;
  driverMobNo: string | null;
  transporterName: string | null;
  outTime: string | null;
  reachingTime: string | null;
  arrivedAt: Date | string | null;
  netWeightKg: number | null;
}

/** How a processing slot is shown on the Arrivals list (`skipped`: no document, step marked not needed). */
export type SlotState = 'missing' | 'pending' | 'approved' | 'rejected' | 'skipped';

/** Steps that can be marked "not needed" for a source (docs/receiving-links-plan.md; Phase D-8). */
export type SkippableDocType = 'dump' | 'rtv';
export const SKIPPABLE_DOC_TYPES: SkippableDocType[] = ['dump', 'rtv'];

/** Which optional steps were marked "not needed" (server-side, table `receiving_skip`). */
export interface SkipFlags {
  dump: boolean;
  rtv: boolean;
}

export interface Slot {
  id: string;
  docNo: string | null;
  documentId: string | null;
  /** `documents.status` (hold, VERIFIED, approved, FINALIZING, COMPLETE, REJECT) or null when no `documents` row exists. */
  status: string | null;
  createdAt: Date | string | null;
}

export interface ReceivingSourceInfo {
  type: ReceivingSourceType;
  id: string;
  no: string | null;
  /** The source's `documents.id` (detail routes are keyed by it), or null when no `documents` row exists. */
  documentId: string | null;
  approvalStatus: string | null;
  isComplete: boolean;
  deliveryMode: string | null;
  companyId: string | null;
  companyName: string | null;
  /** Receiving CC/DC: GRN purchaseForSalesLocation, DC toLocation, RBC location. */
  locationId: string | null;
  locationName: string | null;
  fromLocationId: string | null;
  fromLocationName: string | null;
  partyType: PartyType;
  partyId: string | null;
  partyName: string | null;
  date: Date | string | null;
  /** Batch number typed on the GRN; null for Transfer DC / RBC sources (no batch yet). */
  batchNo: string | null;
}

export interface SuggestedKg {
  inwardKg: number;
  dumpKg: number;
  rtvKg: number;
}

export interface ReceivingProductRow {
  /** `${productId}:${variantId ?? 'null'}:${uomId ?? 'null'}` */
  key: string;
  productId: string;
  productName: string | null;
  variantId: string | null;
  variantName: string | null;
  uomId: string | null;
  uomName: string | null;
  /** Batch of the line (transfer lines carry the batch the Transfer DC took); null when the source has one header batch. */
  batchNo: string | null;
  unitPrice: number | null;
  /** Source quantity in the source line's unit (boxes, crates, kg, …). This is what was sent. */
  receivedQty: number;
  /** Source gross weight (kg). */
  receivedGrossKg: number;
  /** Source net kg (what was sent). */
  receivedKg: number;
  /** Net kg that arrived, from the AQR; null until an AQR counts. */
  arrivedKg: number | null;
  /** Units that arrived, from the AQR; null until an AQR records them. */
  arrivedQty: number | null;
  sampleKg: number | null;
  inwardKg: number;
  dumpKg: number;
  rtvKg: number;
  /** Kg to account for: arrivedKg when an AQR counts, otherwise receivedKg. */
  basisKg: number;
  /** basisKg − inwardKg − dumpKg − rtvKg (may be negative on legacy data). */
  differenceKg: number;
  /** Lost in transport: receivedKg − arrivedKg (negative = excess); null until an AQR counts. */
  transitLossKg: number | null;
  /** Lost in transport in units: receivedQty − arrivedQty; null when no arrived units. */
  transitLossQty: number | null;
  /** Value of the transit loss: lost units × unit price (kg lines: lost kg × unit price). */
  transitLossValue: number | null;
  suggested: SuggestedKg;
  /** Net kg loaded on the vehicle dispatch for this product, when a dispatch exists (AQR arrived-kg prefill). */
  dispatchedKg?: number | null;
}

export interface ProcessingSlots {
  aqr: Slot | null;
  inward: Slot | null;
  dump: Slot | null;
  rtv: Slot | null;
}

export interface LegacyDocuments {
  aqr: Slot[];
  inward: Slot[];
  dump: Slot[];
  rtv: Slot[];
}

export interface ReceivingSourceStatus {
  source: ReceivingSourceInfo;
  state: ReceivingState;
  /** true for GRN only */
  rtvApplicable: boolean;
  slots: ProcessingSlots;
  /** Extra counting documents beyond the slot (pre-change data). */
  legacyDocuments: LegacyDocuments;
  products: ReceivingProductRow[];
  /** Live vehicle dispatch of the source, or null (always null for RBC). */
  dispatch: DispatchSummary | null;
  dispatchState: DispatchState;
  /** False for returns and for GRNs / Transfer DCs created before the dispatch go-live date. */
  dispatchRequired: boolean;
  /** Receiving may start: source COMPLETE and, when required, its dispatch COMPLETE. */
  canReceive: boolean;
  /** Why receiving cannot start yet (empty when it can). */
  blockers: string[];
  /** Optional steps marked "not needed". Informational: `done` still needs an Inward and every difference 0. */
  skipped: SkipFlags;
}

export interface ArrivalSlotStates {
  aqr: SlotState;
  inward: SlotState;
  dump: SlotState;
  rtv: SlotState | null;
}

export interface ArrivalRow {
  sourceType: ReceivingSourceType;
  sourceId: string;
  sourceNo: string | null;
  documentId: string | null;
  companyName: string | null;
  locationId: string | null;
  locationName: string | null;
  partyName: string | null;
  date: Date | string | null;
  productCount: number;
  receivedKg: number;
  differenceKg: number;
  /** Σ transit loss kg of the products (sent − arrived); null until an AQR counts. */
  transitLossKg: number | null;
  /** Σ transit loss value; null when no product's loss can be valued. */
  transitLossValue: number | null;
  state: ReceivingState;
  slots: ArrivalSlotStates;
  dispatch: DispatchSummary | null;
  dispatchState: DispatchState;
  dispatchRequired: boolean;
  canReceive: boolean;
  blockers: string[];
  skipped: SkipFlags;
}

export type ArrivalReadiness = 'ready' | 'blocked';
export const ARRIVAL_READINESS: ArrivalReadiness[] = ['ready', 'blocked'];

export interface ArrivalsFilter {
  locationId?: string;
  /** One or more states (`state=not-started,open`). */
  state?: ReceivingState | ReceivingState[];
  sourceType?: ReceivingSourceType | ReceivingSourceType[];
  /** yyyy-MM-dd (inclusive) */
  startDate?: string;
  /** yyyy-MM-dd (inclusive) */
  endDate?: string;
  /** Matches the source number and the party name (ILIKE). */
  search?: string;
  dispatchState?: DispatchState;
  /** `ready`: receiving may start; `blocked`: the vehicle dispatch is missing or not approved. */
  readiness?: ArrivalReadiness;
  page?: number;
  limit?: number;
  /** `field:asc|desc`; fields: date, sourceNo, partyName, locationName, companyName, receivedKg, productCount. Default `date:desc`. */
  sort?: string;
}

export interface ArrivalsResult {
  data: ArrivalRow[];
  total: number;
  page: number;
  totalPages: number;
}

// ─── Pure-helper inputs ──────────────────────────────────────────────────────

/** A line of a source document (GRN product, DC item, RBC returned product). */
export interface SourceLineInput {
  productId: string | null | undefined;
  productName?: string | null;
  variantId?: string | null;
  variantName?: string | null;
  uomId?: string | null;
  uomName?: string | null;
  unitPrice?: number | string | null;
  /** quantity of this line in its own unit (boxes, crates, kg, …) */
  qty?: number | string | null;
  /** Batch of this line when it differs per line (a Transfer DC line split over the batches it took). */
  batchNo?: string | null;
  /** gross kg of this line */
  grossKg?: number | string | null;
  /** received net kg of this line */
  kg: number | string | null | undefined;
}

export interface AggregatedSourceLine {
  key: string;
  productId: string;
  productName: string | null;
  variantId: string | null;
  variantName: string | null;
  uomId: string | null;
  uomName: string | null;
  unitPrice: number | null;
  receivedQty: number;
  receivedGrossKg: number;
  receivedKg: number;
  /** Batch of this source line (transfer lines); null when the source has one header batch. */
  batchNo: string | null;
  /** Set by the guard when a counting AQR exists: what arrived (kg / units). */
  arrivedKg?: number | null;
  arrivedQty?: number | null;
}

/** A line of a processing document. */
export interface DocLineInput {
  productId: string | null | undefined;
  productName?: string | null;
  variantId?: string | null;
  variantName?: string | null;
  uomId?: string | null;
  batchNo?: string | null;
  /** quantity in the line's unit (AQR: arrived units) */
  qty?: number | string | null;
  kg: number | string | null | undefined;
  /** AQR only */
  sampleKg?: number | string | null;
  /** Dump only: true when the row has no net weight (legacy count-only row). */
  legacy?: boolean;
}

export interface AggregatedDocLine {
  key: string;
  productId: string;
  productName: string | null;
  variantId: string | null;
  variantName: string | null;
  kg: number;
  /** Sum of the line quantities; null when no line carries one. */
  qty: number | null;
  sampleKg: number;
  legacy: boolean;
}

/** What a caller submits for validation: one entry per product + variant + unit. */
export interface GuardLine {
  productId: string | null | undefined;
  variantId?: string | null;
  uomId?: string | null;
  batchNo?: string | null;
  kg: number | string | null | undefined;
}

export interface CountingDocumentLike {
  id: string;
  status: string | null;
  isDeleted?: boolean | null;
  deletedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

// ─── Guard ───────────────────────────────────────────────────────────────────

export interface ResolveAndAssertInput {
  docType: ProcessingDocType;
  sourceType: ReceivingSourceType | null | undefined;
  sourceId: string | null | undefined;
  lines: GuardLine[];
  /** The document being edited; its own lines are not counted against the cap and it does not trigger the one-per-source rule. */
  excludeDocId?: string | null;
  /** Transaction manager of the caller. The source row is locked FOR UPDATE through it. */
  manager?: EntityManager;
}

export interface ResolvedSource {
  sourceType: ReceivingSourceType;
  sourceId: string;
  sourceNo: string | null;
  companyId: string | null;
  companyName: string | null;
  /** receiving CC/DC */
  locationId: string | null;
  locationName: string | null;
  /** transfer only */
  fromLocationId: string | null;
  fromLocationName: string | null;
  partyType: PartyType;
  partyId: string | null;
  partyName: string | null;
  batchNo: string | null;
  /** aggregated source lines (one per product + variant) */
  products: AggregatedSourceLine[];
}

export interface DuplicateLineInput {
  productId: string | null | undefined;
  variantId?: string | null;
  uomId?: string | null;
}
