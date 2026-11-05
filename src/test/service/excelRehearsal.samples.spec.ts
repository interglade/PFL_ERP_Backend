/**
 * The rehearsal samples (src/scripts/excelRehearsal) checked without a
 * database: every file matches its sheet, and the parts of the import that are
 * pure - the small masters in import order, the Locations sheet, the product
 * links - give the outcome each sample row says it should. The registrations'
 * own outcomes need the API and are checked by the rehearsal run itself.
 */

import 'reflect-metadata';
import ExcelJS from 'exceljs';

import { ExcelRow, parseWorkbook } from '../../excel/excelImport.service';
import { LookupIndex } from '../../excel/lookupIndex';
import { IMPORT_MASTERS, ImportMaster, prerequisitesOf } from '../../excel/importPrerequisites';
import { NAMED_MASTERS, NamedRecord } from '../../masterData/excel/namedMasters';
import { planNamedMasterImport } from '../../masterData/excel/namedMasterImport';
import { planLocationImport } from '../../masterData/excel/locations';
import { resolveProductLinks } from '../../product/createproduct/excel/productLinks';
import { buildSampleWorkbook, SAMPLE_FILES, SampleFile } from '../../scripts/excelRehearsal/sampleData';

async function rowsOf(file: SampleFile): Promise<{ rows: ExcelRow[]; unknown: string[]; missing: string[] }> {
  const buffer = await (await buildSampleWorkbook(file)).xlsx.writeBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);
  const parsed = parseWorkbook(workbook, file.sheet);
  return { rows: parsed.rows, unknown: parsed.unknownColumns, missing: parsed.missingColumns };
}

describe('rehearsal sample files', () => {
  it('cover every master once, in import order', () => {
    const masters = SAMPLE_FILES.map((file) => file.master);
    expect(new Set(masters).size).toBe(Object.keys(IMPORT_MASTERS).length);

    // Every master comes after everything it links to.
    masters.forEach((master, index) => {
      for (const prerequisite of prerequisitesOf(master)) {
        expect(`${master} after ${prerequisite}: ${masters.indexOf(prerequisite) < index}`).toBe(
          `${master} after ${prerequisite}: true`,
        );
      }
    });
  });

  it.each(SAMPLE_FILES.map((file) => [file.fileName, file] as const))(
    '%s matches its sheet exactly',
    async (_name, file) => {
      const { rows, unknown, missing } = await rowsOf(file);
      expect(unknown).toEqual([]);
      expect(missing).toEqual([]);
      expect(rows).toHaveLength(file.rows.length);
    },
  );
});

describe('rehearsal on an empty database, the parts without one', () => {
  /** What a fresh database holds after each small-master import, by master. */
  const store = new Map<ImportMaster, NamedRecord[]>();

  const smallMasters = SAMPLE_FILES.filter((file) => NAMED_MASTERS[file.master]);

  it.each(smallMasters.map((file) => [file.fileName, file] as const))(
    '%s imports cleanly, every row new',
    async (_name, file) => {
      const config = NAMED_MASTERS[file.master]!;
      const { rows } = await rowsOf(file);

      let parents: LookupIndex<NamedRecord> | undefined;
      if (config.parent) {
        const parent = config.parent;
        parents = LookupIndex.fromRecords(store.get(parent.master) ?? [], {
          names: (record) => [parent.display(record), ...parent.names(record)],
        });
      }

      const plan = planNamedMasterImport(config, rows, store.get(file.master) ?? [], parents);
      expect(plan.failed).toEqual([]);
      expect(plan.creates).toHaveLength(file.rows.length);

      // Save the plan as the service would, so later files can link to it.
      const saved = plan.creates.map((create, index) => {
        const record: NamedRecord = { id: `${file.master}-${index + 1}`, ...create.values };
        if (config.parent && create.parentId) {
          record[config.parent.property] = (store.get(config.parent.master) ?? []).find(
            (parent) => parent.id === create.parentId,
          );
        }
        return record;
      });
      store.set(file.master, [...(store.get(file.master) ?? []), ...saved]);
    },
  );

  it('12_locations.xlsx imports cleanly, City and State from the pincode', async () => {
    const file = SAMPLE_FILES.find((sample) => sample.master === 'location')!;
    const { rows } = await rowsOf(file);
    const plan = planLocationImport(rows, [], {
      prefixUseCount: new Map(),
      pincodes: new Map([['422001', { city: 'Nashik', state: 'Maharashtra' }]]),
    });

    expect(plan.failed).toEqual([]);
    expect(plan.creates).toHaveLength(file.rows.length);
    expect(plan.filledFromPincode).toBe(1);
    expect(plan.creates[1].values.prefix).toBe('NSK');
  });

  it('15_products.xlsx links what matches, reports Kiwi, skips the unknown UoM', async () => {
    const file = SAMPLE_FILES.find((sample) => sample.master === 'product')!;
    const { rows } = await rowsOf(file);
    const index = (master: ImportMaster, names: (r: NamedRecord) => unknown[], scope?: (r: NamedRecord) => string | null) =>
      LookupIndex.fromRecords(store.get(master) ?? [], { names: names as any, scope });

    const indexes = {
      uoms: index('uom', (r) => [r.unit, r.abbreviation]),
      classifications: index('product-classification', (r) => [r.name]),
      categories: index('product-category', (r) => [r.name]),
      subcategories: index('product-subcategory', (r) => [r.name], (r) => r.category?.id ?? null),
    };

    rows.forEach((row, position) => {
      const sample = file.rows[position];
      // The duplicate row is caught by the service's in-file check, not by the links.
      if (sample.why === 'already in this file') return;

      const links = resolveProductLinks(
        {
          uom: row.text('UOM'),
          classification: row.text('Classification'),
          category: row.text('Category'),
          subcategory: row.text('Subcategory'),
        },
        indexes,
      );
      const outcome = links.skipReason ? 'skipped' : 'created';
      expect(`${row.text('Product Name')}: ${outcome}`).toBe(`${row.text('Product Name')}: ${sample.expect}`);

      const reported = links.issues.length > 0;
      expect(`${row.text('Product Name')} reported: ${reported}`).toBe(
        `${row.text('Product Name')} reported: ${sample.why.includes('reported')}`,
      );
    });
  });
});
