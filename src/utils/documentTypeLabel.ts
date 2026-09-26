const DOCUMENT_TYPE_LABEL_MAP: Record<string, string> = {
  'grn': 'GRN',
  'rfpa': 'RFPA',
  'deal-slip': 'Deal Slip',
  'aqr': 'AQR',
  'second-sale': 'Second Sale',
  'vehicle-dispatch-register': 'Vehicle Dispatch',
  'dump-register': 'Dump Register',
  'inward-register': 'Inward Register',
  'dc-type-other': 'Delivery Challan',
  'dc-type-stock-transfer': 'Stock Transfer Challan',
  'dc-type-customer': 'Customer Delivery Challan',
  'return-by-customer': 'Return by Customer',
  'return-to-vendor': 'Return to Vendor',
  'multi-cash-voucher': 'Cash Voucher',
  'labor-payment-voucher': 'Labor Payment Voucher',
  'transport-payment-voucher': 'Transport Payment Voucher',
  'packaging-material-voucher': 'Packaging Material Voucher',
  'final-invoice': 'Final Invoice',
  'eod-report': 'EOD Report',
  'proforma-invoice': 'Proforma Invoice',
};

export function getReadableDocumentType(type: string): string {
  return DOCUMENT_TYPE_LABEL_MAP[type.toLowerCase()] ?? type;
}
