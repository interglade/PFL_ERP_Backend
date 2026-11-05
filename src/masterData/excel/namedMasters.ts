/**
 * The small masters: records identified by a name, optionally linked to one
 * parent master by name (docs/master-data-excel-plan.md §5).
 *
 *   Level 1: UoM, Customer Type, Customer Category, Vendor Category, Product Classification
 *   Level 2: Vendor Subcategory, Product Category, Packaging Material
 *   Level 3: Product Subcategory
 *
 * One config per master drives its template, its export and its import, so
 * the three cannot drift apart.
 */

import { EntityTarget } from 'typeorm';
import { ExcelColumn, ExcelSheetDefinition } from '../../excel/excelColumn';
import { ImportMaster } from '../../excel/importPrerequisites';

import { UOM } from '../../uom/entity/uom.entity';
import { CustomerType } from '../../customer/customerType/entity/customerType.entity';
import { CustomerCategory } from '../../customer/customerCategory/entity/customerCategory.entity';
import { VendorCategory } from '../../vendor/vendorCategory/entity/vendorCategory.entity';
import { VendorSubcategory } from '../../vendor/vendorSubcategory/entity/vendorSubcategory.entity';
import { ProductClassification } from '../../product/productClassification/entity/product_classification.entity';
import { ProductCategory } from '../../product/productCategory/entity/product_category.entity';
import { ProductSubcategory } from '../../product/productSubcategory/entity/product_subcategory.entity';
import { PackingMaterial, UseFor } from '../../packingMaterial/entity/packingMaterial.entity';

export interface NamedRecord {
  id: string;
  [property: string]: any;
}

export interface NamedMasterChoice {
  /** Stored value. */
  value: string;
  /** What the sheet shows; either is accepted on import. */
  label: string;
}

export interface NamedMasterField {
  header: string;
  property: string;
  type?: 'text' | 'number' | 'choice';
  choices?: NamedMasterChoice[];
  /** A new record needs it; on an update a blank cell still keeps the current value. */
  required?: boolean;
  maxLength?: number;
  note?: string;
}

/** The master a record belongs to, named in the sheet. */
export interface NamedMasterParent {
  header: string;
  /** Relation property on the entity, e.g. `category`. */
  property: string;
  master: ImportMaster;
  label: string;
  entity: EntityTarget<any>;
  /** Names the parent can be found by (a UoM by unit or abbreviation). */
  names: (record: NamedRecord) => (string | null | undefined)[];
  /** Name written on export and offered in the dropdown. */
  display: (record: NamedRecord) => string | null | undefined;
  /** A new record needs a parent. On an update a blank cell keeps the current one. */
  required: boolean;
}

export interface NamedMasterConfig {
  master: ImportMaster;
  /** "UoM", "Vendor Category" - used in messages. */
  label: string;
  entity: EntityTarget<any>;
  /** Entity name the forms already use in the audit log. */
  auditName: string;
  /** Redis prefix the master's own service caches lists and records under. */
  cachePrefix: string;
  /** Stem of the downloaded file name. */
  fileStem: string;

  keyHeader: string;
  nameHeader: string;
  nameProperty: string;
  nameMaxLength?: number;
  /** Other editable columns. A blank cell keeps the current value. */
  fields: NamedMasterField[];
  parent?: NamedMasterParent;
  /**
   * Where names have to be unique: across the whole master (unset), within
   * the parent (`'parent'`), or within the value of a field (`'useFor'`).
   * A row without a Record ID is matched by name within the same scope.
   */
  uniqueWithin?: 'parent' | string;
  /**
   * Values that must be unique (within the scope) once the file is saved.
   * Always the name; for a UoM also the abbreviation, because other masters
   * find a UoM by either.
   */
  identityProperties: string[];
  /** Relations loaded for the export and the import, beyond the parent. */
  relations: string[];

  sheet: ExcelSheetDefinition<NamedRecord>;
}

const RECORD_ID = 'Record ID';

