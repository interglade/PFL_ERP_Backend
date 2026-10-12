/**
 * AQR product lines — the pure request validation behind POST /aqr and
 * PATCH /aqr/:id (docs/receiving-links-plan.md §2.4). No database; the
 * receiving guard (R1–R7) is covered by receiving.helpers.spec.ts.
 */

import 'reflect-metadata';

import {
  AQR_SOURCE_BY_FOR,
  AqrLineInput,
  AqrParameterInput,
  defaultPercentage,
  legacyQuantityToNumber,
  parseQuantity,
  refIdOf,
  validateAqrLines,
  validateAqrRequest,
  validateAqrSourceRef,
} from '../../aqr/service/aqr.validation';

const TOMATO = 'p-tomato';
const ONION = 'p-onion';
const GRADE_A = 'v-grade-a';
const GRN_ID = 'grn-00012';
const DC_ID = 'dc-00007';
const RBC_ID = 'rbc-00003';

const firmness = (quantity: number | string | null | undefined, extra: Partial<AqrParameterInput> = {}): AqrParameterInput => ({
  qualityParameterId: 'qp-firmness',
  qualityParameterName: 'Firmness',
  qualityParameterType: 'good',
  quantity,
  percentage: 92,
  ...extra,
});

/** The walkthrough AQR: Tomato (Grade A) 1000 arrived / 100 sampled, Onion 500 / 50. */
const goodLines = (): AqrLineInput[] => [
  { product: { id: TOMATO }, variant: { id: GRADE_A }, arrivedQty: 1000, samplingQty: 100, totalQty: 100, totalpercent: 100, parameters: [firmness(92)] },
  { product: { id: ONION }, variant: null, arrivedQty: 500, samplingQty: 50, parameters: [firmness(45)] },
];

describe('refIdOf / parseQuantity / legacyQuantityToNumber / defaultPercentage', () => {
  it('reads an id from { id } or a bare string and ignores blanks', () => {
    expect(refIdOf({ id: 'abc' })).toBe('abc');
    expect(refIdOf('abc')).toBe('abc');
    expect(refIdOf({ id: '  ' })).toBeNull();
    expect(refIdOf('')).toBeNull();
    expect(refIdOf(null)).toBeNull();
    expect(refIdOf(undefined)).toBeNull();
  });

  it('distinguishes missing, numeric and non-numeric quantities', () => {
    expect(parseQuantity(undefined)).toBeUndefined();
    expect(parseQuantity(null)).toBeUndefined();
    expect(parseQuantity('')).toBeUndefined();
    expect(parseQuantity(12.5)).toBe(12.5);
    expect(parseQuantity('12.5')).toBe(12.5);
    expect(parseQuantity('abc')).toBeNaN();
    expect(parseQuantity({} as unknown)).toBeNaN();
  });

  it('turns legacy varchar quantities into numbers, 0 when unparseable', () => {
    expect(legacyQuantityToNumber('1000')).toBe(1000);
    expect(legacyQuantityToNumber('1000.250')).toBe(1000.25);
    expect(legacyQuantityToNumber('abc')).toBe(0);
    expect(legacyQuantityToNumber(null)).toBe(0);
    expect(legacyQuantityToNumber('')).toBe(0);
  });

  it('defaults a parameter percentage from the sample, 0 without a sample', () => {
    expect(defaultPercentage(92, 100)).toBe(92);
    expect(defaultPercentage(1, 3)).toBe(33.33);
    expect(defaultPercentage(5, 0)).toBe(0);
    expect(defaultPercentage(NaN, 100)).toBe(0);
  });
});

