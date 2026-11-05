import { inject, injectable } from 'inversify';
import { DataSource, EntityManager } from 'typeorm';
import { TYPES } from '../../../types';
import AppError from '../../../utils/appError';
import { CacheService } from '../../../global/cache.service';
import { ProductAttribute, VariantField } from '../entity/productAttribute.entity';
import { ProductAttributeValue } from '../entity/productAttributeValue.entity';
import {
  capitaliseWords,
  compareValueText,
  normaliseValueKey,
  refreshVariantLabels,
  splitValueList,
} from '../../productVarient/service/variantSync';

/** The attributes every installation starts with, in display order. */
export const DEFAULT_ATTRIBUTES: { code: VariantField; name: string }[] = [
  { code: 'count', name: 'Count' },
  { code: 'size', name: 'Size' },
  { code: 'variety', name: 'Variety' },
  { code: 'origin', name: 'Origin' },
  { code: 'brand', name: 'Brand' },
];

let defaultsEnsured = false;

/** Creates any of the five standard attributes that are missing. Safe to call repeatedly. */
export async function ensureDefaultAttributes(manager: EntityManager): Promise<void> {
  if (defaultsEnsured) return;

  const existing = await manager.find(ProductAttribute, { withDeleted: true });
  for (const [index, attribute] of DEFAULT_ATTRIBUTES.entries()) {
    const found = existing.find(
      (row) =>
        row.code === attribute.code ||
        normaliseValueKey(row.name) === normaliseValueKey(attribute.name),
    );
    if (found) continue;
    await manager.save(
      manager.create(ProductAttribute, { ...attribute, sortOrder: index + 1, isActive: true }),
    );
  }
  defaultsEnsured = true;
}

/**
 * The values a spreadsheet cell lists for an attribute, matched against the
 * master with case and spacing ignored. Values not in the master yet are
 * created - words capitalised, so "south africa" is saved as "South Africa" -
 * and returned in `created`, so the import report can list them for a
 * spelling check.
 */
export async function resolveValueList(
  manager: EntityManager,
  attribute: ProductAttribute,
  cell: unknown,
): Promise<{ values: ProductAttributeValue[]; created: string[] }> {
  const typed = splitValueList(cell);
  if (!typed.length) return { values: [], created: [] };

  const known = await manager.find(ProductAttributeValue, {
    where: { attribute: { id: attribute.id } },
    relations: ['attribute'],
  });
  const byKey = new Map(known.map((value) => [value.valueKey, value]));

  const values: ProductAttributeValue[] = [];
  const created: string[] = [];
  for (const text of typed) {
    const key = normaliseValueKey(text);
    let value = byKey.get(key);
    if (!value) {
      value = await manager.save(
        manager.create(ProductAttributeValue, {
          attribute,
          value: capitaliseWords(text),
          valueKey: key,
          isActive: true,
        }),
      );
      byKey.set(key, value);
      created.push(value.value);
    }
    values.push(value);
  }
  return { values, created };
}

@injectable()
export class ProductAttributeService {
  constructor(
    @inject(TYPES.DataSource) private dataSource: DataSource,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
  ) {}

  /** Variant names and product reads are cached, so a rename has to clear them. */
  private async invalidateProductCache(): Promise<void> {
    await this.cacheService.invalidatePattern('product:*');
  }

