/**
 * docs/user-import-plan.md: the Users sheet (registrations without permissions).
 * Exercises the planner on in-memory workbooks - no database.
 */

import 'reflect-metadata';
import ExcelJS from 'exceljs';

import { buildDataWorkbook, buildTemplateWorkbook } from '../../excel/excelFile.service';
import { ExcelRow, parseWorkbook } from '../../excel/excelImport.service';
import {
  EMPLOYEE_HEADERS as H,
  EMPLOYEE_SHEET,
  EmployeePlanContext,
  EmployeeRecord,
  employeeWorkbookLists,
  normaliseMobile,
  planEmployeeImport,
} from '../../employee/excel/employees';
import { findContactClashes } from '../../employee/employeeContacts';
import { nextEmployeeIds } from '../../employee/employeeIds';
import { hasAnyTick } from '../../employee/employeePermissions';
import { Role } from '../../employee/entity/user.entity';

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

async function rowsOf(data: Record<string, string | number | null>[]): Promise<ExcelRow[]> {
  const headers = EMPLOYEE_SHEET.columns.map((column) => column.header);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Users');
  sheet.addRow(headers);
  for (const row of data) sheet.addRow(headers.map((header) => row[header] ?? ''));
  return parseWorkbook(await reload(workbook), EMPLOYEE_SHEET).rows;
}

const context = (actorRoles: string[] = [Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN]): EmployeePlanContext => ({
  companies: [{ id: 'c1', name: 'Prime Fresh Limited' }],
  locations: [
    { id: 'b1', name: 'Nashik CC', kind: 'branch' },
    { id: 'b2', name: 'Pune DC', kind: 'branch' },
    { id: 'o1', name: 'Head Office', kind: 'office' },
  ],
  actor: { id: 'admin', roles: actorRoles },
});

const existingUser = (overrides: Partial<EmployeeRecord> = {}): EmployeeRecord => ({
  id: 'u1',
  employeeId: 'PF000001',
  firstName: 'Ravi',
  middleName: null,
  lastName: 'Patil',
  username: 'ravipatil',
  primaryMobNo: '9876543210',
  secondaryMobNo: null,
  primaryEmail: 'ravi@example.com',
  secondaryEmail: null,
  designation: 'Buyer',
  cugNo: '9000000001',
  workEmail: 'ravi@primefresh.in',
  joiningDate: '2025-04-01',
  department: ['procurement'],
  roles: [Role.EMPLOYEE, Role.VERIFIER],
  status: 'Active',
  isAddressSame: true,
  residentialAddress: { id: 'a1', address1: 'Plot 4', city: 'Nashik', state: 'Maharashtra', pincode: '422001' },
  permanentAddress: { id: 'a2', address1: 'Plot 4', city: 'Nashik', state: 'Maharashtra', pincode: '422001' },
  companies: [{ id: 'c1', name: 'Prime Fresh Limited' }],
  joining: { id: 'b1', name: 'Nashik CC', kind: 'branch' },
  current: { id: 'b1', name: 'Nashik CC', kind: 'branch' },
  otherWorkLocationInput: null,
  accessLocations: [{ id: 'b1', name: 'Nashik CC' }],
  permissionsSet: true,
  ...overrides,
});

const newRow = (overrides: Record<string, string | number | null> = {}) => ({
  [H.firstName]: 'Asha',
  [H.lastName]: 'Kulkarni',
  [H.username]: 'ashak',
  [H.primaryMobile]: '+91 91234-56789',
  [H.primaryEmail]: 'asha@example.com',
  [H.resAddress1]: 'Flat 2, Lane 5',
  [H.resCity]: 'Pune',
  [H.resState]: 'Maharashtra',
  [H.resPincode]: '411001',
  [H.sameAddress]: 'Yes',
  [H.company]: 'prime fresh limited',
  [H.department]: 'Sales, Operation',
  [H.joiningDate]: '01-06-2026',
  [H.joiningLocation]: 'Head Office',
  [H.currentLocation]: 'Pune DC',
  [H.accessLocations]: 'Pune DC, Nashik CC',
  [H.userType]: 'Standard User',
  [H.responsibilities]: 'Approver, Payment Manager',
  ...overrides,
});

