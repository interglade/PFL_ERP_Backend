/**
 * Login keys and contact details no two users may share (docs/user-import-plan.md D7):
 * the username; every mobile (primary, secondary, CUG) against every other user's
 * mobiles; every email (primary, secondary, work) against every other user's emails.
 * The same value twice on one user is fine (a CUG number that is also the primary).
 *
 * Shared by the Excel import and the user form, so both apply the same rule.
 */

export const CONTACT_FIELDS = [
  'username',
  'primaryMobNo',
  'secondaryMobNo',
  'cugNo',
  'primaryEmail',
  'secondaryEmail',
  'workEmail',
] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

const POOL: Record<ContactField, 'username' | 'mobile' | 'email'> = {
  username: 'username',
  primaryMobNo: 'mobile',
  secondaryMobNo: 'mobile',
  cugNo: 'mobile',
  primaryEmail: 'email',
  secondaryEmail: 'email',
  workEmail: 'email',
};

export const CONTACT_LABELS: Record<ContactField, string> = {
  username: 'Username',
  primaryMobNo: 'Primary Mobile',
  secondaryMobNo: 'Secondary Mobile',
  cugNo: 'CUG No',
  primaryEmail: 'Primary Email',
  secondaryEmail: 'Secondary Email',
  workEmail: 'Work Email',
};

export interface ContactOwner {
  /** The user's id, or a stand-in for a user not saved yet. */
  key: string;
  /** How a clash names this user, e.g. "PF000012 Ravi Patil" or "row 7". */
  label: string;
  /** Spreadsheet row; null for a user the file does not touch. */
  row: number | null;
  /** The values the user will have once the save is done. */
  values: Partial<Record<ContactField, string | null | undefined>>;
  /** Fields this save sets or changes. Only these are checked; the rest only hold their value. */
  checked: ContactField[];
}

export interface ContactClash {
  row: number;
  property: ContactField;
  value: string;
  by: string;
}

/** Compares mobiles by their last 10 digits and usernames / emails without case. */
export function contactKey(field: ContactField, value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (POOL[field] === 'mobile') {
    const digits = text.replace(/\D/g, '');
    return digits ? digits.slice(-10) : null;
  }
  return text.toLowerCase();
}

/**
 * Every checked value another user already holds. When two rows of a file set
 * the same value, the later row is the one reported.
 */
export function findContactClashes(owners: ContactOwner[]): ContactClash[] {
  const holders = new Map<string, { owner: ContactOwner; field: ContactField }[]>();
  for (const owner of owners) {
    for (const field of CONTACT_FIELDS) {
      const key = contactKey(field, owner.values[field]);
      if (!key) continue;
      const poolKey = `${POOL[field]}|${key}`;
      holders.set(poolKey, [...(holders.get(poolKey) ?? []), { owner, field }]);
    }
  }

  const clashes: ContactClash[] = [];
  for (const owner of owners) {
    if (owner.row === null) continue;
    for (const field of owner.checked) {
      const value = owner.values[field];
      const key = contactKey(field, value);
      if (!key) continue;
      const others = (holders.get(`${POOL[field]}|${key}`) ?? []).filter((entry) => entry.owner.key !== owner.key);
      const holder = others.find((entry) => {
        const otherChecks = entry.owner.row !== null && entry.owner.checked.includes(entry.field);
        return !otherChecks || entry.owner.row! < owner.row!;
      });
      if (!holder) continue;
      const fromFile = holder.owner.row !== null && holder.owner.checked.includes(holder.field);
      clashes.push({
        row: owner.row,
        property: field,
        value: value!.trim(),
        by: fromFile && holder.owner.label.startsWith('row ') ? holder.owner.label : `user ${holder.owner.label}`,
      });
    }
  }
  return clashes;
}
