/**
 * Filters for GET /drivers. Expressions use the aliases the list query joins:
 * `driver`, `address`, `transporter` and `createdBy`.
 */

import { commonMasterFilters, COMMON_MASTER_RANGES, MasterFilterDefinition } from '../../global/filters/masterDataFilter';

export const DRIVER_FILTERS: MasterFilterDefinition = {
  fields: [
    ...commonMasterFilters('driver', {
      city: ['address.city'],
      state: ['address.state'],
    }),
    { param: 'transporterId', kind: 'id', exprs: ['driver.transporter'] },
  ],
  ranges: COMMON_MASTER_RANGES,
};
