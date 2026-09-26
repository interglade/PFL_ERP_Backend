import 'reflect-metadata';

import { InventoryMovementService } from '../../inventoryStock/service/inventoryMovement.service';
import {
  Documentb,
  DocumentStatus,
  DocumentTypeEnum,
} from '../../approvalFlow/entity/docuemnt.entity';
import { InventoryStock } from '../../inventoryStock/entity/inventoryStock.entity';
import { InwardRegister } from '../../inwardRegister/entity/inwardRegister.entity';
import { CustomerDeliveryChallan } from '../../deliveryChallans/customerDeliveryChllan/entity/customerDeliveryChallan.entity';
import { StockTransferDeliveryChallan } from '../../deliveryChallans/stockTransferDC/entity/stockTransferdeliveryChallan.entity';
import { DumpRegister } from '../../dumpRegister/entity/dumpRegister.entity';
import { ReturnToVendor } from '../../returnToVendor/entity/returnToVendor.entity';

/** A stock write captured from the service, with the deltas it applied. */
interface CapturedUpdate {
  qtyDelta: number;
  amtDelta: number;
  dumpQtyDelta: number;
  dumpAmtDelta: number;
  where: Record<string, any>;
  variantIsNull: boolean;
}

interface HarnessOptions {
  /** The row returned by the locking SELECT on `documents`. */
  lockedDocument: Partial<Documentb> | null;
  /** Source record returned by manager.findOne() for the document's own entity. */
  sourceRecord?: any;
  /** inwardQty reported by the availability check. Default: plenty. */
  availableQty?: number;
  /** Rows matched by the atomic UPDATE. 0 forces the insert path. */
  updateAffected?: number;
}

