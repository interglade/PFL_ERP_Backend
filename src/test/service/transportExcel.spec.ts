/**
 * Phase 7 of docs/master-data-excel-plan.md: Transporter, Driver and Vehicle
 * rows become the same body the forms send. These tests pin the row -> body
 * mapping and the transporter link; the body's own validation is the forms'
 * (transportRegistration.spec.ts and the module services).
 */

import 'reflect-metadata';
import ExcelJS from 'exceljs';

import { buildDataWorkbook, buildTemplateWorkbook } from '../../excel/excelFile.service';
import { ExcelRow, parseWorkbook } from '../../excel/excelImport.service';
import { ExcelSheetDefinition } from '../../excel/excelColumn';
import { DraftLinks } from '../../excel/draftLinks';
import { Status } from '../../utils/status.enum';
import {
  DRIVER_SHEET,
  driverRowBody,
  TRANSPORTER_SHEET,
  transporterIndexes,
  transporterRowBody,
  TransportRowContext,
  VEHICLE_SHEET,
  vehicleRowBody,
} from '../../transport/transportExcel';

async function reload(workbook: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer as ArrayBuffer);
  return reloaded;
}

function headersOf(sheet: ExcelJS.Worksheet): string[] {
  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
  return headers;
}

/** One row of the given sheet, from cells keyed by header. */
async function rowOf(def: ExcelSheetDefinition<any>, cells: Record<string, unknown>): Promise<ExcelRow> {
  const headers = def.columns.map((column) => column.header);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(def.sheetName);
  sheet.addRow(headers);
  sheet.addRow(headers.map((header) => cells[header] ?? ''));
  return parseWorkbook(await reload(workbook), def).rows[0];
}

const context = (): TransportRowContext => ({
  ...transporterIndexes([
    { id: 't1', name: 'Shree Logistics', transporterCode: 'TR-00001', status: Status.APPROVED },
    { id: 't2', name: 'Rapid Movers', transporterCode: 'TR-00002', status: Status.PENDING },
    { id: 't3', name: 'Old Fleet Co', transporterCode: 'TR-00003', status: Status.DRAFT },
  ]),
  draft: new DraftLinks(),
});

describe.each([
  ['Transporter', TRANSPORTER_SHEET, 'Transporter Code'],
  ['Driver', DRIVER_SHEET, 'Driver Code'],
  ['Vehicle', VEHICLE_SHEET, 'Vehicle Code'],
] as const)('%s sheet', (_name, sheet, codeHeader) => {
  it('leaves the code and the status out of the template, and has both on the export', async () => {
    const template = headersOf((await reload(buildTemplateWorkbook(sheet))).worksheets[0]);
    expect(template).not.toContain(codeHeader);
    expect(template).not.toContain('Status');

    const exported = headersOf((await reload(buildDataWorkbook(sheet, [{}]))).worksheets[0]);
    expect(exported).toContain(codeHeader);
    expect(exported).toContain('Status');
  });

  it('every exported header is one the importer recognises', async () => {
    const exported = await reload(buildDataWorkbook(sheet, [{}]));
    expect(parseWorkbook(exported, sheet).unknownColumns).toEqual([]);
  });
});

describe('transporter rows', () => {
  it('build the form body from the filled cells only', async () => {
    const row = await rowOf(TRANSPORTER_SHEET, {
      Name: 'Shree Logistics',
      'Transporter Type': 'Fleet Owner',
      'Primary Phone': 9876543210,
      City: 'Nashik',
      'Credit Days': 15,
    });
    expect(transporterRowBody(row)).toEqual({
      name: 'Shree Logistics',
      body: {
        name: 'Shree Logistics',
        transporterType: 'fleet-owner',
        primaryPhone: '9876543210',
        creditDays: '15',
        address: { city: 'Nashik' },
      },
    });
  });

  it('accept the stored type value too, and pass anything else on for the form to reject', async () => {
    const stored = await rowOf(TRANSPORTER_SHEET, { Name: 'A', 'Transporter Type': 'own-fleet' });
    expect(transporterRowBody(stored).body.transporterType).toBe('own-fleet');

    const unknown = await rowOf(TRANSPORTER_SHEET, { Name: 'A', 'Transporter Type': 'Agent' });
    expect(transporterRowBody(unknown).body.transporterType).toBe('Agent');
  });
});

describe('driver and vehicle rows', () => {
  it('link a transporter named by name or code', async () => {
    const byName = context();
    const row = await rowOf(DRIVER_SHEET, { 'First Name': 'Ravi', 'Phone Number': '9123456780', Transporter: 'shree logistics' });
    expect(driverRowBody(row, byName).body.transporterId).toBe('t1');
    expect(byName.draft.isDraft).toBe(false);

    const byCode = context();
    const vehicle = await rowOf(VEHICLE_SHEET, { 'Vehicle No': 'MH12AB1234', 'Vehicle Type': 'Tempo', Transporter: 'TR-00002' });
    expect(vehicleRowBody(vehicle, byCode).body.transporterId).toBe('t2');
  });

  it('leave a blank transporter empty without a draft - an independent driver or vehicle', async () => {
    const ctx = context();
    const row = await rowOf(VEHICLE_SHEET, { 'Vehicle No': 'MH12AB1234', 'Vehicle Type': 'Tempo' });
    expect(vehicleRowBody(row, ctx).body).not.toHaveProperty('transporterId');
    expect(ctx.draft.isDraft).toBe(false);
  });

  it('leave an unmatched transporter empty and make a draft, with the closest name', async () => {
    const ctx = context();
    const row = await rowOf(DRIVER_SHEET, { 'First Name': 'Ravi', 'Phone Number': '9123456780', Transporter: 'Shree Logistic' });
    expect(driverRowBody(row, ctx).body).not.toHaveProperty('transporterId');
    expect(ctx.draft.issues).toEqual([
      { field: 'Transporter', typed: 'Shree Logistic', suggestion: 'Shree Logistics' },
    ]);
  });

  it('do not link a draft transporter, and say why', async () => {
    const ctx = context();
    const row = await rowOf(VEHICLE_SHEET, { 'Vehicle No': 'MH12AB1234', 'Vehicle Type': 'Tempo', Transporter: 'Old Fleet Co' });
    expect(vehicleRowBody(row, ctx).body).not.toHaveProperty('transporterId');
    expect(ctx.draft.issues[0].suggestion).toBe(
      '"Old Fleet Co" is Draft - it can be linked once it is Approved or Pending',
    );
  });

  it('turn a licence expiry date cell into YYYY-MM-DD', async () => {
    const row = await rowOf(DRIVER_SHEET, {
      'First Name': 'Ravi',
      'Phone Number': '9123456780',
      'Licence Expiry': new Date(Date.UTC(2028, 2, 31)),
    });
    expect(driverRowBody(row, context()).body.licenseExpiry).toBe('2028-03-31');
  });

  it('offer approved and pending transporters in the dropdown, not drafts', () => {
    expect(context().pickable.displayNames()).toEqual(['Rapid Movers', 'Shree Logistics']);
  });
});
