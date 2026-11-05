/**
 * The shared pieces the master-data and registration importers are built on
 * (docs/master-data-excel-plan.md, Phase 1): matching linked names in memory,
 * the import order, key columns, dropdowns filled from the database, and the
 * import report.
 *
 * No database and no Spaces - workbooks are built and reloaded in memory.
 */

import 'reflect-metadata';
import ExcelJS from 'exceljs';

import {
  buildDataWorkbook,
  buildImportReportWorkbook,
  buildTemplateWorkbook,
} from '../../excel/excelFile.service';
import { emptySummary, parseWorkbook } from '../../excel/excelImport.service';
import { ExcelSheetDefinition } from '../../excel/excelColumn';
import { LookupIndex, nameSimilarity } from '../../excel/lookupIndex';
import { normaliseName } from '../../excel/lookupByName';
import {
  assertImportPrerequisites,
  findMissingPrerequisites,
  ImportMaster,
  IMPORT_MASTERS,
  prerequisiteMessage,
  prerequisitesOf,
} from '../../excel/importPrerequisites';
import AppError from '../../utils/appError';

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

function letterOf(sheet: ExcelJS.Worksheet, header: string): string {
  const index = headersOf(sheet).indexOf(header);
  if (index < 0) throw new Error(`No column "${header}"`);
  return sheet.getColumn(index + 1).letter;
}

function listValues(workbook: ExcelJS.Workbook, validation: ExcelJS.DataValidation): unknown[] {
  const range = (validation as any).formulae[0] as string;
  const [, column, , last] = range.match(/\$([A-Z]+)\$(\d+):\$[A-Z]+\$(\d+)/)!;
  const lists = workbook.getWorksheet('Lists')!;
  const values: unknown[] = [];
  for (let row = 2; row <= Number(last); row++) values.push(lists.getCell(`${column}${row}`).value);
  return values;
}

// ── LookupIndex ──────────────────────────────────────────────────────────────

interface Named {
  id: string;
  name: string;
  parentId?: string;
}

const VENDOR_CATEGORIES: Named[] = [
  { id: 'c1', name: 'Mandi Supplier' },
  { id: 'c2', name: 'Commission Agent' },
  { id: 'c3', name: 'Packing Material' },
];

describe('LookupIndex', () => {
  const index = LookupIndex.fromRecords(VENDOR_CATEGORIES, { names: (r) => [r.name] });

  it('matches ignoring case, spacing and punctuation', () => {
    expect(index.match('mandi supplier')?.id).toBe('c1');
    expect(index.match('  MANDI-SUPPLIER ')?.id).toBe('c1');
    expect(index.match('MandiSupplier')?.id).toBe('c1');
  });

  it('does not guess: a different spelling is missing, with the closest name suggested', () => {
    const result = index.find('Mandi Sus');
    expect(result).toEqual({ status: 'missing', suggestion: 'Mandi Supplier' });
    expect(index.match('Mandi Sus')).toBeNull();
  });

  it('suggests nothing when no name is close', () => {
    expect(index.find('Transport')).toEqual({ status: 'missing', suggestion: null });
  });

  it('treats a blank value as missing without a suggestion', () => {
    expect(index.find('')).toEqual({ status: 'missing', suggestion: null });
    expect(index.find(null)).toEqual({ status: 'missing', suggestion: null });
  });

  it('reports two records with the same name as ambiguous', () => {
    const duplicates = LookupIndex.fromRecords(
      [...VENDOR_CATEGORIES, { id: 'c9', name: 'mandi  supplier' }],
      { names: (r) => [r.name] },
    );
    const result = duplicates.find('Mandi Supplier');
    expect(result.status).toBe('ambiguous');
    expect(duplicates.match('Mandi Supplier')).toBeNull();
  });

  describe('scoped to a parent', () => {
    const subcategories = LookupIndex.fromRecords<Named>(
      [
        { id: 's1', name: 'Local', parentId: 'c1' },
        { id: 's2', name: 'Local', parentId: 'c2' },
        { id: 's3', name: 'Outstation', parentId: 'c1' },
      ],
      { names: (r) => [r.name], scope: (r) => r.parentId },
    );

    it('finds the name within the given parent only', () => {
      expect(subcategories.match('Local', 'c1')?.id).toBe('s1');
      expect(subcategories.match('Local', 'c2')?.id).toBe('s2');
      expect(subcategories.match('Outstation', 'c2')).toBeNull();
    });

    it('suggests only names under the same parent', () => {
      expect(subcategories.find('Outstatin', 'c1')).toEqual({
        status: 'missing',
        suggestion: 'Outstation',
      });
      expect(subcategories.find('Outstatin', 'c2')).toEqual({
        status: 'missing',
        suggestion: null,
      });
    });

    it('without a parent, the same name under two parents is ambiguous', () => {
      expect(subcategories.find('Local').status).toBe('ambiguous');
      expect(subcategories.match('Outstation')?.id).toBe('s3');
    });
  });

  it('matches a UoM by unit or by abbreviation', () => {
    const uoms = LookupIndex.fromRecords(
      [
        { id: 'u1', unit: 'Kilogram', abbreviation: 'kg' },
        { id: 'u2', unit: 'Crate', abbreviation: null },
      ],
      { names: (r) => [r.unit, r.abbreviation] },
    );
    expect(uoms.match('KG')?.id).toBe('u1');
    expect(uoms.match('kilogram')?.id).toBe('u1');
    expect(uoms.match('crate')?.id).toBe('u2');
    expect(uoms.size).toBe(2);
    expect(uoms.displayNames()).toEqual(['Crate', 'Kilogram']);
  });

  it('finds records added during the import', () => {
    const growing = LookupIndex.fromRecords<Named>([], { names: (r) => [r.name] });
    expect(growing.match('Fruits')).toBeNull();
    growing.add({ id: 'n1', name: 'Fruits' });
    expect(growing.match('fruits')?.id).toBe('n1');
  });

  it('ranks a near spelling above a shared prefix', () => {
    const similarity = (a: string, b: string) =>
      nameSimilarity(normaliseName(a), normaliseName(b));
    expect(similarity('Frut', 'Fruit')).toBeGreaterThan(similarity('Frut', 'Fruits And Nuts'));
    expect(similarity('Mandi Sus', 'Mandi Supplier')).toBeGreaterThanOrEqual(0.6);
    expect(similarity('xyz', 'Mandi Supplier')).toBeLessThan(0.6);
  });
});