const choiceLabel = (field: NamedMasterField, value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  return field.choices?.find((choice) => choice.value === value)?.label ?? String(value);
};

const exportValue = (field: NamedMasterField, record: NamedRecord): unknown => {
  const value = record[field.property];
  if (field.type === 'choice') return choiceLabel(field, value);
  if (field.type === 'number') {
    return value === null || value === undefined || value === '' ? null : Number(value);
  }
  return value;
};

/** Builds the column map from the config, Record ID last so it stays out of the way. */
function namedSheet(
  config: Omit<
    NamedMasterConfig,
    'sheet' | 'keyHeader' | 'identityProperties' | 'relations' | 'fields'
  > & {
    sheetName: string;
    tableName: string;
    nameNote?: string;
    fields?: NamedMasterField[];
    identityProperties?: string[];
    relations?: string[];
    /** Position of the parent column among the name and field columns. Default: first. */
    parentColumnIndex?: number;
    /** Read-only columns shown on export only, e.g. the classification above a subcategory. */
    exportOnly?: ExcelColumn<NamedRecord>[];
  },
): NamedMasterConfig {
  const fields = config.fields ?? [];
  const scopeLabel =
    config.uniqueWithin === 'parent'
      ? ` within its ${config.parent?.label}`
      : config.uniqueWithin
        ? ` within its ${fields.find((field) => field.property === config.uniqueWithin)?.header}`
        : '';

  const columns: ExcelColumn<NamedRecord>[] = [
    {
      header: config.nameHeader,
      maps: `${config.tableName}.${config.nameProperty}`,
      required: true,
      width: 32,
      note:
        `Unique${scopeLabel} - a row whose name matches an existing record updates it. ` +
        'Case, spaces and punctuation are ignored when matching' +
        (config.nameMaxLength ? `. At most ${config.nameMaxLength} characters` : '') +
        (config.nameNote ? `. ${config.nameNote}` : ''),
      get: (record) => record[config.nameProperty],
    },
    ...fields.map(
      (field): ExcelColumn<NamedRecord> => ({
        header: field.header,
        maps: `${config.tableName}.${field.property}`,
        required: field.required,
        type: field.type === 'number' ? 'number' : 'string',
        enumValues: field.choices?.map((choice) => choice.label),
        width: field.type === 'text' || !field.type ? 32 : 18,
        note:
          (field.required ? 'Needed for a new record. ' : '') +
          'Leave empty to keep the current value' +
          (field.type === 'number' ? '. A number, 0 or more' : '') +
          (field.maxLength ? `. At most ${field.maxLength} characters` : '') +
          (field.note ? `. ${field.note}` : ''),
        get: (record) => exportValue(field, record),
      }),
    ),
  ];

  const parent = config.parent;
  if (parent) {
    columns.splice(config.parentColumnIndex ?? 0, 0, {
      header: parent.header,
      maps: `${config.tableName}.${parent.property}`,
      required: parent.required,
      listFrom: parent.master,
      link: { master: parent.label },
      width: 30,
      note:
        (parent.required ? 'Needed for a new record. ' : '') +
        `Import ${parent.label} first. Leave empty on an existing row to keep its current ${parent.label}`,
      get: (record) => (record[parent.property] ? parent.display(record[parent.property]) : null),
    });
  }

  columns.push(...(config.exportOnly ?? []), {
    header: RECORD_ID,
    maps: `${config.tableName}.id`,
    key: true,
    width: 38,
    get: (record) => record.id,
  });

  return {
    master: config.master,
    label: config.label,
    entity: config.entity,
    auditName: config.auditName,
    cachePrefix: config.cachePrefix,
    fileStem: config.fileStem,
    keyHeader: RECORD_ID,
    nameHeader: config.nameHeader,
    nameProperty: config.nameProperty,
    nameMaxLength: config.nameMaxLength,
    fields,
    parent,
    uniqueWithin: config.uniqueWithin,
    identityProperties: config.identityProperties ?? [config.nameProperty],
    relations: config.relations ?? [],
    sheet: { sheetName: config.sheetName, columns },
  };
}

