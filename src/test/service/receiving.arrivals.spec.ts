/**
 * Arrivals list planning (src/receiving/receiving.arrivals.ts) and the SQL
 * state expression (src/receiving/receiving.sql.ts) — Phase D-7 / D-8 and
 * docs/arrivals-status-plan.md.
 */

import 'reflect-metadata';

import { chunk, normaliseStates, planStateFilter, slotWithSkip, stateConditionSql } from '../../receiving/receiving.arrivals';
import { countingDocumentLatestSql, sqlStateExpr, stepApprovedSql, stepSkippedSql } from '../../receiving/receiving.sql';

describe('planStateFilter', () => {
  it('no state: anything goes, nothing to compute', () => {
    expect(planStateFilter(undefined)).toMatchObject({ any: true, none: false, needsCompute: false });
    expect(planStateFilter([])).toMatchObject({ any: true });
  });

  it('not-received alone never matches (the list holds receivable sources only)', () => {
    expect(planStateFilter('Not Received')).toMatchObject({ any: false, none: true, states: [] });
    expect(planStateFilter(['Not Received', 'Received']).states).toEqual(['Received']);
  });

  it('in-transit and received are exact in SQL', () => {
    expect(planStateFilter('In Transit')).toMatchObject({ includeUnresolved: false, needsCompute: false, states: ['In Transit'] });
    expect(planStateFilter(['In Transit', 'Received'])).toMatchObject({ includeUnresolved: false, needsCompute: false });
  });

  it('done / in-progress need the computed state once every step is approved', () => {
    expect(planStateFilter('Done')).toMatchObject({ includeUnresolved: true, needsCompute: true });
    expect(planStateFilter('In Progress')).toMatchObject({ includeUnresolved: true, needsCompute: true });
    // "To do" (the default Arrivals tab)
    expect(planStateFilter(['In Transit', 'Received', 'In Progress'])).toMatchObject({ includeUnresolved: true, needsCompute: true });
  });

  it('in-progress and done together need no computation', () => {
    expect(planStateFilter(['In Progress', 'Done'])).toMatchObject({ includeUnresolved: true, needsCompute: false });
  });

  it('dedupes repeated states', () => {
    expect(normaliseStates(['Received', 'Received', 'Done'])).toEqual(['Received', 'Done']);
  });
});

describe('stateConditionSql', () => {
  it('no condition without a filter, FALSE when nothing can match', () => {
    expect(stateConditionSql(planStateFilter(undefined), '$1')).toBeNull();
    expect(stateConditionSql(planStateFilter('Not Received'), '$1')).toBe('FALSE');
  });

  it('exact states only, or exact states plus unresolved rows', () => {
    expect(stateConditionSql(planStateFilter('Received'), '$3')).toBe('sql_state = ANY($3::text[])');
    expect(stateConditionSql(planStateFilter('Done'), '$2')).toBe('(sql_state IS NULL OR sql_state = ANY($2::text[]))');
  });
});

describe('slotWithSkip', () => {
  it('a skipped step without a document shows skipped', () => {
    expect(slotWithSkip('Missing', true)).toBe('Skipped');
    expect(slotWithSkip('Rejected', true)).toBe('Skipped');
  });

  it('a document always wins over the mark, and no mark changes nothing', () => {
    expect(slotWithSkip('Pending', true)).toBe('Pending');
    expect(slotWithSkip('Approved', true)).toBe('Approved');
    expect(slotWithSkip('Missing', false)).toBe('Missing');
  });
});

describe('chunk', () => {
  it('splits into batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe('sqlStateExpr', () => {
  const arrived = 'ARRIVED_SQL';

  it('in-transit / received without documents, in-progress while a step is unfinished, NULL otherwise', () => {
    const sql = sqlStateExpr('g.id', 'grn', arrived);
    expect(sql).toContain(`WHEN ${arrived} THEN 'Received' ELSE 'In Transit'`);
    expect(sql).toContain("THEN 'In Progress'");
    expect(sql).toContain('ELSE NULL END');
    expect(sql).toContain('FROM inward_register rs_inward WHERE rs_inward.grn_id = (g.id)');
    // Approval: newest status COMPLETE, and no counting document still pending.
    expect(sql).toContain("= 'Complete'");
    expect(sql).toContain("<> 'Complete'");
    // Skip marks finish Dump / RTV.
    expect(sql).toContain("rs_sk.doc_type = 'dump'");
    expect(sql).toContain("rs_sk.doc_type = 'rtv'");
    // GRN sources include RTV.
    expect(sql).toContain('FROM return_to_vendor rs_rtv');
  });

  it('RTV does not apply to transfer DCs / returns', () => {
    const sql = sqlStateExpr('dc.id', 'stock-transfer-dc', arrived);
    expect(sql).not.toContain('return_to_vendor');
    expect(sql).not.toContain("rs_sk.doc_type = 'rtv'");
    expect(countingDocumentLatestSql('r.id', 'rbc', 'rtv')).toBeNull();
    expect(stepApprovedSql('r.id', 'rbc', 'rtv')).toBe('FALSE');
  });

  it('a document counts by its newest approval row (as the status service does)', () => {
    const sql = countingDocumentLatestSql('g.id', 'grn', 'aqr')!;
    expect(sql).toContain('ORDER BY rs_d."createdAt" DESC LIMIT 1');
    expect(sql).toContain("<> 'Rejected'");
    expect(sql).toContain('rs_aqr."isDeleted" = false');
  });

  it('skip marks are looked up by source type, id and step', () => {
    expect(stepSkippedSql('g.id', 'grn', 'dump')).toBe(
      "EXISTS (SELECT 1 FROM receiving_skip rs_sk WHERE rs_sk.source_type = 'grn' AND rs_sk.source_id = (g.id) AND rs_sk.doc_type = 'dump')",
    );
  });
});
