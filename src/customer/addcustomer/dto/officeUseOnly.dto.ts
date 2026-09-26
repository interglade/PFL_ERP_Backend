export interface OfficeUseOnlyDto {
  id?: string;
  proposerBDName?: string;

  pflCoordinator?: string;

  recommendedBy?: string;

  dispatchLocationPfl?: string;

  approvedBy?: string;

  relationshipManager?: string;

  avgBillingMonthly?: number;

  volumeMonthly?: number;

  customerVerification?: boolean;

  verificationAgency?: string;

  validityPeriod?: Date;

  dueDiligenceDone?: boolean;

  creditWorthinessDue?: string;

  keyAccountPersonAssigned?: string;

  sinceWhen?: Date;

  ledgerCreatedDate?: Date;

  ledgerCreatedBy?: string;

  ledgerVerifiedApprovedBy?: string;

  createdBy?: string;

  additionalNotes?: string;
}