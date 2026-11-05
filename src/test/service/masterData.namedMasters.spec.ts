/**
 * Phase 2 of docs/master-data-excel-plan.md: Excel import of the level-1
 * masters (UoM, Customer Type, Customer Category, Vendor Category, Product
 * Classification). Exercises the planner on real in-memory workbooks - no
 * database - so every create / update / reject rule is pinned down.
 */

import 'reflect-metadata';
import ExcelJS from 'exceljs';

import { buildDataWorkbook, buildTemplateWorkbook } from '../../excel/excelFile.service';
import { ExcelRow, parseWorkbook } from '../../excel/excelImport.service';
import { LookupIndex } from '../../excel/lookupIndex';
import {
  NAMED_MASTERS,
  NamedMasterConfig,
  NamedRecord,
  PACKAGING_MATERIAL_MASTER,
  PRODUCT_CATEGORY_MASTER,
  PRODUCT_SUBCATEGORY_MASTER,
  UOM_MASTER,
  VENDOR_CATEGORY_MASTER,
  VENDOR_SUBCATEGORY_MASTER,
} from '../../masterData/excel/namedMasters';
import { planNamedMasterImport } from '../../masterData/excel/namedMasterImport';

/** Parent records as the service indexes them: by display name and every other name. */
const parentIndexOf = (config: NamedMasterConfig, records: NamedRecord[]) =>
  LookupIndex.fromRecords(records, {
    names: (record) => [config.parent!.display(record), ...config.parent!.names(record)],
  });

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

/** Rows as the importer sees them, from a sheet with the given headers. */
async function rowsOf(
  config: NamedMasterConfig,
  headers: string[],
  data: (string | null)[][],
): Promise<ExcelRow[]> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(config.sheet.sheetName);
  sheet.addRow(headers);
  for (const row of data) sheet.addRow(row.map((value) => value ?? ''));
  return parseWorkbook(await reload(workbook), config.sheet).rows;
}

const categories = (): NamedRecord[] => [
  { id: 'c1', name: 'Mandi Supplier' },
  { id: 'c2', name: 'Commission Agent' },
];

const uoms = (): NamedRecord[] => [
  { id: 'u1', unit: 'Kilogram', abbreviation: 'kg', description: null },
  { id: 'u2', unit: 'Crate', abbreviation: null, description: 'Plastic crate' },
];

describe.each(Object.entries(NAMED_MASTERS))('%s sheet', (_key, config) => {
  it('has the Record ID only on the export, at the end', async () => {
    const template = await reload(buildTemplateWorkbook(config!.sheet));
    expect(headersOf(template.worksheets[0])).not.toContain('Record ID');

    const exported = await reload(buildDataWorkbook(config!.sheet, []));
    const headers = headersOf(exported.worksheets[0]);
    expect(headers[headers.length - 1]).toBe('Record ID');
    expect(headers).toContain(config!.nameHeader);
    if (config!.parent) expect(headers).toContain(config!.parent.header);
  });

  it('re-importing its own export changes nothing', async () => {
    const records =
      config === UOM_MASTER
        ? uoms()
        : [
            { id: 'r1', [config!.nameProperty]: 'First' },
            { id: 'r2', [config!.nameProperty]: 'Second' },
          ];

    const exported = await reload(buildDataWorkbook(config!.sheet, records));
    const plan = planNamedMasterImport(
      config!,
      parseWorkbook(exported, config!.sheet).rows,
      records,
      config!.parent ? parentIndexOf(config!, []) : undefined,
    );

    expect(plan).toEqual({ creates: [], updates: [], unchanged: records.length, failed: [] });
  });
});

