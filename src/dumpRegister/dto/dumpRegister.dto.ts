

// ─── Shared ───────────────────────────────────────────────────────────────────

import { DumpType } from "../entity/dumpRegister.entity";

export interface DumpProductInputDto {
  /** product id */
  productName?: string | null;
  productId?: string | null;
  /** variant id */
  variant?: string | null;
  variantId?: string | null;
  /** uom id */
  uom?: string | null;
  uomId?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateDumpRegisterDto {
  /** company id — accepted as companyName or companyId */
  companyName?: string | null;
  companyId?: string | null;

  /** branch id — accepted as location or locationId */
  location?: string | null;
  locationId?: string | null;

  /** grn id */
  grn?: string | null;
  grnNo?: string | null;

  /** delivery challan id */
  deliveryChallanNo?: string | null;
  deliveryChallan?: string | null;

  /** rbc id */
  rbcNo?: string | null;
  rbc?: string | null;

  date?: string | null;
  dumpType?: DumpType | null;
  batchNo?: string | null;
  totalQty?: number | null;
  totalDumpCost?: number | null;
  totalCostInWords?: string | null;
  remark?: string | null;

  dumpProducts: DumpProductInputDto[];

  /** injected by controller — not sent from client */
  requestedBy?: string;
}

// ─── Update ───────────────────────────────────────────────────────────────────

export interface UpdateDumpProductInputDto {
  id?: string | null;
  /** product id — accepted as productName or productId, same as create */
  productName?: string | null;
  productId?: string | null;
  /** variant id — accepted as variant or variantId, same as create */
  variant?: string | null;
  variantId?: string | null;
  /** uom id — accepted as uom or uomId, same as create */
  uom?: string | null;
  uomId?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
}

export interface UpdateDumpRegisterDto {
  companyName?: string | null;
  location?: string | null;
  grn?: string | null;
  deliveryChallanNo?: string | null;
  rbcNo?: string | null;
  date?: string | null;
  dumpType?: DumpType | null;
  batchNo?: string | null;
  totalQty?: number | null;
  totalDumpCost?: number | null;
  totalCostInWords?: string | null;
  remark?: string | null;
  dumpProducts?: UpdateDumpProductInputDto[];
}

// ─── Get by ID (edit form — IDs only) ────────────────────────────────────────

export interface DumpProductForUpdateDto {
  id: string;
  productName: string | null;
  variant: string | null;
  uom: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
}

export interface DumpRegisterForUpdateDto {
  id?: string;
  createdDate: string | null;
  createdTime: string | null;
  dumpType: DumpType | null;
  companyName: string | null;
  location: string | null;
  date: Date | null;
  totalDumpCost: number | null;
  totalCostInWords: string | null;
  totalQty: number | null;
  batchNo: string | null;
  remark: string | null;
  grn: string | null;
  deliveryChallanNo: string | null;
  rbcNo: string | null;
  requestedBy: string | null;
  dumpProducts: DumpProductForUpdateDto[];
}

// ─── Get by ID for edit (legacy — returns requestedBy as object) ──────────────

export interface RequestedByDto {
  id: string;
  firstName: string;
  lastName: string;
}

export interface DumpProductDetailDto {
  id: string;
  productName: { id: string; productName: string } | null;
  varient: { id: string; productName: string | null } | null;
  uom: { id: string; unit: string } | null;
  quantity: number | null;
  amount: number | null;
  unitPrice: number | null;
}

export interface DumpRegisterByIdDto {
  id: string;
  companyName: string | null;
  createdDate: string | null;
  createdTime: string | null;
  location: string | null;
  date: Date | null;
  totalDumpCost: number | null;
  totalCostInWords: string | null;
  batchNo: string | null;
  remark: string | null;
  grn: string | null;
  requestedBy: RequestedByDto | null;
  dumpProducts: DumpProductDetailDto[];
}

// ─── View (document approval view — display names) ───────────────────────────

export interface DumpProductViewDto {
  id: string;
  productName: string | null;
  variant: string | null;
  uom: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
}

export interface DumpRegisterViewDto {
  id: string;
  documentId: string;
  overAllStatus: string;
  createdBy: string | null;
  approvalSummary?: {
    createdBy?: { userId: string; name: string } | null;
    verified?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    thirdApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
  } | null;
  dumpNo: string | null;
  grn: string | null;
  deliveryChallanNo: string | null;
  rbcNo: string | null;
  dumpType: DumpType | null;
  companyName: string | null;
  location: string | null;
  date: Date | null;
  totalDumpCost: number | null;
  totalCostInWords: string | null;
  totalQty: number | null;
  batchNo: string | null;
  remark: string | null;
  requestedBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  dumpProducts: DumpProductViewDto[];
}

// ─── List ─────────────────────────────────────────────────────────────────────

export interface DumpRegisterListItemDto {
  documentId: string;
  overAllStatus: string;
  createdBy: string;
  createdDate: string | null;
  createdTime: string | null;
  id: string;
  dumpNo: string | null;
  companyName: string | null;
  location: string | null;
  grn: string | null;
  deliveryChallanNo: string | null;
  rbcNo: string | null;
  date: Date | null;
  batchNo: string | null;
  totalQty: number | null;
  totalDumpCost: number | null;
  totalCostInWords: string | null;
  remark: string | null;
  dumpType: DumpType | null;
}

export interface DumpRegisterListResultDto {
  data: DumpRegisterListItemDto[];
  meta: {
    total: number;
    page: number;
    pages: number;
  };
}

// ─── Recycle Bin List ─────────────────────────────────────────────────────────

export interface DumpRegisterRecycleItemDto {
  documentId: string;
  overAllStatus: string;
  createdBy: string;
  createdDate: string | null;
  createdTime: string | null;
  id: string;
  dumpNo: string | null;
  companyName: string | null;
  location: string | null;
  grn: string | null;
  deliveryChallanNo: string | null;
  rbcNo: string | null;
  date: Date | null;
  batchNo: string | null;
  totalQty: number | null;
  totalDumpCost: number | null;
  totalCostInWords: string | null;
  remark: string | null;
  dumpType: DumpType | null;
}

export interface DumpRegisterRecycleResultDto {
  data: DumpRegisterRecycleItemDto[];
  meta: {
    total: number;
    page: number;
    pages: number;
  };
}
