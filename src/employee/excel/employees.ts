/**
 * The Users sheet: user registrations without permissions
 * (docs/user-import-plan.md, decisions agreed 2026-11-03).
 *
 * All or nothing, like the small masters: every row is checked first and the
 * file is saved only when no row is wrong. The planner here does not touch the
 * database; the service hands it the current users, companies and locations.
 *
 * Permissions are never read or written. New users are saved Inactive; the
 * admin sets Permission Configuration on each one and then activates them.
 */

import { ExcelColumn, ExcelSheetDefinition } from '../../excel/excelColumn';
import { ExcelRow, ImportIssue } from '../../excel/excelImport.service';
import { LookupIndex } from '../../excel/lookupIndex';
import { normaliseName } from '../../excel/lookupByName';
import { formatBooleanCell, fromList, toBoolean, toDateOnlyString, toList } from '../../excel/excelValue';
import { normalizeRoles } from '../../utils/roles';
import { Role } from '../entity/user.entity';
import { Department } from '../../utils/status.enum';
import { CONTACT_FIELDS, CONTACT_LABELS, ContactOwner, findContactClashes } from '../employeeContacts';

// ─── Choices ────────────────────────────────────────────────────────────────

/** The form's department list (labels as shown there), stored lower case like `createUser` does. */
export const DEPARTMENTS: { value: string; label: string; aliases?: string[] }[] = [
  { value: Department.PROCUREMENT, label: 'Procurement' },
  { value: Department.SALE, label: 'Sales', aliases: ['Sale'] },
  { value: Department.OPERATIONS, label: 'Operation', aliases: ['Operations'] },
  { value: Department.QUALITY_CHECKING, label: 'Quality Checking' },
  { value: Department.BUSINESS_DEVELOPMENT, label: 'Business Development' },
  { value: Department.BRANDING_MARKETING, label: 'Branding & Marketing' },
  { value: Department.EXPORTS, label: 'Exports' },
  { value: Department.FARMING, label: 'Farming' },
  { value: Department.ACCOUNTS, label: 'Accounts' },
  { value: Department.FINANCE, label: 'Finance' },
  { value: Department.HR, label: 'HR' },
  { value: Department.IT, label: 'IT' },
  { value: Department.ADMIN, label: 'Administration', aliases: ['Admin'] },
  { value: Department.OTHER, label: 'Other' },
];

export const USER_TYPES = [
  { label: 'Standard User', role: null },
  { label: 'Admin', role: Role.ADMIN },
  { label: 'Super Admin', role: Role.SUPER_ADMIN },
] as const;

export const RESPONSIBILITIES: { role: Role; label: string }[] = [
  { role: Role.VERIFIER, label: 'Verifier' },
  { role: Role.APPROVER, label: 'Approver' },
  { role: Role.FINALIZER, label: 'Finalizer' },
  { role: Role.PAYMENT_MANAGER, label: 'Payment Manager' },
];

/** Typed in Current Work Location when the user works somewhere that is not a location. */
export const OTHER_LOCATION = 'Other';

// ─── Records ────────────────────────────────────────────────────────────────

export interface NamedRef {
  id: string;
  name: string;
}

export interface LocationRef extends NamedRef {
  kind: 'branch' | 'office';
}

export const ADDRESS_FIELDS = ['address1', 'address2', 'location', 'city', 'state', 'pincode'] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];
export type AddressValues = Partial<Record<AddressField, string>>;

export interface EmployeeAddress extends AddressValues {
  id: string;
}

/** A user flattened to the shape the sheet works with. */
export interface EmployeeRecord {
  id: string;
  employeeId: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  username: string | null;
  primaryMobNo: string | null;
  secondaryMobNo: string | null;
  primaryEmail: string | null;
  secondaryEmail: string | null;
  designation: string | null;
  cugNo: string | null;
  workEmail: string | null;
  /** yyyy-MM-dd */
  joiningDate: string | null;
  department: string[];
  roles: string[];
  status: string;
  isAddressSame: boolean | null;
  residentialAddress: EmployeeAddress | null;
  permanentAddress: EmployeeAddress | null;
  companies: NamedRef[];
  joining: LocationRef | null;
  current: LocationRef | null;
  otherWorkLocationInput: string | null;
  accessLocations: NamedRef[];
  /** Any permission tick at all. Export only. */
  permissionsSet: boolean;
}

// ─── Sheet ──────────────────────────────────────────────────────────────────