describe('named master import plan', () => {
  const HEADERS = ['Vendor Category', 'Record ID'];

  it('creates a new name and leaves a matching one unchanged', async () => {
    const rows = await rowsOf(VENDOR_CATEGORY_MASTER, HEADERS, [
      ['Transporter Agent', null],
      ['mandi  supplier', null], // same name, different spacing and case
    ]);
    const plan = planNamedMasterImport(VENDOR_CATEGORY_MASTER, rows, categories());

    expect(plan.creates).toEqual([
      { row: 2, values: { name: 'Transporter Agent' }, parentId: null },
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.unchanged).toBe(1);
    expect(plan.failed).toEqual([]);
  });

  it('renames a record through its Record ID', async () => {
    const rows = await rowsOf(VENDOR_CATEGORY_MASTER, HEADERS, [['Mandi Suppliers', 'c1']]);
    const plan = planNamedMasterImport(VENDOR_CATEGORY_MASTER, rows, categories());

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].record.id).toBe('c1');
    expect(plan.updates[0].changes).toEqual({ name: 'Mandi Suppliers' });
  });

  it('allows names to be swapped within one file', async () => {
    const rows = await rowsOf(VENDOR_CATEGORY_MASTER, HEADERS, [
      ['Commission Agent', 'c1'],
      ['Mandi Supplier', 'c2'],
    ]);
    const plan = planNamedMasterImport(VENDOR_CATEGORY_MASTER, rows, categories());

    expect(plan.failed).toEqual([]);
    expect(plan.updates.map((update) => update.changes.name)).toEqual([
      'Commission Agent',
      'Mandi Supplier',
    ]);
  });

  it('rejects an unknown Record ID, a blank name and a repeated row', async () => {
    const rows = await rowsOf(VENDOR_CATEGORY_MASTER, HEADERS, [
      ['Something', 'gone-id'],
      [null, 'c2'],
      ['Mandi Supplier', null],
      ['Mandi Supplier', 'c1'],
    ]);
    const plan = planNamedMasterImport(VENDOR_CATEGORY_MASTER, rows, categories());

    expect(plan.failed.map((issue) => issue.row)).toEqual([2, 3, 5]);
    expect(plan.failed[0].reason).toContain('Record ID gone-id was not found');
    expect(plan.failed[1].reason).toBe('Vendor Category is empty');
    expect(plan.failed[2].reason).toBe('Row 4 already changes this record');
  });

  it('rejects a new row repeating another new row, keeping the first', async () => {
    const rows = await rowsOf(VENDOR_CATEGORY_MASTER, HEADERS, [
      ['Farm Gate', null],
      ['FARM-GATE', null],
    ]);
    const plan = planNamedMasterImport(VENDOR_CATEGORY_MASTER, rows, categories());

    expect(plan.failed).toEqual([{ row: 3, reason: '"FARM-GATE" is already used by row 2' }]);
    expect(plan.creates.map((create) => create.row)).toEqual([2]);
  });

  it('rejects renaming a record onto a name another record keeps', async () => {
    const rows = await rowsOf(VENDOR_CATEGORY_MASTER, HEADERS, [['Commission Agent', 'c1']]);
    const plan = planNamedMasterImport(VENDOR_CATEGORY_MASTER, rows, categories());

    expect(plan.failed).toEqual([
      {
        row: 2,
        reason: '"Commission Agent" is already used by the existing Vendor Category "Commission Agent"',
      },
    ]);
    expect(plan.updates).toEqual([]);
  });

  it('asks for the Record ID when a name already matches two records', async () => {
    const duplicated = [...categories(), { id: 'c9', name: 'mandi supplier' }];
    const rows = await rowsOf(VENDOR_CATEGORY_MASTER, HEADERS, [['Mandi Supplier', null]]);
    const plan = planNamedMasterImport(VENDOR_CATEGORY_MASTER, rows, duplicated);

    expect(plan.failed[0].reason).toContain('matches 2 existing records');
  });
});

