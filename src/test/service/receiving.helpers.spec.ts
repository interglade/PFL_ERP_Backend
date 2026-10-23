/**
 * Receiving links — the pure rules behind the status and the guard
 * (docs/receiving-links-plan.md §2.2). No database; everything here is fed
 * with plain objects shaped like the rows the services load.
 */

import 'reflect-metadata';

import {
  aggregateDocLines,
  aggregateSourceLines,
  buildProductRows,
  deriveState,
  findDuplicateLines,
  matchSourceKey,
  isCountingDocument,
  pickSlotAndLegacy,
  priceLineFromSource,
  productKey,
  productLabel,
  refId,
  round3,
  slotState,
  validateLinesAgainstSource,
} from '../../receiving/receiving.helpers';
import { AggregatedSourceLine, GuardLine, SourceLineInput } from '../../receiving/receiving.types';

const TOMATO = 'p-tomato';
const ONION = 'p-onion';
const POTATO = 'p-potato';
const GRADE_A = 'v-grade-a';

/** GRN-00012 from the walkthrough: Tomato (Grade A) 1000, Onion 500, Potato 800. */
const GRN_LINES: SourceLineInput[] = [
  { productId: TOMATO, productName: 'Tomato', variantId: GRADE_A, variantName: 'Grade A', uomId: 'u-kg', uomName: 'KG', unitPrice: '12.50', kg: '1000.000' },
  { productId: ONION, productName: 'Onion', variantId: null, variantName: null, uomId: 'u-kg', uomName: 'KG', unitPrice: 8, kg: 500 },
  { productId: POTATO, productName: 'Potato', variantId: null, variantName: null, uomId: 'u-kg', uomName: 'KG', unitPrice: 6, kg: 800 },
];

const sourceAgg = () => aggregateSourceLines(GRN_LINES);
/** Key of a GRN-00012 line (all in kg). */
const K = (productId: string, variantId?: string | null) => productKey(productId, variantId, 'u-kg');
/** Document lines carry no unit here: they are matched to the only source line of their product + variant. */
const docAgg = (lines: { productId: string; variantId?: string | null; kg: number; legacy?: boolean }[]) => aggregateDocLines(lines, sourceAgg());
const none = () => new Map<string, number>();

describe('productKey / productLabel / round3 / refId', () => {
  it('keys a product by product + variant + unit', () => {
    expect(productKey(TOMATO, GRADE_A)).toBe('p-tomato:v-grade-a:null');
    expect(productKey(TOMATO, GRADE_A, 'u-kg')).toBe('p-tomato:v-grade-a:u-kg');
    expect(productKey(ONION, null)).toBe('p-onion:null:null');
    expect(productKey(ONION)).toBe('p-onion:null:null');
    expect(productKey(ONION, '', '')).toBe('p-onion:null:null');
  });

  it('labels a product with its variant in brackets', () => {
    expect(productLabel('Tomato', 'Grade A')).toBe('Tomato (Grade A)');
    expect(productLabel('Onion', null)).toBe('Onion');
    expect(productLabel(null, null)).toBe('Unknown product');
  });

  it('rounds to 3 decimals and never returns -0', () => {
    expect(round3(0.1 + 0.2)).toBe(0.3);
    expect(round3(1000 - 850 - 150)).toBe(0);
    expect(Object.is(round3(-0.0001), 0)).toBe(true);
  });

  it('reads an id from a string or an { id } reference', () => {
    expect(refId('abc')).toBe('abc');
    expect(refId({ id: 'abc' })).toBe('abc');
    expect(refId({ id: '' })).toBeNull();
    expect(refId('')).toBeNull();
    expect(refId(undefined)).toBeNull();
    expect(refId(42)).toBeNull();
  });
});

