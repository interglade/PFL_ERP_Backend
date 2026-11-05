/**
 * Sample files for the Excel import rehearsal (docs/master-data-excel-plan.md
 * Phase 8, docs/master-data-excel-rehearsal.md).
 *
 * One workbook per master, in the agreed import order, written from the real
 * sheet definitions so the headers always match what the importers read. Each
 * file holds clean rows plus deliberate mistakes, and every row says what the
 * rehearsal should see for it - created, draft, skipped, failed - so the run can
 * be checked against an expected result instead of by eye.
 */

import ExcelJS from 'exceljs';
import { ExcelSheetDefinition, groupHeader } from '../../excel/excelColumn';
import { buildTemplateWorkbook } from '../../excel/excelFile.service';
import { ImportMaster } from '../../excel/importPrerequisites';
import { NAMED_MASTERS } from '../../masterData/excel/namedMasters';
import { LOCATION_SHEET } from '../../masterData/excel/locations';
import { PRODUCT_SHEET } from '../../product/createproduct/excel/product.columns';
import { VENDOR_SHEET } from '../../vendor/createVendor/excel/vendor.columns';
import { CUSTOMER_SHEET } from '../../customer/addcustomer/excel/customer.columns';
import { FARMER_SHEET } from '../../farmer/excel/farmer.columns';
import { DRIVER_SHEET, TRANSPORTER_SHEET, VEHICLE_SHEET } from '../../transport/transportExcel';
import { EMPLOYEE_HEADERS, EMPLOYEE_SHEET } from '../../employee/excel/employees';

/** What the rehearsal should report for a row. */
export type Expected = 'created' | 'draft' | 'skipped' | 'failed';

export interface SampleRow {
  expect: Expected;
  /** Why - printed next to a row whose outcome differs. */
  why: string;
  cells: Record<string, string | number | Date>;
}

export interface SampleFile {
  master: ImportMaster;
  fileName: string;
  sheet: ExcelSheetDefinition<any>;
  /** Small masters are all or nothing: the file is checked first, then imported. */
  allOrNothing: boolean;
  rows: SampleRow[];
}

const ok = (why: string, cells: SampleRow['cells']): SampleRow => ({ expect: 'created', why, cells });
const draft = (why: string, cells: SampleRow['cells']): SampleRow => ({ expect: 'draft', why, cells });
const skip = (why: string, cells: SampleRow['cells']): SampleRow => ({ expect: 'skipped', why, cells });
const fail = (why: string, cells: SampleRow['cells']): SampleRow => ({ expect: 'failed', why, cells });

const named = (master: ImportMaster) => NAMED_MASTERS[master]!.sheet;

/**
 * In import order (§1). Small masters only hold clean rows: one bad row would
 * stop the whole file (D1), and their rejection paths are covered by the unit
 * tests - the "Check only" pass is what the rehearsal shows for them.
 */
