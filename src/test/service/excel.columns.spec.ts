/**
 * Guards the contract that ties export, template and import together:
 * every header the exporter writes must be a header the importer recognises.
 *
 * These tests build real workbooks in memory - no database and no Spaces - so
 * a column map that drifts out of sync fails here rather than in production.
 */

import 'reflect-metadata';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

import {
  buildDataWorkbook,
  buildTemplateWorkbook,
  spacesKeyFromUrl,
} from '../../excel/excelFile.service';
import {
  parseUploadedBuffer,
  parseWorkbook,
} from '../../excel/excelImport.service';
import { ExcelSheetDefinition, expandHeaders } from '../../excel/excelColumn';
import {
  toBoolean,
  toDate,
  toEnum,
  toList,
  toNumber,
} from '../../excel/excelValue';

import {
  PRODUCT_PARAMETER_GROUP,
  PRODUCT_SHEET,
} from '../../product/createproduct/excel/product.columns';
import { FARMER_SHEET } from '../../farmer/excel/farmer.columns';
import { VENDOR_SHEET } from '../../vendor/createVendor/excel/vendor.columns';
import { CUSTOMER_SHEET } from '../../customer/addcustomer/excel/customer.columns';
import { splitValueList } from '../../product/productVarient/service/variantSync';

async function reload(workbook: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer as ArrayBuffer);
  return reloaded;
}

const SHEETS: [string, ExcelSheetDefinition<any>][] = [
  ['product', PRODUCT_SHEET],
  ['farmer', FARMER_SHEET],
  ['vendor', VENDOR_SHEET],
  ['customer', CUSTOMER_SHEET],
];

describe.each(SHEETS)('%s column map', (_name, def) => {
  it('has no duplicate headers', () => {
    const headers = expandHeaders(def);
    const duplicates = headers.filter((h, i) => headers.indexOf(h) !== i);
    expect(duplicates).toEqual([]);
  });

  it('can export every column', () => {
    const withoutGetter = def.columns.filter((c) => !c.get).map((c) => c.header);
    expect(withoutGetter).toEqual([]);
  });

  it('generates a template the importer fully recognises', async () => {
    const template = await reload(buildTemplateWorkbook(def));
    const names = template.worksheets.map((w) => w.name);

    // Data sheet first, then the docs, then the hidden dropdown source.
    expect(names[0]).toBe(def.sheetName);
    expect(names).toContain('Instructions');
    // The dropdown source exists only when some column offers a dropdown.
    const extras = names.filter((n) => n !== def.sheetName && n !== 'Instructions');
    expect(['Lists'].slice(0, extras.length)).toEqual(extras);
    if (extras.length) expect(template.getWorksheet('Lists')!.state).toBe('veryHidden');

    const parsed = parseWorkbook(template, def);
    expect(parsed.unknownColumns).toEqual([]);
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.rows).toHaveLength(0);
  });

  it('does not emit rows for records whose every field is blank', async () => {
    const workbook = await reload(buildDataWorkbook(def, [{} as any, {} as any]));
    expect(parseWorkbook(workbook, def).rows).toHaveLength(0);
  });
});

/** Column letter of a header in the workbook's first (data) sheet. */
function letterOf(sheet: ExcelJS.Worksheet, header: string): string {
  let found: string | undefined;
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    if (String(cell.value ?? '') === header) {
      found = sheet.getColumn(columnNumber).letter;
    }
  });
  if (!found) throw new Error(`Header not found in sheet: ${header}`);
  return found;
}

/** Every header on the workbook's first sheet, in order. */
function headersOf(sheet: ExcelJS.Worksheet): string[] {
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber - 1] = String(cell.value ?? '');
  });
  return headers;
}

