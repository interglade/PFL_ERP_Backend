import { EntityManager, In } from 'typeorm';
import AppError from '../../../utils/appError';
import { Product } from '../../createproduct/entity/product.entity';
import { ProductAttributeValue } from '../../productAttribute/entity/productAttributeValue.entity';
import { VARIANT_FIELDS } from '../../productAttribute/entity/productAttribute.entity';
import { ProductVarient } from '../entity/productVarient.entity';

/**
 * Variant generation and upkeep - docs/product-variant-plan.md §3-§6.
 *
 * A product declares the attribute values it may vary by; its variants are the
 * combinations of one value from each of those attributes. The pure helpers
 * below hold the rules; `syncProductVariants` applies them to the database.
 */

/** What the product form and the importer send: the allowed values and the combinations to keep. */
export interface VariantSetup {
  attributeValueIds: string[];
  /** Value ids of each combination to keep. Omitted means every combination. */
  combinations?: string[][];
}

export interface VariantSyncResult {
  created: number;
  kept: number;
  deactivated: number;
  deleted: number;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * The product form posts multipart data, so the setup arrives as a JSON
 * string; a JSON body may send it as an object. Absent means "leave the
 * variants as they are".
 */
export function parseVariantSetup(raw: unknown): VariantSetup | null {
  if (raw === undefined || raw === null || raw === '') return null;

  let data: any = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new AppError(400, 'variantSetup must be valid JSON');
    }
  }
  if (typeof data !== 'object' || data === null) {
    throw new AppError(400, 'variantSetup must be an object');
  }

  const toIds = (list: unknown): string[] =>
    Array.isArray(list) ? list.filter(Boolean).map((id) => String(id)) : [];

  return {
    attributeValueIds: toIds(data.attributeValueIds),
    combinations: Array.isArray(data.combinations)
      ? data.combinations.map((combo: unknown) => toIds(combo))
      : undefined,
  };
}

/** Case and spacing ignored, so "New zealand " and "New Zealand" match. */
export function normaliseValueKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * A cell listing values the way the client writes them - "40,50, 60 & Pittu",
 * "Elaichi and Sanam" - split into distinct values, first spelling kept.
 */
export function splitValueList(cell: unknown): string[] {
  if (cell === null || cell === undefined) return [];
  const seen = new Set<string>();
  const values: string[] = [];

  for (const part of String(cell).split(/[,;&\n]|\band\b/i)) {
    const value = part.trim().replace(/\s+/g, ' ');
    if (!value) continue;
    const key = normaliseValueKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }

  return values;
}

/** The same combination always gives the same key, whatever order its values come in. */
export function combinationKey(valueIds: string[]): string {
  return [...valueIds].sort().join('|');
}

/** Every way of picking one item from each group. No groups gives no combinations. */
export function cartesian<T>(groups: T[][]): T[][] {
  if (!groups.length || groups.some((group) => !group.length)) return [];
  return groups.reduce<T[][]>(
    (combos, group) => combos.flatMap((combo) => group.map((item) => [...combo, item])),
    [[]],
  );
}

/** "Imported Green Kiwi (Origin: New Zealand, Size: 33)". */
export function buildVariantName(
  productName: string,
  parts: { attribute: string; value: string }[],
): string {
  const detail = parts.map((part) => `${part.attribute}: ${part.value}`).join(', ');
  return detail ? `${productName} (${detail})` : productName;
}

/** "KIW0001-01" - the product code and the variant's number, never its attribute text. */
export function buildVariantCode(baseCode: string, sequence: number): string {
  return `${baseCode}-${String(sequence).padStart(2, '0')}`;
}

/** Natural order, so counts read 64, 72, 100 rather than 100, 64, 72. */
export function compareValueText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Attributes in their display order, values in natural order within each. */
export function sortValues(values: ProductAttributeValue[]): ProductAttributeValue[] {
  return [...values].sort(
    (a, b) =>
      (a.attribute?.sortOrder ?? 0) - (b.attribute?.sortOrder ?? 0) ||
      (a.attribute?.name ?? '').localeCompare(b.attribute?.name ?? '') ||
      compareValueText(a.value, b.value),
  );
}

/**
 * First letter of each word upper-cased, nothing lowered: "south africa" ->
 * "South Africa", while "ZESPRI", "12mm" and "50-55mm" stay as typed.
 */