describe('validateAqrSourceRef — exactly one source ref matching aqrFor', () => {
  it('maps each purpose to its reference and source type', () => {
    expect(AQR_SOURCE_BY_FOR.purchase).toMatchObject({ ref: 'grnNo', sourceType: 'grn' });
    expect(AQR_SOURCE_BY_FOR.transfer).toMatchObject({ ref: 'deliveryChallanNo', sourceType: 'stock-transfer-dc' });
    expect(AQR_SOURCE_BY_FOR['returned-by-customer']).toMatchObject({ ref: 'rbcNo', sourceType: 'rbc' });
  });

  it('accepts purchase + grnNo, transfer + deliveryChallanNo, returned-by-customer + rbcNo', () => {
    expect(validateAqrSourceRef({ aqrFor: 'purchase', grnNo: { id: GRN_ID } })).toEqual({
      errors: [],
      source: { sourceType: 'grn', sourceId: GRN_ID },
    });
    expect(validateAqrSourceRef({ aqrFor: 'transfer', deliveryChallanNo: { id: DC_ID } })).toEqual({
      errors: [],
      source: { sourceType: 'stock-transfer-dc', sourceId: DC_ID },
    });
    expect(validateAqrSourceRef({ aqrFor: 'returned-by-customer', rbcNo: { id: RBC_ID } })).toEqual({
      errors: [],
      source: { sourceType: 'rbc', sourceId: RBC_ID },
    });
  });

  it('accepts a bare id string as the reference', () => {
    expect(validateAqrSourceRef({ aqrFor: 'purchase', grnNo: GRN_ID }).source).toEqual({ sourceType: 'grn', sourceId: GRN_ID });
  });

  it('rejects a missing or unknown aqrFor', () => {
    expect(validateAqrSourceRef({ grnNo: { id: GRN_ID } })).toEqual({
      errors: ['AQR for must be purchase, transfer or returned-by-customer'],
      source: null,
    });
    expect(validateAqrSourceRef({ aqrFor: 'sale', grnNo: { id: GRN_ID } }).errors).toEqual([
      'AQR for must be purchase, transfer or returned-by-customer',
    ]);
  });

  it('rejects a purchase AQR without a GRN', () => {
    const result = validateAqrSourceRef({ aqrFor: 'purchase' });
    expect(result.errors).toEqual(['Select the GRN this AQR is for']);
    expect(result.source).toBeNull();
  });

  it('rejects a transfer AQR without a Transfer DC and an RBC AQR without an RBC', () => {
    expect(validateAqrSourceRef({ aqrFor: 'transfer' }).errors).toEqual(['Select the Transfer DC this AQR is for']);
    expect(validateAqrSourceRef({ aqrFor: 'returned-by-customer' }).errors).toEqual(['Select the Return By Customer this AQR is for']);
  });

  it('rejects a reference that does not match aqrFor, even alongside the right one', () => {
    expect(validateAqrSourceRef({ aqrFor: 'purchase', deliveryChallanNo: { id: DC_ID } }).errors).toEqual([
      'Select the GRN this AQR is for',
      'A purchase AQR can only reference a GRN, not Transfer DC',
    ]);
    const both = validateAqrSourceRef({ aqrFor: 'transfer', deliveryChallanNo: { id: DC_ID }, grnNo: { id: GRN_ID }, rbcNo: { id: RBC_ID } });
    expect(both.errors).toEqual(['A transfer AQR can only reference a Transfer DC, not GRN or Return By Customer']);
    expect(both.source).toBeNull();
    expect(validateAqrSourceRef({ aqrFor: 'returned-by-customer', rbcNo: { id: RBC_ID }, grnNo: { id: GRN_ID } }).errors).toEqual([
      'A return-by-customer AQR can only reference a Return By Customer, not GRN',
    ]);
  });

  it('treats an empty reference object as absent', () => {
    expect(validateAqrSourceRef({ aqrFor: 'purchase', grnNo: { id: GRN_ID }, rbcNo: { id: '' }, deliveryChallanNo: null }).errors).toEqual([]);
  });
});

