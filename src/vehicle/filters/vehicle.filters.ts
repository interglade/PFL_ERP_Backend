/**
 * Filters for GET /vehicles. Expressions use the aliases the list query joins:
 * `vehicle`, `transporter` and `createdBy`. (No address filters: a vehicle has none.)
 */

import { COMMON_MASTER_RANGES, MasterFilterDefinition } from '../../global/filters/masterDataFilter';
import { Status } from '../../utils/status.enum';

export const VEHICLE_FILTERS: MasterFilterDefinition = {
  fields: [
    { param: 'status', kind: 'enum', values: Object.values(Status), exprs: ['vehicle.status'] },
    { param: 'createdFrom', aliases: ['startDate', 'dateFrom'], kind: 'dayFrom', exprs: ['vehicle.createdAt'] },
    { param: 'createdTo', aliases: ['endDate', 'dateTo'], kind: 'dayTo', exprs: ['vehicle.createdAt'] },
    { param: 'createdById', kind: 'id', exprs: ['vehicle.createdBy'] },
    { param: 'transporterId', kind: 'id', exprs: ['vehicle.transporter'] },
    { param: 'vehicleType', kind: 'text', exprs: ['vehicle.vehicleType'] },
  ],
  ranges: COMMON_MASTER_RANGES,
};