function buildHarness(options: HarnessOptions) {
  const updates: CapturedUpdate[] = [];
  const inserts: any[] = [];
  const documentUpdates: any[] = [];
  const transaction = { committed: false, rolledBack: false, released: false };

  const readDelta = (fn: any): number => {
    const sql = typeof fn === 'function' ? fn() : String(fn);
    const match = /\(([-\d.e+]+)\)\s*$/.exec(sql);
    return match ? Number(match[1]) : NaN;
  };

  const makeUpdateBuilder = () => {
    const captured: Partial<CapturedUpdate> = { where: {}, variantIsNull: false };
    const builder: any = {
      update: () => builder,
      set: (values: any) => {
        captured.qtyDelta = readDelta(values.inwardQty);
        captured.amtDelta = readDelta(values.inwardAmt);
        captured.dumpQtyDelta = readDelta(values.dumpQty);
        captured.dumpAmtDelta = readDelta(values.dumpAmt);
        return builder;
      },
      where: (_sql: string, params?: any) => {
        Object.assign(captured.where!, params ?? {});
        return builder;
      },
      andWhere: (sql: string, params?: any) => {
        if (/variant_id IS NULL/.test(sql)) captured.variantIsNull = true;
        Object.assign(captured.where!, params ?? {});
        return builder;
      },
      execute: async () => {
        updates.push(captured as CapturedUpdate);
        return { affected: options.updateAffected ?? 1 };
      },
    };
    return builder;
  };

  const makeSelectBuilder = (entity: any) => {
    const builder: any = {
      setLock: () => builder,
      select: () => builder,
      where: () => builder,
      andWhere: () => builder,
      getOne: async () => (entity === Documentb ? options.lockedDocument : null),
      getRawOne: async () => ({ inwardQty: options.availableQty ?? 1_000_000 }),
    };
    return builder;
  };

  const manager: any = {
    createQueryBuilder: (entity?: any) =>
      entity ? makeSelectBuilder(entity) : makeUpdateBuilder(),
    findOne: async () => options.sourceRecord ?? null,
    update: async (_entity: any, criteria: any, values: any) => {
      documentUpdates.push({ criteria, values });
      return { affected: 1 };
    },
    create: (_entity: any, data: any) => data,
    save: async (data: any) => {
      inserts.push(data);
      return data;
    },
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

  const dataSource: any = { createQueryRunner: () => queryRunner, manager };
  const service = new InventoryMovementService(dataSource);

  return { service, updates, inserts, documentUpdates, transaction };
}

function makeDocument(type: DocumentTypeEnum, overrides: Partial<Documentb> = {}) {
  return {
    id: 'doc-1',
    type,
    document_type_id: 'src-1',
    status: DocumentStatus.COMPLETE,
    remarks: 'approved',
    inventoryProcessed: false,
    ...overrides,
  } as Documentb;
}

const COMPANY = { id: 'company-1' };
const LOCATION = { id: 'location-1' };
const PRODUCT = { id: 'product-1', name: 'Alphonso' };
const VARIANT = { id: 'variant-1', product: PRODUCT };

// ---------------------------------------------------------------------------

describe('InventoryMovementService — idempotency', () => {
  it('applies the stock movement the first time a document reaches COMPLETE', async () => {
    const document = makeDocument(DocumentTypeEnum.INWARD_REGISTER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      sourceRecord: Object.assign(new InwardRegister(), {
        id: 'src-1',
        inwardNo: 'IWD0001',
        companyName: COMPANY,
        location: LOCATION,
        inwardProducts: [
          { id: 'i1', productName: PRODUCT, variant: VARIANT, netWeight: 100, quantity: 10, unitPrice: 5 },
        ],
      }),
    });

    await harness.service.completeDocumentWithInventory(document);

    expect(harness.updates).toHaveLength(1);
    expect(harness.transaction.committed).toBe(true);
    expect(harness.documentUpdates[0].values.inventoryProcessed).toBe(true);
  });

  it('does NOT apply the movement a second time when inventoryProcessed is already true', async () => {
    const document = makeDocument(DocumentTypeEnum.INWARD_REGISTER);

    const harness = buildHarness({
      // Simulates the row a concurrent/repeated approval would read back.
      lockedDocument: { ...document, inventoryProcessed: true },
      sourceRecord: Object.assign(new InwardRegister(), {
        id: 'src-1',
        companyName: COMPANY,
        location: LOCATION,
        inwardProducts: [
          { id: 'i1', productName: PRODUCT, variant: VARIANT, netWeight: 100, quantity: 10, unitPrice: 5 },
        ],
      }),
    });

    await harness.service.completeDocumentWithInventory(document);

    expect(harness.updates).toHaveLength(0);
    expect(harness.inserts).toHaveLength(0);
    expect(harness.transaction.committed).toBe(true);
  });

  it('applies nothing when the document is moving to a non-COMPLETE status', async () => {
    const document = makeDocument(DocumentTypeEnum.DC_TYPE_CUSTOMER, {
      status: DocumentStatus.REJECT,
    });

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
    });

    await harness.service.completeDocumentWithInventory(document);

    expect(harness.updates).toHaveLength(0);
    expect(harness.documentUpdates[0].values.inventoryProcessed).toBe(false);
  });

  it('rolls back and rethrows when the movement fails', async () => {
    const document = makeDocument(DocumentTypeEnum.INWARD_REGISTER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      sourceRecord: null, // source row missing -> AppError
    });

    await expect(harness.service.completeDocumentWithInventory(document)).rejects.toThrow();

    expect(harness.transaction.rolledBack).toBe(true);
    expect(harness.transaction.committed).toBe(false);
    expect(harness.transaction.released).toBe(true);
  });
});

