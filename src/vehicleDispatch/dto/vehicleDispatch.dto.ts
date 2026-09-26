// ─── Relation ref ────────────────────────────────────────────────────────────

export interface RelationRef {
  id: string;
}

// ─── Create DTO ───────────────────────────────────────────────────────────────

export class CreateVehicleDispatchDto {
  /** { id: companyId } */
  companyName: RelationRef;

  date: string; // "YYYY-MM-DD"

  vehicleType?: string | null;
  vehicleNo?: string | null;
  driverName?: string | null;
  driverMobNo?: string | null;
  paymentDiscussed?: number | null;

  outTime?: string | null;    // "HH:mm:ss"
  reachingTime?: string | null; // "HH:mm:ss"

  clientName: string;

  /** { id: addressId } — optional */
  clientAddress?: RelationRef | null;

  receivingPerson?: string | null;
  supervisorName?: string | null;
  accDeptVerification?: string | null;
  transportationBillAmt?: number | null;
  advancePaid?: number | null;
  remarksPFL?: string | null;
  feedbackbyTransporterOwner?: string | null;
  netInwardQty?: number | null;
  clientGRNNo?: string | null;
  paymentTerms?: string | null;

  /** { id: deliveryChallanId } — optional */
  deliveryChallanNo?: RelationRef | null;

  rejection?: string | null;
  shrinkageDump?: string | null;

  // Injected by controller — do not send from client
  requestedBy?: string;
  dcNo?: string | null;
}

// ─── Update DTO ───────────────────────────────────────────────────────────────

export class UpdateVehicleDispatchDto {
  companyName?: RelationRef | null;
  date?: string | null;
  vehicleType?: string | null;
  vehicleNo?: string | null;
  driverName?: string | null;
  driverMobNo?: string | null;
  paymentDiscussed?: number | null;
  outTime?: string | null;
  reachingTime?: string | null;
  clientName?: string | null;
  clientAddress?: RelationRef | null;
  receivingPerson?: string | null;
  supervisorName?: string | null;
  accDeptVerification?: string | null;
  transportationBillAmt?: number | null;
  advancePaid?: number | null;
  remarksPFL?: string | null;
  feedbackbyTransporterOwner?: string | null;
  netInwardQty?: number | null;
  clientGRNNo?: string | null;
  paymentTerms?: string | null;
  deliveryChallanNo?: RelationRef | null;
  rejection?: string | null;
  shrinkageDump?: string | null;
}

// ─── Query / GetAll DTO ───────────────────────────────────────────────────────

export class GetAllVehicleDispatchQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string; // "field:ASC" or "field:DESC"
  vehicleType?: string;
  vehicleNo?: string;
}

// ─── Response DTOs ────────────────────────────────────────────────────────────

export class ClientAddressDto {
  id?: string | null;
  address1?: string | null;
  address2?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

/** One row in the GET /vehicleDispatches paginated list */
export class VehicleDispatchListItemDto {
  documentId: string;
  overAllStatus: string;
  createdBy: string;
  createdDate: string | null;
  createdTime: string | null;

  id: string | null;
  date: Date | null;
  vehicleType: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  driverMobNo: string | null;
  paymentDiscussed: number | null;
  outTime: string | null;
  reachingTime: string | null;
  clientName: string | null;
  receivingPerson: string | null;
  supervisorName: string | null;
  accDeptVerification: string | null;
  transportationBillAmt: number | null;
  advancePaid: number | null;
  remarksPFL: string | null;
  feedbackbyTransporterOwner: string | null;
  netInwardQty: number | null;
  clientGRNNo: string | null;
  paymentTerms: string | null;
  rejection: string | null;
  shrinkageDump: string | null;
  companyName: string | null;
  clientAddress: ClientAddressDto | null;
  deliveryChallanNo: string | null;
}

export class VehicleDispatchListResponseDto {
  data: VehicleDispatchListItemDto[];
  meta: {
    total: number;
    page: number;
    pages: number;
  };
}

/** Returned by GET /vehicleDispatches/view/:docid */
export class VehicleDispatchViewDto {
  documentId: string;
  overAllStatus: string;
  createdBy: string;
  createdDate: string | null;
  createdTime: string | null;
  approvalSummary?: {
    createdBy?: { userId: string; name: string } | null;
    verified?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    thirdApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
  } | null;

  id: string;
  vehicleDispatchNo: string | null;
  date: Date | null;
  vehicleType: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  driverMobNo: string | null;
  paymentDiscussed: number | null;
  outTime: string | null;
  reachingTime: string | null;
  clientName: string | null;
  receivingPerson: string | null;
  supervisorName: string | null;
  accDeptVerification: string | null;
  transportationBillAmt: number | null;
  advancePaid: number | null;
  remarksPFL: string | null;
  feedbackbyTransporterOwner: string | null;
  netInwardQty: number | null;
  clientGRNNo: string | null;
  paymentTerms: string | null;
  rejection: string | null;
  shrinkageDump: string | null;
  companyName: string | null;
  clientAddress: string | null;
  deliveryChallanNo: string | null;
}

/** Returned by GET /vehicleDispatches/:id (edit form) */
export class VehicleDispatchUpdateFormDto {
  id: string;
  vehicleDispatchNo: string | null;
  companyName: string | null;       // company id
  date: Date | null;
  vehicleType: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  driverMobNo: string | null;
  paymentDiscussed: number | null;
  outTime: string | null;
  reachingTime: string | null;
  clientName: string | null;
  clientAddress: ClientAddressDto | null;
  receivingPerson: string | null;
  supervisorName: string | null;
  accDeptVerification: string | null;
  transportationBillAmt: number | null;
  advancePaid: number | null;
  remarksPFL: string | null;
  feedbackbyTransporterOwner: string | null;
  netInwardQty: number | null;
  clientGRNNo: string | null;
  paymentTerms: string | null;
  deliveryChallanNo: string | null; // delivery challan id
  rejection: string | null;
  shrinkageDump: string | null;
}

// ─── Delete result DTOs ───────────────────────────────────────────────────────

export interface DeleteVehicleDispatchResultDto {
  No: string;
}

export interface DeletedVehicleDispatchItemDto {
  id: string;
  No: string;
}

export interface BulkDeleteVehicleDispatchResultDto {
  success: DeletedVehicleDispatchItemDto[];
  failed: { id: string; reason: string }[];
  message: string;
}