// ── Import order ─────────────────────────────────────────────────────────────

/** A counter that reports the listed masters as having records. */
const filled =
  (...masters: ImportMaster[]) =>
  async (master: ImportMaster) =>
    masters.includes(master) ? 5 : 0;

describe('import order', () => {
  it('only ever links a master to masters on a lower level', () => {
    for (const [master, info] of Object.entries(IMPORT_MASTERS)) {
      for (const parent of info.parents) {
        const lower = IMPORT_MASTERS[parent].level < info.level;
        expect(`${master} -> ${parent} is on a lower level: ${lower}`).toBe(
          `${master} -> ${parent} is on a lower level: true`,
        );
      }
    }
  });

  it('lists the whole chain above a master, in import order', () => {
    expect(prerequisitesOf('product-subcategory')).toEqual([
      'product-classification',
      'product-category',
    ]);
    expect(prerequisitesOf('vendor')).toEqual([
      'uom',
      'vendor-category',
      'product-classification',
      'vendor-subcategory',
      'product-category',
      'packaging-material',
      'product-subcategory',
      'product',
    ]);
    expect(prerequisitesOf('uom')).toEqual([]);
    expect(prerequisitesOf('location')).toEqual([]);
  });

  it('blocks Product Subcategory until Classification and Category are imported', async () => {
    expect(await findMissingPrerequisites('product-subcategory', filled())).toEqual([
      'product-classification',
      'product-category',
    ]);
    expect(
      await findMissingPrerequisites('product-subcategory', filled('product-classification')),
    ).toEqual(['product-category']);
    expect(
      await findMissingPrerequisites(
        'product-subcategory',
        filled('product-classification', 'product-category'),
      ),
    ).toEqual([]);
  });

  it('does not block Customer because an unrelated master is empty', async () => {
    expect(
      await findMissingPrerequisites('customer', filled('customer-type', 'customer-category')),
    ).toEqual([]);
  });

  it('counts an optional link: Driver waits for Transporter', async () => {
    expect(await findMissingPrerequisites('driver', filled())).toEqual(['transporter']);
  });

  it('names what to import first, levels joined by arrows', () => {
    expect(
      prerequisiteMessage('product-subcategory', ['product-category', 'product-classification']),
    ).toBe(
      'Product Subcategory cannot be imported yet. Import these first, in this order: ' +
        'Product Classification → Product Category.',
    );
    expect(prerequisiteMessage('customer', ['customer-type', 'customer-category'])).toBe(
      'Customer cannot be imported yet. Import these first: Customer Type, Customer Category.',
    );
  });

  it('stops the import with a 400 that lists the missing masters', async () => {
    const attempt = assertImportPrerequisites('product-subcategory', filled());
    await expect(attempt).rejects.toBeInstanceOf(AppError);

    const error = (await attempt.catch((e) => e)) as AppError;
    expect(error.statusCode).toBe(400);
    expect(error.details).toEqual({
      master: 'product-subcategory',
      missingPrerequisites: [
        { key: 'product-classification', label: 'Product Classification', level: 1 },
        { key: 'product-category', label: 'Product Category', level: 2 },
      ],
    });

    await expect(
      assertImportPrerequisites(
        'product-subcategory',
        filled('product-classification', 'product-category'),
      ),
    ).resolves.toBeUndefined();
  });
});

// ── Key columns and database dropdowns ───────────────────────────────────────