describe('aggregateSourceLines', () => {
  it('sums received kg per product + variant and keeps the first names, uom and price', () => {
    const agg = sourceAgg();
    expect(agg.size).toBe(3);
    const tomato = agg.get(K(TOMATO, GRADE_A)) as AggregatedSourceLine;
    expect(tomato).toMatchObject({
      productId: TOMATO,
      productName: 'Tomato',
      variantId: GRADE_A,
      variantName: 'Grade A',
      uomId: 'u-kg',
      uomName: 'KG',
      unitPrice: 12.5,
      receivedKg: 1000,
    });
  });

  it('aggregates legacy duplicates of the same product + variant into one line', () => {
    const agg = aggregateSourceLines([
      { productId: TOMATO, productName: 'Tomato', variantId: GRADE_A, variantName: 'Grade A', kg: 600 },
      { productId: TOMATO, productName: 'Tomato', variantId: GRADE_A, variantName: 'Grade A', kg: '400.5' },
    ]);
    expect(agg.size).toBe(1);
    expect(agg.get(productKey(TOMATO, GRADE_A))?.receivedKg).toBe(1000.5);
  });

  it('ignores lines without a product and treats bad numbers as 0', () => {
    const agg = aggregateSourceLines([
      { productId: null, kg: 10 },
      { productId: ONION, kg: 'abc' },
      { productId: ONION, kg: null },
    ]);
    expect(agg.size).toBe(1);
    expect(agg.get(productKey(ONION))?.receivedKg).toBe(0);
  });
});

describe('aggregateDocLines', () => {
  it('sums kg and sample kg and remembers a legacy (no net weight) row', () => {
    const agg = aggregateDocLines([
      { productId: TOMATO, variantId: GRADE_A, kg: 900, sampleKg: 50 },
      { productId: TOMATO, variantId: GRADE_A, kg: 100, sampleKg: '10' },
      { productId: ONION, kg: 0, legacy: true },
    ]);
    expect(agg.get(productKey(TOMATO, GRADE_A))).toMatchObject({ kg: 1000, sampleKg: 60, legacy: false });
    expect(agg.get(productKey(ONION))).toMatchObject({ kg: 0, legacy: true });
  });
});

describe('buildProductRows', () => {
  it('computes difference and suggested kg per product (walkthrough numbers)', () => {
    // Inward: tomato 850, onion 480, potato 800. Dump: tomato 100, onion 20. RTV: nothing yet.
    const rows = buildProductRows(
      sourceAgg(),
      docAgg([
        { productId: TOMATO, variantId: GRADE_A, kg: 1000 },
        { productId: ONION, kg: 500 },
        { productId: POTATO, kg: 800 },
      ]),
      docAgg([
        { productId: TOMATO, variantId: GRADE_A, kg: 850 },
        { productId: ONION, kg: 480 },
        { productId: POTATO, kg: 800 },
      ]),
      docAgg([
        { productId: TOMATO, variantId: GRADE_A, kg: 100 },
        { productId: ONION, kg: 20 },
      ]),
      docAgg([]),
    );

    expect(rows.map((r) => r.key)).toEqual([K(TOMATO, GRADE_A), K(ONION), K(POTATO)]);

    const tomato = rows[0];
    expect(tomato).toMatchObject({
      productName: 'Tomato',
      variantName: 'Grade A',
      uomName: 'KG',
      unitPrice: 12.5,
      receivedKg: 1000,
      arrivedKg: 1000,
      inwardKg: 850,
      dumpKg: 100,
      rtvKg: 0,
      differenceKg: 50,
    });
    // inward = received − dump − rtv; dump = received − inward − rtv; rtv = received − inward − dump
    expect(tomato.suggested).toEqual({ inwardKg: 900, dumpKg: 150, rtvKg: 50 });

    const onion = rows[1];
    expect(onion.differenceKg).toBe(0);
    expect(onion.suggested).toEqual({ inwardKg: 480, dumpKg: 20, rtvKg: 0 });

    const potato = rows[2];
    expect(potato.differenceKg).toBe(0);
    expect(potato.suggested).toEqual({ inwardKg: 800, dumpKg: 0, rtvKg: 0 });
  });

  it('never suggests below 0 and reports a negative difference on over-consumed legacy data', () => {
    const rows = buildProductRows(
      sourceAgg(),
      null,
      docAgg([{ productId: POTATO, kg: 900 }]),
      docAgg([]),
      docAgg([]),
    );
    const potato = rows.find((r) => r.productId === POTATO)!;
    expect(potato.differenceKg).toBe(-100);
    expect(potato.suggested).toEqual({ inwardKg: 800, dumpKg: 0, rtvKg: 0 });
  });

  it('reports arrivedKg / sampleKg as null when there is no AQR', () => {
    const rows = buildProductRows(sourceAgg(), null, docAgg([]), docAgg([]), docAgg([]));
    expect(rows[0].arrivedKg).toBeNull();
    expect(rows[0].sampleKg).toBeNull();
  });

  it('keeps a product that only exists on a document (legacy mismatch) instead of hiding it', () => {
    const rows = buildProductRows(
      sourceAgg(),
      null,
      docAgg([{ productId: 'p-ghost', kg: 5 }]),
      docAgg([]),
      docAgg([]),
    );
    const ghost = rows.find((r) => r.productId === 'p-ghost')!;
    expect(ghost).toMatchObject({ receivedKg: 0, inwardKg: 5, differenceKg: -5 });
  });

  it('rounds kg to 3 decimals', () => {
    const rows = buildProductRows(
      aggregateSourceLines([{ productId: ONION, kg: 0.3 }]),
      null,
      aggregateDocLines([{ productId: ONION, kg: 0.1 }]),
      aggregateDocLines([{ productId: ONION, kg: 0.2 }]),
      aggregateDocLines([]),
    );
    expect(rows[0].differenceKg).toBe(0);
    expect(rows[0].suggested.rtvKg).toBe(0);
  });
});

