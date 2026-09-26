/**
 * Regenerates the Postman collection and environment under `docs/postman/`.
 *
 *   npm run postman:build
 *
 * The files are generated rather than hand-edited so descriptions, test scripts
 * and request layout stay consistent across all four modules. Endpoint facts
 * live here; the prose reference lives in `docs/excel-import-export-api.md`.
 */

import * as fs from 'fs';
import * as path from 'path';

const OUT_DIR = path.join(__dirname, '..', '..', 'docs', 'postman');
const BASE_URL = 'http://localhost:4000';
const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

interface QueryParam {
  key: string;
  value: string;
  disabled?: boolean;
  description?: string;
}

function testScript(lines: string[]) {
  return {
    listen: 'test',
    script: { type: 'text/javascript', exec: lines },
  };
}

function urlNode(segments: string[], query?: QueryParam[]) {
  const raw = `{{baseUrl}}/${segments.join('/')}`;
  return query ? { raw, host: ['{{baseUrl}}'], path: segments, query } : { raw, host: ['{{baseUrl}}'], path: segments };
}

// ─── Shared test snippets ───────────────────────────────────────────────────

const FILE_TESTS = [
  "pm.test('200 OK', () => pm.response.to.have.status(200));",
  "pm.test('status is success', () =>",
  "  pm.expect(pm.response.json().status).to.eql('success'));",
  '',
  'const data = pm.response.json().data;',
  "pm.test('returns a downloadUrl', () =>",
  "  pm.expect(data.downloadUrl).to.be.a('string').and.include('.xlsx'));",
  '',
  '// Saved so you can open it straight from the environment.',
  "pm.environment.set('lastDownloadUrl', data.downloadUrl);",
  "console.log('Download:', data.downloadUrl);",
];

const IMPORT_TESTS = [
  "pm.test('200 OK', () => pm.response.to.have.status(200));",
  '',
  'const summary = pm.response.json().data;',
  "console.log('Rows in sheet :', summary.totalRows);",
  "console.log('Created       :', summary.created);",
  "console.log('Skipped       :', JSON.stringify(summary.skipped, null, 2));",
  "console.log('Failed        :', JSON.stringify(summary.failed, null, 2));",
  '',
  "pm.test('no unrecognised columns (check for typos in headers)', () =>",
  '  pm.expect(summary.unknownColumns).to.eql([]));',
  "pm.test('no required columns missing', () =>",
  '  pm.expect(summary.missingColumns).to.eql([]));',
];

// ─── Request builders ───────────────────────────────────────────────────────

interface ModuleSpec {
  module: string;
  slug: string;
  importTail: string[];
  sort: string[];
  duplicateKey: string;
  required: string;
  scoped: boolean;
  csvNote: string;
}

function templateRequest({ module, slug }: ModuleSpec) {
  return {
    name: `${module} — download template`,
    event: [testScript(FILE_TESTS)],
    request: {
      method: 'GET',
      header: [],
      url: urlNode([slug, 'download', 'template']),
      description: [
        `Generates an empty ${module.toLowerCase()} workbook containing exactly the headers the`,
        'importer reads, plus an **Instructions** sheet listing every column, its type and',
        'its allowed values. Required headers are shaded red on the data sheet itself.',
        '',
        'Columns with a fixed set of values are **pick-only** — click the cell and a dropdown',
        'appears. Typing anything else raises *"Not an allowed value"*.',
        '',
        '**Sheets in the file**',
        `- \`${module}s\` — the data. Required headers are shaded dark red`,
        '- `Instructions` — Column Name / Type / Allowed Values & Notes',
        '- `Lists` — hidden, backs the dropdowns. You never need to open it',
        '',
        'The template leaves out the columns the system fills in itself — the record code,',
        '`Status` and `Created By`. They still appear on an **export**, so an export is wider',
        'than a template.',
        '',
        'Uploads it to Spaces and returns the URL — open `data.downloadUrl` in a browser.',
        '',
        '**Response 200**',
        '```json',
        '{',
        '  "status": "success",',
        '  "message": "Template URL generated successfully",',
        '  "data": {',
        `    "downloadUrl": "https://<bucket>.sgp1.digitaloceanspaces.com/exports/${module}_Template_2026-08-21T09-14-22-511Z.xlsx",`,
        `    "fileName": "${module}_Template_2026-08-21T09-14-22-511Z.xlsx"`,
        '  }',
        '}',
        '```',
        '',
        '**Errors** — `401` no/invalid token · `500` `DO_SPACES_BUCKET` not configured.',
      ].join('\n'),
    },
  };
}