describe('system-filled columns', () => {
  const SYSTEM_COLUMNS: [string, ExcelSheetDefinition<any>, string[]][] = [
    [
      'product',
      PRODUCT_SHEET,
      [
        'Product Code',
        'Product Image',
        'Variant Codes',
      ],
    ],
    [
      'farmer',
      FARMER_SHEET,
      ['Farmer Code', 'Status', 'Created By', '7/12 Copy', 'Farmer Photo'],
    ],
    [
      'vendor',
      VENDOR_SHEET,
      [
        'Vendor Code',
        'Status',
        'Created By',
        'GSTIN Copy',
        'Cancelled Cheque Copy',
        'GSTIN Copy Provided',
        'Cancelled Cheque Provided',
      ],
    ],
    [
      'customer',
      CUSTOMER_SHEET,
      [
        'Customer Code',
        'Status',
        'Created By',
        'Customer Image',
        'PAN Copy',
        'Visiting Card Copy',
        'Cancelled Cheque Provided',
        'Reason For No Cheque',
      ],
    ],
  ];

  it.each(SYSTEM_COLUMNS)(
    '%s: the template leaves them out so nobody types a value that is ignored',
    async (_name, def, systemColumns) => {
      const template = await reload(buildTemplateWorkbook(def));
      const headers = headersOf(template.worksheets[0]);

      for (const column of systemColumns) {
        expect(`${column} in template: ${headers.includes(column)}`).toBe(
          `${column} in template: false`,
        );
      }
    },
  );

  it.each(SYSTEM_COLUMNS)(
    '%s: the export still shows them',
    async (_name, def, systemColumns) => {
      const workbook = await reload(buildDataWorkbook(def, [{} as any]));
      const headers = headersOf(workbook.worksheets[0]);

      for (const column of systemColumns) {
        expect(`${column} in export: ${headers.includes(column)}`).toBe(
          `${column} in export: true`,
        );
      }
    },
  );

  it.each(SYSTEM_COLUMNS)(
    '%s: re-importing an export does not flag them as unknown',
    async (_name, def) => {
      // The export is wider than the template, so the importer has to still
      // recognise the extra headers even though it ignores their values.
      const workbook = await reload(buildDataWorkbook(def, [{} as any]));
      expect(parseWorkbook(workbook, def).unknownColumns).toEqual([]);
    },
  );

  it.each(SHEETS)(
    '%s: the template is exactly the columns a user may fill in',
    async (_name, def) => {
      // Stronger than "the known system columns are absent": this pins the
      // template to the full set that is neither readOnly nor a key (the code
      // a new record does not have yet), so a column changing kind shows up
      // here rather than silently changing the template.
      const expected: string[] = def.columns
        .filter((column) => !column.readOnly && !column.key)
        .map((column) => column.header);

      for (const group of def.groups ?? []) {
        for (let block = 1; block <= group.maxOnExport; block++) {
          for (const column of group.columns.filter((c: any) => !c.readOnly)) {
            expected.push(`${group.prefix}${block}.${column.header}`);
          }
        }
      }

      const template = await reload(buildTemplateWorkbook(def));
      expect(headersOf(template.worksheets[0])).toEqual(expected);
    },
  );

  it.each(SYSTEM_COLUMNS)(
    '%s: the Instructions sheet mirrors the template',
    async (_name, def, systemColumns) => {
      const template = await reload(buildTemplateWorkbook(def));
      const instructions = template.getWorksheet('Instructions')!;

      const documented: string[] = [];
      instructions.eachRow((row, index) => {
        if (index > 1) documented.push(String(row.getCell(1).value ?? ''));
      });

      for (const column of systemColumns) {
        expect(documented).not.toContain(column);
      }
    },
  );
});

describe('file columns', () => {
  it.each(SHEETS)(
    '%s: nothing that holds a file URL is importable',
    (_name, def) => {
      // Documents and images are uploaded through the app. Leaving one of these
      // importable would invite someone to paste a URL that the app cannot
      // serve, and would put it in the template as a blank column.
      const all = [
        ...def.columns,
        ...(def.groups ?? []).flatMap((group: any) => group.columns),
      ];

      const importable = all
        .filter((column: any) => /Document URL|Image URL/i.test(column.note ?? ''))
        .filter((column: any) => !column.readOnly)
        .map((column: any) => column.header);

      expect(importable).toEqual([]);
    },
  );
});