describe('InventoryMovementService — direction and amounts per document type', () => {
  it('Inward Register INCREASES stock (qty from netWeight, value from unitPrice x quantity)', async () => {
    const document = makeDocument(DocumentTypeEnum.INWARD_REGISTER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      sourceRecord: Object.assign(new InwardRegister(), {
        id: 'src-1',
        companyName: COMPANY,
        location: LOCATION,
        inwardProducts: [
          { id: 'i1', productName: PRODUCT, variant: VARIANT, netWeight: 100, quantity: 10, unitPrice: 5 },
        ],
      }),
    });

    await harness.service.completeDocumentWithInventory(document);

    expect(harness.updates[0]).toMatchObject({
      qtyDelta: 100,
      amtDelta: 50,
      dumpQtyDelta: 0,
      dumpAmtDelta: 0,
    });
  });

  it('Customer Delivery Challan REDUCES stock at the from-location', async () => {
    const document = makeDocument(DocumentTypeEnum.DC_TYPE_CUSTOMER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      sourceRecord: Object.assign(new CustomerDeliveryChallan(), {
        id: 'src-1',
        challanNo: 'C0001',
        companyName: COMPANY,
        fromLocation: LOCATION,
        deliveryChallanProducts: [
          { id: 'p1', productName: PRODUCT, variant: VARIANT, netWeight: 40, amount: 400 },
        ],
      }),
    });

    await harness.service.completeDocumentWithInventory(document);

    expect(harness.updates[0]).toMatchObject({ qtyDelta: -40, amtDelta: -400 });
    expect(harness.updates[0].where.locationId).toBe('location-1');
  });

  it('Stock Transfer Delivery Challan REDUCES stock at the from-location only', async () => {
    const document = makeDocument(DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      sourceRecord: Object.assign(new StockTransferDeliveryChallan(), {
        id: 'src-1',
        challanNo: 'S0001',
        companyName: COMPANY,
        fromLocation: LOCATION,
        toLocation: { id: 'location-2' },
        deliveryChallanProducts: [
          { id: 'p1', productName: PRODUCT, variant: VARIANT, netWeight: 25, amount: 250 },
        ],
      }),
    });

    await harness.service.completeDocumentWithInventory(document);

    // Exactly one write, and it is against the FROM location.
    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0]).toMatchObject({ qtyDelta: -25, amtDelta: -250 });
    expect(harness.updates[0].where.locationId).toBe('location-1');
  });

  it('Dump Register reduces inward AND increases the dump counters', async () => {
    const document = makeDocument(DocumentTypeEnum.DUMP_REGISTER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      sourceRecord: Object.assign(new DumpRegister(), {
        id: 'src-1',
        dumpNo: 'DMP0001',
        companyName: COMPANY,
        location: LOCATION,
        dumpProducts: [
          { id: 'd1', productName: PRODUCT, variant: VARIANT, quantity: 12, amount: 120 },
        ],
      }),
    });

    await harness.service.completeDocumentWithInventory(document);

    expect(harness.updates[0]).toMatchObject({
      qtyDelta: -12,
      amtDelta: -120,
      dumpQtyDelta: 12,
      dumpAmtDelta: 120,
    });
  });

  it('Return To Vendor REDUCES stock (value from unitPrice x quantity)', async () => {
    const document = makeDocument(DocumentTypeEnum.RETURN_TO_VENDOR);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      sourceRecord: Object.assign(new ReturnToVendor(), {
        id: 'src-1',
        rtvNo: 'RTV0001',
        companyName: COMPANY,
        location: LOCATION,
        rtvProducts: [
          { id: 'r1', productName: PRODUCT, variant: VARIANT, netWeight: 30, quantity: 3, unitPrice: 20 },
        ],
      }),
    });

    await harness.service.completeDocumentWithInventory(document);

    expect(harness.updates[0]).toMatchObject({ qtyDelta: -30, amtDelta: -60 });
  });

  it('Other Delivery Challan moves no stock (behaviour deliberately unchanged)', async () => {
    const document = makeDocument(DocumentTypeEnum.DC_TYPE_OTHER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
    });

    await harness.service.completeDocumentWithInventory(document);

    expect(harness.updates).toHaveLength(0);
    expect(harness.inserts).toHaveLength(0);
    // The document is still marked processed so it is never revisited.
    expect(harness.documentUpdates[0].values.inventoryProcessed).toBe(true);
  });
});

