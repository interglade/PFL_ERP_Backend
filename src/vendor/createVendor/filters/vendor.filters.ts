/**
 * Filters for GET /vendor and GET /vendor/export/excel.
 *
 * Expressions use the aliases both queries join: `vendor` and `officeAddress`.
 */

import { COMMON_MASTER_RANGES, commonMasterFilters, MasterFilterDefinition } from '../../../global/filters/masterDataFilter';
import { VendorClassification } from '../entity/vendor.entity';

export const VENDOR_FILTERS: MasterFilterDefinition = {
  fields: [
    ...commonMasterFilters('vendor', {
      city: ['officeAddress.city'],
      state: ['officeAddress.state'],
    }),
    { param: 'categoryId', kind: 'id', exprs: ['vendor.category'] },
    { param: 'subcategoryId', kind: 'id', exprs: ['vendor.subcategory'] },
    { param: 'classification', kind: 'enum', values: Object.values(VendorClassification), exprs: ['vendor.classification'] },
  ],
  ranges: COMMON_MASTER_RANGES,
};
