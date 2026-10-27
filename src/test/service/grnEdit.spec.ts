import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { amountInWords, computeGrnTotals, diffGrnLines, grnEditSnapshot, toGrnLineState } from '../../grn/grnEdit';
import { GrnService } from '../../grn/service/grn.service';
import { DocumentStatus } from '../../approvalFlow/entity/docuemnt.entity';
import { GrnPaymentStatus } from '../../utils/status.enum';

const line = (overrides: Record<string, unknown> = {}) => ({
  id: 'l1',
  productName: { id: 'p1' },
  variant: { id: 'v1' },
  uom: { id: 'kg' },
  grade: 'A',
  rtv: false,
  quantity: '100.00',
  unitPrice: '12.50',
  grossWeight: '105.000',
  packingMaterialWeight: '50.000',
  netWeight: '100.000',
  purchaseDate: '2026-10-20',
  dispatchDate: '2026-10-21',
  deliveryDate: '2026-10-22',
  expectedHarvestDate: null,
  packagingMaterial: { id: 'crate' },
  ...overrides,
});

describe('GRN money totals (computed on the server)', () => {
  it('words the total like the GRN form did', () => {
    expect(amountInWords(0)).toBe('Zero Rupees');
    expect(amountInWords(1250)).toBe('One Thousand Two Hundred Fifty Rupees');
    expect(amountInWords(120000)).toBe('One Lakh Twenty Thousand Rupees');
    expect(amountInWords(12345678)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees');
    expect(amountInWords(99.6)).toBe('One Hundred Rupees');
  });

  it('line amount = quantity x unit price; total adds freight and other charges; remaining subtracts the advance', () => {
    const totals = computeGrnTotals({
      lines: [{ quantity: '100', unitPrice: '12.5' }, { quantity: 3, unitPrice: 0.335 }],
      freight: '200',
      otherCharges: 50.5,
      advancePaidAmt: '500',
      hasPaymentInfo: true,
    });
    expect(totals.lineAmounts).toEqual([1250, 1.01]);
    expect(totals.subTotalAmt).toBe(1251.01);
    expect(totals.totalAmt).toBe(1501.51);
    expect(totals.remainingAmt).toBe(1001.51);
    expect(totals.amtWords).toBe('One Thousand Five Hundred Two Rupees');
  });

  it('has no remaining amount without payment info, and treats blanks as 0', () => {
    const totals = computeGrnTotals({ lines: [{ quantity: '', unitPrice: null }], hasPaymentInfo: false });
    expect(totals).toMatchObject({ lineAmounts: [0], subTotalAmt: 0, totalAmt: 0, remainingAmt: null });
  });
});

describe('GRN line history diff', () => {
  const before = [toGrnLineState(line()), toGrnLineState(line({ id: 'l2', productName: { id: 'p2' } }))];

  it('records added, removed and updated lines', () => {
    const after = [
      toGrnLineState(line({ quantity: 90 })), // updated quantity
      toGrnLineState(line({ id: 'l3', productName: { id: 'p3' } })), // added
    ];
    const changes = diffGrnLines(before, after);
    expect(changes.map((c) => [c.changeType, (c.after ?? c.before)!.id])).toEqual([
      ['updated', 'l1'],
      ['added', 'l3'],
      ['removed', 'l2'],
    ]);
    expect(changes[0].before!.quantity).toBe(100);
    expect(changes[0].after!.quantity).toBe(90);
  });

  it.each([
    ['unit', { uom: { id: 'box' } }],
    ['gross weight', { grossWeight: 110 }],
    ['packing weight', { packingMaterialWeight: 40 }],
    ['net weight', { netWeight: 99 }],
    ['purchase date', { purchaseDate: '2026-10-19' }],
    ['dispatch date', { dispatchDate: '2026-10-23' }],
    ['delivery date', { deliveryDate: '2026-10-24' }],
    ['harvest date', { expectedHarvestDate: '2026-10-10' }],
    ['packaging', { packagingMaterial: null }],
    ['rate', { unitPrice: 13 }],
  ])('tracks a change of %s', (_label, change) => {
    const changes = diffGrnLines([before[0]], [toGrnLineState(line(change))]);
    expect(changes).toHaveLength(1);
    expect(changes[0].changeType).toBe('updated');
  });

  it('ignores untracked fields and equal values in another form (grade, RTV, "100.00" vs 100, Date vs text)', () => {
    const same = toGrnLineState(line({ grade: 'B', rtv: true, quantity: 100, unitPrice: 12.5, purchaseDate: new Date('2026-10-20T00:00:00.000Z') }));
    expect(diffGrnLines([before[0]], [same])).toEqual([]);
  });
});

describe('GRN change detection (approval restarts only on a change)', () => {
  const grn = {
    companyName: { id: 'c1' },
    purchaseLocation: { id: 'b1' },
    deliveryMode: 'cc',
    freight: '100.00',
    cratesIn: 3,
    remark: null,
    paymentInfo: { paymentMode: 'cash', advancePaidAmt: '0.00', paymentDate: '2026-10-20', creditPeriod: 7 },
    grnProducts: [line()],
  };

  it('treats the same data in another runtime form as unchanged', () => {
    const reloaded = {
      ...grn,
      companyName: 'c1',
      freight: 100,
      remark: '',
      paymentInfo: { ...grn.paymentInfo, advancePaidAmt: 0, paymentDate: new Date('2026-10-20T00:00:00.000Z') },
      grnProducts: [line({ quantity: 100, unitPrice: 12.5 })],
    };
    expect(grnEditSnapshot(reloaded)).toBe(grnEditSnapshot(grn));
  });

  it.each([
    ['a header field', { remark: 'checked' }],
    ['the delivery mode', { deliveryMode: 'dc' }],
    ['freight', { freight: 150 }],
    ['payment info', { paymentInfo: { ...grn.paymentInfo, advancePaidAmt: 500 } }],
    ['a line grade (not in history, but still a change)', { grnProducts: [line({ grade: 'B' })] }],
    ['a removed line', { grnProducts: [] }],
  ])('detects a change of %s', (_label, change) => {
    expect(grnEditSnapshot({ ...grn, ...change })).not.toBe(grnEditSnapshot(grn));
  });
});

describe('who may edit a GRN, and when', () => {
  const service: any = Object.create(GrnService.prototype);
  const manager = (status: string | null, livePayments = false): any => ({
    query: jest.fn().mockImplementation(async (sql: string) =>
      /grn_payments/.test(sql) ? (livePayments ? [{ '?column?': 1 }] : []) : status ? [{ status }] : [],
    ),
  });
  const grn = (overrides: Record<string, unknown> = {}): any => ({
    id: 'g1', grnNo: 'G-1', createdBy: { id: 'creator' }, ammountStatus: GrnPaymentStatus.UNPAID, ...overrides,
  });

  it('lets the creator edit while the approval is open and the GRN is unpaid (an advance does not count)', async () => {
    for (const status of [DocumentStatus.HOLD, DocumentStatus.VERIFIED, DocumentStatus.APPROVED, DocumentStatus.FINALIZING]) {
      await expect(service.assertGrnEditable(manager(status), grn({ paymentInfo: { advancePaidAmt: 500 } }), 'creator')).resolves.toBeUndefined();
    }
  });

  it('refuses anyone but the creator (403)', async () => {
    await expect(service.assertGrnEditable(manager('hold'), grn(), 'someone-else')).rejects.toMatchObject({
      statusCode: 403,
      message: 'Only the creator of GRN G-1 can edit it',
    });
    await expect(service.assertGrnEditable(manager('hold'), grn({ createdBy: null }), 'creator')).rejects.toMatchObject({ statusCode: 403 });
  });

  it.each([
    [DocumentStatus.REJECT, {}, 'GRN G-1 was rejected, so it can no longer be edited'],
    [DocumentStatus.COMPLETE, {}, 'GRN G-1 has completed its approval, so it can no longer be edited'],
    [DocumentStatus.HOLD, { ammountStatus: GrnPaymentStatus.PAID }, 'GRN G-1 is paid, so it can no longer be edited'],
  ])('refuses a %s / paid GRN (409)', async (status, overrides, message) => {
    await expect(service.assertGrnEditable(manager(status), grn(overrides), 'creator')).rejects.toMatchObject({ statusCode: 409, message });
  });

  it('refuses a GRN with any recorded payment: partially paid, or a live payment row (payment history G1)', async () => {
    const message = 'GRN G-1 has recorded payments, so it can no longer be edited';
    await expect(service.assertGrnEditable(manager(DocumentStatus.HOLD), grn({ ammountStatus: GrnPaymentStatus.PARTIAL }), 'creator'))
      .rejects.toMatchObject({ statusCode: 409, message });
    await expect(service.assertGrnEditable(manager(DocumentStatus.HOLD, true), grn(), 'creator'))
      .rejects.toMatchObject({ statusCode: 409, message });
  });
});

describe('GRN line and history wiring', () => {
  let dataSource: DataSource;
  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', entities: ['src/**/*.entity{.ts,.js}'] });
    await (dataSource as any).buildMetadatas();
  }, 120000);

  it('deletes a GRN line left out of a save instead of detaching it', () => {
    expect(dataSource.getMetadata('GrnProduct').findRelationWithPropertyPath('grn')!.orphanedRowAction).toBe('delete');
  });

  it("keeps a removed line's history: the line link is nullable and set null on delete", () => {
    const relation = dataSource.getMetadata('GrnProductHistory').findRelationWithPropertyPath('grnProduct')!;
    expect(relation.isNullable).toBe(true);
    expect(relation.onDelete).toBe('SET NULL');
  });
});
