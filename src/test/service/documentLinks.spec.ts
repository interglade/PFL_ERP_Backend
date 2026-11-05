/**
 * RFPA -> Deal Slip -> GRN serve different purposes: each keeps its own values, and saving one
 * must never write another. Checked on the real entity metadata (no database connection).
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = new DataSource({ type: 'postgres', entities: ['src/**/*.entity{.ts,.js}'] });
  await (dataSource as any).buildMetadatas();
}, 120000);

describe('document links', () => {
  it('a deal slip links to its RFPA without cascading saves into it', () => {
    const relation = dataSource.getMetadata('DealSlip').findRelationWithPropertyPath('rfpa')!;
    expect(relation).toBeDefined();
    expect(relation.isCascadeInsert).toBe(false);
    expect(relation.isCascadeUpdate).toBe(false);
    expect(relation.isCascadeRemove).toBe(false);
  });

  it('a GRN reaches its RFPA through its deal slip; it has no RFPA column of its own', () => {
    const grn = dataSource.getMetadata('GRN');
    expect(grn.findRelationWithPropertyPath('rfpa')).toBeUndefined();
    expect(grn.columns.map((c) => c.databaseName)).not.toContain('rfpa_id');
    expect(grn.findRelationWithPropertyPath('dealSlipId')?.isCascadeUpdate).toBe(false);
  });
});