export function capitaliseWords(value: string): string {
  return value.replace(/(^|\s)(\p{Ll})/gu, (_match, space, letter) => space + letter.toUpperCase());
}

/** Allowed values grouped per attribute, attributes in display order. */
export function groupByAttribute(values: ProductAttributeValue[]): ProductAttributeValue[][] {
  const groups = new Map<string, ProductAttributeValue[]>();
  for (const value of sortValues(values)) {
    const attributeId = value.attribute.id;
    if (!groups.has(attributeId)) groups.set(attributeId, []);
    groups.get(attributeId)!.push(value);
  }
  return [...groups.values()];
}

/**
 * Checks a requested combination against the allowed values: every allowed
 * attribute exactly once, and only allowed values.
 */
export function validateCombination(
  valueIds: string[],
  allowedById: Map<string, ProductAttributeValue>,
  attributeCount: number,
): string | null {
  const attributes = new Set<string>();
  for (const id of valueIds) {
    const value = allowedById.get(id);
    if (!value) return 'uses a value that is not allowed for this product';
    if (attributes.has(value.attribute.id)) {
      return `has more than one ${value.attribute.name}`;
    }
    attributes.add(value.attribute.id);
  }
  if (attributes.size !== attributeCount) {
    return 'must have one value for every attribute of the product';
  }
  return null;
}

/** Name and the legacy text columns, recomputed from the product and the values. */
export function applyLabels(variant: ProductVarient, productName: string): void {
  const values = sortValues(variant.values ?? []);
  variant.productName = productName;
  variant.variantName = buildVariantName(
    productName,
    values.map((value) => ({ attribute: value.attribute.name, value: value.value })),
  );
  for (const field of VARIANT_FIELDS) {
    variant[field] = values.find((value) => value.attribute.code === field)?.value ?? null;
  }
}

// ─── Database ────────────────────────────────────────────────────────────────

/** Tables and columns pointing at a variant, read once from the catalog. */
let variantReferences: { table: string; column: string }[] | null = null;

