/**
 * Matching linked names in a spreadsheet against a master, without a query per row.
 *
 * An import of a few thousand vendors names a category, a subcategory and a
 * handful of products on every row. Looking each one up in the database meant
 * thousands of queries; these masters are small, so each one is loaded once
 * into memory and every row is matched against that.
 *
 * Names are compared the same way as `lookupByName` - case, spacing and
 * punctuation ignored - so "Mandi-Supplier" finds "Mandi Supplier". Anything
 * further off is not matched: it is reported, with the closest name suggested,
 * and the importer decides what a missing name means.
 */

import { ObjectLiteral, Repository } from 'typeorm';
import { normaliseName } from './lookupByName';

export type LookupResult<T> =
  | { status: 'found'; record: T }
  | { status: 'missing'; suggestion: string | null }
  /** Two different records share the name - the sheet cannot say which one it means. */
  | { status: 'ambiguous'; candidates: T[] };

export interface LookupIndexOptions<T> {
  /**
   * Names a record can be found by. Most masters have one; a UoM can be found
   * by its unit or its abbreviation. The first name is the one suggested.
   */
  names: (record: T) => (string | null | undefined)[];

  /**
   * Parent a record belongs to, for names that are only unique within it -
   * the category id of a subcategory.
   */
  scope?: (record: T) => string | null | undefined;
}

/** Below this similarity a name is too far off to be worth suggesting. */
const SUGGESTION_THRESHOLD = 0.6;

/** Shortest shared start that counts towards a suggestion ("Mandi Sus" -> "Mandi Supplier"). */
const MIN_PREFIX = 3;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }

  return previous[b.length];
}

/**
 * How alike two normalised names are, from 0 to 1.
 *
 * Edit distance alone misses names cut short - "mandisus" is six edits from
 * "mandisupplier" - so a long shared start also counts, slightly discounted so
 * that a near-identical spelling still wins over a shared prefix.
 */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  const editScore = 1 - levenshtein(a, b) / Math.max(a.length, b.length);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  const prefixScore =
    prefix >= MIN_PREFIX ? (0.9 * prefix) / Math.min(a.length, b.length) : 0;

  return Math.max(editScore, prefixScore);
}

interface Entry<T> {
  record: T;
  key: string;
  scope: string | null;
  /** The name as stored, offered back as a suggestion. */
  display: string;
}

export class LookupIndex<T> {
  private readonly entries: Entry<T>[] = [];
  private readonly byKey = new Map<string, Entry<T>[]>();
  private readonly suggestionCache = new Map<string, string | null>();

  private constructor(private readonly options: LookupIndexOptions<T>) {}

  static fromRecords<T>(records: T[], options: LookupIndexOptions<T>): LookupIndex<T> {
    const index = new LookupIndex(options);
    for (const record of records) index.add(record);
    return index;
  }

  /**
   * Loads every live record of a master. Soft-deleted rows (`deletedAt`) are
   * already excluded by TypeORM; rows flagged `isDeleted` are dropped here.
   */
  static async load<T extends ObjectLiteral>(
    repository: Repository<T>,
    options: LookupIndexOptions<T> & { relations?: string[] },
  ): Promise<LookupIndex<T>> {
    const records = await repository.find({ relations: options.relations });
    return LookupIndex.fromRecords(
      records.filter((record) => !(record as { isDeleted?: boolean }).isDeleted),
      options,
    );
  }

  /** Adds a record, e.g. one created earlier in the same import. */
  add(record: T): void {
    const scope = this.options.scope?.(record) ?? null;
    const seen = new Set<string>();

    for (const name of this.options.names(record)) {
      const display = name?.trim();
      if (!display) continue;

      const key = normaliseName(display);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const entry: Entry<T> = { record, key, scope, display };
      this.entries.push(entry);

      const bucket = this.byKey.get(key);
      if (bucket) bucket.push(entry);
      else this.byKey.set(key, [entry]);
    }

    this.suggestionCache.clear();
  }

  /**
   * Finds the record a sheet value names.
   *
   * With `scope`, only records under that parent count; without it, every
   * record does. A blank value is reported as missing with no suggestion -
   * whether blank is allowed is for the importer to decide.
   */
  find(value: string | null | undefined, scope?: string | null): LookupResult<T> {
    const key = value ? normaliseName(value) : '';
    if (!key) return { status: 'missing', suggestion: null };

    const scoped = scope !== undefined;
    const matches = (this.byKey.get(key) ?? []).filter(
      (entry) => !scoped || entry.scope === (scope ?? null),
    );

    const records = [...new Set(matches.map((entry) => entry.record))];
    if (records.length === 1) return { status: 'found', record: records[0] };
    if (records.length > 1) return { status: 'ambiguous', candidates: records };

    return { status: 'missing', suggestion: this.suggest(value, scope) };
  }

  /** The record a sheet value names, or null when it is missing or ambiguous. */
  match(value: string | null | undefined, scope?: string | null): T | null {
    const result = this.find(value, scope);
    return result.status === 'found' ? result.record : null;
  }

  /**
   * Closest existing name to a value that did not match, or null when nothing
   * is close. Cached, since the same typo usually repeats down a column.
   */
  suggest(value: string | null | undefined, scope?: string | null): string | null {
    const key = value ? normaliseName(value) : '';
    if (!key) return null;

    const scoped = scope !== undefined;
    const cacheKey = `${scoped ? scope ?? '' : '*'}|${key}`;
    if (this.suggestionCache.has(cacheKey)) {
      return this.suggestionCache.get(cacheKey) ?? null;
    }

    let best: { display: string; score: number } | null = null;
    for (const entry of this.entries) {
      if (scoped && entry.scope !== (scope ?? null)) continue;

      const score = nameSimilarity(key, entry.key);
      if (score >= SUGGESTION_THRESHOLD && (!best || score > best.score)) {
        best = { display: entry.display, score };
      }
    }

    const suggestion = best?.display ?? null;
    this.suggestionCache.set(cacheKey, suggestion);
    return suggestion;
  }

  /** Number of distinct records in the index. */
  get size(): number {
    return new Set(this.entries.map((entry) => entry.record)).size;
  }

  /** Every first name, sorted - the values for a dropdown. */
  displayNames(): string[] {
    const firstNames = new Map<T, string>();
    for (const entry of this.entries) {
      if (!firstNames.has(entry.record)) firstNames.set(entry.record, entry.display);
    }
    return [...new Set(firstNames.values())].sort((a, b) => a.localeCompare(b));
  }
}
