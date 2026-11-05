/**
 * Matches the masters a product row names - UoM, Classification, Category,
 * Subcategory - against what already exists (docs/master-data-excel-plan.md
 * §6.4, Phase 5).
 *
 * Masters are never created from a product sheet any more: they are imported
 * first, in order. A name that does not match is left empty on the product and
 * reported with the closest existing name; the product has no draft status,
 * so it is still saved. Only the UoM is a must - stock is kept in it - so a
 * row without a matching UoM is skipped.
 */

import { LookupIndex } from '../../../excel/lookupIndex';

export interface ProductLinkRecord {
  id: string;
  [property: string]: any;
}

export interface ProductLinkIndexes {
  uoms: LookupIndex<ProductLinkRecord>;
  classifications: LookupIndex<ProductLinkRecord>;
  /** Categories with `productClassification` loaded. */
  categories: LookupIndex<ProductLinkRecord>;
  /** Subcategories scoped by their category id. */
  subcategories: LookupIndex<ProductLinkRecord>;
}

export interface ProductLinkInput {
  uom: string | null;
  classification: string | null;
  category: string | null;
  subcategory: string | null;
}

/** A link left empty, as it goes into the import report. */
export interface ProductLinkIssue {
  field: string;
  typed: string;
  suggestion: string | null;
}

export interface ProductLinks {
  uom: ProductLinkRecord | null;
  classification: ProductLinkRecord | null;
  category: ProductLinkRecord | null;
  subcategory: ProductLinkRecord | null;
  /** Set when the row cannot be saved: the UoM is missing or does not match. */
  skipReason: string | null;
  issues: ProductLinkIssue[];
}

export const PRODUCT_LINK_HEADERS = {
  uom: 'UOM',
  classification: 'Classification',
  category: 'Category',
  subcategory: 'Subcategory',
} as const;

const H = PRODUCT_LINK_HEADERS;

/** The form requires these too, so an empty one is worth pointing out. */
const EMPTY = '(empty)';

export function resolveProductLinks(
  input: ProductLinkInput,
  indexes: ProductLinkIndexes,
): ProductLinks {
  const links: ProductLinks = {
    uom: null,
    classification: null,
    category: null,
    subcategory: null,
    skipReason: null,
    issues: [],
  };

  // ── UoM: must match ────────────────────────────────────────────────────
  if (!input.uom) {
    links.skipReason = `${H.uom} is empty - a product needs its unit of measure`;
  } else {
    const found = indexes.uoms.find(input.uom);
    if (found.status === 'found') {
      links.uom = found.record;
    } else {
      const hint = found.status === 'missing' && found.suggestion ? ` (did you mean "${found.suggestion}"?)` : '';
      links.skipReason = `${H.uom} "${input.uom}" was not found - add it in UoM first${hint}`;
    }
  }

  // ── Classification ─────────────────────────────────────────────────────
  if (input.classification) {
    const found = indexes.classifications.find(input.classification);
    if (found.status === 'found') links.classification = found.record;
    else links.issues.push(miss(H.classification, input.classification, found));
  }

  // ── Category: must sit under the row's classification ──────────────────
  if (input.category) {
    const found = indexes.categories.find(input.category);
    if (found.status === 'found') {
      const parentId = found.record.productClassification?.id ?? null;
      if (links.classification && parentId !== links.classification.id) {
        links.issues.push({
          field: H.category,
          typed: input.category,
          suggestion: `"${found.record.name}" is under ${found.record.productClassification?.name ?? 'no classification'}`,
        });
      } else {
        links.category = found.record;
        // The classification follows from the category when the row left it out.
        if (!input.classification && found.record.productClassification) {
          links.classification = found.record.productClassification;
        }
      }
    } else {
      links.issues.push(miss(H.category, input.category, found));
    }
  }

  // ── Subcategory: must sit under the category ───────────────────────────
  if (input.subcategory) {
    if (!links.category) {
      links.issues.push({
        field: H.subcategory,
        typed: input.subcategory,
        suggestion: input.category ? 'its Category did not match' : 'no Category was given',
      });
    } else {
      const found = indexes.subcategories.find(input.subcategory, links.category.id);
      if (found.status === 'found') {
        links.subcategory = found.record;
      } else {
        const elsewhere = indexes.subcategories.match(input.subcategory);
        links.issues.push({
          field: H.subcategory,
          typed: input.subcategory,
          suggestion:
            found.status === 'missing' && found.suggestion
              ? found.suggestion
              : elsewhere
                ? `"${elsewhere.name}" is under ${elsewhere.category?.name ?? 'another category'}`
                : null,
        });
      }
    }
  }

  // ── Required by the form but left empty in the sheet ───────────────────
  if (!input.classification && !links.classification) {
    links.issues.push({ field: H.classification, typed: EMPTY, suggestion: null });
  }
  if (!input.category) links.issues.push({ field: H.category, typed: EMPTY, suggestion: null });
  if (!input.subcategory) links.issues.push({ field: H.subcategory, typed: EMPTY, suggestion: null });

  return links;
}

function miss(
  field: string,
  typed: string,
  found: { status: 'missing'; suggestion: string | null } | { status: 'ambiguous'; candidates: unknown[] },
): ProductLinkIssue {
  return {
    field,
    typed,
    suggestion:
      found.status === 'missing'
        ? found.suggestion
        : `matches ${found.candidates.length} records - rename one of them`,
  };
}