describe('validateAqrLines — complete-or-nothing', () => {
  it('accepts well-formed lines with and without a variant', () => {
    expect(validateAqrLines(goodLines())).toEqual([]);
  });

  it('accepts numeric strings and an empty parameter list', () => {
    expect(validateAqrLines([{ product: { id: ONION }, arrivedQty: '500', samplingQty: '50.5', parameters: [] }])).toEqual([]);
    expect(validateAqrLines([{ product: { id: ONION }, arrivedQty: 0, samplingQty: 0 }])).toEqual([]);
  });

  it('requires at least one line', () => {
    expect(validateAqrLines([])).toEqual(['Add one product line per product of the source']);
    expect(validateAqrLines(undefined)).toEqual(['Add one product line per product of the source']);
    expect(validateAqrLines(null)).toEqual(['Add one product line per product of the source']);
  });

  it('requires a product on every line', () => {
    expect(validateAqrLines([{ arrivedQty: 10, samplingQty: 1 }])).toEqual(['Product line 1: product is required']);
    expect(validateAqrLines([{ product: { id: '' }, arrivedQty: 10, samplingQty: 1 }])).toEqual(['Product line 1: product is required']);
  });

  it('requires numeric arrived and sampling quantities of 0 or more', () => {
    expect(validateAqrLines([{ product: { id: TOMATO } }])).toEqual([
      'Product line 1: arrived quantity is required',
      'Product line 1: sampling quantity is required',
    ]);
    expect(validateAqrLines([{ product: { id: TOMATO }, arrivedQty: -1, samplingQty: 'ten' }])).toEqual([
      'Product line 1: arrived quantity must be a number of 0 or more',
      'Product line 1: sampling quantity must be a number of 0 or more',
    ]);
  });

  it('rejects a sample larger than the arrival', () => {
    expect(validateAqrLines([{ product: { id: TOMATO }, arrivedQty: 100, samplingQty: 101 }])).toEqual([
      'Product line 1: sampling quantity (101) cannot exceed arrived quantity (100)',
    ]);
    expect(validateAqrLines([{ product: { id: TOMATO }, arrivedQty: 100, samplingQty: 100 }])).toEqual([]);
  });

  it('does not report the sample-vs-arrival rule when the arrival itself is invalid', () => {
    expect(validateAqrLines([{ product: { id: TOMATO }, arrivedQty: 'x', samplingQty: 5 }])).toEqual([
      'Product line 1: arrived quantity must be a number of 0 or more',
    ]);
  });

  it('checks optional totals when present', () => {
    expect(validateAqrLines([{ product: { id: TOMATO }, arrivedQty: 10, samplingQty: 1, totalQty: 'n/a', totalpercent: 'all' }])).toEqual([
      'Product line 1: total quantity must be a number',
      'Product line 1: total percent must be a number',
    ]);
    expect(validateAqrLines([{ product: { id: TOMATO }, arrivedQty: 10, samplingQty: 1, totalQty: null, totalpercent: undefined }])).toEqual([]);
  });

  it('rejects the same product + variant on two lines, but allows the same product under different variants', () => {
    expect(validateAqrLines([
      { product: { id: TOMATO }, variant: { id: GRADE_A }, arrivedQty: 10, samplingQty: 1 },
      { product: { id: TOMATO }, variant: { id: GRADE_A }, arrivedQty: 10, samplingQty: 1 },
    ])).toEqual(['Product line 2: repeats the product of line 1']);
    expect(validateAqrLines([
      { product: { id: TOMATO }, variant: { id: GRADE_A }, arrivedQty: 10, samplingQty: 1 },
      { product: { id: TOMATO }, variant: null, arrivedQty: 10, samplingQty: 1 },
    ])).toEqual([]);
  });

  it('requires every parameter to have an id, a name, a known type and a numeric quantity of 0 or more', () => {
    const errors = validateAqrLines([{
      product: { id: TOMATO },
      arrivedQty: 100,
      samplingQty: 10,
      parameters: [
        firmness(undefined),
        firmness(-2),
        firmness('many'),
        { qualityParameterId: '', qualityParameterName: '', qualityParameterType: 'excellent', quantity: 1 },
        { ...firmness(1), percentage: 'x' },
      ],
    }]);
    expect(errors).toEqual([
      'Product line 1: parameter "Firmness" quantity is required',
      'Product line 1: parameter "Firmness" quantity must be a number of 0 or more',
      'Product line 1: parameter "Firmness" quantity must be a number of 0 or more',
      'Product line 1: parameter 4 has no name',
      'Product line 1: parameter 4 has no quality parameter id',
      'Product line 1: parameter 4 type must be good, bad or average',
      'Product line 1: parameter "Firmness" percentage must be a number',
    ]);
  });

  it('accepts a parameter quantity of 0 and a missing percentage', () => {
    expect(validateAqrLines([{ product: { id: TOMATO }, arrivedQty: 100, samplingQty: 10, parameters: [{ ...firmness(0), percentage: null }] }])).toEqual([]);
  });

  it('rejects a parameters value that is not a list', () => {
    expect(validateAqrLines([{ product: { id: TOMATO }, arrivedQty: 100, samplingQty: 10, parameters: {} as unknown as [] }])).toEqual([
      'Product line 1: parameters must be a list',
    ]);
  });

  it('collects the problems of every line instead of stopping at the first', () => {
    const errors = validateAqrLines([
      { product: { id: TOMATO }, arrivedQty: 100, samplingQty: 200 },
      { arrivedQty: 'x', samplingQty: 1 },
      { product: { id: ONION }, arrivedQty: 5, samplingQty: 1, parameters: [firmness(null)] },
    ]);
    expect(errors).toEqual([
      'Product line 1: sampling quantity (200) cannot exceed arrived quantity (100)',
      'Product line 2: product is required',
      'Product line 2: arrived quantity must be a number of 0 or more',
      'Product line 3: parameter "Firmness" quantity is required',
    ]);
  });
});

describe('validateAqrRequest — header and lines in one answer', () => {
  it('returns no errors and the resolved source for a complete request', () => {
    expect(validateAqrRequest({ aqrFor: 'purchase', grnNo: { id: GRN_ID } }, goodLines())).toEqual({
      errors: [],
      source: { sourceType: 'grn', sourceId: GRN_ID },
    });
  });

  it('lists header problems first, then line problems, and yields no source', () => {
    const result = validateAqrRequest(
      { aqrFor: 'purchase', rbcNo: { id: RBC_ID } },
      [{ product: { id: TOMATO }, arrivedQty: 10, samplingQty: 20 }],
    );
    expect(result.source).toBeNull();
    expect(result.errors).toEqual([
      'Select the GRN this AQR is for',
      'A purchase AQR can only reference a GRN, not Return By Customer',
      'Product line 1: sampling quantity (20) cannot exceed arrived quantity (10)',
    ]);
  });

  it('still reports the line problems when the header is fine (complete-or-nothing)', () => {
    const result = validateAqrRequest({ aqrFor: 'transfer', deliveryChallanNo: { id: DC_ID } }, []);
    expect(result.errors).toEqual(['Add one product line per product of the source']);
    // The header alone was valid, so the caller can still tell which source was named.
    expect(result.source).toEqual({ sourceType: 'stock-transfer-dc', sourceId: DC_ID });
  });
});
