import { inject, injectable } from 'inversify';
import { EntityManager, In } from 'typeorm';
import { TYPES } from '../../types';
import { GrnProductHistoryRepository } from '../repository/grnProductHistory.repository';
import { GrnProductHistory } from '../entity/grnProductHistory.entity';
import { GrnLineChange, GrnLineState } from '../grnEdit';

const ref = (id: string | null | undefined): { id: string } | null => (id ? { id } : null);

@injectable()
export class GrnProductHistoryService {
  constructor(
    @inject(TYPES.GrnProductHistoryRepository)
    private readonly historyRepository: GrnProductHistoryRepository,
  ) {}

  /**
   * Next version of each line (1 for a line without history). Call it **before** removed lines are
   * deleted: their history rows lose the line link (set null) once the line is gone.
   */
  async nextVersions(manager: EntityManager, grnProductIds: string[]): Promise<Map<string, number>> {
    const next = new Map(grnProductIds.map((id) => [id, 1]));
    if (!grnProductIds.length) return next;
    const rows: Array<{ id: string; max: string | null }> = await manager
      .getRepository(GrnProductHistory)
      .createQueryBuilder('h')
      .select('h.grn_product_id', 'id')
      .addSelect('MAX(h.version)', 'max')
      .where({ grnProduct: { id: In(grnProductIds) } })
      .groupBy('h.grn_product_id')
      .getRawMany();
    for (const row of rows) next.set(row.id, (parseInt(row.max ?? '0', 10) || 0) + 1);
    return next;
  }

  /**
   * Writes one history row per changed line. Must run inside the edit's transaction, after the
   * save (added lines need their new id; removed lines are already deleted, so they are stored
   * without a line link but with their product snapshot).
   */
  async recordLineChanges(
    manager: EntityManager,
    input: { grnId: string; changes: GrnLineChange[]; versions: Map<string, number>; modifiedById: string },
  ): Promise<number> {
    const now = new Date();
    const rows = input.changes.map(({ changeType, before, after }) => {
      const line = (after ?? before) as GrnLineState;
      const v = (field: keyof GrnLineState, state: GrnLineState | null) => (state ? state[field] : null);
      return manager.create(GrnProductHistory, {
        grn: { id: input.grnId } as any,
        grnProduct: changeType === 'removed' ? null : ({ id: line.id } as any),
        product: ref(line.productId) as any,
        variant: ref(line.variantId) as any,
        version: input.versions.get(line.id) ?? 1,
        changeType,
        oldQuantity: v('quantity', before) as any,
        newQuantity: v('quantity', after) as any,
        oldRate: v('unitPrice', before) as any,
        newRate: v('unitPrice', after) as any,
        oldUom: ref(v('uomId', before) as string | null) as any,
        newUom: ref(v('uomId', after) as string | null) as any,
        oldGrossWeight: v('grossWeight', before) as any,
        newGrossWeight: v('grossWeight', after) as any,
        oldPackingMaterialWeight: v('packingMaterialWeight', before) as any,
        newPackingMaterialWeight: v('packingMaterialWeight', after) as any,
        oldNetWeight: v('netWeight', before) as any,
        newNetWeight: v('netWeight', after) as any,
        oldPurchaseDate: v('purchaseDate', before) as any,
        newPurchaseDate: v('purchaseDate', after) as any,
        oldDispatchDate: v('dispatchDate', before) as any,
        newDispatchDate: v('dispatchDate', after) as any,
        oldDeliveryDate: v('deliveryDate', before) as any,
        newDeliveryDate: v('deliveryDate', after) as any,
        oldExpectedHarvestDate: v('expectedHarvestDate', before) as any,
        newExpectedHarvestDate: v('expectedHarvestDate', after) as any,
        oldPackagingMaterial: ref(v('packagingMaterialId', before) as string | null) as any,
        newPackagingMaterial: ref(v('packagingMaterialId', after) as string | null) as any,
        modifiedBy: ref(input.modifiedById) as any,
        modifiedAt: now,
      });
    });
    if (rows.length) await manager.save(GrnProductHistory, rows);
    return rows.length;
  }

  /** The full history of a GRN, oldest first. */
  async getHistoryByGrnId(grnId: string): Promise<GrnProductHistory[]> {
    return this.historyRepository.find({
      where: { grn: { id: grnId } },
      relations: [
        'grn', 'grnProduct', 'product', 'variant', 'modifiedBy',
        'oldUom', 'newUom', 'oldPackagingMaterial', 'newPackagingMaterial',
      ],
      order: { modifiedAt: 'ASC', version: 'ASC' },
    });
  }
}