describe('deriveState', () => {
  const zero = [{ differenceKg: 0 }, { differenceKg: 0 }];
  const short = [{ differenceKg: 0 }, { differenceKg: 50 }];

  it('is not-received until the source is COMPLETE, whatever documents exist', () => {
    expect(deriveState({ isComplete: false, hasCountingDocument: true, hasInward: true, hasLegacyDumpLine: false, products: zero })).toBe('not-received');
  });

  it('is not-started with no counting document', () => {
    expect(deriveState({ isComplete: true, hasCountingDocument: false, hasInward: false, hasLegacyDumpLine: false, products: zero })).toBe('not-started');
  });

  it('is done only with an Inward and every difference 0', () => {
    expect(deriveState({ isComplete: true, hasCountingDocument: true, hasInward: true, hasLegacyDumpLine: false, products: zero })).toBe('done');
    expect(deriveState({ isComplete: true, hasCountingDocument: true, hasInward: false, hasLegacyDumpLine: false, products: zero })).toBe('open');
    expect(deriveState({ isComplete: true, hasCountingDocument: true, hasInward: true, hasLegacyDumpLine: false, products: short })).toBe('open');
  });

  it('is legacy when a counting dump line has no net weight (unless already done)', () => {
    expect(deriveState({ isComplete: true, hasCountingDocument: true, hasInward: true, hasLegacyDumpLine: true, products: short })).toBe('legacy');
    expect(deriveState({ isComplete: true, hasCountingDocument: true, hasInward: true, hasLegacyDumpLine: true, products: zero })).toBe('done');
  });
});

describe('isCountingDocument / pickSlotAndLegacy / slotState', () => {
  const doc = (id: string, status: string | null, createdAt: string, extra: Partial<{ isDeleted: boolean; deletedAt: Date | null }> = {}) => ({
    id,
    status,
    createdAt: new Date(createdAt),
    isDeleted: false,
    deletedAt: null,
    ...extra,
  });

  it('counts a document unless it is rejected or deleted; a scheduled deletion is ignored', () => {
    expect(isCountingDocument(doc('a', 'hold', '2026-10-01'))).toBe(true);
    expect(isCountingDocument(doc('a', null, '2026-10-01'))).toBe(true);
    expect(isCountingDocument(doc('a', 'COMPLETE', '2026-10-01'))).toBe(true);
    expect(isCountingDocument(doc('a', 'REJECT', '2026-10-01'))).toBe(false);
    expect(isCountingDocument(doc('a', 'hold', '2026-10-01', { isDeleted: true }))).toBe(false);
    expect(isCountingDocument(doc('a', 'hold', '2026-10-01', { deletedAt: new Date() }))).toBe(false);
  });

  it('makes the newest counting document the slot and older counting ones legacy', () => {
    const pick = pickSlotAndLegacy([
      doc('old', 'COMPLETE', '2026-09-01'),
      doc('rejected', 'REJECT', '2026-09-20'),
      doc('new', 'hold', '2026-10-01'),
      doc('deleted', 'hold', '2026-10-05', { isDeleted: true }),
    ]);
    expect(pick.slot?.id).toBe('new');
    expect(pick.legacy.map((d) => d.id)).toEqual(['old']);
    expect(pick.counting.map((d) => d.id)).toEqual(['new', 'old']);
  });

  it('shows the newest rejected document when nothing counts, so the slot reads "rejected"', () => {
    const pick = pickSlotAndLegacy([doc('r1', 'REJECT', '2026-09-01'), doc('r2', 'REJECT', '2026-09-02')]);
    expect(pick.slot?.id).toBe('r2');
    expect(pick.counting).toEqual([]);
    expect(slotState(pick.slot)).toBe('rejected');
  });

  it('is empty with no documents', () => {
    const pick = pickSlotAndLegacy([]);
    expect(pick.slot).toBeNull();
    expect(slotState(pick.slot)).toBe('missing');
  });

  it('maps statuses to the Arrivals chips', () => {
    expect(slotState(doc('a', 'hold', '2026-10-01'))).toBe('pending');
    expect(slotState(doc('a', 'approved', '2026-10-01'))).toBe('pending');
    expect(slotState(doc('a', 'COMPLETE', '2026-10-01'))).toBe('approved');
    expect(slotState(doc('a', 'REJECT', '2026-10-01'))).toBe('rejected');
  });
});

