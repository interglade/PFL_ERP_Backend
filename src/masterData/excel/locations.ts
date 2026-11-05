/**
 * One Locations sheet for offices (`offices`) and CC / DC / SCC / Warehouse
 * (`branches`), with the address on the same row (docs/master-data-excel-plan.md
 * §5, Locations; D5-D8).
 *
 * Like the other small masters the import is all or nothing, and the planner
 * here does not touch the database: the service hands it the current
 * locations, how many GRN numbers each branch prefix is already in, and the
 * City / State the pincode lookup found.
 */

import { ExcelColumn, ExcelSheetDefinition } from '../../excel/excelColumn';
import { ExcelRow, ImportIssue } from '../../excel/excelImport.service';
import { LookupIndex } from '../../excel/lookupIndex';
import { normaliseName } from '../../excel/lookupByName';
import { toNumber } from '../../excel/excelValue';
import { BranchType } from '../../branch/entity/branches.entity';
import { OFFICE_TYPE } from '../../office/entity/offices.entity';

export type LocationKind = 'office' | 'branch';

export interface LocationTypeInfo {
  value: string;
  kind: LocationKind;
  label: string;
  /** Other spellings accepted on import. */
  aliases: string[];
}

export const LOCATION_TYPES: LocationTypeInfo[] = [
  { value: OFFICE_TYPE.REGISTERED_OFFICE, kind: 'office', label: 'Registered Office', aliases: ['RO'] },
  { value: OFFICE_TYPE.CORPORATE_OFFICE, kind: 'office', label: 'Corporate Office', aliases: ['HO', 'Head Office'] },
  { value: BranchType.COLLECTION_CENTER, kind: 'branch', label: 'Collection Center (CC)', aliases: ['CC', 'Collection Center', 'Collection Centre'] },
  { value: BranchType.DISTRIBUTION_CENTER, kind: 'branch', label: 'Distribution Center (DC)', aliases: ['DC', 'Distribution Center', 'Distribution Centre'] },
  { value: BranchType.SEASONAL_COLLECTION_CENTER, kind: 'branch', label: 'Seasonal Collection Center (SCC)', aliases: ['SCC', 'Seasonal CC', 'Seasonal Collection Center', 'Seasonal Collection Centre'] },
  { value: BranchType.WAREHOUSE, kind: 'branch', label: 'Warehouse (WH)', aliases: ['WH', 'Warehouse'] },
];

const typeByValue = new Map(LOCATION_TYPES.map((type) => [type.value, type]));

/** Finds a type by label, stored value or alias, ignoring case and punctuation. */
export function findLocationType(text: string): LocationTypeInfo | null {
  const key = normaliseName(text);
  return (
    LOCATION_TYPES.find((type) =>
      [type.label, type.value, ...type.aliases].some((name) => normaliseName(name) === key),
    ) ?? null
  );
}

