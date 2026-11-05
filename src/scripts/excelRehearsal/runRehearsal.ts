/**
 * Excel import rehearsal (docs/master-data-excel-rehearsal.md).
 *
 * Imports one file per master, in the agreed order, through the running API -
 * the same endpoints the list pages call - and prints what each import did.
 * With the built-in sample files it also checks every count against the
 * expected outcome and exits non-zero on a difference.
 *
 *   npx ts-node --transpile-only src/scripts/excelRehearsal/runRehearsal.ts [options]
 *
 *   --generate-only        write the sample files and stop (no API needed)
 *   --files <dir>          import these files instead of the samples; a file is
 *                          picked up by its name: 01_uom.xlsx ... 17_farmers.xlsx
 *   --out <dir>            where samples and the run record go (default: ./rehearsal-output)
 *
 * Environment (not needed with --generate-only):
 *   REHEARSAL_API_URL      e.g. http://localhost:4000
 *   REHEARSAL_UID          login of an admin with create permission on
 *   REHEARSAL_PASSWORD       vendors, customers, farmers, transporters, drivers, vehicles
 *
 * It writes to the database it points at. Point it at a fresh staging copy,
 * never at production.
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { IMPORT_MASTERS, ImportMaster } from '../../excel/importPrerequisites';
import { buildSampleWorkbook, Expected, SAMPLE_FILES, SampleFile } from './sampleData';

/** Upload endpoint of each master, as the list pages call it. */
const IMPORT_ENDPOINT: Record<ImportMaster, string> = {
  uom: '/master-data/uom/import',
  'customer-type': '/master-data/customer-type/import',
  'customer-category': '/master-data/customer-category/import',
  'vendor-category': '/master-data/vendor-category/import',
  'product-classification': '/master-data/product-classification/import',
  transporter: '/transporters/upload',
  'vendor-subcategory': '/master-data/vendor-subcategory/import',
  'product-category': '/master-data/product-category/import',
  'packaging-material': '/master-data/packaging-material/import',
  driver: '/drivers/upload',
  vehicle: '/vehicles/upload',
  location: '/master-data/location/import',
  customer: '/customers/upload/customerdata',
  'product-subcategory': '/master-data/product-subcategory/import',
  product: '/products/upload-product',
  vendor: '/vendors/upload-vendor',
  farmer: '/farmers/upload-farmer',
  user: '/master-data/user/import',
};

interface Summary {
  totalRows: number;
  created: number;
  updated?: number;
  drafted?: number;
  skipped: { row: number; reason: string }[];
  failed: { row: number; reason: string }[];
  draftIssues?: { row: number; field: string; typed: string; suggestion: string | null }[];
  reportUrl?: string | null;
  unknownColumns?: string[];
}

interface StepResult {
  master: ImportMaster;
  file: string;
  ok: boolean;
  message: string;
  summary?: Summary;
  /** Differences from the sample's expected outcome. */
  mismatches: string[];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function login(apiUrl: string, uid: string, password: string): Promise<string> {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, password }),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Login failed (${response.status}): ${body.message ?? 'no access token in the response'}`);
  }
  return body.access_token;
}

async function upload(
  apiUrl: string,
  token: string,
  endpoint: string,
  filePath: string,
): Promise<{ status: number; message: string; data: any }> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([fs.readFileSync(filePath)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    path.basename(filePath),
  );
  const response = await fetch(`${apiUrl}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body: any = await response.json().catch(() => ({}));
  return { status: response.status, message: body.message ?? response.statusText, data: body.data };
}

/** Expected counts of a sample file, in the summary's terms. */
function expectedCounts(file: SampleFile) {
  const count = (outcome: Expected) => file.rows.filter((row) => row.expect === outcome).length;
  return {
    // A draft is still created - it is saved, with links left empty.
    created: count('created') + count('draft'),
    drafted: count('draft'),
    skipped: count('skipped'),
    failed: count('failed'),
  };
}

function compare(file: SampleFile, summary: Summary): string[] {
  const expected = expectedCounts(file);
  const actual = {
    created: summary.created,
    drafted: summary.drafted ?? 0,
    skipped: summary.skipped.length,
    failed: summary.failed.length,
  };

  const mismatches: string[] = [];
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (expected[key] !== actual[key]) {
      mismatches.push(`${key}: expected ${expected[key]}, got ${actual[key]}`);
    }
  }
  if (mismatches.length) {
    // Point at the rows: what each was meant to show.
    file.rows.forEach((row, index) => mismatches.push(`  row ${index + 2} (${row.expect}): ${row.why}`));
  }
  return mismatches;
}