describe('UoM import plan', () => {
  const HEADERS = ['Unit', 'Abbreviation', 'Description', 'Record ID'];

  it('updates only the cells that are filled in', async () => {
    const rows = await rowsOf(UOM_MASTER, HEADERS, [['Crate', 'crt', null, null]]);
    const plan = planNamedMasterImport(UOM_MASTER, rows, uoms());

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].changes).toEqual({ abbreviation: 'crt' });
  });

  it('rejects an abbreviation that is another UoM unit or abbreviation', async () => {
    const rows = await rowsOf(UOM_MASTER, HEADERS, [
      ['Crate', 'KG', null, null],
      ['Kilo', null, null, null],
      ['Box', 'Kilogram', null, null],
    ]);
    const plan = planNamedMasterImport(UOM_MASTER, rows, uoms());

    expect(plan.failed).toEqual([
      { row: 2, reason: '"KG" is already used by the existing UoM "Kilogram"' },
      { row: 4, reason: '"Kilogram" is already used by the existing UoM "Kilogram"' },
    ]);
    expect(plan.creates.map((create) => create.values.unit)).toEqual(['Kilo']);
  });

  it('enforces the column lengths of the uom table', async () => {
    const rows = await rowsOf(UOM_MASTER, HEADERS, [
      ['x'.repeat(51), null, null, null],
      ['Bag', 'abbreviation', null, null],
    ]);
    const plan = planNamedMasterImport(UOM_MASTER, rows, uoms());

    expect(plan.failed).toEqual([
      { row: 2, reason: 'Unit is longer than 50 characters' },
      { row: 3, reason: 'Abbreviation is longer than 10 characters' },
    ]);
  });
});

// ── Phase 3: masters linked to a parent ──────────────────────────────────────

const vendorCategories = (): NamedRecord[] => [
  { id: 'c1', name: 'Mandi Supplier' },
  { id: 'c2', name: 'Commission Agent' },
];

const vendorSubcategories = (): NamedRecord[] => [
  { id: 's1', name: 'Local', category: { id: 'c1', name: 'Mandi Supplier' } },
  { id: 's2', name: 'Outstation', category: { id: 'c1', name: 'Mandi Supplier' } },
];

describe('Vendor Subcategory import plan', () => {
  const HEADERS = ['Vendor Category', 'Vendor Subcategory', 'Record ID'];
  const plan = async (data: (string | null)[][], existing = vendorSubcategories()) =>
    planNamedMasterImport(
      VENDOR_SUBCATEGORY_MASTER,
      await rowsOf(VENDOR_SUBCATEGORY_MASTER, HEADERS, data),
      existing,
      parentIndexOf(VENDOR_SUBCATEGORY_MASTER, vendorCategories()),
    );

  it('links a new subcategory to its category by name', async () => {
    const result = await plan([['commission agent', 'Local']]);
    expect(result.failed).toEqual([]);
    // "Local" exists under Mandi Supplier only, so under Commission Agent it is new.
    expect(result.creates).toEqual([{ row: 2, values: { name: 'Local' }, parentId: 'c2' }]);
  });

  it('matches an existing subcategory by name within its category', async () => {
    const result = await plan([['Mandi Supplier', 'LOCAL']]);
    expect(result.creates).toEqual([]);
    expect(result.unchanged).toBe(1);
  });

  it('fails a row whose category does not exist, suggesting the closest one', async () => {
    const result = await plan([['Mandi Sus', 'Retail']]);
    expect(result.failed).toEqual([
      {
        row: 2,
        reason:
          'Vendor Category "Mandi Sus" was not found - add it in Vendor Category first ' +
          '(did you mean "Mandi Supplier"?)',
      },
    ]);
  });

  it('needs a category for a new subcategory, but not to update an existing one', async () => {
    const result = await plan([
      [null, 'Retail', null],
      [null, 'Local Mandi', 's1'],
    ]);
    expect(result.failed).toEqual([
      { row: 2, reason: 'Vendor Category is needed for a new Vendor Subcategory' },
    ]);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].changes).toEqual({ name: 'Local Mandi' });
    expect(result.updates[0].parentChange).toBeUndefined();
  });

  it('moves a subcategory to another category through its Record ID', async () => {
    const result = await plan([['Commission Agent', 'Local', 's1']]);
    expect(result.failed).toEqual([]);
    expect(result.updates[0].changes).toEqual({});
    expect(result.updates[0].parentChange).toEqual({
      id: 'c2',
      from: 'Mandi Supplier',
      to: 'Commission Agent',
    });
  });

  it('rejects moving a subcategory onto a name its new category already has', async () => {
    const existing = [
      ...vendorSubcategories(),
      { id: 's3', name: 'Local', category: { id: 'c2', name: 'Commission Agent' } },
    ];
    const result = await plan([['Commission Agent', 'Local', 's1']], existing);
    expect(result.failed).toEqual([
      {
        row: 2,
        reason:
          '"Local" is already used by the existing Vendor Subcategory "Local" under the same Vendor Category',
      },
    ]);
  });

  it('offers the categories in a dropdown and writes the category on export', async () => {
    const lists = { 'vendor-category': ['Commission Agent', 'Mandi Supplier'] };
    const exported = await reload(
      buildDataWorkbook(VENDOR_SUBCATEGORY_MASTER.sheet, vendorSubcategories(), lists),
    );
    const sheet = exported.worksheets[0];
    expect(headersOf(sheet)).toEqual(['Vendor Category', 'Vendor Subcategory', 'Record ID']);
    expect(sheet.getRow(2).values).toEqual([undefined, 'Mandi Supplier', 'Local', 's1']);
    expect(sheet.getCell('A3').dataValidation?.type).toBe('list');
  });
});