describe('customer address requirements', () => {
  const REQUIRED = [
    'Billing Address1',
    'Billing City',
    'Billing State',
    'Billing Pincode',
    'Delivery Address1',
    'Delivery City',
    'Delivery State',
    'Delivery Pincode',
  ];

  it('marks both addresses required so the data sheet shades them red', () => {
    for (const header of REQUIRED) {
      const column = CUSTOMER_SHEET.columns.find((c) => c.header === header)!;
      expect(`${header} required: ${Boolean(column.required)}`).toBe(
        `${header} required: true`,
      );
    }
  });

  it('leaves the optional parts of an address optional', () => {
    // Plenty of real addresses have no second line and no locality.
    for (const header of [
      'Billing Address2',
      'Billing Location',
      'Delivery Address2',
      'Delivery Location',
    ]) {
      const column = CUSTOMER_SHEET.columns.find((c) => c.header === header)!;
      expect(`${header} required: ${Boolean(column.required)}`).toBe(
        `${header} required: false`,
      );
    }
  });

  it('rejects a file that is missing a required address header', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Customers');
    sheet.addRow(['Organisation Name', 'Billing Address1']);
    sheet.addRow(['Acme Traders', 'Plot 4']);

    // Everything except Billing Address1 is absent, so the upload is rejected
    // outright rather than importing addressless customers.
    const parsed = parseWorkbook(workbook, CUSTOMER_SHEET);
    expect(parsed.missingColumns.sort()).toEqual(
      REQUIRED.filter((h) => h !== 'Billing Address1').sort(),
    );
  });

  it('accepts a file that has every required address header', async () => {
    const template = await reload(buildTemplateWorkbook(CUSTOMER_SHEET));
    expect(parseWorkbook(template, CUSTOMER_SHEET).missingColumns).toEqual([]);
  });
});

describe('statutory numbers stay importable', () => {
  const NUMBERS: [string, ExcelSheetDefinition<any>, string[]][] = [
    ['vendor', VENDOR_SHEET, ['GSTIN', 'PAN Number', 'MSME Number', 'Trade Licence Number']],
    [
      'customer',
      CUSTOMER_SHEET,
      [
        'GSTIN',
        'PAN Number',
        'Aadhaar Number',
        'CIN Number',
        'Mandi Licence No',
        'Registration No',
        'Electricity Consumer No',
        'Visiting Contact No',
      ],
    ],
  ];

  it.each(NUMBERS)('%s: the reference numbers are in the template', async (_n, def, headers) => {
    // Only the scanned copy and the "do we have it" flag were dropped. The
    // number itself is ordinary data and has to survive an import.
    const template = await reload(buildTemplateWorkbook(def));
    const present = headersOf(template.worksheets[0]);

    for (const header of headers) {
      expect(`${header} in template: ${present.includes(header)}`).toBe(
        `${header} in template: true`,
      );
    }
  });
});

describe('Instructions sheet', () => {
  it('documents columns without exposing the database mapping', async () => {
    const workbook = await reload(buildTemplateWorkbook(PRODUCT_SHEET));
    const sheet = workbook.getWorksheet('Instructions')!;

    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      headers[columnNumber - 1] = String(cell.value ?? '');
    });

    expect(headers).toEqual(['Column Name', 'Type', 'Allowed Values / Notes']);
    // The table.column mapping is developer documentation, not user-facing.
    expect(headers.join(' ')).not.toMatch(/table\.column|Saved In/i);
  });

  it('spells out the allowed values for an enum column', async () => {
    const workbook = await reload(buildTemplateWorkbook(PRODUCT_SHEET));
    const sheet = workbook.getWorksheet('Instructions')!;

    let note = '';
    sheet.eachRow((row) => {
      if (String(row.getCell(1).value ?? '') === 'ParameterN.Type') {
        note = String(row.getCell(3).value ?? '');
      }
    });

    expect(note).toContain('Pick from the dropdown: good | bad | average');
  });
});

