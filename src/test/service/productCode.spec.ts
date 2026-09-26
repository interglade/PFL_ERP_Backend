/**
 * Numbering rules for product codes.
 *
 * The series used to restart at PREFIX0001 for every product: the code was
 * generated from the upper-cased prefix while the record was saved with
 * whatever case the user typed, so the next lookup never matched. These tests
 * pin the rules that replaced it.
 */

import 'reflect-metadata';
import { ProductService } from '../../product/createproduct/service/product.service';

const next = (prefix: string, codes: (string | null | undefined)[]) =>
  ProductService.nextCodeInSeries(prefix, codes);

describe('product code numbering', () => {
  it('starts a new prefix at 0001', () => {
    expect(next('ONI', [])).toBe('ONI0001');
    expect(next('TOM', ['ONI0001', 'ONI0002'])).toBe('TOM0001');
  });

  it('continues an existing series', () => {
    // The reported bug: adding Red Onion under ONI must give ONI0002.
    expect(next('ONI', ['ONI0001'])).toBe('ONI0002');
    expect(next('ONI', ['ONI0001', 'ONI0002', 'ONI0003'])).toBe('ONI0004');
  });

  it('ignores the case the prefix was typed in', () => {
    // "oni" must continue the ONI series rather than starting its own.
    expect(next('oni', ['ONI0001'])).toBe('ONI0002');
    expect(next('ONI', ['oni0001'])).toBe('ONI0002');
    expect(next(' Oni ', ['ONI0007'])).toBe('ONI0008');
  });

  it('takes the highest number, not the last one in the list', () => {
    expect(next('ONI', ['ONI0003', 'ONI0001', 'ONI0002'])).toBe('ONI0004');
  });

  it('counts numerically, so the series survives past 9999', () => {
    // Sorting codes as text puts ONI10000 below ONI9999 and would reissue it.
    expect(next('ONI', ['ONI9999'])).toBe('ONI10000');
    expect(next('ONI', ['ONI9999', 'ONI10000'])).toBe('ONI10001');
  });

  it('does not let a longer prefix pollute a shorter one', () => {
    // ONION0007 starts with "ONI" but belongs to a different series.
    expect(next('ONI', ['ONION0007'])).toBe('ONI0001');
    expect(next('ONI', ['ONI0002', 'ONION0009'])).toBe('ONI0003');
    expect(next('ONION', ['ONI0002', 'ONION0009'])).toBe('ONION0010');
  });

  it('gives a shortened prefix its own series', () => {
    // Editing a product from prefix ONI to ON: ONI0001 is not part of the ON
    // series, so the new code starts at ON0001 rather than continuing at 0002.
    expect(next('ON', ['ONI0001', 'ONI0002'])).toBe('ON0001');
    expect(next('ON', ['ONI0001', 'ON0001'])).toBe('ON0002');
  });

  it('skips codes that are blank or not in the series format', () => {
    expect(next('ONI', [null, undefined, '', '   ', 'ONI', 'ONI-01', 'ONIABC'])).toBe(
      'ONI0001',
    );
    expect(next('ONI', [null, 'ONI0004', 'junk'])).toBe('ONI0005');
  });

  it('tolerates stray whitespace around a stored code', () => {
    expect(next('ONI', [' ONI0005 '])).toBe('ONI0006');
  });

  it('treats regex characters in a prefix literally', () => {
    // A prefix like "A+B" must not be compiled as a quantifier.
    expect(next('A+B', ['A+B0002'])).toBe('A+B0003');
    expect(next('A+B', ['AAB0002'])).toBe('A+B0001');
  });
});