export const SAMPLE_FILES: SampleFile[] = [
  // ── Level 1 ────────────────────────────────────────────────────────────────
  {
    master: 'uom',
    fileName: '01_uom.xlsx',
    sheet: named('uom'),
    allOrNothing: true,
    rows: [
      ok('base unit', { Unit: 'Kilogram', Abbreviation: 'kg', Description: 'Weight in kilograms' }),
      ok('count unit', { Unit: 'Piece', Abbreviation: 'pc' }),
      ok('packing unit', { Unit: 'Crate', Abbreviation: 'crt' }),
      ok('packing unit', { Unit: 'Box', Abbreviation: 'box' }),
    ],
  },
  {
    master: 'customer-type',
    fileName: '02_customer_types.xlsx',
    sheet: named('customer-type'),
    allOrNothing: true,
    rows: [
      ok('type', { 'Customer Type': 'Retail Chain' }),
      ok('type', { 'Customer Type': 'Wholesaler' }),
      ok('type', { 'Customer Type': 'Exporter' }),
    ],
  },
  {
    master: 'customer-category',
    fileName: '03_customer_categories.xlsx',
    sheet: named('customer-category'),
    allOrNothing: true,
    rows: [
      ok('category', { 'Customer Category': 'Modern Trade' }),
      ok('category', { 'Customer Category': 'General Trade' }),
    ],
  },
  {
    master: 'vendor-category',
    fileName: '04_vendor_categories.xlsx',
    sheet: named('vendor-category'),
    allOrNothing: true,
    rows: [
      ok('the client\'s example', { 'Vendor Category': 'Mandi Supplier' }),
      ok('category', { 'Vendor Category': 'Commission Agent' }),
      ok('category', { 'Vendor Category': 'Packing Supplier' }),
    ],
  },
  {
    master: 'product-classification',
    fileName: '05_product_classifications.xlsx',
    sheet: named('product-classification'),
    allOrNothing: true,
    rows: [
      ok('classification', { Classification: 'Fresh' }),
      ok('classification', { Classification: 'Exotic' }),
    ],
  },
  {
    master: 'transporter',
    fileName: '06_transporters.xlsx',
    sheet: TRANSPORTER_SHEET,
    allOrNothing: false,
    rows: [
      ok('fleet owner', {
        Name: 'Shree Logistics', 'Transporter Type': 'Fleet Owner', 'Primary Phone': '9876500001',
        City: 'Nashik', State: 'Maharashtra', Pincode: '422001',
      }),
      ok('broker', { Name: 'Rapid Movers', 'Transporter Type': 'Broker', 'Primary Phone': '+91 98765-00002' }),
      draft('no Transporter Type - the form requires one', { Name: 'Local Tempo Union', 'Primary Phone': '9876500003' }),
      fail('phone is not a mobile number', { Name: 'Bad Phone Transport', 'Transporter Type': 'Broker', 'Primary Phone': '12345' }),
      skip('same name and phone as row 2', { Name: 'shree logistics', 'Transporter Type': 'Fleet Owner', 'Primary Phone': '9876500001' }),
    ],
  },

  // ── Level 2 ────────────────────────────────────────────────────────────────
  {
    master: 'vendor-subcategory',
    fileName: '07_vendor_subcategories.xlsx',
    sheet: named('vendor-subcategory'),
    allOrNothing: true,
    rows: [
      ok('under Mandi Supplier', { 'Vendor Category': 'Mandi Supplier', 'Vendor Subcategory': 'Local Mandi' }),
      ok('under Mandi Supplier', { 'Vendor Category': 'Mandi Supplier', 'Vendor Subcategory': 'Outstation Mandi' }),
      ok('same name, other category', { 'Vendor Category': 'Commission Agent', 'Vendor Subcategory': 'Local Mandi' }),
    ],
  },
  {
    master: 'product-category',
    fileName: '08_product_categories.xlsx',
    sheet: named('product-category'),
    allOrNothing: true,
    rows: [
      ok('category', { Classification: 'Fresh', 'Product Category': 'Fruits' }),
      ok('category', { Classification: 'Fresh', 'Product Category': 'Vegetables' }),
      ok('category', { Classification: 'Exotic', 'Product Category': 'Exotic Fruits' }),
    ],
  },
  {
    master: 'packaging-material',
    fileName: '09_packaging_materials.xlsx',
    sheet: named('packaging-material'),
    allOrNothing: true,
    rows: [
      ok('UoM by abbreviation', {
        'Packaging Material Name': 'Plastic Crate', 'Use For': 'For Purchase', 'Reference UoM': 'kg',
        'Packaging Material Weight': 1.5, 'Quantity Per Package': 20,
      }),
      ok('same name for sale is a second record', {
        'Packaging Material Name': 'Plastic Crate', 'Use For': 'For Sale', 'Reference UoM': 'Kilogram', 'Quantity Per Package': 20,
      }),
      ok('UoM by unit', { 'Packaging Material Name': 'Corrugated Box', 'Use For': 'For Sale', 'Reference UoM': 'Box', 'Quantity Per Package': 10 }),
    ],
  },
  {
    master: 'driver',
    fileName: '10_drivers.xlsx',
    sheet: DRIVER_SHEET,
    allOrNothing: false,
    rows: [
      ok('linked by transporter name', {
        'First Name': 'Ravi', 'Last Name': 'Patil', 'Phone Number': '9123400001',
        'Licence No': 'MH1520200001234', 'Licence Type': 'HMV', 'Licence Expiry': new Date(Date.UTC(2029, 2, 31)),
        Transporter: 'Shree Logistics',
      }),
      ok('independent - no transporter', { 'First Name': 'Sunil', 'Phone Number': '9123400002' }),
      draft('"Shree Logistic" does not match - suggests Shree Logistics', {
        'First Name': 'Ganesh', 'Phone Number': '9123400003', Transporter: 'Shree Logistic',
      }),
      draft('Local Tempo Union is a draft - cannot be linked yet', {
        'First Name': 'Mahesh', 'Phone Number': '9123400004', Transporter: 'Local Tempo Union',
      }),
      skip('phone already used by row 2', { 'First Name': 'Ravi', 'Phone Number': '9123400001' }),
    ],
  },
  {
    master: 'vehicle',
    fileName: '11_vehicles.xlsx',
    sheet: VEHICLE_SHEET,
    allOrNothing: false,
    rows: [
      ok('linked by transporter code', {
        'Vehicle No': 'MH 15 AB 1234', 'Vehicle Type': '6-wheeler truck', 'Capacity (Kg)': 9000, Transporter: 'TR-00001',
      }),
      ok('independent', { 'Vehicle No': 'MH12CD5678', 'Vehicle Type': 'Tempo' }),
      fail('not a vehicle number', { 'Vehicle No': 'TRUCK-1', 'Vehicle Type': 'Tempo' }),
      skip('same number as row 2, typed differently', { 'Vehicle No': 'mh-15-ab-1234', 'Vehicle Type': 'Tempo' }),
    ],
  },
  {
    master: 'location',
    fileName: '12_locations.xlsx',
    sheet: LOCATION_SHEET,
    allOrNothing: true,
    rows: [
      ok('registered office', {
        'Location Type': 'Registered Office', Name: 'Prime Fresh House', Email: 'office@example.com',
        'Address 1': 'Plot 4, MIDC', Pincode: '400001', City: 'Mumbai', State: 'Maharashtra',
      }),
      ok('CC; City and State come from the pincode', {
        'Location Type': 'CC', Name: 'Nashik CC', Prefix: 'nsk', 'Total Capacity': 100, 'Current Capacity': 40,
        'Address 1': 'APMC Market Yard', Pincode: '422001',
      }),
      ok('DC', {
        'Location Type': 'Distribution Center (DC)', Name: 'Pune DC', Prefix: 'PDC',
        'Address 1': 'Gultekdi', Pincode: '411037', City: 'Pune', State: 'Maharashtra',
      }),
    ],
  },
  {
    master: 'customer',
    fileName: '13_customers.xlsx',
    sheet: CUSTOMER_SHEET,
    allOrNothing: false,
    rows: [
      ok('type and category match', customer('FreshMart Retail', 'Retail Chain', 'Modern Trade')),
      ok('type and category are optional', customer('Corner Store', '', '')),
      draft('"Wholesalers" does not match - suggests Wholesaler', customer('City Wholesale', 'Wholesalers', 'General Trade')),
      draft('no delivery address - saved as draft, listed as Required', { 'Organisation Name': 'No Address Ltd', 'Billing Address1': 'x', 'Billing City': 'Pune', 'Billing State': 'Maharashtra', 'Billing Pincode': '411001' }),
    ],
  },

  // ── Level 3 ────────────────────────────────────────────────────────────────
  {
    master: 'product-subcategory',
    fileName: '14_product_subcategories.xlsx',
    sheet: named('product-subcategory'),
    allOrNothing: true,
    rows: [
      ok('subcategory', { 'Product Category': 'Fruits', 'Product Subcategory': 'Citrus' }),
      ok('subcategory', { 'Product Category': 'Fruits', 'Product Subcategory': 'Berries' }),
      ok('subcategory', { 'Product Category': 'Vegetables', 'Product Subcategory': 'Leafy' }),
      ok('subcategory', { 'Product Category': 'Vegetables', 'Product Subcategory': 'Root' }),
    ],
  },

  // ── Level 4 ────────────────────────────────────────────────────────────────
  {
    master: 'product',
    fileName: '15_products.xlsx',
    sheet: PRODUCT_SHEET,
    allOrNothing: false,
    rows: [
      ok('everything matches', product('Orange', 'ORA', 'kg', 'Fresh', 'Fruits', 'Citrus')),
      ok('classification taken from the category', product('Strawberry', 'STR', 'Kilogram', '', 'Fruits', 'Berries')),
      ok('Spinach', product('Spinach', 'SPN', 'kg', 'Fresh', 'Vegetables', 'Leafy')),
      ok('Onion', product('Onion', 'ONI', 'kg', 'Fresh', 'Vegetables', 'Root')),
      ok('saved, but "Leafy" is under Vegetables - reported, left empty', product('Kiwi', 'KIW', 'kg', 'Exotic', 'Exotic Fruits', 'Leafy')),
      skip('UoM "Kilogrm" does not match', product('Potato', 'POT', 'Kilogrm', 'Fresh', 'Vegetables', 'Root')),
      skip('already in this file', product('ORANGE', 'ORA', 'kg', 'Fresh', 'Fruits', 'Citrus')),
    ],
  },

  // ── Level 5 ────────────────────────────────────────────────────────────────
  {
    master: 'vendor',
    fileName: '16_vendors.xlsx',
    sheet: VENDOR_SHEET,
    allOrNothing: false,
    rows: [
      ok('every link matches', vendor('Sai Agro Traders', 'Mandi Supplier', 'Local Mandi', 'Onion', 'Onion, Spinach', 'Plastic Crate')),
      draft('the client\'s example: "Mandi Sus" - suggests Mandi Supplier', vendor('Shree Traders', 'Mandi Sus', '', 'Onion', '', '')),
      draft('"Potatoes" in the product list does not match', vendor('Green Valley Farms', 'Commission Agent', 'Local Mandi', 'Spinach', 'Spinach, Potatoes', '')),
      draft('no Vendor Category', vendor('Unknown Supplier', '', '', '', '', '')),
      skip('already in this file', vendor('SAI AGRO TRADERS', 'Mandi Supplier', '', '', '', '')),
      draft('bad GSTIN and mobile left empty (registration-import-plan D5)', {
        ...vendor('Krishna Fruits', 'Mandi Supplier', '', '', '', ''),
        GSTIN: '27ABC', 'Mobile Number': '12345',
      }),
    ],
  },
  {
    master: 'farmer',
    fileName: '17_farmers.xlsx',
    sheet: FARMER_SHEET,
    allOrNothing: false,
    rows: [
      ok('crop matches', farmer('Ramesh', 'Jadhav', '9000000001', ['Onion'])),
      draft('"Onoin" does not match - suggests Onion', farmer('Suresh', 'More', '9000000002', ['Onion', 'Onoin'])),
      skip('mobile already used by row 2', farmer('Ramesh', 'J', '9000000001', [])),
    ],
  },

  // ── Users (docs/user-import-plan.md): need the company "Prime Fresh Limited" on the Company page ──
  {
    master: 'user',
    fileName: '18_users.xlsx',
    sheet: EMPLOYEE_SHEET,
    allOrNothing: true,
    rows: [
      ok('standard user with responsibilities; saved Inactive, no permissions', user('Asha', 'Kulkarni', 'ashak', '9123456781', {
        [EMPLOYEE_HEADERS.responsibilities]: 'Approver, Payment Manager',
      })),
      ok('admin working at "Other"', user('Vikram', 'Desai', 'vikramd', '9123456782', {
        [EMPLOYEE_HEADERS.userType]: 'Admin',
        [EMPLOYEE_HEADERS.currentLocation]: 'Other',
        [EMPLOYEE_HEADERS.otherLocation]: 'Lasalgaon mandi',
      })),
    ],
  },
];