describe('dropdowns', () => {
  it('gives an enum column a list dropdown backed by the hidden Lists sheet', async () => {
    const workbook = await reload(buildTemplateWorkbook(PRODUCT_SHEET));
    const sheet = workbook.worksheets[0];

    // The user-facing example: Parameter1.Type must be pick-only.
    const letter = letterOf(sheet, 'Parameter1.Type');
    const validation = sheet.getCell(`${letter}2`).dataValidation;

    expect(validation?.type).toBe('list');
    expect(validation?.allowBlank).toBe(true);
    expect((validation as any)?.formulae?.[0]).toMatch(/^Lists!\$[A-Z]+\$2:\$[A-Z]+\$4$/);

    const lists = workbook.getWorksheet('Lists')!;
    const choices = [2, 3, 4].map((row) => lists.getCell(row, 1).value);
    expect(choices).toEqual(['good', 'bad', 'average']);
  });

  it('repeats the dropdown on every block of a repeating group', async () => {
    const workbook = await reload(buildTemplateWorkbook(PRODUCT_SHEET));
    const sheet = workbook.worksheets[0];

    for (let block = 1; block <= PRODUCT_PARAMETER_GROUP.maxOnExport; block++) {
      const letter = letterOf(sheet, `Parameter${block}.Type`);
      expect(sheet.getCell(`${letter}2`).dataValidation?.type).toBe('list');
    }
  });

  it('gives a yes/no column a Yes/No dropdown', async () => {
    const workbook = await reload(buildTemplateWorkbook(CUSTOMER_SHEET));
    const sheet = workbook.worksheets[0];

    const letter = letterOf(sheet, 'RTV Allowed');
    const validation = sheet.getCell(`${letter}2`).dataValidation;
    expect(validation?.type).toBe('list');

    const range = (validation as any).formulae[0] as string;
    const listColumn = range.match(/\$([A-Z]+)\$2/)![1];
    const lists = workbook.getWorksheet('Lists')!;
    const values = [2, 3].map((row) => lists.getCell(`${listColumn}${row}`).value);
    expect(values).toEqual(['Yes', 'No']);
  });

  it('covers blank rows below the data so new entries get the dropdown too', async () => {
    const workbook = await reload(buildTemplateWorkbook(PRODUCT_SHEET));
    const sheet = workbook.worksheets[0];
    const letter = letterOf(sheet, 'Parameter1.Type');

    expect(sheet.getCell(`${letter}250`).dataValidation?.type).toBe('list');
  });

  /**
   * Named per module so a column that quietly loses its `enumValues` — or a new
   * enum added without them — fails here rather than shipping as free text.
   *
   * `Status` is absent on purpose: it is system-filled, so it never reaches the
   * template a user types into.
   */
  const EXPECTED: [string, ExcelSheetDefinition<any>, string[]][] = [
    ['product', PRODUCT_SHEET, ['Parameter1.Type', 'Parameter5.Type']],
    ['farmer', FARMER_SHEET, ['Gender', 'Land Holding', 'Land Status']],
    // Vendor's booleans were all "do we have the document" flags, which are set
    // in the app alongside the upload, so only the two enums remain.
    ['vendor', VENDOR_SHEET, ['Classification', 'Account Type']],
    [
      'customer',
      CUSTOMER_SHEET,
      [
        'Certification Type',
        'Corporate Registration Type',
        'Account Type',
        'RTV Allowed',
        'Agreement Executed',
        'Customer Verification Completed',
        'Due Diligence Done',
      ],
    ],
  ];

  it.each(EXPECTED)('%s: every fixed-value column is pick-only', async (_name, def, headers) => {
    const workbook = await reload(buildTemplateWorkbook(def));
    const sheet = workbook.worksheets[0];

    for (const header of headers) {
      const letter = letterOf(sheet, header);
      const validation = sheet.getCell(`${letter}2`).dataValidation;
      expect(`${header}: ${validation?.type}`).toBe(`${header}: list`);
    }
  });

  it.each(EXPECTED)('%s: no enum column was left as free text', (_name, def) => {
    const all = [
      ...def.columns,
      ...(def.groups ?? []).flatMap((group: any) => group.columns),
    ];

    // A column declared `type: 'enum'` without values would silently accept
    // anything on import and offer no dropdown.
    const enumsWithoutValues = all
      .filter((column: any) => column.type === 'enum' && !column.enumValues?.length)
      .map((column: any) => column.header);

    expect(enumsWithoutValues).toEqual([]);
  });

  it('leaves free-text columns without a dropdown', async () => {
    const workbook = await reload(buildTemplateWorkbook(PRODUCT_SHEET));
    const sheet = workbook.worksheets[0];

    const letter = letterOf(sheet, 'Product Name');
    expect(sheet.getCell(`${letter}2`).dataValidation).toBeUndefined();
  });

  it('hides the Lists sheet and never reads it as data', async () => {
    const workbook = await reload(buildDataWorkbook(VENDOR_SHEET, [
      { companyName: 'ABC Traders' } as any,
    ]));

    expect(workbook.getWorksheet('Lists')!.state).toBe('veryHidden');

    // Lists holds enum values in column A; if the importer picked that sheet it
    // would happily parse them as records.
    const parsed = parseWorkbook(workbook, VENDOR_SHEET);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.unknownColumns).toEqual([]);
  });
});

