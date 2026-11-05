import crypto from 'crypto';

const EMPLOYEE_ID_PREFIX = 'PF00';
const EMPLOYEE_ID_PATTERN = /^PF00(\d+)$/i;

/**
 * The next `count` Employee IDs after the highest one already given out
 * (deleted users included), so an ID is never handed out twice. The old rule,
 * number of users + 1, repeated an ID after a delete.
 */
export function nextEmployeeIds(existingIds: (string | null | undefined)[], count: number): string[] {
  let highest = 0;
  for (const id of existingIds) {
    const match = id?.trim().match(EMPLOYEE_ID_PATTERN);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return Array.from(
    { length: count },
    (_, index) => `${EMPLOYEE_ID_PREFIX}${String(highest + index + 1).padStart(4, '0')}`,
  );
}

/** A random first password; admins see it in the user list and hand it over. */
export function randomPassword(length = 10): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&';
  let password = '';
  for (let i = 0; i < length; i++) password += charset[crypto.randomInt(0, charset.length)];
  return password;
}
