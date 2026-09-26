// // import { SelectQueryBuilder } from 'typeorm';

// export interface PaginationOptions {
//   page: number;
//   limit: number;
//   searchFields?: string[];
//   filters?: Record<string, any>;
//   sort?: string;
//   search?: string;
// }

// export const paginateQuery = async (
//   queryBuilder: SelectQueryBuilder<any>,
//   options: PaginationOptions
// ) => {
//   const { page, limit, searchFields = [], filters = {}, sort , search } = options;
//   //const { page, limit } = options;
// //console.log("options are ",options)
// //   // Apply search condition if `search` is provided
// if (search && searchFields.length > 0) {
//   const searchConditions = searchFields.map((field, index) => {
//     console.log(`${field} ILIKE :search${index}`)
//     return `farmer.${field} ILIKE :search${index}`; // Prefix 'farmer.' to field names
//   });

//   searchFields.forEach((_, index) => {
//     queryBuilder.setParameter(`search${index}`, `%${search}%`);
//   });

//   queryBuilder.andWhere(`(${searchConditions.join(' OR ')})`);
// }


// //   // Apply filters (example: status = 'active')
//   Object.entries(filters).forEach(([key, value]) => {
//     queryBuilder.andWhere(`${key} = :${key}`, { [key]: value });
//   });

//   // Apply sorting
  //  if (sort) {
  //    queryBuilder.orderBy(sort, 'DESC');
  //  }
    // // Ensure the sort column is valid
    // if (sort) {
    //   queryBuilder.orderBy(sort, 'DESC'); // Change 'ASC' to 'DESC' as needed
    // }

  // Apply pagination with skip and take
//   queryBuilder.skip((page - 1) * limit).take(limit);

//   // Get results and total count
//   const [data, total] = await queryBuilder.getManyAndCount();

//   return {
//     data,
//     meta: {
//       total,
//       page,
//       pages: Math.ceil(total / limit),
//     },
//   };
// };
// import { SelectQueryBuilder, ObjectLiteral } from 'typeorm';
// import { pagination } from 'typeorm-pagination';


// export interface PaginationOptions {
//   page: number;
//   limit: number;
//   searchFields?: string[];
//   filters?: { [key: string]: any };
//   sort?: { [key: string]: 'ASC' | 'DESC' };
//   search?: string;
// }

// export const paginateQuery = async <T extends ObjectLiteral>(
//   queryBuilder: SelectQueryBuilder<T>,
//   options: PaginationOptions
// ) => {
//   const { page, limit, searchFields = [], filters = {}, sort, search } = options;

//   // Apply search condition
//   if (search && searchFields.length > 0) {
//     const searchConditions = searchFields.map((field, index) => `${field} ILIKE :search${index}`);
//     searchFields.forEach((_, index) => {
//       queryBuilder.setParameter(`search${index}`, `%${search}%`);
//     });
//     queryBuilder.andWhere(`(${searchConditions.join(' OR ')})`);
//   }

//   // Apply filters
//   Object.keys(filters).forEach((key) => {
//     queryBuilder.andWhere(`${key} = :${key}`, { [key]: filters[key] });
//   });

//   // Apply sorting
//   if (sort) {
//     Object.keys(sort).forEach((key) => {
//       queryBuilder.addOrderBy(key, sort[key]);
//     });
//   }

//   // Apply pagination
//   const offset = (page - 1) * limit;
//   queryBuilder.skip(offset).take(limit);
//   // Execute query and get results
//   // Execute query and get results
//   const [items, total] = await queryBuilder.getManyAndCount();

//   return {
//     items,
//     total,
//     page,
//     limit,
//     totalPages: Math.ceil(total / limit),
//   };
// };


// // import { SelectQueryBuilder } from 'typeorm';
// // import { Paginator } from 'typeorm-pagination';

