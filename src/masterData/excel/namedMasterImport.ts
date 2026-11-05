/**
 * Works out what an Excel import of a small, name-keyed master would change -
 * which rows create a record, which update one, and which are wrong - without
 * touching the database. The service saves the plan only when no row failed
 * (docs/master-data-excel-plan.md §5, D1: nothing is saved if any row fails).
 *
 * Kept free of TypeORM so every rule can be tested with plain objects.
 */

import { ExcelRow, ImportIssue } from '../../excel/excelImport.service';
import { LookupIndex } from '../../excel/lookupIndex';
import { normaliseName } from '../../excel/lookupByName';
import { toNumber } from '../../excel/excelValue';
import { NamedMasterConfig, NamedMasterField, NamedRecord } from './namedMasters';

type FieldValue = string | number;

/** A parent the row moves the record to, with names for the audit log. */
export interface ParentChange {
  id: string;
  from: string | null;
  to: string;
}

export interface PlannedCreate {
  row: number;
  values: Record<string, FieldValue>;
  /** Id of the parent record, for masters that have one. */
  parentId: string | null;
}

export interface PlannedUpdate<T> {
  row: number;
  record: T;
  /** Only the fields whose value changes. */
  changes: Record<string, FieldValue>;
  /** Set only when the row moves the record to another parent. */
  parentChange?: ParentChange;
}

export interface NamedMasterPlan<T> {
  creates: PlannedCreate[];
  updates: PlannedUpdate<T>[];
  /** Rows that name an existing record and change nothing. */
  unchanged: number;
  failed: ImportIssue[];
}

/** What a record will look like once the plan is saved, for the clash check. */
interface FinalState<T> {
  /** The file row that creates or changes it; null for a record the file leaves alone. */
  row: number | null;
  record: T | null;
  values: Record<string, unknown>;
  scope: string;
}

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const choiceKey = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, ' ').trim();

/** Parses one field cell. Blank is `undefined` (keep the current value). */
function readField(
  field: NamedMasterField,
  row: ExcelRow,
): { value?: FieldValue; error?: string } {
  const text = row.text(field.header);
  if (text === null) return {};

  if (field.type === 'number') {
    const number = toNumber(text);
    if (number === null) return { error: `${field.header} "${text}" is not a number` };
    if (number < 0) return { error: `${field.header} cannot be negative` };
    return { value: number };
  }

  if (field.type === 'choice') {
    const key = choiceKey(text);
    const choice = field.choices?.find(
      (option) => choiceKey(option.label) === key || choiceKey(option.value) === key,
    );
    if (!choice) {
      return {
        error: `${field.header} must be one of: ${field.choices?.map((option) => option.label).join(', ')}`,
      };
    }
    return { value: choice.value };
  }

  if (field.maxLength && text.length > field.maxLength) {
    return { error: `${field.header} is longer than ${field.maxLength} characters` };
  }
  return { value: text };
}

const sameValue = (field: NamedMasterField | undefined, current: unknown, next: FieldValue) =>
  field?.type === 'number'
    ? current !== null && current !== undefined && current !== '' && Number(current) === next
    : asText(current) === next;

