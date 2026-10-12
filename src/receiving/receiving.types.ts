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

/** How a processing slot is shown on the Arrivals list. */
export type SlotState = 'missing' | 'pending' | 'approved' | 'rejected';

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
}

export interface SuggestedKg {
  inwardKg: number;
  dumpKg: number;
  rtvKg: number;
}

export interface ReceivingProductRow {
  /** `${productId}:${variantId ?? 'null'}` */
  key: string;
  productId: string;
  productName: string | null;
  variantId: string | null;
  variantName: string | null;
  uomId: string | null;
  uomName: string | null;
  unitPrice: number | null;
  receivedKg: number;
  arrivedKg: number | null;
  sampleKg: number | null;
  inwardKg: number;
  dumpKg: number;
  rtvKg: number;
  /** receivedKg − inwardKg − dumpKg − rtvKg (may be negative on legacy data). */
  differenceKg: number;
  suggested: SuggestedKg;
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
  state: ReceivingState;
  slots: ArrivalSlotStates;
}

export interface ArrivalsFilter {
  locationId?: string;
  state?: ReceivingState;
  sourceType?: ReceivingSourceType | ReceivingSourceType[];
  /** yyyy-MM-dd (inclusive) */
  startDate?: string;
  /** yyyy-MM-dd (inclusive) */
  endDate?: string;
  /** Matches the source number and the party name (ILIKE). */
  search?: string;
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
  receivedKg: number;
}

/** A line of a processing document. */
export interface DocLineInput {
  productId: string | null | undefined;
  productName?: string | null;
  variantId?: string | null;
  variantName?: string | null;
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
  sampleKg: number;
  legacy: boolean;
}

/** What a caller submits for validation: one entry per product + variant. */
export interface GuardLine {
  productId: string | null | undefined;
  variantId?: string | null;
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
  /** aggregated source lines (one per product + variant) */
  products: AggregatedSourceLine[];
}

export interface DuplicateLineInput {
  productId: string | null | undefined;
  variantId?: string | null;
}
