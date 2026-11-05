/**
 * Walk-in customer details (Other DC and Second Sale): customer type, PAN, billing / shipping address in six columns,
 * "same as billing" and place of supply.
 */

import 'reflect-metadata';
import { EntityManager } from 'typeorm';
import { Address } from '../../address/entity/address.entity';
import { resolveWalkInCustomer, splitWalkInCustomer, toBool } from '../../global/walkInCustomer/walkInCustomer';

const BILLING = { address1: '12 Market Rd', address2: '', location: 'Naroda', city: 'Ahmedabad', state: 'Gujarat', pincode: '382330' };
const SHIPPING = { address1: 'Plot 4', city: 'Mumbai', state: 'Maharashtra', pincode: '400703' };

/** A manager that "saves" addresses with ids a1, a2, … */
const fakeManager = () => {
  const saved: Record<string, unknown>[] = [];
  const manager = {
    create: jest.fn((_entity: unknown, values: Record<string, unknown>) => ({ ...values })),
    save: jest.fn(async (row: Record<string, unknown>) => {
      const withId = { ...row, id: `a${saved.length + 1}` };
      saved.push(withId);
      return withId;
    }),
    findOne: jest.fn(async () => ({ id: 'existing', state: 'Rajasthan' })),
  } as unknown as EntityManager;
  return { manager, saved };
};

describe('Other DC customer details', () => {
  it('stores the billing address in its six columns and ships to it by default', async () => {
    const { manager, saved } = fakeManager();
    const result = await resolveWalkInCustomer(manager, { billingAddress: BILLING, customerPanNo: 'abcde1234f' });
    expect(saved).toEqual([{ ...BILLING, address2: null, id: 'a1' }]);
    expect(result).toMatchObject({
      customerType: 'individual',
      customerPanNo: 'ABCDE1234F',
      billingAddress: { id: 'a1' },
      shipToSameAsBilling: true,
      shippingAddress: null,
      placeOfSupply: 'Gujarat',
    });
  });

  it('saves a separate shipping address and takes the place of supply from it', async () => {
    const { manager } = fakeManager();
    const result = await resolveWalkInCustomer(manager, {
      customerType: 'Business', billingAddress: BILLING, shipToSameAsBilling: 'false', shippingAddress: SHIPPING,
    });
    expect(result).toMatchObject({
      customerType: 'business', shipToSameAsBilling: false, shippingAddress: { id: 'a2' }, placeOfSupply: 'Maharashtra',
    });
  });

  it('keeps a place of supply that was entered', async () => {
    const { manager } = fakeManager();
    const result = await resolveWalkInCustomer(manager, { billingAddress: BILLING, placeOfSupply: 'Rajasthan' });
    expect(result.placeOfSupply).toBe('Rajasthan');
  });

  it('refuses a missing shipping address, a bad PAN and an unknown customer type', async () => {
    const { manager } = fakeManager();
    await expect(resolveWalkInCustomer(manager, { billingAddress: BILLING, shipToSameAsBilling: false })).rejects.toThrow(/shipping address/);
    await expect(resolveWalkInCustomer(manager, { customerPanNo: 'ABC123' })).rejects.toThrow(/PAN/);
    await expect(resolveWalkInCustomer(manager, { customerType: 'company' })).rejects.toThrow(/Individual or Business/);
  });

  it('on update keeps an unchanged address row and writes a changed one to a new row', async () => {
    const { manager, saved } = fakeManager();
    const current = { id: 'b1', ...BILLING, address2: null } as unknown as Address;
    const unchanged = await resolveWalkInCustomer(manager, { billingAddress: BILLING }, { billingAddress: current });
    expect(unchanged.billingAddress).toEqual({ id: 'b1' });
    expect(saved).toHaveLength(0);

    const changed = await resolveWalkInCustomer(manager, { billingAddress: { ...BILLING, pincode: '380015' } }, { billingAddress: current });
    expect(changed.billingAddress).toEqual({ id: 'a1' });
  });

  it('on update leaves the addresses alone when they are not sent', async () => {
    const { manager, saved } = fakeManager();
    const billing = { id: 'b1', ...BILLING } as unknown as Address;
    const shipping = { id: 's1', ...SHIPPING } as unknown as Address;
    const result = await resolveWalkInCustomer(manager, {}, { billingAddress: billing, shippingAddress: shipping, shipToSameAsBilling: false });
    expect(saved).toHaveLength(0);
    expect(result).toMatchObject({ billingAddress: { id: 'b1' }, shippingAddress: { id: 's1' }, placeOfSupply: 'Maharashtra' });
  });

  it('splits an update body into customer fields and the rest', () => {
    const { customer, rest } = splitWalkInCustomer({ customerName: 'Ravi', billingAddress: BILLING, customerPanNo: null, remarks: 'x' });
    expect(rest).toEqual({ customerName: 'Ravi', remarks: 'x' });
    expect(customer).toMatchObject({ billingAddress: BILLING, customerPanNo: null });
    expect(Object.keys(customer)).toHaveLength(7);
  });

  it('reads multipart booleans', () => {
    expect(toBool('true', false)).toBe(true);
    expect(toBool('false', true)).toBe(false);
    expect(toBool(undefined, true)).toBe(true);
  });
});
