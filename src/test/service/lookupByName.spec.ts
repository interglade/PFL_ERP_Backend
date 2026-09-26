/**
 * Name matching for lookup rows referenced from a spreadsheet.
 *
 * Categories, classifications, UOMs and types used to be matched exactly, so
 * "Fresh Produce" and "fresh produce" became two rows for the same thing. These
 * tests pin the rule that replaced it: two names are the same name when their
 * letters and digits are the same.
 */

import { normaliseName } from '../../excel/lookupByName';

const same = (a: string, b: string) => normaliseName(a) === normaliseName(b);

describe('lookup name matching', () => {
  it('treats the spellings of one category as the same name', () => {
    const spellings = [
      'fresh produce',
      'Fresh Produce',
      'Fresh produce',
      'FRESH PRODUCE',
      'Freshproduce',
      'freshproduce',
      'fresh-produce',
      'Fresh_Produce',
      '  Fresh   Produce  ',
      'Fresh.Produce',
    ];

    for (const spelling of spellings) {
      expect(`${spelling} -> ${normaliseName(spelling)}`).toBe(
        `${spelling} -> freshproduce`,
      );
    }
  });

  it('keeps genuinely different names apart', () => {
    expect(same('Fresh Produce', 'Frozen Produce')).toBe(false);
    expect(same('Fruit', 'Fruits')).toBe(false);
    expect(same('Grade A', 'Grade B')).toBe(false);
    expect(same('Onion', 'Onions')).toBe(false);
  });

  it('keeps digits, so numbered names stay distinct', () => {
    expect(normaliseName('Grade 1')).toBe('grade1');
    expect(same('Grade 1', 'Grade 2')).toBe(false);
    expect(same('Grade 1', 'grade-1')).toBe(true);
  });

  it('matches the units people type for a UOM', () => {
    expect(same('Kilogram', 'KILOGRAM')).toBe(true);
    expect(same('Metric Ton', 'metric-ton')).toBe(true);
    expect(same('Kg', 'Kilogram')).toBe(false); // an abbreviation is a different name
  });

  it('reduces a name with nothing but punctuation to an empty key', () => {
    // findByName refuses to match on an empty key, so "-" never collides with
    // "/" and both fall through to creating a row.
    expect(normaliseName('---')).toBe('');
    expect(normaliseName('   ')).toBe('');
  });
});