function exportRequest({ module, slug, sort, scoped }: ModuleSpec) {
  const visibility = scoped
    ? [
        '',
        '### Row visibility',
        '- **Admin / Verifier** — all records',
        '- **Verifier (not admin)** — drafts excluded',
        '- **Anyone else** — only records they created',
      ]
    : ['', 'No per-user filtering — everyone gets every product.'];

  return {
    name: `${module} — export to Excel`,
    event: [
      testScript([
        ...FILE_TESTS,
        '',
        "pm.test('reports a record count', () =>",
        "  pm.expect(data.totalRecords).to.be.a('number'));",
      ]),
    ],
    request: {
      method: 'GET',
      header: [],
      url: urlNode([slug, 'export', 'excel'], [
        {
          key: 'search',
          value: '',
          disabled: true,
          description: 'Free-text match across the record, same as the list page',
        },
        {
          key: 'sort',
          value: '',
          disabled: true,
          description: 'field:ASC or field:DESC, comma-separated for multiple',
        },
      ]),
      description: [
        `Writes every ${module.toLowerCase()} matching the filters to a workbook, uploads it to`,
        'Spaces, returns the URL.',
        '',
        '**`page` and `limit` are deliberately ignored** — you get the whole filtered set, not',
        'one page of it.',
        '',
        '### Query params (both optional, both disabled by default — tick them to use)',
        '| Param | Example |',
        '|---|---|',
        '| `search` | `Nashik` |',
        `| \`sort\` | \`${sort[0]}:ASC,createdAt:DESC\` |`,
        '',
        `Valid sort fields: \`${sort.join('`, `')}\`, \`createdAt\``,
        '',
        '**Response 200**',
        '```json',
        '{',
        '  "status": "success",',
        `  "message": "128 ${module.toLowerCase()}(s) exported successfully",`,
        '  "data": {',
        `    "downloadUrl": "https://<bucket>.sgp1.digitaloceanspaces.com/exports/${module}s_2026-08-21T09-20-04-882Z.xlsx",`,
        `    "fileName": "${module}s_2026-08-21T09-20-04-882Z.xlsx",`,
        '    "totalRecords": 128',
        '  }',
        '}',
        '```',
        '',
        'Nothing matching still returns `200` with `totalRecords: 0` and a header-only file —',
        'not a `404`.',
        '',
        '**Errors** — `401` no/invalid token, or (Farmer/Customer/Vendor)',
        '`{"status":"fail","message":"User not authenticated"}` · `500` upload failed.',
        ...visibility,
      ].join('\n'),
    },
  };
}

function importRequest(spec: ModuleSpec) {
  const { module, slug, importTail, duplicateKey, required, csvNote } = spec;

  return {
    name: `${module} — import from Excel`,
    event: [testScript(IMPORT_TESTS)],
    request: {
      method: 'POST',
      header: [],
      body: {
        mode: 'formdata',
        formdata: [
          {
            key: 'file',
            type: 'file',
            src: [],
            description: 'Your .xlsx / .xls file — click Select Files to pick it',
          },
        ],
      },
      url: urlNode([slug, ...importTail]),
      description: [
        'Uploads a spreadsheet to Spaces, parses it, creates records, then **deletes the',
        'uploaded file from Spaces** — whether the import succeeded, partly succeeded, or threw.',
        '',
        '### Body',
        '`form-data` with a single key `file` of type **File**. Do **not** set `Content-Type`',
        'yourself — Postman adds the multipart boundary.',
        '',
        '### Constraints',
        '- Max **10 MB**',
        `- Accepted: \`.xlsx\`, \`.xls\`${csvNote}`,
        '- You can upload the exact file the export endpoint produced — the `Instructions` and',
        '  hidden `Lists` sheets are skipped automatically',
        '',
        '### Required columns',
        `\`${required}\``,
        '',
        'A file missing one of these headers is rejected with `400`. A row that leaves one',
        'blank is skipped and reported.',
        '',
        '### Duplicates',
        `Matched on **${duplicateKey}**. An existing record is **skipped and reported**, never`,
        'updated.',
        '',
        '### Columns the system fills in',
        'The record code, `Status` and `Created By` are **not** read from the sheet — the',
        'template leaves them out entirely. Status is always `pending` on import, and',
        '`Created By` is the **logged-in user who uploaded the file**.',
        '',
        '**Response 200**',
        '```json',
        '{',
        '  "status": "success",',
        '  "message": "12 record(s) imported, 2 skipped, 1 failed",',
        '  "data": {',
        '    "totalRows": 15,',
        '    "created": 12,',
        '    "skipped": [',
        '      { "row": 4, "reason": "... already exists (CODE0001)" },',
        '      { "row": 9, "reason": "... is empty" }',
        '    ],',
        '    "failed": [',
        '      { "row": 11, "reason": "... did not match any product" }',
        '    ],',
        '    "unknownColumns": ["Extra Notes"],',
        '    "missingColumns": []',
        '  }',
        '}',
        '```',
        '',
        '`row` is the Excel row number so you can jump straight to it.',
        '',
        '> A row can appear in `failed` **and still have been created** — e.g. a crop or',
        '> product name that matches nothing is left off, but the rest of the record is saved.',
        '',
        '**Errors** — `400` `{"message":"No file uploaded"}` · `400` `{"message":"The uploaded',
        'file is missing required column(s): ..."}` · `401` no/invalid token · `500` wrong file',
        'type or corrupt workbook.',
      ].join('\n'),
    },
  };
}