async function loadVariantReferences(
  manager: EntityManager,
): Promise<{ table: string; column: string }[]> {
  if (variantReferences) return variantReferences;

  const rows: { tbl: string; col: string }[] = await manager.query(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = '"productVarient"'::regclass`,
  );

  variantReferences = [
    ...rows
      .filter((row) => row.tbl.replace(/"/g, '') !== 'product_variant_value')
      .map((row) => ({ table: row.tbl, column: row.col })),
    // The batch stock tables keep the variant as a plain uuid, without a foreign key.
    { table: 'stock_batch', column: 'variant_id' },
    { table: 'stock_ledger', column: 'variant_id' },
  ];
  return variantReferences;
}

const quoteTable = (table: string) => (table.startsWith('"') ? table : `"${table}"`);

/** The given variants that any document or stock row points at. */
export async function findUsedVariantIds(
  manager: EntityManager,
  variantIds: string[],
): Promise<Set<string>> {
  const used = new Set<string>();
  if (!variantIds.length) return used;

  for (const { table, column } of await loadVariantReferences(manager)) {
    const rows: { id: string }[] = await manager.query(
      `SELECT DISTINCT "${column}" AS id FROM ${quoteTable(table)} WHERE "${column}" = ANY ($1)`,
      [variantIds],
    );
    for (const row of rows) used.add(row.id);
  }
  return used;
}

/**
 * Brings a product's variants in line with its allowed values and the
 * combinations to keep.
 *
 *   - a new combination gets the next number: code `<product code>-NN`
 *   - a kept combination keeps its code; its name is refreshed
 *   - a dropped combination is deleted if nothing uses it, deactivated if
 *     something does, so old documents keep their variant
 *
 * Variants saved before attributes existed (no combination key) are left alone.
 */
export async function syncProductVariants(
  manager: EntityManager,
  productId: string,
  setup: VariantSetup,
): Promise<VariantSyncResult> {
  const result: VariantSyncResult = { created: 0, kept: 0, deactivated: 0, deleted: 0 };

  const product = await manager.findOne(Product, {
    where: { id: productId },
    relations: ['allowedValues', 'allowedValues.attribute'],
  });
  if (!product) throw new AppError(404, 'Product not found');

  const requestedIds = [...new Set(setup.attributeValueIds ?? [])];
  const values = requestedIds.length
    ? await manager.find(ProductAttributeValue, {
        where: { id: In(requestedIds) },
        relations: ['attribute'],
      })
    : [];

  if (values.length !== requestedIds.length) {
    throw new AppError(400, 'Some of the chosen attribute values no longer exist');
  }

  // A value or attribute switched off can stay where it already is, but not be newly added.
  const alreadyAllowed = new Set((product.allowedValues ?? []).map((value) => value.id));
  const blocked = values.find(
    (value) =>
      !alreadyAllowed.has(value.id) && (!value.isActive || !value.attribute.isActive),
  );
  if (blocked) {
    throw new AppError(400, `${blocked.attribute.name} "${blocked.value}" is inactive`);
  }

  const groups = groupByAttribute(values);
  const allowedById = new Map(values.map((value) => [value.id, value]));

  let wanted: ProductAttributeValue[][];
  if (setup.combinations) {
    wanted = [];
    const seen = new Set<string>();
    for (const ids of setup.combinations) {
      const problem = validateCombination(ids, allowedById, groups.length);
      if (problem) throw new AppError(400, `A variant ${problem}`);
      const key = combinationKey(ids);
      if (seen.has(key)) continue;
      seen.add(key);
      wanted.push(ids.map((id) => allowedById.get(id)!));
    }
  } else {
    wanted = cartesian(groups);
  }

  product.allowedValues = values;
  await manager.save(Product, product);

  const existing = await manager.find(ProductVarient, {
    where: { product: { id: productId } },
    relations: ['values', 'values.attribute'],
  });
  const existingByKey = new Map(
    existing
      .filter((variant) => variant.combinationKey)
      .map((variant) => [variant.combinationKey as string, variant]),
  );

  const baseCode = product.productCode || product.prefix || 'PRD';
  let sequence = product.lastVariantSeq ?? 0;
  const keep = new Set<string>();

  for (const combo of wanted) {
    const key = combinationKey(combo.map((value) => value.id));
    keep.add(key);
    const found = existingByKey.get(key);

    if (found) {
      found.isActive = true;
      applyLabels(found, product.name);
      await manager.save(ProductVarient, found);
      result.kept++;
      continue;
    }

    sequence++;
    const variant = manager.create(ProductVarient, {
      product: { id: product.id } as Product,
      values: combo,
      combinationKey: key,
      sequence,
      variantCode: buildVariantCode(baseCode, sequence),
      isActive: true,
    });
    applyLabels(variant, product.name);
    await manager.save(ProductVarient, variant);
    result.created++;
  }

  const dropped = [...existingByKey.values()].filter(
    (variant) => !keep.has(variant.combinationKey as string),
  );
  const used = await findUsedVariantIds(
    manager,
    dropped.map((variant) => variant.id),
  );
  for (const variant of dropped) {
    if (used.has(variant.id)) {
      if (variant.isActive) {
        variant.isActive = false;
        await manager.save(ProductVarient, variant);
      }
      result.deactivated++;
    } else {
      await manager.remove(ProductVarient, variant);
      result.deleted++;
    }
  }

  if (sequence !== product.lastVariantSeq) {
    await manager.update(Product, { id: product.id }, { lastVariantSeq: sequence });
  }

  return result;
}

/** Rebuilds names and text copies after a product or a value is renamed. */
export async function refreshVariantLabels(
  manager: EntityManager,
  where: { productId?: string; valueId?: string },
): Promise<void> {
  const query = manager
    .createQueryBuilder(ProductVarient, 'variant')
    .leftJoinAndSelect('variant.product', 'product')
    .leftJoinAndSelect('variant.values', 'value')
    .leftJoinAndSelect('value.attribute', 'attribute');

  if (where.productId) query.andWhere('product.id = :productId', { productId: where.productId });
  if (where.valueId) {
    query.andWhere(
      `variant.id IN (SELECT pvv.variant_id FROM product_variant_value pvv WHERE pvv.attribute_value_id = :valueId)`,
      { valueId: where.valueId },
    );
  }

  const variants = await query.getMany();
  for (const variant of variants) {
    if (!variant.product || !variant.values?.length) continue;
    applyLabels(variant, variant.product.name);
  }
  await manager.save(ProductVarient, variants.filter((variant) => variant.values?.length));
}
