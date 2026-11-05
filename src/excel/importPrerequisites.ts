/**
 * The order masters have to be imported in, and the check that enforces it.
 *
 * A master links to others by name - a vendor subcategory names its vendor
 * category, a product names its UoM. Importing a master while one it links to
 * is still empty can only produce failed rows or drafts, so the import is
 * stopped up front and the user is told what to import first, in order.
 *
 * Agreed with the client on 2026-10-28 (docs/master-data-excel-plan.md §1).
 */

import AppError from '../utils/appError';

export type ImportMaster =
  | 'uom'
  | 'customer-type'
  | 'customer-category'
  | 'vendor-category'
  | 'product-classification'
  | 'transporter'
  | 'vendor-subcategory'
  | 'product-category'
  | 'packaging-material'
  | 'driver'
  | 'vehicle'
  | 'location'
  | 'customer'
  | 'product-subcategory'
  | 'product'
  | 'vendor'
  | 'farmer'
  | 'user';

export interface ImportMasterInfo {
  label: string;
  /** 1 = links to nothing; each level only links to lower levels. */
  level: number;
  /**
   * Masters this one links to. Optional links count too (a driver without a
   * transporter is own fleet), so the order stays the one agreed.
   */
  parents: ImportMaster[];
}

/** In import order: by level, then the order the client listed them in. */
export const IMPORT_MASTERS: Record<ImportMaster, ImportMasterInfo> = {
  uom: { label: 'UoM', level: 1, parents: [] },
  'customer-type': { label: 'Customer Type', level: 1, parents: [] },
  'customer-category': { label: 'Customer Category', level: 1, parents: [] },
  'vendor-category': { label: 'Vendor Category', level: 1, parents: [] },
  'product-classification': { label: 'Product Classification', level: 1, parents: [] },
  transporter: { label: 'Transporter', level: 1, parents: [] },

  'vendor-subcategory': { label: 'Vendor Subcategory', level: 2, parents: ['vendor-category'] },
  'product-category': { label: 'Product Category', level: 2, parents: ['product-classification'] },
  'packaging-material': { label: 'Packaging Material', level: 2, parents: ['uom'] },
  driver: { label: 'Driver', level: 2, parents: ['transporter'] },
  vehicle: { label: 'Vehicle', level: 2, parents: ['transporter'] },
  location: { label: 'Locations', level: 2, parents: [] },
  customer: {
    label: 'Customer',
    level: 2,
    parents: ['customer-type', 'customer-category'],
  },

  'product-subcategory': {
    label: 'Product Subcategory',
    level: 3,
    parents: ['product-category'],
  },

  product: {
    label: 'Product',
    level: 4,
    parents: ['uom', 'product-classification', 'product-category', 'product-subcategory'],
  },

  vendor: {
    label: 'Vendor',
    level: 5,
    parents: ['vendor-category', 'vendor-subcategory', 'product', 'packaging-material'],
  },
  farmer: { label: 'Farmer', level: 5, parents: ['product'] },

  // Users also need a company, which is added on the Company page (docs/user-import-plan.md §3).
  user: { label: 'Users', level: 3, parents: ['location'] },
};

const IMPORT_ORDER = Object.keys(IMPORT_MASTERS) as ImportMaster[];

function byImportOrder(a: ImportMaster, b: ImportMaster): number {
  return (
    IMPORT_MASTERS[a].level - IMPORT_MASTERS[b].level ||
    IMPORT_ORDER.indexOf(a) - IMPORT_ORDER.indexOf(b)
  );
}

/**
 * Every master that has to be in place before `master` - its parents, their
 * parents and so on - in the order they should be imported.
 *
 * The whole chain counts, not only direct parents: the client wants Product
 * Subcategory to wait for Product Classification as well as Product Category.
 */
export function prerequisitesOf(master: ImportMaster): ImportMaster[] {
  const found = new Set<ImportMaster>();
  const visit = (current: ImportMaster) => {
    for (const parent of IMPORT_MASTERS[current].parents) {
      if (found.has(parent)) continue;
      found.add(parent);
      visit(parent);
    }
  };

  visit(master);
  return [...found].sort(byImportOrder);
}

/** Counts the live records of a master. */
export type MasterRecordCounter = (master: ImportMaster) => Promise<number>;

/** The prerequisites of `master` that have no records yet, in import order. */
export async function findMissingPrerequisites(
  master: ImportMaster,
  count: MasterRecordCounter,
): Promise<ImportMaster[]> {
  const prerequisites = prerequisitesOf(master);
  const counts = await Promise.all(prerequisites.map((prerequisite) => count(prerequisite)));
  return prerequisites.filter((_prerequisite, index) => counts[index] === 0);
}

/**
 * "Product Subcategory cannot be imported yet. Import these first, in this
 * order: Product Classification → Product Category."
 *
 * Masters on the same level do not depend on each other, so they are listed
 * together and only the steps between levels are arrows.
 */
export function prerequisiteMessage(master: ImportMaster, missing: ImportMaster[]): string {
  const steps = new Map<number, string[]>();
  for (const prerequisite of [...missing].sort(byImportOrder)) {
    const { level, label } = IMPORT_MASTERS[prerequisite];
    steps.set(level, [...(steps.get(level) ?? []), label]);
  }

  const order = [...steps.values()].map((labels) => labels.join(', ')).join(' → ');
  const inOrder = steps.size > 1 ? ', in this order' : '';

  return (
    `${IMPORT_MASTERS[master].label} cannot be imported yet. ` +
    `Import these first${inOrder}: ${order}.`
  );
}

/** What the client gets in `data` when an import is blocked. */
export interface MissingPrerequisitesDetails {
  master: ImportMaster;
  missingPrerequisites: { key: ImportMaster; label: string; level: number }[];
}

/**
 * Stops the import with a 400 when any master `master` links to is still
 * empty. The response names them, in order, so the screen can link to each.
 */
export async function assertImportPrerequisites(
  master: ImportMaster,
  count: MasterRecordCounter,
): Promise<void> {
  const missing = await findMissingPrerequisites(master, count);
  if (!missing.length) return;

  const details: MissingPrerequisitesDetails = {
    master,
    missingPrerequisites: missing.map((key) => ({
      key,
      label: IMPORT_MASTERS[key].label,
      level: IMPORT_MASTERS[key].level,
    })),
  };

  throw new AppError(400, prerequisiteMessage(master, missing), details);
}
