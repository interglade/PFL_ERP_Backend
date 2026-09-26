/**
 * Final Invoice Excel export: header, line items and approval history.
 *
 * Field map (from the entities):
 *   invoices                 -> Final Invoice sheet
 *   invoice_products         -> Invoice Items sheet
 *   documents + approval_stage_info -> status columns + Approvals sheet
 *
 * Tax is stored at invoice level: `cgst`, `sgst` and `igst` are amounts (the
 * service computes `taxAmount = cgst + sgst + igst`). Lines carry no tax split.
 * `invoices.pdfData` is not exported - no service writes it and it is a blob field.
 */

import { Invoice } from '../entity/invoice.entity';
import { InvoiceProduct } from '../entity/invoiceProduct.entity';
import { ExportDefinition } from '../../excel/export/exportTypes';
import {
  ADDRESS_COLUMNS,
  BRANCH_COLUMNS,
  COMPANY_COLUMNS,
  CUSTOMER_COLUMNS,
  USER_COLUMNS,
  joinProductLine,
  joinSelect,
} from '../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../excel/export/documentMeta';
import {
  addressColumn,
  auditColumns,
  branchColumn,
  companyColumns,
  customerColumns,
  productColumns,
  uomColumn,
  userColumns,
} from '../../excel/export/commonColumns';

type Row = DocumentRow<Invoice>;

