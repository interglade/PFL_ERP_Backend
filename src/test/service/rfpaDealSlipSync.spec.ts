import { assertDocumentEditable, editLockMessage, isDocumentLocked } from '../../approvalFlow/documentEditLock';
import { DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { DealSlipState, planDealSlipEdit, toDateOnly, validateDealSlipLine } from '../../dealSlip/dealSlipEdit';
import { dealSlipApproverId } from '../../dealSlip/dealSlipApprover';
import { copyRfpaPaymentInfo, copyRfpaProducts, dealSlipHeaderFromRfpa } from '../../dealSlip/service/dealSlipRfpaCopy';
import { formatProcurementHeader, formatProcurementLine } from '../../procurement/procurementDetail';

const LINE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const slip = (overrides: Partial<DealSlipState> = {}): DealSlipState => ({
  source: 'vendor',
  lotNo: '',
  loadingLocation: '',
  specialRequest: '',
  remark: '',
  lines: [
    {
      id: LINE_A,
      productName: 'prod-1',
      variant: 'var-1',
      grade: 'A',
      uom: 'uom-kg',
      quantity: 100,
      unitPrice: 20,
      purchaseDate: '2026-10-20',
      dispatchDate: '2026-10-21',
      deliveryDate: '2026-10-22',
      expectedHarvestDate: null,
    },
    {
      id: LINE_B,
      productName: 'prod-2',
      variant: null,
      grade: null,
      uom: 'uom-box',
      quantity: 5,
      unitPrice: 300,
      purchaseDate: '2026-10-20',
      dispatchDate: '2026-10-20',
      deliveryDate: '2026-10-25',
      expectedHarvestDate: null,
    },
  ],
  ...overrides,
});

const submit = { lotNo: 'LOT-7', loadingLocation: 'Nashik' };

describe('document edit lock', () => {
  it('locks approved and rejected documents, nothing else', () => {
    expect(isDocumentLocked(DocumentStatus.COMPLETE)).toBe(true);
    expect(isDocumentLocked(DocumentStatus.REJECT)).toBe(true);
    for (const open of [DocumentStatus.DRAFT, DocumentStatus.HOLD, DocumentStatus.APPROVED, null, undefined]) {
      expect(isDocumentLocked(open as any)).toBe(false);
    }
  });

  it('explains why', () => {
    expect(editLockMessage('RFPA R1', DocumentStatus.COMPLETE)).toBe('RFPA R1 is approved; it can no longer be changed');
    expect(editLockMessage('RFPA R1', DocumentStatus.REJECT)).toBe('RFPA R1 was rejected; it can no longer be changed');
    expect(editLockMessage('RFPA R1', DocumentStatus.HOLD, true)).toMatch(/deleted/);
    expect(editLockMessage('RFPA R1', DocumentStatus.HOLD)).toBeNull();
  });

  it('throws 409 for a rejected document whoever asks (no admin bypass exists)', async () => {
    const manager: any = { findOne: jest.fn().mockResolvedValue({ status: DocumentStatus.REJECT, isDeleted: false }) };
    await expect(assertDocumentEditable(manager, DocumentTypeEnum.DEAL_SLIP, 'x', 'Deal Slip DL1')).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('returns the document while it is still open', async () => {
    const doc = { status: DocumentStatus.DRAFT, isDeleted: false };
    const manager: any = { findOne: jest.fn().mockResolvedValue(doc) };
    await expect(assertDocumentEditable(manager, DocumentTypeEnum.DEAL_SLIP, 'x', 'Deal Slip DL1')).resolves.toBe(doc);
  });
});

describe('deal slip edit rules', () => {
  it('saves the four slip fields', () => {
    const plan = planDealSlipEdit({ ...submit, specialRequest: ' crates ', remark: 'ok' }, slip());
    expect(plan.header).toEqual({ lotNo: 'LOT-7', loadingLocation: 'Nashik', specialRequest: 'crates', remark: 'ok' });
    expect(plan.lines).toEqual([]);
  });

  it('requires lot no and loading location to submit', () => {
    expect(() => planDealSlipEdit({ lotNo: 'LOT-7' }, slip())).toThrow(/Lot no and loading location are required/);
    expect(() => planDealSlipEdit({ lotNo: ' ', loadingLocation: 'Nashik' }, slip())).toThrow(/required/);
    // Already filled on the slip: a later edit need not resend them.
    expect(() => planDealSlipEdit({ remark: 'x' }, slip({ lotNo: 'L', loadingLocation: 'N' }))).not.toThrow();
  });

  it('changes the seven editable line fields', () => {
    const plan = planDealSlipEdit(
      {
        ...submit,
        dealSlipProducts: [
          {
            id: LINE_A,
            uom: 'uom-box',
            quantity: 80,
            unitPrice: '22.5',
            purchaseDate: '21-10-2026',
            dispatchDate: '2026-10-22T00:00:00.000Z',
            deliveryDate: '2026-10-23',
          },
        ],
      },
      slip(),
    );
    expect(plan.lines).toEqual([
      expect.objectContaining({
        id: LINE_A,
        uom: 'uom-box',
        quantity: 80,
        unitPrice: 22.5,
        purchaseDate: '2026-10-21',
        dispatchDate: '2026-10-22',
        deliveryDate: '2026-10-23',
        productName: 'prod-1',
        variant: 'var-1',
        grade: 'A',
      }),
    ]);
    expect(plan.uomIds).toEqual(['uom-box']);
  });

  it('accepts product, variant and grade echoed back unchanged', () => {
    const body = {
      ...submit,
      dealSlipProducts: [{ id: LINE_A, productName: 'prod-1', variant: { id: 'var-1' }, grade: 'A', amount: 1, rfpaQuantity: 9, quantity: 90 }],
    };
    expect(planDealSlipEdit(body, slip()).lines[0].quantity).toBe(90);
  });

  it.each([
    [{ variant: 'var-2' }, 'dealSlipProducts[0].variant'],
    [{ productName: 'prod-9' }, 'dealSlipProducts[0].productName'],
    [{ grade: 'B' }, 'dealSlipProducts[0].grade'],
  ])('rejects a changed locked line field %j', (change, key) => {
    expect(() => planDealSlipEdit({ ...submit, dealSlipProducts: [{ id: LINE_A, ...change }] }, slip())).toThrow(
      `${key} cannot be changed on a Deal Slip`,
    );
  });

  it('rejects copied header fields and line deletes, listing every key', () => {
    expect(() =>
      planDealSlipEdit({ ...submit, companyName: 'c', paymentInfo: {}, deletedDealSlipProductIds: [LINE_B] }, slip()),
    ).toThrow('companyName, paymentInfo, deletedDealSlipProductIds cannot be changed on a Deal Slip');
  });

  it('ignores read-only meta keys the edit form echoes', () => {
    expect(() =>
      planDealSlipEdit({ ...submit, id: 'x', dealSlipNo: 'DL1', rfpa: 'R1', overAllStatus: 'Draft', documentId: 'd' }, slip()),
    ).not.toThrow();
  });

  it('does not let lines be added or taken from another slip', () => {
    expect(() => planDealSlipEdit({ ...submit, dealSlipProducts: [{ quantity: 3, unitPrice: 4 }] }, slip())).toThrow(
      /cannot be added/,
    );
    expect(() => planDealSlipEdit({ ...submit, dealSlipProducts: [{ id: 'other-line', quantity: 3 }] }, slip())).toThrow(
      /does not belong to this Deal Slip/,
    );
    expect(() =>
      planDealSlipEdit({ ...submit, dealSlipProducts: [{ id: LINE_A, quantity: 3 }, { id: LINE_A, quantity: 4 }] }, slip()),
    ).toThrow(/more than once/);
  });

  it.each([
    [{ quantity: 0 }, /whole number greater than 0/],
    [{ quantity: 1.5 }, /whole number greater than 0/],
    [{ unitPrice: 0 }, /unit price must be greater than 0/],
    [{ uom: null }, /unit is required/],
    [{ dispatchDate: '2026-10-19' }, /dispatch date must be on or after the purchase date/],
    [{ deliveryDate: '2026-10-20' }, /expected delivery date must be on or after the dispatch date/],
    [{ purchaseDate: null }, /purchase date is required/],
  ])('validates the resulting line %j', (change, message) => {
    expect(() => planDealSlipEdit({ ...submit, dealSlipProducts: [{ id: LINE_A, ...change }] }, slip())).toThrow(message);
  });

  it('needs the expected harvest date, before the purchase date, on a farmer slip', () => {
    const farmer = slip({ source: 'farmer' });
    expect(() => planDealSlipEdit(submit, farmer)).toThrow(/Product line 1: expected harvest date is required/);
    const harvestAfter = { ...submit, dealSlipProducts: [{ id: LINE_A, expectedHarvestDate: '2026-10-20' }, { id: LINE_B, expectedHarvestDate: '2026-10-01' }] };
    expect(() => planDealSlipEdit(harvestAfter, farmer)).toThrow(/purchase date must be after the expected harvest date/);
    const ok = { ...submit, dealSlipProducts: [{ id: LINE_A, expectedHarvestDate: '2026-10-01' }, { id: LINE_B, expectedHarvestDate: '2026-10-01' }] };
    expect(() => planDealSlipEdit(ok, farmer)).not.toThrow();
  });

  it('checks untouched lines too, so only a complete slip can be submitted', () => {
    const broken = slip();
    broken.lines[1] = { ...broken.lines[1], deliveryDate: null };
    expect(() => planDealSlipEdit(submit, broken)).toThrow(/Product line 2: expected delivery date is required/);
  });

  it('normalises dates', () => {
    expect(toDateOnly('05-01-2026')).toBe('2026-01-05');
    expect(toDateOnly('')).toBeNull();
    expect(toDateOnly(new Date('2026-03-04T00:00:00.000Z'))).toBe('2026-03-04');
    expect(() => toDateOnly('soon')).toThrow(/Invalid date/);
    expect(() => validateDealSlipLine(slip().lines[0], 'vendor', 1)).not.toThrow();
  });
});

describe('RFPA -> Deal Slip copy', () => {
  const rfpa: any = {
    requestingDepartment: undefined,
    companyName: { id: 'co' },
    purchaseLocation: { id: 'b1' },
    purchaseForSalesLocation: { id: 'b2' },
    otherPurchaseLoc: 'other 1',
    otherPurchaseForSalesLoc: 'other 2',
    deliveryReceivingPerson: 'Ravi',
    packingInstruction: 'crates',
    selectedVendor: { id: 'v' },
    selectedFarmer: null,
    source: 'vendor',
    specialReq: 'RFPA special request',
    remark: 'RFPA remark',
    paymentInfo: {
      paymentMode: 'cash', paymentDate: '2026-10-01', advancePaidAmt: 10, paymentTerms: 30,
      dueDate: '2026-10-31', creditPeriod: 30, validityOfQuote: '7 days',
    },
    rfpaProducts: [
      {
        id: 'rl1', productName: { id: 'p' }, variant: { id: 'v1' }, grade: 'A', quantity: 4, uom: { id: 'u' },
        unitPrice: 5, amount: 20, purchaseDate: '2026-10-02', expectedHarvestDate: '2026-10-01',
        dispatchDate: '2026-10-03', deliveryDate: '2026-10-04',
      },
    ],
  };

  it('copies every RFPA header field except special request and remark', () => {
    const header = dealSlipHeaderFromRfpa(rfpa);
    expect(header).toEqual({
      companyName: rfpa.companyName,
      purchaseLocation: rfpa.purchaseLocation,
      purchaseForSalesLocation: rfpa.purchaseForSalesLocation,
      otherPurchaseLoc: 'other 1',
      otherPurchaseForSalesLoc: 'other 2',
      deliveryReceivingPerson: 'Ravi',
      packingInstruction: 'crates',
      selectedVendor: rfpa.selectedVendor,
      selectedFarmer: null,
      source: 'vendor',
    });
    expect(header).not.toHaveProperty('specialReq');
    expect(header).not.toHaveProperty('specialRequest');
    expect(header).not.toHaveProperty('remark');
  });

  it('copies the payment info into a new row', async () => {
    const manager: any = { create: jest.fn((_e, v) => ({ ...v })), save: jest.fn(async (v) => v) };
    const copy = await copyRfpaPaymentInfo(manager, rfpa);
    expect(copy).toEqual(rfpa.paymentInfo);
    expect(copy).not.toBe(rfpa.paymentInfo);
  });

  it('copies every product line field and links the RFPA line', async () => {
    const manager: any = { create: jest.fn((_e, v) => ({ ...v })), save: jest.fn(async (v) => v) };
    const dealSlip: any = { id: 'ds' };
    const [line] = await copyRfpaProducts(manager, dealSlip, rfpa);
    const source = rfpa.rfpaProducts[0];
    expect(line).toEqual({
      dealSlip,
      rfpaProduct: source,
      productName: source.productName,
      variant: source.variant,
      grade: 'A',
      quantity: 4,
      uom: source.uom,
      unitPrice: 5,
      amount: 20,
      purchaseDate: '2026-10-02',
      expectedHarvestDate: '2026-10-01',
      dispatchDate: '2026-10-03',
      deliveryDate: '2026-10-04',
    });
  });
});

describe('deal slip approver (GRN "Requesting person" pre-fill)', () => {
  const doc = (stage: any) => ({ approvalInfo: { firstApproved: stage } });

  it('is the user who approved the slip', () => {
    expect(dealSlipApproverId(doc({ userId: 'u-1', status: 'Approved' }))).toBe('u-1');
  });

  it('is empty until approved, and for a rejection', () => {
    expect(dealSlipApproverId(doc({ userId: 'u-1', status: 'Hold' }))).toBeNull();
    expect(dealSlipApproverId(doc({ userId: 'u-1', status: 'Rejected' }))).toBeNull();
    expect(dealSlipApproverId(doc(null))).toBeNull();
    expect(dealSlipApproverId({ approvalInfo: null })).toBeNull();
    expect(dealSlipApproverId(null)).toBeNull();
    expect(dealSlipApproverId(doc({ userId: null, status: 'Approved' }))).toBeNull();
  });
});

describe('shared RFPA / Deal Slip formatter', () => {
  const doc: any = {
    source: 'farmer',
    companyName: { id: 'co', name: 'Prime Fresh' },
    purchaseLocation: { id: 'b1', name: 'Pune' },
    purchaseForSalesLocation: null,
    otherPurchaseLoc: null,
    otherPurchaseForSalesLoc: 'Market yard',
    deliveryReceivingPerson: 'Ravi',
    packingInstruction: null,
    selectedVendor: null,
    selectedFarmer: { id: 'f1', farmerfName: 'Asha', farmerlName: 'Patil', farmerCode: 'F01' },
    paymentInfo: { paymentMode: 'cash', advancePaidAmt: 0, creditPeriod: 0 },
  };

  it('resolves names for views and ids for forms', () => {
    const view = formatProcurementHeader(doc, 'view');
    expect(view).toMatchObject({ companyName: 'Prime Fresh', purchaseLocation: 'Pune', purchaseForSalesLocation: null });
    expect(view.selectedParty).toMatchObject({ fullName: 'Asha  Patil', farmerCode: 'F01' });
    const form = formatProcurementHeader(doc, 'form');
    expect(form).toMatchObject({ companyName: 'co', purchaseLocation: 'b1', selectedParty: 'f1' });
  });

  it('keeps zero amounts instead of turning them into null', () => {
    expect(formatProcurementHeader(doc, 'view').paymentInfo).toMatchObject({ advancePaidAmt: 0, creditPeriod: 0 });
    const line: any = { id: 'l', quantity: 0, unitPrice: 0, amount: 0, uom: { id: 'u', unit: 'kg' }, productName: { id: 'p', name: 'Mango' } };
    expect(formatProcurementLine(line, 'view')).toMatchObject({ id: 'l', quantity: 0, amount: 0, uom: 'kg', productName: 'Mango' });
    expect(formatProcurementLine(line, 'form')).toMatchObject({ uom: 'u', productName: 'p', variant: null });
  });
});
