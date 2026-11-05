import {
  applyLabels,
  buildVariantCode,
  buildVariantName,
  capitaliseWords,
  cartesian,
  combinationKey,
  groupByAttribute,
  normaliseValueKey,
  parseVariantSetup,
  splitValueList,
  validateCombination,
} from '../../product/productVarient/service/variantSync';

/** docs/product-variant-plan.md §3-§5 - the rules behind variant generation. */

const attribute = (id: string, name: string, sortOrder: number, code: string | null = null) =>
  ({ id, name, sortOrder, code, isActive: true }) as any;

const ORIGIN = attribute('a-origin', 'Origin', 4, 'origin');
const SIZE = attribute('a-size', 'Size', 2, 'size');

const value = (id: string, text: string, attr: any) =>
  ({ id, value: text, valueKey: normaliseValueKey(text), isActive: true, attribute: attr }) as any;

const NZ = value('v-nz', 'New Zealand', ORIGIN);
const CHILE = value('v-cl', 'Chile', ORIGIN);
const S24 = value('v-24', '24', SIZE);
const S27 = value('v-27', '27', SIZE);
const S30 = value('v-30', '30', SIZE);
const S100 = value('v-100', '100', SIZE);

describe('splitValueList', () => {
  it('splits on commas, "&" and "and", trimming and collapsing spaces', () => {
    expect(splitValueList('40,50,60, 100 & Pittu')).toEqual(['40', '50', '60', '100', 'Pittu']);
    expect(splitValueList('Mehrun, Elaichi and  Sanam 5')).toEqual(['Mehrun', 'Elaichi', 'Sanam 5']);
  });

  it('drops repeats ignoring case, keeping the first spelling', () => {
    expect(splitValueList('Gola, Umran, umran , GOLA')).toEqual(['Gola', 'Umran']);
  });

  it('does not split words that merely contain "and"', () => {
    expect(splitValueList('Banarasi Karka, Sandy')).toEqual(['Banarasi Karka', 'Sandy']);
  });

  it('treats blanks and numbers sensibly', () => {
    expect(splitValueList(null)).toEqual([]);
    expect(splitValueList('  ')).toEqual([]);
    expect(splitValueList(10)).toEqual(['10']);
  });
});

describe('combinations', () => {
  it('is every pick of one value per attribute', () => {
    const groups = groupByAttribute([NZ, S100, S27, CHILE, S24]);
    // Size (sort 2) before Origin (sort 4); values in natural order.
    expect(groups.map((group) => group.map((v) => v.value))).toEqual([
      ['24', '27', '100'],
      ['Chile', 'New Zealand'],
    ]);
    expect(cartesian(groups)).toHaveLength(6);
  });

  it('gives nothing when there are no attributes', () => {
    expect(cartesian([])).toEqual([]);
  });

  it('keys a combination the same whatever the order of its values', () => {
    expect(combinationKey(['v-nz', 'v-24'])).toBe(combinationKey(['v-24', 'v-nz']));
  });
});

describe('validateCombination', () => {
  const allowed = new Map([NZ, CHILE, S24, S27].map((v) => [v.id, v]));

  it('accepts one allowed value per attribute', () => {
    expect(validateCombination(['v-nz', 'v-24'], allowed, 2)).toBeNull();
  });

  it('rejects a value the product does not allow', () => {
    expect(validateCombination(['v-nz', S30.id], allowed, 2)).toMatch(/not allowed/);
  });

  it('rejects two values of one attribute', () => {
    expect(validateCombination(['v-nz', 'v-cl'], allowed, 2)).toMatch(/more than one Origin/);
  });

  it('rejects a combination missing an attribute', () => {
    expect(validateCombination(['v-nz'], allowed, 2)).toMatch(/every attribute/);
  });
});

describe('capitaliseWords', () => {
  it('capitalises words without lowering anything', () => {
    expect(capitaliseWords('south africa')).toBe('South Africa');
    expect(capitaliseWords('New zealand')).toBe('New Zealand');
    expect(capitaliseWords('ZESPRI')).toBe('ZESPRI');
    expect(capitaliseWords('50-55mm')).toBe('50-55mm');
    expect(capitaliseWords('100+')).toBe('100+');
  });
});

describe('names and codes', () => {
  it('codes are the product code and a number, never attribute text', () => {
    expect(buildVariantCode('KIW0001', 1)).toBe('KIW0001-01');
    expect(buildVariantCode('KIW0001', 33)).toBe('KIW0001-33');
    expect(buildVariantCode('KIW0001', 120)).toBe('KIW0001-120');
  });

  it('names spell out each attribute', () => {
    expect(
      buildVariantName('Imported Green Kiwi', [
        { attribute: 'Origin', value: 'New Zealand' },
        { attribute: 'Size', value: '33' },
      ]),
    ).toBe('Imported Green Kiwi (Origin: New Zealand, Size: 33)');
  });

  it('labels fill the name and the legacy text columns in attribute order', () => {
    const variant: any = { values: [NZ, S24] };
    applyLabels(variant, 'Kiwi');
    expect(variant.variantName).toBe('Kiwi (Size: 24, Origin: New Zealand)');
    expect(variant.size).toBe('24');
    expect(variant.origin).toBe('New Zealand');
    expect(variant.count).toBeNull();
  });
});

describe('parseVariantSetup', () => {
  it('reads the JSON string the multipart form sends', () => {
    expect(
      parseVariantSetup('{"attributeValueIds":["a","b"],"combinations":[["a"],["b"]]}'),
    ).toEqual({ attributeValueIds: ['a', 'b'], combinations: [['a'], ['b']] });
  });

  it('treats a missing setup as "leave variants alone"', () => {
    expect(parseVariantSetup(undefined)).toBeNull();
    expect(parseVariantSetup('')).toBeNull();
  });

  it('leaves combinations undefined when not sent, meaning all of them', () => {
    expect(parseVariantSetup({ attributeValueIds: ['a'] })).toEqual({
      attributeValueIds: ['a'],
      combinations: undefined,
    });
  });

  it('rejects malformed JSON', () => {
    expect(() => parseVariantSetup('{oops')).toThrow(/valid JSON/);
  });
});
