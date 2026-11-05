import { normaliseUomKey } from '../../scripts/dedupeUoms';

describe('dedupeUoms — normaliseUomKey', () => {
  it.each([
    ['KG', 'kg'], ['Kg', 'kg'], ['kgs', 'kg'], ['Kgs.', 'kg'], [' K.G. ', 'kg'], ['Kilogram', 'kg'], ['kilos', 'kg'],
    ['No', 'nos'], ['NOS', 'nos'], ['Nos.', 'nos'], ['Numbers', 'nos'], ['PCS', 'nos'], ['Piece', 'nos'], ['pieces', 'nos'],
    ['Box', 'box'], ['BOXES', 'box'],
    ['Crate', 'crate'], ['crates', 'crate'],
    ['Bundle', 'bundle'], ['Bundles', 'bundle'],
    ['Dozen', 'dozen'], ['DZ', 'dozen'],
    ['Ltrs', 'ltr'], ['Bags', 'bag'],
  ])('%s -> %s', (raw, key) => {
    expect(normaliseUomKey(raw)).toBe(key);
  });

  it('only strips a trailing s when the stem keeps at least 2 chars', () => {
    expect(normaliseUomKey('Ms')).toBe('ms');
    expect(normaliseUomKey('Gms')).toBe('gm');
  });

  it('returns an empty key for blank input', () => {
    expect(normaliseUomKey('  ')).toBe('');
    expect(normaliseUomKey(null)).toBe('');
  });
});
