/**
 * Phase 6 of docs/master-data-excel-plan.md: registrations (vendor, customer,
 * farmer) are saved as draft when a linked name does not match, instead of the
 * row being rejected - the client's "Mandi Sus" example.
 */

import 'reflect-metadata';
import ExcelJS from 'exceljs';

import { buildDataWorkbook, buildTemplateWorkbook } from '../../excel/excelFile.service';
import { parseWorkbook } from '../../excel/excelImport.service';
import { DraftLinks, EMPTY_LINK } from '../../excel/draftLinks';
import { LookupIndex } from '../../excel/lookupIndex';
import { VENDOR_SHEET } from '../../vendor/createVendor/excel/vendor.columns';
import { CUSTOMER_SHEET } from '../../customer/addcustomer/excel/customer.columns';
import { FARMER_SHEET } from '../../farmer/excel/farmer.columns';

interface Named {
  id: string;
  name: string;
  parentId?: string;
}

const categories = LookupIndex.fromRecords<Named>(
  [
    { id: 'c1', name: 'Mandi Supplier' },
    { id: 'c2', name: 'Commission Agent' },
  ],
  { names: (r) => [r.name] },
);

const products = LookupIndex.fromRecords<Named>(
  [
    { id: 'p1', name: 'Onion' },
    { id: 'p2', name: 'Potato' },
    { id: 'p3', name: 'Tomato' },
  ],
  { names: (r) => [r.name] },
);

describe('DraftLinks', () => {
  it('links a matching name and stays clean', () => {
    const draft = new DraftLinks();
    expect(draft.one(categories, 'Vendor Category', 'mandi supplier')?.id).toBe('c1');
    expect(draft.isDraft).toBe(false);
  });

  it('leaves "Mandi Sus" empty, marks the record draft, and suggests "Mandi Supplier"', () => {
    const draft = new DraftLinks();
    expect(draft.one(categories, 'Vendor Category', 'Mandi Sus', { required: true })).toBeNull();
    expect(draft.isDraft).toBe(true);
    expect(draft.toReport(14, 'VENDOR20260231', 'Shree Traders')).toEqual([
      {
        row: 14,
        code: 'VENDOR20260231',
        name: 'Shree Traders',
        field: 'Vendor Category',
        typed: 'Mandi Sus',
        suggestion: 'Mandi Supplier',
        outcome: 'Draft',
      },
    ]);
  });

  it('treats a blank optional link as simply empty, but a blank required one as a draft', () => {
    const optional = new DraftLinks();
    expect(optional.one(categories, 'Customer Type', null)).toBeNull();
    expect(optional.isDraft).toBe(false);

    const required = new DraftLinks();
    required.one(categories, 'Vendor Category', '  ', { required: true });
    expect(required.issues).toEqual([{ field: 'Vendor Category', typed: EMPTY_LINK, suggestion: null }]);
  });

  it('links the names of a list that match and reports each one that does not', () => {
    const draft = new DraftLinks();
    const linked = draft.many(products, 'List Of All Products', ['onion', 'Potatoe', 'TOMATO', 'Onion']);
    expect(linked.map((product) => product.id)).toEqual(['p1', 'p3']);
    expect(draft.issues).toEqual([
      { field: 'List Of All Products', typed: 'Potatoe', suggestion: 'Potato' },
    ]);
  });

  it('matches a subcategory only under its own category', () => {
    const subcategories = LookupIndex.fromRecords<Named>(
      [{ id: 's1', name: 'Local', parentId: 'c1' }],
      { names: (r) => [r.name], scope: (r) => r.parentId },
    );
    const draft = new DraftLinks();
    expect(draft.one(subcategories, 'Vendor Subcategory', 'Local', { scope: 'c1' })?.id).toBe('s1');
    expect(draft.one(subcategories, 'Vendor Subcategory', 'Local', { scope: 'c2' })).toBeNull();
    expect(draft.issues).toHaveLength(1);
  });
});

describe.each([
  ['Vendor', VENDOR_SHEET, 'Vendor Code', { vendorCode: 'VENDOR20260001' }],
  ['Customer', CUSTOMER_SHEET, 'Customer Code', { customerCode: 'CUST0001' }],
  ['Farmer', FARMER_SHEET, 'Farmer Code', { farmerCode: 'FARM20260001' }],
] as const)('%s code column', (_name, sheet, header, record) => {
  async function reload(workbook: ExcelJS.Workbook) {
    const buffer = await workbook.xlsx.writeBuffer();
    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(buffer as ArrayBuffer);
    return reloaded;
  }

  it('is left out of the template', async () => {
    const template = await reload(buildTemplateWorkbook(sheet as any));
    const headers: string[] = [];
    template.worksheets[0].getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).not.toContain(header);
  });

  it('is exported and read back, so a draft can be completed by re-importing its row', async () => {
    const exported = await reload(buildDataWorkbook(sheet as any, [record]));
    const rows = parseWorkbook(exported, sheet as any).rows;
    expect(rows[0].text(header)).toBe(Object.values(record)[0]);
  });
});