// /**
//  * Utility function to apply search, filter, sort, and pagination to a query.
//  * @param queryBuilder - TypeORM SelectQueryBuilder to apply the filters, search, etc.
//  * @param options - PaginationOptions containing search, filter, sort, and pagination settings.
//  */
// export function buildQuery(
//   queryBuilder: SelectQueryBuilder<any>,
//   options: PaginationOptions
// ) {
//   // // Apply filters if provided
//   // if (options.filters) {
//   //   for (const [field, value] of Object.entries(options.filters)) {
//   //     queryBuilder.andWhere(`entity.${field} = :${field}`, { [field]: value });
//   //   }
//   // }

//   // Apply filters
//   if (options.filters) {
// Object.keys(options.filters).forEach((key) => {
//   if (options.filters) {
//     queryBuilder.andWhere(`${queryBuilder.alias}.${key} = :${key}`, { [key]: options.filters[key] });
//   }
// });
//   }

//   // Apply search if provided
//   if (options.search) {
//     queryBuilder.andWhere('entity.name LIKE :search OR entity.description LIKE :search', {
//       search: `%${options.search}%`,
//     });
//   }

//   // Apply sorting if provided
//   if (options.sort) {
//     const sort = JSON.parse(options.sort as unknown as string); // Expected format like { createdAt: 'ASC' }
//     for (const [column, direction] of Object.entries(sort) as [string, string][]) {
//       queryBuilder.addOrderBy(`entity.${column}`, direction.toUpperCase() as 'ASC' | 'DESC');
//     }
//   }
  
//   const offset = (options.page - 1) * options.limit;
//   queryBuilder.skip(offset).take(options.limit);
//   return queryBuilder.getManyAndCount();
// }

 import { DataSource, EntityTarget, LessThanOrEqual, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { TYPES } from '../types';
import { AppDataSource } from './data-source';
import type { DocumentFilterInput } from '../global/filters/documentFilter.types';

export interface PaginationOptions {
  page?: number;
  limit?: number;
  searchFields?: string[]; // Fields to search
  filters?: { [key: string]: any }; // Key-value filters
  sort?: string; // Expected format like { "createdAt": "ASC" }
  search?: string; // Search query
  /** Validated document filters, applied in SQL by the shared document queries. */
  documentFilters?: DocumentFilterInput;
}

/**
 * Builds a query dynamically for any entity
 * @param queryBuilder - The TypeORM SelectQueryBuilder instance
 * @param options - PaginationOptions containing filters, search, sorting, and pagination
 * @param alias - The alias for the entity in the query
 */



const dataSource = AppDataSource; // Use your actual DataSource instance
export function applyNumericFilter<T extends ObjectLiteral>(
  queryBuilder: SelectQueryBuilder<T>,
  alias: string,
  field: string,
  value?: string | number,
) {
  if (value === undefined || value === null || value === '') return;

  const match = String(value).match(/^(<=|>=|<|>)?\s*(\d+(\.\d+)?)$/);
  if (!match) return;

  const operator = match[1] || '=';
  const numValue = parseFloat(match[2]);

  // Use unique parameter name in case multiple numeric filters are applied
 // const paramName = `${field.replace(/\./g, '_')}_${Math.floor(Math.random() * 10000)}`;

  queryBuilder.andWhere(`${alias}.${field} ${operator} :${field}`, {
    [field]: numValue,
  });



// queryBuilder.andWhere(`${alias}.${field} ${operator} :${paramName}`, {
//     [paramName]: numValue,
//   });
}


export async function buildQueryFromArray<T>(
  dataArray: T[],
  options: PaginationOptions
) {
  const { search, searchFields = [], filters = {}, sort, page, limit } = options;

  let results = [...dataArray];

  // Search
  if (search && searchFields.length > 0) {
    const term = search.toLowerCase();
    results = results.filter(item =>
      searchFields.some(field =>
        String((item as any)[field] ?? '').toLowerCase().includes(term)
      )
    );
  }

  // Filters
  for (const [field, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) {
      results = results.filter(item => (item as any)[field] === value);
    }
  }

  // Sorting (supports nested keys like "location.name")
  if (sort) {
    const getValueByPath = (obj: any, path: string) =>
      path.split('.').reduce((acc: any, key: string) => (acc == null ? acc : acc[key]), obj);

    const sortFields = sort.split(',');
    results.sort((a, b) => {
      for (const raw of sortFields) {
        const [fieldRaw, dirRaw] = raw.split(':');
        const field = fieldRaw.trim();
        const direction = (dirRaw?.toLowerCase() === 'desc') ? -1 : 1;

        const aVal = getValueByPath(a as any, field);
        const bVal = getValueByPath(b as any, field);

        // Nullish handling: push null/undefined to the end
        const aNull = aVal == null;
        const bNull = bVal == null;
        if (aNull && bNull) continue;
        if (aNull) return 1;
        if (bNull) return -1;

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          if (aVal > bVal) return direction;
          if (aVal < bVal) return -direction;
          continue;
        }
        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();
        if (aStr > bStr) return direction;
        if (aStr < bStr) return -direction;
      }
      return 0;
    });
  }

  // Pagination
  const total = results.length;
  if (page && limit) {
    const offset = (page - 1) * limit;
    results = results.slice(offset, offset + limit);
  }

  return {
    data: results,
    meta: {
      total,
      page: page || 1,
      pages: limit ? Math.ceil(total / limit) : 1
    }
  };
}