export function planNamedMasterImport<T extends NamedRecord>(
  config: NamedMasterConfig,
  rows: ExcelRow[],
  existing: T[],
  parents?: LookupIndex<NamedRecord>,
): NamedMasterPlan<T> {
  const parent = config.parent;
  if (parent && !parents) {
    throw new Error(`${config.label} links to ${parent.label}; the ${parent.label} records are needed`);
  }

  const plan: NamedMasterPlan<T> = { creates: [], updates: [], unchanged: 0, failed: [] };

  const parentIdOf = (record: NamedRecord): string | null =>
    parent ? (record[parent.property]?.id ?? null) : null;

  /** The scope a record's name is unique in - see `uniqueWithin`. */
  const scopeOf = (parentId: string | null, values: Record<string, unknown>): string => {
    if (config.uniqueWithin === 'parent') return parentId ?? '';
    if (config.uniqueWithin) return asText(values[config.uniqueWithin]) ?? '';
    return '';
  };

  const byId = new Map(existing.map((record) => [record.id, record]));
  const byName = LookupIndex.fromRecords(existing, {
    names: (record) => [asText(record[config.nameProperty])],
    scope: config.uniqueWithin ? (record) => scopeOf(parentIdOf(record), record) : undefined,
  });
  const fieldByProperty = new Map(config.fields.map((field) => [field.property, field]));

  /** Existing record -> the row that already claimed it, so two rows cannot both change it. */
  const claimedBy = new Map<T, number>();
  const fail = (row: number, reason: string) => plan.failed.push({ row, reason });

  for (const row of rows) {
    const errors: string[] = [];
    const recordId = row.text(config.keyHeader);
    const name = row.text(config.nameHeader);

    if (!name) {
      errors.push(`${config.nameHeader} is empty`);
    } else if (config.nameMaxLength && name.length > config.nameMaxLength) {
      errors.push(`${config.nameHeader} is longer than ${config.nameMaxLength} characters`);
    }

    const values: Record<string, FieldValue> = {};
    if (name) values[config.nameProperty] = name;

    /** Fields already reported as wrong, so they are not also reported as missing. */
    const invalidFields = new Set<string>();
    for (const field of config.fields) {
      const { value, error } = readField(field, row);
      if (error) {
        errors.push(error);
        invalidFields.add(field.property);
      } else if (value !== undefined) {
        values[field.property] = value;
      }
    }

    // ── Parent: must already exist (D2) ────────────────────────────────────
    let parentId: string | null = null;
    let parentName: string | null = null;
    const parentText = parent ? row.text(parent.header) : null;
    if (parent && parentText) {
      const found = parents!.find(parentText);
      if (found.status === 'found') {
        parentId = found.record.id;
        parentName = asText(parent.display(found.record));
      } else if (found.status === 'ambiguous') {
        errors.push(`${parent.header} "${parentText}" matches ${found.candidates.length} ${parent.label} records`);
      } else {
        errors.push(
          `${parent.header} "${parentText}" was not found - add it in ${parent.label} first` +
            (found.suggestion ? ` (did you mean "${found.suggestion}"?)` : ''),
        );
      }
    }

    // ── Which record the row is ────────────────────────────────────────────
    let target: T | null = null;
    let foundByName = false;
    if (recordId) {
      target = byId.get(recordId) ?? null;
      if (!target) {
        errors.push(
          `Record ID ${recordId} was not found - it was deleted, or the row comes from ` +
            'another system. Clear the Record ID to add it as a new record',
        );
      }
    } else if (name) {
      const scoped = Boolean(config.uniqueWithin);
      const scope = scopeOf(parentId, values);
      // Without its parent a row cannot be matched to an existing record, so it
      // is treated as new - and then fails below for the missing parent. An
      // empty optional scope field (Use For) keeps the current value, so the
      // row is matched by name alone.
      const found =
        scoped && !scope
          ? config.uniqueWithin === 'parent'
            ? null
            : byName.find(name)
          : byName.find(name, scoped ? scope : undefined);
      if (found?.status === 'found') {
        target = found.record;
        foundByName = true;
      }
      if (found?.status === 'ambiguous') {
        errors.push(
          `"${name}" matches ${found.candidates.length} existing records - ` +
            'export the list and use the Record ID to say which one this row is',
        );
      }
    }

    if (target) {
      const earlierRow = claimedBy.get(target);
      if (earlierRow !== undefined) {
        errors.push(`Row ${earlierRow} already changes this record`);
      }
    } else if (!recordId) {
      // A new record needs everything marked required.
      if (parent?.required && !parentText) {
        errors.push(`${parent.header} is needed for a new ${config.label}`);
      }
      for (const field of config.fields) {
        if (
          field.required &&
          values[field.property] === undefined &&
          !invalidFields.has(field.property)
        ) {
          errors.push(`${field.header} is needed for a new ${config.label}`);
        }
      }
    }

    if (errors.length) {
      fail(row.rowNumber, errors.join('; '));
      continue;
    }

    if (!target) {
      plan.creates.push({ row: row.rowNumber, values, parentId });
      continue;
    }

    claimedBy.set(target, row.rowNumber);

    // The name only found the record - "mandi  supplier" must not overwrite the
    // stored "Mandi Supplier". Renaming is done through the Record ID.
    if (foundByName) delete values[config.nameProperty];

    const changes: Record<string, FieldValue> = {};
    for (const [property, value] of Object.entries(values)) {
      if (!sameValue(fieldByProperty.get(property), target[property], value)) {
        changes[property] = value;
      }
    }

    let parentChange: ParentChange | undefined;
    if (parent && parentId && parentId !== parentIdOf(target)) {
      parentChange = {
        id: parentId,
        from: target[parent.property] ? asText(parent.display(target[parent.property])) : null,
        to: parentName ?? parentId,
      };
    }

    if (Object.keys(changes).length || parentChange) {
      plan.updates.push({ row: row.rowNumber, record: target, changes, parentChange });
    } else {
      plan.unchanged++;
    }
  }

  for (const clash of findClashes(config, plan, existing, parentIdOf, scopeOf)) {
    fail(clash.row, clash.reason);
  }

  // One entry per row, even when it clashed on two values.
  const reasonsByRow = new Map<number, string[]>();
  for (const issue of plan.failed) {
    reasonsByRow.set(issue.row, [...(reasonsByRow.get(issue.row) ?? []), issue.reason]);
  }
  plan.failed = [...reasonsByRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, reasons]) => ({ row, reason: reasons.join('; ') }));

  // A failed row must not also be saved.
  plan.creates = plan.creates.filter((create) => !reasonsByRow.has(create.row));
  plan.updates = plan.updates.filter((update) => !reasonsByRow.has(update.row));

  return plan;
}

