/**
 * The one place a document list request becomes list-service options.
 *
 * Every Get All endpoint and every Excel export of the same module call
 * `applyDocumentListFilters` with the same query string, so both produce exactly
 * the same filter criteria; the export merely asks for all rows instead of a page.
 */

import { ParsedQs } from 'qs';
import { PaginationOptions } from '../../utils/pagination';
import { parseDocumentFilters, supportedFilterParams } from './documentFilter.parser';

export function applyDocumentListFilters<T extends PaginationOptions>(options: T, query: ParsedQs, documentType: string): T {
  const input = parseDocumentFilters(query, documentType);
  options.documentFilters = input;

  // Search now runs in SQL, before pagination. The list services' in-memory search
  // ran after pagination (matching within one page only) and must not run as well,
  // or it would drop rows the database matched on fields the formatted row lacks.
  options.search = '';

  // Keep the in-memory sort in step with the database order.
  if (input.sort) options.sort = `${input.sort.key}:${input.sort.direction}`;

  // Filters the database now applies are removed from the legacy in-memory filters,
  // which compared them against fields the documents do not carry.
  if (options.filters) {
    const handled = supportedFilterParams(documentType);
    for (const key of Object.keys(options.filters)) {
      if (handled.has(key)) delete options.filters[key];
    }
  }

  return options;
}