describe('Users sheet', () => {
  it('leaves Employee ID, Status and Permissions Set out of the template', async () => {
    const template = await reload(buildTemplateWorkbook(EMPLOYEE_SHEET, employeeWorkbookLists(context())));
    const headers = headersOf(template.getWorksheet('Users')!);
    expect(headers).not.toContain(H.employeeId);
    expect(headers).not.toContain(H.status);
    expect(headers).not.toContain(H.permissionsSet);
    expect(headers).toContain(H.userType);
    expect(headers.some((header) => /permission/i.test(header))).toBe(false);
  });

  it('round-trips an export with no changes', async () => {
    const records = [existingUser()];
    const exported = await reload(buildDataWorkbook(EMPLOYEE_SHEET, records, employeeWorkbookLists(context())));
    const parsed = parseWorkbook(exported, EMPLOYEE_SHEET);
    expect(parsed.unknownColumns).toEqual([]);
    const plan = planEmployeeImport(parsed.rows, records, context());
    expect(plan.failed).toEqual([]);
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });
});

describe('cells Excel stores as objects', () => {
  it('reads an email Excel turned into a hyperlink, and rich text, as the text shown', async () => {
    const headers = EMPLOYEE_SHEET.columns.map((column) => column.header);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Users');
    sheet.addRow(headers);
    const row: Record<string, string | number | null> = newRow();
    sheet.addRow(headers.map((header) => row[header] ?? ''));
    const cell = (header: string) => sheet.getCell(2, headers.indexOf(header) + 1);
    cell(H.primaryEmail).value = { text: 'admin@pflemp.com', hyperlink: 'mailto:admin@pflemp.com' };
    cell(H.workEmail).value = { text: 'verifier1@pflemp.com', hyperlink: 'mailto:verifier1@pflemp.com' };
    cell(H.firstName).value = { richText: [{ text: 'As', font: { bold: true } }, { text: 'ha' }] };

    const rows = parseWorkbook(await reload(workbook), EMPLOYEE_SHEET).rows;
    const plan = planEmployeeImport(rows, [], context());
    expect(plan.failed).toEqual([]);
    expect(plan.creates[0].values).toMatchObject({
      primaryEmail: 'admin@pflemp.com',
      workEmail: 'verifier1@pflemp.com',
      firstName: 'Asha',
    });
  });
});

