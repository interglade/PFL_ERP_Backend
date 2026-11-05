/** Whether a user has been given any permission at all (docs/user-import-plan.md §6, D4). */

const TICKS = ['canCreate', 'canView', 'canEdit', 'canDelete', 'canDownload', 'canExport'] as const;

/** True when a permission row has at least one action ticked. */
export const hasAnyTick = (permission: Partial<Record<(typeof TICKS)[number], unknown>> | null | undefined): boolean =>
  !!permission && TICKS.some((tick) => permission[tick] === true || permission[tick] === 'true');

/** SQL condition for "this document_permissions row has a tick", for the table alias given. */
export const PERMISSION_TICKED_SQL = (alias: string): string =>
  `(${TICKS.map((tick) => `${alias}."${tick}"`).join(' OR ')})`;
