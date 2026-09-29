export type NamedUser ={ id?: string; firstName?: string | null; lastName?: string | null };

/**
 * "Ravi Patil", "Ravi Patil and Neha Joshi", "Ravi Patil, Neha Joshi and Amit Shah".
 * Users without a name are skipped; the same user listed twice appears once.
 */
export const formatUserNames = (users: NamedUser[] | null | undefined): string => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const u of users ?? []) {
    const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
    const key = u.id ?? name;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};
