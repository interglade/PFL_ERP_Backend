/**
 * Turns a `DocumentFilterInput` into SQL on a document query.
 *
 * It is applied inside the shared visibility queries (documents the user may see),
 * so every condition is AND-ed with the existing authorisation rules: a filter can
 * narrow what a user sees, never widen it. Everything happens in the database,
 * before pagination.
 *
 * Joins are added only for the filters actually requested. Line-item filters use
 * EXISTS subqueries, so a document with several matching lines is returned once.
 */

import moment from 'moment-timezone';
import { Brackets, ObjectLiteral, SelectQueryBuilder, WhereExpressionBuilder } from 'typeorm';
import { ApproverStatus } from '../../approvalFlow/entity/approvalname.entity';
import { getModuleFilterDefinition, userFullNameExpr } from './documentFilter.definitions';
import { FILTER_TIMEZONE, PRODUCT_FILTERS } from './documentFilter.parser';
import { DocumentFilterInput, FieldFilter, FilterValue, ModuleFilterDefinition } from './documentFilter.types';

export interface FilterQueryOptions {
  /** Alias of the `documents` entity in the query. */
  documentAlias: string;
  /** Alias of the module record when the query is already rooted on it (Final Invoice). */
  recordAlias?: string;
}

const APPROVAL_STAGES = ['verified', 'firstApproved', 'secondApproved', 'thirdApproved', 'firstFinalized', 'secondFinalized'] as const;
const APPROVED_ACTIONS = [ApproverStatus.APPROVED, ApproverStatus.VERIFIED];

/** Escapes LIKE wildcards so user input is matched literally. */
export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function dayStart(day: string): Date {
  return moment.tz(day, 'YYYY-MM-DD', FILTER_TIMEZONE).startOf('day').toDate();
}
function dayEnd(day: string): Date {
  return moment.tz(day, 'YYYY-MM-DD', FILTER_TIMEZONE).endOf('day').toDate();
}

class FilterQuery<T extends ObjectLiteral> {
  private readonly joined = new Map<string, string>();
  private seq = 0;

  constructor(
    private readonly qb: SelectQueryBuilder<T>,
    private readonly def: ModuleFilterDefinition,
    private readonly options: FilterQueryOptions,
  ) {}

  /** A unique, safe parameter name holding `value`. */
  param(value: unknown): string {
    const name = `flt_p${this.seq++}`;
    this.qb.setParameter(name, value);
    return name;
  }

  alias(name: string): string {
    if (name === 'doc') return this.options.documentAlias;
    if (name === 'rec') {
      if (this.options.recordAlias) return this.options.recordAlias;
      if (!this.joined.has('rec')) {
        // Module records are entity classes; leftJoin's entity overload takes a class or name.
        this.qb.leftJoin(this.def.entity as Function | string, 'flt_rec', `CAST(flt_rec.id AS varchar) = ${this.options.documentAlias}.document_type_id`);
        this.joined.set('rec', 'flt_rec');
      }
      return 'flt_rec';
    }
    const existing = this.joined.get(name);
    if (existing) return existing;
    const path = this.def.joins[name];
    if (!path) throw new Error(`Filter definition '${this.def.module}' has no join '${name}'`);
    const [base, property] = path.split('.');
    const aliasName = `flt_${name}`;
    this.qb.leftJoin(`${this.alias(base)}.${property}`, aliasName);
    this.joined.set(name, aliasName);
    return aliasName;
  }

  private join(path: string, aliasName: string): string {
    if (!this.joined.has(aliasName)) {
      this.qb.leftJoin(path, aliasName);
      this.joined.set(aliasName, aliasName);
    }
    return aliasName;
  }

