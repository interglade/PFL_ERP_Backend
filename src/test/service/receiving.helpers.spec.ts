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
  isCountingDocument,
  pickSlotAndLegacy,
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
const docAgg = (lines: { productId: string; variantId?: string | null; kg: number; legacy?: boolean }[]) => aggregateDocLines(lines);
const none = () => new Map<string, number>();

describe('productKey / productLabel / round3 / refId', () => {
  it('keys a product with and without a variant', () => {
    expect(productKey(TOMATO, GRADE_A)).toBe('p-tomato:v-grade-a');
    expect(productKey(ONION, null)).toBe('p-onion:null');
    expect(productKey(ONION)).toBe('p-onion:null');
    expect(productKey(ONION, '')).toBe('p-onion:null');
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
    const tomato = agg.get(productKey(TOMATO, GRADE_A)) as AggregatedSourceLine;
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

    expect(rows.map((r) => r.key)).toEqual([productKey(TOMATO, GRADE_A), productKey(ONION), productKey(POTATO)]);

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
      docAgg([{ productId: ONION, kg: 0.1 }]),
      docAgg([{ productId: ONION, kg: 0.2 }]),
      docAgg([]),
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
    const consumed = new Map<string, number>([[productKey(TOMATO, GRADE_A), 850]]);
    expect(validateLinesAgainstSource('dump', sourceAgg(), fullLines(160, 0, 0), consumed, ctx)).toEqual([
      'Only 150 kg of Tomato (Grade A) is unaccounted for GRN-00012; you entered 160 kg',
    ]);
    expect(validateLinesAgainstSource('dump', sourceAgg(), fullLines(150, 0, 0), consumed, ctx)).toEqual([]);
  });

  it('R5: a product already fully consumed reports 0 kg left, never a negative figure', () => {
    const consumed = new Map<string, number>([[productKey(ONION), 520]]);
    expect(validateLinesAgainstSource('rtv', sourceAgg(), fullLines(0, 1, 0), consumed, ctx)).toEqual([
      'Only 0 kg of Onion is unaccounted for GRN-00012; you entered 1 kg',
    ]);
  });

  it('R5 for AQR: arrived kg may not exceed the received kg and is never consumed', () => {
    const consumed = new Map<string, number>([[productKey(TOMATO, GRADE_A), 1000]]);
    expect(validateLinesAgainstSource('aqr', sourceAgg(), fullLines(1000, 500, 800), consumed, ctx)).toEqual([]);
    expect(validateLinesAgainstSource('aqr', sourceAgg(), fullLines(1100, 500, 800), none(), ctx)).toEqual([
      'Only 1000 kg of Tomato (Grade A) arrived on GRN-00012; you entered 1100 kg',
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
    ).toBe('The same product and variant is listed more than once (rows 1 and 3, rows 2 and 4); merge the rows');
  });

  it('ignores lines without a product', () => {
    expect(findDuplicateLines([{ productId: null }, { productId: undefined }, { productId: ONION }])).toBeNull();
  });
});