describe('product export imports back unchanged', () => {
  const product: any = {
    productCode: 'ONI0001',
    name: 'Onion',
    prefix: 'ONI',
    description: 'Red onion',
    classification: { name: 'Vegetables' },
    category: { name: 'Fresh' },
    subcategory: { name: 'Bulb' },
    uom: { unit: 'Kilogram', abbreviation: 'kg', description: 'Weight' },
    packingType: 'Mesh Bag',
    shelfLife: 30,
    storageTemp: 4,
    thresholdStock: 500,
    allowedValues: [
      { value: '40mm', sortOrder: 1, attribute: { code: 'size', name: 'Size', sortOrder: 2 } },
      { value: '10', sortOrder: 2, attribute: { code: 'count', name: 'Count', sortOrder: 1 } },
      { value: '70mm', sortOrder: 2, attribute: { code: 'size', name: 'Size', sortOrder: 2 } },
      { value: '20', sortOrder: 1, attribute: { code: 'count', name: 'Count', sortOrder: 1 } },
      { value: 'Spring', sortOrder: 1, attribute: { code: 'variety', name: 'Variety', sortOrder: 3 } },
    ],
    variant: [
      { variantCode: 'ONI0001-02', sequence: 2, isActive: true },
      { variantCode: 'ONI0001-01', sequence: 1, isActive: true },
      { variantCode: 'ONI0001-03', sequence: 3, isActive: false },
    ],
    qualityParameters: [
      { name: 'Firmness', type: 'good' },
      { name: 'Rot', type: 'bad' },
    ],
  };

  const column = (header: string) =>
    PRODUCT_SHEET.columns.find((c) => c.header === header)!;

  it('round trips scalar columns', async () => {
    const workbook = await reload(buildDataWorkbook(PRODUCT_SHEET, [product]));
    const [row] = parseWorkbook(workbook, PRODUCT_SHEET).rows;

    expect(row.cell(column('Product Name'))).toBe('Onion');
    expect(row.cell(column('Category'))).toBe('Fresh');
    expect(row.cell(column('Subcategory'))).toBe('Bulb');
    expect(row.cell(column('UOM'))).toBe('Kilogram');
    expect(row.cell(column('Shelf Life (Days)'))).toBe(30);
    expect(row.cell(column('Storage Temp (°C)'))).toBe(4);
    expect(row.cell(column('Threshold Stock'))).toBe(500);
  });

  it('writes each attribute as one comma list, in natural order', async () => {
    const workbook = await reload(buildDataWorkbook(PRODUCT_SHEET, [product]));
    const [row] = parseWorkbook(workbook, PRODUCT_SHEET).rows;

    expect(row.text('Count')).toBe('10, 20');
    expect(row.text('Size')).toBe('40mm, 70mm');
    expect(row.text('Variety')).toBe('Spring');
    expect(row.text('Origin')).toBeNull();
    expect(splitValueList(row.raw('Size'))).toEqual(['40mm', '70mm']);
    // Active variants only, in code order.
    expect(row.text('Variant Codes')).toBe('ONI0001-01, ONI0001-02');
  });

  it('round trips the parameter blocks', async () => {
    const workbook = await reload(buildDataWorkbook(PRODUCT_SHEET, [product]));
    const [row] = parseWorkbook(workbook, PRODUCT_SHEET).rows;

    const typeColumn = PRODUCT_PARAMETER_GROUP.columns.find((c) => c.header === 'Type')!;
    const types = row.eachGroupBlock(PRODUCT_PARAMETER_GROUP, (index) =>
      row.groupCell<string | null>(PRODUCT_PARAMETER_GROUP, index, typeColumn),
    );
    expect(types).toEqual(['good', 'bad']);
  });

  it('still accepts a sheet written against an older header spelling', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    sheet.addRow(['Product Name', 'Product Code Prefix', 'Storage Temp (C)']);
    sheet.addRow(['Potato', 'POT', 7]);

    const parsed = parseWorkbook(workbook, PRODUCT_SHEET);
    expect(parsed.unknownColumns).toEqual([]);
    expect(parsed.rows[0].cell(column('Storage Temp (°C)'))).toBe(7);
  });
});