  /** Resolves `rec.` / `doc.` / `<join>.` prefixes in an expression, adding joins as needed. */
  render(expr: string): string {
    return expr.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\.(?=[A-Za-z_"])/g, (match, name: string) =>
      name === 'rec' || name === 'doc' || this.def.joins[name] ? `${this.alias(name)}.` : match,
    );
  }

  /**
   * `<join>.id` compared through the owning record's foreign key instead of the joined
   * row, so a record still matches the id it references when that related row has
   * been soft-deleted (TypeORM excludes soft-deleted rows from joins).
   */
  idExpr(expr: string): string {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\.id$/.exec(expr);
    const path = m ? this.def.joins[m[1]] : undefined;
    if (!path) return this.render(expr);
    const [base, property] = path.split('.');
    return `${this.alias(base)}.${property}`;
  }

  textCondition(exprs: string[], value: string): string {
    const p = this.param(likePattern(value));
    return `(${exprs.map((e) => `CAST(${this.render(e)} AS TEXT) ILIKE :${p}`).join(' OR ')})`;
  }

  creatorAlias(): string {
    return this.join(`${this.options.documentAlias}.lastActionBy`, 'flt_creator');
  }

  fieldCondition(field: FieldFilter, value: FilterValue): string {
    const exprs = field.exprs;
    switch (field.kind) {
      case 'id': {
        if (typeof value === 'string') return this.textCondition(field.nameExprs ?? exprs, value);
        const p = this.param(value);
        return `(${exprs.map((e) => `${this.idExpr(e)} IN (:...${p})`).join(' OR ')})`;
      }
      case 'enum': {
        const p = this.param(value);
        return `(${exprs.map((e) => `CAST(${this.render(e)} AS TEXT) IN (:...${p})`).join(' OR ')})`;
      }
      case 'iexact': {
        const p = this.param(value);
        return `(${exprs.map((e) => `LOWER(CAST(${this.render(e)} AS TEXT)) IN (:...${p})`).join(' OR ')})`;
      }
      case 'boolean':
      case 'day': {
        const p = this.param(value);
        return `(${exprs.map((e) => `${this.render(e)} = :${p}`).join(' OR ')})`;
      }
      case 'min': {
        const p = this.param(value);
        return `(${exprs.map((e) => `${this.render(e)} >= :${p}`).join(' OR ')})`;
      }
      case 'max': {
        const p = this.param(value);
        return `(${exprs.map((e) => `${this.render(e)} <= :${p}`).join(' OR ')})`;
      }
      case 'text':
      default:
        return this.textCondition(exprs, String(value));
    }
  }

  /**
   * EXISTS over the line items (or the header product) matching every requested
   * product filter. `extra` adds an OR-group used by `search`.
   */
  productCondition(criteria: Record<string, FilterValue>, searchTerm?: string): string | null {
    const productParams = PRODUCT_FILTERS.map((f) => f.param);
    const lineText = this.def.lineItems?.textFields ?? [];
    const wanted = [...productParams, ...lineText.map((f) => f.param)].filter((p) => criteria[p] !== undefined);
    if (!wanted.length && !searchTerm) return null;

    // Product on the record itself (AQR)
    if (this.def.headerProduct) {
      const product = this.alias(this.def.headerProduct.product);
      const category = this.join(`${product}.category`, 'flt_hp_category');
      const variant = this.def.headerProduct.variant ? this.alias(this.def.headerProduct.variant) : null;
      const fk = {
        product: this.idExpr(`${this.def.headerProduct.product}.id`),
        variant: this.def.headerProduct.variant ? this.idExpr(`${this.def.headerProduct.variant}.id`) : null,
      };
      return this.productPredicates(criteria, wanted, product, variant, category, [], searchTerm, fk);
    }

    const li = this.def.lineItems;
    if (!li) return null;
    const sub = this.qb.subQuery().select('1').from(li.entity, 'flt_line');
    if (li.parentRelation) {
      sub.innerJoin(`flt_line.${li.parentRelation}`, 'flt_line_parent').where(`flt_line_parent.id = ${this.render(li.parentIdExpr ?? 'rec.id')}`);
    } else {
      sub.where(`flt_line.id = ${this.render('rec.id')}`);
    }
    sub.leftJoin(`flt_line.${li.product}`, 'flt_line_product').leftJoin('flt_line_product.category', 'flt_line_category');
    if (li.variant) sub.leftJoin(`flt_line.${li.variant}`, 'flt_line_variant');

    const predicate = this.productPredicates(
      criteria,
      wanted,
      'flt_line_product',
      li.variant ? 'flt_line_variant' : null,
      'flt_line_category',
      lineText.map((f) => ({ param: f.param, expr: `flt_line.${f.column}` })),
      searchTerm,
      // Lines reference products by foreign key; a many-to-many has none, so match the joined id.
      li.parentRelation
        ? { product: `flt_line.${li.product}`, variant: li.variant ? `flt_line.${li.variant}` : null }
        : undefined,
    );
    if (predicate) sub.andWhere(predicate);
    return `EXISTS ${sub.getQuery()}`;
  }

  private productPredicates(
    criteria: Record<string, FilterValue>,
    wanted: string[],
    product: string,
    variant: string | null,
    category: string,
    lineText: { param: string; expr: string }[],
    searchTerm?: string,
    /** Foreign-key expressions for id matches, when the product/variant are referenced by FK. */
    fk?: { product: string; variant: string | null },
  ): string | null {
    const parts: string[] = [];
    const ids = (expr: string, v: FilterValue) => `${expr} IN (:...${this.param(v)})`;
    const like = (expr: string, v: FilterValue) => `CAST(${expr} AS TEXT) ILIKE :${this.param(likePattern(String(v)))}`;

    for (const param of wanted) {
      const v = criteria[param];
      switch (param) {
        case 'productId': parts.push(ids(fk?.product ?? `${product}.id`, v)); break;
        case 'productCode': parts.push(like(`${product}.productCode`, v)); break;
        case 'productName': parts.push(like(`${product}.name`, v)); break;
        case 'categoryId': parts.push(ids(`${category}.id`, v)); break;
        case 'category': parts.push(like(`${category}.name`, v)); break;
        // A variant filter can only match lines that carry a variant.
        case 'variantId': parts.push(variant ? ids(fk?.variant ?? `${variant}.id`, v) : 'FALSE'); break;
        case 'variant': parts.push(variant ? like(`${variant}.variantName`, v) : 'FALSE'); break;
        default: {
          const lt = lineText.find((f) => f.param === param);
          if (lt) parts.push(like(lt.expr, v));
        }
      }
    }
    if (searchTerm) {
      const p = this.param(likePattern(searchTerm));
      parts.push(`(CAST(${product}.name AS TEXT) ILIKE :${p} OR CAST(${product}.productCode AS TEXT) ILIKE :${p})`);
    }
    return parts.length ? `(${parts.join(' AND ')})` : null;
  }

  approvalCondition(criteria: Record<string, FilterValue>): string | null {
    const { approvedById, approvedBy, approvalStartDate, approvalEndDate } = criteria;
    if (approvedById === undefined && approvedBy === undefined && approvalStartDate === undefined && approvalEndDate === undefined) {
      return null;
    }
    const info = this.join(`${this.options.documentAlias}.approvalInfo`, 'flt_approval_info');
    const actions = this.param(APPROVED_ACTIONS);
    const idsP = approvedById !== undefined ? this.param(approvedById) : null;
    const nameP = approvedBy !== undefined ? this.param(likePattern(String(approvedBy))) : null;
    const fromP = approvalStartDate !== undefined ? this.param(dayStart(String(approvalStartDate))) : null;
    const toP = approvalEndDate !== undefined ? this.param(dayEnd(String(approvalEndDate))) : null;

    const perStage = APPROVAL_STAGES.map((stage) => {
      const s = this.join(`${info}.${stage}`, `flt_stage_${stage}`);
      const conds = [`${s}.status IN (:...${actions})`];
      if (idsP) conds.push(`${s}.userId IN (:...${idsP})`);
      if (nameP) conds.push(`${s}.userName ILIKE :${nameP}`);
      if (fromP) conds.push(`${s}.statusChangedAt >= :${fromP}`);
      if (toP) conds.push(`${s}.statusChangedAt <= :${toP}`);
      return `(${conds.join(' AND ')})`;
    });
    return `(${perStage.join(' OR ')})`;
  }

  where(condition: string | null) {
    if (condition) this.qb.andWhere(condition);
  }
}

/**
 * Adds the filter conditions and, when the requested `sort` key is whitelisted for
 * the module, the ordering. Returns true when it set the ORDER BY, so the caller
 * only applies its default ordering otherwise. User input never reaches ORDER BY
 * directly. No-op (returns false) without input.
 */
export function applyDocumentFilters<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  input: DocumentFilterInput | undefined,
  options: FilterQueryOptions,
): boolean {
  if (!input) return false;
  const def = getModuleFilterDefinition(input.documentType);
  if (!def) return false;
  // One instance for filters and ordering, so a join both need is added once.
  const f = new FilterQuery(qb, def, options);
  const c = input.criteria;
  const doc = options.documentAlias;

  // Business date (inclusive whole days)
  if (c.startDate !== undefined || c.endDate !== undefined) {
    const dateExpr = f.render(def.businessDate.expr);
    const toValue = (day: string, end: boolean) => (def.businessDate.kind === 'date' ? day : end ? dayEnd(day) : dayStart(day));
    if (c.startDate !== undefined) f.where(`${dateExpr} >= :${f.param(toValue(String(c.startDate), false))}`);
    if (c.endDate !== undefined) f.where(`${dateExpr} <= :${f.param(toValue(String(c.endDate), true))}`);
  }

  if (c.status !== undefined) f.where(`CAST(${doc}.status AS TEXT) IN (:...${f.param(c.status)})`);
  if (c.documentNo !== undefined) f.where(f.textCondition([`rec.${def.numberColumn}`], String(c.documentNo)));

  if (c.createdById !== undefined) f.where(`${doc}.lastActionBy IN (:...${f.param(c.createdById)})`);
  if (c.createdBy !== undefined) f.where(f.textCondition([userFullNameExpr(f.creatorAlias())], String(c.createdBy)));

  f.where(f.approvalCondition(c));

  for (const field of def.fields) {
    if (c[field.param] !== undefined) f.where(f.fieldCondition(field, c[field.param]));
  }

  f.where(f.productCondition(c));

  if (c.search !== undefined) {
    const term = String(c.search);
    const p = f.param(likePattern(term));
    const exprs = [`rec.${def.numberColumn}`, userFullNameExpr(f.creatorAlias()), `${doc}.status`, ...def.search];
    const textMatch = exprs.map((e) => `CAST(${f.render(e)} AS TEXT) ILIKE :${p}`);
    const productMatch = def.lineItems || def.headerProduct ? f.productCondition({}, term) : null;
    qb.andWhere(
      new Brackets((b: WhereExpressionBuilder) => {
        textMatch.forEach((cond) => b.orWhere(cond));
        if (productMatch) b.orWhere(productMatch);
      }),
    );
  }

  const sortExpr = input.sort ? def.sortable[input.sort.key] : undefined;
  if (!input.sort || !sortExpr) return false;
  qb.orderBy(f.render(sortExpr), input.sort.direction);
  // Deterministic pages when many rows share the sort value.
  qb.addOrderBy(`${doc}.id`, 'ASC');
  return true;
}

/**
 * Validates a raw `field:DIR` sort string for queries that still take one directly.
 * Only `alias.property` on the listed aliases is allowed; anything else falls back.
 */
export function safeSqlSort(
  sort: string | undefined,
  allowedAliases: readonly string[],
  fallback: [string, 'ASC' | 'DESC'],
): [string, 'ASC' | 'DESC'] {
  if (!sort) return fallback;
  const [field, dir] = sort.split(',')[0].split(':');
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec((field || '').trim());
  if (!match || !allowedAliases.includes(match[1])) return fallback;
  return [match[0], (dir || '').trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC'];
}