export const EMPLOYEE_HEADERS = {
  employeeId: 'Employee ID',
  firstName: 'First Name',
  middleName: 'Middle Name',
  lastName: 'Last Name',
  username: 'Username',
  primaryMobile: 'Primary Mobile',
  secondaryMobile: 'Secondary Mobile',
  primaryEmail: 'Primary Email',
  secondaryEmail: 'Secondary Email',
  resAddress1: 'Residential Address 1',
  resAddress2: 'Residential Address 2',
  resLocation: 'Residential Location',
  resCity: 'Residential City',
  resState: 'Residential State',
  resPincode: 'Residential Pincode',
  sameAddress: 'Permanent Same As Residential',
  perAddress1: 'Permanent Address 1',
  perAddress2: 'Permanent Address 2',
  perLocation: 'Permanent Location',
  perCity: 'Permanent City',
  perState: 'Permanent State',
  perPincode: 'Permanent Pincode',
  company: 'Company',
  department: 'Department',
  joiningDate: 'Joining Date',
  joiningLocation: 'Joining Location',
  currentLocation: 'Current Work Location',
  otherLocation: 'Other Work Location',
  accessLocations: 'Access Locations',
  designation: 'Designation',
  cugNo: 'CUG No',
  workEmail: 'Work Email',
  userType: 'Type of User',
  responsibilities: 'Responsibilities',
  status: 'Status',
  permissionsSet: 'Permissions Set',
} as const;

const H = EMPLOYEE_HEADERS;

/** Dropdown lists the service fills from the database (`listFrom`). */
export const EMPLOYEE_LISTS = {
  company: 'company',
  location: 'location',
  currentLocation: 'currentLocation',
  branch: 'branch',
  department: 'department',
  responsibility: 'responsibility',
} as const;

const ADDRESS_HEADERS: Record<'residential' | 'permanent', Record<AddressField, string>> = {
  residential: {
    address1: H.resAddress1,
    address2: H.resAddress2,
    location: H.resLocation,
    city: H.resCity,
    state: H.resState,
    pincode: H.resPincode,
  },
  permanent: {
    address1: H.perAddress1,
    address2: H.perAddress2,
    location: H.perLocation,
    city: H.perCity,
    state: H.perState,
    pincode: H.perPincode,
  },
};

const userTypeOf = (roles: string[]): string =>
  roles.includes(Role.SUPER_ADMIN) ? 'Super Admin' : roles.includes(Role.ADMIN) ? 'Admin' : 'Standard User';

const departmentLabel = (value: string): string =>
  DEPARTMENTS.find((department) => normaliseName(department.value) === normaliseName(value))?.label ?? value;

const addressColumns = (
  kind: 'residential' | 'permanent',
  required: boolean,
): ExcelColumn<EmployeeRecord>[] => {
  const headers = ADDRESS_HEADERS[kind];
  const read = (record: EmployeeRecord) =>
    kind === 'residential' ? record.residentialAddress : record.permanentAddress;
  const notes: Partial<Record<AddressField, string>> = {
    state: 'Letters and spaces only',
    pincode: '6 digits',
  };
  return ADDRESS_FIELDS.map((field) => ({
    header: headers[field],
    maps: `addresses.${field}`,
    required: required && ['address1', 'city', 'state', 'pincode'].includes(field),
    width: field === 'address1' || field === 'address2' ? 30 : 16,
    note:
      kind === 'permanent' && field === 'address1'
        ? `Needed for a new user unless ${H.sameAddress} is Yes. ${notes[field] ?? ''}`.trim()
        : notes[field],
    get: (record) => read(record)?.[field] ?? null,
  }));
};