function printSummary(result: StepResult): void {
  const { master, summary } = result;
  const label = IMPORT_MASTERS[master].label.padEnd(24);
  if (!summary) {
    console.log(`${result.ok ? '  ' : '✗ '}${label} ${result.message}`);
    return;
  }
  const counts =
    `created ${summary.created}, draft ${summary.drafted ?? 0}, updated ${summary.updated ?? 0}, ` +
    `skipped ${summary.skipped.length}, failed ${summary.failed.length}`;
  console.log(`${result.mismatches.length ? '✗ ' : '✓ '}${label} ${counts}`);
  for (const issue of summary.draftIssues ?? []) {
    console.log(`      row ${issue.row} ${issue.field}: "${issue.typed}"${issue.suggestion ? ` -> ${issue.suggestion}` : ''}`);
  }
  for (const issue of [...summary.skipped, ...summary.failed]) {
    console.log(`      row ${issue.row}: ${issue.reason}`);
  }
  if (summary.reportUrl) console.log(`      report: ${summary.reportUrl}`);
  for (const line of result.mismatches) console.log(`      ${line}`);
}

async function main(): Promise<void> {
  const outDir = path.resolve(argValue('--out') ?? 'rehearsal-output');
  const filesDir = argValue('--files');
  const useSamples = !filesDir;
  fs.mkdirSync(outDir, { recursive: true });

  // ── Files, in import order ──────────────────────────────────────────────
  const steps: { file: SampleFile; filePath: string }[] = [];
  for (const file of SAMPLE_FILES) {
    if (useSamples) {
      const filePath = path.join(outDir, file.fileName);
      await (await buildSampleWorkbook(file)).xlsx.writeFile(filePath);
      steps.push({ file, filePath });
    } else {
      const filePath = path.join(path.resolve(filesDir!), file.fileName);
      if (fs.existsSync(filePath)) steps.push({ file, filePath });
      else console.log(`- ${IMPORT_MASTERS[file.master].label}: no ${file.fileName}, skipped`);
    }
  }

  if (process.argv.includes('--generate-only')) {
    console.log(`Wrote ${steps.length} sample files to ${outDir}`);
    return;
  }

  const apiUrl = (process.env.REHEARSAL_API_URL ?? '').replace(/\/+$/, '');
  const uid = process.env.REHEARSAL_UID;
  const password = process.env.REHEARSAL_PASSWORD;
  if (!apiUrl || !uid || !password) {
    throw new Error('Set REHEARSAL_API_URL, REHEARSAL_UID and REHEARSAL_PASSWORD (or use --generate-only)');
  }

  const token = await login(apiUrl, uid, password);
  console.log(`Logged in to ${apiUrl}; importing ${steps.length} file(s) in order\n`);

  const results: StepResult[] = [];
  for (const { file, filePath } of steps) {
    const endpoint = IMPORT_ENDPOINT[file.master];

    // Small masters are all or nothing: check the file first, like the "Check file" button.
    if (file.allOrNothing) {
      const check = await upload(apiUrl, token, `${endpoint}?checkOnly=true`, filePath);
      if (check.status !== 200) {
        const result: StepResult = { master: file.master, file: file.fileName, ok: false, message: `check failed: ${check.message}`, summary: check.data?.failed ? check.data : undefined, mismatches: ['the check should have passed'] };
        results.push(result);
        printSummary(result);
        console.log('\nStopped: later masters depend on this one.');
        break;
      }
    }

    const response = await upload(apiUrl, token, endpoint, filePath);
    const summary: Summary | undefined = response.data && Array.isArray(response.data.failed) ? response.data : undefined;
    const ok = response.status === 200;
    const result: StepResult = {
      master: file.master,
      file: file.fileName,
      ok,
      message: response.message,
      summary,
      mismatches: !ok ? [`import returned ${response.status}: ${response.message}`] : useSamples && summary ? compare(file, summary) : [],
    };
    results.push(result);
    printSummary(result);

    if (!ok && file.allOrNothing) {
      console.log('\nStopped: later masters depend on this one.');
      break;
    }
  }

  const recordPath = path.join(outDir, `rehearsal-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(recordPath, JSON.stringify({ apiUrl, samples: useSamples, results }, null, 2));

  const failedSteps = results.filter((result) => !result.ok || result.mismatches.length);
  console.log(
    `\n${results.length} import(s), ${failedSteps.length} with a problem. Run record: ${recordPath}`,
  );
  if (failedSteps.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