describe('Product Category import plan', () => {
  const classifications: NamedRecord[] = [
    { id: 'k1', name: 'Fresh' },
    { id: 'k2', name: 'Exotic' },
  ];
  const categories: NamedRecord[] = [
    { id: 'p1', name: 'Fruits', productClassification: { id: 'k1', name: 'Fresh' } },
  ];
  const HEADERS = ['Classification', 'Product Category', 'Record ID'];

  it('keeps category names unique overall: the same name moves the category', async () => {
    const result = planNamedMasterImport(
      PRODUCT_CATEGORY_MASTER,
      await rowsOf(PRODUCT_CATEGORY_MASTER, HEADERS, [['Exotic', 'fruits', null]]),
      categories,
      parentIndexOf(PRODUCT_CATEGORY_MASTER, classifications),
    );
    expect(result.creates).toEqual([]);
    expect(result.updates[0].changes).toEqual({});
    expect(result.updates[0].parentChange?.id).toBe('k2');
  });
});

describe('Product Subcategory sheet', () => {
  it('shows the classification on export only, as a reference', async () => {
    const template = await reload(buildTemplateWorkbook(PRODUCT_SUBCATEGORY_MASTER.sheet));
    expect(headersOf(template.worksheets[0])).toEqual(['Product Category', 'Product Subcategory']);

    const exported = await reload(
      buildDataWorkbook(PRODUCT_SUBCATEGORY_MASTER.sheet, [
        {
          id: 'x1',
          name: 'Citrus',
          category: { id: 'p1', name: 'Fruits', productClassification: { id: 'k1', name: 'Fresh' } },
        },
      ]),
    );
    const sheet = exported.worksheets[0];
    expect(headersOf(sheet)).toEqual([
      'Product Category',
      'Product Subcategory',
      'Classification',
      'Record ID',
    ]);
    expect(sheet.getRow(2).values).toEqual([undefined, 'Fruits', 'Citrus', 'Fresh', 'x1']);

    // Importing the export back ignores the reference column.
    const result = planNamedMasterImport(
      PRODUCT_SUBCATEGORY_MASTER,
      parseWorkbook(sheet.workbook, PRODUCT_SUBCATEGORY_MASTER.sheet).rows,
      [
        {
          id: 'x1',
          name: 'Citrus',
          category: { id: 'p1', name: 'Fruits', productClassification: { id: 'k1', name: 'Fresh' } },
        },
      ],
      parentIndexOf(PRODUCT_SUBCATEGORY_MASTER, [{ id: 'p1', name: 'Fruits' }]),
    );
    expect(result).toMatchObject({ creates: [], updates: [], unchanged: 1, failed: [] });
  });
});