const LOGIN = {
  name: '0. Login (run this first)',
  event: [
    testScript([
      "pm.test('200 OK', () => pm.response.to.have.status(200));",
      '',
      'const body = pm.response.json();',
      "pm.environment.set('token', body.access_token);",
      "console.log('Logged in as', body.userName, '| roles:', body.roles);",
    ]),
  ],
  request: {
    auth: { type: 'noauth' },
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: {
      mode: 'raw',
      raw: '{\n  "uid": "{{uid}}",\n  "password": "{{password}}"\n}',
      options: { raw: { language: 'json' } },
    },
    url: urlNode(['auth', 'login']),
    description: [
      'Every other request needs the token this returns. The test script saves it to the',
      '`token` environment variable automatically, and the collection-level Bearer auth picks',
      'it up — so run this once and the rest just work.',
      '',
      'Set `uid` and `password` in the environment first.',
      '',
      '**Response 200**',
      '```json',
      '{',
      '  "status": "success",',
      '  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",',
      '  "refresh_token": "eyJhbGciOi...",',
      '  "id": "9f1c2e44-...",',
      '  "userName": "Admin Admin",',
      '  "roles": ["admin"],',
      '  "employeeId": "EMP0001",',
      '  "permissions": [],',
      '  "hasChild": true',
      '}',
      '```',
      '',
      '**Errors** — `400` uid/password missing · `401` wrong credentials.',
    ].join('\n'),
  },
};

const MODULES: ModuleSpec[] = [
  {
    module: 'Product',
    slug: 'products',
    importTail: ['upload-product'],
    sort: ['name', 'productCode', 'packingType', 'shelfLife'],
    duplicateKey: '`Product Name` (case-insensitive)',
    required: 'Product Name, Product Code Prefix',
    scoped: false,
    csvNote: ', `.csv`',
  },
  {
    module: 'Farmer',
    slug: 'farmers',
    importTail: ['upload-farmer'],
    sort: ['farmerfName', 'farmerCode', 'primaryMobileNo', 'status'],
    duplicateKey: '`Primary Mobile No`',
    required: 'First Name, Primary Mobile No',
    scoped: true,
    csvNote: ', `.csv`',
  },
  {
    module: 'Customer',
    slug: 'customers',
    importTail: ['upload', 'customerdata'],
    sort: ['organisationName', 'customerCode', 'emailPrimary', 'status'],
    duplicateKey: '`Organisation Name` (case-insensitive)',
    required:
      'Organisation Name, plus both addresses - Billing Address1/City/State/Pincode '
      + 'and Delivery Address1/City/State/Pincode',
    scoped: true,
    csvNote: ' — **`.csv` is rejected** by this endpoint',
  },
  {
    module: 'Vendor',
    slug: 'vendors',
    importTail: ['upload-vendor'],
    sort: ['companyName', 'vendorCode', 'gstn', 'status'],
    duplicateKey: '`Company Name` (case-insensitive)',
    required: 'Company Name, Vendor Category',
    scoped: true,
    csvNote: ', `.csv`',
  },
];