// ── Level 1 ──────────────────────────────────────────────────────────────────

export const UOM_MASTER = namedSheet({
  master: 'uom',
  label: 'UoM',
  entity: UOM,
  auditName: 'UOM',
  cachePrefix: 'uom',
  fileStem: 'UoM',
  sheetName: 'UoM',
  tableName: 'uom',
  nameHeader: 'Unit',
  nameProperty: 'unit',
  nameMaxLength: 50,
  nameNote: 'e.g. Kilogram, Crate, Box',
  fields: [
    {
      header: 'Abbreviation',
      property: 'abbreviation',
      maxLength: 10,
      note: 'e.g. kg. Must not be the unit or abbreviation of another UoM - other sheets can name a UoM by either',
    },
    { header: 'Description', property: 'description' },
  ],
  identityProperties: ['unit', 'abbreviation'],
});

export const CUSTOMER_TYPE_MASTER = namedSheet({
  master: 'customer-type',
  label: 'Customer Type',
  entity: CustomerType,
  auditName: 'CustomerType',
  cachePrefix: 'customerType',
  fileStem: 'Customer_Types',
  sheetName: 'Customer Types',
  tableName: 'customer_type',
  nameHeader: 'Customer Type',
  nameProperty: 'name',
});

export const CUSTOMER_CATEGORY_MASTER = namedSheet({
  master: 'customer-category',
  label: 'Customer Category',
  entity: CustomerCategory,
  auditName: 'CustomerCategory',
  cachePrefix: 'customerCategory',
  fileStem: 'Customer_Categories',
  sheetName: 'Customer Categories',
  tableName: 'customer_category',
  nameHeader: 'Customer Category',
  nameProperty: 'name',
});

export const VENDOR_CATEGORY_MASTER = namedSheet({
  master: 'vendor-category',
  label: 'Vendor Category',
  entity: VendorCategory,
  auditName: 'VendorCategory',
  cachePrefix: 'vendorCategory',
  fileStem: 'Vendor_Categories',
  sheetName: 'Vendor Categories',
  tableName: 'vendor_category',
  nameHeader: 'Vendor Category',
  nameProperty: 'name',
});

export const PRODUCT_CLASSIFICATION_MASTER = namedSheet({
  master: 'product-classification',
  label: 'Product Classification',
  entity: ProductClassification,
  auditName: 'ProductClassification',
  cachePrefix: 'productClassification',
  fileStem: 'Product_Classifications',
  sheetName: 'Product Classifications',
  tableName: 'product_classification',
  nameHeader: 'Classification',
  nameProperty: 'name',
});

// ── Level 2 ──────────────────────────────────────────────────────────────────

const byName = {
  names: (record: NamedRecord) => [record.name],
  display: (record: NamedRecord) => record.name,
};

export const VENDOR_SUBCATEGORY_MASTER = namedSheet({
  master: 'vendor-subcategory',
  label: 'Vendor Subcategory',
  entity: VendorSubcategory,
  auditName: 'VendorSubcategory',
  cachePrefix: 'vendorSubcategory',
  fileStem: 'Vendor_Subcategories',
  sheetName: 'Vendor Subcategories',
  tableName: 'vendor_subcategory',
  nameHeader: 'Vendor Subcategory',
  nameProperty: 'name',
  parent: {
    header: 'Vendor Category',
    property: 'category',
    master: 'vendor-category',
    label: 'Vendor Category',
    entity: VendorCategory,
    required: true,
    ...byName,
  },
  // The same subcategory name under two categories is two records.
  uniqueWithin: 'parent',
});