describe('planEmployeeImport: new users', () => {
  it('creates a user from a full row, with roles, links and a copied permanent address', async () => {
    const plan = planEmployeeImport(await rowsOf([newRow()]), [existingUser()], context());
    expect(plan.failed).toEqual([]);
    const [create] = plan.creates;
    expect(create.values).toMatchObject({
      primaryMobNo: '9123456789',
      companyIds: ['c1'],
      department: ['sale', 'operations'],
      joiningDate: '2026-06-01',
      joining: { id: 'o1', kind: 'office' },
      current: { id: 'b2', kind: 'branch' },
      accessIds: ['b2', 'b1'],
      isAddressSame: true,
    });
    expect(create.values.roles!.sort()).toEqual([Role.APPROVER, Role.EMPLOYEE, Role.PAYMENT_MANAGER].sort());
    expect(create.permanent).toEqual(create.residential);
  });

  it('takes "Other" with the place typed in Other Work Location', async () => {
    const plan = planEmployeeImport(
      await rowsOf([newRow({ [H.currentLocation]: 'Other', [H.otherLocation]: 'Lasalgaon mandi' })]),
      [],
      context(),
    );
    expect(plan.failed).toEqual([]);
    expect(plan.creates[0].values.current).toBeNull();
    expect(plan.creates[0].values.otherWorkLocationInput).toBe('Lasalgaon mandi');
  });

  it('lists every missing required cell of a new user', async () => {
    const plan = planEmployeeImport(await rowsOf([{ [H.firstName]: 'Asha' }]), [], context());
    expect(plan.creates).toEqual([]);
    const reason = plan.failed[0].reason;
    for (const header of [H.lastName, H.username, H.primaryMobile, H.primaryEmail, H.resAddress1, H.perAddress1, H.company, H.department, H.joiningDate, H.joiningLocation, H.currentLocation, H.accessLocations, H.userType]) {
      expect(reason).toContain(header);
    }
  });

  it('never creates companies or locations, and suggests the closest name', async () => {
    const plan = planEmployeeImport(
      await rowsOf([newRow({ [H.company]: 'Prime Fresh Ltd', [H.accessLocations]: 'Head Office, Nasik CC' })]),
      [],
      context(),
    );
    const reason = plan.failed[0].reason;
    expect(reason).toContain('"Prime Fresh Ltd" was not found - did you mean "Prime Fresh Limited"?');
    expect(reason).toContain('"Head Office" is an office');
    expect(reason).toContain('did you mean "Nashik CC"?');
  });

  it('rejects bad values the form rejects', async () => {
    const plan = planEmployeeImport(
      await rowsOf([
        newRow({
          [H.firstName]: 'A1',
          [H.username]: '98765432',
          [H.primaryMobile]: '5123456789',
          [H.primaryEmail]: 'asha@',
          [H.resPincode]: '4110',
          [H.department]: 'Sales, Logistics',
          [H.userType]: 'Manager',
        }),
      ]),
      [],
      context(),
    );
    const reason = plan.failed[0].reason;
    expect(reason).toContain(`${H.firstName} "A1" must have letters and spaces only`);
    expect(reason).toContain('only digits');
    expect(reason).toContain('starting with 6-9');
    expect(reason).toContain('is not an email address');
    expect(reason).toContain('must be 6 digits');
    expect(reason).toContain('"Logistics"');
    expect(reason).toContain(`${H.userType} must be one of`);
  });

  it('keeps responsibilities for Standard Users only', async () => {
    const plan = planEmployeeImport(await rowsOf([newRow({ [H.userType]: 'Admin' })]), [], context());
    expect(plan.failed[0].reason).toContain('Standard Users only');
  });

  it('lets only a Super Admin import a Super Admin', async () => {
    const row = newRow({ [H.userType]: 'Super Admin', [H.responsibilities]: null });
    const byAdmin = planEmployeeImport(await rowsOf([row]), [], context([Role.EMPLOYEE, Role.ADMIN]));
    expect(byAdmin.failed[0].reason).toContain('Only a Super Admin');
    const bySuperAdmin = planEmployeeImport(await rowsOf([row]), [], context());
    expect(bySuperAdmin.failed).toEqual([]);
    expect(bySuperAdmin.creates[0].values.roles).toEqual(expect.arrayContaining([Role.SUPER_ADMIN, Role.ADMIN]));
  });
});

describe('planEmployeeImport: unique username, mobiles and emails (D7)', () => {
  it('rejects a mobile another user has in any mobile column', async () => {
    // The existing user's CUG No is this row's Secondary Mobile.
    const plan = planEmployeeImport(
      await rowsOf([newRow({ [H.secondaryMobile]: '9000000001' })]),
      [existingUser()],
      context(),
    );
    expect(plan.failed[0].reason).toContain(`${H.secondaryMobile} "9000000001" is already used by user PF000001 Ravi Patil`);
  });

  it('reports the later of two rows sharing an email or username', async () => {
    const plan = planEmployeeImport(
      await rowsOf([
        newRow(),
        newRow({ [H.username]: 'ASHAK', [H.primaryMobile]: '9123400000', [H.workEmail]: 'Asha@Example.com', [H.primaryEmail]: 'asha2@example.com' }),
      ]),
      [],
      context(),
    );
    expect(plan.failed.map((issue) => issue.row)).toEqual([3]);
    expect(plan.failed[0].reason).toContain('Username "ASHAK" is already used by row 2');
    expect(plan.failed[0].reason).toContain('Work Email "Asha@Example.com" is already used by row 2');
  });

  it('allows one user to repeat a value across their own columns', () => {
    const clashes = findContactClashes([
      { key: 'x', label: 'row 2', row: 2, values: { primaryMobNo: '9123456789', cugNo: '9123456789' }, checked: ['primaryMobNo', 'cugNo'] },
    ]);
    expect(clashes).toEqual([]);
  });

  it('does not block an update over an old clash it leaves alone', async () => {
    const twin = existingUser({ id: 'u2', employeeId: 'PF000002', username: 'ravi2', primaryEmail: 'r2@example.com', workEmail: null, cugNo: null });
    const plan = planEmployeeImport(
      await rowsOf([{ [H.employeeId]: 'PF000001', [H.designation]: 'Senior Buyer' }]),
      [existingUser(), twin],
      context(),
    );
    expect(plan.failed).toEqual([]);
    expect(plan.updates[0].changes).toEqual({ designation: 'Senior Buyer' });
  });
});

