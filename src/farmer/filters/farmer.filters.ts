/**
 * Filters for GET /farmer and GET /farmer/export/excel.
 *
 * Expressions use the aliases both queries join: `farmer`, `residensialAddress`
 * and `farmAddress`. City/state match either address.
 *
 * Crop filters run as one EXISTS over the farmer's crops, so `cropId` together
 * with a harvest range means "a crop of that product harvested in that range",
 * and the export still lists every crop of a matching farmer.
 */

import { commonMasterFilters, COMMON_MASTER_RANGES, MasterFilterDefinition } from '../../global/filters/masterDataFilter';
import { Crop } from '../entity/crop.entity';

export const FARMER_FILTERS: MasterFilterDefinition = {
  fields: [
    ...commonMasterFilters('farmer', {
      city: ['residensialAddress.city', 'farmAddress.city'],
      state: ['residensialAddress.state', 'farmAddress.state'],
    }),
    { param: 'cropId', kind: 'id', exprs: ['flt_crop.crop'], group: 'crop' },
    { param: 'harvestFrom', kind: 'dayFrom', columnType: 'date', exprs: ['flt_crop.expectedHarvestDate'], group: 'crop' },
    { param: 'harvestTo', kind: 'dayTo', columnType: 'date', exprs: ['flt_crop.expectedHarvestDate'], group: 'crop' },
  ],
  existsGroups: {
    crop: { entity: Crop, alias: 'flt_crop', link: 'flt_crop.farmer = farmer.id' },
  },
  ranges: [...COMMON_MASTER_RANGES, ['harvestFrom', 'harvestTo']],
};
