/**
 * Response shapes for the Admin Control Center dashboard. They mirror the
 * frontend's admin-control-center.types.ts - one object per tab endpoint.
 */
import { Contact } from './service/accShared.util';

export type Series = (number | null)[];

export interface Option {
  value: string;
  label: string;
}

export interface FiltersTab {
  periods: Option[];
  locations: Option[];
  companies: Option[];
}

// ─── Overview ────────────────────────────────────────────────────────────────

export interface OverviewTrend {
  labels: string[];
  purchaseQty: Series;
  salesQty: Series;
  purchaseAmount: Series;
  salesAmount: Series;
}

export interface OverviewTab {
  totals: {
    purchaseQty: number;
    purchaseAmount: number;
    purchaseChange: number;
    salesQty: number;
    salesAmount: number;
    salesChange: number;
    stockQty: number;
    wastageQty: number;
    wastageChange: number;
    payableAmount: number;
    payableCount: number;
    receivableAmount: number;
    receivableCount: number;
  };
  trends: {
    'this-month': OverviewTrend;
    'last-month': OverviewTrend;
    'this-year': OverviewTrend;
  };
  recentActivity: {
    id: string;
    time: string;
    user: string;
    action: string;
    reference: string;
  }[];
}

// ─── Purchase ────────────────────────────────────────────────────────────────

export interface SourceTrend {
  labels: string[];
  farmerQty: Series;
  vendorQty: Series;
  farmerAmount: Series;
  vendorAmount: Series;
}

export interface PartyRow {
  id: string;
  name: string;
  location: string;
  quantity: number;
  amount: number;
  grnCount: number;
  phone: string;
}

export interface PurchaseTab {
  totals: {
    grnCount: number;
    quantity: number;
    amount: number;
    farmerQty: number;
    farmerAmount: number;
    vendorQty: number;
    vendorAmount: number;
    voucherSpend: number;
  };
  sourceTrends: Record<'this-month' | 'last-month' | 'this-quarter' | 'this-year', SourceTrend>;
  topFarmers: PartyRow[];
  topVendors: PartyRow[];
  vendorCategories: { id: string; category: string; quantity: number; amount: number }[];
  topProducts: { id: string; product: string; variant: string; quantity: number; amount: number }[];
}

// ─── Sales ───────────────────────────────────────────────────────────────────

export interface SalesTab {
  totals: {
    dcCount: number;
    dispatchedQty: number;
    acceptedQty: number;
    returnedQty: number;
    rejectedQty: number;
    amount: number;
    uninvoicedDcCount: number;
    uninvoicedQty: number;
    uninvoicedAmount: number;
  };
  byCategory: { category: string; amount: number }[];
  secondSales: { entries: number; quantity: number; amount: number };
  topCustomers: {
    id: string;
    name: string;
    category: string;
    invoices: number;
    quantity: number;
    amount: number;
    unpaidAmount: number;
    phone: string;
  }[];
  topProducts: {
    id: string;
    product: string;
    variant: string;
    quantity: number;
    returnedQty: number;
    amount: number;
  }[];
}

// ─── Documents & Registrations ───────────────────────────────────────────────

export interface DocumentsTab {
  pipeline: {
    id: string;
    department: string;
    docType: string;
    total: number;
    inApproval: number;
    approved: number;
    rejected: number;
  }[];
  grnStages: { stage: string; count: number }[];
  invoiceStages: { stage: string; count: number }[];
  registrations: {
    type: 'Farmer' | 'Vendor' | 'Customer';
    total: number;
    thisMonth: number;
    approved: number;
    pending: number;
    rejected: number;
  }[];
  pending: {
    id: string;
    docNo: string;
    docType: string;
    createdAt: string;
    creator: Contact;
    status: string;
    pendingWith: Contact;
    pendingDays: number;
  }[];
}

// ─── Users & Performance ─────────────────────────────────────────────────────

export interface TeamRow {
  id: string;
  leader: Contact;
  members: number;
  assignedTarget: number;
  achieved: number;
  documents: number;
}

export interface UsersTab {
  users: {
    id: string;
    name: string;
    role: string;
    department: string;
    location: string;
    status: 'Active' | 'Inactive';
    phone: string;
  }[];
  procurementTeams: TeamRow[];
  salesTeams: TeamRow[];
  setupGaps: { id: string; user: Contact; issue: string }[];
}