export const EMPLOYEE_SHEET: ExcelSheetDefinition<EmployeeRecord> = {
  sheetName: 'Users',
  columns: [
    {
      header: H.employeeId,
      maps: 'employees.employeeId',
      key: true,
      width: 14,
      note:
        'Given by the system to new users. A row with an Employee ID updates that user: filled cells ' +
        'replace the saved value, empty cells keep it. Permissions and status are never changed by an import',
      get: (record) => record.employeeId,
    },
    {
      header: H.firstName,
      maps: 'employees.firstName',
      required: true,
      width: 16,
      note: 'Letters and spaces only, at least 3 characters',
      get: (record) => record.firstName,
    },
    {
      header: H.middleName,
      maps: 'employees.middleName',
      width: 16,
      note: 'Letters and spaces only, at least 3 characters',
      get: (record) => record.middleName,
    },
    {
      header: H.lastName,
      maps: 'employees.lastName',
      required: true,
      width: 16,
      note: 'Letters and spaces only, at least 3 characters',
      get: (record) => record.lastName,
    },
    {
      header: H.username,
      maps: 'employees.username',
      required: true,
      width: 16,
      note:
        '5 to 16 characters, no spaces, no @, not only digits (users log in with it). ' +
        'Must not be used by another user',
      get: (record) => record.username,
    },
    {
      header: H.primaryMobile,
      maps: 'employees.primaryMobNo',
      required: true,
      width: 14,
      note:
        '10-digit mobile number starting with 6-9. Users log in with it. No two users may share a ' +
        'Primary Mobile, Secondary Mobile or CUG No',
      get: (record) => record.primaryMobNo,
    },
    {
      header: H.secondaryMobile,
      maps: 'employees.secondaryMobNo',
      width: 14,
      note: '10-digit mobile number starting with 6-9. Must not be used by another user',
      get: (record) => record.secondaryMobNo,
    },
    {
      header: H.primaryEmail,
      maps: 'employees.primaryEmail',
      required: true,
      width: 26,
      note: 'No two users may share a Primary Email, Secondary Email or Work Email',
      get: (record) => record.primaryEmail,
    },
    {
      header: H.secondaryEmail,
      maps: 'employees.secondaryEmail',
      width: 26,
      note: 'Must not be used by another user',
      get: (record) => record.secondaryEmail,
    },
    ...addressColumns('residential', true),
    {
      header: H.sameAddress,
      maps: 'employees.isAddressSame',
      type: 'boolean',
      width: 14,
      note: 'Yes = the permanent address is the residential address, and the Permanent columns are ignored',
      get: (record) => formatBooleanCell(record.isAddressSame),
    },
    ...addressColumns('permanent', false),
    {
      header: H.company,
      maps: 'user_companies',
      required: true,
      listFrom: EMPLOYEE_LISTS.company,
      link: { master: 'Company' },
      width: 24,
      note: 'One or more, separated by commas',
      get: (record) => fromList(record.companies.map((company) => company.name)),
    },
    {
      header: H.department,
      maps: 'employees.department',
      required: true,
      listFrom: EMPLOYEE_LISTS.department,
      width: 22,
      note: `One or more, separated by commas: ${DEPARTMENTS.map((department) => department.label).join(', ')}`,
      get: (record) => fromList(record.department.map(departmentLabel)),
    },
    {
      header: H.joiningDate,
      maps: 'employees.joiningDate',
      required: true,
      type: 'date',
      width: 14,
      get: (record) => record.joiningDate,
    },
    {
      header: H.joiningLocation,
      maps: 'employees.joiningLocation_id / employees.joiningOfficedata_id',
      required: true,
      listFrom: EMPLOYEE_LISTS.location,
      link: { master: 'Locations (a branch or an office)' },
      width: 24,
      get: (record) => record.joining?.name ?? null,
    },
    {
      header: H.currentLocation,
      maps: 'employees.currentLocation_id / employees.currentOffices_id',
      required: true,
      listFrom: EMPLOYEE_LISTS.currentLocation,
      link: { master: 'Locations (a branch or an office)' },
      width: 24,
      note: `Or "${OTHER_LOCATION}", with the place in ${H.otherLocation}`,
      get: (record) =>
        record.current?.name ?? (record.otherWorkLocationInput ? OTHER_LOCATION : null),
    },
    {
      header: H.otherLocation,
      maps: 'employees.otherWorkLocationInput',
      width: 20,
      note: `Needed when ${H.currentLocation} is "${OTHER_LOCATION}", otherwise left empty`,
      get: (record) => (record.current ? null : record.otherWorkLocationInput),
    },
    {
      header: H.accessLocations,
      maps: 'access_location_id',
      required: true,
      listFrom: EMPLOYEE_LISTS.branch,
      link: { master: 'Locations (CC, DC, SCC or Warehouse)' },
      width: 30,
      note: 'One or more branches, separated by commas. Offices are not access locations',
      get: (record) => fromList(record.accessLocations.map((location) => location.name)),
    },
    {
      header: H.designation,
      maps: 'employees.designation',
      width: 18,
      get: (record) => record.designation,
    },
    {
      header: H.cugNo,
      maps: 'employees.cugNo',
      width: 14,
      note: '10-digit mobile number starting with 6-9. Must not be used by another user',
      get: (record) => record.cugNo,
    },
    {
      header: H.workEmail,
      maps: 'employees.workEmail',
      width: 26,
      note: 'Users log in with it. Must not be used by another user',
      get: (record) => record.workEmail,
    },
    {
      header: H.userType,
      maps: 'employees.roles',
      required: true,
      enumValues: USER_TYPES.map((type) => type.label),
      width: 16,
      note:
        'Only a Super Admin can import a Super Admin. Permissions are not imported: after the import, ' +
        'open each user, set Permission Configuration, then activate the user',
      get: (record) => userTypeOf(record.roles),
    },
    {
      header: H.responsibilities,
      maps: 'employees.roles',
      listFrom: EMPLOYEE_LISTS.responsibility,
      width: 26,
      note:
        `Standard User only. None, one or more, separated by commas: ` +
        `${RESPONSIBILITIES.map((item) => item.label).join(', ')}. ` +
        `When ${H.userType} is filled, an empty cell means no responsibilities`,
      get: (record) =>
        fromList(
          RESPONSIBILITIES.filter((item) => record.roles.includes(item.role)).map((item) => item.label),
        ),
    },
    {
      header: H.status,
      maps: 'employees.status',
      readOnly: true,
      width: 12,
      note: 'New users are saved Inactive. Activate them from the Users list once their permissions are set',
      get: (record) => record.status,
    },
    {
      header: H.permissionsSet,
      maps: 'document_permissions',
      readOnly: true,
      width: 14,
      note: 'No = the user has no permission ticks yet',
      get: (record) => (record.permissionsSet ? 'Yes' : 'No'),
    },
  ],
};

