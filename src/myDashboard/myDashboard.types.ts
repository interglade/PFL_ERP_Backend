/**
 * Response shapes of the standard user dashboard (/dashboard/me/*).
 * Mirrors PFL_ERP_Frontend/src/features/dashboards/my-dashboard/data/my-dashboard.types.ts.
 * docs/user-dashboard-plan.md §8.
 */
import { Contact } from '../adminControlCenter/service/accShared.util';

export type WorkflowDepartment = 'procurement' | 'sales';
export type PlanName = 'Procurement' | 'Sales';
export type PlanStatus = 'Missing' | 'Pending' | 'Approved' | 'Rejected';
/** Procurement plans are in kg, sales plans in rupees. */
export type PlanUnit = 'kg' | 'INR';

export interface MyAccess {
  /** In that department's workflow, so the user makes a business plan every month. */
  plans: Record<WorkflowDepartment, boolean>;
  /** Has direct team members in that department's workflow. */
  leads: Record<WorkflowDepartment, boolean>;
}

export type PendingActionType = 'verify' | 'approve' | 'finalize';

export interface MyPendingItem {
  id: string;
  category: 'Registration' | 'Document';
  docNo: string;
  docType: string;
  createdAt: string;
  creator: Contact;
  status: string;
  actionType: PendingActionType;
  action: string;
  amount: number | null;
  pendingDays: number;
}

export interface MySubmission {
  id: string;
  docKey: string;
  docNo: string;
  docType: string;
  createdAt: string;
  amount: number | null;
  status: string;
  stage: string;
  waitingOn: Contact | null;
  pendingDays: number;
  rejectionReason?: string;
}

export interface MyTargetSummary {
  plan: PlanName;
  unit: PlanUnit;
  status: PlanStatus;
  remark?: string;
  monthlyTarget: number;
  plannedToDate: number;
  achieved: number;
}

export interface WeeklyPlanPoint {
  week: string;
  planned: number;
  /** null for weeks that have not started. */
  achieved: number | null;
}

/** Count and age of a queue whose items are listed on another tab. */
export interface QueueCount {
  count: number;
  oldestDays: number;
}

export interface MyWork {
  /** Payments to record (payment managers) and team plans to approve (team leaders). */
  queues: Partial<Record<'record-payment' | 'approve-plan', QueueCount>>;
  pending: MyPendingItem[];
  submissions: MySubmission[];
  targets: MyTargetSummary[];
  weekly: Record<PlanName, WeeklyPlanPoint[]>;
}

export interface MyTeam {
  teamName: string;
  unit: PlanUnit;
  members: Array<{ id: string; member: Contact; assignedTarget: number; achieved: number; documents: number }>;
  plans: Array<{ id: string; member: Contact; status: PlanStatus }>;
  stuckDocuments: number;
}

export interface MyFinalization {
  paymentOfFinalized: Array<{ status: string; count: number; amount: number }>;
}

export interface PaymentDueRow {
  id: string;
  docNo: string;
  party: string;
  partyType: string;
  docDate: string;
  amount: number;
  paid: number;
  days: number;
}

export interface MyPayments {
  recorded: { paidCount: number; paidAmount: number; receivedCount: number; receivedAmount: number };
  grnsDue: PaymentDueRow[];
  invoicesDue: PaymentDueRow[];
  recentPayments: Array<{
    id: string;
    time: string;
    docNo: string;
    party: string;
    direction: 'Paid' | 'Received';
    mode: string;
    amount: number;
    voided: boolean;
  }>;
}

export interface MyDocumentStatusRow {
  id: string;
  docKey: string;
  docType: string;
  total: number;
  inApproval: number;
  approved: number;
  rejected: number;
}

export interface RegistrationSummary {
  type: string;
  total: number;
  thisMonth: number;
  approved: number;
  pending: number;
  rejected: number;
}

export interface MyProcurement {
  totals: {
    amount: number;
    quantity: number;
    grnCount: number;
    farmerAmount: number;
    farmerQty: number;
    vendorAmount: number;
    vendorQty: number;
    voucherSpend: number;
  };
  documents: MyDocumentStatusRow[];
  registrations: RegistrationSummary[];
}

export interface MySales {
  totals: {
    amount: number;
    dcCount: number;
    dispatchedQty: number;
    acceptedQty: number;
    returnedQty: number;
    rejectedQty: number;
    uninvoicedDcCount: number;
    uninvoicedQty: number;
    uninvoicedAmount: number;
    secondSalesQty: number;
    secondSalesAmount: number;
  };
  documents: MyDocumentStatusRow[];
  registrations: RegistrationSummary[];
}

export interface MyOperation {
  totals: { received: number; inward: number; dumped: number; returnedToVendor: number };
  documents: MyDocumentStatusRow[];
}