// export async function buildQuery<T extends ObjectLiteral>(
//   queryBuilder: SelectQueryBuilder<T>,
//   options: PaginationOptions,
//   alias: string
// ) {
//   const { search, 
//     //searchFields = []
//     filters = {}, sort, page, limit } = options;

 
  


//   // Apply filters if provided
//   for (const [field, value] of Object.entries(filters)) {
//     if (value !== undefined && value !== null) {
//       queryBuilder.andWhere(`${alias}.${field} = :${field}`, { [field]: value });
//     }
//   }

//  // Apply sorting if provided (supports nested alias paths like "location.name")
//  if (sort) {
//   try {
//     console.log("in sorting",sort)
//     const sortFields = sort.split(',');
//      queryBuilder.orderBy();
//     for (const raw of sortFields) {
//       const [fieldRaw, dirRaw] = raw.split(':');
//       const field = fieldRaw.trim();
//       console.log('feild is ',field)
//       const direction = (dirRaw?.toUpperCase() === 'DESC') ? 'DESC' : 'ASC';
//       // Allow only alphanumeric, underscore and dot to avoid SQL injection
//       console.log(direction)
//       if (!/^[a-zA-Z0-9_.]+$/.test(field)) {
//         throw new Error(`Invalid sort field: ${field}`);
//       }
//       const orderExpr = field.includes('.') ? field : `${alias}.${field}`;
//       console.log("order expr ",orderExpr)
//       queryBuilder.addOrderBy(orderExpr, direction as 'ASC' | 'DESC');
     
//     }
  
//   } catch (error) {
//     throw new Error('Invalid sort format. Expected comma-separated "field[:ASC|DESC]".');
//   }
//  }
// // if (page && limit) {
// //   const offset = (page - 1) * limit;
// //   console.log('Pagination:', { offset, limit }); // Debug
// //   queryBuilder.skip(offset).take(limit);
// // }

// //console.log(queryBuilder.getSql());


//  // Log final query
//  //Get results and total count
//  let [data, total] = await queryBuilder.getManyAndCount();


// // // Log each result
// // data.forEach((b: any) => {
// //   console.log(b.farmerfName);
// // });
//  const objectToString = (obj: any): string => {
//     if (obj == null) return '';
//     if (typeof obj === 'object') {
//       return Object.values(obj).map((v) => objectToString(v)).join(' ');
//     }
//     return String(obj);
//   };

//   if ( search&&  search.trim()) {
//     const term =  search.toLowerCase();
//   data =data.filter((item) =>
//       objectToString(item).toLowerCase().includes(term)
//     );
//   }

//   // In-memory pagination (if not using skip/take)
//   let paginatedData = data;
//   if (page && limit) {
//     const offset = (page - 1) * limit;
//     paginatedData = data.slice(offset, offset + limit);
//   }


//  return {
//   data:paginatedData,
//   meta: {
//     total,
//     page: page || 1, // Default to page 1 if pagination is not used
//     pages: page && limit ? Math.ceil(total / limit) : 1, // Default to 1 page if no pagination
//   },
// };
// //  console.log('Final SQL:', queryBuilder.getSql()); // Debug
// //   return queryBuilder;
// }



