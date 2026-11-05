/**
 * Filters for GET /customer and GET /customer/export/excel.
 *
 * Expressions use the aliases both queries join: `customer` and `customerAddress`.
 */

import { COMMON_MASTER_RANGES, commonMasterFilters, MasterFilterDefinition } from '../../../global/filters/masterDataFilter';

export const CUSTOMER_FILTERS: MasterFilterDefinition = {
  fields: [
    ...commonMasterFilters('customer', {
      city: ['customerAddress.city'],
      state: ['customerAddress.state'],
    }),
    { param: 'customerCategoryId', kind: 'id', exprs: ['customer.customerCategory'] },
    { param: 'customerTypeId', kind: 'id', exprs: ['customer.customerTypes'] },
  ],
  ranges: COMMON_MASTER_RANGES,
};
