import { EntitySubscriberInterface, EventSubscriber, InsertEvent } from 'typeorm';
import AppError from '../utils/appError';
import { RFPAProduct } from '../rfpa/entity/rfpaProduct.entity';
import { DealSlipProduct } from '../dealSlip/entity/dealSlipProduct.entity';
import { GrnProduct } from '../grn/entity/grnProduct.entity';
import { ProductVarient } from '../product/productVarient/entity/productVarient.entity';

/**
 * docs/product-variant-plan.md §5: a new purchase line for a product that has
 * active variants must name one of them, and the variant must belong to the
 * product.
 *
 * Enforced where a product first enters the purchase chain (RFPA, Deal Slip,
 * GRN); later documents copy the variant from these. Only inserts are checked,
 * so documents saved before a product got variants can still be edited.
 */
const CHECKED_LINES: Function[] = [RFPAProduct, DealSlipProduct, GrnProduct];

const idOf = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return (value as { id?: string }).id ?? null;
};

@EventSubscriber()
export class VariantRequiredSubscriber implements EntitySubscriberInterface {
  async beforeInsert(event: InsertEvent<any>): Promise<void> {
    if (!CHECKED_LINES.includes(event.metadata.target as Function)) return;

    const productId = idOf(event.entity?.product);
    if (!productId) return;
    const variantId = idOf(event.entity?.variant);

    const variants = await event.manager.find(ProductVarient, {
      where: { product: { id: productId } },
      relations: ['product'],
      select: { id: true, isActive: true, combinationKey: true, product: { id: true, name: true } },
    });
    const active = variants.filter((variant) => variant.isActive);

    if (variantId) {
      const chosen = variants.find((variant) => variant.id === variantId);
      if (!chosen) {
        throw new AppError(400, 'The selected variant does not belong to the selected product');
      }
      if (!chosen.isActive) {
        throw new AppError(400, `Variant is no longer active for "${chosen.product?.name}" - pick another`);
      }
      return;
    }

    if (active.length) {
      throw new AppError(
        400,
        `"${active[0].product?.name}" has variants - select the variant on every line`,
      );
    }
  }
}