// export async function buildQuery<T extends ObjectLiteral>(
//   queryBuilder: SelectQueryBuilder<T>,
//   options: PaginationOptions,
//   alias: string
// ) {
//   const { search, filters = {}, sort, page, limit } = options;

//   // Apply filters
//   for (const [field, value] of Object.entries(filters)) {
//     if (value !== undefined && value !== null) {
//       queryBuilder.andWhere(`${alias}.${field} = :${field}`, { [field]: value });
//     }
//   }

//   // Apply sorting
//   if (sort) {
//     const sortFields = sort.split(',');
//     queryBuilder.orderBy();
//     for (const raw of sortFields) {
//       const [fieldRaw, dirRaw] = raw.split(':');
//       const field = fieldRaw.trim();
//       const direction = (dirRaw?.toUpperCase() === 'DESC') ? 'DESC' : 'ASC';
//       if (!/^[a-zA-Z0-9_.]+$/.test(field)) {
//         throw new Error(`Invalid sort field: ${field}`);
//       }
//       const orderExpr = field.includes('.') ? field : `${alias}.${field}`;
//       queryBuilder.addOrderBy(orderExpr, direction as 'ASC' | 'DESC');
//     }
//   }


//   // Execute query
//   let [data, total] = await queryBuilder.getManyAndCount();

//   // In-memory search (optional, better to move this to SQL if possible)
//   const objectToString = (obj: any): string => {
//     if (obj == null) return '';
//     if (typeof obj === 'object') {
//       return Object.values(obj).map((v) => objectToString(v)).join(' ');
//     }
//     return String(obj);
//   };

//   if (search && search.trim()) {
//     const term = search.toLowerCase();
//     data = data.filter((item) => objectToString(item).toLowerCase().includes(term));
//     total = data.length; // fix meta count
//   }

//     // Pagination at DB level
//   if (page && limit) {
//     const offset = (page - 1) * limit;
//     queryBuilder.skip(offset).take(limit);
//   }


//   return {
//     data,
//     meta: {
//       total,
//       page: page || 1,
//       pages: page && limit ? Math.ceil(total / limit) : 1,
//     },
//   };
// }

export async function buildQuery<T extends ObjectLiteral>(
  queryBuilder: SelectQueryBuilder<T>,
  options: PaginationOptions,
  alias: string
) {
  const { search, filters = {}, sort, page, limit } = options;

  // // Apply filters
  // for (const [field, value] of Object.entries(filters)) {
  //   if (value !== undefined && value !== null) {
  //     queryBuilder.andWhere(`${alias}.${field} = :${field}`, { [field]: value });
  //   }
  // }// Apply filters

  // Apply filters (supports nested fields + numeric comparisons)
for (const [field, value] of Object.entries(filters)) {
  if (value === undefined || value === null || value === '') continue;

  // Check for nested field (e.g., farmAddress.city)
  if (field.includes('.')) {
    const [relation, column] = field.split('.');

    // Handle numeric filter in nested relation
    if (typeof value === 'string' && /^[<>]=?\s*\d+(\.\d+)?$/.test(value)) {
      applyNumericFilter(queryBuilder, relation, column, value);
      continue;
    } else {
      queryBuilder.andWhere(`LOWER(${relation}.${column}) LIKE LOWER(:${relation}_${column})`, {
        [`${relation}_${column}`]: `%${value}%`,
      });
    }
  } else {
    // Handle numeric filter on top-level field
    if (typeof value === 'string' && /^[<>]=?\s*\d+(\.\d+)?$/.test(value)) {
      applyNumericFilter(queryBuilder, alias, field, value);
      continue;
    } else {
      queryBuilder.andWhere(`${alias}.${field} = :${field}`, { [field]: value });
    }
  }
}
  // Apply sorting
  if (sort) {
    const sortFields = sort.split(',');
    queryBuilder.orderBy();
    for (const raw of sortFields) {
      const [fieldRaw, dirRaw] = raw.split(':');
      const field = fieldRaw.trim();
      const direction = (dirRaw?.toUpperCase() === 'DESC') ? 'DESC' : 'ASC';
      if (!/^[a-zA-Z0-9_.]+$/.test(field)) {
        throw new Error(`Invalid sort field: ${field}`);
      }
      const orderExpr = field.includes('.') ? field : `${alias}.${field}`;
      queryBuilder.addOrderBy(orderExpr, direction as 'ASC' | 'DESC');
    }
  }

  // 👉 Fetch everything first (filters + sorting applied)
  let [data] = await queryBuilder.getManyAndCount();

  // In-memory search
  const objectToString = (obj: any): string => {
    if (obj == null) return '';
    if (typeof obj === 'object') {
      return Object.values(obj).map((v) => objectToString(v)).join(' ');
    }
    return String(obj);
  };

  if (search && search.trim()) {
    const term = search.toLowerCase();
    data = data.filter((item) => objectToString(item).toLowerCase().includes(term));
  }

  // ✅ Pagination after search
  let paginatedData = data;
  const total = data.length;

  if (page && limit) {
    const offset = (page - 1) * limit;
    paginatedData = data.slice(offset, offset + limit);
  }

  return {
    data: paginatedData,
    meta: {
      total,
      page: page ,
      pages: page && limit ? Math.ceil(total / limit) : 1,
    },
  };
}


