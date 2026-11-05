/**
 * docs/registration-import-plan.md: the shared layer of the Vendor, Customer and
 * Farmer importers - the form's rules (D5), unique mobiles and emails (D4) and
 * updates that keep what an empty cell leaves out (D3). No database.
 */

import 'reflect-metadata';
import ExcelJS from 'exceljs';

import { ExcelRow, parseWorkbook } from '../../excel/excelImport.service';
import { DraftLinks, EMPTY_LINK } from '../../excel/draftLinks';
import { FORMAT_RULES } from '../../excel/formatRules';
import { ContactPool, mergeFilled, RegistrationRowReader } from '../../excel/registrationRow';
import { buildTemplateWorkbook } from '../../excel/excelFile.service';
import { VENDOR_SHEET } from '../../vendor/createVendor/excel/vendor.columns';
import { FARMER_SHEET } from '../../farmer/excel/farmer.columns';
import { CUSTOMER_SHEET } from '../../customer/addcustomer/excel/customer.columns';

async function rowOf(sheetDef: typeof VENDOR_SHEET | typeof FARMER_SHEET, cells: Record<string, string | number>): Promise<ExcelRow> {
  const headers = Object.keys(cells);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.addRow(headers);
  sheet.addRow(headers.map((header) => cells[header]));
  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer as ArrayBuffer);
  return parseWorkbook(reloaded, sheetDef as any).rows[0];
}

describe('format rules (the forms\' rules)', () => {
  it('cleans what the forms accept and refuses the rest', () => {
    expect(FORMAT_RULES.mobile.clean('+91 98765-43210')).toBe('9876543210');
    expect(FORMAT_RULES.mobile.clean('09876543210')).toBe('9876543210');
    expect(FORMAT_RULES.mobile.clean('5876543210')).toBeNull();
    expect(FORMAT_RULES.email.clean('ravi@farm.in')).toBe('ravi@farm.in');
    expect(FORMAT_RULES.email.clean('ravi@farm')).toBeNull();
    expect(FORMAT_RULES.gstin.clean('27abcde1234f1z5')).toBe('27ABCDE1234F1Z5');
    expect(FORMAT_RULES.gstin.clean('27ABCDE1234F1Y5')).toBeNull();
    expect(FORMAT_RULES.pan.clean('abcde1234f')).toBe('ABCDE1234F');
    expect(FORMAT_RULES.ifsc.clean('sbin0001234')).toBe('SBIN0001234');
    expect(FORMAT_RULES.ifsc.clean('SBIN1001234')).toBeNull();
    expect(FORMAT_RULES.aadhaar.clean('1234 5678 9012')).toBe('123456789012');
    expect(FORMAT_RULES.pincode.clean('42200')).toBeNull();
  });
});

