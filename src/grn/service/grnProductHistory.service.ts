import { inject, injectable } from 'inversify';
import { EntityManager } from 'typeorm';
import { TYPES } from '../../types';
import { GrnProductHistoryRepository } from '../repository/grnProductHistory.repository';
import { GrnProductHistory } from '../entity/grnProductHistory.entity';


export interface CreateHistoryParams {
  grnId: string;
  grnProductId: string;
  productId: string | null;
  variantId: string | null;
  oldQuantity: number;
  newQuantity: number;
  oldRate: number;
  newRate: number;
  modifiedById: string;
}

@injectable()
export class GrnProductHistoryService {
  constructor(
    @inject(TYPES.GrnProductHistoryRepository)
    private readonly historyRepository: GrnProductHistoryRepository,
  ) {}

  /**
   * Calculates the next version number for a given grn_product_id.
   * Must be called inside the same transaction (pass EntityManager).
   */
  private async getNextVersion(
    manager: EntityManager,
    grnProductId: string,
  ): Promise<number> {
    const result = await manager
      .getRepository(GrnProductHistory)
      .createQueryBuilder('h')
      .select('MAX(h.version)', 'maxVersion')
      .where('h.grn_product_id = :grnProductId', { grnProductId })
      .getRawOne();

    const current = result?.maxVersion ? parseInt(result.maxVersion, 10) : 0;
    return current + 1;
  }

  /**
   * Creates history records for every product whose quantity or rate changed.
   * Skips products where both values are unchanged (prevents duplicates).
   * Must be called inside an existing transaction.
   *
   * @param manager  - the transactional EntityManager from the caller
   * @param records  - list of products to evaluate
   * @returns        - number of history rows created
   */
  async createHistoryForChangedProducts(
    manager: EntityManager,
    records: CreateHistoryParams[],
  ): Promise<number> {
    let created = 0;

    for (const rec of records) {
      const qtyChanged =
        parseFloat(String(rec.oldQuantity)) !==
        parseFloat(String(rec.newQuantity));
      const rateChanged =
        parseFloat(String(rec.oldRate)) !== parseFloat(String(rec.newRate));

      // Requirement 2 & 12: only persist if something actually changed
      if (!qtyChanged && !rateChanged) continue;

      const version = await this.getNextVersion(manager, rec.grnProductId);

      const history = manager.create(GrnProductHistory, {
        grn: { id: rec.grnId } as any,
        grnProduct: { id: rec.grnProductId } as any,
        product: rec.productId ? { id: rec.productId } : undefined,
        variant: rec.variantId ? { id: rec.variantId } : undefined,
        version,
        oldQuantity: rec.oldQuantity,
        newQuantity: rec.newQuantity,
        oldRate: rec.oldRate,
        newRate: rec.newRate,
        modifiedBy: { id: rec.modifiedById } as any,
        modifiedAt: new Date(),
      });

      await manager.save(GrnProductHistory, history);
      created++;
    }

    return created;
  }

  /**
   * Fetches the full history for a single grn_product, ordered by version asc.
   */
  async getHistoryByGrnProductId(
    grnProductId: string,
  ): Promise<GrnProductHistory[]> {
    return this.historyRepository.find({
      where: { grnProduct: { id: grnProductId } },
      relations: ['modifiedBy', 'product', 'variant'],
      order: { version: 'ASC' },
    });
  }

  /**
   * Fetches the full history for all products in a GRN, ordered by product then version.
   */
  async getHistoryByGrnId(grnId: string): Promise<GrnProductHistory[]> {
    return this.historyRepository.find({
      where: { grn: { id: grnId } },
      relations: ['grn', 'grnProduct', 'product', 'variant', 'modifiedBy'],
      order: { grnProduct: { id: 'ASC' }, version: 'ASC' },
    });
  }
}