// ─── Plan ───────────────────────────────────────────────────────────────────

/** Scalar columns of `employees` the sheet writes. */
export type EmployeeScalar =
  | 'firstName'
  | 'middleName'
  | 'lastName'
  | 'username'
  | 'primaryMobNo'
  | 'secondaryMobNo'
  | 'primaryEmail'
  | 'secondaryEmail'
  | 'designation'
  | 'cugNo'
  | 'workEmail'
  | 'joiningDate'
  | 'otherWorkLocationInput';

export interface EmployeeValues extends Partial<Record<EmployeeScalar, string | null>> {
  isAddressSame?: boolean;
  department?: string[];
  roles?: string[];
  companyIds?: string[];
  accessIds?: string[];
  joining?: LocationRef;
  /** null = "Other" (the place is in `otherWorkLocationInput`). */
  current?: LocationRef | null;
}

/** `id` null: a new address row with `values`; otherwise only the changed fields of that row. */
export interface AddressPlan {
  id: string | null;
  values: AddressValues;
}

export interface PlannedEmployeeCreate {
  row: number;
  values: EmployeeValues;
  residential: AddressValues;
  permanent: AddressValues;
}

export interface PlannedEmployeeUpdate {
  row: number;
  record: EmployeeRecord;
  changes: EmployeeValues;
  residential: AddressPlan | null;
  permanent: AddressPlan | null;
}

export interface EmployeePlan {
  creates: PlannedEmployeeCreate[];
  updates: PlannedEmployeeUpdate[];
  unchanged: number;
  failed: ImportIssue[];
}

export interface EmployeePlanContext {
  companies: NamedRef[];
  locations: LocationRef[];
  /** The admin importing the file. */
  actor: { id: string; roles: string[] };
}

const NAME_PATTERN = /^[A-Za-z ]+$/;
const STATE_PATTERN = /^[A-Za-z ]+$/;
const PINCODE_PATTERN = /^\d{6}$/;
/** The form's email rule. */
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
/** Login reads an identifier like this as a phone number, so a username must not look like one. */
const PHONE_LIKE = /^[+\d][\d\s]*$/;