/**
 * Names (and other identifying values, like a UoM abbreviation) must stay
 * unique within their scope once the file is saved. Checked on the final state
 * rather than row by row, so renaming A to B while B is renamed to C in the
 * same file is fine, and so is moving a subcategory to another category.
 *
 * In each clash an existing record the file does not touch keeps the name;
 * otherwise the earliest row does, and every later row fails.
 */
function findClashes<T extends NamedRecord>(
  config: NamedMasterConfig,
  plan: NamedMasterPlan<T>,
  existing: T[],
  parentIdOf: (record: NamedRecord) => string | null,
  scopeOf: (parentId: string | null, values: Record<string, unknown>) => string,
): ImportIssue[] {
  const updatesByRecord = new Map(plan.updates.map((update) => [update.record, update]));

  const states: FinalState<T>[] = [
    ...existing.map((record) => {
      const update = updatesByRecord.get(record);
      const values: Record<string, unknown> = { ...record, ...(update?.changes ?? {}) };
      const parentId = update?.parentChange?.id ?? parentIdOf(record);
      return { row: update?.row ?? null, record, values, scope: scopeOf(parentId, values) };
    }),
    ...plan.creates.map((create) => ({
      row: create.row,
      record: null,
      values: create.values as Record<string, unknown>,
      scope: scopeOf(create.parentId, create.values),
    })),
  ];

  const holders = new Map<string, { state: FinalState<T>; typed: string }[]>();
  for (const state of states) {
    const seenKeys = new Set<string>();
    for (const property of config.identityProperties) {
      const typed = asText(state.values[property]);
      const name = typed ? normaliseName(typed) : '';
      if (!name) continue;
      const key = `${state.scope}|${name}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      holders.set(key, [...(holders.get(key) ?? []), { state, typed: typed! }]);
    }
  }

  const where = config.uniqueWithin === 'parent' ? ` under the same ${config.parent?.label}` : '';
  const issues: ImportIssue[] = [];
  const describe = (holder: { state: FinalState<T> }) =>
    holder.state.row === null
      ? `the existing ${config.label} "${asText(holder.state.record?.[config.nameProperty])}"${where}`
      : `row ${holder.state.row}${where}`;

  for (const group of holders.values()) {
    if (group.length < 2) continue;

    const untouched = group.find((holder) => holder.state.row === null);
    const fromFile = group
      .filter((holder) => holder.state.row !== null)
      .sort((a, b) => a.state.row! - b.state.row!);
    if (!fromFile.length) continue; // duplicates already in the database, not this file's doing

    const owner = untouched ?? fromFile[0];
    for (const holder of fromFile) {
      if (holder === owner) continue;
      issues.push({
        row: holder.state.row!,
        reason: `"${holder.typed}" is already used by ${describe(owner)}`,
      });
    }
  }

  return issues;
}