describe('legacy upload formats', () => {
  const column = (header: string) =>
    PRODUCT_SHEET.columns.find((c) => c.header === header)!;

  /** Builds a SheetJS workbook buffer in the requested format. */
  function legacyBuffer(bookType: 'xls' | 'csv'): Buffer {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Product Name', 'Product Code Prefix', 'Shelf Life (Days)', 'Category'],
      ['Onion', 'ONI', 30, 'Fresh'],
      ['Potato', 'POT', 45, 'Fresh'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Products');
    return XLSX.write(workbook, { bookType, type: 'buffer' }) as Buffer;
  }

  it('reads a legacy .xls upload', async () => {
    const parsed = await parseUploadedBuffer(legacyBuffer('xls'), PRODUCT_SHEET);

    expect(parsed.unknownColumns).toEqual([]);
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].cell(column('Product Name'))).toBe('Onion');
    expect(parsed.rows[0].cell(column('Shelf Life (Days)'))).toBe(30);
  });

  it('reads a .csv upload', async () => {
    const parsed = await parseUploadedBuffer(legacyBuffer('csv'), PRODUCT_SHEET);

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1].cell(column('Product Name'))).toBe('Potato');
  });

  it('reports the same Excel row numbers as the .xlsx reader', async () => {
    const legacy = await parseUploadedBuffer(legacyBuffer('xls'), PRODUCT_SHEET);

    // Header is row 1, so the first data row must be row 2 in both readers.
    expect(legacy.rows.map((r) => r.rowNumber)).toEqual([2, 3]);
  });

  it('reports a required header the file does not have', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Product Name'], ['Onion']]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Products');
    const buffer = XLSX.write(workbook, { bookType: 'xls', type: 'buffer' }) as Buffer;

    const parsed = await parseUploadedBuffer(buffer, PRODUCT_SHEET);
    expect(parsed.missingColumns).toEqual(['Product Code Prefix']);
  });

  it('still routes .xlsx through the ExcelJS reader', async () => {
    const workbook = buildDataWorkbook(PRODUCT_SHEET, [
      { name: 'Onion', prefix: 'ONI', shelfLife: 30 } as any,
    ]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await parseUploadedBuffer(buffer, PRODUCT_SHEET);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].cell(column('Product Name'))).toBe('Onion');
  });
});

