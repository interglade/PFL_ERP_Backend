/**
 * The common document filters: validation, the SQL each filter produces, and how
 * list options are prepared for Get All and Export alike.
 *
 * SQL is generated against the real entity metadata without a database
 * connection, so every join path and column in every module definition is
 * checked to resolve.
 */

import 'reflect-metadata';
import { DataSource, SelectQueryBuilder } from 'typeorm';

import AppError from '../../utils/appError';
import { Documentb } from '../../approvalFlow/entity/docuemnt.entity';
import { Invoice } from '../../invoice/entity/invoice.entity';
import { allModuleFilterDefinitions, getModuleFilterDefinition } from '../../global/filters/documentFilter.definitions';
import {
  PRODUCT_FILTERS,
  hasFilterCriteria,
  parseDocumentFilters,
  supportedFilterParams,
} from '../../global/filters/documentFilter.parser';
import { applyDocumentFilters, likePattern, safeSqlSort } from '../../global/filters/documentFilter.query';
import { applyDocumentListFilters } from '../../global/filters/documentListOptions';
import { FieldFilter } from '../../global/filters/documentFilter.types';
import { PaginationOptions } from '../../utils/pagination';

const UUID_A = '0b7f7a2e-4f8c-4b8a-9d3a-0c1f2e3d4a5b';
const UUID_B = '1c8f8b3f-5a9d-4c9b-8e4b-1d2f3e4d5b6c';

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = new DataSource({ type: 'postgres', entities: ['src/**/*.entity{.ts,.js}'] });
  // Builds entity metadata only; no connection is opened.
  await (dataSource as any).buildMetadatas();
}, 120000);

function documentQuery(documentType: string): SelectQueryBuilder<Documentb> {
  return dataSource.getRepository(Documentb).createQueryBuilder('document').where('document.type = :type', { type: documentType });
}

function expectAppError(fn: () => unknown, message: RegExp) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(400);
    expect((error as AppError).message).toMatch(message);
    return;
  }
  throw new Error('expected a 400 AppError');
}

/** A valid sample value for every kind of filter. */
function sampleValue(field: FieldFilter): string {
  switch (field.kind) {
    case 'id':
      return UUID_A;
    case 'enum':
      return (field.values ?? [])[0];
    case 'boolean':
      return 'true';
    case 'min':
      return '1';
    case 'max':
      return '1000';
    case 'day':
      return '2026-09-10';
    case 'iexact':
      return 'Cash';
    default:
      return 'abc';
  }
}