export const FINAL_INVOICE_EXPORT: ExportDefinition = {
  fileStem: 'Final_Invoice',
  sheets: [
    documentHeaderSheet<Invoice>({
      name: 'Final Invoice',
      loadRecords: async (ctx) => {
        const qb = ctx.manager
          .getRepository(Invoice)
          .createQueryBuilder('invoice')
          // pdfData is deliberately left out of the selection.
          .select([
            'invoice.id',
            'invoice.invoiceNo',
            'invoice.invoiceDate',
            'invoice.poNumber',
            'invoice.vehicleNo',
            'invoice.placeOfSupply',
            'invoice.totalProductAmount',
            'invoice.netProductWeight',
            'invoice.discount',
            'invoice.freight',
            'invoice.otherCharges',
            'invoice.cgst',
            'invoice.sgst',
            'invoice.igst',
            'invoice.taxAmount',
            'invoice.totalAmount',
            'invoice.totalAmtInWords',
            'invoice.ammountStatus',
            'invoice.createdAt',
            'invoice.updatedAt',
          ]);
        joinSelect(qb, 'invoice.companyName', 'company', COMPANY_COLUMNS);
        joinSelect(qb, 'invoice.deliveryChallan', 'challan', ['id', 'challanNo']);
        joinSelect(qb, 'invoice.customerName', 'customer', CUSTOMER_COLUMNS);
        joinSelect(qb, 'invoice.fromLocation', 'fromLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'invoice.billingAddress', 'billingAddress', ADDRESS_COLUMNS);
        joinSelect(qb, 'invoice.deliveryAddress', 'deliveryAddress', ADDRESS_COLUMNS);
        joinSelect(qb, 'invoice.createdBy', 'createdBy', USER_COLUMNS);
        return qb.where('invoice.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'Invoice No', maps: 'invoices.invoiceNo', get: (r) => r.record.invoiceNo },
        { header: 'Invoice Record ID', maps: 'invoices.id', get: (r) => r.record.id },
        { header: 'Invoice Date', maps: 'invoices.invoiceDate', type: 'date', get: (r) => r.record.invoiceDate },
        ...companyColumns<Row>((r) => r.record.companyName),
        ...customerColumns<Row>((r) => r.record.customerName),
        { header: 'Delivery Challan No', maps: 'invoices.deliveryChallan -> delivery_challan_purchase.challanNo', get: (r) => r.record.deliveryChallan?.challanNo },
        { header: 'PO Number', maps: 'invoices.poNumber', get: (r) => r.record.poNumber },
        branchColumn<Row>('From Location', (r) => r.record.fromLocation, 'invoices.fromLocation'),
        addressColumn<Row>('Billing Address', (r) => r.record.billingAddress, 'invoices.billingAddress'),
        addressColumn<Row>('Shipping Address', (r) => r.record.deliveryAddress, 'invoices.deliveryAddress'),
        { header: 'Place Of Supply', maps: 'invoices.placeOfSupply', get: (r) => r.record.placeOfSupply },
        { header: 'Vehicle No', maps: 'invoices.vehicleNo', get: (r) => r.record.vehicleNo },
        { header: 'Net Product Weight', maps: 'invoices.netProductWeight', type: 'quantity', get: (r) => r.record.netProductWeight },
        { header: 'Total Product Amount', maps: 'invoices.totalProductAmount', type: 'amount', get: (r) => r.record.totalProductAmount },
        { header: 'Discount', maps: 'invoices.discount', type: 'amount', get: (r) => r.record.discount },
        { header: 'Freight', maps: 'invoices.freight', type: 'amount', get: (r) => r.record.freight },
        { header: 'Other Charges', maps: 'invoices.otherCharges', type: 'amount', get: (r) => r.record.otherCharges },
        { header: 'CGST Amount', maps: 'invoices.cgst', type: 'amount', get: (r) => r.record.cgst },
        { header: 'SGST Amount', maps: 'invoices.sgst', type: 'amount', get: (r) => r.record.sgst },
        { header: 'IGST Amount', maps: 'invoices.igst', type: 'amount', get: (r) => r.record.igst },
        { header: 'Total Tax Amount', maps: 'invoices.taxAmount', type: 'amount', get: (r) => r.record.taxAmount },
        { header: 'Grand Total', maps: 'invoices.totalAmount', type: 'amount', get: (r) => r.record.totalAmount },
        { header: 'Total Amount In Words', maps: 'invoices.totalAmtInWords', get: (r) => r.record.totalAmtInWords },
        { header: 'Payment Status', maps: 'invoices.ammountStatus', get: (r) => r.record.ammountStatus },
        ...userColumns<Row>('Created By', (r) => r.record.createdBy, 'invoices.createdBy'),
        ...auditColumns<Row>((r) => r.record, 'invoices'),
        ...documentColumns<Invoice>(),
      ],
    }),
    {
      name: 'Invoice Items',
      refId: (line: InvoiceProduct) => line.invoice?.id,
      load: async (ctx) => {
        const qb = ctx.manager
          .getRepository(InvoiceProduct)
          .createQueryBuilder('line')
          .innerJoin('line.invoice', 'parent')
          .addSelect(['parent.id', 'parent.invoiceNo']);
        joinProductLine(qb, 'line', { product: 'productName', variant: 'variant', saleUoM: 'saleUoM' });
        return qb.where('parent.id IN (:...ids)', { ids: ctx.ids }).orderBy('line.createdAt', 'ASC').getMany();
      },
      columns: [
        { header: 'Invoice No', maps: 'invoices.invoiceNo', get: (l: InvoiceProduct) => l.invoice?.invoiceNo },
        { header: 'Invoice Record ID', maps: 'invoices.id', get: (l: InvoiceProduct) => l.invoice?.id },
        { header: 'Item ID', maps: 'invoice_products.id', get: (l: InvoiceProduct) => l.id },
        ...productColumns<InvoiceProduct>((l) => l.productName, (l) => l.variant),
        { header: 'HSN Code', maps: 'invoice_products.hsnCode', get: (l: InvoiceProduct) => l.hsnCode },
        { header: 'Description', maps: 'invoice_products.description', get: (l: InvoiceProduct) => l.description },
        uomColumn<InvoiceProduct>('Sale UOM', (l) => l.saleUoM, 'invoice_products.saleUoM'),
        { header: 'Quantity', maps: 'invoice_products.quantity', type: 'quantity', get: (l: InvoiceProduct) => l.quantity },
        { header: 'Accepted Qty', maps: 'invoice_products.acceptedQty', type: 'quantity', get: (l: InvoiceProduct) => l.acceptedQty },
        { header: 'Rejected Qty', maps: 'invoice_products.rejectedQty', type: 'quantity', get: (l: InvoiceProduct) => l.rejectedQty },
        { header: 'Returned Qty', maps: 'invoice_products.returnedQty', type: 'quantity', get: (l: InvoiceProduct) => l.returnedQty },
        { header: 'Unit Price', maps: 'invoice_products.unitPrice', type: 'amount', get: (l: InvoiceProduct) => l.unitPrice },
        { header: 'Amount', maps: 'invoice_products.amount', type: 'amount', get: (l: InvoiceProduct) => l.amount },
        { header: 'Gross Weight', maps: 'invoice_products.grossWeight', type: 'quantity', get: (l: InvoiceProduct) => l.grossWeight },
        { header: 'Net Weight', maps: 'invoice_products.netWeight', type: 'quantity', get: (l: InvoiceProduct) => l.netWeight },
        ...auditColumns<InvoiceProduct>((l) => l, 'invoice_products'),
      ],
    },
    approvalSheet({ numberHeader: 'Invoice No', sources: [{ entity: Invoice, numberColumn: 'invoiceNo' }] }),
  ],
};
