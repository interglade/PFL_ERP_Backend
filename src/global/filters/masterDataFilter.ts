/**
 * Filters for master-data lists (Customer, Vendor, Farmer) and their Excel exports.
 *
 * A module declares its filters once; the list endpoint and the export both parse
 * the query string with `parseMasterFilters` and apply the result with
 * `applyMasterFilters`, so the exported file always matches the filtered list.
 *
 * Only declared parameters are read - query keys never reach the SQL. Values are
 * always bound as parameters. Invalid values are rejected with 400 (`AppError`);
 * absent or empty parameters apply no filter. Conditions are AND-ed onto the
 * existing visibility rules, so a filter can narrow what a user sees, never widen it.
 */

import moment from 'moment-timezone';
import { ParsedQs } from 'qs';
import { EntityTarget, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import AppError from '../../utils/appError';
import { Status } from '../../utils/status.enum';
import { FILTER_TIMEZONE } from './documentFilter.parser';
import { likePattern } from './documentFilter.query';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * - `enum`: one of `values`, comma separated for several (case-insensitive input)
 * - `id`: UUID(s), comma separated
 * - `text`: partial, case-insensitive match
 * - `dayFrom` / `dayTo`: YYYY-MM-DD, inclusive, in IST
 */
export type MasterFilterKind = 'enum' | 'id' | 'text' | 'dayFrom' | 'dayTo';

export interface MasterFilterField {
  param: string;
  /** Other accepted spellings of `param`. */
  aliases?: string[];
  kind: MasterFilterKind;
  /** Column expressions on the query's aliases; a record matches if any of them does. */
  exprs: string[];
  /** Allowed values for `enum`. */
  values?: readonly string[];
  /** `date` columns compare by day; `timestamp` columns by IST day boundaries. */
  columnType?: 'date' | 'timestamp';
  /** Name of an `existsGroups` entry: the condition is checked on a related row. */
  group?: string;
}

/**
 * Conditions on a one-to-many relation, checked with EXISTS so a matching record is
 * returned once and its related rows are not trimmed by the filter. All the group's
 * conditions must hold on the same related row.
 */
export interface MasterFilterExistsGroup {
  entity: EntityTarget<ObjectLiteral>;
  alias: string;
  /** Links the related row to the outer record, e.g. `flt_crop.farmer = farmer.id`. */
  link: string;
}

export interface MasterFilterDefinition {
  fields: MasterFilterField[];
  existsGroups?: Record<string, MasterFilterExistsGroup>;
  /** [from, to] parameter pairs whose order is validated. */
  ranges?: [string, string][];
}

export type MasterFilterCriteria = Record<string, string | string[]>;

/**
 * Filters every master-data module supports, with the same meaning everywhere:
 * status, created date range, creator and address city/state.
 */
export function commonMasterFilters(alias: string, address: { city: string[]; state: string[] }): MasterFilterField[] {
  return [
    { param: 'status', kind: 'enum', values: Object.values(Status), exprs: [`${alias}.status`] },
    { param: 'createdFrom', aliases: ['startDate', 'dateFrom'], kind: 'dayFrom', exprs: [`${alias}.createdAt`] },
    { param: 'createdTo', aliases: ['endDate', 'dateTo'], kind: 'dayTo', exprs: [`${alias}.createdAt`] },
    // Compared through the foreign key, so it does not depend on the createdBy join.
    { param: 'createdById', kind: 'id', exprs: [`${alias}.createdBy`] },
    { param: 'city', kind: 'text', exprs: address.city },
    { param: 'state', kind: 'text', exprs: address.state },
  ];
}

export const COMMON_MASTER_RANGES: [string, string][] = [['createdFrom', 'createdTo']];

function firstString(value: ParsedQs[string]): string | undefined {
  if (Array.isArray(value)) return firstString(value[0] as ParsedQs[string]);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function list(value: string): string[] {
  return Array.from(new Set(value.split(',').map((v) => v.trim()).filter(Boolean)));
}

function parseValue(field: MasterFilterField, raw: string): string | string[] {
  switch (field.kind) {
    case 'enum': {
      const allowed = field.values ?? [];
      return list(raw).map((v) => {
        const match = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
        if (!match) throw new AppError(400, `Invalid ${field.param} '${v}'. Allowed values: ${allowed.join(', ')}`);
        return match;
      });
    }
    case 'id': {
      const ids = list(raw);
      const bad = ids.find((v) => !UUID.test(v));
      if (bad !== undefined) throw new AppError(400, `Invalid ${field.param} '${bad}'. Expected a UUID`);
      return ids;
    }
    case 'dayFrom':
    case 'dayTo': {
      const day = moment.tz(raw, 'YYYY-MM-DD', true, FILTER_TIMEZONE);
      if (!day.isValid()) throw new AppError(400, `Invalid ${field.param} '${raw}'. Expected a date in YYYY-MM-DD format`);
      return day.format('YYYY-MM-DD');
    }
    case 'text':
    default:
      return raw;
  }
}

/** Reads and validates the module's filter parameters from a query string. */
export function parseMasterFilters(query: ParsedQs, def: MasterFilterDefinition): MasterFilterCriteria {
  const criteria: MasterFilterCriteria = {};
  for (const field of def.fields) {
    const raw = [field.param, ...(field.aliases ?? [])]
      .map((p) => firstString(query[p]))
      .find((v) => v !== undefined);
    if (raw !== undefined) criteria[field.param] = parseValue(field, raw);
  }
  for (const [from, to] of def.ranges ?? []) {
    const a = criteria[from];
    const b = criteria[to];
    if (a !== undefined && b !== undefined && a > b) {
      throw new AppError(400, `Invalid range: ${from} (${a}) is after ${to} (${b})`);
    }
  }
  return criteria;
}

/** Every parameter name a module's filters understand, for docs and the frontend. */
export function masterFilterParams(def: MasterFilterDefinition): string[] {
  return def.fields.flatMap((f) => [f.param, ...(f.aliases ?? [])]);
}

/** Adds the parsed filters to a query as `andWhere` conditions, before pagination. */
export function applyMasterFilters<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  def: MasterFilterDefinition,
  criteria: MasterFilterCriteria | undefined,
): void {
  if (!criteria || !Object.keys(criteria).length) return;

  let seq = 0;
  const param = (value: unknown): string => {
    const name = `mflt_p${seq++}`;
    qb.setParameter(name, value);
    return name;
  };

  const condition = (field: MasterFilterField, value: string | string[]): string => {
    const any = (build: (expr: string) => string) => `(${field.exprs.map(build).join(' OR ')})`;
    switch (field.kind) {
      case 'enum': {
        const p = param(value);
        return any((e) => `CAST(${e} AS TEXT) IN (:...${p})`);
      }
      case 'id': {
        const p = param(value);
        return any((e) => `${e} IN (:...${p})`);
      }
      case 'dayFrom':
      case 'dayTo': {
        const day = String(value);
        const isFrom = field.kind === 'dayFrom';
        const bound = field.columnType === 'date'
          ? day
          : moment.tz(day, 'YYYY-MM-DD', FILTER_TIMEZONE)[isFrom ? 'startOf' : 'endOf']('day').toDate();
        const p = param(bound);
        return any((e) => `${e} ${isFrom ? '>=' : '<='} :${p}`);
      }
      case 'text':
      default: {
        const p = param(likePattern(String(value)));
        return any((e) => `CAST(${e} AS TEXT) ILIKE :${p}`);
      }
    }
  };

  const grouped = new Map<string, string[]>();
  for (const field of def.fields) {
    const value = criteria[field.param];
    if (value === undefined) continue;
    if (field.group) {
      grouped.set(field.group, [...(grouped.get(field.group) ?? []), condition(field, value)]);
    } else {
      qb.andWhere(condition(field, value));
    }
  }

  for (const [name, conditions] of grouped) {
    const group = def.existsGroups?.[name];
    if (!group) throw new Error(`Master filter group '${name}' is not defined`);
    const sub = qb.subQuery().select('1').from(group.entity, group.alias).where(group.link);
    conditions.forEach((c) => sub.andWhere(c));
    qb.andWhere(`EXISTS ${sub.getQuery()}`);
  }
}
