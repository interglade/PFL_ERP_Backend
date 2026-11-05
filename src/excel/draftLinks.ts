/**
 * Linked names on a registration row (vendor, customer, farmer, ...) that may
 * not match - docs/master-data-excel-plan.md §6.
 *
 * Large registration files are not rejected row by row for a typo: a linked
 * name that does not match is left empty, the record is saved as draft, and
 * the import report lists what was typed with the closest existing name.
 * A blank optional link is simply empty; a blank required link also makes the
 * record a draft.
 */

import { DraftIssue } from './excelImport.service';
import { LookupIndex } from './lookupIndex';

export interface DraftLinkIssue {
  field: string;
  typed: string;
  suggestion: string | null;
}

/** What the report shows for a required link left blank. */
export const EMPTY_LINK = '(empty)';

const ambiguousNote = (count: number) => `matches ${count} records - rename one of them`;

/** Collects the unmatched links of one row. */
export class DraftLinks {
  readonly issues: DraftLinkIssue[] = [];

  /**
   * One linked name. Blank returns null (an issue only when `required`); a
   * match returns the record; anything else returns null and is recorded.
   */
  one<T>(
    index: LookupIndex<T>,
    field: string,
    typed: string | null | undefined,
    options: { required?: boolean; scope?: string | null } = {},
  ): T | null {
    const text = typed?.trim();
    if (!text) {
      if (options.required) this.issues.push({ field, typed: EMPTY_LINK, suggestion: null });
      return null;
    }

    const found = index.find(text, options.scope);
    if (found.status === 'found') return found.record;

    this.issues.push({
      field,
      typed: text,
      suggestion:
        found.status === 'missing' ? found.suggestion : ambiguousNote(found.candidates.length),
    });
    return null;
  }

  /** A list of names: the ones that match are returned, each one that does not is recorded. */
  many<T>(index: LookupIndex<T>, field: string, names: string[]): T[] {
    const records: T[] = [];
    for (const name of names) {
      const record = this.one(index, field, name);
      if (record && !records.includes(record)) records.push(record);
    }
    return records;
  }

  /** Records an issue found by the caller, e.g. a crop block with no crop name. */
  note(field: string, typed: string, suggestion: string | null = null): void {
    this.issues.push({ field, typed, suggestion });
  }

  /** True when anything was left empty - the record is saved as draft. */
  get isDraft(): boolean {
    return this.issues.length > 0;
  }

  /** The issues in the shape the import report takes. */
  toReport(row: number, code: string | null, name: string | null, outcome = 'Draft'): DraftIssue[] {
    return this.issues.map((issue) => ({ row, code, name, ...issue, outcome }));
  }
}
