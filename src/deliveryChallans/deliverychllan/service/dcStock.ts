/**
 * Stock rules shared by the three delivery challan types (Phase B of
 * docs/stock-implementation-plan.md).
 *
 * Stock (`inventory_stock`) is kept in net kg today; the Inward Register adds
 * net kg and a DC takes net kg out. Until batch stock (Phase C) every DC line
 * therefore needs a net weight, and availability is checked in kg:
 *
 *   available = on hand − kg held by other pending DCs at the same
 *               company + location (not rejected, not deleted, not yet approved)
 *
 * so two DCs can no longer sell the same stock. Creates for one company +
 * location serialise on an advisory lock held until the caller's transaction
 * ends. A Customer DC raised from a GRN delivered direct to the customer takes
 * nothing from stock: it is checked against that GRN's lines instead.
 */

import { EntityManager } from 'typeorm';
import { DocumentStatus, DocumentTypeEnum } from '../../../approvalFlow/entity/docuemnt.entity';
import { directSaleDcSql } from '../../../vehicleDispatch/service/dispatchRules';
import { GrnDeliveryMode } from '../../../grn/entity/grn.entity';
import AppError from '../../../utils/appError';

export interface DcStockLine {
  productId: string;
  variantId: string | null;
  /** net kg of the line */
  kg: number;
  label: string;
}

type RawLine = {
  productName?: unknown;
  variant?: unknown;
  quantity?: unknown;
  netWeight?: unknown;
};

const idOf = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    const id = (value as Record<string, unknown>).id;
    return id ? String(id) : null;
  }
  return null;
};

const round3 = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;
const keyOf = (productId: string, variantId: string | null) => `${productId}:${variantId ?? 'null'}`;

/** Physical columns a DC child may have stored its from-location in (STI collision, see dispatchSource.ts). */
const DC_FROM_LOCATION_COLUMNS = ['branch_id', 'from_location_id', 'other_from_location_id_for_other'];
let fromLocationExprCache: string | null = null;