export const PRODUCT_CATEGORY_MASTER = namedSheet({
  master: 'product-category',
  label: 'Product Category',
  entity: ProductCategory,
  auditName: 'ProductCategory',
  cachePrefix: 'productCategory',
  fileStem: 'Product_Categories',
  sheetName: 'Product Categories',
  tableName: 'product_category',
  nameHeader: 'Product Category',
  nameProperty: 'name',
  parent: {
    header: 'Classification',
    property: 'productClassification',
    master: 'product-classification',
    label: 'Product Classification',
    entity: ProductClassification,
    required: true,
    ...byName,
  },
  // Unique overall (D3): products and the product import find a category by
  // name alone.
});

const USE_FOR_CHOICES: NamedMasterChoice[] = [
  { value: UseFor.PURCHASE, label: 'For Purchase' },
  { value: UseFor.SALE, label: 'For Sale' },
];

export const PACKAGING_MATERIAL_MASTER = namedSheet({
  master: 'packaging-material',
  label: 'Packaging Material',
  entity: PackingMaterial,
  auditName: 'post_packaging_material',
  cachePrefix: 'packingMaterial',
  fileStem: 'Packaging_Materials',
  sheetName: 'Packaging Materials',
  tableName: 'post_packaging_material',
  nameHeader: 'Packaging Material Name',
  nameProperty: 'packagingMaterialName',
  fields: [
    {
      header: 'Use For',
      property: 'useFor',
      type: 'choice',
      choices: USE_FOR_CHOICES,
    },
    {
      header: 'Packaging Material Weight',
      property: 'packagingMaterialWeight',
      type: 'number',
      note: 'Weight of the empty packaging',
    },
    {
      header: 'Quantity Per Package',
      property: 'containsQuantity',
      type: 'number',
      note: 'How much one unit of packaging holds, in its Reference UoM',
    },
    { header: 'Description', property: 'packagingMaterialDescription' },
  ],
  parent: {
    header: 'Reference UoM',
    property: 'uom',
    master: 'uom',
    label: 'UoM',
    entity: UOM,
    required: false,
    names: (record) => [record.unit, record.abbreviation],
    display: (record) => record.unit,
  },
  parentColumnIndex: 4, // after the name, Use For, weight and quantity
  // "Crate" for purchase and "Crate" for sale are two records. Only the name
  // is needed, as in the form: an empty Use For or Reference UoM is allowed.
  uniqueWithin: 'useFor',
});

// ── Level 3 ──────────────────────────────────────────────────────────────────

export const PRODUCT_SUBCATEGORY_MASTER = namedSheet({
  master: 'product-subcategory',
  label: 'Product Subcategory',
  entity: ProductSubcategory,
  auditName: 'ProductSubcategory',
  cachePrefix: 'productSubcategory',
  fileStem: 'Product_Subcategories',
  sheetName: 'Product Subcategories',
  tableName: 'product_subcategory',
  nameHeader: 'Product Subcategory',
  nameProperty: 'name',
  parent: {
    header: 'Product Category',
    property: 'category',
    master: 'product-category',
    label: 'Product Category',
    entity: ProductCategory,
    required: true,
    ...byName,
  },
  uniqueWithin: 'parent',
  relations: ['category.productClassification'],
  exportOnly: [
    {
      header: 'Classification',
      maps: 'product_category.classification_id',
      readOnly: true,
      width: 26,
      note: 'The Product Category\'s classification, for reference',
      get: (record) => record.category?.productClassification?.name ?? null,
    },
  ],
});

/** Masters served by `/master-data/:master/...`, by route key. */
export const NAMED_MASTERS: Partial<Record<ImportMaster, NamedMasterConfig>> = {
  uom: UOM_MASTER,
  'customer-type': CUSTOMER_TYPE_MASTER,
  'customer-category': CUSTOMER_CATEGORY_MASTER,
  'vendor-category': VENDOR_CATEGORY_MASTER,
  'product-classification': PRODUCT_CLASSIFICATION_MASTER,
  'vendor-subcategory': VENDOR_SUBCATEGORY_MASTER,
  'product-category': PRODUCT_CATEGORY_MASTER,
  'packaging-material': PACKAGING_MATERIAL_MASTER,
  'product-subcategory': PRODUCT_SUBCATEGORY_MASTER,
};
