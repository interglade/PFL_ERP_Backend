/**
 * Turns an export request's query string into the options a module's list
 * service expects.
 *
 * An export must contain exactly what the list shows for the same filters - just
 * not cut into pages. So the export builds the same `PaginationOptions` the list
 * endpoint builds and runs them through the same `applyDocumentListFilters`; the
 * only difference is that it asks for every row.
 */

import { ParsedQs } from 'qs';
import { PaginationOptions } from '../../utils/pagination';
import { applyDocumentListFilters } from '../../global/filters/documentListOptions';

/**
 * "All rows" for list services that apply a default page size when none is given
 * (GRN slices to 10, Final Invoice runs `LIMIT 10`, the double-approver lists take 10).
 * Services that only paginate when both page and limit are set treat page 1 of this
 * size as everything too. Any `page` / `limit` on the request is ignored.
 */
export const EXPORT_ALL_ROWS = Number.MAX_SAFE_INTEGER;

export interface ExportListConfig {
  /** Document type whose filter definition applies (`documents.type`). */
  documentType: string;
  /** Same `searchFields` the list endpoint passes. */
  searchFields?: string[];
  /** Query parameters the list endpoint copies into `filters` when present. */
  filterKeys?: string[];
  /** False for list endpoints that do not accept `sort`. */
  sort?: boolean;
}

function firstString(value: ParsedQs[string]): string | undefined {
  if (Array.isArray(value)) return firstString(value[0] as ParsedQs[string]);
  return typeof value === 'string' ? value : undefined;
}

export function buildExportListOptions(query: ParsedQs, config: ExportListConfig): PaginationOptions {
  const filters: Record<string, string> = {};
  for (const key of config.filterKeys ?? []) {
    const value = firstString(query[key]);
    if (value) filters[key] = value;
  }

  const options: PaginationOptions = {
    page: 1,
    limit: EXPORT_ALL_ROWS,
    filters,
    search: firstString(query.search) || '',
  };
  if (config.searchFields) options.searchFields = config.searchFields;
  if (config.sort !== false) options.sort = firstString(query.sort) || undefined;

  // The same filter step every Get All endpoint runs (validates, throws 400 on bad input).
  return applyDocumentListFilters(options, query, config.documentType);
}