/** `COALESCE(dc."branch_id", …)` over the from-location columns that exist. */
async function dcFromLocationExpr(manager: EntityManager): Promise<string> {
  if (fromLocationExprCache) return fromLocationExprCache;
  const present: Array<{ column_name: string }> = await manager.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'delivery_challan_purchase' AND column_name = ANY($1::text[])`,
    [DC_FROM_LOCATION_COLUMNS],
  );
  const names = DC_FROM_LOCATION_COLUMNS.filter((c) => present.some((p) => p.column_name === c));
  if (!names.length) throw new AppError(500, 'Delivery challan from-location column not found');
  fromLocationExprCache = names.length === 1 ? `dc."${names[0]}"` : `COALESCE(${names.map((c) => `dc."${c}"`).join(', ')})`;
  return fromLocationExprCache;
}

/**
 * Product + variant + net kg of the submitted lines. When a variant is given
 * the product is taken from the variant (same rule as the stock movement).
 * Every line needs a product and a net weight above 0.
 */
export async function resolveDcLines(manager: EntityManager, rawLines: RawLine[] | null | undefined): Promise<DcStockLine[]> {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (!lines.length) throw new AppError(400, 'Add at least one product');
  const variantIds = lines.map((l) => idOf(l.variant)).filter((v): v is string => !!v);
  const productIds = lines.map((l) => idOf(l.productName)).filter((p): p is string => !!p);

  const variants: Array<{ id: string; product_id: string; product_name: string | null; variant_name: string | null }> = variantIds.length
    ? await manager.query(
        `SELECT v.id::text AS id, p.id::text AS product_id, p.product_name AS product_name, v."variantName" AS variant_name
           FROM "productVarient" v JOIN product p ON p.id = v.product_id WHERE v.id = ANY($1::uuid[])`,
        [variantIds],
      )
    : [];
  const products: Array<{ id: string; name: string | null }> = productIds.length
    ? await manager.query(`SELECT id::text AS id, product_name AS name FROM product WHERE id = ANY($1::uuid[])`, [productIds])
    : [];

  return lines.map((line, index) => {
    const variantId = idOf(line.variant);
    const variant = variantId ? variants.find((v) => v.id === variantId) : undefined;
    if (variantId && !variant) throw new AppError(400, `Product line ${index + 1}: variant not found`);
    const productId = variant?.product_id ?? idOf(line.productName);
    if (!productId) throw new AppError(400, `Product line ${index + 1}: product is required`);
    const productName = variant?.product_name ?? products.find((p) => p.id === productId)?.name ?? 'Product';
    const label = variant?.variant_name ? `${productName} (${variant.variant_name})` : productName;
    const kg = Number(line.netWeight);
    if (!Number.isFinite(kg) || kg <= 0) {
      throw new AppError(400, `${label}: enter the net weight (kg); stock is moved by net weight`);
    }
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new AppError(400, `${label}: enter a quantity greater than 0`);
    }
    return { productId, variantId: variant ? variantId : null, kg: round3(kg), label };
  });
}

function aggregate(lines: DcStockLine[]): Map<string, DcStockLine> {
  const result = new Map<string, DcStockLine>();
  for (const line of lines) {
    const key = keyOf(line.productId, line.variantId);
    const existing = result.get(key);
    if (existing) existing.kg = round3(existing.kg + line.kg);
    else result.set(key, { ...line });
  }
  return result;
}

/** True when the GRN is delivered direct to the customer (its goods never enter a CC's stock). */
export async function isDirectSaleGrn(manager: EntityManager, grnId: string | null | undefined): Promise<boolean> {
  if (!grnId) return false;
  const rows: Array<{ mode: string | null }> = await manager.query(
    `SELECT "deliveryMode"::text AS mode FROM grns WHERE id = $1`,
    [grnId],
  );
  return rows[0]?.mode === GrnDeliveryMode.DIRECT_TO_CUSTOMER;
}

/** Throws 400 when the lines need more kg than is available at the location (on hand − other pending DCs). */
export async function assertDcStockAvailable(
  manager: EntityManager,
  input: { companyId: string | null; locationId: string | null; lines: DcStockLine[]; excludeDcId?: string | null },
): Promise<void> {
  const { companyId, locationId } = input;
  if (!companyId) throw new AppError(400, 'Select the company');
  if (!locationId) throw new AppError(400, 'Select the from-location');

  await manager.query(`SELECT pg_advisory_xact_lock(hashtext('dc-stock'), hashtext($1))`, [`${companyId}|${locationId}`]);
  const fromLocation = await dcFromLocationExpr(manager);
  const pendingTypes = [DocumentTypeEnum.DC_TYPE_CUSTOMER, DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER, DocumentTypeEnum.DC_TYPE_OTHER];

  const errors: string[] = [];
  for (const line of aggregate(input.lines).values()) {
    const onHandRows: Array<{ kg: string | null }> = await manager.query(
      `SELECT COALESCE(SUM("inwardQty"), 0) AS kg FROM inventory_stock
        WHERE company_id = $1 AND location_id = $2 AND product_id = $3 AND variant_id IS NOT DISTINCT FROM $4`,
      [companyId, locationId, line.productId, line.variantId],
    );
    const pendingRows: Array<{ kg: string | null }> = await manager.query(
      `SELECT COALESCE(SUM(it."netWeight"), 0) AS kg
         FROM item it
         JOIN delivery_challan_purchase dc ON dc.id = it."deliveryChallanId"
        WHERE dc.company_id = $1 AND ${fromLocation} = $2
          AND it.product_id = $3 AND it.varient_id IS NOT DISTINCT FROM $4
          AND COALESCE(dc."isDeleted", false) = false AND dc."deletedAt" IS NULL AND it."deletedAt" IS NULL
          AND ($5::uuid IS NULL OR dc.id <> $5::uuid)
          AND NOT ${directSaleDcSql('dc.id')}
          AND COALESCE((SELECT d.status::text FROM documents d
                         WHERE d.document_type_id = dc.id::text AND d.type::text = ANY($6::text[])
                         ORDER BY d."createdAt" DESC LIMIT 1), '') NOT IN ($7, $8)`,
      [companyId, locationId, line.productId, line.variantId, input.excludeDcId ?? null, pendingTypes, DocumentStatus.REJECT, DocumentStatus.COMPLETE],
    );
    const onHand = round3(Number(onHandRows[0]?.kg ?? 0));
    const pending = round3(Number(pendingRows[0]?.kg ?? 0));
    const available = round3(onHand - pending);
    if (line.kg > available) {
      errors.push(
        `${line.label}: ${line.kg} kg needed but only ${available < 0 ? 0 : available} kg available ` +
          `(${onHand} kg in stock${pending > 0 ? `, ${pending} kg held by other pending DCs` : ''})`,
      );
    }
  }
  if (errors.length) throw new AppError(400, `Insufficient stock: ${errors.join('; ')}`);
}

/**
 * A direct-sale Customer DC sells goods of its GRN: every product must be on
 * the GRN and the kg of all live DCs of that GRN may not exceed the GRN's kg.
 */
export async function assertDirectSaleWithinGrn(
  manager: EntityManager,
  input: { grnId: string; lines: DcStockLine[]; excludeDcId?: string | null },
): Promise<void> {
  await manager.query(`SELECT id FROM grns WHERE id = $1 FOR UPDATE`, [input.grnId]);
  const grnRows: Array<{ product_id: string; variant_id: string | null; kg: string | null }> = await manager.query(
    `SELECT product_id::text AS product_id, varient_id::text AS variant_id, COALESCE(SUM("netWeight"), 0) AS kg
       FROM grn_products WHERE grn_id = $1 GROUP BY product_id, varient_id`,
    [input.grnId],
  );
  const usedRows: Array<{ product_id: string; variant_id: string | null; kg: string | null }> = await manager.query(
    `SELECT it.product_id::text AS product_id, it.varient_id::text AS variant_id, COALESCE(SUM(it."netWeight"), 0) AS kg
       FROM item it JOIN delivery_challan_purchase dc ON dc.id = it."deliveryChallanId"
      WHERE dc.grn_id = $1 AND COALESCE(dc."isDeleted", false) = false AND dc."deletedAt" IS NULL AND it."deletedAt" IS NULL
        AND ($2::uuid IS NULL OR dc.id <> $2::uuid)
        AND COALESCE((SELECT d.status::text FROM documents d WHERE d.document_type_id = dc.id::text AND d.type::text = $3
                       ORDER BY d."createdAt" DESC LIMIT 1), '') <> $4
      GROUP BY it.product_id, it.varient_id`,
    [input.grnId, input.excludeDcId ?? null, DocumentTypeEnum.DC_TYPE_CUSTOMER, DocumentStatus.REJECT],
  );
  const kgOf = (rows: typeof grnRows, line: DcStockLine) =>
    round3(Number(rows.find((r) => r.product_id === line.productId && (r.variant_id ?? null) === line.variantId)?.kg ?? 0));

  const errors: string[] = [];
  for (const line of aggregate(input.lines).values()) {
    const onGrn = kgOf(grnRows, line);
    if (onGrn <= 0) {
      errors.push(`${line.label} is not on the GRN this direct sale comes from`);
      continue;
    }
    const left = round3(onGrn - kgOf(usedRows, line));
    if (line.kg > left) errors.push(`${line.label}: ${line.kg} kg entered but only ${left < 0 ? 0 : left} kg of the GRN is left to sell`);
  }
  if (errors.length) throw new AppError(400, errors.join('; '));
}