function user(
  first: string,
  last: string,
  username: string,
  mobile: string,
  extra: SampleRow['cells'] = {},
): SampleRow['cells'] {
  const H = EMPLOYEE_HEADERS;
  return {
    [H.firstName]: first,
    [H.lastName]: last,
    [H.username]: username,
    [H.primaryMobile]: mobile,
    [H.primaryEmail]: `${username}@pfl-rehearsal.test`,
    [H.resAddress1]: 'Flat 2, Lane 5',
    [H.resCity]: 'Pune',
    [H.resState]: 'Maharashtra',
    [H.resPincode]: '411001',
    [H.sameAddress]: 'Yes',
    [H.company]: 'Prime Fresh Limited',
    [H.department]: 'Procurement',
    [H.joiningDate]: '01-06-2026',
    [H.joiningLocation]: 'Nashik CC',
    [H.currentLocation]: 'Pune DC',
    [H.accessLocations]: 'Nashik CC, Pune DC',
    [H.userType]: 'Standard User',
    ...extra,
  };
}

function customer(name: string, type: string, category: string): SampleRow['cells'] {
  const address = (prefix: string) => ({
    [`${prefix} Address1`]: 'Shop 12, Market Road',
    [`${prefix} City`]: 'Pune',
    [`${prefix} State`]: 'Maharashtra',
    [`${prefix} Pincode`]: '411001',
  });
  return {
    'Organisation Name': name,
    ...(type ? { 'Customer Type': type } : {}),
    ...(category ? { 'Customer Category': category } : {}),
    'Primary Contact No': '9800000001',
    ...address('Billing'),
    ...address('Delivery'),
  };
}

