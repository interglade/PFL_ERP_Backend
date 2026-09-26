import { inject, injectable } from 'inversify';
import { DataSource, EntityManager } from 'typeorm';

import { TYPES } from '../../types';
import logger from '../../utils/logger';
import AppError from '../../utils/appError';

import { InventoryStock } from '../entity/inventoryStock.entity';
import {
  Documentb,
  DocumentStatus,
  DocumentTypeEnum,
} from '../../approvalFlow/entity/docuemnt.entity';

import { InwardRegister } from '../../inwardRegister/entity/inwardRegister.entity';
import { CustomerDeliveryChallan } from '../../deliveryChallans/customerDeliveryChllan/entity/customerDeliveryChallan.entity';
import { StockTransferDeliveryChallan } from '../../deliveryChallans/stockTransferDC/entity/stockTransferdeliveryChallan.entity';
import { DumpRegister } from '../../dumpRegister/entity/dumpRegister.entity';
import { ReturnToVendor } from '../../returnToVendor/entity/returnToVendor.entity';

/**
 * One movement to apply against a single inventory_stock row.
 * Deltas are signed: negative reduces stock, positive increases it.
 */
interface StockMovement {
  companyId: string;
  locationId: string;
  productId: string;
  variantId: string | null;
  qtyDelta: number;
  amtDelta: number;
  dumpQtyDelta?: number;
  dumpAmtDelta?: number;
  /** Used only for readable error messages when stock is insufficient. */
  label?: string;
}

/** What a document intends to do to inventory, before anything is written. */
interface MovementPlan {
  movements: StockMovement[];
  validateAvailability: boolean;
}

/**
 * Owns every write to `inventory_stock` that originates from an approval
 * document.
 *
 * Inventory is deliberately NOT moved when a document is created. It is moved
 * exactly once, at the moment the document reaches DocumentStatus.COMPLETE —
 * the single terminal "approved" state shared by the single-approver and
 * double-approver pipelines.
 *
 * Idempotency is guaranteed by `documents.inventoryProcessed`, which is written
 * in the same transaction as the movement, behind a pessimistic lock on the
 * document row. A repeated or concurrent approval call therefore cannot apply
 * the same movement twice.
 */
