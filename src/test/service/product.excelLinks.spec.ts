/**
 * Phase 5 of docs/master-data-excel-plan.md: the product import no longer
 * creates UoMs, classifications, categories or subcategories. A name that does
 * not match is left empty and reported; only an unmatched UoM skips the row.
 */

import 'reflect-metadata';
import ExcelJS from 'exceljs';

import { buildTemplateWorkbook } from '../../excel/excelFile.service';
import { LookupIndex } from '../../excel/lookupIndex';
import {
  ProductLinkIndexes,
  ProductLinkRecord,
  resolveProductLinks,
} from '../../product/createproduct/excel/productLinks';
import { PRODUCT_SHEET } from '../../product/createproduct/excel/product.columns';

const fresh = { id: 'k1', name: 'Fresh' };
const exotic = { id: 'k2', name: 'Exotic' };
const fruits = { id: 'p1', name: 'Fruits', productClassification: fresh };
const vegetables = { id: 'p2', name: 'Vegetables', productClassification: fresh };
const citrus = { id: 's1', name: 'Citrus', category: fruits };
const leafy = { id: 's2', name: 'Leafy', category: vegetables };

const indexes = (): ProductLinkIndexes => ({
  uoms: LookupIndex.fromRecords<ProductLinkRecord>(
    [{ id: 'u1', unit: 'Kilogram', abbreviation: 'kg' }],
    { names: (uom) => [uom.unit, uom.abbreviation] },
  ),
  classifications: LookupIndex.fromRecords<ProductLinkRecord>([fresh, exotic], {
    names: (record) => [record.name],
  }),
  categories: LookupIndex.fromRecords<ProductLinkRecord>([fruits, vegetables], {
    names: (record) => [record.name],
  }),
  subcategories: LookupIndex.fromRecords<ProductLinkRecord>([citrus, leafy], {
    names: (record) => [record.name],
    scope: (record) => record.category?.id ?? null,
  }),
});

const resolve = (input: Partial<Record<'uom' | 'classification' | 'category' | 'subcategory', string>>) =>
  resolveProductLinks(
    {
      uom: input.uom ?? null,
      classification: input.classification ?? null,
      category: input.category ?? null,
      subcategory: input.subcategory ?? null,
    },
    indexes(),
  );

describe('product link matching', () => {
  it('links every master that matches, with nothing to report', () => {
    const links = resolve({ uom: 'KG', classification: 'fresh', category: 'FRUITS', subcategory: 'citrus' });
    expect(links.skipReason).toBeNull();
    expect([links.uom?.id, links.classification?.id, links.category?.id, links.subcategory?.id]).toEqual([
      'u1', 'k1', 'p1', 's1',
    ]);
    expect(links.issues).toEqual([]);
  });

  it('skips a row whose UoM is empty or does not match, suggesting the closest', () => {
    expect(resolve({ category: 'Fruits' }).skipReason).toBe(
      'UOM is empty - a product needs its unit of measure',
    );
    expect(resolve({ uom: 'Kilogrm', category: 'Fruits' }).skipReason).toBe(
      'UOM "Kilogrm" was not found - add it in UoM first (did you mean "Kilogram"?)',
    );
  });

  it('leaves an unmatched classification empty and reports it', () => {
    const links = resolve({ uom: 'kg', classification: 'Frsh', category: 'Fruits', subcategory: 'Citrus' });
    expect(links.skipReason).toBeNull();
    expect(links.classification).toBeNull();
    expect(links.category?.id).toBe('p1');
    expect(links.issues).toEqual([{ field: 'Classification', typed: 'Frsh', suggestion: 'Fresh' }]);
  });

  it('takes the classification from the category when the row leaves it out', () => {
    const links = resolve({ uom: 'kg', category: 'Fruits', subcategory: 'Citrus' });
    expect(links.classification?.id).toBe('k1');
    expect(links.issues).toEqual([]);
  });

  it('does not link a category that belongs to another classification', () => {
    const links = resolve({ uom: 'kg', classification: 'Exotic', category: 'Fruits', subcategory: 'Citrus' });
    expect(links.classification?.id).toBe('k2');
    expect(links.category).toBeNull();
    expect(links.subcategory).toBeNull();
    expect(links.issues).toEqual([
      { field: 'Category', typed: 'Fruits', suggestion: '"Fruits" is under Fresh' },
      { field: 'Subcategory', typed: 'Citrus', suggestion: 'its Category did not match' },
    ]);
  });

  it('does not link a subcategory that belongs to another category', () => {
    const links = resolve({ uom: 'kg', category: 'Fruits', subcategory: 'Leafy' });
    expect(links.subcategory).toBeNull();
    expect(links.issues).toEqual([
      { field: 'Subcategory', typed: 'Leafy', suggestion: '"Leafy" is under Vegetables' },
    ]);
  });

  it('points out masters the product form requires but the row left empty', () => {
    const links = resolve({ uom: 'kg' });
    expect(links.skipReason).toBeNull();
    expect(links.issues.map((issue) => `${issue.field}: ${issue.typed}`)).toEqual([
      'Classification: (empty)',
      'Category: (empty)',
      'Subcategory: (empty)',
    ]);
  });
});

describe('product template', () => {
  it('no longer asks for UoM details, and offers the masters as dropdowns', async () => {
    const lists = {
      uom: ['Kilogram'],
      'product-classification': ['Exotic', 'Fresh'],
      'product-category': ['Fruits', 'Vegetables'],
      'product-subcategory': ['Citrus', 'Leafy'],
    };
    const buffer = await buildTemplateWorkbook(PRODUCT_SHEET, lists).xlsx.writeBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as ArrayBuffer);
    const sheet = workbook.worksheets[0];

    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, index) => (headers[index - 1] = String(cell.value)));
    expect(headers).not.toContain('UOM Abbreviation');
    expect(headers).not.toContain('UOM Description');

    for (const header of ['UOM', 'Classification', 'Category', 'Subcategory']) {
      const column = headers.indexOf(header) + 1;
      expect(`${header}: ${sheet.getCell(2, column).dataValidation?.type}`).toBe(`${header}: list`);
    }
  });
});
