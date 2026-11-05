/**
 * Transporter / Vehicle / Driver registration — the pure normalisation and
 * validation helpers (src/transport/transport.utils.ts).
 */

import 'reflect-metadata';

import {
  blankToNull,
  dateOrNull,
  EMAIL_REGEX,
  formatAddress,
  GSTIN_REGEX,
  IFSC_REGEX,
  isUniqueViolation,
  mapAddress,
  normalizePhone,
  normalizeVehicleNo,
  numberOrNull,
  PAN_REGEX,
  PHONE_REGEX,
  readAddress,
  upperOrNull,
  VEHICLE_NO_REGEX,
} from '../../transport/transport.utils';

describe('blankToNull / upperOrNull / numberOrNull', () => {
  it('turns blank-ish input into null', () => {
    expect(blankToNull(undefined)).toBeNull();
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull('   ')).toBeNull();
    expect(blankToNull('null')).toBeNull();
    expect(blankToNull('undefined')).toBeNull();
  });

  it('trims real values', () => {
    expect(blankToNull('  Raju Patil ')).toBe('Raju Patil');
    expect(blankToNull(42)).toBe('42');
  });

  it('upper-cases or returns null', () => {
    expect(upperOrNull(' abcde1234f ')).toBe('ABCDE1234F');
    expect(upperOrNull('')).toBeNull();
  });

  it('parses numbers and rejects garbage', () => {
    expect(numberOrNull('1500.5')).toBe(1500.5);
    expect(numberOrNull(0)).toBe(0);
    expect(numberOrNull('abc')).toBeNull();
    expect(numberOrNull('')).toBeNull();
  });
});

describe('normalizeVehicleNo', () => {
  it('strips spaces and dashes and upper-cases', () => {
    expect(normalizeVehicleNo('mh 12-ab 1234')).toBe('MH12AB1234');
    expect(normalizeVehicleNo(' MH15AB1234 ')).toBe('MH15AB1234');
  });

  it('returns null for blank input', () => {
    expect(normalizeVehicleNo('')).toBeNull();
    expect(normalizeVehicleNo(undefined)).toBeNull();
  });

  it('makes differently typed plates collide', () => {
    expect(normalizeVehicleNo('MH 12 AB 1234')).toBe(normalizeVehicleNo('mh-12-ab-1234'));
  });
});

describe('VEHICLE_NO_REGEX (on a normalized plate)', () => {
  it.each(['MH12AB1234', 'MH121234', 'KA05MN9876', 'DL1CAB1234', '22BH1234AA', 'MH12A1234'])('accepts %s', (plate) => {
    expect(VEHICLE_NO_REGEX.test(plate)).toBe(true);
  });

  it.each(['1234', 'MH', 'MH12AB12', 'MH12AB12345', 'ABCDEFGH', 'M12AB1234'])('rejects %s', (plate) => {
    expect(VEHICLE_NO_REGEX.test(plate)).toBe(false);
  });
});

describe('normalizePhone', () => {
  it('keeps the ten digits', () => {
    expect(normalizePhone('98765 43210')).toBe('9876543210');
    expect(normalizePhone('+91 98765-43210')).toBe('9876543210');
    expect(normalizePhone('09876543210')).toBe('9876543210');
  });

  it('returns null for blank input', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('format regexes', () => {
  it('PHONE_REGEX takes Indian mobiles only', () => {
    expect(PHONE_REGEX.test('9876543210')).toBe(true);
    expect(PHONE_REGEX.test('5876543210')).toBe(false);
    expect(PHONE_REGEX.test('987654321')).toBe(false);
  });

  it('EMAIL_REGEX', () => {
    expect(EMAIL_REGEX.test('a.b@c.in')).toBe(true);
    expect(EMAIL_REGEX.test('a.b@c')).toBe(false);
  });

  it('GSTIN / PAN / IFSC', () => {
    expect(GSTIN_REGEX.test('27AAPFU0939F1ZV')).toBe(true);
    expect(GSTIN_REGEX.test('27AAPFU0939F1Z')).toBe(false);
    expect(PAN_REGEX.test('ABCDE1234F')).toBe(true);
    expect(PAN_REGEX.test('ABCDE12345')).toBe(false);
    expect(IFSC_REGEX.test('SBIN0001234')).toBe(true);
    expect(IFSC_REGEX.test('SBIN1001234')).toBe(false);
  });
});

describe('dateOrNull', () => {
  it('accepts a day and trims a timestamp to it', () => {
    expect(dateOrNull('2027-03-31', 'Expiry')).toBe('2027-03-31');
    expect(dateOrNull('2027-03-31T00:00:00.000Z', 'Expiry')).toBe('2027-03-31');
  });

  it('returns null for blank and rejects garbage', () => {
    expect(dateOrNull('', 'Expiry')).toBeNull();
    expect(() => dateOrNull('31/03/2027', 'Expiry')).toThrow('Expiry must be a valid date');
  });
});

describe('addresses', () => {
  it('readAddress returns null when nothing meaningful was sent', () => {
    expect(readAddress(undefined)).toBeNull();
    expect(readAddress({ address1: '', city: ' ' })).toBeNull();
    expect(readAddress('not json')).toBeNull();
  });

  it('readAddress trims and nulls the blanks', () => {
    expect(readAddress({ address1: ' Gat 5 ', city: 'Nashik', state: 'Maharashtra', pincode: '422001', address2: '' })).toEqual({
      address1: 'Gat 5',
      address2: null,
      location: null,
      city: 'Nashik',
      state: 'Maharashtra',
      pincode: '422001',
    });
  });

  it('readAddress parses a JSON string (multipart-style bodies)', () => {
    expect(readAddress(JSON.stringify({ city: 'Pune' }))?.city).toBe('Pune');
  });

  it('mapAddress needs a saved row; formatAddress joins the parts', () => {
    expect(mapAddress(null)).toBeNull();
    expect(mapAddress({ address1: 'x' })).toBeNull();
    expect(mapAddress({ id: 'a1', address1: 'Gat 5', city: 'Nashik' })?.city).toBe('Nashik');
    expect(formatAddress({ address1: 'Gat 5', city: 'Nashik', pincode: '422001' })).toBe('Gat 5 Nashik 422001');
    expect(formatAddress(null)).toBe('');
  });
});

describe('isUniqueViolation', () => {
  it('recognises the Postgres code on a TypeORM error', () => {
    expect(isUniqueViolation({ driverError: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
  });
});