describe('planEmployeeImport: existing users', () => {
  it('updates filled cells only and keeps the rest', async () => {
    const plan = planEmployeeImport(
      await rowsOf([{ [H.employeeId]: 'pf000001', [H.secondaryMobile]: '9811111111', [H.resCity]: 'Niphad' }]),
      [existingUser()],
      context(),
    );
    expect(plan.failed).toEqual([]);
    const [update] = plan.updates;
    expect(update.changes).toEqual({ secondaryMobNo: '9811111111' });
    expect(update.residential).toEqual({ id: 'a1', values: { city: 'Niphad' } });
    // Same as residential: the permanent address follows.
    expect(update.permanent).toEqual({ id: 'a2', values: { city: 'Niphad' } });
  });

  it('replaces responsibilities when Type of User is filled', async () => {
    const plan = planEmployeeImport(
      await rowsOf([{ [H.employeeId]: 'PF000001', [H.userType]: 'Standard User' }]),
      [existingUser()],
      context(),
    );
    expect(plan.updates[0].changes.roles).toEqual([Role.EMPLOYEE]);
  });

  it('rejects an unknown Employee ID and a user named twice', async () => {
    const plan = planEmployeeImport(
      await rowsOf([
        { [H.employeeId]: 'PF009999', [H.designation]: 'x' },
        { [H.employeeId]: 'PF000001', [H.designation]: 'a' },
        { [H.employeeId]: 'PF000001', [H.designation]: 'b' },
      ]),
      [existingUser()],
      context(),
    );
    expect(plan.failed.map((issue) => issue.row)).toEqual([2, 4]);
  });

  it('does not let the importer change their own type', async () => {
    const me = existingUser({ id: 'admin', roles: [Role.EMPLOYEE, Role.ADMIN] });
    const plan = planEmployeeImport(
      await rowsOf([{ [H.employeeId]: 'PF000001', [H.userType]: 'Standard User' }]),
      [me],
      context([Role.EMPLOYEE, Role.ADMIN]),
    );
    expect(plan.failed[0].reason).toContain('cannot change your own');
  });

  it('keeps one active Super Admin', async () => {
    const only = existingUser({ roles: [Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN] });
    const plan = planEmployeeImport(
      await rowsOf([{ [H.employeeId]: 'PF000001', [H.userType]: 'Admin' }]),
      [only],
      context(),
    );
    expect(plan.failed[0].reason).toContain('At least one active Super Admin');
  });

  it('lets only a Super Admin change a Super Admin account', async () => {
    const boss = existingUser({ roles: [Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN] });
    const plan = planEmployeeImport(
      await rowsOf([{ [H.employeeId]: 'PF000001', [H.designation]: 'Director' }]),
      [boss],
      context([Role.EMPLOYEE, Role.ADMIN]),
    );
    expect(plan.failed[0].reason).toContain('Only a Super Admin can change a Super Admin account');
  });
});

describe('helpers', () => {
  it('gives Employee IDs after the highest one, deleted users included', () => {
    expect(nextEmployeeIds(['PF000003', 'PF000010', null, 'X1'], 2)).toEqual(['PF000011', 'PF000012']);
    expect(nextEmployeeIds([], 1)).toEqual(['PF000001']);
  });

  it('reads mobiles the way the form does', () => {
    expect(normaliseMobile('+91 98765-43210')).toBe('9876543210');
    expect(normaliseMobile('1234567890')).toBeNull();
  });

  it('sees a permission row with any tick as set', () => {
    expect(hasAnyTick({ canView: true })).toBe(true);
    expect(hasAnyTick({ canView: false, canExport: false })).toBe(false);
  });
});