  /** Every attribute with its values and how many products use each value. */
  async findAll(): Promise<any[]> {
    await ensureDefaultAttributes(this.dataSource.manager);

    const attributes = await this.dataSource.getRepository(ProductAttribute).find({
      relations: ['values'],
      order: { sortOrder: 'ASC', name: 'ASC' },
    });

    const usage: { id: string; products: string }[] = await this.dataSource.query(
      `SELECT attribute_value_id AS id, COUNT(*) AS products
         FROM product_allowed_value GROUP BY attribute_value_id`,
    );
    const productsById = new Map(usage.map((row) => [row.id, Number(row.products)]));

    return attributes.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      code: attribute.code,
      sortOrder: attribute.sortOrder,
      isActive: attribute.isActive,
      values: [...(attribute.values ?? [])]
        .sort((a, b) => compareValueText(a.value, b.value))
        .map((value) => ({
          id: value.id,
          value: value.value,
          isActive: value.isActive,
          productCount: productsById.get(value.id) ?? 0,
        })),
    }));
  }

  async createAttribute(name: string): Promise<ProductAttribute> {
    const clean = name?.trim().replace(/\s+/g, ' ');
    if (!clean) throw new AppError(400, 'Attribute name is required');

    const repo = this.dataSource.getRepository(ProductAttribute);
    const all = await repo.find();
    if (all.some((row) => normaliseValueKey(row.name) === normaliseValueKey(clean))) {
      throw new AppError(409, `Attribute "${clean}" already exists`);
    }
    const sortOrder = all.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1;
    return repo.save(repo.create({ name: clean, code: null, sortOrder, isActive: true }));
  }

  async updateAttribute(
    id: string,
    changes: { name?: string; isActive?: boolean; sortOrder?: number },
  ): Promise<ProductAttribute> {
    return this.dataSource.transaction(async (manager) => {
      const attribute = await manager.findOne(ProductAttribute, { where: { id } });
      if (!attribute) throw new AppError(404, 'Attribute not found');

      let relabel = false;
      if (changes.name !== undefined) {
        const clean = changes.name.trim().replace(/\s+/g, ' ');
        if (!clean) throw new AppError(400, 'Attribute name is required');
        const clash = (await manager.find(ProductAttribute)).find(
          (row) => row.id !== id && normaliseValueKey(row.name) === normaliseValueKey(clean),
        );
        if (clash) throw new AppError(409, `Attribute "${clean}" already exists`);
        relabel = clean !== attribute.name;
        attribute.name = clean;
      }
      if (changes.isActive !== undefined) attribute.isActive = Boolean(changes.isActive);
      if (changes.sortOrder !== undefined) {
        relabel = relabel || Number(changes.sortOrder) !== attribute.sortOrder;
        attribute.sortOrder = Number(changes.sortOrder);
      }

      const saved = await manager.save(attribute);
      if (relabel) {
        const values = await manager.find(ProductAttributeValue, {
          where: { attribute: { id } },
        });
        for (const value of values) await refreshVariantLabels(manager, { valueId: value.id });
      }
      await this.invalidateProductCache();
      return saved;
    });
  }

  async addValue(attributeId: string, value: string): Promise<ProductAttributeValue> {
    const clean = value?.trim().replace(/\s+/g, ' ');
    if (!clean) throw new AppError(400, 'Value is required');

    const manager = this.dataSource.manager;
    const attribute = await manager.findOne(ProductAttribute, { where: { id: attributeId } });
    if (!attribute) throw new AppError(404, 'Attribute not found');

    const key = normaliseValueKey(clean);
    const known = await manager.find(ProductAttributeValue, {
      where: { attribute: { id: attributeId } },
    });
    const clash = known.find((row) => row.valueKey === key);
    if (clash) {
      throw new AppError(409, `${attribute.name} "${clash.value}" already exists`);
    }

    return manager.save(
      manager.create(ProductAttributeValue, {
        attribute,
        value: clean,
        valueKey: key,
        isActive: true,
      }),
    );
  }

  /**
   * Renaming a value corrects it on every product and variant at once - the
   * variant keeps its code, only its name changes.
   */
  async updateValue(
    valueId: string,
    changes: { value?: string; isActive?: boolean },
  ): Promise<ProductAttributeValue> {
    return this.dataSource.transaction(async (manager) => {
      const value = await manager.findOne(ProductAttributeValue, {
        where: { id: valueId },
        relations: ['attribute'],
      });
      if (!value) throw new AppError(404, 'Value not found');

      let relabel = false;
      if (changes.value !== undefined) {
        const clean = changes.value.trim().replace(/\s+/g, ' ');
        if (!clean) throw new AppError(400, 'Value is required');
        const key = normaliseValueKey(clean);
        const clash = await manager.findOne(ProductAttributeValue, {
          where: { attribute: { id: value.attribute.id }, valueKey: key },
        });
        if (clash && clash.id !== value.id) {
          throw new AppError(409, `${value.attribute.name} "${clash.value}" already exists`);
        }
        relabel = clean !== value.value;
        value.value = clean;
        value.valueKey = key;
      }
      if (changes.isActive !== undefined) value.isActive = Boolean(changes.isActive);

      const saved = await manager.save(value);
      if (relabel) await refreshVariantLabels(manager, { valueId });
      await this.invalidateProductCache();
      return saved;
    });
  }

  /** Only a value no product allows and no variant carries can be deleted; otherwise deactivate it. */
  async deleteValue(valueId: string): Promise<void> {
    const manager = this.dataSource.manager;
    const value = await manager.findOne(ProductAttributeValue, {
      where: { id: valueId },
      relations: ['attribute'],
    });
    if (!value) throw new AppError(404, 'Value not found');

    const [{ count }] = await manager.query(
      `SELECT (SELECT COUNT(*) FROM product_allowed_value WHERE attribute_value_id = $1)
            + (SELECT COUNT(*) FROM product_variant_value WHERE attribute_value_id = $1) AS count`,
      [valueId],
    );
    if (Number(count) > 0) {
      throw new AppError(
        409,
        `${value.attribute.name} "${value.value}" is used by products or variants - deactivate it instead`,
      );
    }
    await manager.delete(ProductAttributeValue, { id: valueId });
  }
}