@injectable()
export class InventoryMovementService {
  constructor(
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------
  // Public entry point — called from the approval handlers
  // ---------------------------------------------------------------------

  /**
   * Persists `document.status` / `document.remarks` and, when the document is
   * moving to COMPLETE, applies its stock movement — both inside one
   * transaction.
   *
   * Safe to call more than once for the same document: the movement is applied
   * only on the first call that finds `inventoryProcessed = false`.
   */
  public async completeDocumentWithInventory(document: Documentb): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      // Lock the document row so two concurrent approvals serialise here.
      // No relations are joined, so FOR UPDATE is valid.
      const locked = await manager
        .createQueryBuilder(Documentb, 'doc')
        .setLock('pessimistic_write')
        .where('doc.id = :id', { id: document.id })
        .getOne();

      if (!locked) {
        throw new AppError(404, `Document ${document.id} not found`);
      }

      const isCompleting = document.status === DocumentStatus.COMPLETE;

      if (isCompleting && !locked.inventoryProcessed) {
        await this.applyInventoryForDocument(locked, manager);
      }

      await manager.update(
        Documentb,
        { id: document.id },
        {
          status: document.status,
          remarks: document.remarks,
          inventoryProcessed: isCompleting ? true : locked.inventoryProcessed,
        },
      );

      await queryRunner.commitTransaction();

      if (isCompleting) {
        document.inventoryProcessed = true;
      }
    } catch (error) {
      await queryRunner.rollbackTransaction();
      logger.error('Failed to apply inventory movement for document', {
        documentId: document.id,
        error,
      });
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Read-only pre-flight check: works out what this document would do to
   * inventory and verifies it is possible, WITHOUT writing anything.
   *
   * The approval handlers call this before they persist the approver's stage
   * record. Without it, a document whose stock has been consumed since creation
   * would have the approval recorded and then fail — leaving the document stuck
   * at HOLD with no way to retry, because the "approver already acted" guard
   * would reject the second attempt.
   */
  public async assertMovementIsApplicable(document: Documentb): Promise<void> {
    if (document.inventoryProcessed) return;

    const manager = this.dataSource.manager;
    const plan = await this.planForDocument(document, manager);

    if (!plan || !plan.validateAvailability) return;

    await this.validateAvailability(plan.movements, manager);
  }

  // ---------------------------------------------------------------------
  // Dispatcher
  // ---------------------------------------------------------------------

  private async applyInventoryForDocument(
    document: Documentb,
    manager: EntityManager,
  ): Promise<void> {
    const plan = await this.planForDocument(document, manager);
    if (!plan) return;

    if (plan.validateAvailability) {
      await this.validateAvailability(plan.movements, manager);
    }

    for (const movement of plan.movements) {
      await this.adjustStock(movement, manager);
    }
  }

  /**
   * Resolves the document to its source record and works out the signed stock
   * movements it implies. Returns null when the document type does not move
   * stock.
   */
  private async planForDocument(
    document: Documentb,
    manager: EntityManager,
  ): Promise<MovementPlan | null> {
    const sourceId = document.document_type_id;
    if (!sourceId) {
      logger.warn('Document has no document_type_id; skipping inventory', {
        documentId: document.id,
        type: document.type,
      });
      return null;
    }

    switch (document.type) {
      case DocumentTypeEnum.INWARD_REGISTER:
        return this.planInwardRegister(sourceId, manager);

      case DocumentTypeEnum.DC_TYPE_CUSTOMER:
        return this.planCustomerDeliveryChallan(sourceId, manager);

      case DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER:
        return this.planStockTransferDeliveryChallan(sourceId, manager);

      case DocumentTypeEnum.DUMP_REGISTER:
        return this.planDumpRegister(sourceId, manager);

      case DocumentTypeEnum.RETURN_TO_VENDOR:
        return this.planReturnToVendor(sourceId, manager);

      case DocumentTypeEnum.DC_TYPE_OTHER:
        // Other Delivery Challan has never moved stock in this project.
        // Behaviour intentionally unchanged. To make it reduce stock at
        // fromLocation, mirror planCustomerDeliveryChallan() here.
        return null;

      default:
        // Every other document type is not inventory-bearing.
        return null;
    }
  }

  // ---------------------------------------------------------------------
  // Inward Register — STOCK IN at `location`
  // ---------------------------------------------------------------------

  private async planInwardRegister(
    inwardId: string,
    manager: EntityManager,
  ): Promise<MovementPlan> {
    const inward = await manager.findOne(InwardRegister, {
      where: { id: inwardId },
      relations: [
        'companyName',
        'location',
        'inwardProducts',
        'inwardProducts.productName',
        'inwardProducts.variant',
      ],
    });

    if (!inward) {
      throw new AppError(404, `Inward Register ${inwardId} not found`);
    }

    const companyId = inward.companyName?.id;
    const locationId = inward.location?.id;

    if (!companyId || !locationId) {
      throw new AppError(
        400,
        `Inward Register ${inward.inwardNo ?? inwardId} is missing company or location; cannot move stock`,
      );
    }

    const movements: StockMovement[] = [];

    for (const item of inward.inwardProducts ?? []) {
      const productId = item.productName?.id;
      if (!productId) {
        logger.warn('Skipping inward item without product', { inwardId, itemId: item.id });
        continue;
      }

      // Preserves the original basis: quantity from netWeight, value from
      // unitPrice x quantity.
      const qty = Number(item.netWeight) || 0;
      const amt = +(((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0))).toFixed(2);

      movements.push({
        companyId,
        locationId,
        productId,
        variantId: item.variant?.id ?? null,
        qtyDelta: +qty.toFixed(2),
        amtDelta: amt,
      });
    }

    return { movements, validateAvailability: false };
  }

  // ---------------------------------------------------------------------
  // Customer Delivery Challan — STOCK OUT at `fromLocation`
  // ---------------------------------------------------------------------

  private async planCustomerDeliveryChallan(
    challanId: string,
    manager: EntityManager,
  ): Promise<MovementPlan> {
    const challan = await manager.findOne(CustomerDeliveryChallan, {
      where: { id: challanId },
      relations: [
        'companyName',
        'fromLocation',
        'deliveryChallanProducts',
        'deliveryChallanProducts.productName',
        'deliveryChallanProducts.variant',
        'deliveryChallanProducts.variant.product',
      ],
    });

    if (!challan) {
      throw new AppError(404, `Customer Delivery Challan ${challanId} not found`);
    }

    const companyId = challan.companyName?.id;
    const locationId = challan.fromLocation?.id;

    if (!companyId || !locationId) {
      throw new AppError(
        400,
        `Customer Delivery Challan ${challan.challanNo ?? challanId} is missing company or from-location; cannot move stock`,
      );
    }

    const movements: StockMovement[] = [];

    for (const item of challan.deliveryChallanProducts ?? []) {
      // Same resolution order as the original create(): when a variant exists
      // the product is taken from the variant, otherwise from the line itself.
      const variantId = item.variant?.id ?? null;
      const productId = variantId
        ? item.variant?.product?.id ?? item.productName?.id
        : item.productName?.id;

      if (!productId) continue;

      const qty = Number(item.netWeight) || 0;
      const amt = Number(item.amount) || 0;

      movements.push({
        companyId,
        locationId,
        productId,
        variantId,
        qtyDelta: -qty,
        amtDelta: -amt,
        label: item.productName?.name ?? productId,
      });
    }

    // Stock availability is validated at DC creation time (customerDeliveryChallan.service.ts).
    // Re-checking here at approve time is redundant and causes false failures when
    // other DCs are created concurrently. Deduct without a second availability check.
    return { movements, validateAvailability: false };
  }

  // ---------------------------------------------------------------------
  // Stock Transfer Delivery Challan — STOCK OUT at `fromLocation`
  //
  // Covers all four StockTransferType values (CC->DC, DC->CC, CC->CC, DC->DC):
  // they share one entity and one flow.
  //
  // The TO-location increase is intentionally NOT done here — it comes from a
  // separate Inward Register raised against this challan, exactly as before.
  // ---------------------------------------------------------------------

  private async planStockTransferDeliveryChallan(
    challanId: string,
    manager: EntityManager,
  ): Promise<MovementPlan> {
    const challan = await manager.findOne(StockTransferDeliveryChallan, {
      where: { id: challanId },
      relations: [
        'companyName',
        'fromLocation',
        'deliveryChallanProducts',
        'deliveryChallanProducts.productName',
        'deliveryChallanProducts.variant',
        'deliveryChallanProducts.variant.product',
      ],
    });

    if (!challan) {
      throw new AppError(404, `Stock Transfer Delivery Challan ${challanId} not found`);
    }

    const companyId = challan.companyName?.id;
    const locationId = challan.fromLocation?.id;

    if (!companyId || !locationId) {
      throw new AppError(
        400,
        `Stock Transfer Challan ${challan.challanNo ?? challanId} is missing company or from-location; cannot move stock`,
      );
    }

    const movements: StockMovement[] = [];

    for (const item of challan.deliveryChallanProducts ?? []) {
      const variantId = item.variant?.id ?? null;
      const productId = variantId
        ? item.variant?.product?.id ?? item.productName?.id
        : item.productName?.id;

      if (!productId) continue;

      const qty = Number(item.netWeight) || 0;
      const amt = Number(item.amount) || 0;

      movements.push({
        companyId,
        locationId,
        productId,
        variantId,
        qtyDelta: -qty,
        amtDelta: -amt,
        label: item.productName?.name ?? productId,
      });
    }

    // Unchanged from the original create(): no availability check, a negative
    // balance is allowed to be created.
    return { movements, validateAvailability: false };
  }

  // ---------------------------------------------------------------------
  // Dump Register — STOCK OUT + dump counters at `location`
  // Applies to every DumpType (purchase / transferred / returned-by-customer);
  // the original code did not branch on dumpType either.
  // ---------------------------------------------------------------------

  private async planDumpRegister(
    dumpId: string,
    manager: EntityManager,
  ): Promise<MovementPlan> {
    const dump = await manager.findOne(DumpRegister, {
      where: { id: dumpId },
      relations: [
        'companyName',
        'location',
        'dumpProducts',
        'dumpProducts.productName',
        'dumpProducts.variant',
      ],
    });

    if (!dump) {
      throw new AppError(404, `Dump Register ${dumpId} not found`);
    }

    const companyId = dump.companyName?.id;
    const locationId = dump.location?.id;

    if (!companyId || !locationId) {
      throw new AppError(
        400,
        `Dump Register ${dump.dumpNo ?? dumpId} is missing company or location; cannot move stock`,
      );
    }

    const movements: StockMovement[] = [];

    for (const item of dump.dumpProducts ?? []) {
      const productId = item.productName?.id;
      if (!productId) continue;

      const qty = Number(item.quantity) || 0;
      const amt = Number(item.amount) || 0;

      if (qty <= 0) continue;

      movements.push({
        companyId,
        locationId,
        productId,
        variantId: item.variant?.id ?? null,
        qtyDelta: -qty,
        amtDelta: -amt,
        dumpQtyDelta: qty,
        dumpAmtDelta: amt,
      });
    }

    return { movements, validateAvailability: false };
  }

  // ---------------------------------------------------------------------
  // Return To Vendor — STOCK OUT at `location`
  // ---------------------------------------------------------------------

  private async planReturnToVendor(
    rtvId: string,
    manager: EntityManager,
  ): Promise<MovementPlan> {
    const rtv = await manager.findOne(ReturnToVendor, {
      where: { id: rtvId },
      relations: [
        'companyName',
        'location',
        'rtvProducts',
        'rtvProducts.productName',
        'rtvProducts.variant',
      ],
    });

    if (!rtv) {
      throw new AppError(404, `Return To Vendor ${rtvId} not found`);
    }

    const companyId = rtv.companyName?.id;
    const locationId = rtv.location?.id;

    if (!companyId || !locationId) {
      throw new AppError(
        400,
        `Return To Vendor ${rtv.rtvNo ?? rtvId} is missing company or location; cannot move stock`,
      );
    }

    const movements: StockMovement[] = [];

    for (const item of rtv.rtvProducts ?? []) {
      const productId = item.productName?.id;
      if (!productId) continue;

      // Preserves the original basis: quantity from netWeight, value from
      // unitPrice x quantity.
      const qty = Number(item.netWeight) || 0;
      const amt = +(((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0))).toFixed(2);

      movements.push({
        companyId,
        locationId,
        productId,
        variantId: item.variant?.id ?? null,
        qtyDelta: -(+qty.toFixed(2)),
        amtDelta: -amt,
      });
    }

    return { movements, validateAvailability: false };
  }

  // ---------------------------------------------------------------------
  // Shared application logic
  // ---------------------------------------------------------------------

  /**
   * Re-validates availability against live stock. A document may have been
   * created days before it is approved, so availability at creation time is not
   * a guarantee here.
   */
  private async validateAvailability(
    movements: StockMovement[],
    manager: EntityManager,
  ): Promise<void> {
    if (movements.length === 0) return;

    const required = new Map<string, { movement: StockMovement; qty: number }>();

    for (const movement of movements) {
      if (movement.qtyDelta >= 0) continue;
      const key = this.stockKey(movement);
      const entry = required.get(key);
      if (entry) {
        entry.qty += -movement.qtyDelta;
      } else {
        required.set(key, { movement, qty: -movement.qtyDelta });
      }
    }

    for (const { movement, qty } of required.values()) {
      const available = await this.readAvailableQty(movement, manager);
      if (available < qty) {
        throw new AppError(
          400,
          `Insufficient stock: required ${qty} but only ${available} available for product "${movement.label ?? movement.productId}" at this location`,
        );
      }
    }
  }

  private stockKey(movement: StockMovement): string {
    return `${movement.companyId}::${movement.locationId}::${movement.productId}::${movement.variantId ?? 'null'}`;
  }

  private async readAvailableQty(
    movement: StockMovement,
    manager: EntityManager,
  ): Promise<number> {
    const qb = manager
      .createQueryBuilder(InventoryStock, 'stock')
      .select('stock.inwardQty', 'inwardQty')
      .where('"stock"."company_id" = :companyId', { companyId: movement.companyId })
      .andWhere('"stock"."location_id" = :locationId', { locationId: movement.locationId })
      .andWhere('"stock"."product_id" = :productId', { productId: movement.productId });

    if (movement.variantId) {
      qb.andWhere('"stock"."variant_id" = :variantId', { variantId: movement.variantId });
    } else {
      qb.andWhere('"stock"."variant_id" IS NULL');
    }

    const row = await qb.getRawOne();
    return Number(row?.inwardQty ?? 0);
  }

  /**
   * Applies one signed delta to one inventory_stock row.
   *
   * The UPDATE is expressed as `column = column + :delta` so it is atomic at the
   * row level — two documents touching the same stock row cannot lose each
   * other's write, which the previous read-modify-write code could.
   */
  private async adjustStock(
    movement: StockMovement,
    manager: EntityManager,
  ): Promise<void> {
    const qtyDelta = Number(movement.qtyDelta) || 0;
    const amtDelta = Number(movement.amtDelta) || 0;
    const dumpQtyDelta = Number(movement.dumpQtyDelta) || 0;
    const dumpAmtDelta = Number(movement.dumpAmtDelta) || 0;

    if (qtyDelta === 0 && amtDelta === 0 && dumpQtyDelta === 0 && dumpAmtDelta === 0) {
      return;
    }

    const update = manager
      .createQueryBuilder()
      .update(InventoryStock)
      .set({
        // qtyDelta/amtDelta/dumpQtyDelta/dumpAmtDelta are already coerced with
        // Number() above, so interpolating them here cannot inject SQL.
        inwardQty: () => `COALESCE("inwardQty", 0) + (${qtyDelta})`,
        inwardAmt: () => `COALESCE("inwardAmt", 0) + (${amtDelta})`,
        dumpQty: () => `COALESCE("dumpQty", 0) + (${dumpQtyDelta})`,
        dumpAmt: () => `COALESCE("dumpAmt", 0) + (${dumpAmtDelta})`,
      })
      .where('company_id = :companyId', { companyId: movement.companyId })
      .andWhere('location_id = :locationId', { locationId: movement.locationId })
      .andWhere('product_id = :productId', { productId: movement.productId });

    if (movement.variantId) {
      update.andWhere('variant_id = :variantId', { variantId: movement.variantId });
    } else {
      update.andWhere('variant_id IS NULL');
    }

    const result = await update.execute();

    if (result.affected && result.affected > 0) return;

    // No row for this (company, location, product, variant) yet — create it
    // carrying the delta, so the movement is never silently lost.
    const stockData: Record<string, any> = {
      company: { id: movement.companyId },
      location: { id: movement.locationId },
      product: { id: movement.productId },
      inwardQty: qtyDelta,
      inwardAmt: amtDelta,
      dumpQty: dumpQtyDelta,
      dumpAmt: dumpAmtDelta,
    };

    if (movement.variantId) {
      stockData.variant = { id: movement.variantId };
    }

    const created = manager.create(InventoryStock, stockData);
    await manager.save(created);
  }
}