/** "+91 98765-43210" -> "9876543210"; null unless it is a 10-digit mobile starting with 6-9 (the form's rule). */
export function normaliseMobile(text: string): string | null {
  let digits = text.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const sameSet = (a: string[], b: string[]) => {
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((value) => left.has(value));
};

const describeMissing = (typed: string, suggestion: string | null) =>
  `"${typed}" was not found` + (suggestion ? ` - did you mean "${suggestion}"?` : '');

export function planEmployeeImport(
  rows: ExcelRow[],
  existing: EmployeeRecord[],
  context: EmployeePlanContext,
): EmployeePlan {
  const plan: EmployeePlan = { creates: [], updates: [], unchanged: 0, failed: [] };
  const actorIsSuperAdmin = context.actor.roles.includes(Role.SUPER_ADMIN);

  const byEmployeeId = new Map(
    existing.filter((record) => record.employeeId).map((record) => [record.employeeId!.toUpperCase(), record]),
  );
  const companies = LookupIndex.fromRecords(context.companies, { names: (company) => [company.name] });
  const locations = LookupIndex.fromRecords(context.locations, { names: (location) => [location.name] });
  const branches = LookupIndex.fromRecords(
    context.locations.filter((location) => location.kind === 'branch'),
    { names: (location) => [location.name] },
  );
  const claimedBy = new Map<EmployeeRecord, number>();

  for (const row of rows) {
    const errors: string[] = [];

    // ── Which user ─────────────────────────────────────────────────────────
    const employeeIdText = row.text(H.employeeId);
    let target: EmployeeRecord | null = null;
    if (employeeIdText) {
      target = byEmployeeId.get(employeeIdText.toUpperCase()) ?? null;
      if (!target) {
        errors.push(
          `${H.employeeId} ${employeeIdText} was not found. Clear it to add this row as a new user`,
        );
      } else {
        const earlierRow = claimedBy.get(target);
        if (earlierRow !== undefined) errors.push(`Row ${earlierRow} already changes ${employeeIdText}`);
        else claimedBy.set(target, row.rowNumber);
      }
    }
    // A row with an unknown Employee ID is only reported once.
    if (employeeIdText && !target) {
      plan.failed.push({ row: row.rowNumber, reason: errors.join('; ') });
      continue;
    }
    const isNew = !target;
    const values: EmployeeValues = {};
    const need = (header: string) => {
      if (isNew) errors.push(`${header} is needed for a new user`);
    };

    // ── Names, username ────────────────────────────────────────────────────
    for (const [header, property, required] of [
      [H.firstName, 'firstName', true],
      [H.middleName, 'middleName', false],
      [H.lastName, 'lastName', true],
    ] as const) {
      const text = row.text(header);
      if (!text) {
        if (required) need(header);
        continue;
      }
      const name = text.replace(/\s+/g, ' ');
      if (!NAME_PATTERN.test(name)) errors.push(`${header} "${text}" must have letters and spaces only`);
      else if (name.length < 3) errors.push(`${header} "${text}" must have at least 3 characters`);
      else values[property] = name;
    }

    const username = row.text(H.username);
    if (!username) need(H.username);
    else if (username.length < 5 || username.length > 16) {
      errors.push(`${H.username} "${username}" must be 5 to 16 characters`);
    } else if (/\s/.test(username) || username.includes('@') || PHONE_LIKE.test(username)) {
      errors.push(
        `${H.username} "${username}" cannot have spaces or @, or be only digits - ` +
          'login would read it as an email or a phone number',
      );
    } else values.username = username;

    // ── Contacts ───────────────────────────────────────────────────────────
    for (const [header, property, required] of [
      [H.primaryMobile, 'primaryMobNo', true],
      [H.secondaryMobile, 'secondaryMobNo', false],
      [H.cugNo, 'cugNo', false],
    ] as const) {
      const text = row.text(header);
      if (!text) {
        if (required) need(header);
        continue;
      }
      const mobile = normaliseMobile(text);
      if (mobile) values[property] = mobile;
      else errors.push(`${header} "${text}" is not a 10-digit mobile number starting with 6-9`);
    }

    for (const [header, property, required] of [
      [H.primaryEmail, 'primaryEmail', true],
      [H.secondaryEmail, 'secondaryEmail', false],
      [H.workEmail, 'workEmail', false],
    ] as const) {
      const text = row.text(header);
      if (!text) {
        if (required) need(header);
        continue;
      }
      if (EMAIL_PATTERN.test(text)) values[property] = text;
      else errors.push(`${header} "${text}" is not an email address`);
    }

    const designation = row.text(H.designation);
    if (designation) values.designation = designation;

    // ── Addresses ──────────────────────────────────────────────────────────
    const readAddress = (kind: 'residential' | 'permanent'): AddressValues => {
      const headers = ADDRESS_HEADERS[kind];
      const address: AddressValues = {};
      for (const field of ADDRESS_FIELDS) {
        const text = row.text(headers[field]);
        if (!text) continue;
        if (field === 'pincode' && !PINCODE_PATTERN.test(text)) {
          errors.push(`${headers.pincode} "${text}" must be 6 digits`);
        } else if (field === 'state' && !STATE_PATTERN.test(text)) {
          errors.push(`${headers.state} "${text}" must have letters and spaces only`);
        } else address[field] = text;
      }
      return address;
    };
    const completeAddress = (kind: 'residential' | 'permanent', address: AddressValues, why = '') => {
      const headers = ADDRESS_HEADERS[kind];
      for (const field of ['address1', 'city', 'state', 'pincode'] as const) {
        // A malformed cell is already reported.
        if (!address[field] && !row.text(headers[field])) errors.push(`${headers[field]} is needed${why}`);
      }
    };

    const residential = readAddress('residential');
    const sameText = row.text(H.sameAddress);
    const sameCell = sameText ? toBoolean(sameText) : null;
    if (sameText && sameCell === null) errors.push(`${H.sameAddress} must be Yes or No`);
    // Yes copies the residential address, so whatever the Permanent columns say is ignored.
    const permanent = sameCell ? {} : readAddress('permanent');
    if (sameCell !== null) values.isAddressSame = sameCell;

    // Each address a new user gets must be complete; an existing user's must stay complete.
    const residentialFull = isNew || !target!.residentialAddress;
    if (residentialFull && (isNew || Object.keys(residential).length)) {
      completeAddress('residential', residential, isNew ? ' for a new user' : '');
    }
    const finalSame = sameCell ?? (isNew ? false : Boolean(target!.isAddressSame));
    if (!finalSame) {
      const permanentFull = isNew || !target!.permanentAddress || (sameCell === false && target!.isAddressSame);
      if (permanentFull && (isNew || Object.keys(permanent).length || sameCell === false)) {
        completeAddress(
          'permanent',
          permanent,
          isNew ? ` for a new user, unless ${H.sameAddress} is Yes` : '',
        );
      }
    }

    // ── Office ─────────────────────────────────────────────────────────────
    const companyNames = toList(row.raw(H.company));
    if (!companyNames.length) need(H.company);
    else {
      const ids: string[] = [];
      for (const name of companyNames) {
        const found = companies.find(name);
        if (found.status === 'found') ids.push(found.record.id);
        else if (found.status === 'ambiguous') errors.push(`${H.company} "${name}" matches more than one company`);
        else errors.push(`${H.company} ${describeMissing(name, found.suggestion)}`);
      }
      values.companyIds = [...new Set(ids)];
    }

    const departmentNames = toList(row.raw(H.department));
    if (!departmentNames.length) need(H.department);
    else {
      const chosen: string[] = [];
      for (const name of departmentNames) {
        const key = normaliseName(name);
        const department = DEPARTMENTS.find((item) =>
          [item.value, item.label, ...(item.aliases ?? [])].some((candidate) => normaliseName(candidate) === key),
        );
        if (department) chosen.push(department.value);
        else {
          errors.push(
            `${H.department} "${name}" must be one of: ${DEPARTMENTS.map((item) => item.label).join(', ')}`,
          );
        }
      }
      values.department = [...new Set(chosen)];
    }

    const joiningText = row.text(H.joiningDate);
    if (!joiningText) need(H.joiningDate);
    else {
      const date = toDateOnlyString(row.raw(H.joiningDate));
      if (date) values.joiningDate = date;
      else errors.push(`${H.joiningDate} "${joiningText}" is not a date (use DD-MM-YYYY)`);
    }

    const findLocation = (header: string, name: string): LocationRef | null => {
      const found = locations.find(name);
      if (found.status === 'found') return found.record;
      if (found.status === 'ambiguous') {
        errors.push(`${header} "${name}" is the name of both a branch and an office - rename one of them first`);
      } else errors.push(`${header} ${describeMissing(name, found.suggestion)}`);
      return null;
    };

    const joiningName = row.text(H.joiningLocation);
    if (!joiningName) need(H.joiningLocation);
    else {
      const location = findLocation(H.joiningLocation, joiningName);
      if (location) values.joining = location;
    }

    const currentName = row.text(H.currentLocation);
    const otherText = row.text(H.otherLocation);
    if (!currentName) {
      need(H.currentLocation);
      if (otherText) errors.push(`${H.otherLocation} is only read when ${H.currentLocation} is "${OTHER_LOCATION}"`);
    } else if (normaliseName(currentName) === normaliseName(OTHER_LOCATION)) {
      if (!otherText) errors.push(`${H.otherLocation} is needed when ${H.currentLocation} is "${OTHER_LOCATION}"`);
      else {
        values.current = null;
        values.otherWorkLocationInput = otherText;
      }
    } else {
      if (otherText) errors.push(`${H.otherLocation} is only read when ${H.currentLocation} is "${OTHER_LOCATION}"`);
      const location = findLocation(H.currentLocation, currentName);
      if (location) {
        values.current = location;
        values.otherWorkLocationInput = null;
      }
    }

    const accessNames = toList(row.raw(H.accessLocations));
    if (!accessNames.length) need(H.accessLocations);
    else {
      const ids: string[] = [];
      for (const name of accessNames) {
        const found = branches.find(name);
        if (found.status === 'found') ids.push(found.record.id);
        else if (found.status === 'ambiguous') {
          errors.push(`${H.accessLocations} "${name}" matches more than one branch`);
        } else if (locations.match(name)) {
          errors.push(`${H.accessLocations} "${name}" is an office - access locations are CC, DC, SCC or Warehouse`);
        } else errors.push(`${H.accessLocations} ${describeMissing(name, found.suggestion)}`);
      }
      values.accessIds = [...new Set(ids)];
    }

    // ── Type of User and Responsibilities ──────────────────────────────────
    const typeText = row.text(H.userType);
    const type = typeText
      ? USER_TYPES.find((item) => normaliseName(item.label) === normaliseName(typeText)) ?? null
      : null;
    if (typeText && !type) {
      errors.push(`${H.userType} must be one of: ${USER_TYPES.map((item) => item.label).join(', ')}`);
    }
    if (!typeText) need(H.userType);

    const responsibilityNames = toList(row.raw(H.responsibilities));
    const responsibilities: Role[] = [];
    for (const name of responsibilityNames) {
      const key = normaliseName(name);
      const found = RESPONSIBILITIES.find(
        (item) => normaliseName(item.label) === key || normaliseName(item.role) === key,
      );
      if (found) responsibilities.push(found.role);
      else {
        errors.push(
          `${H.responsibilities} "${name}" must be one of: ${RESPONSIBILITIES.map((item) => item.label).join(', ')}`,
        );
      }
    }

    // Type filled: the roles are what the row says. Type empty on an existing user:
    // keep the type, and replace the responsibilities only when the cell has some.
    let roles: string[] | null = null;
    let typeRole: Role | null | undefined;
    if (type) typeRole = type.role;
    else if (!typeText && target) typeRole = currentTypeRole(target.roles);
    if (typeRole !== undefined && (type || responsibilityNames.length)) {
      if (typeRole && responsibilities.length) {
        errors.push(
          `${H.responsibilities} are for Standard Users only - clear the cell or change ${H.userType}`,
        );
      } else roles = normalizeRoles([...(typeRole ? [typeRole] : []), ...responsibilities]);
    }

    if (roles) {
      const rolesChange = !target || !sameSet(roles, target.roles);
      if (rolesChange) {
        if (target?.id === context.actor.id) {
          errors.push(`You cannot change your own ${H.userType} or ${H.responsibilities}`);
        } else values.roles = roles;
      }
    }

    if (errors.length) {
      plan.failed.push({ row: row.rowNumber, reason: errors.join('; ') });
      continue;
    }

    if (isNew) {
      values.isAddressSame = finalSame;
      plan.creates.push({
        row: row.rowNumber,
        values,
        residential,
        permanent: finalSame ? { ...residential } : permanent,
      });
      continue;
    }

    // ── Changes to an existing user ────────────────────────────────────────
    const record = target!;
    const changes: EmployeeValues = {};
    const scalars: EmployeeScalar[] = [
      'firstName', 'middleName', 'lastName', 'username', 'primaryMobNo', 'secondaryMobNo',
      'primaryEmail', 'secondaryEmail', 'designation', 'cugNo', 'workEmail', 'joiningDate',
      'otherWorkLocationInput',
    ];
    for (const property of scalars) {
      if (values[property] === undefined) continue;
      if (asText(values[property]) !== asText(record[property])) changes[property] = values[property];
    }
    if (values.isAddressSame !== undefined && values.isAddressSame !== Boolean(record.isAddressSame)) {
      changes.isAddressSame = values.isAddressSame;
    }
    if (values.department && !sameSet(values.department, record.department.map((d) => d.toLowerCase()))) {
      changes.department = values.department;
    }
    if (values.roles) changes.roles = values.roles;
    if (values.companyIds && !sameSet(values.companyIds, record.companies.map((company) => company.id))) {
      changes.companyIds = values.companyIds;
    }
    if (values.accessIds && !sameSet(values.accessIds, record.accessLocations.map((location) => location.id))) {
      changes.accessIds = values.accessIds;
    }
    if (values.joining && values.joining.id !== record.joining?.id) changes.joining = values.joining;
    if (values.current !== undefined && (values.current?.id ?? null) !== (record.current?.id ?? null)) {
      changes.current = values.current;
    }

    const addressPlan = (stored: EmployeeAddress | null, wanted: AddressValues): AddressPlan | null => {
      const changed: AddressValues = {};
      for (const field of ADDRESS_FIELDS) {
        if (wanted[field] !== undefined && asText(stored?.[field]) !== wanted[field]) changed[field] = wanted[field];
      }
      if (!Object.keys(changed).length) return null;
      return { id: stored?.id ?? null, values: stored ? changed : { ...wanted } };
    };

    const residentialPlan = addressPlan(record.residentialAddress, residential);
    let permanentPlan: AddressPlan | null;
    if (finalSame) {
      // The permanent address follows the residential one, as it already saved.
      const finalResidential: AddressValues = {};
      for (const field of ADDRESS_FIELDS) {
        const value = residential[field] ?? asText(record.residentialAddress?.[field]);
        if (value) finalResidential[field] = value;
      }
      permanentPlan = addressPlan(record.permanentAddress, finalResidential);
    } else {
      permanentPlan = addressPlan(record.permanentAddress, permanent);
    }

    const changesSomething =
      Object.keys(changes).length > 0 || residentialPlan !== null || permanentPlan !== null;
    if (!changesSomething) {
      plan.unchanged++;
      continue;
    }
    if (!actorIsSuperAdmin && record.roles.includes(Role.SUPER_ADMIN)) {
      plan.failed.push({ row: row.rowNumber, reason: 'Only a Super Admin can change a Super Admin account' });
      continue;
    }
    plan.updates.push({ row: row.rowNumber, record, changes, residential: residentialPlan, permanent: permanentPlan });
  }

  // ── Across the file ──────────────────────────────────────────────────────
  if (!actorIsSuperAdmin) {
    for (const create of plan.creates) {
      if (create.values.roles?.includes(Role.SUPER_ADMIN)) {
        plan.failed.push({ row: create.row, reason: 'Only a Super Admin can import a Super Admin' });
      }
    }
    for (const update of plan.updates) {
      if (update.changes.roles?.includes(Role.SUPER_ADMIN)) {
        plan.failed.push({ row: update.row, reason: 'Only a Super Admin can make a user Super Admin' });
      }
    }
  }

  // At least one active Super Admin has to remain (new users are Inactive, so they don't count).
  const demoted = plan.updates.filter(
    (update) =>
      update.record.roles.includes(Role.SUPER_ADMIN) &&
      update.changes.roles !== undefined &&
      !update.changes.roles.includes(Role.SUPER_ADMIN),
  );
  if (demoted.length) {
    const demotedIds = new Set(demoted.map((update) => update.record.id));
    const remaining = existing.filter(
      (record) =>
        record.roles.includes(Role.SUPER_ADMIN) && record.status === 'Active' && !demotedIds.has(record.id),
    );
    if (!remaining.length) {
      for (const update of demoted) {
        plan.failed.push({ row: update.row, reason: 'At least one active Super Admin is required' });
      }
    }
  }

  for (const clash of findFileContactClashes(plan, existing)) plan.failed.push(clash);

  const reasonsByRow = new Map<number, string[]>();
  for (const issue of plan.failed) {
    reasonsByRow.set(issue.row, [...(reasonsByRow.get(issue.row) ?? []), issue.reason]);
  }
  plan.failed = [...reasonsByRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, reasons]) => ({ row, reason: reasons.join('; ') }));
  plan.creates = plan.creates.filter((create) => !reasonsByRow.has(create.row));
  plan.updates = plan.updates.filter((update) => !reasonsByRow.has(update.row));

  return plan;
}