describe('parseDocumentFilters', () => {
  it('applies nothing when no filter is given, and treats empty values as absent', () => {
    const input = parseDocumentFilters({ page: '2', limit: '20', status: '', search: '   ', unknownParam: 'x' }, 'grn');
    expect(hasFilterCriteria(input)).toBe(false);
  });

  it('accepts inclusive date ranges, including a single day, and the dateFrom/dateTo aliases', () => {
    expect(parseDocumentFilters({ startDate: '2026-09-15', endDate: '2026-09-15' }, 'grn').criteria).toEqual({
      startDate: '2026-09-15',
      endDate: '2026-09-15',
    });
    expect(parseDocumentFilters({ dateFrom: '2026-09-01', dateTo: '2026-09-02' }, 'grn').criteria).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-02',
    });
  });

  it('rejects bad dates and inverted ranges with 400', () => {
    expectAppError(() => parseDocumentFilters({ startDate: '15-09-2026' }, 'grn'), /Invalid startDate/);
    expectAppError(() => parseDocumentFilters({ endDate: '2026-02-30' }, 'grn'), /Invalid endDate/);
    expectAppError(() => parseDocumentFilters({ startDate: '2026-09-15', endDate: '2026-09-01' }, 'grn'), /startDate .* greater than endDate/);
    expectAppError(() => parseDocumentFilters({ approvalStartDate: '2026-09-15', approvalEndDate: '2026-09-01' }, 'grn'), /approvalStartDate/);
  });

  it('validates statuses against the existing enum, case-insensitively, as a comma-separated list', () => {
    expect(parseDocumentFilters({ status: 'complete, HOLD' }, 'grn').criteria.status).toEqual(['COMPLETE', 'hold']);
    expectAppError(() => parseDocumentFilters({ status: 'done' }, 'grn'), /Invalid status 'done'/);
  });

  it('validates ids, enums, booleans, numbers and number ranges', () => {
    expect(parseDocumentFilters({ vendorId: `${UUID_A},${UUID_B}` }, 'grn').criteria.vendorId).toEqual([UUID_A, UUID_B]);
    expectAppError(() => parseDocumentFilters({ vendorId: '123' }, 'grn'), /Invalid vendorId '123'/);
    expectAppError(() => parseDocumentFilters({ grnType: 'lease' }, 'grn'), /Invalid grnType/);
    expectAppError(() => parseDocumentFilters({ isReturned: 'maybe' }, 'DC_TYPE_CUSTOMER'), /Invalid isReturned/);
    expectAppError(() => parseDocumentFilters({ minAmount: 'ten' }, 'grn'), /Invalid minAmount/);
    expectAppError(() => parseDocumentFilters({ minAmount: '500', maxAmount: '100' }, 'grn'), /minAmount .* greater than maxAmount/);
  });

  it('maps warehouse aliases onto location filters', () => {
    expect(parseDocumentFilters({ warehouseId: UUID_A, warehouse: 'Pune' }, 'grn').criteria).toEqual({ locationId: [UUID_A], location: 'Pune' });
  });

  it('keeps the historic GRN companyName parameter working with an id or a name', () => {
    expect(parseDocumentFilters({ companyName: UUID_A }, 'grn').criteria.companyName).toEqual([UUID_A]);
    expect(parseDocumentFilters({ companyName: 'Prime Fresh' }, 'grn').criteria.companyName).toBe('Prime Fresh');
  });

  it('ignores filters a module does not have (a product filter on Vehicle Dispatch)', () => {
    expect(parseDocumentFilters({ productId: UUID_A }, 'vehicle-dispatch-register').criteria).toEqual({});
  });

  it('reads the existing sort convention and the sortBy/sortOrder aliases', () => {
    expect(parseDocumentFilters({ sort: 'grnNo:desc' }, 'grn').sort).toEqual({ key: 'grnNo', direction: 'DESC' });
    expect(parseDocumentFilters({ sortBy: 'grnNo' }, 'grn').sort).toEqual({ key: 'grnNo', direction: 'ASC' });
    expectAppError(() => parseDocumentFilters({ sort: 'grnNo:sideways' }, 'grn'), /Invalid sort order/);
  });
});

