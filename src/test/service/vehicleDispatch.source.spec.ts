/**
 * Vehicle Dispatch — the pure parts of the source resolver
 * (src/vehicleDispatch/service/dispatchSource.ts): register validation, copying
 * GRN / delivery challan lines, totals, party names and the "live dispatch" SQL
 * that enforces one dispatch per source.
 */

import 'reflect-metadata';

import {
  assertDispatchType,
  dcLine,
  grnLine,
  isDispatchType,
  liveDispatchExistsSql,
  partyName,
  SOURCE_DOCUMENT_TYPE,
  SOURCE_FK_COLUMN,
  totalsOf,
} from '../../vehicleDispatch/service/dispatchSource';
import { DispatchType } from '../../vehicleDispatch/entity/vehicleDispatch.entity';
import { Source } from '../../utils/status.enum';

describe('dispatch type', () => {
  it('accepts the three registers', () => {
    expect(isDispatchType('purchase')).toBe(true);
    expect(isDispatchType('stock-transfer')).toBe(true);
    expect(isDispatchType('sales')).toBe(true);
    expect(assertDispatchType('sales')).toBe(DispatchType.SALES);
  });

  it('rejects anything else with 400', () => {
    expect(isDispatchType('transfer')).toBe(false);
    expect(() => assertDispatchType(undefined)).toThrow('dispatchType must be one of purchase, stock-transfer, sales');
    try {
      assertDispatchType('nonsense');
    } catch (e: any) {
      expect(e.statusCode).toBe(400);
    }
  });

  it('maps each register to its source document type and dispatch column', () => {
    expect(SOURCE_DOCUMENT_TYPE[DispatchType.PURCHASE]).toBe('grn');
    expect(SOURCE_DOCUMENT_TYPE[DispatchType.STOCK_TRANSFER]).toBe('DC_TYPE_STOCK_TRANSFER');
    expect(SOURCE_DOCUMENT_TYPE[DispatchType.SALES]).toBe('DC_TYPE_CUSTOMER');
    expect(SOURCE_FK_COLUMN[DispatchType.PURCHASE]).toBe('grn_id');
    expect(SOURCE_FK_COLUMN[DispatchType.STOCK_TRANSFER]).toBe('delivery_challan_id');
    expect(SOURCE_FK_COLUMN[DispatchType.SALES]).toBe('delivery_challan_id');
  });
});

describe('copying source lines', () => {
  const product = { id: 'p1', name: 'Tomato' };
  const variant = { id: 'v1', variantName: 'Grade A' };
  const uom = { id: 'u1', unit: 'KG' };

  it('GRN line: decimals become numbers, no packaging material name, weights kept', () => {
    const line = grnLine({
      productName: product, variant, uom,
      quantity: '100.00', revisedQuantity: null, unitPrice: '12.50', revisedRate: null, amount: '1250.00',
      packingMaterialWeight: '500.000', grossWeight: '1050.000', netWeight: '1000.000',
    } as any);
    expect(line).toEqual({
      productId: 'p1', productName: 'Tomato', variantId: 'v1', variantName: 'Grade A', uomId: 'u1', uomName: 'KG',
      quantity: 100, unitPrice: 12.5, amount: 1250,
      packagingMaterialId: null, packagingMaterialName: null,
      packingMaterialWeight: 500, grossWeight: 1050, netWeight: 1000,
    });
  });

  it('GRN line: revised quantity and rate win when present', () => {
    const line = grnLine({ productName: product, quantity: '100', revisedQuantity: '90', unitPrice: '12', revisedRate: '11', amount: '990' } as any);
    expect(line.quantity).toBe(90);
    expect(line.unitPrice).toBe(11);
    expect(line.amount).toBe(990);
  });

  it('GRN line: missing relations and values become null', () => {
    const line = grnLine({} as any);
    expect(line.productId).toBeNull();
    expect(line.quantity).toBeNull();
    expect(line.netWeight).toBeNull();
  });

  it('DC item: carries the packaging material', () => {
    const line = dcLine({
      productName: product, variant: null, uom,
      quantity: '20.000', unitPrice: '30.0000', amount: '600.0000',
      packagingMaterial: { id: 'pm1', packagingMaterialName: 'Crate 20 kg' },
      packingMaterialWeight: '1500.0000', grossWeight: '430.0000', netWeight: '400.0000',
    } as any);
    expect(line.packagingMaterialId).toBe('pm1');
    expect(line.packagingMaterialName).toBe('Crate 20 kg');
    expect(line.variantId).toBeNull();
    expect(line.netWeight).toBe(400);
  });
});

describe('totalsOf', () => {
  it('adds up quantity, weights and amount, treating null as 0 and rounding', () => {
    expect(
      totalsOf([
        { quantity: 1.1, grossWeight: 10.12345, netWeight: 9.5, amount: 100.1 },
        { quantity: 2.2, grossWeight: null, netWeight: 0.25, amount: null },
      ] as any),
    ).toEqual({ quantity: 3.3, grossWeight: 10.1235, netWeight: 9.75, amount: 100.1 });
  });

  it('is all zero for no lines', () => {
    expect(totalsOf([])).toEqual({ quantity: 0, grossWeight: 0, netWeight: 0, amount: 0 });
  });
});

describe('partyName', () => {
  it('uses the vendor company name or the farmer full name by source', () => {
    expect(partyName(Source.VENDOR, { companyName: 'Ajay Fruits' }, null)).toBe('Ajay Fruits');
    expect(partyName(Source.FARMER, null, { farmerfName: 'Raju', farmermName: null, farmerlName: 'Patil' })).toBe('Raju Patil');
  });

  it('is null when the source or party is missing', () => {
    expect(partyName(null, { companyName: 'x' }, null)).toBeNull();
    expect(partyName(Source.FARMER, { companyName: 'x' }, null)).toBeNull();
  });
});

describe('liveDispatchExistsSql', () => {
  it('ignores deleted and rejected dispatches and matches the register', () => {
    const sql = liveDispatchExistsSql('g.id', DispatchType.PURCHASE);
    expect(sql).toContain('ld."grn_id" = g.id');
    expect(sql).toContain(`ld."dispatchType"::text = 'purchase'`);
    expect(sql).toContain('ld."deletedAt" IS NULL');
    expect(sql).toContain(`ldd.status::text = 'REJECT'`);
    expect(sql.startsWith('EXISTS (')).toBe(true);
  });

  it('uses the delivery challan link for stock transfer and sales', () => {
    expect(liveDispatchExistsSql('dc.id', DispatchType.SALES)).toContain('ld."delivery_challan_id" = dc.id');
    expect(liveDispatchExistsSql('dc.id', DispatchType.STOCK_TRANSFER)).toContain(`'stock-transfer'`);
  });
});
