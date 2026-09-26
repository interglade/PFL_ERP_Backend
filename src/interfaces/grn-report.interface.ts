/**
 * Interface for GRN Report Download API Request Body
 */
export interface IGrnReportDownloadRequest {
  // Date filters (required)
  startDate: string; // Format: 'YYYY-MM-DD'
  endDate: string;   // Format: 'YYYY-MM-DD'

  // Entity filters (optional - can be single value or array)
  company?: string | string[];
  purchaseLocation?: string | string[];
  purchaseForSalesLocation?: string | string[];
  vendor?: string | string[];
  farmer?: string | string[];
  createdBy?: string | string[];
  product?: string | string[];

  // GRN filters (optional)
  grnType?: string;
  locationType?: string;
  purchaseType?: string;
  source?: 'vendor' | 'farmer' | string;
  
  // Payment filters (optional)
  paymentMode?: string;
  paymentTerms?: string;
  paymentDateFrom?: string; // Format: 'YYYY-MM-DD'
  paymentDateTo?: string;   // Format: 'YYYY-MM-DD'
  dueDateFrom?: string;     // Format: 'YYYY-MM-DD'
  dueDateTo?: string;       // Format: 'YYYY-MM-DD'

  // Amount and quantity filters (optional)
  totalQuantity?: number;
  totalQuantityOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  totalAmount?: number;
  totalAmountOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';

  // Approval filters (optional)
  verifiedBy?: string[];
  approvedBy?: string[];
  status?: string;

  // Search filters (optional)
  billNo?: string;
  grnNo?: string;
  requestingDepartment?: string;
  purchaseInstructionsBy?: string;
  purchaseBy?: string;
  vehicleNo?: string;
  receivedThrough?: string;
  deliveryReceivingPerson?: string;
  securityPerson?: string;
  rmn?: string;
}

/**
 * Interface for GRN Report Service Filters (internal use)
 */
export interface IGrnReportFilters {
  startDate: Date;
  endDate: Date;
  company?: string[];
  purchaseLocation?: string[];
  purchaseForSalesLocation?: string[];
  vendor?: string[];
  farmer?: string[];
  createdBy?: string[];
  product?: string[];
  grnType?: string;
  locationType?: string;
  purchaseType?: string;
  source?: string;
  paymentMode?: string;
  paymentTerms?: string;
  paymentDateFrom?: Date;
  paymentDateTo?: Date;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  totalQuantity?: number;
  totalQuantityOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  totalAmount?: number;
  totalAmountOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  verifiedBy?: string[];
  approvedBy?: string[];
  status?: string;
  billNo?: string;
  grnNo?: string;
  requestingDepartment?: string;
  purchaseInstructionsBy?: string;
  purchaseBy?: string;
  vehicleNo?: string;
  receivedThrough?: string;
  deliveryReceivingPerson?: string;
  securityPerson?: string;
  rmn?: string;
}