describe('validateLinesAgainstSource', () => {
  const ctx = { sourceType: 'grn' as const, sourceNo: 'GRN-00012' };
  const fullLines = (tomato: number, onion: number, potato: number): GuardLine[] => [
    { productId: TOMATO, variantId: GRADE_A, kg: tomato },
    { productId: ONION, variantId: null, kg: onion },
    { productId: POTATO, kg: potato },
  ];

  it('accepts lines that match the source exactly, 0 allowed', () => {
    expect(validateLinesAgainstSource('inward', sourceAgg(), fullLines(850, 480, 0), none(), ctx)).toEqual([]);
  });

  it('R4: every source product must be present, each once, nothing extra', () => {
    const missing = validateLinesAgainstSource('inward', sourceAgg(), fullLines(850, 480, 800).slice(0, 2), none(), ctx);
    expect(missing).toEqual(['Potato from GRN-00012 is missing from the lines']);

    const extra = validateLinesAgainstSource(
      'inward',
      sourceAgg(),
      [...fullLines(850, 480, 800), { productId: 'p-mango', kg: 1 }],
      none(),
      ctx,
    );
    expect(extra).toEqual(['product p-mango is not part of GRN-00012']);

    const twice = validateLinesAgainstSource(
      'inward',
      sourceAgg(),
      [...fullLines(850, 480, 800), { productId: ONION, kg: 1 }],
      none(),
      ctx,
    );
    expect(twice).toEqual(['Onion is listed more than once']);

    // Tomato without its variant is a different key: it is "not part of" and the variant line is "missing".
    const wrongVariant = validateLinesAgainstSource(
      'inward',
      sourceAgg(),
      [{ productId: TOMATO, kg: 10 }, { productId: ONION, kg: 1 }, { productId: POTATO, kg: 1 }],
      none(),
      ctx,
    );
    expect(wrongVariant).toEqual([
      'Tomato is not part of GRN-00012',
      'Tomato (Grade A) from GRN-00012 is missing from the lines',
    ]);
  });

  it('R4: kg must be ≥ 0 and at least one kg > 0 for inward / dump / rtv', () => {
    expect(validateLinesAgainstSource('dump', sourceAgg(), fullLines(-1, 0, 0), none(), ctx)).toEqual([
      'Quantity for Tomato (Grade A) cannot be negative',
    ]);
    expect(validateLinesAgainstSource('dump', sourceAgg(), fullLines(0, 0, 0), none(), ctx)).toEqual([
      'Enter a quantity greater than 0 for at least one product',
    ]);
    expect(validateLinesAgainstSource('inward', sourceAgg(), [], none(), ctx)).toEqual(['Add one line per product of GRN-00012']);
  });

  it('R4: an AQR may have every arrived kg 0 (it is a report, not a movement)', () => {
    expect(validateLinesAgainstSource('aqr', sourceAgg(), fullLines(0, 0, 0), none(), ctx)).toEqual([]);
  });

  it('R5: per product kg + other counting documents ≤ received kg, with the spec wording', () => {
    // Inward already took 850 of the 1000 kg tomato; a dump of 160 exceeds the 150 left.
    const consumed = new Map<string, number>([[K(TOMATO, GRADE_A), 850]]);
    expect(validateLinesAgainstSource('dump', sourceAgg(), fullLines(160, 0, 0), consumed, ctx)).toEqual([
      'Only 150 kg of Tomato (Grade A) is unaccounted for GRN-00012; you entered 160 kg',
    ]);
    expect(validateLinesAgainstSource('dump', sourceAgg(), fullLines(150, 0, 0), consumed, ctx)).toEqual([]);
  });

  it('R5: a product already fully consumed reports 0 kg left, never a negative figure', () => {
    const consumed = new Map<string, number>([[K(ONION), 520]]);
    expect(validateLinesAgainstSource('rtv', sourceAgg(), fullLines(0, 1, 0), consumed, ctx)).toEqual([
      'Only 0 kg of Onion is unaccounted for GRN-00012; you entered 1 kg',
    ]);
  });

  it('R5 for AQR: arrived kg may not exceed the received kg and is never consumed', () => {
    const consumed = new Map<string, number>([[K(TOMATO, GRADE_A), 1000]]);
    expect(validateLinesAgainstSource('aqr', sourceAgg(), fullLines(1000, 500, 800), consumed, ctx)).toEqual([]);
    expect(validateLinesAgainstSource('aqr', sourceAgg(), fullLines(1100, 500, 800), none(), ctx)).toEqual([
      'Only 1000 kg of Tomato (Grade A) was sent on GRN-00012; you entered 1100 kg arrived',
    ]);
  });

  it('R7: an RTV can only be raised against a GRN', () => {
    expect(validateLinesAgainstSource('rtv', sourceAgg(), fullLines(1, 0, 0), none(), { sourceType: 'rbc', sourceNo: 'RBC-1' })).toEqual([
      'Return To Vendor can only be raised against a GRN',
    ]);
    expect(validateLinesAgainstSource('rtv', sourceAgg(), fullLines(1, 0, 0), none(), ctx)).toEqual([]);
  });

  it('accepts decimal strings the way Postgres returns them', () => {
    const lines: GuardLine[] = [
      { productId: TOMATO, variantId: GRADE_A, kg: '999.999' },
      { productId: ONION, kg: '0' },
      { productId: POTATO, kg: '' },
    ];
    expect(validateLinesAgainstSource('inward', sourceAgg(), lines, none(), ctx)).toEqual([]);
  });
});

