/**
 * Customer DC "sale from GRN" (direct sale), docs/customer-dc-sale-types-plan.md.
 *
 * The Referred GRN decides the sale type: empty → sale from CC/DC (stock), selected → sale from
 * GRN. A direct sale's GRN must be direct-to-customer and approved, with an approved purchase
 * dispatch, and may have only one live Customer DC (1 GRN = 1 DC). The DC takes its company and
 * lines from the GRN, its customer and registered billing / delivery addresses from the purchase
 * dispatch (read-only), and its From location from the GRN's purchase for sales location when it
 * has one. The form also pre-fills receiver name and RMN from the GRN (editable); the current
 * shipping address stays the user's own. It takes no stock.
 */

import { EntityManager } from 'typeorm';
import AppError from '../../../utils/appError';
import { DocumentStatus, DocumentTypeEnum } from '../../../approvalFlow/entity/docuemnt.entity';
import { GrnDeliveryMode } from '../../../grn/entity/grn.entity';
import { DISPATCH_DOCUMENT_TYPE } from '../../../vehicleDispatch/service/dispatchSource';
import { DispatchType } from '../../../vehicleDispatch/entity/vehicleDispatch.entity';

const CUSTOMER_DC_TYPE = 'customer_delivery_challan';

const latestStatusSql = (idExpr: string, type: string) =>
  `(SELECT lsd.status::text FROM documents lsd WHERE lsd.document_type_id = ${idExpr}::text AND lsd.type::text = '${type}'
     AND lsd."deletedAt" IS NULL ORDER BY lsd."createdAt" DESC LIMIT 1)`;

/** A live (not deleted, not rejected) Customer DC raised from the GRN, other than `excludeExpr`. */
export function liveDirectSaleDcSql(grnIdExpr: string, excludeExpr = 'NULL'): string {
  return `EXISTS (SELECT 1 FROM delivery_challan_purchase ldc
     WHERE ldc.grn_id = ${grnIdExpr} AND ldc.type::text = '${CUSTOMER_DC_TYPE}'
       AND COALESCE(ldc."isDeleted", false) = false AND ldc."deletedAt" IS NULL
       AND (${excludeExpr}::uuid IS NULL OR ldc.id <> ${excludeExpr}::uuid)
       AND COALESCE(${latestStatusSql('ldc.id', DocumentTypeEnum.DC_TYPE_CUSTOMER)}, '') <> '${DocumentStatus.REJECT}')`;
}

/** The GRN's live purchase dispatch whose approval is complete. */
function approvedPurchaseDispatchSql(grnIdExpr: string): string {
  return `EXISTS (SELECT 1 FROM dispatch apd
     WHERE apd.grn_id = ${grnIdExpr} AND apd."dispatchType"::text = '${DispatchType.PURCHASE}'
       AND apd."isDeleted" = false AND apd."deletedAt" IS NULL
       AND ${latestStatusSql('apd.id', DISPATCH_DOCUMENT_TYPE)} = '${DocumentStatus.COMPLETE}')`;
}

/**
 * GRNs that can be picked as the Referred GRN of a new direct-sale DC: direct-to-customer,
 * approved, live, with an approved purchase dispatch and no live Customer DC yet.
 */
export function directSaleEligibleSql(grnAlias: string, excludeDcExpr = 'NULL'): string {
  return `(${grnAlias}."deliveryMode"::text = '${GrnDeliveryMode.DIRECT_TO_CUSTOMER}'
    AND COALESCE(${grnAlias}."isDeleted", false) = false AND ${grnAlias}."deletedAt" IS NULL
    AND ${latestStatusSql(`${grnAlias}.id`, DocumentTypeEnum.GRN)} = '${DocumentStatus.COMPLETE}'
    AND ${approvedPurchaseDispatchSql(`${grnAlias}.id`)}
    AND NOT ${liveDirectSaleDcSql(`${grnAlias}.id`, excludeDcExpr)})`;
}

