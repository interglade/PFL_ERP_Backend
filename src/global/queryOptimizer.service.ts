import { injectable } from 'inversify';
import { ObjectLiteral, SelectQueryBuilder, Repository } from 'typeorm';

export interface OptimizedQueryOptions {
  select?: string[];
  relations?: string[];
  cache?: boolean | number;
  limit?: number;
  offset?: number;
}

@injectable()
export class QueryOptimizerService {
  
  /**
   * Optimize SELECT queries by only fetching required fields
   */
  optimizeSelect<T extends ObjectLiteral>(
    queryBuilder: SelectQueryBuilder<T>,
    options: OptimizedQueryOptions
  ): SelectQueryBuilder<T> {
    
    if (options.select && options.select.length > 0) {
      // Only select specified fields to reduce data transfer
      const alias = queryBuilder.alias;
      const selectFields = options.select.map(field => `${alias}.${field}`);
      queryBuilder.select(selectFields);
    }

    if (options.relations && options.relations.length > 0) {
      // Use leftJoinAndSelect for better performance than separate queries
      options.relations.forEach(relation => {
        queryBuilder.leftJoinAndSelect(`${queryBuilder.alias}.${relation}`, relation);
      });
    }

    if (options.cache) {
      const cacheTime = typeof options.cache === 'number' ? options.cache : 30000;
      queryBuilder.cache(cacheTime);
    }

    if (options.limit) {
      queryBuilder.limit(options.limit);
    }

    if (options.offset) {
      queryBuilder.offset(options.offset);
    }

    return queryBuilder;
  }

  /**
   * Create optimized pagination query
   */
  createPaginatedQuery<T extends ObjectLiteral>(
    repository: Repository<T>,
    page: number = 1,
    limit: number = 10,
    options: OptimizedQueryOptions = {}
  ): SelectQueryBuilder<T> {
    const queryBuilder = repository.createQueryBuilder(repository.metadata.tableName);
    
    const offset = (page - 1) * limit;
    
    return this.optimizeSelect(queryBuilder, {
      ...options,
      limit,
      offset
    });
  }

  /**
   * Batch process large datasets
   */
  async processBatch<T extends ObjectLiteral>(
    repository: Repository<T>,
    batchSize: number = 1000,
    processor: (batch: T[]) => Promise<void>
  ): Promise<void> {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await repository
        .createQueryBuilder()
        .limit(batchSize)
        .offset(offset)
        .getMany();

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      await processor(batch);
      offset += batchSize;
      
      if (batch.length < batchSize) {
        hasMore = false;
      }
    }
  }

  /**
   * Create efficient search query with full-text search
   */
  createSearchQuery<T extends ObjectLiteral>(
    repository: Repository<T>,
    searchTerm: string,
    searchFields: string[],
    options: OptimizedQueryOptions = {}
  ): SelectQueryBuilder<T> {
    const queryBuilder = repository.createQueryBuilder(repository.metadata.tableName);
    
    if (searchTerm && searchFields.length > 0) {
      const searchConditions = searchFields.map((field, index) => 
        `${queryBuilder.alias}.${field} ILIKE :search${index}`
      );
      
      queryBuilder.where(`(${searchConditions.join(' OR ')})`, 
        searchFields.reduce((params, field, index) => {
          params[`search${index}`] = `%${searchTerm}%`;
          return params;
        }, {} as any)
      );
    }

    return this.optimizeSelect(queryBuilder, options);
  }
}