describe('findDuplicateLines (R11)', () => {
  it('is null when every product + variant appears once', () => {
    expect(findDuplicateLines([{ productId: TOMATO, variantId: GRADE_A }, { productId: TOMATO, variantId: null }, { productId: ONION }])).toBeNull();
  });

  it('names the rows that repeat a product + variant', () => {
    expect(
      findDuplicateLines([
        { productId: TOMATO, variantId: GRADE_A },
        { productId: ONION },
        { productId: TOMATO, variantId: GRADE_A },
        { productId: ONION, variantId: '' },
      ]),
    ).toBe('The same product, variant and unit is listed more than once (rows 1 and 3, rows 2 and 4); merge the rows');
  });

  it('ignores lines without a product', () => {
    expect(findDuplicateLines([{ productId: null }, { productId: undefined }, { productId: ONION }])).toBeNull();
  });
});

describe('receiving units and pricing (quantity in the source unit, not kg)', () => {
  // GRN line: Mango · Hapus · Box · 50 boxes · ₹1,250 per box · 255 kg gross · 250 kg net
  const mangoLines = [
    { productId: 'mango', productName: 'Mango', variantId: 'hapus', variantName: 'Hapus', uomId: 'box', uomName: 'Box', unitPrice: '1250.00', qty: '50.00', grossKg: '255.000', kg: '250.000' },
  ];

  it('aggregates units and gross kg next to net kg', () => {
    const agg = aggregateSourceLines(mangoLines);
    expect(agg.get(productKey('mango', 'hapus', 'box'))).toMatchObject({
      uomId: 'box',
      unitPrice: 1250,
      receivedQty: 50,
      receivedGrossKg: 255,
      receivedKg: 250,
    });
  });

  it('prices a line per box from the source: 47 boxes × ₹1,250', () => {
    const products = Array.from(aggregateSourceLines(mangoLines).values());
    const { line, error } = priceLineFromSource(products, { productId: 'mango', variantId: 'hapus', uomId: 'kg', unitPrice: 999, quantity: 47 }, 'GRN-1');
    expect(error).toBeNull();
    // the unit and price the client sent are replaced by the source's
    expect(line).toEqual({ uomId: 'box', batchNo: null, unitPrice: 1250, quantity: 47, amount: 58750 });
  });

  it('rejects a quantity above the source quantity (kg typed into the box field)', () => {
    const products = Array.from(aggregateSourceLines(mangoLines).values());
    const { error } = priceLineFromSource(products, { productId: 'mango', variantId: 'hapus', quantity: 250 }, 'GRN-1');
    expect(error).toBe('Mango (Hapus): quantity 250 Box is more than the 50 Box on GRN-1');
  });

  it('keeps the line values when the product is not on the source (legacy rows)', () => {
    const { line, error } = priceLineFromSource([], { productId: 'x', uomId: 'kg', unitPrice: '10', quantity: '3' });
    expect(error).toBeNull();
    expect(line).toEqual({ uomId: 'kg', batchNo: null, unitPrice: 10, quantity: 3, amount: 30 });
  });
});

