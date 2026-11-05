import { closureRows, isInSubtree, managersAbove, removeMember, treeFromRows } from '../../workFlow/closure';

const row = (ancestor_id: string, descendant_id: string, depth: number, createdAt = '2026-01-01') =>
  ({ ancestor_id, descendant_id, depth, createdAt });

/** A -> B -> C, A -> D */
const sample = () =>
  treeFromRows([
    row('A', 'A', 0), row('B', 'B', 0), row('C', 'C', 0), row('D', 'D', 0),
    row('A', 'B', 1), row('B', 'C', 1), row('A', 'D', 1), row('A', 'C', 2),
  ]);

const key = (r: { ancestor: string; descendant: string; depth: number }) => `${r.ancestor}>${r.descendant}:${r.depth}`;

describe('workflow closure', () => {
  it('derives every self row and ancestor pair, once', () => {
    const rows = closureRows(sample()).map(key).sort();
    expect(rows).toEqual(['A>A:0', 'A>B:1', 'A>C:2', 'A>D:1', 'B>B:0', 'B>C:1', 'C>C:0', 'D>D:0'].sort());
  });

  it('collapses duplicated rows', () => {
    const tree = treeFromRows([row('A', 'B', 1), row('A', 'B', 1), row('B', 'B', 0), row('B', 'B', 0), row('A', 'B', 1)]);
    expect(closureRows(tree).map(key).sort()).toEqual(['A>A:0', 'A>B:1', 'B>B:0']);
  });

  it('keeps the earliest manager when someone has several', () => {
    const tree = treeFromRows([row('X', 'B', 1, '2026-02-01'), row('A', 'B', 1, '2026-01-01')]);
    expect(tree.managerOf.get('B')).toBe('A');
  });

  it('drops self links and links that close a cycle', () => {
    const tree = treeFromRows([row('A', 'A', 1), row('A', 'B', 1, '2026-01-01'), row('B', 'A', 1, '2026-01-02')]);
    expect(tree.managerOf.get('A')).toBeUndefined();
    expect(tree.managerOf.get('B')).toBe('A');
  });

  it('knows who is in whose team', () => {
    const tree = sample();
    expect(managersAbove(tree.managerOf, 'C')).toEqual(['B', 'A']);
    expect(isInSubtree(tree.managerOf, 'B', 'C')).toBe(true);
    expect(isInSubtree(tree.managerOf, 'B', 'D')).toBe(false);
    expect(isInSubtree(tree.managerOf, 'A', 'A')).toBe(true);
  });

  it('moves the team of a removed employee up to their manager', () => {
    const tree = sample();
    removeMember(tree, 'B');
    expect(tree.managerOf.get('C')).toBe('A');
    expect(tree.members.has('B')).toBe(false);
    expect(closureRows(tree).map(key)).not.toContain('A>C:2');
    expect(closureRows(tree).map(key)).toContain('A>C:1');
  });

  it('makes the team of a removed top person top level', () => {
    const tree = sample();
    removeMember(tree, 'A');
    expect(tree.managerOf.get('B')).toBeUndefined();
    expect(tree.managerOf.get('D')).toBeUndefined();
    expect(tree.managerOf.get('C')).toBe('B');
  });
});