describe('RegistrationRowReader', () => {
  it('leaves a value the form would refuse empty and reports it (D5)', async () => {
    const row = await rowOf(VENDOR_SHEET, {
      'Company Name': 'Fresh Farms',
      GSTN: '27ABCDE1234F1Y5',
      'Mobile Number': '12345',
      'Office Email': 'office@freshfarms.in',
      'Date Of Incorporation': '31-02-2024',
      Classification: 'Wholesaler of everything',
    });
    const draft = new DraftLinks();
    const reader = new RegistrationRowReader(VENDOR_SHEET, row, draft, { ownerKey: 'row-2' });

    expect(reader.text('GSTIN')).toBeNull(); // read through the old header, kept as an alias
    expect(reader.text('Mobile Number')).toBeNull();
    expect(reader.text('Office Email')).toBe('office@freshfarms.in');
    expect(reader.date('Date Of Incorporation')).toBeNull();
    expect(reader.value('Classification')).toBeNull();
    // Read twice, reported once
    reader.text('GSTIN');

    expect(draft.issues.map((issue) => issue.field)).toEqual([
      'GSTIN', 'Mobile Number', 'Date Of Incorporation', 'Classification',
    ]);
    expect(draft.issues[0]).toMatchObject({ typed: '27ABCDE1234F1Y5' });
    expect(draft.issues[0].suggestion).toContain('GSTIN');
  });

  it('refuses a mobile or email another record holds, but not the record\'s own (D4)', async () => {
    const pool = new ContactPool();
    pool.add('phone', '9876543210', { key: 'f1', label: 'FARM20260001 Ramesh Jadhav' });
    pool.add('email', 'Ramesh@Farm.in', { key: 'f1', label: 'FARM20260001 Ramesh Jadhav' });

    const row = await rowOf(FARMER_SHEET, {
      'First Name': 'Suresh',
      'Primary Mobile No': '9123456789',
      'Secondary Mobile No': '+91 98765 43210',
      Email: 'ramesh@farm.in',
    });

    const other = new DraftLinks();
    const reader = new RegistrationRowReader(FARMER_SHEET, row, other, { contacts: pool, ownerKey: 'row-2' });
    expect(reader.text('Primary Mobile No')).toBe('9123456789');
    expect(reader.text('Secondary Mobile No')).toBeNull();
    expect(reader.text('Email')).toBeNull();
    expect(other.issues.map((issue) => issue.suggestion)).toEqual([
      'Left empty: already used by FARM20260001 Ramesh Jadhav',
      'Left empty: already used by FARM20260001 Ramesh Jadhav',
    ]);

    // The same values on the farmer who has them are fine
    const own = new DraftLinks();
    const ownReader = new RegistrationRowReader(FARMER_SHEET, row, own, { contacts: pool, ownerKey: 'f1' });
    expect(ownReader.text('Secondary Mobile No')).toBe('9876543210');
    expect(own.issues).toEqual([]);

    // Once a row counts as saved, its values are taken
    reader.registerContacts({ key: 'row-2', label: 'row 2' });
    expect(pool.holder('phone', '9123456789', 'row-3')).toBe('row 2');
  });

  it('reports required cells left blank on a new record', async () => {
    const row = await rowOf(FARMER_SHEET, { 'First Name': 'Suresh' });
    const draft = new DraftLinks();
    new RegistrationRowReader(FARMER_SHEET, row, draft, { ownerKey: 'row-2' }).noteMissingRequired();
    expect(draft.issues).toEqual([{ field: 'Primary Mobile No', typed: EMPTY_LINK, suggestion: 'Required' }]);
  });
});

describe('mergeFilled (update by code, D3)', () => {
  it('copies only filled values, field by field in nested details', () => {
    const category = { id: 'c2', name: 'Mandi Supplier' };
    const target: Record<string, any> = {
      companyName: 'Fresh Farms',
      gstn: '27ABCDE1234F1Z5',
      category: { id: 'c1', name: 'Grower' },
      vendorSaleInfo: { id: 's1', mobileNumber: '9876543210', email: 'old@ff.in' },
      listOfAllProducts: [{ id: 'p1' }],
    };
    mergeFilled(target, {
      companyName: null,
      gstn: undefined,
      category,
      vendorSaleInfo: { mobileNumber: null, email: 'new@ff.in' },
      listOfAllProducts: [],
      officeAddress: { address1: null, city: null },
    });
    expect(target).toEqual({
      companyName: 'Fresh Farms',
      gstn: '27ABCDE1234F1Z5',
      category,
      vendorSaleInfo: { id: 's1', mobileNumber: '9876543210', email: 'new@ff.in' },
      listOfAllProducts: [{ id: 'p1' }],
    });
  });
});

describe('templates (D7, D9)', () => {
  function headersOf(sheet: ExcelJS.Worksheet): string[] {
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    return headers;
  }

  it.each([
    ['Vendors', VENDOR_SHEET],
    ['Customers', CUSTOMER_SHEET],
    ['Farmers', FARMER_SHEET],
  ])('%s: no document or photo columns, no underscore headers', (_name, sheet) => {
    const headers = headersOf(buildTemplateWorkbook(sheet as any).worksheets[0]);
    expect(headers.filter((header) => /Copy$|Photo$|Image$/.test(header))).toEqual([]);
    expect(headers.filter((header) => header.includes('_'))).toEqual([]);
  });
});