const COLLECTION_DESCRIPTION = [
  'Import and export endpoints for Product, Farmer, Customer and Vendor.',
  '',
  '## Setup',
  '1. Select the **Prime Fresh — Local** environment (top right).',
  '2. Fill in `uid` and `password`.',
  '3. Run **0. Login** — it saves the token automatically.',
  '4. Everything else uses that token via collection-level Bearer auth.',
  '',
  '## Sheets in a generated file',
  '| Sheet | Purpose |',
  '|---|---|',
  '| Data sheet | Row 1 is the header row; required headers are shaded dark red |',
  '| `Instructions` | Column Name / Type / Allowed Values & Notes |',
  '| `Lists` | Hidden — backs the dropdowns, never needs opening |',
  '',
  '## Dropdowns',
  'Every enum and yes/no column is pick-only in Excel, including the ones inside repeating',
  'blocks — `Parameter1.Type` through `Parameter5.Type` all carry the same',
  '`good | bad | average` list. The dropdown extends 500 rows past the last record, so blank',
  'rows you type into already have it. Paste beyond that and the dropdown stops, but the',
  'import still rejects unknown values.',
  '',
  '## Cell formats',
  '| Type | Accepted |',
  '|---|---|',
  '| Date | `DD-MM-YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD`, or a real Excel date cell. Day-first — `03-04-2024` is 3 April |',
  '| Boolean | Pick `Yes` or `No` from the dropdown. `True`/`False`, `Y`/`N`, `1`/`0` also accepted. Blank means "not set" |',
  '| Number | `1250.5`, `1,250.50`, `₹1250` — separators stripped |',
  '| Enum | Pick from the cell dropdown. Typed values also work in any case or spacing — `Fresh Fruits` matches `fresh fruits` |',
  '| List | `Onion, Potato; Tomato` — comma/semicolon/pipe, duplicates removed |',
  '| Blank | Empty cell, whitespace, or `-` |',
  '',
  '## Repeating blocks',
  'Child records are written as numbered blocks — `Variant1.Size`, `Crop2.Variety`. An export',
  'writes 5 blocks; the importer reads up to **20**, so you can add `Crop6.Crop` by hand. A',
  'block is read as soon as **any** of its columns has a value.',
  '',
  '| Module | Prefix | Columns |',
  '|---|---|---|',
  '| Product | `Variant` | Variant Name, Variant Code, Count, Size, Variety, Origin, Brand |',
  '| Product | `Parameter` | Name, Type (`good`/`bad`/`average`) |',
  '| Farmer | `Crop` | Crop, Variety, No_Of_Plants, Pruning Date, Expected Harvest Date, Expected Quantity (Tonnes) |',
  '| Customer | `Spec` | Article Name, Specifications, Packing Material Spec, Packing Parameters, Rejection Criteria, Comment |',
  '',
  '## Worth knowing',
  '- **Export URLs are public** — no login needed. Customer and Vendor exports carry PAN,',
  '  Aadhar and bank account numbers.',
  '- **Exports are purged after 7 days** by a nightly job at 01:30, so an old `downloadUrl`',
  '  will eventually 404.',
  '- **Import uploads are deleted immediately** after parsing.',
  '- **Lookup values are matched loosely, then created** — Category, Classification, UOM,',
  '  Subcategory, Customer Category/Type, Vendor Category/Subcategory are matched on their',
  '  letters and digits only, so `Fresh Produce` / `Fresh-Produce` / `freshproduce` all reuse',
  '  an existing `fresh produce` row. Only a genuinely new name creates one.',
  '- **Products, packing materials and users are never created** — an unmatched name there is',
  '  reported in `failed` and the field is left blank.',
  '- **Old header spellings still work** — `Storage Temp (C)`, `Middl Name`,',
  '  `Contact Mddele Name`, and the old camelCase customer headers.',
  '',
  'Full reference: `docs/excel-import-export-api.md`',
].join('\n');

const collection = {
  info: {
    _postman_id: 'b7e41d20-5c3a-4f18-9a6e-1c2d3e4f5a60',
    name: 'Prime Fresh — Excel Import / Export',
    description: COLLECTION_DESCRIPTION,
    schema: SCHEMA,
  },
  auth: {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{token}}', type: 'string' }],
  },
  variable: [{ key: 'baseUrl', value: BASE_URL, type: 'string' }],
  item: [
    LOGIN,
    ...MODULES.map((spec, index) => ({
      name: `${index + 1}. ${spec.module}`,
      description: [
        `Template → export → import for ${spec.module.toLowerCase()}s.`,
        '',
        '**Suggested order:** download the template, fill 2–3 rows, import it, export, then',
        're-import the exported file — every row should come back as a duplicate in `skipped`',
        'with `created: 0`. That last step is the real check that export, template and importer',
        'are still in sync.',
      ].join('\n'),
      item: [templateRequest(spec), exportRequest(spec), importRequest(spec)],
    })),
  ],
};

const environment = {
  id: 'c8f52e31-6d4b-4a29-8b7f-2d3e4f5a6b71',
  name: 'Prime Fresh — Local',
  values: [
    { key: 'baseUrl', value: BASE_URL, type: 'default', enabled: true },
    { key: 'uid', value: '', type: 'default', enabled: true },
    { key: 'password', value: '', type: 'secret', enabled: true },
    { key: 'token', value: '', type: 'secret', enabled: true },
    { key: 'lastDownloadUrl', value: '', type: 'default', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

fs.mkdirSync(OUT_DIR, { recursive: true });

fs.writeFileSync(
  path.join(OUT_DIR, 'PrimeFresh-Excel.postman_collection.json'),
  JSON.stringify(collection, null, 2),
  'utf8',
);
fs.writeFileSync(
  path.join(OUT_DIR, 'PrimeFresh-Local.postman_environment.json'),
  JSON.stringify(environment, null, 2),
  'utf8',
);

const requestCount = 1 + MODULES.length * 3;
console.log(`Wrote ${requestCount} requests to ${path.relative(process.cwd(), OUT_DIR)}/`);