interface SubcategoryRow {
  id: string;
  category: string;
  name: string;
}

const SUBCATEGORY_SHEET: ExcelSheetDefinition<SubcategoryRow> = {
  sheetName: 'Vendor Subcategories',
  columns: [
    { header: 'Record ID', maps: 'vendor_subcategory.id', key: true, get: (r) => r.id },
    {
      header: 'Vendor Category',
      maps: 'vendor_subcategory.categoryId',
      required: true,
      listFrom: 'vendor-category',
      link: { master: 'Vendor Category' },
      get: (r) => r.category,
    },
    { header: 'Vendor Subcategory', maps: 'vendor_subcategory.name', required: true, get: (r) => r.name },
  ],
};

const LISTS = { 'vendor-category': ['Commission Agent', 'Mandi Supplier'] };

describe('key column', () => {
  it('is written on export and read back on import', async () => {
    const exported = await reload(
      buildDataWorkbook(SUBCATEGORY_SHEET, [{ id: 'uuid-1', category: 'Mandi Supplier', name: 'Local' }], LISTS),
    );
    expect(headersOf(exported.worksheets[0])).toEqual([
      'Record ID',
      'Vendor Category',
      'Vendor Subcategory',
    ]);

    const parsed = parseWorkbook(exported, SUBCATEGORY_SHEET);
    expect(parsed.rows[0].cell(SUBCATEGORY_SHEET.columns[0])).toBe('uuid-1');
    expect(parsed.unknownColumns).toEqual([]);
  });

  it('is left out of the blank template', async () => {
    const template = await reload(buildTemplateWorkbook(SUBCATEGORY_SHEET, LISTS));
    expect(headersOf(template.worksheets[0])).toEqual(['Vendor Category', 'Vendor Subcategory']);
  });
});

describe('dropdown filled from the database', () => {
  it('offers the supplied names, and only warns on a name not in them', async () => {
    const template = await reload(buildTemplateWorkbook(SUBCATEGORY_SHEET, LISTS));
    const sheet = template.worksheets[0];
    const validation = sheet.getCell(`${letterOf(sheet, 'Vendor Category')}2`).dataValidation;

    expect(validation?.type).toBe('list');
    expect(validation?.errorStyle).toBe('warning');
    expect(listValues(template, validation!)).toEqual(['Commission Agent', 'Mandi Supplier']);
  });

  it('adds no dropdown while the master is still empty', async () => {
    const template = await reload(
      buildTemplateWorkbook(SUBCATEGORY_SHEET, { 'vendor-category': [] }),
    );
    const sheet = template.worksheets[0];
    expect(sheet.getCell(`${letterOf(sheet, 'Vendor Category')}2`).dataValidation?.type).toBeUndefined();
    expect(template.getWorksheet('Lists')).toBeUndefined();
  });

  it('tells the user which master the name must exist in', async () => {
    const template = await reload(buildTemplateWorkbook(SUBCATEGORY_SHEET, LISTS));
    const instructions = template.getWorksheet('Instructions')!;

    let note = '';
    instructions.eachRow((row) => {
      if (String(row.getCell(1).value ?? '') === 'Vendor Category') {
        note = String(row.getCell(3).value ?? '');
      }
    });
    expect(note).toContain('Must match a name that already exists in Vendor Category');
  });
});

// ── Import report ────────────────────────────────────────────────────────────

describe('import report', () => {
  it('starts every summary with the new counters empty', () => {
    expect(emptySummary()).toMatchObject({
      updated: 0,
      drafted: 0,
      draftIssues: [],
      reportUrl: null,
    });
  });

  it('lists unmatched names and skipped rows on separate sheets', async () => {
    const summary = emptySummary();
    summary.draftIssues.push({
      row: 14,
      code: 'VEN0231',
      name: 'Shree Traders',
      field: 'Vendor Category',
      typed: 'Mandi Sus',
      suggestion: 'Mandi Supplier',
      outcome: 'Draft',
    });
    summary.failed.push({ row: 9, reason: 'Bad phone number' });
    summary.skipped.push({ row: 3, reason: 'Vendor "ABC" already exists' });

    const report = await reload(buildImportReportWorkbook(summary));

    const notMatched = report.getWorksheet('Not Matched')!;
    expect(headersOf(notMatched)).toEqual([
      'Row', 'Code', 'Name', 'Field', 'Typed Value', 'Did You Mean', 'Saved As',
    ]);
    expect(notMatched.getRow(2).values).toEqual([
      undefined, 14, 'VEN0231', 'Shree Traders', 'Vendor Category', 'Mandi Sus', 'Mandi Supplier', 'Draft',
    ]);

    const skipped = report.getWorksheet('Skipped')!;
    expect([2, 3].map((row) => skipped.getRow(row).getCell(1).value)).toEqual([3, 9]);
    expect(skipped.getRow(3).getCell(2).value).toBe('Failed');
  });
});
