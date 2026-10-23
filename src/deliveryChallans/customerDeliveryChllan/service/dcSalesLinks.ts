/**
 * Customer DC ↔ Final Invoice / Return By Customer links.
 *
 * The Customer DC carries three flags (`isInvoiceCreated`,
 * `isReturnByCustomerCreated`, `isReturned`) and per-line return figures
 * (`returnedQty`, `rejectedQty`, `acceptedQty` on `item`). They used to be
 * written once, when the invoice / RBC was created, and never undone, so a
 * rejected or deleted invoice / RBC left the DC stuck and an RBC still on hold
 * already changed the quantities the invoice bills.
 *
 * {@link syncCustomerDcSalesLinks} recomputes all of them from the documents
 * that are live now, so every path (create, approve, reject, delete, edit)
 * only has to call it:
 * - `isInvoiceCreated` / `isReturnByCustomerCreated`: a non-deleted invoice /
 *   RBC exists whose approval is not rejected (pending ones count, so a second
 *   one cannot be raised meanwhile);
 * - `isReturned` and the line figures: only APPROVED (COMPLETE) RBCs count.
 *   A DC line without an approved return gets NULLs, which the invoice reads
 *   as "bill the original quantity".
 */

import { EntityManager } from 'typeorm';
import { DocumentStatus, DocumentTypeEnum } from '../../../approvalFlow/entity/docuemnt.entity';

/** Status of the newest `documents` row of a business record (alias `rec`). */
const latestStatusSql = (type: string) => `(
  SELECT d.status::text FROM documents d
   WHERE d.document_type_id = rec.id::text AND d.type::text = '${type}'
   ORDER BY d."createdAt" DESC LIMIT 1
)`;

const liveSql = `COALESCE(rec."isDeleted", false) = false AND rec."deletedAt" IS NULL`;

/** The Customer DC ids that the given invoices / RBCs point at. */
export async function dcIdsOfSalesDocuments(
  manager: EntityManager,
  type: DocumentTypeEnum,
  ids: string[],
): Promise<string[]> {
  if (!ids.length) return [];
  const table = type === DocumentTypeEnum.FINAL_INVOICE ? 'invoices' : type === DocumentTypeEnum.RETURN_BY_CUSTOMER ? 'return_by_customer' : null;
  if (!table) return [];
  const rows: Array<{ dc_id: string | null }> = await manager.query(
    `SELECT DISTINCT delivery_challan_id::text AS dc_id FROM ${table} WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return rows.map((r) => r.dc_id).filter((id): id is string => !!id);
}

/** Recomputes the invoice / return flags and the line return figures of the given Customer DCs. */
export async function syncCustomerDcSalesLinks(manager: EntityManager, dcIds: string[]): Promise<void> {
  const ids = Array.from(new Set(dcIds.filter(Boolean)));
  if (!ids.length) return;

  const invoiceType = DocumentTypeEnum.FINAL_INVOICE;
  const rbcType = DocumentTypeEnum.RETURN_BY_CUSTOMER;
  const reject = DocumentStatus.REJECT;
  const complete = DocumentStatus.COMPLETE;

  await manager.query(
    `UPDATE delivery_challan_purchase dc SET
       "isInvoiceCreated" = EXISTS (
         SELECT 1 FROM invoices rec
          WHERE rec.delivery_challan_id = dc.id AND ${liveSql}
            AND COALESCE(${latestStatusSql(invoiceType)}, '') <> $2),
       "isReturnByCustomerCreated" = EXISTS (
         SELECT 1 FROM return_by_customer rec
          WHERE rec.delivery_challan_id = dc.id AND ${liveSql}
            AND COALESCE(${latestStatusSql(rbcType)}, '') <> $2),
       "isReturned" = EXISTS (
         SELECT 1 FROM return_by_customer rec
          WHERE rec.delivery_challan_id = dc.id AND ${liveSql}
            AND ${latestStatusSql(rbcType)} = $3)
     WHERE dc.id = ANY($1::uuid[])`,
    [ids, reject, complete],
  );

  // Line figures from approved returns only; lines without one go back to NULL.
  await manager.query(
    `WITH approved AS (
       SELECT rec.delivery_challan_id AS dc_id, rp.product_id, rp.varient_id,
              SUM(COALESCE(rp."returnedQty", 0)) AS returned,
              SUM(COALESCE(rp."rejectedQty", 0)) AS rejected
         FROM returned_products_by_customer rp
         JOIN return_by_customer rec ON rp."postReturnId" = rec.id
        WHERE rec.delivery_challan_id = ANY($1::uuid[]) AND ${liveSql}
          AND ${latestStatusSql(rbcType)} = $2
        GROUP BY rec.delivery_challan_id, rp.product_id, rp.varient_id
     ),
     lines AS (
       SELECT it.id, a.returned, a.rejected
         FROM item it
         LEFT JOIN approved a
           ON a.dc_id = it."deliveryChallanId"
          AND a.product_id = it.product_id
          AND a.varient_id IS NOT DISTINCT FROM it.varient_id
        WHERE it."deliveryChallanId" = ANY($1::uuid[])
     )
     UPDATE item it SET
       "returnedQty" = lines.returned,
       "rejectedQty" = lines.rejected,
       "acceptedQty" = CASE WHEN lines.returned IS NULL THEN NULL
                            ELSE GREATEST(COALESCE(it.quantity, 0) - lines.returned - lines.rejected, 0) END
     FROM lines WHERE it.id = lines.id`,
    [ids, complete],
  );
}
