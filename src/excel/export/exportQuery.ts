/**
 * Query helpers shared by the export definitions.
 *
 * Every relation is joined with an explicit column list rather than
 * `leftJoinAndSelect`: it keeps chunk queries lean, and it guarantees columns such
 * as `users.password` / `users.tempPlainPassword` can never end up in a workbook.
 */

import { EntityManager, EntityTarget, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { ExportLoadContext, ExportSheet } from './exportTypes';

export const USER_COLUMNS = ['id', 'firstName', 'middleName', 'lastName', 'employeeId'] as const;
export const COMPANY_COLUMNS = ['id', 'name', 'gstNo'] as const;
export const BRANCH_COLUMNS = ['id', 'name'] as const;
export const VENDOR_COLUMNS = ['id', 'companyName', 'vendorCode', 'gstn', 'officeContactNo'] as const;
export const FARMER_COLUMNS = ['id', 'farmerfName', 'farmermName', 'farmerlName', 'farmerCode', 'primaryMobileNo'] as const;
export const CUSTOMER_COLUMNS = ['id', 'organisationName', 'customerCode', 'primaryContactNo', 'emailPrimary'] as const;
export const PRODUCT_COLUMNS = ['id', 'name', 'productCode'] as const;
export const CATEGORY_COLUMNS = ['id', 'name'] as const;
export const VARIANT_COLUMNS = ['id', 'variantName', 'variantCode'] as const;
export const UOM_COLUMNS = ['id', 'unit'] as const;
export const ADDRESS_COLUMNS = ['id', 'address1', 'address2', 'location', 'city', 'state', 'pincode'] as const;
export const PACKING_MATERIAL_COLUMNS = ['id', 'packagingMaterialName'] as const;

/** Left-joins `path` as `alias` and selects only `columns` from it. */
export function joinSelect<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  path: string,
  alias: string,
  columns: readonly string[],
): SelectQueryBuilder<T> {
  return qb.leftJoin(path, alias).addSelect(columns.map((column) => `${alias}.${column}`));
}

/** Joins a product line's product (with its category), variant and UOM relations. */
export function joinProductLine<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  lineAlias: string,
  relations: { product?: string; variant?: string; uom?: string; saleUoM?: string } = {
    product: 'productName',
    variant: 'variant',
    uom: 'uom',
  },
): SelectQueryBuilder<T> {
  if (relations.product) {
    joinSelect(qb, `${lineAlias}.${relations.product}`, `${lineAlias}_product`, PRODUCT_COLUMNS);
    joinSelect(qb, `${lineAlias}_product.category`, `${lineAlias}_category`, CATEGORY_COLUMNS);
  }
  if (relations.variant) joinSelect(qb, `${lineAlias}.${relations.variant}`, `${lineAlias}_variant`, VARIANT_COLUMNS);
  if (relations.uom) joinSelect(qb, `${lineAlias}.${relations.uom}`, `${lineAlias}_uom`, UOM_COLUMNS);
  if (relations.saleUoM) joinSelect(qb, `${lineAlias}.${relations.saleUoM}`, `${lineAlias}_saleUoM`, UOM_COLUMNS);
  return qb;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export interface LineTotals {
  count: number;
  total: number | null;
}

/**
 * Line count and summed amount per parent, for documents that store no total of
 * their own (RFPA, Return by Customer). One GROUP BY query per chunk.
 */
export async function aggregateLines(
  manager: EntityManager,
  lineEntity: EntityTarget<ObjectLiteral>,
  parentRelation: string,
  amountColumn: string,
  parentIds: readonly string[],
): Promise<Map<string, LineTotals>> {
  const result = new Map<string, LineTotals>();
  if (!parentIds.length) return result;
  const rows = await manager
    .getRepository(lineEntity)
    .createQueryBuilder('line')
    .innerJoin(`line.${parentRelation}`, 'parent')
    .select('parent.id', 'parentId')
    .addSelect('COUNT(line.id)', 'lineCount')
    .addSelect(`SUM(line.${amountColumn})`, 'lineTotal')
    .where('parent.id IN (:...ids)', { ids: parentIds })
    .groupBy('parent.id')
    .getRawMany();
  for (const row of rows) {
    result.set(row.parentId, {
      count: Number(row.lineCount) || 0,
      total: row.lineTotal === null || row.lineTotal === undefined ? null : Number(row.lineTotal),
    });
  }
  return result;
}

/**
 * Restricts a sheet to refs of one `kind`, for workbooks mixing record types.
 * The sheet's query is skipped entirely for chunks with no refs of that kind.
 */
export function restrictToKind<T>(kind: string, sheet: ExportSheet<T>): ExportSheet<T> {
  return {
    ...sheet,
    load: async (ctx: ExportLoadContext) => {
      const refs = ctx.refs.filter((ref) => ref.kind === kind);
      if (!refs.length) return [];
      return sheet.load({
        ...ctx,
        refs,
        ids: refs.map((ref) => ref.id),
        documentIds: refs.map((ref) => ref.documentId).filter((id): id is string => Boolean(id)),
      });
    },
  };
}