describe('product attribute lists', () => {
  it('reads Count / Size / Variety / Origin / Brand as comma lists', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    sheet.addRow(['Product Name', 'Product Code Prefix', 'Count', 'Origin', 'Variety', 'Size', 'Brand']);
    sheet.addRow(['Imported Orange', 'IMO', '64, 72, 80, 88, 100', 'south africa, egypt, australia', '', '', '']);
    sheet.addRow(['Imported Avocado', 'AVO', 10, '', '', '', '']);

    const parsed = parseWorkbook(workbook, PRODUCT_SHEET);
    expect(parsed.unknownColumns).toEqual([]);
    expect(parsed.missingColumns).toEqual([]);

    const [orange, avocado] = parsed.rows;
    expect(splitValueList(orange.raw('Count'))).toEqual(['64', '72', '80', '88', '100']);
    expect(splitValueList(orange.raw('Origin'))).toEqual(['south africa', 'egypt', 'australia']);
    expect(splitValueList(orange.raw('Brand'))).toEqual([]);
    // A single number typed into a cell is still one value.
    expect(splitValueList(avocado.raw('Count'))).toEqual(['10']);
  });
});

describe('cell coercion', () => {
  it('reads Indian day-first dates without swapping day and month', () => {
    // `new Date('03-04-2024')` is month-first in V8, which would silently turn
    // every 3 April into 4 March.
    expect(toDate('03-04-2024')?.toISOString().slice(0, 10)).toBe('2024-04-03');
    expect(toDate('03/04/2024')?.toISOString().slice(0, 10)).toBe('2024-04-03');
  });

  it('reads ISO dates and Excel serial numbers', () => {
    expect(toDate('2024-04-03')?.toISOString().slice(0, 10)).toBe('2024-04-03');
    expect(toDate(45385)?.toISOString()).toBe('2024-04-03T00:00:00.000Z');
  });

  it('rejects impossible calendar dates instead of rolling them over', () => {
    expect(toDate('31-02-2024')).toBeNull();
  });

  it('reads the spellings people actually type for yes/no', () => {
    expect(toBoolean('Yes')).toBe(true);
    expect(toBoolean('NO')).toBe(false);
    expect(toBoolean('')).toBeNull();
  });

  it('tolerates thousands separators and blank placeholders in numbers', () => {
    expect(toNumber('1,250.50')).toBe(1250.5);
    expect(toNumber('  ')).toBeNull();
    expect(toNumber('-')).toBeNull();
  });

  it('matches enums regardless of case and spacing', () => {
    expect(toEnum('Fresh Fruits', ['fresh fruits', 'onion'])).toBe('fresh fruits');
    expect(toEnum('bananas', ['fresh fruits'])).toBeNull();
  });

  it('splits and de-duplicates comma-separated lists', () => {
    expect(toList('Onion, Potato ; Onion')).toEqual(['Onion', 'Potato']);
  });
});

describe('spacesKeyFromUrl', () => {
  it('keeps nested prefixes intact', () => {
    expect(
      spacesKeyFromUrl('https://bucket.sgp1.digitaloceanspaces.com/a/b/c/file.xlsx'),
    ).toBe('a/b/c/file.xlsx');
  });

  it('decodes escaped characters in the key', () => {
    expect(
      spacesKeyFromUrl('https://bucket.sgp1.digitaloceanspaces.com/single/my%20file.xlsx'),
    ).toBe('single/my file.xlsx');
  });

  it('passes a bare key through unchanged', () => {
    expect(spacesKeyFromUrl('single/1712-file.xlsx')).toBe('single/1712-file.xlsx');
  });
});
