import 'reflect-metadata';

import { StockCorrectionService } from '../../stockCorrection/service/stockCorrection.service';
import {
  CorrectionStatus,
  CorrectionType,
} from '../../stockCorrection/entity/stockCorrection.entity';

function buildHarness(correction: any) {
  const transaction = { committed: false, rolledBack: false, released: false };
  const locks: string[] = [];
  const statusUpdates: any[] = [];

  const lockBuilder: any = {
    setLock: (mode: string) => {
      locks.push(mode);
      return lockBuilder;
    },
    where: () => lockBuilder,
    getOne: async () => (correction ? { id: correction.id, status: correction.status } : null),
  };

  const manager: any = {
    createQueryBuilder: () => lockBuilder,
    findOne: async () => correction,
    update: async (_entity: any, criteria: any, values: any) => {
      statusUpdates.push({ criteria, values });
      return { affected: 1 };
    },
    save: jest.fn(),
  };

  const queryRunner: any = {
    manager,
    connect: async () => undefined,
    startTransaction: async () => undefined,
    commitTransaction: async () => {
      transaction.committed = true;
    },
    rollbackTransaction: async () => {
      transaction.rolledBack = true;
    },
    release: async () => {
      transaction.released = true;
    },
  };

  const dataSource: any = { createQueryRunner: () => queryRunner };
  const movementService: any = { applyManualAdjustment: jest.fn(async () => undefined) };

  const service = new StockCorrectionService({} as any, {} as any, dataSource, movementService);
  return { service, manager, movementService, transaction, locks, statusUpdates };
}

const STOCK = {
  id: 'stock-1',
  company: { id: 'company-1' },
  location: { id: 'location-1' },
  product: { id: 'product-1', name: 'Alphonso' },
  variant: { id: 'variant-1' },
  inwardQty: 100,
};

describe('StockCorrectionService.approveCorrection', () => {
  it('routes a physical-count correction through applyManualAdjustment (no dump deltas)', async () => {
    const h = buildHarness({
      id: 'c-1',
      status: CorrectionStatus.PENDING,
      correctionType: CorrectionType.PHYSICAL_COUNT,
      correctionDelta: '-8.00',
      correctionAmt: '-80.00',
      dumpQty: '3',
      dumpAmt: '30',
      inventoryStock: STOCK,
    });

    const result = await h.service.approveCorrection('c-1', 'user-9', { remarks: 'ok' } as any);

    expect(h.locks).toEqual(['pessimistic_write']);
    expect(h.movementService.applyManualAdjustment).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          companyId: 'company-1',
          locationId: 'location-1',
          productId: 'product-1',
          variantId: 'variant-1',
          qtyDelta: -8,
          amtDelta: -80,
          dumpQtyDelta: 0,
          dumpAmtDelta: 0,
        }),
      ],
      h.manager,
      { validateAvailability: true },
    );
    expect(h.manager.save).not.toHaveBeenCalled(); // no read-modify-save of inventory_stock
    expect(h.statusUpdates[0].values).toMatchObject({
      status: CorrectionStatus.APPROVED,
      approvedBy: { id: 'user-9' },
      remarks: 'ok',
    });
    expect(h.transaction.committed).toBe(true);
    expect(result.status).toBe(CorrectionStatus.APPROVED);
  });

  it('adds dumpQty / dumpAmt for DAMAGE_WRITE_OFF', async () => {
    const h = buildHarness({
      id: 'c-2',
      status: CorrectionStatus.PENDING,
      correctionType: CorrectionType.DAMAGE_WRITE_OFF,
      correctionDelta: -5,
      correctionAmt: 0,
      dumpQty: 5,
      dumpAmt: 50,
      inventoryStock: { ...STOCK, variant: null },
    });

    await h.service.approveCorrection('c-2', 'user-9');

    expect(h.movementService.applyManualAdjustment.mock.calls[0][0][0]).toMatchObject({
      variantId: null,
      qtyDelta: -5,
      amtDelta: 0,
      dumpQtyDelta: 5,
      dumpAmtDelta: 50,
    });
  });

  it('refuses a correction that is no longer pending (double approval)', async () => {
    const h = buildHarness({
      id: 'c-3',
      status: CorrectionStatus.APPROVED,
      inventoryStock: STOCK,
    });

    await expect(h.service.approveCorrection('c-3', 'user-9')).rejects.toThrow(
      /already processed/,
    );
    expect(h.movementService.applyManualAdjustment).not.toHaveBeenCalled();
    expect(h.transaction.rolledBack).toBe(true);
    expect(h.transaction.released).toBe(true);
  });

  it('rolls back without marking approved when the stock adjustment is refused', async () => {
    const h = buildHarness({
      id: 'c-4',
      status: CorrectionStatus.PENDING,
      correctionType: CorrectionType.PHYSICAL_COUNT,
      correctionDelta: -500,
      correctionAmt: 0,
      inventoryStock: STOCK,
    });
    h.movementService.applyManualAdjustment.mockRejectedValueOnce(new Error('Insufficient stock'));

    await expect(h.service.approveCorrection('c-4', 'user-9')).rejects.toThrow(/Insufficient/);
    expect(h.statusUpdates).toHaveLength(0);
    expect(h.transaction.rolledBack).toBe(true);
  });
});
