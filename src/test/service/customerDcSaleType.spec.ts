import 'reflect-metadata';
import { applyDirectSaleSource, directSaleEligibleSql, DirectSaleSource } from '../../deliveryChallans/customerDeliveryChllan/service/directSale';
import { CustomerDeliveryChallanService } from '../../deliveryChallans/customerDeliveryChllan/service/customerDeliveryChallan.service';

const source = (overrides: Partial<DirectSaleSource> = {}): DirectSaleSource => ({
  grnId: 'grn-1', grnNo: 'PIM-00003', companyId: 'co-1', companyName: 'Prime Fresh', fromLocationId: 'loc-1', fromLocationName: 'Bengaluru DC',
  dispatchId: 'vd-1', dispatchNo: 'VDP1', customerId: 'cus-1', customerName: 'Ashik & Co.',
  billingAddressId: 'addr-b', deliveryAddressId: 'addr-d', billingAddress: null, deliveryAddress: null,
  receivingPerson: 'Ramesh', rmn: 'RMN-7',
  lines: [], ...overrides,
});

describe('Customer DC sale from GRN: copied values', () => {
  it("overwrites company, From location, customer and registered addresses; keeps the user's shipping address, receiver and RMN", () => {
    const typed = { address1: 'Gate 2', address2: null, location: null, city: 'Kheda', state: 'Gujarat', pincode: '387001' };
    const data: Record<string, any> = {
      grnNo: 'grn-1', companyName: 'other-co', fromLocation: 'other-loc', customerName: 'other-cus',
      currentShippingAddress: typed, receiverName: 'Suresh', rmn: 'typed-rmn',
      billingDetails: { billingAddress: {} }, deliveryDetails: {}, deliveryChallanProducts: [{ unitPrice: 42 }],
    };
    applyDirectSaleSource(data, source());
    expect(data).toMatchObject({
      grnNo: 'grn-1', companyName: 'co-1', fromLocation: 'loc-1', customerName: 'cus-1', partyName: 'cus-1',
      billingAddress: { id: 'addr-b' }, deliveryAddress: { id: 'addr-d' },
      currentShippingAddress: typed, receiverName: 'Suresh', rmn: 'typed-rmn',
      deliveryChallanProducts: [{ unitPrice: 42 }], // the user's selling price stays
    });
    expect(data).not.toHaveProperty('billingDetails');
    expect(data).not.toHaveProperty('deliveryDetails');
  });

  it('leaves From location empty when the GRN has no purchase for sales location', () => {
    const data: Record<string, any> = { fromLocation: 'typed-by-user' };
    applyDirectSaleSource(data, source({ fromLocationId: null }));
    expect(data.fromLocation).toBeNull();
  });

  it('lists only direct-to-customer, approved GRNs with an approved purchase dispatch and no live DC', () => {
    const sql = directSaleEligibleSql('g');
    expect(sql).toContain(`g."deliveryMode"::text = 'direct-to-customer'`);
    expect(sql).toContain(`= 'Complete'`);
    expect(sql).toContain(`apd."dispatchType"::text = 'purchase'`);
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM delivery_challan_purchase ldc');
    expect(directSaleEligibleSql('g', `'dc-1'`)).toContain(`'dc-1'::uuid`);
  });
});

describe('Customer DC sale type is fixed once created', () => {
  const service = (currentGrnId: string | null): any => {
    const s: any = Object.create(CustomerDeliveryChallanService.prototype);
    s.dataSource = {
      query: jest.fn().mockImplementation(async (sql: string) =>
        /FROM delivery_challan_purchase/.test(sql) ? [{ grn_id: currentGrnId }] : [{ mode: 'cc' }],
      ),
      manager: { query: jest.fn().mockResolvedValue([{ mode: 'cc' }]) },
    };
    return s;
  };

  it('refuses turning a sale from CC/DC into a sale from GRN', async () => {
    await expect(service(null).applySaleTypeOnUpdate('dc-1', { grnNo: 'grn-1' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'A sale from CC/DC cannot be turned into a sale from GRN; delete this DC and create a new one',
    });
  });

  it.each([['cleared', null], ['changed', 'grn-2']])('refuses a sale from GRN whose Referred GRN is %s', async (_label, grnNo) => {
    await expect(service('grn-1').applySaleTypeOnUpdate('dc-1', { grnNo })).rejects.toMatchObject({
      statusCode: 409,
      message: 'The Referred GRN of a sale from GRN cannot be changed or cleared; delete this DC and create a new one',
    });
  });

  it('lets a stock sale be edited without a Referred GRN, and leaves an older DC that refers to a CC/DC GRN alone', async () => {
    await expect(service(null).applySaleTypeOnUpdate('dc-1', { grnNo: '' })).resolves.toBeUndefined();
    await expect(service(null).applySaleTypeOnUpdate('dc-1', { remark: 'x' })).resolves.toBeUndefined();
    const legacy = { grnNo: 'grn-cc' };
    await expect(service('grn-cc').applySaleTypeOnUpdate('dc-1', legacy)).resolves.toBeUndefined();
    expect(legacy).toEqual({ grnNo: 'grn-cc' }); // nothing copied over
  });
});