function product(
  name: string, prefix: string, uom: string, classification: string, category: string, subcategory: string,
): SampleRow['cells'] {
  return {
    'Product Name': name,
    'Product Code Prefix': prefix,
    UOM: uom,
    ...(classification ? { Classification: classification } : {}),
    ...(category ? { Category: category } : {}),
    ...(subcategory ? { Subcategory: subcategory } : {}),
  };
}

function vendor(
  name: string, category: string, subcategory: string, mainProduct: string, products: string, packing: string,
): SampleRow['cells'] {
  const cells: SampleRow['cells'] = { 'Company Name': name };
  if (category) cells['Vendor Category'] = category;
  if (subcategory) cells['Vendor Subcategory'] = subcategory;
  if (mainProduct) cells['Main Product'] = mainProduct;
  if (products) cells['List Of All Products'] = products;
  if (packing) cells['Main Packing Material'] = packing;
  return cells;
}

function farmer(first: string, last: string, mobile: string, crops: string[]): SampleRow['cells'] {
  const cells: SampleRow['cells'] = { 'First Name': first, 'Last Name': last, 'Primary Mobile No': mobile };
  crops.forEach((crop, index) => {
    cells[groupHeader({ prefix: 'Crop' }, index + 1, 'Crop')] = crop;
  });
  return cells;
}

/**
 * The sample as an .xlsx: the real template (headers, Instructions, dropdowns)
 * with the rows filled in. Cells for headers the template lacks are an error -
 * it means the sample has drifted from the sheet definition.
 */
export async function buildSampleWorkbook(file: SampleFile): Promise<ExcelJS.Workbook> {
  const workbook = buildTemplateWorkbook(file.sheet);
  const sheet = workbook.worksheets[0];

  const columnOf = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, column) => columnOf.set(String(cell.value), column));

  file.rows.forEach((sample, index) => {
    const row = sheet.getRow(index + 2);
    for (const [header, value] of Object.entries(sample.cells)) {
      const column = columnOf.get(header);
      if (!column) throw new Error(`${file.fileName}: the template has no "${header}" column`);
      row.getCell(column).value = value;
    }
    row.commit();
  });

  return workbook;
}
