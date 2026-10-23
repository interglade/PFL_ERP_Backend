import { AddressPayload } from '../../transport/transport.utils';
import { DispatchType } from '../entity/vehicleDispatch.entity';
import { NamedRef, ResolvedSource, SourceLine, SourceTotals } from '../service/dispatchSource';
import { Source } from '../../utils/status.enum';

// ─── Requests ────────────────────────────────────────────────────────────────

/** Fields the form can change. Product rows are never sent: they are copied from the source. */
export interface DispatchWritableFields {
  date?: string | null;            // "YYYY-MM-DD"
  batchNo?: string | null;
  transporterId?: string | null;
  vehicleId?: string | null;
  driverId?: string | null;
  outDate?: string | null;         // "YYYY-MM-DD", required when outTime is given
  outTime?: string | null;         // "HH:mm" or "HH:mm:ss"
  expectedReachingDate?: string | null; // "YYYY-MM-DD", required when reachingTime is given
  reachingTime?: string | null;    // expected reaching time
  receivingPerson?: string | null;
  remarksPFL?: string | null;
  /** Sales, and purchase delivered direct to a customer. */
  customerId?: string | null;
  /** Optional typed address; when empty the customer's registered delivery address is used. */
  currentShippingAddress?: Partial<AddressPayload> | null;
}

export interface CreateVehicleDispatchDto extends DispatchWritableFields {
  dispatchType: DispatchType;
  sourceId: string;
  // Injected by the controller
  requestedBy?: string;
}

export type UpdateVehicleDispatchDto = DispatchWritableFields;

// ─── Responses ───────────────────────────────────────────────────────────────

/** One row of GET /vehicleDispatches and /recyclebin */
export interface VehicleDispatchListItemDto {
  /** The GRN (purchase) or delivery challan (transfer / sales) the dispatch is for. */
  sourceId?: string | null;
  documentId: string;
  overAllStatus: string;
  createdBy: string;
  createdDate: string | null;
  createdTime: string | null;
  id: string | null;
  dispatchType: DispatchType | null;
  vehicleDispatchNo: string | null;
  date: Date | string | null;
  batchNo: string | null;
  sourceNo: string | null;
  companyName: string | null;
  fromName: string | null;
  toName: string | null;
  vehicleNo: string | null;
  vehicleType: string | null;
  driverName: string | null;
  driverMobNo: string | null;
  transporterName: string | null;
  totalNetWeight: number | null;
  outDate: string | null;
  outTime: string | null;
  expectedReachingDate: string | null;
  reachingTime: string | null;
  arrivedAt: Date | string | null;
}

/** GET /vehicleDispatches/view/:docid */
export interface VehicleDispatchViewDto extends VehicleDispatchListItemDto {
  approvalSummary: unknown;
  sourceId: string | null;
  sourceDocumentId: string | null;
  source: Source | null;
  party: (NamedRef & { type: Source }) | null;
  fromLocation: NamedRef | null;
  fromText: string | null;
  toLocation: NamedRef | null;
  customer: NamedRef | null;
  registeredShippingAddress: string | null;
  shippingAddress: AddressPayload | null;
  usesCurrentShippingAddress: boolean;
  transporterContact: string | null;
  vehicleCapacityKg: number | null;
  driverAltMobNo: string | null;
  licenseNo: string | null;
  receivingPerson: string | null;
  remarksPFL: string | null;
  products: SourceLine[];
  totals: SourceTotals;
  arrivedBy: string | null;
  /** Dispatch created before the three registers existed (no source lines copied). */
  isLegacy: boolean;
  /** Approval status of the source document. */
  sourceStatus: string | null;
  /** Why the dispatch cannot be approved yet (source not COMPLETE, rejected or deleted); null when it can. */
  approvalBlockedReason: string | null;
  /** Set when the dispatch was rejected automatically because its source was rejected or deleted. */
  autoRejectedReason: string | null;
  clientName: string | null;
  clientAddress: string | null;
}

/** GET /vehicleDispatches/update/:id */
export interface VehicleDispatchUpdateFormDto {
  id: string;
  dispatchType: DispatchType;
  sourceId: string | null;
  sourceNo: string | null;
  date: Date | string | null;
  batchNo: string | null;
  transporterId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  outDate: string | null;
  outTime: string | null;
  expectedReachingDate: string | null;
  reachingTime: string | null;
  receivingPerson: string | null;
  remarksPFL: string | null;
  customerId: string | null;
  currentShippingAddress: AddressPayload | null;
  /** Read-only parts for display, taken from the stored dispatch. */
  display: ResolvedSource;
}

/** GET /vehicleDispatches/by-source/:dispatchType/:sourceId */
export interface DispatchSummaryDto {
  id: string;
  documentId: string | null;
  vehicleDispatchNo: string | null;
  status: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  transporterName: string | null;
  totalNetWeight: number | null;
  outDate: string | null;
  outTime: string | null;
  expectedReachingDate: string | null;
  reachingTime: string | null;
  arrivedAt: Date | string | null;
}
