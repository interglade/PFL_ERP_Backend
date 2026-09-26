/**
 * Interface for Delivery Challan Report Download API Request Body
 */
export interface IDeliveryChallanReportDownloadRequest {
  // Date filters (required)
  startDate: string; // Format: 'YYYY-MM-DD'
  endDate: string;   // Format: 'YYYY-MM-DD'

  // Entity filters (optional - can be single value or array)
  company?: string | string[];
  office?: string | string[];
  customer?: string | string[];
  fromLocation?: string | string[];
  createdBy?: string | string[];
  product?: string | string[];

  // Delivery Challan filters (optional)
  challanNo?: string;
  grnNo?: string;
  approvalStatus?: string;
  requestingDepartment?: string;
  
  // Driver and vehicle filters (optional)
  driverName?: string;
  vehicleNo?: string;
  licenseNo?: string;
  rmn?: string;
  receiverName?: string;

  // Amount and quantity filters (optional)
  totalProductAmount?: number;
  totalProductAmountOperator?: '>' | '<' | '=';
  netProductWeight?: number;
  netProductWeightOperator?: '>' | '<' | '=';

  // Invoice status filter (optional)
  invoiceGenerated?: 'yes' | 'no' | 'all';
  invoiceType?: 'proforma' | 'final' | 'all';

  // Return status filter (optional)
  isReturned?: boolean;
}

/**
 * Interface for Delivery Challan Report Service Filters (internal use)
 */
export interface IDeliveryChallanReportFilters {
  startDate: Date;
  endDate: Date;
  company?: string[];
  office?: string[];
  customer?: string[];
  fromLocation?: string[];
  createdBy?: string[];
  product?: string[];
  challanNo?: string;
  grnNo?: string;
  approvalStatus?: string;
  requestingDepartment?: string;
  driverName?: string;
  vehicleNo?: string;
  licenseNo?: string;
  rmn?: string;
  receiverName?: string;
  totalProductAmount?: number;
  totalProductAmountOperator?: '>' | '<' | '=';
  netProductWeight?: number;
  netProductWeightOperator?: '>' | '<' | '=';
  invoiceGenerated?: 'yes' | 'no' | 'all';
  invoiceType?: 'proforma' | 'final' | 'all';
  isReturned?: boolean;
}
