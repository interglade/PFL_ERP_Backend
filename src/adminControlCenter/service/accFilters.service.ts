import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { TYPES } from '../../types';
import { FiltersTab } from '../adminControlCenter.types';
import { PERIOD_OPTIONS } from './accShared.util';

@injectable()
export class AccFiltersService {
  constructor(@inject(TYPES.DataSource) private readonly dataSource: DataSource) {}

  /**
   * Location and company dropdowns. Branches and companies have no active
   * flag, so "active" means not deleted.
   */
  async getFilters(): Promise<FiltersTab> {
    const [locations, companies] = await Promise.all([
      this.dataSource.query(
        `SELECT id::text AS value, name AS label FROM branches
          WHERE "isDeleted" = false AND name IS NOT NULL ORDER BY name`,
      ),
      this.dataSource.query(
        `SELECT id::text AS value, name AS label FROM company
          WHERE "isDeleted" = false AND name IS NOT NULL ORDER BY name`,
      ),
    ]);

    return {
      periods: PERIOD_OPTIONS,
      locations: [{ value: 'all', label: 'All Locations' }, ...locations],
      companies: [{ value: 'all', label: 'All Companies' }, ...companies],
    };
  }
}
