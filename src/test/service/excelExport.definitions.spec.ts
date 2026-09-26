/**
 * Structural guarantees for every document export definition, checked without a
 * database: sheet names Excel will accept, no duplicate headers, a loader and a
 * document key on every sheet, and no sensitive user fields in any header.
 */

import 'reflect-metadata';

import { ExportDefinition } from '../../excel/export/exportTypes';
import { RFPA_EXPORT } from '../../rfpa/excel/rfpa.export';
import { DEAL_SLIP_EXPORT } from '../../dealSlip/excel/dealSlip.export';
import { GRN_EXPORT } from '../../grn/excel/grn.export';
import { INWARD_REGISTER_EXPORT } from '../../inwardRegister/excel/inwardRegister.export';
import { AQR_EXPORT } from '../../aqr/excel/aqr.export';
import { DUMP_REGISTER_EXPORT } from '../../dumpRegister/excel/dumpRegister.export';
import { CUSTOMER_DELIVERY_CHALLAN_EXPORT } from '../../deliveryChallans/customerDeliveryChllan/excel/customerDeliveryChallan.export';
import { STOCK_TRANSFER_DELIVERY_CHALLAN_EXPORT } from '../../deliveryChallans/stockTransferDC/excel/stockTransferDeliveryChallan.export';
import { OTHER_DELIVERY_CHALLAN_EXPORT } from '../../deliveryChallans/otherDeliveryChallan/excel/otherDeliveryChallan.export';
import { FINAL_INVOICE_EXPORT } from '../../invoice/excel/finalInvoice.export';
import { RETURN_BY_CUSTOMER_EXPORT } from '../../returnByCustomer/excel/returnByCustomer.export';
import { RETURN_TO_VENDOR_EXPORT } from '../../returnToVendor/excel/returnToVendor.export';
import { SECOND_SALE_EXPORT } from '../../secondSale/excel/secondSale.export';
import { VEHICLE_DISPATCH_EXPORT } from '../../vehicleDispatch/excel/vehicleDispatch.export';
import { MULTI_CASH_VOUCHER_EXPORT } from '../../vouchers/multiCashV/excel/multiCashVoucher.export';
import { LABOUR_PAYMENT_VOUCHER_EXPORT } from '../../vouchers/labourPaymentV/excel/labourPaymentVoucher.export';
import { TRANSPORT_PAYMENT_VOUCHER_EXPORT } from '../../vouchers/tranportPaymentV/excel/transportPaymentVoucher.export';
import { PACKING_MATERIAL_VOUCHER_EXPORT } from '../../vouchers/paymentMaterialV/excel/packingMaterialVoucher.export';
import { ALL_VOUCHERS_EXPORT } from '../../vouchers/excel/allVouchers.export';

const DEFINITIONS: [string, ExportDefinition][] = [
  ['RFPA', RFPA_EXPORT],
  ['Deal Slip', DEAL_SLIP_EXPORT],
  ['GRN', GRN_EXPORT],
  ['Inward Register', INWARD_REGISTER_EXPORT],
  ['AQR', AQR_EXPORT],
  ['Dump Register', DUMP_REGISTER_EXPORT],
  ['Customer DC', CUSTOMER_DELIVERY_CHALLAN_EXPORT],
  ['Stock Transfer DC', STOCK_TRANSFER_DELIVERY_CHALLAN_EXPORT],
  ['Other DC', OTHER_DELIVERY_CHALLAN_EXPORT],
  ['Final Invoice', FINAL_INVOICE_EXPORT],
  ['Return By Customer', RETURN_BY_CUSTOMER_EXPORT],
  ['Return To Vendor', RETURN_TO_VENDOR_EXPORT],
  ['Second Sale', SECOND_SALE_EXPORT],
  ['Vehicle Dispatch', VEHICLE_DISPATCH_EXPORT],
  ['Multi Cash Voucher', MULTI_CASH_VOUCHER_EXPORT],
  ['Labour Payment Voucher', LABOUR_PAYMENT_VOUCHER_EXPORT],
  ['Transport Payment Voucher', TRANSPORT_PAYMENT_VOUCHER_EXPORT],
  ['Packing Material Voucher', PACKING_MATERIAL_VOUCHER_EXPORT],
  ['All Vouchers', ALL_VOUCHERS_EXPORT],
];

describe.each(DEFINITIONS)('%s export definition', (_name, definition) => {
  it('has a file stem that is safe in a file name', () => {
    expect(definition.fileStem).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it('has unique, Excel-valid sheet names', () => {
    const names = definition.sheets.map((s) => s.name);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(31);
      expect(name).not.toMatch(/[\\/?*[\]:]/);
    }
  });

  it('ends with an approval history sheet', () => {
    expect(definition.sheets[definition.sheets.length - 1].name).toMatch(/Approvals$/);
  });

  it.each(definition.sheets.map((s) => [s.name, s] as const))('sheet "%s" is complete', (_sheet, sheet) => {
    expect(typeof sheet.load).toBe('function');
    expect(typeof sheet.refId).toBe('function');
    expect(sheet.columns.length).toBeGreaterThan(0);

    const headers = sheet.columns.map((c) => c.header);
    const duplicates = headers.filter((h, i) => headers.indexOf(h) !== i);
    expect(duplicates).toEqual([]);

    for (const column of sheet.columns) {
      expect(column.header.trim()).toBe(column.header);
      expect(column.maps).toBeTruthy();
      expect(typeof column.get).toBe('function');
      expect(column.header).not.toMatch(/password|secret|token/i);
    }
  });

  it('first sheet identifies each document by number and record id', () => {
    const headers = definition.sheets[0].columns.map((c) => c.header);
    expect(headers.some((h) => / No$/.test(h))).toBe(true);
    expect(headers.some((h) => / Record ID$/.test(h))).toBe(true);
    expect(headers).toEqual(expect.arrayContaining(['Document ID', 'Overall Status', 'Created Date', 'Updated Date']));
  });
});

describe('column getters tolerate sparse rows', () => {
  it.each(DEFINITIONS)('%s: every getter handles a record with no relations loaded', (_name, definition) => {
    const sparseHeader = { record: { id: 'x' }, doc: null };
    for (const column of definition.sheets[0].columns) {
      expect(() => column.get(sparseHeader)).not.toThrow();
    }
  });
});
