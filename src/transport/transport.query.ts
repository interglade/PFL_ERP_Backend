import { Request } from 'express';
import { parseMasterFilters, MasterFilterDefinition } from '../global/filters/masterDataFilter';
import { PaginationOptions } from '../utils/pagination';
import AppError from '../utils/appError';

/** Pagination, sort, search and the module's declared filters from a list request's query string. */
export function readListOptions(req: Request, filters: MasterFilterDefinition): PaginationOptions {
  const { page, limit, search, sort } = req.query;
  return {
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
    filters: {},
    sort: (sort as string) || undefined,
    search: (search as string) || '',
    masterFilters: parseMasterFilters(req.query, filters),
  };
}

/** `ids` of a bulk-delete body, validated. */
export function readIds(req: Request): string[] {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
    throw new AppError(400, 'ids must be a non-empty array of record ids');
  }
  return ids;
}