describe('every module definition produces valid SQL for every filter it offers', () => {
  const definitions = allModuleFilterDefinitions();

  it('covers all 18 document types', () => {
    expect(definitions.map((d) => d.documentType).sort()).toEqual(
      [
        'rfpa', 'deal-slip', 'grn', 'inward-register', 'aqr', 'dump-register', 'DC_TYPE_CUSTOMER', 'DC_TYPE_STOCK_TRANSFER',
        'DC_TYPE_OTHER', 'final-invoice', 'return-by-customer', 'return-to-vendor', 'second-sale', 'vehicle-dispatch-register',
        'multi-cash-voucher', 'labor-payment-voucher', 'transport-payment-voucher', 'packaging-material-voucher',
      ].sort(),
    );
  });

  it.each(definitions.map((d) => [d.module, d.documentType] as const))('%s', (_module, documentType) => {
    const def = getModuleFilterDefinition(documentType)!;
    const query: Record<string, string> = {
      startDate: '2026-09-01',
      endDate: '2026-09-15',
      status: 'COMPLETE',
      search: 'abc',
      documentNo: '001',
      createdById: UUID_A,
      createdBy: 'Asha',
      approvedById: UUID_B,
      approvedBy: 'Ravi',
      approvalStartDate: '2026-09-01',
      approvalEndDate: '2026-09-30',
    };
    for (const field of def.fields) query[field.param] = sampleValue(field);
    if (def.lineItems || def.headerProduct) {
      for (const f of PRODUCT_FILTERS) query[f.param] = f.kind === 'id' ? UUID_A : 'abc';
    }
    for (const f of def.lineItems?.textFields ?? []) query[f.param] = 'damaged';

    // Every declared parameter is recognised...
    const input = parseDocumentFilters(query, documentType);
    for (const param of Object.keys(query)) expect(input.criteria).toHaveProperty(param);

    // ...and every sortable key renders.
    for (const key of Object.keys(def.sortable)) {
      const sorted = documentQuery(documentType);
      expect(applyDocumentFilters(sorted, { documentType, criteria: {}, sort: { key, direction: 'DESC' } }, { documentAlias: 'document' })).toBe(true);
      expect(() => sorted.getQuery()).not.toThrow();
    }

    const qb = documentQuery(documentType);
    applyDocumentFilters(qb, input, { documentAlias: 'document' });
    const sql = qb.getQuery();
    expect(sql).toContain('flt_rec');
    // Line items are matched through EXISTS, never joined into the document query.
    expect(sql).not.toMatch(/FROM "documents" "document"[^(]*JOIN "(grn_products|item|rfpa_product|invoice_products)"/);
  });
});

describe('filter SQL semantics', () => {
  it('uses calendar-day strings for date columns and IST day boundaries for timestamps', () => {
    const dated = documentQuery('inward-register');
    applyDocumentFilters(dated, parseDocumentFilters({ startDate: '2026-09-01', endDate: '2026-09-15' }, 'inward-register'), { documentAlias: 'document' });
    const [datedSql, datedParams] = dated.getQueryAndParameters();
    expect(datedSql).toMatch(/"flt_rec"\."date" >= \$2 AND "flt_rec"\."date" <= \$3/);
    expect(datedParams.slice(1)).toEqual(['2026-09-01', '2026-09-15']);

    const stamped = documentQuery('grn');
    applyDocumentFilters(stamped, parseDocumentFilters({ startDate: '2026-09-01', endDate: '2026-09-15' }, 'grn'), { documentAlias: 'document' });
    const [, stampedParams] = stamped.getQueryAndParameters();
    // The whole end day is included: 23:59:59.999 IST.
    expect((stampedParams[1] as Date).toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect((stampedParams[2] as Date).toISOString()).toBe('2026-09-15T18:29:59.999Z');
  });

  it('combines filters with AND and resolves relation names through joins', () => {
    const qb = documentQuery('grn');
    applyDocumentFilters(qb, parseDocumentFilters({ status: 'COMPLETE', vendorName: 'Agro', locationId: UUID_B }, 'grn'), { documentAlias: 'document' });
    const sql = qb.getQuery();
    expect(sql).toMatch(/CAST\("document"\."status" AS TEXT\) IN \(:\.\.\.flt_p\d+\) AND \(CAST\("flt_vendor"\."company_name" AS TEXT\) ILIKE/);
    expect(sql).toContain('LEFT JOIN "vendor" "flt_vendor"');
  });

  it('matches id filters on the foreign key, so records referencing a soft-deleted row still match', () => {
    const qb = documentQuery('second-sale');
    applyDocumentFilters(qb, parseDocumentFilters({ locationId: UUID_A, createdById: UUID_B, productId: UUID_A }, 'second-sale'), {
      documentAlias: 'document',
    });
    const sql = qb.getQuery();
    expect(sql).toMatch(/\("flt_rec"\."branch_id" IN/);
    expect(sql).not.toContain('"flt_location"');
    expect(sql).toMatch(/"document"\."last_action_by" IN/);
    expect(sql).toMatch(/"flt_line"\."product_id" IN/);
  });

  it('matches a document once however many of its lines match a product filter', () => {
    const qb = documentQuery('grn');
    applyDocumentFilters(qb, parseDocumentFilters({ productId: UUID_A }, 'grn'), { documentAlias: 'document' });
    const sql = qb.getQuery();
    expect(sql.match(/EXISTS \(SELECT 1 FROM "grn_products"/g)).toHaveLength(1);
  });

  it('filters Deal Slip products through the linked RFPA lines', () => {
    const qb = documentQuery('deal-slip');
    applyDocumentFilters(qb, parseDocumentFilters({ productName: 'tomato' }, 'deal-slip'), { documentAlias: 'document' });
    expect(qb.getQuery()).toMatch(/EXISTS \(SELECT 1 FROM "rfpa_product" .* = "flt_rfpa"\."id"/);
  });

  it('filters the Final Invoice query on its own root alias without re-joining the invoice', () => {
    const qb = dataSource.getRepository(Invoice).createQueryBuilder('invoice').innerJoin(Documentb, 'doc', 'doc.document_type_id = invoice.id::text');
    applyDocumentFilters(qb, parseDocumentFilters({ paymentStatus: 'paid', customerId: UUID_A, startDate: '2026-09-01' }, 'final-invoice'), {
      documentAlias: 'doc',
      recordAlias: 'invoice',
    });
    const sql = qb.getQuery();
    expect(sql).not.toContain('flt_rec');
    expect(sql).toMatch(/CAST\("invoice"\."ammountStatus" AS TEXT\) IN/);
    expect(sql).toMatch(/"invoice"\."invoiceDate" >=/);
  });

  it('matches LIKE wildcards in user input literally', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });

  it('never lets an unknown sort key reach ORDER BY', () => {
    const qb = documentQuery('grn');
    expect(applyDocumentFilters(qb, { documentType: 'grn', criteria: {}, sort: { key: 'grnNo; DROP TABLE grns', direction: 'ASC' } }, { documentAlias: 'document' })).toBe(false);
    expect(qb.getQuery()).not.toContain('ORDER BY');
  });

  it('safeSqlSort only allows alias.column on the listed aliases', () => {
    const fallback: [string, 'ASC' | 'DESC'] = ['document.createdAt', 'DESC'];
    expect(safeSqlSort('document.status:ASC', ['document'], fallback)).toEqual(['document.status', 'ASC']);
    expect(safeSqlSort('rfpaId:ASC', ['document'], fallback)).toEqual(fallback);
    expect(safeSqlSort('document.id; DELETE FROM documents', ['document'], fallback)).toEqual(fallback);
    expect(safeSqlSort('users.password:ASC', ['document'], fallback)).toEqual(fallback);
    expect(safeSqlSort(undefined, ['document'], fallback)).toEqual(fallback);
  });
});

describe('applyDocumentListFilters', () => {
  it('moves search into SQL, keeps pagination and aligns the in-memory sort', () => {
    const options: PaginationOptions = { page: 2, limit: 20, search: 'abc', sort: undefined, filters: {} };
    applyDocumentListFilters(options, { search: 'abc', sortBy: 'grnNo', sortOrder: 'DESC', page: '2', limit: '20' }, 'grn');
    expect(options.search).toBe('');
    expect(options.documentFilters?.criteria.search).toBe('abc');
    expect(options.sort).toBe('grnNo:DESC');
    expect(options.page).toBe(2);
    expect(options.limit).toBe(20);
  });

  it('removes legacy in-memory filters the database now applies', () => {
    const options: PaginationOptions = { filters: { approvalStatus: 'approved', dealSlipNo: 'DS1', somethingElse: 'x' } };
    applyDocumentListFilters(options, { approvalStatus: 'approved', dealSlipNo: 'DS1' }, 'deal-slip');
    expect(options.filters).toEqual({ somethingElse: 'x' });
    expect(options.documentFilters?.criteria).toEqual({ approvalStatus: ['approved'], dealSlipNo: 'DS1' });
  });

  it('lists every parameter a module supports', () => {
    const params = supportedFilterParams('return-to-vendor');
    for (const p of ['startDate', 'endDate', 'status', 'search', 'vendorId', 'productId', 'returnReason', 'warehouseId', 'dateFrom']) {
      expect(params.has(p)).toBe(true);
    }
    expect(params.has('customerId')).toBe(false);
  });
});
