/**
 * Arrivals list planning (src/receiving/receiving.arrivals.ts) and the SQL
 * state expression (src/receiving/receiving.sql.ts) — Phase D-7 / D-8.
 */

import 'reflect-metadata';

import { chunk, normaliseStates, planStateFilter, slotWithSkip, stateConditionSql } from '../../receiving/receiving.arrivals';
import { countingDocumentLatestSql, sqlStateExpr } from '../../receiving/receiving.sql';

describe('planStateFilter', () => {
  it('no state: anything goes, nothing to compute', () => {
    expect(planStateFilter(undefined)).toMatchObject({ any: true, none: false, needsCompute: false });
    expect(planStateFilter([])).toMatchObject({ any: true });
  });

  it('not-received alone never matches (the list holds COMPLETE sources only)', () => {
    expect(planStateFilter('not-received')).toMatchObject({ any: false, none: true, states: [] });
    expect(planStateFilter(['not-received', 'open']).states).toEqual(['open']);
  });

  it('not-started is exact in SQL', () => {
    expect(planStateFilter('not-started')).toMatchObject({ includeUnresolved: false, needsCompute: false, states: ['not-started'] });
  });

  it('done / open / legacy need the computed state for sources with an Inward', () => {
    expect(planStateFilter('done')).toMatchObject({ includeUnresolved: true, needsCompute: true });
    expect(planStateFilter('open')).toMatchObject({ includeUnresolved: true, needsCompute: true });
    // "Not done" (the default Arrivals tab)
    expect(planStateFilter(['not-started', 'open', 'legacy'])).toMatchObject({ includeUnresolved: true, needsCompute: true });
  });

  it('all three Inward states together need no computation', () => {
    expect(planStateFilter(['open', 'done', 'legacy'])).toMatchObject({ includeUnresolved: true, needsCompute: false });
  });

  it('dedupes repeated states', () => {
    expect(normaliseStates(['open', 'open', 'done'])).toEqual(['open', 'done']);
  });
});

describe('stateConditionSql', () => {
  it('no condition without a filter, FALSE when nothing can match', () => {
    expect(stateConditionSql(planStateFilter(undefined), '$1')).toBeNull();
    expect(stateConditionSql(planStateFilter('not-received'), '$1')).toBe('FALSE');
  });

  it('exact states only, or exact states plus unresolved rows', () => {
    expect(stateConditionSql(planStateFilter('not-started'), '$3')).toBe('sql_state = ANY($3::text[])');
    expect(stateConditionSql(planStateFilter('done'), '$2')).toBe('(sql_state IS NULL OR sql_state = ANY($2::text[]))');
  });
});

describe('slotWithSkip', () => {
  it('a skipped step without a document shows skipped', () => {
    expect(slotWithSkip('missing', true)).toBe('skipped');
    expect(slotWithSkip('rejected', true)).toBe('skipped');
  });

  it('a document always wins over the mark, and no mark changes nothing', () => {
    expect(slotWithSkip('pending', true)).toBe('pending');
    expect(slotWithSkip('approved', true)).toBe('approved');
    expect(slotWithSkip('missing', false)).toBe('missing');
  });
});

describe('chunk', () => {
  it('splits into batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe('sqlStateExpr', () => {
  it('not-started without documents; open / legacy without an Inward; NULL otherwise', () => {
    const sql = sqlStateExpr('g.id', 'grn');
    expect(sql).toContain("THEN 'not-started'");
    expect(sql).toContain("THEN 'legacy' ELSE 'open'");
    expect(sql).toContain('ELSE NULL END');
    expect(sql).toContain('FROM inward_register rs_inward WHERE rs_inward.grn_id = (g.id)');
    expect(sql).toContain('rs_dp.dump_register_id = rs_dump.id');
    // GRN sources include RTV in "any document"
    expect(sql).toContain('FROM return_to_vendor rs_rtv');
  });

  it('RTV does not apply to transfer DCs / returns', () => {
    expect(sqlStateExpr('dc.id', 'stock-transfer-dc')).not.toContain('return_to_vendor');
    expect(countingDocumentLatestSql('r.id', 'rbc', 'rtv')).toBeNull();
  });

  it('a document counts by its newest approval row (as the status service does)', () => {
    const sql = countingDocumentLatestSql('g.id', 'grn', 'aqr')!;
    expect(sql).toContain('ORDER BY rs_d."createdAt" DESC LIMIT 1');
    expect(sql).toContain("<> 'REJECT'");
    expect(sql).toContain('rs_aqr."isDeleted" = false');
  });
});