describe('InventoryMovementService — availability and row creation', () => {
  it('blocks a Customer Delivery Challan whose stock has been consumed since creation', async () => {
    const document = makeDocument(DocumentTypeEnum.DC_TYPE_CUSTOMER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      availableQty: 5, // only 5 left, challan wants 40
      sourceRecord: Object.assign(new CustomerDeliveryChallan(), {
        id: 'src-1',
        challanNo: 'C0001',
        companyName: COMPANY,
        fromLocation: LOCATION,
        deliveryChallanProducts: [
          { id: 'p1', productName: PRODUCT, variant: VARIANT, netWeight: 40, amount: 400 },
        ],
      }),
    });

    await expect(harness.service.completeDocumentWithInventory(document)).rejects.toThrow(
      /Insufficient stock/,
    );

    expect(harness.updates).toHaveLength(0);
    expect(harness.transaction.rolledBack).toBe(true);
  });

  it('creates the stock row carrying the delta when none exists yet', async () => {
    const document = makeDocument(DocumentTypeEnum.DUMP_REGISTER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      updateAffected: 0, // no existing inventory_stock row
      sourceRecord: Object.assign(new DumpRegister(), {
        id: 'src-1',
        companyName: COMPANY,
        location: LOCATION,
        dumpProducts: [
          { id: 'd1', productName: PRODUCT, variant: VARIANT, quantity: 7, amount: 70 },
        ],
      }),
    });

    await harness.service.completeDocumentWithInventory(document);

    expect(harness.inserts).toHaveLength(1);
    // The decrement must survive on the create path — the previous dump code
    // wrote inwardQty: 0 here and silently lost it.
    expect(harness.inserts[0]).toMatchObject({
      inwardQty: -7,
      inwardAmt: -70,
      dumpQty: 7,
      dumpAmt: 70,
    });
  });

  it('matches on variant IS NULL for a line with no variant', async () => {
    const document = makeDocument(DocumentTypeEnum.INWARD_REGISTER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      sourceRecord: Object.assign(new InwardRegister(), {
        id: 'src-1',
        companyName: COMPANY,
        location: LOCATION,
        inwardProducts: [
          { id: 'i1', productName: PRODUCT, variant: null, netWeight: 8, quantity: 2, unitPrice: 4 },
        ],
      }),
    });

    await harness.service.completeDocumentWithInventory(document);

    expect(harness.updates[0].variantIsNull).toBe(true);
    expect(harness.updates[0].where.variantId).toBeUndefined();
  });
});

describe('InventoryMovementService — pre-flight check (assertMovementIsApplicable)', () => {
  it('throws before anything is written when stock is no longer available', async () => {
    const document = makeDocument(DocumentTypeEnum.DC_TYPE_CUSTOMER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      availableQty: 5,
      sourceRecord: Object.assign(new CustomerDeliveryChallan(), {
        id: 'src-1',
        challanNo: 'C0001',
        companyName: COMPANY,
        fromLocation: LOCATION,
        deliveryChallanProducts: [
          { id: 'p1', productName: PRODUCT, variant: VARIANT, netWeight: 40, amount: 400 },
        ],
      }),
    });

    await expect(harness.service.assertMovementIsApplicable(document)).rejects.toThrow(
      /Insufficient stock/,
    );

    // Crucially: no writes and no transaction were started, so the caller can
    // safely abort before recording the approver's stage.
    expect(harness.updates).toHaveLength(0);
    expect(harness.inserts).toHaveLength(0);
    expect(harness.documentUpdates).toHaveLength(0);
  });

  it('passes silently when stock is sufficient', async () => {
    const document = makeDocument(DocumentTypeEnum.DC_TYPE_CUSTOMER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      availableQty: 500,
      sourceRecord: Object.assign(new CustomerDeliveryChallan(), {
        id: 'src-1',
        companyName: COMPANY,
        fromLocation: LOCATION,
        deliveryChallanProducts: [
          { id: 'p1', productName: PRODUCT, variant: VARIANT, netWeight: 40, amount: 400 },
        ],
      }),
    });

    await expect(harness.service.assertMovementIsApplicable(document)).resolves.toBeUndefined();
    expect(harness.updates).toHaveLength(0);
  });

  it('is a no-op for a document whose inventory was already processed', async () => {
    const document = makeDocument(DocumentTypeEnum.DC_TYPE_CUSTOMER, {
      inventoryProcessed: true,
    });

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: true },
      availableQty: 0,
    });

    await expect(harness.service.assertMovementIsApplicable(document)).resolves.toBeUndefined();
  });

  it('is a no-op for document types that do not move stock', async () => {
    const document = makeDocument(DocumentTypeEnum.DC_TYPE_OTHER);

    const harness = buildHarness({
      lockedDocument: { ...document, inventoryProcessed: false },
      availableQty: 0,
    });

    await expect(harness.service.assertMovementIsApplicable(document)).resolves.toBeUndefined();
  });
});
