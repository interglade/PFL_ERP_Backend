/**
 * Phase 4 of docs/master-data-excel-plan.md: one Locations sheet for offices
 * and CC / DC / SCC / Warehouse, with the address on the same row.
 * Exercises the planner on in-memory workbooks - no database, no pincode API.
 */

import 'reflect-metadata';
import ExcelJS from 'exceljs';

import { buildDataWorkbook, buildTemplateWorkbook } from '../../excel/excelFile.service';
import { ExcelRow, parseWorkbook } from '../../excel/excelImport.service';
import {
  findLocationType,
  LOCATION_HEADERS as H,
  LOCATION_SHEET,
  LocationPlanContext,
  LocationRecord,
  normalisePhone,
  pincodesToLookUp,
  planLocationImport,
} from '../../masterData/excel/locations';

async function reload(workbook: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer as ArrayBuffer);
  return reloaded;
}

function headersOf(sheet: ExcelJS.Worksheet): string[] {
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber - 1] = String(cell.value ?? '');
  });
  return headers;
}

/** Rows from objects keyed by header; missing headers are blank. */
async function rowsOf(data: Record<string, string | number | null>[]): Promise<ExcelRow[]> {
  const headers = LOCATION_SHEET.columns.map((column) => column.header);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Locations');
  sheet.addRow(headers);
  for (const row of data) sheet.addRow(headers.map((header) => row[header] ?? ''));
  return parseWorkbook(await reload(workbook), LOCATION_SHEET).rows;
}

const address = (pincode: string, city = 'Nashik', state = 'Maharashtra') => ({
  id: `a-${pincode}`,
  address1: 'Plot 4, Market Yard',
  address2: null,
  location: null,
  city,
  state,
  pincode,
});

const existingLocations = (): LocationRecord[] => [
  {
    id: 'o1',
    kind: 'office',
    type: 'registered-office',
    name: 'Prime Fresh House',
    prefix: null,
    cFirstName: null,
    cMiddleName: null,
    cLastName: null,
    contactNumber: '9876543210',
    officeEmail: 'office@primefresh.in',
    totalCapacity: null,
    currentCapacity: null,
    balanceCapacity: null,
    notes: null,
    address: address('400001', 'Mumbai'),
  },
  {
    id: 'b1',
    kind: 'branch',
    type: 'collection-center',
    name: 'Nashik CC',
    prefix: 'NSK',
    cFirstName: 'Ravi',
    cMiddleName: null,
    cLastName: 'Patil',
    contactNumber: '9123456780',
    officeEmail: null,
    totalCapacity: 100,
    currentCapacity: 40,
    balanceCapacity: 60,
    notes: null,
    address: address('422001'),
  },
];

const context = (overrides: Partial<LocationPlanContext> = {}): LocationPlanContext => ({
  prefixUseCount: new Map(),
  pincodes: new Map([['411001', { city: 'Pune', state: 'Maharashtra' }]]),
  ...overrides,
});

const newCc = (overrides: Record<string, string | number | null> = {}) => ({
  [H.type]: 'CC',
  [H.name]: 'Pune CC',
  [H.prefix]: 'pun',
  [H.address1]: 'Gultekdi Market',
  [H.pincode]: '411001',
  ...overrides,
});

describe('Locations sheet', () => {
  it('leaves Balance Capacity and the Record ID out of the template', async () => {
    const template = await reload(buildTemplateWorkbook(LOCATION_SHEET));
    const headers = headersOf(template.worksheets[0]);
    expect(headers).not.toContain(H.balance);
    expect(headers).not.toContain(H.recordId);
    expect(headers[0]).toBe(H.type);
  });

  it('re-importing its own export changes nothing', async () => {
    const existing = existingLocations();
    const exported = await reload(buildDataWorkbook(LOCATION_SHEET, existing));
    const rows = parseWorkbook(exported, LOCATION_SHEET).rows;
    const plan = planLocationImport(rows, existing, context());
    expect(plan).toMatchObject({ creates: [], updates: [], unchanged: 2, failed: [] });
  });

  it('accepts the short type names', () => {
    expect(findLocationType('cc')?.value).toBe('collection-center');
    expect(findLocationType('Seasonal CC')?.value).toBe('seasonal-collection-center');
    expect(findLocationType('WH')?.value).toBe('warehouse');
    expect(findLocationType('corporate office')?.kind).toBe('office');
    expect(findLocationType('Depot')).toBeNull();
  });

  it('cleans phone numbers', () => {
    expect(normalisePhone('+91 98765-43210')).toBe('9876543210');
    expect(normalisePhone('919876543210')).toBe('9876543210');
    expect(normalisePhone('12345')).toBeNull();
  });
});

