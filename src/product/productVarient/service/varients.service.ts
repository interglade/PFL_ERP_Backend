import { inject, injectable } from 'inversify';
import { TYPES } from '../../../types';
import { ProductVarientRepository } from '../repository/varients.repository';
import { buildQuery, PaginationOptions } from '../../../utils/pagination';
import logger from '../../../utils/logger';

/**
 * Read-only variant lookups. Variants are created and changed only through
 * their product - see variantSync.ts.
 */
@injectable()
export class ProductVarientsService {
  constructor(
    @inject(TYPES.ProductVarientRepository)
    private productVarientRepository: ProductVarientRepository,
  ) {}

  async getVarientsByIds(ids: string[]): Promise<any[]> {
    // Filter out empty strings, nulls, undefined — frontend may send ""
    const validIds = ids.filter((id) => id && id.trim() !== '');
    if (!validIds || validIds.length === 0) return [];

    return await this.productVarientRepository
      .createQueryBuilder('varient')
      .select(['varient.id', 'varient.variantName', 'varient.variantCode', 'varient.isActive'])
      .where('varient.id IN (:...ids)', { ids: validIds })
      .getMany();
  }

  async getAllByFilter(queryOptions: PaginationOptions): Promise<any> {
    try {
      const queryBuilder = this.productVarientRepository
        .createQueryBuilder('varient')
        .leftJoinAndSelect('varient.product', 'product')
        .select([
          'varient.id',
          'varient.variantName',
          'varient.variantCode',
          'varient.isActive',
          'varient.count',
          'varient.size',
          'varient.variety',
          'varient.origin',
          'varient.brand',
          'varient.createdAt',
          'product.id',
          'product.name',
        ]);

      return await buildQuery(queryBuilder, queryOptions, 'varient');
    } catch (error) {
      logger.error('Error fetching products:', error);
      throw new Error('Unable to fetch the products.');
    }
  }
}
