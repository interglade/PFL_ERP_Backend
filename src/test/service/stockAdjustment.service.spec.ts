/**
 * C9 / C10 — request validation, and the approval outcome hooks (the documents
 * follow the Dump Register's two-level Operation approval).
 */

import 'reflect-metadata';
import { DataSource, EntityManager } from 'typeorm';
import { StockAdjustmentService } from '../../inventoryStock/adjustment/stockAdjustment.service';
import { applyRejectedAdjustmentOrRepack } from '../../inventoryStock/adjustment/stockAdjustment.apply';
import { DocumentbService } from '../../approvalFlow/service/documentb.service';
import { ApprovalFlowService } from '../../approvalFlow/service/approvalFlow.service';
import { DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';

const service = (flow: unknown = { id: 'flow' }) => {
  const dataSource = { transaction: jest.fn(), query: jest.fn() } as unknown as DataSource;
  const approvalFlowService = { getApprovalFlowForUserAndDepartment: jest.fn(async () => flow) } as unknown as ApprovalFlowService;
  return { service: new StockAdjustmentService(dataSource, {} as DocumentbService, approvalFlowService), dataSource };
};

describe('StockAdjustmentService', () => {
  it('needs a non-zero quantity and a known reason before touching the database', async () => {
    const { service: s, dataSource } = service();
    await expect(s.createAdjustment({ qtyDelta: 0, reason: 'COUNT_DIFFERENCE' }, 'u1')).rejects.toThrow('Enter the quantity');
    await expect(s.createAdjustment({ qtyDelta: 5, reason: 'LOST' }, 'u1')).rejects.toThrow('Reason must be one of');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('needs both quantities and a unit for a repack', async () => {
    const { service: s } = service();
    await expect(s.createRepack({ stockBatchId: 'b', fromQty: 0, toUomId: 'kg', toQty: 5 }, 'u1')).rejects.toThrow('Enter the quantity to repack');
    await expect(s.createRepack({ stockBatchId: 'b', fromQty: 2, toUomId: '', toQty: 5 }, 'u1')).rejects.toThrow('Choose the unit');
  });

  it('needs an Operation approval flow, like the Dump Register', async () => {
    const { service: s, dataSource } = service(null);
    await expect(s.createAdjustment({ qtyDelta: 5, reason: 'OPENING' }, 'u1')).rejects.toThrow('Approval flow not configured');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

describe('approval outcome', () => {
  it('a rejected adjustment releases what it held and is marked rejected', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const manager = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return []; }) } as unknown as EntityManager;
    await applyRejectedAdjustmentOrRepack(manager, DocumentTypeEnum.STOCK_ADJUSTMENT, 'adj1', 'a2', 'Count was right');
    expect(calls.some((c) => c.sql.includes("SET status = 'RELEASED'") && c.params[0] === DocumentTypeEnum.STOCK_ADJUSTMENT)).toBe(true);
    const update = calls.find((c) => c.sql.startsWith('UPDATE stock_adjustment'))!;
    expect(update.params).toEqual(['adj1', 'a2', 'Count was right']);
  });
});
