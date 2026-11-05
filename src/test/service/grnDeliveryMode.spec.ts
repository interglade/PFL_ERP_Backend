import { CENTRE_DELIVERY_MODES, GrnDeliveryMode } from '../../grn/entity/grn.entity';

describe('GRN delivery mode', () => {
  it('has the three modes, in the order the database enum is created', () => {
    expect(Object.values(GrnDeliveryMode)).toEqual(['cc', 'dc', 'direct-to-customer']);
  });

  it('receives cc and dc GRNs at a centre; direct-to-customer bypasses the centres', () => {
    expect(CENTRE_DELIVERY_MODES).toEqual([GrnDeliveryMode.CC, GrnDeliveryMode.DC]);
    expect(CENTRE_DELIVERY_MODES).not.toContain(GrnDeliveryMode.DIRECT_TO_CUSTOMER);
  });

  it('no longer has the combined cc-dc mode', () => {
    expect(Object.values(GrnDeliveryMode)).not.toContain('cc-dc');
  });
});