export interface DirectSaleAddress {
  address1: string | null;
  address2: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export interface DirectSaleSource {
  grnId: string;
  grnNo: string | null;
  companyId: string | null;
  companyName: string | null;
  /** The GRN's purchase for sales location, or null (the DC's From location stays empty). */
  fromLocationId: string | null;
  fromLocationName: string | null;
  dispatchId: string;
  dispatchNo: string | null;
  customerId: string;
  customerName: string | null;
  billingAddressId: string | null;
  deliveryAddressId: string | null;
  billingAddress: DirectSaleAddress | null;
  deliveryAddress: DirectSaleAddress | null;
  /** The GRN's receiving person and RMN: the form pre-fills the DC's receiver name and RMN (editable). */
  receivingPerson: string | null;
  rmn: string | null;
  lines: Array<{
    productName: string | null;
    productLabel: string | null;
    variant: string | null;
    variantName: string | null;
    uom: string | null;
    uomName: string | null;
    quantity: number;
    grossWeight: number | null;
    packingMaterialWeight: number | null;
    netWeight: number | null;
    packagingMaterial: string | null;
    packagingMaterialName: string | null;
  }>;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

const ADDRESS_COLUMNS = (alias: string, prefix: string) =>
  ['address1', 'address2', 'location', 'city', 'state', 'pincode']
    .map((c) => `${alias}."${c}" AS "${prefix}_${c}"`)
    .join(', ');

const pickAddress = (row: Record<string, any>, prefix: string): DirectSaleAddress | null => {
  if (!row[`${prefix}_id`]) return null;
  return {
    address1: row[`${prefix}_address1`] ?? null,
    address2: row[`${prefix}_address2`] ?? null,
    location: row[`${prefix}_location`] ?? null,
    city: row[`${prefix}_city`] ?? null,
    state: row[`${prefix}_state`] ?? null,
    pincode: row[`${prefix}_pincode`] ?? null,
  };
};

/**
 * Loads what a direct-sale DC copies from its GRN and the GRN's purchase dispatch, and why the
 * GRN can't be used (empty when it can). `excludeDcId` is the DC being edited.
 */
export async function loadDirectSaleSource(
  m: EntityManager,
  grnId: string,
  excludeDcId: string | null = null,
): Promise<{ source: DirectSaleSource | null; blockers: string[] }> {
  const grns: Array<Record<string, any>> = await m.query(
    `SELECT g.id::text AS id, g."grnNo" AS no, g."deliveryMode"::text AS mode,
            (COALESCE(g."isDeleted", false) OR g."deletedAt" IS NOT NULL) AS deleted,
            ${latestStatusSql('g.id', DocumentTypeEnum.GRN)} AS status,
            g."receivingPerson" AS receiving_person, g.rmn,
            c.id::text AS company_id, c.name AS company_name,
            b.id::text AS location_id, b.name AS location_name
       FROM grns g
       LEFT JOIN company c ON c.id = g.company_id
       LEFT JOIN branches b ON b.id = g.purchaseforwhich_id
      WHERE g.id = $1`,
    [grnId],
  );
  const g = grns[0];
  if (!g) return { source: null, blockers: ['The referred GRN was not found'] };
  const label = `GRN ${g.no ?? ''}`.trim();
  const blockers: string[] = [];
  if (g.deleted) blockers.push(`${label} was deleted`);
  if (g.mode !== GrnDeliveryMode.DIRECT_TO_CUSTOMER) {
    blockers.push(`${label} is not a direct-to-customer GRN; leave Referred GRN empty for a sale from CC/DC stock`);
    return { source: null, blockers };
  }
  if (g.status !== DocumentStatus.COMPLETE) blockers.push(`${label} has not completed its approval`);

  const dispatches: Array<Record<string, any>> = await m.query(
    `SELECT d.id::text AS id, d."vehicleDispatchNo" AS no,
            ${latestStatusSql('d.id', DISPATCH_DOCUMENT_TYPE)} AS status,
            cu.id::text AS customer_id, cu.organisation_name AS customer_name,
            ba.id::text AS bill_id, ${ADDRESS_COLUMNS('ba', 'bill')},
            da.id::text AS del_id, ${ADDRESS_COLUMNS('da', 'del')}
       FROM dispatch d
       LEFT JOIN customers cu ON cu.id = d.customer_id
       LEFT JOIN customer_billing_details cb ON cb.id = cu."billingDetailsId"
       LEFT JOIN addresses ba ON ba.id = cb."billing address"
       LEFT JOIN customer_delivery_details cd ON cd.id = cu."deliveryDetailsId"
       LEFT JOIN addresses da ON da.id = cd."deliveryAddressId"
      WHERE d.grn_id = $1 AND d."dispatchType"::text = $2 AND d."isDeleted" = false AND d."deletedAt" IS NULL
      ORDER BY d."createdAt" DESC`,
    [grnId, DispatchType.PURCHASE],
  );
  const dispatch = dispatches.find((d) => d.status !== DocumentStatus.REJECT) ?? null;
  if (!dispatch) blockers.push(`${label} has no purchase vehicle dispatch yet`);
  else if (dispatch.status !== DocumentStatus.COMPLETE) {
    blockers.push(`The purchase dispatch ${dispatch.no ?? ''} of ${label} is not approved yet`.replace(/\s+/g, ' '));
  } else if (!dispatch.customer_id) {
    blockers.push(`The purchase dispatch ${dispatch.no ?? ''} of ${label} has no customer`.replace(/\s+/g, ' '));
  }

  const others: Array<{ no: string | null }> = await m.query(
    `SELECT ldc."challanNo" AS no FROM delivery_challan_purchase ldc
      WHERE ldc.grn_id = $1 AND ldc.type::text = $2
        AND COALESCE(ldc."isDeleted", false) = false AND ldc."deletedAt" IS NULL
        AND ($3::uuid IS NULL OR ldc.id <> $3::uuid)
        AND COALESCE(${latestStatusSql('ldc.id', DocumentTypeEnum.DC_TYPE_CUSTOMER)}, '') <> $4`,
    [grnId, CUSTOMER_DC_TYPE, excludeDcId, DocumentStatus.REJECT],
  );
  if (others.length) blockers.push(`${label} already has Customer DC ${others[0].no ?? ''}`.trim());

  if (!dispatch?.customer_id) return { source: null, blockers };

  const lines: Array<Record<string, any>> = await m.query(
    `SELECT gp.product_id::text AS product_id, p.product_name AS product_name,
            gp.varient_id::text AS variant_id, v."variantName" AS variant_name,
            gp.uom_id::text AS uom_id, u.unit AS uom_name,
            gp.quantity, gp."grossWeight", gp."packingMaterialWeight", gp."netWeight",
            gp.packing_material_id::text AS pm_id, pm."packagingMaterialName" AS pm_name
       FROM grn_products gp
       LEFT JOIN product p ON p.id = gp.product_id
       LEFT JOIN "productVarient" v ON v.id = gp.varient_id
       LEFT JOIN uom u ON u.id = gp.uom_id
       LEFT JOIN post_packaging_material pm ON pm.id = gp.packing_material_id
      WHERE gp.grn_id = $1 AND COALESCE(gp."isDeleted", false) = false AND gp."deletedAt" IS NULL
      ORDER BY gp."createdAt" ASC`,
    [grnId],
  );

  return {
    blockers,
    source: {
      grnId,
      grnNo: g.no ?? null,
      companyId: g.company_id ?? null,
      companyName: g.company_name ?? null,
      fromLocationId: g.location_id ?? null,
      fromLocationName: g.location_name ?? null,
      dispatchId: dispatch.id,
      dispatchNo: dispatch.no ?? null,
      customerId: dispatch.customer_id,
      customerName: dispatch.customer_name ?? null,
      billingAddressId: dispatch.bill_id ?? null,
      deliveryAddressId: dispatch.del_id ?? null,
      billingAddress: pickAddress(dispatch, 'bill'),
      deliveryAddress: pickAddress(dispatch, 'del'),
      receivingPerson: g.receiving_person ?? null,
      rmn: g.rmn ?? null,
      lines: lines.map((l) => ({
        productName: l.product_id ?? null,
        productLabel: l.product_name ?? null,
        variant: l.variant_id ?? null,
        variantName: l.variant_name ?? null,
        uom: l.uom_id ?? null,
        uomName: l.uom_name ?? null,
        quantity: Number(l.quantity ?? 0),
        grossWeight: num(l.grossWeight),
        packingMaterialWeight: num(l.packingMaterialWeight),
        netWeight: num(l.netWeight),
        packagingMaterial: l.pm_id ?? null,
        packagingMaterialName: l.pm_name ?? null,
      })),
    },
  };
}

/** The GRN can back a direct-sale DC (locks the GRN row); throws 409 with every reason otherwise. */
export async function assertDirectSaleSource(m: EntityManager, grnId: string, excludeDcId: string | null = null): Promise<DirectSaleSource> {
  await m.query(`SELECT id FROM grns WHERE id = $1 FOR UPDATE`, [grnId]);
  const { source, blockers } = await loadDirectSaleSource(m, grnId, excludeDcId);
  if (blockers.length || !source) throw new AppError(409, `This GRN can't be used for a direct sale: ${blockers.join('; ')}`);
  return source;
}

/**
 * Overwrites what a direct-sale DC copies (whatever the client sent): company, From location,
 * customer and its registered billing / delivery addresses. The current shipping address,
 * receiver name, RMN, lines and prices stay the user's (lines are checked against the GRN elsewhere).
 */
export function applyDirectSaleSource(data: Record<string, any>, source: DirectSaleSource): void {
  data.grnNo = source.grnId;
  data.companyName = source.companyId;
  data.fromLocation = source.fromLocationId;
  data.customerName = source.customerId;
  data.partyName = source.customerId;
  data.billingAddress = source.billingAddressId ? { id: source.billingAddressId } : null;
  data.deliveryAddress = source.deliveryAddressId ? { id: source.deliveryAddressId } : null;
  delete data.billingDetails;
  delete data.deliveryDetails;
}
