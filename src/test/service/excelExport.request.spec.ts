/**
 * The request side of the document exports: the export builds exactly the list
 * options (and filters) the Get All endpoint builds, but for every row.
 */

import 'reflect-metadata';

import AppError from '../../utils/appError';
import { EXPORT_ALL_ROWS, buildExportListOptions } from '../../excel/export/exportRequest';
import { DocumentExportService } from '../../excel/export/documentExport.service';
import { applyDocumentListFilters } from '../../global/filters/documentListOptions';
import { PaginationOptions } from '../../utils/pagination';

describe('buildExportListOptions', () => {
  it('asks the list service for every row, whatever page and limit the request carries', () => {
    const options = buildExportListOptions({ page: '3', limit: '20' }, { documentType: 'grn' });
    expect(options.page).toBe(1);
    expect(options.limit).toBe(EXPORT_ALL_ROWS);
  });

  it('produces the same filter criteria as the Get All endpoint for the same query', () => {
    const query = {
      startDate: '2026-09-01',
      endDate: '2026-09-15',
      status: 'COMPLETE',
      vendorId: '0b7f7a2e-4f8c-4b8a-9d3a-0c1f2e3d4a5b',
      search: 'GRN-001',
      sort: 'grnNo:DESC',
      page: '1',
      limit: '20',
    };
    const listOptions: PaginationOptions = { page: 1, limit: 20, searchFields: ['grn.grnNo'], filters: {}, sort: query.sort, search: query.search };
    applyDocumentListFilters(listOptions, query, 'grn');

    const exportOptions = buildExportListOptions(query, { documentType: 'grn', searchFields: ['grn.grnNo'] });

    expect(exportOptions.documentFilters).toEqual(listOptions.documentFilters);
    expect(exportOptions.search).toBe(listOptions.search);
    expect(exportOptions.sort).toBe(listOptions.sort);
  });

  it('keeps the declared legacy filters only where the database does not already apply them', () => {
    const options = buildExportListOptions(
      { source: 'vendor', grnType: 'purchase' },
      { documentType: 'grn', filterKeys: ['source', 'grnType', 'unhandledLegacy'] },
    );
    expect(options.filters).toEqual({});
    expect(options.documentFilters?.criteria).toEqual({ source: ['vendor'], grnType: ['purchase'] });
  });

  it('sorts the same way as the list, including lists whose controller never passed sort on (Return to Vendor)', () => {
    const query = { sort: 'rtvNo:DESC' };
    const listOptions: PaginationOptions = { page: 1, limit: 10, search: undefined };
    applyDocumentListFilters(listOptions, query, 'return-to-vendor');
    const exportOptions = buildExportListOptions(query, { documentType: 'return-to-vendor', sort: false });
    expect(exportOptions.sort).toBe('rtvNo:DESC');
    expect(exportOptions.sort).toBe(listOptions.sort);
  });

  it('rejects invalid filters with the same 400 as the list', () => {
    expect(() => buildExportListOptions({ startDate: '2026-09-15', endDate: '2026-09-01' }, { documentType: 'grn' })).toThrow(AppError);
  });
});

describe('DocumentExportService.toRefs', () => {
  it('keeps the list order, drops rows without an id and duplicates', () => {
    const refs = DocumentExportService.toRefs([
      { id: 'b', documentId: 'doc-b' },
      { id: null, documentId: 'orphan' },
      { id: 'a', documentId: null },
      { id: 'b', documentId: 'doc-b' },
    ]);
    expect(refs).toEqual([
      { id: 'b', documentId: 'doc-b' },
      { id: 'a', documentId: null },
    ]);
  });

  it('keeps the same id for different record kinds apart', () => {
    const refs = DocumentExportService.toRefs([
      { id: 'x', documentId: 'd1', kind: 'multi-cash-voucher' },
      { id: 'x', documentId: 'd2', kind: 'labour-payment-voucher' },
    ]);
    expect(refs.map((r) => r.kind)).toEqual(['multi-cash-voucher', 'labour-payment-voucher']);
  });

  it('handles an empty or missing list', () => {
    expect(DocumentExportService.toRefs(undefined)).toEqual([]);
    expect(DocumentExportService.toRefs([])).toEqual([]);
  });
});