describe('unit-aware lines, arrived basis and transit loss', () => {
  // GRN: Mango Hapus in Box (50 boxes, 250 kg, ₹1,250 per box) and in kg (100 kg, ₹200 per kg).
  const MANGO_LINES: SourceLineInput[] = [
    { productId: 'mango', productName: 'Mango', variantId: 'hapus', variantName: 'Hapus', uomId: 'box', uomName: 'Box', unitPrice: 1250, qty: 50, grossKg: 255, kg: 250 },
    { productId: 'mango', productName: 'Mango', variantId: 'hapus', variantName: 'Hapus', uomId: 'kg', uomName: 'kg', unitPrice: 200, qty: 100, grossKg: 100, kg: 100 },
  ];
  const mango = () => aggregateSourceLines(MANGO_LINES);

  it('keeps the same product in two units as two lines and does not flag them as duplicates', () => {
    expect(mango().size).toBe(2);
    expect(findDuplicateLines([
      { productId: 'mango', variantId: 'hapus', uomId: 'box' },
      { productId: 'mango', variantId: 'hapus', uomId: 'kg' },
    ])).toBeNull();
  });

  it('matches a line without a unit to the only source line of its product + variant, else keeps it apart', () => {
    const single = aggregateSourceLines([MANGO_LINES[0]]);
    expect(matchSourceKey(single, 'mango', 'hapus', null)).toBe(productKey('mango', 'hapus', 'box'));
    expect(matchSourceKey(mango(), 'mango', 'hapus', null)).toBe(productKey('mango', 'hapus', null));
    expect(matchSourceKey(mango(), 'mango', 'hapus', 'kg')).toBe(productKey('mango', 'hapus', 'kg'));
  });

  it('uses the arrived kg as the basis and values the transit loss in units', () => {
    const src = mango();
    // AQR: 49 boxes / 245 kg arrived; 98 kg of the loose mango arrived.
    const aqr = aggregateDocLines([
      { productId: 'mango', variantId: 'hapus', uomId: 'box', qty: 49, kg: 245 },
      { productId: 'mango', variantId: 'hapus', uomId: 'kg', kg: 98 },
    ], src);
    const inward = aggregateDocLines([
      { productId: 'mango', variantId: 'hapus', uomId: 'box', qty: 47, kg: 235 },
      { productId: 'mango', variantId: 'hapus', uomId: 'kg', qty: 98, kg: 98 },
    ], src);
    const dump = aggregateDocLines([{ productId: 'mango', variantId: 'hapus', uomId: 'box', qty: 2, kg: 10 }], src);
    const [box, loose] = buildProductRows(src, aqr, inward, dump, aggregateDocLines([], src));
    expect(box).toMatchObject({
      arrivedKg: 245, arrivedQty: 49, basisKg: 245, differenceKg: 0,
      transitLossKg: 5, transitLossQty: 1, transitLossValue: 1250,
    });
    expect(loose).toMatchObject({
      arrivedKg: 98, basisKg: 98, differenceKg: 0,
      transitLossKg: 2, transitLossQty: 2, transitLossValue: 400,
    });
  });

  it('caps Inward / Dump / RTV at the arrived kg and an AQR at what Inward / Dump / RTV already record', () => {
    const src = mango();
    src.forEach((line) => { line.arrivedKg = line.uomId === 'box' ? 245 : 98; });
    const over = validateLinesAgainstSource('inward', src, [
      { productId: 'mango', variantId: 'hapus', uomId: 'box', kg: 246 },
      { productId: 'mango', variantId: 'hapus', uomId: 'kg', kg: 98 },
    ], none(), { sourceType: 'grn', sourceNo: 'GRN-7' });
    expect(over).toEqual(['Only 245 kg of the 245 kg of Mango (Hapus) that arrived on GRN-7 is unaccounted for; you entered 246 kg']);

    const aqrErrors = validateLinesAgainstSource('aqr', mango(), [
      { productId: 'mango', variantId: 'hapus', uomId: 'box', kg: 200 },
      { productId: 'mango', variantId: 'hapus', uomId: 'kg', kg: 100 },
    ], new Map([[productKey('mango', 'hapus', 'box'), 235]]), { sourceType: 'grn', sourceNo: 'GRN-7' });
    expect(aqrErrors).toEqual(['Inward / Dump / RTV already account for 235 kg of Mango (Hapus) on GRN-7; arrived kg cannot be lower']);
  });

  it('caps the quantity of a line at the arrived units', () => {
    const src = Array.from(mango().values());
    src[0].arrivedQty = 49;
    const { error } = priceLineFromSource(src, { productId: 'mango', variantId: 'hapus', uomId: 'box', quantity: 50 }, 'GRN-7');
    expect(error).toBe('Mango (Hapus): quantity 50 Box is more than the 49 Box that arrived');
  });
});