// export async function buildQuery<T extends ObjectLiteral>(
//   queryBuilder: SelectQueryBuilder<T>,
//   options: PaginationOptions,
//   alias: string
// ) {
//   const { search, filters = {}, sort, page, limit } = options;

//   // Apply filters
//   for (const [field, value] of Object.entries(filters)) {
//     if (value !== undefined && value !== null) {
//       queryBuilder.andWhere(`${alias}.${field} = :${field}`, { [field]: value });
//     }
//   }

//   // Apply sorting
//   if (sort) {
//     const sortFields = sort.split(',');
//     queryBuilder.orderBy();
//     for (const raw of sortFields) {
//       const [fieldRaw, dirRaw] = raw.split(':');
//       const field = fieldRaw.trim();
//       const direction = (dirRaw?.toUpperCase() === 'DESC') ? 'DESC' : 'ASC';
//       if (!/^[a-zA-Z0-9_.]+$/.test(field)) {
//         throw new Error(`Invalid sort field: ${field}`);
//       }
//       const orderExpr = field.includes('.') ? field : `${alias}.${field}`;
//       queryBuilder.addOrderBy(orderExpr, direction as 'ASC' | 'DESC');
//     }
//   }

//   // 👉 Fetch everything first (filters + sorting applied)
//   let [data] = await queryBuilder.getManyAndCount();

//   // In-memory search
//   const objectToString = (obj: any): string => {
//     if (obj == null) return '';
//     if (obj instanceof Date) {
//       // Format Date to string (dd-MM-yyyy hh:mm A)
//       return dayjs(obj).format("DD-MM-YYYY hh:mm A");
//     }
//     if (typeof obj === 'string') {
//       // Also try parsing date strings like "2025-08-04T12:56:00Z"
//       const parsed = dayjs(obj);
//       if (parsed.isValid()) {
//         return obj + ' ' + parsed.format("DD-MM-YYYY hh:mm A");
//       }
//       return obj;
//     }
//     if (typeof obj === 'object') {
//       return Object.values(obj).map((v) => objectToString(v)).join(' ');
//     }
//     return String(obj);
//   };

//   if (search && search.trim()) {
//     const term = search.toLowerCase();
//     data = data.filter((item) => objectToString(item).toLowerCase().includes(term));
//   }

//   // ✅ Pagination after search
//   let paginatedData = data;
//   const total = data.length;

//   if (page && limit) {
//     const offset = (page - 1) * limit;
//     paginatedData = data.slice(offset, offset + limit);
//   }

//   return {
//     data: paginatedData,
//     meta: {
//       total,
//       page: page || 1,
//       pages: page && limit ? Math.ceil(total / limit) : 1,
//     },
//   };
// }