describe('Packaging Material import plan', () => {
  const uomRecords: NamedRecord[] = [
    { id: 'u1', unit: 'Kilogram', abbreviation: 'kg' },
    { id: 'u2', unit: 'Piece', abbreviation: 'pc' },
  ];
  const materials: NamedRecord[] = [
    {
      id: 'm1',
      packagingMaterialName: 'Crate',
      useFor: 'for purchase',
      packagingMaterialWeight: '1.500',
      containsQuantity: '20.000',
      uom: { id: 'u1', unit: 'Kilogram', abbreviation: 'kg' },
    },
  ];
  const HEADERS = [
    'Packaging Material Name',
    'Use For',
    'Packaging Material Weight',
    'Quantity Per Package',
    'Reference UoM',
    'Description',
    'Record ID',
  ];
  const plan = async (data: (string | null)[][]) =>
    planNamedMasterImport(
      PACKAGING_MATERIAL_MASTER,
      await rowsOf(PACKAGING_MATERIAL_MASTER, HEADERS, data),
      materials,
      parentIndexOf(PACKAGING_MATERIAL_MASTER, uomRecords),
    );

  it('finds the UoM by unit or abbreviation and reads numbers and Use For', async () => {
    const result = await plan([
      ['Box', 'For Sale', '0.25', '12', 'PC', null, null],
      ['Bag', 'for purchase', null, null, 'kilogram', 'Jute bag', null],
    ]);
    expect(result.failed).toEqual([]);
    expect(result.creates).toEqual([
      {
        row: 2,
        values: {
          packagingMaterialName: 'Box',
          useFor: 'for sale',
          packagingMaterialWeight: 0.25,
          containsQuantity: 12,
        },
        parentId: 'u2',
      },
      {
        row: 3,
        values: {
          packagingMaterialName: 'Bag',
          useFor: 'for purchase',
          packagingMaterialDescription: 'Jute bag',
        },
        parentId: 'u1',
      },
    ]);
  });

  it('treats the same name for sale and for purchase as two records', async () => {
    const result = await plan([
      ['Crate', 'For Sale', null, null, 'kg', null, null],
      ['Crate', 'For Purchase', '1.5', '20', 'kg', null, null],
    ]);
    expect(result.failed).toEqual([]);
    expect(result.creates.map((create) => create.values.useFor)).toEqual(['for sale']);
    expect(result.unchanged).toBe(1); // 1.5 equals the stored "1.500"
  });

  it('rejects a bad Use For and a negative or non-numeric number', async () => {
    const result = await plan([
      ['Tray', 'Both', null, null, 'kg', null, null],
      ['Tray', 'For Sale', '-1', 'ten', 'kg', null, null],
    ]);
    expect(result.failed).toEqual([
      { row: 2, reason: 'Use For must be one of: For Purchase, For Sale' },
      { row: 3, reason: 'Packaging Material Weight cannot be negative; Quantity Per Package "ten" is not a number' },
    ]);
  });

  it('needs only the name: Use For and Reference UoM may be empty', async () => {
    const result = await plan([['Tray', null, null, null, null, null, null]]);
    expect(result.failed).toEqual([]);
    expect(result.creates).toEqual([{ row: 2, values: { packagingMaterialName: 'Tray' }, parentId: null }]);
  });

  it('matches an empty Use For by name alone and keeps the stored one', async () => {
    const result = await plan([['Crate', null, '2', null, null, null, null]]);
    expect(result.failed).toEqual([]);
    expect(result.creates).toEqual([]);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].record.id).toBe('m1');
    expect(result.updates[0].changes).toEqual({ packagingMaterialWeight: 2 });
  });

  it('gives Use For a fixed dropdown of its two choices', async () => {
    const template = await reload(buildTemplateWorkbook(PACKAGING_MATERIAL_MASTER.sheet));
    const sheet = template.worksheets[0];
    expect(headersOf(sheet)).toEqual([
      'Packaging Material Name',
      'Use For',
      'Packaging Material Weight',
      'Quantity Per Package',
      'Reference UoM',
      'Description',
    ]);
    expect(sheet.getCell('B2').dataValidation?.errorStyle).toBe('error');
  });
});