/** The single role a user's type comes from (null = Standard User). */
function currentTypeRole(roles: string[]): Role | null {
  if (roles.includes(Role.SUPER_ADMIN)) return Role.SUPER_ADMIN;
  if (roles.includes(Role.ADMIN)) return Role.ADMIN;
  return null;
}

/**
 * Username, mobiles and emails must not be shared between users (D7). Only the
 * values a row sets for a new user, or changes on an existing one, are checked,
 * so an old clash already in the database does not block unrelated edits.
 */
function findFileContactClashes(plan: EmployeePlan, existing: EmployeeRecord[]): ImportIssue[] {
  const updates = new Map(plan.updates.map((update) => [update.record.id, update]));
  const pickFields = (source: EmployeeValues) =>
    CONTACT_FIELDS.filter((field) => source[field] !== undefined);

  const owners: ContactOwner[] = existing.map((record) => {
    const update = updates.get(record.id);
    const changes = update?.changes ?? {};
    const values: ContactOwner['values'] = {};
    for (const field of CONTACT_FIELDS) {
      values[field] = changes[field] !== undefined ? changes[field] : record[field];
    }
    return {
      key: record.id,
      label: `${record.employeeId ?? ''} ${[record.firstName, record.lastName].filter(Boolean).join(' ')}`.trim(),
      row: update?.row ?? null,
      values,
      checked: pickFields(changes),
    };
  });
  for (const create of plan.creates) {
    owners.push({
      key: `row-${create.row}`,
      label: `row ${create.row}`,
      row: create.row,
      values: create.values,
      checked: pickFields(create.values),
    });
  }

  return findContactClashes(owners).map((clash) => ({
    row: clash.row,
    reason: `${CONTACT_LABELS[clash.property]} "${clash.value}" is already used by ${clash.by}`,
  }));
}

/** Dropdown values for the template and the export. */
export function employeeWorkbookLists(context: Pick<EmployeePlanContext, 'companies' | 'locations'>) {
  const names = (records: NamedRef[]) =>
    [...new Set(records.map((record) => record.name))].sort((a, b) => a.localeCompare(b));
  const locationNames = names(context.locations);
  return {
    [EMPLOYEE_LISTS.company]: names(context.companies),
    [EMPLOYEE_LISTS.location]: locationNames,
    [EMPLOYEE_LISTS.currentLocation]: [...locationNames, OTHER_LOCATION],
    [EMPLOYEE_LISTS.branch]: names(context.locations.filter((location) => location.kind === 'branch')),
    [EMPLOYEE_LISTS.department]: DEPARTMENTS.map((department) => department.label),
    [EMPLOYEE_LISTS.responsibility]: RESPONSIBILITIES.map((item) => item.label),
  };
}
