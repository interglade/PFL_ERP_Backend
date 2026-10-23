/**
 * Filters for GET /transporters. Expressions use the aliases the list query joins:
 * `transporter`, `address` and `createdBy`.
 */

import { commonMasterFilters, COMMON_MASTER_RANGES, MasterFilterDefinition } from '../../global/filters/masterDataFilter';
import { TransporterType } from '../entity/transporter.entity';

export const TRANSPORTER_FILTERS: MasterFilterDefinition = {
  fields: [
    ...commonMasterFilters('transporter', {
      city: ['address.city'],
      state: ['address.state'],
    }),
    {
      param: 'transporterType',
      kind: 'enum',
      values: Object.values(TransporterType),
      exprs: ['transporter.transporterType'],
    },
  ],
  ranges: COMMON_MASTER_RANGES,
};