export interface LocationAddress {
  id: string;
  address1: string | null;
  address2: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

/** An office or a branch, flattened to the shape the sheet works with. */
export interface LocationRecord {
  id: string;
  kind: LocationKind;
  type: string;
  name: string;
  prefix: string | null;
  cFirstName: string | null;
  cMiddleName: string | null;
  cLastName: string | null;
  contactNumber: string | null;
  officeEmail: string | null;
  totalCapacity: number | null;
  currentCapacity: number | null;
  balanceCapacity: number | null;
  notes: string | null;
  address: LocationAddress | null;
}

export const LOCATION_HEADERS = {
  type: 'Location Type',
  name: 'Name',
  prefix: 'Prefix',
  address1: 'Address 1',
  address2: 'Address 2',
  area: 'Location',
  city: 'City',
  state: 'State',
  pincode: 'Pincode',
  firstName: 'Contact First Name',
  middleName: 'Contact Middle Name',
  lastName: 'Contact Last Name',
  phone: 'Contact Number',
  email: 'Email',
  total: 'Total Capacity',
  current: 'Current Capacity',
  balance: 'Balance Capacity',
  notes: 'Notes',
  recordId: 'Record ID',
} as const;

const H = LOCATION_HEADERS;

export const LOCATION_SHEET: ExcelSheetDefinition<LocationRecord> = {
  sheetName: 'Locations',
  columns: [
    {
      header: H.type,
      maps: 'offices.type / branches.type',
      required: true,
      enumValues: LOCATION_TYPES.map((type) => type.label),
      width: 30,
      note:
        'Offices are saved as offices, the rest as branches. CC, DC, SCC and WH are accepted too. ' +
        'The type of an existing location cannot be changed',
      get: (record) => typeByValue.get(record.type)?.label ?? record.type,
    },
    {
      header: H.name,
      maps: 'offices.name / branches.name',
      required: true,
      width: 30,
      note:
        'Unique within its Location Type - a row whose name matches an existing location of the same type updates it',
      get: (record) => record.name,
    },
    {
      header: H.prefix,
      maps: 'branches.prefix',
      width: 12,
      note:
        'CC / DC / SCC / Warehouse only, needed for a new one. Letters and digits, saved in capitals, ' +
        'unique across branches. Starts every GRN number of the branch, so once a GRN uses it the ' +
        'import will not change it. Leave empty for offices',
      get: (record) => record.prefix,
    },
    {
      header: H.address1,
      maps: 'addresses.address1',
      required: true,
      width: 32,
      note: 'Needed for a new location',
      get: (record) => record.address?.address1,
    },
    { header: H.address2, maps: 'addresses.address2', width: 28, get: (record) => record.address?.address2 },
    { header: H.area, maps: 'addresses.location', width: 20, get: (record) => record.address?.location },
    {
      header: H.city,
      maps: 'addresses.city',
      width: 18,
      note: 'Filled from the pincode when left empty',
      get: (record) => record.address?.city,
    },
    {
      header: H.state,
      maps: 'addresses.state',
      width: 18,
      note: 'Filled from the pincode when left empty',
      get: (record) => record.address?.state,
    },
    {
      header: H.pincode,
      maps: 'addresses.pincode',
      required: true,
      width: 10,
      note: '6 digits. Needed for a new location',
      get: (record) => record.address?.pincode,
    },
    { header: H.firstName, maps: 'cFirstName', width: 18, get: (record) => record.cFirstName },
    { header: H.middleName, maps: 'cMiddleName', width: 18, get: (record) => record.cMiddleName },
    { header: H.lastName, maps: 'cLastName', width: 18, get: (record) => record.cLastName },
    {
      header: H.phone,
      maps: 'contactNumber',
      width: 16,
      note: '10 digits. Spaces, dashes and a leading +91 are removed',
      get: (record) => record.contactNumber,
    },
    {
      header: H.email,
      maps: 'offices.officeEmail',
      width: 28,
      note: 'Offices only',
      get: (record) => record.officeEmail,
    },
    {
      header: H.total,
      maps: 'branches.totalCapacity',
      type: 'number',
      width: 14,
      note: 'Branches only. A whole number, 0 or more',
      get: (record) => record.totalCapacity,
    },
    {
      header: H.current,
      maps: 'branches.currentCapacity',
      type: 'number',
      width: 14,
      note: 'Branches only. A whole number, not more than Total Capacity',
      get: (record) => record.currentCapacity,
    },
    {
      header: H.balance,
      maps: 'branches.balanceCapacity',
      type: 'number',
      readOnly: true,
      width: 14,
      note: 'Worked out as Total Capacity - Current Capacity',
      get: (record) => record.balanceCapacity,
    },
    { header: H.notes, maps: 'notes', width: 30, get: (record) => record.notes },
    {
      header: H.recordId,
      maps: 'offices.id / branches.id',
      key: true,
      width: 38,
      get: (record) => record.id,
    },
  ] as ExcelColumn<LocationRecord>[],
};

// ── Planning ─────────────────────────────────────────────────────────────────

type LocationField =
  | 'name'
  | 'prefix'
  | 'cFirstName'
  | 'cMiddleName'
  | 'cLastName'
  | 'contactNumber'
  | 'officeEmail'
  | 'totalCapacity'
  | 'currentCapacity'
  | 'notes';

type AddressField = 'address1' | 'address2' | 'location' | 'city' | 'state' | 'pincode';

export interface PlannedLocationCreate {
  row: number;
  kind: LocationKind;
  type: string;
  values: Partial<Record<LocationField | 'balanceCapacity', string | number>>;
  address: Partial<Record<AddressField, string>>;
}

export interface PlannedLocationUpdate {
  row: number;
  record: LocationRecord;
  changes: Partial<Record<LocationField | 'balanceCapacity', string | number>>;
  /** Address fields that change; `createAddress` when the location had none. */
  addressChanges: Partial<Record<AddressField, string>>;
  createAddress: boolean;
}

export interface LocationPlan {
  creates: PlannedLocationCreate[];
  updates: PlannedLocationUpdate[];
  unchanged: number;
  /** Rows whose City or State came from the pincode. */
  filledFromPincode: number;
  failed: ImportIssue[];
}

export interface PincodePlace {
  city: string | null;
  state: string | null;
}

export interface LocationPlanContext {
  /** How many GRN numbers start with each branch's current prefix, by branch id. */
  prefixUseCount: Map<string, number>;
  /** City / State per pincode, from the lookup; null when the lookup found nothing. */
  pincodes: Map<string, PincodePlace | null>;
}

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const PREFIX_PATTERN = /^[A-Z0-9]{1,10}$/;
const PINCODE_PATTERN = /^\d{6}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "+91 98765-43210" -> "9876543210"; null when it is not 10 digits. */
export function normalisePhone(text: string): string | null {
  let digits = text.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return /^\d{10}$/.test(digits) ? digits : null;
}

/** Pincodes of rows that leave City or State empty - the only ones worth looking up. */
export function pincodesToLookUp(rows: ExcelRow[]): string[] {
  const pincodes = new Set<string>();
  for (const row of rows) {
    const pincode = row.text(H.pincode);
    if (pincode && PINCODE_PATTERN.test(pincode) && (!row.text(H.city) || !row.text(H.state))) {
      pincodes.add(pincode);
    }
  }
  return [...pincodes];
}

export function planLocationImport(
  rows: ExcelRow[],
  existing: LocationRecord[],
  context: LocationPlanContext,
): LocationPlan {
  const plan: LocationPlan = { creates: [], updates: [], unchanged: 0, filledFromPincode: 0, failed: [] };

  const byId = new Map(existing.map((record) => [record.id, record]));
  const byName = LookupIndex.fromRecords(existing, {
    names: (record) => [record.name],
    scope: (record) => record.type,
  });
  const claimedBy = new Map<LocationRecord, number>();

  for (const row of rows) {
    const errors: string[] = [];
    const recordId = row.text(H.recordId);
    const name = row.text(H.name);
    const typeText = row.text(H.type);

    if (!name) errors.push(`${H.name} is empty`);

    // ── Type ───────────────────────────────────────────────────────────────
    let type: LocationTypeInfo | null = null;
    if (typeText) {
      type = findLocationType(typeText);
      if (!type) {
        errors.push(`${H.type} must be one of: ${LOCATION_TYPES.map((t) => t.label).join(', ')}`);
      }
    }

    // ── Which record ───────────────────────────────────────────────────────
    let target: LocationRecord | null = null;
    let foundByName = false;
    if (recordId) {
      target = byId.get(recordId) ?? null;
      if (!target) {
        errors.push(
          `Record ID ${recordId} was not found - it was deleted, or the row comes from ` +
            'another system. Clear the Record ID to add it as a new location',
        );
      }
    } else if (name && type) {
      const found = byName.find(name, type.value);
      if (found.status === 'found') {
        target = found.record;
        foundByName = true;
      } else if (found.status === 'ambiguous') {
        errors.push(
          `"${name}" matches ${found.candidates.length} existing ${type.label} locations - ` +
            'export the list and use the Record ID to say which one this row is',
        );
      }
    }

    if (target && type && type.value !== target.type) {
      errors.push(
        `This location is a ${typeByValue.get(target.type)?.label ?? target.type}; ` +
          'its type cannot be changed by an import',
      );
    }
    if (!target && !recordId && !typeText) errors.push(`${H.type} is needed for a new location`);
    if (target) {
      const earlierRow = claimedBy.get(target);
      if (earlierRow !== undefined) errors.push(`Row ${earlierRow} already changes this location`);
    }

    const kind: LocationKind | null = target?.kind ?? type?.kind ?? null;
    const isNew = !target;

    // ── Location fields ────────────────────────────────────────────────────
    const values: PlannedLocationCreate['values'] = {};
    if (name) values.name = name;

    const prefixText = row.text(H.prefix);
    if (prefixText) {
      const prefix = prefixText.toUpperCase();
      if (kind === 'office') errors.push(`${H.prefix} is only used by branches - leave it empty for an office`);
      else if (!PREFIX_PATTERN.test(prefix)) errors.push(`${H.prefix} must be 1 to 10 letters or digits`);
      else values.prefix = prefix;
    } else if (isNew && kind === 'branch') {
      errors.push(`${H.prefix} is needed for a new branch - it starts its GRN numbers`);
    }

    for (const [header, property] of [
      [H.firstName, 'cFirstName'],
      [H.middleName, 'cMiddleName'],
      [H.lastName, 'cLastName'],
      [H.notes, 'notes'],
    ] as const) {
      const value = row.text(header);
      if (value) values[property] = value;
    }

    const phoneText = row.text(H.phone);
    if (phoneText) {
      const phone = normalisePhone(phoneText);
      if (phone) values.contactNumber = phone;
      else errors.push(`${H.phone} "${phoneText}" is not a 10-digit number`);
    }

    const email = row.text(H.email);
    if (email) {
      if (kind === 'branch') errors.push(`${H.email} is only kept for offices - leave it empty for a branch`);
      else if (!EMAIL_PATTERN.test(email)) errors.push(`${H.email} "${email}" is not an email address`);
      else values.officeEmail = email;
    }

    for (const [header, property] of [
      [H.total, 'totalCapacity'],
      [H.current, 'currentCapacity'],
    ] as const) {
      const text = row.text(header);
      if (!text) continue;
      const number = toNumber(text);
      if (kind === 'office') errors.push(`${header} is only kept for branches - leave it empty for an office`);
      else if (number === null || !Number.isInteger(number) || number < 0) {
        errors.push(`${header} must be a whole number, 0 or more`);
      } else values[property] = number;
    }

    // ── Address ────────────────────────────────────────────────────────────
    const address: Partial<Record<AddressField, string>> = {};
    for (const [header, property] of [
      [H.address1, 'address1'],
      [H.address2, 'address2'],
      [H.area, 'location'],
      [H.city, 'city'],
      [H.state, 'state'],
    ] as const) {
      const value = row.text(header);
      if (value) address[property] = value;
    }

    const pincode = row.text(H.pincode);
    if (pincode) {
      if (PINCODE_PATTERN.test(pincode)) address.pincode = pincode;
      else errors.push(`${H.pincode} "${pincode}" must be 6 digits`);
    }

    // City / State from the pincode (D8): only when they are empty, and only
    // for a new address or a changed pincode - otherwise empty keeps them.
    const pincodeIsNew = Boolean(address.pincode) && address.pincode !== target?.address?.pincode;
    if ((isNew || !target?.address || pincodeIsNew) && address.pincode && (!address.city || !address.state)) {
      const place = context.pincodes.get(address.pincode);
      if (place) {
        let filled = false;
        if (!address.city && place.city) {
          address.city = place.city;
          filled = true;
        }
        if (!address.state && place.state) {
          address.state = place.state;
          filled = true;
        }
        if (filled) plan.filledFromPincode++;
      }
    }

    // A new location - or an existing one with no address yet - needs a full address (D7).
    const needsFullAddress = isNew || (target !== null && !target.address);
    const touchesAddress = Object.keys(address).length > 0;
    if (needsFullAddress && (isNew || touchesAddress)) {
      for (const [header, property] of [
        [H.address1, 'address1'],
        [H.pincode, 'pincode'],
        [H.city, 'city'],
        [H.state, 'state'],
      ] as const) {
        if (address[property]) continue;
        // A malformed pincode is already reported, and it is also why City /
        // State could not be looked up - one message is enough.
        const pincodeMalformed = Boolean(pincode) && !address.pincode;
        if (pincodeMalformed && property !== 'address1') continue;
        errors.push(
          property === 'city' || property === 'state'
            ? `${header} is needed - the pincode lookup could not fill it in`
            : `${header} is needed for a new location`,
        );
      }
    }

    // ── Capacity ───────────────────────────────────────────────────────────
    if (kind === 'branch') {
      const total = values.totalCapacity ?? target?.totalCapacity ?? null;
      const current = values.currentCapacity ?? target?.currentCapacity ?? null;
      if (typeof total === 'number' && typeof current === 'number') {
        if (current > total) errors.push(`${H.current} cannot be more than ${H.total}`);
        else if (values.totalCapacity !== undefined || values.currentCapacity !== undefined) {
          values.balanceCapacity = total - current;
        }
      }
    }

    // ── Prefix lock (D5) ───────────────────────────────────────────────────
    if (target && values.prefix && target.prefix && values.prefix !== target.prefix) {
      const used = context.prefixUseCount.get(target.id) ?? 0;
      if (used > 0) {
        errors.push(
          `${H.prefix} ${target.prefix} is already in ${used} GRN number(s), so the import cannot change it`,
        );
      }
    }

    if (errors.length) {
      plan.failed.push({ row: row.rowNumber, reason: errors.join('; ') });
      continue;
    }

    if (!target) {
      plan.creates.push({ row: row.rowNumber, kind: type!.kind, type: type!.value, values, address });
      continue;
    }

    claimedBy.set(target, row.rowNumber);
    // Found by name: the typed spelling must not overwrite the stored one.
    if (foundByName) delete values.name;

    const changes: PlannedLocationUpdate['changes'] = {};
    for (const [property, value] of Object.entries(values) as [keyof typeof values, string | number][]) {
      const current = target[property as keyof LocationRecord];
      const same =
        typeof value === 'number'
          ? current !== null && current !== undefined && Number(current) === value
          : asText(current) === value;
      if (!same) changes[property] = value;
    }

    const addressChanges: Partial<Record<AddressField, string>> = {};
    for (const [property, value] of Object.entries(address) as [AddressField, string][]) {
      if (asText(target.address?.[property]) !== value) addressChanges[property] = value;
    }

    const createAddress = !target.address && Object.keys(addressChanges).length > 0;
    if (Object.keys(changes).length || Object.keys(addressChanges).length) {
      plan.updates.push({ row: row.rowNumber, record: target, changes, addressChanges, createAddress });
    } else {
      plan.unchanged++;
    }
  }

  for (const clash of findLocationClashes(plan, existing)) {
    plan.failed.push(clash);
  }

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

/**
 * Once the file is saved, names must stay unique within their type and
 * prefixes unique across branches. An existing location the file leaves
 * alone keeps the value; otherwise the earliest row does.
 */
function findLocationClashes(plan: LocationPlan, existing: LocationRecord[]): ImportIssue[] {
  const updates = new Map(plan.updates.map((update) => [update.record, update]));
  const states = [
    ...existing.map((record) => {
      const update = updates.get(record);
      return {
        row: update?.row ?? null,
        label: record.name,
        type: record.type,
        kind: record.kind,
        name: (update?.changes.name as string | undefined) ?? record.name,
        prefix: (update?.changes.prefix as string | undefined) ?? record.prefix,
      };
    }),
    ...plan.creates.map((create) => ({
      row: create.row as number | null,
      label: create.values.name as string,
      type: create.type,
      kind: create.kind,
      name: create.values.name as string,
      prefix: (create.values.prefix as string | undefined) ?? null,
    })),
  ];

  const groups = new Map<string, { state: (typeof states)[number]; typed: string; what: string }[]>();
  const add = (key: string, entry: { state: (typeof states)[number]; typed: string; what: string }) =>
    groups.set(key, [...(groups.get(key) ?? []), entry]);

  for (const state of states) {
    add(`name|${state.type}|${normaliseName(state.name)}`, { state, typed: state.name, what: 'name' });
    if (state.kind === 'branch' && state.prefix) {
      add(`prefix|${state.prefix.toUpperCase()}`, { state, typed: state.prefix, what: 'prefix' });
    }
  }

  const issues: ImportIssue[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const fromFile = group.filter((entry) => entry.state.row !== null).sort((a, b) => a.state.row! - b.state.row!);
    if (!fromFile.length) continue;
    const owner = group.find((entry) => entry.state.row === null) ?? fromFile[0];

    for (const entry of fromFile) {
      if (entry === owner) continue;
      const by =
        owner.state.row === null ? `the existing location "${owner.state.label}"` : `row ${owner.state.row}`;
      issues.push({
        row: entry.state.row!,
        reason:
          entry.what === 'prefix'
            ? `${H.prefix} ${entry.typed.toUpperCase()} is already used by ${by}`
            : `"${entry.typed}" is already used by ${by} (${typeByValue.get(entry.state.type)?.label})`,
      });
    }
  }
  return issues;
}