describe('transfer lines per batch (C5)', () => {
  // Transfer DC: 10 Box of Mango took 6 from batch MNG-0815 and 4 from MNG-0820.
  const TRANSFER_LINES: SourceLineInput[] = [
    { productId: 'mango', productName: 'Mango', variantId: 'hapus', uomId: 'box', uomName: 'Box', batchNo: 'MNG-0815', unitPrice: 1250, qty: 6, kg: 30 },
    { productId: 'mango', productName: 'Mango', variantId: 'hapus', uomId: 'box', uomName: 'Box', batchNo: 'MNG-0820', unitPrice: 1300, qty: 4, kg: 20 },
  ];

  it('keeps each batch as its own receiving line with its own cost', () => {
    const agg = aggregateSourceLines(TRANSFER_LINES);
    expect(agg.size).toBe(2);
    expect(agg.get(productKey('mango', 'hapus', 'box', 'MNG-0815'))).toMatchObject({ batchNo: 'MNG-0815', unitPrice: 1250, receivedQty: 6, receivedKg: 30 });
    expect(agg.get(productKey('mango', 'hapus', 'box', 'MNG-0820'))).toMatchObject({ batchNo: 'MNG-0820', unitPrice: 1300, receivedQty: 4 });
  });

  it('matches a document line to its batch, and refuses to guess when the batch is missing', () => {
    const agg = aggregateSourceLines(TRANSFER_LINES);
    expect(matchSourceKey(agg, 'mango', 'hapus', 'box', 'mng-0820')).toBe(productKey('mango', 'hapus', 'box', 'MNG-0820'));
    expect(matchSourceKey(agg, 'mango', 'hapus', 'box', null)).toBe(productKey('mango', 'hapus', 'box'));
  });

  it('prices an Inward line of a batch at that batch cost and returns the batch', () => {
    const products = Array.from(aggregateSourceLines(TRANSFER_LINES).values());
    const { line } = priceLineFromSource(products, { productId: 'mango', variantId: 'hapus', uomId: 'box', batchNo: 'MNG-0820', quantity: 4 });
    expect(line).toEqual({ uomId: 'box', batchNo: 'MNG-0820', unitPrice: 1300, quantity: 4, amount: 5200 });
  });
});
