// status.enum.ts
export enum Status {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "notapproved",
  ACTIVE = "active",
  INCOMPLETE = "incomplete",
  DRAFT = "draft",
}

// src/utils/approvalStatus.enum.ts
export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'notApproved',
 
}


export enum FileType {
  IMAGE = 'image',
  PDF = 'pdf',
}
  
export enum Department {
  ADMIN='admin',
  HR='hr',
  OPERATIONS = 'operations',
  SALE = 'sale',
  PROCUREMENT = 'procurement',
  IT='it',
  BUSINESS_DEVELOPMENT='business_development',
  EXPORTS='exports',
  BRANDING_MARKETING='branding_&_marketing',
  FARMING='farming',
  QUALITY_CHECKING='quality_checking',
  // INVENTORY='inventory',
  OTHER='other'
}

export enum CompanyName {
  PrimeFreshLimited = 'prime fresh limited',
  FlorensFreshSupplySolutionsPvtLtd = 'florens fresh supply solutions pvt. ltd.',
  FlorensFarmingPrivateLimited = 'florens farming private limited',
  PrimeFreshRetailIPrivateLimited = 'prime fresh retail (i) private limited'
}

// src/utils/source.enum.ts
export enum Source {
  VENDOR = 'vendor',
  FARMER = 'farmer',
}

export enum ammountStatus{
    PAID='paid',
    UNPAID='unpaid'
}




