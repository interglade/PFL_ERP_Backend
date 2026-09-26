import * as fs from 'fs';
import * as path from 'path';
import { buildFilterApiDocs, DOC_RELATIVE_PATH } from '../../scripts/buildFilterApiDocs';
import { allModuleFilterDefinitions } from '../../global/filters/documentFilter.definitions';
import { supportedFilterParams } from '../../global/filters/documentFilter.parser';

const ROOT = path.resolve(__dirname, '../../..');

describe('FILTER_EXPORT_IMPORT_API_DOCUMENTATION.md', () => {
  const generated = buildFilterApiDocs();

  it('is up to date with the filter and export definitions (run `npm run docs:filters`)', () => {
    const committed = fs.readFileSync(path.join(ROOT, DOC_RELATIVE_PATH), 'utf8');
    expect(committed.replace(/\r\n/g, '\n')).toBe(generated);
  });

  it('documents every supported filter parameter of every module', () => {
    for (const def of allModuleFilterDefinitions()) {
      for (const param of supportedFilterParams(def.documentType)) {
        expect(generated).toContain(`\`${param}\``);
      }
    }
  });

  it('documents only list and export routes that are registered on a controller', () => {
    const endpoints = new Set([...generated.matchAll(/^\| [^|]+ \| GET \| `([^`]+)` \|/gm)].map((m) => m[1]));
    expect(endpoints.size).toBe(38);

    const controllerPrefixes = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.controllers?\.ts$/.test(entry.name)) {
          const src = fs.readFileSync(full, 'utf8');
          const prefix = src.match(/@controller\(\s*['"]([^'"]+)['"]/)?.[1];
          if (prefix && /@httpGet\(\s*['"]\/export\/excel['"]/.test(src) && /@httpGet\(\s*['"]\/['"]/.test(src)) {
            controllerPrefixes.add(prefix);
          }
        }
      }
    };
    walk(path.join(ROOT, 'src'));

    for (const endpoint of endpoints) {
      expect(controllerPrefixes).toContain(endpoint.replace(/\/export\/excel$/, ''));
    }
  });
});
