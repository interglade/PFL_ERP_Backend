/**
 * Matching lookup rows by name when the name comes from a spreadsheet.
 *
 * People type the same category a dozen ways - "Fresh Produce", "fresh
 * produce", "Fresh-Produce", "Freshproduce". Matching those exactly meant every
 * spelling created its own row, so the same category ended up in the table
 * several times over. These helpers compare names with the noise stripped out,
 * so an existing row is reused and only a genuinely new name creates one.
 */

import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';

/**
 * Reduces a name to the letters and digits in it, lower-cased.
 *
 *   "Fresh Produce"  -> "freshproduce"
 *   "fresh-produce"  -> "freshproduce"
 *   "  FRESHPRODUCE" -> "freshproduce"
 *
 * Names that differ only in case, spacing or punctuation are therefore treated
 * as the same name. Names that differ in their letters are not.
 */
export function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Guards the property name that gets interpolated into the SQL below. */
function assertSafeProperty(property: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(property)) {
    throw new Error(`Unsafe lookup property name: ${property}`);
  }
}

/**
 * Finds a lookup row whose name matches `value` once case, spacing and
 * punctuation are ignored, or null when there is genuinely no such row.
 *
 * `narrow` scopes the search - a subcategory only counts when it belongs to the
 * right parent category.
 *
 * The comparison happens in SQL rather than in memory so it stays correct as
 * these tables grow; they are small enough that the missing functional index
 * does not matter.
 */
export async function findByName<T extends ObjectLiteral>(
  repository: Repository<T>,
  nameProperty: string,
  value: string,
  narrow?: (queryBuilder: SelectQueryBuilder<T>) => void,
): Promise<T | null> {
  assertSafeProperty(nameProperty);

  const key = normaliseName(value);
  if (!key) return null;

  const queryBuilder = repository
    .createQueryBuilder('lookup')
    .where(
      `LOWER(REGEXP_REPLACE(lookup.${nameProperty}, '[^a-zA-Z0-9]', '', 'g')) = :key`,
      { key },
    );

  narrow?.(queryBuilder);

  return queryBuilder.getOne();
}

/**
 * Reuses the matching lookup row, or creates one carrying the name exactly as
 * it was typed in the sheet.
 *
 * `extra` supplies the other columns a new row needs - the parent category on a
 * subcategory, the abbreviation on a UOM.
 */
export async function findOrCreateByName<T extends ObjectLiteral>(
  repository: Repository<T>,
  nameProperty: string,
  value: string,
  extra?: Record<string, unknown>,
  narrow?: (queryBuilder: SelectQueryBuilder<T>) => void,
): Promise<T> {
  const existing = await findByName(repository, nameProperty, value, narrow);
  if (existing) return existing;

  // Stored as typed, so the first spelling to arrive is the one the rest of the
  // app displays.
  const created = repository.create({
    ...(extra ?? {}),
    [nameProperty]: value.trim(),
  } as any);

  return repository.save(created as any) as Promise<T>;
}