describe('Locations import plan', () => {
  it('creates a branch with its address, City and State from the pincode', async () => {
    const plan = planLocationImport(await rowsOf([newCc({ [H.total]: 80, [H.current]: 30 })]), existingLocations(), context());

    expect(plan.failed).toEqual([]);
    expect(plan.filledFromPincode).toBe(1);
    expect(plan.creates).toEqual([
      {
        row: 2,
        kind: 'branch',
        type: 'collection-center',
        values: { name: 'Pune CC', prefix: 'PUN', totalCapacity: 80, currentCapacity: 30, balanceCapacity: 50 },
        address: { address1: 'Gultekdi Market', pincode: '411001', city: 'Pune', state: 'Maharashtra' },
      },
    ]);
  });

  it('only asks for the pincode lookup where City or State is empty', async () => {
    const rows = await rowsOf([
      newCc(),
      newCc({ [H.name]: 'Other', [H.pincode]: '422001', [H.city]: 'Nashik', [H.state]: 'Maharashtra' }),
    ]);
    expect(pincodesToLookUp(rows)).toEqual(['411001']);
  });

  it('needs the full address, a prefix and a type for a new location', async () => {
    const plan = planLocationImport(
      await rowsOf([
        newCc({ [H.prefix]: null, [H.address1]: null }),
        newCc({ [H.pincode]: '999999' }), // lookup found nothing
        { [H.name]: 'Somewhere', [H.address1]: 'x', [H.pincode]: '411001' },
      ]),
      existingLocations(),
      context({ pincodes: new Map([['411001', { city: 'Pune', state: 'Maharashtra' }], ['999999', null]]) }),
    );

    expect(plan.failed).toEqual([
      {
        row: 2,
        reason:
          'Prefix is needed for a new branch - it starts its GRN numbers; Address 1 is needed for a new location',
      },
      {
        row: 3,
        reason:
          'City is needed - the pincode lookup could not fill it in; State is needed - the pincode lookup could not fill it in',
      },
      { row: 4, reason: 'Location Type is needed for a new location' },
    ]);
  });

  it('keeps branch-only and office-only columns apart', async () => {
    const plan = planLocationImport(
      await rowsOf([
        newCc({ [H.email]: 'cc@primefresh.in' }),
        {
          [H.type]: 'Corporate Office',
          [H.name]: 'Pune HO',
          [H.prefix]: 'PHO',
          [H.total]: 10,
          [H.address1]: 'FC Road',
          [H.pincode]: '411001',
        },
      ]),
      existingLocations(),
      context(),
    );
    expect(plan.failed.map((issue) => issue.reason)).toEqual([
      'Email is only kept for offices - leave it empty for a branch',
      'Prefix is only used by branches - leave it empty for an office; ' +
        'Total Capacity is only kept for branches - leave it empty for an office',
    ]);
  });

  it('checks phone, email, pincode and capacity values', async () => {
    const plan = planLocationImport(
      await rowsOf([
        newCc({ [H.phone]: '12345', [H.pincode]: '41100', [H.total]: 10, [H.current]: 20 }),
        {
          [H.type]: 'Registered Office',
          [H.name]: 'RO 2',
          [H.email]: 'not-an-email',
          [H.address1]: 'x',
          [H.pincode]: '411001',
        },
      ]),
      existingLocations(),
      context(),
    );
    expect(plan.failed).toEqual([
      {
        row: 2,
        reason:
          'Contact Number "12345" is not a 10-digit number; Pincode "41100" must be 6 digits; ' +
          'Current Capacity cannot be more than Total Capacity',
      },
      { row: 3, reason: 'Email "not-an-email" is not an email address' },
    ]);
  });

  it('updates an existing branch found by name within its type, keeping blank cells', async () => {
    const plan = planLocationImport(
      await rowsOf([{ [H.type]: 'Collection Center (CC)', [H.name]: 'nashik cc', [H.current]: 70, [H.address2]: 'Gate 2' }]),
      existingLocations(),
      context(),
    );
    expect(plan.failed).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].changes).toEqual({ currentCapacity: 70, balanceCapacity: 30 });
    expect(plan.updates[0].addressChanges).toEqual({ address2: 'Gate 2' });
  });

  it('treats the same name under another type as a new location', async () => {
    const plan = planLocationImport(
      await rowsOf([newCc({ [H.type]: 'DC', [H.name]: 'Nashik CC', [H.prefix]: 'NDC' })]),
      existingLocations(),
      context(),
    );
    expect(plan.failed).toEqual([]);
    expect(plan.creates).toHaveLength(1);
  });

  it('refuses to change the type of an existing location', async () => {
    const plan = planLocationImport(
      await rowsOf([{ [H.recordId]: 'b1', [H.type]: 'DC', [H.name]: 'Nashik CC' }]),
      existingLocations(),
      context(),
    );
    expect(plan.failed[0].reason).toBe(
      'This location is a Collection Center (CC); its type cannot be changed by an import',
    );
  });

  it('locks a prefix that GRN numbers already use (D5)', async () => {
    const rows = await rowsOf([{ [H.recordId]: 'b1', [H.name]: 'Nashik CC', [H.prefix]: 'NSH' }]);

    const locked = planLocationImport(rows, existingLocations(), context({ prefixUseCount: new Map([['b1', 3]]) }));
    expect(locked.failed[0].reason).toBe(
      'Prefix NSK is already in 3 GRN number(s), so the import cannot change it',
    );

    const free = planLocationImport(rows, existingLocations(), context());
    expect(free.failed).toEqual([]);
    expect(free.updates[0].changes).toEqual({ prefix: 'NSH' });
  });

  it('keeps prefixes unique across branches and names unique within a type', async () => {
    const plan = planLocationImport(
      await rowsOf([
        newCc({ [H.prefix]: 'nsk' }),
        newCc({ [H.name]: 'Pune CC 2', [H.prefix]: 'PN2' }),
        newCc({ [H.name]: 'PUNE-CC', [H.prefix]: 'PN3' }),
      ]),
      existingLocations(),
      context(),
    );
    expect(plan.failed).toEqual([
      { row: 2, reason: 'Prefix NSK is already used by the existing location "Nashik CC"' },
      { row: 4, reason: '"PUNE-CC" is already used by row 2 (Collection Center (CC))' },
    ]);
  });

  it('fills City and State from a changed pincode, but keeps them when the pincode stays', async () => {
    const plan = planLocationImport(
      await rowsOf([
        { [H.recordId]: 'b1', [H.name]: 'Nashik CC', [H.pincode]: '411001' },
        { [H.recordId]: 'o1', [H.name]: 'Prime Fresh House', [H.pincode]: '400001' },
      ]),
      existingLocations(),
      context(),
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].addressChanges).toEqual({ pincode: '411001', city: 'Pune' });
    expect(plan.unchanged).toBe(1);
  });
});
