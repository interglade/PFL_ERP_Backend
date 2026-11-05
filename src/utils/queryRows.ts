/**
 * Rows of a raw `manager.query()` with RETURNING. TypeORM's Postgres driver
 * returns `[rows, affectedCount]` for UPDATE / DELETE and the plain rows for
 * SELECT / INSERT, so `result[0]` of an UPDATE is the row array, not a row.
 */
export function returnedRows<T>(result: unknown): T[] {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0] as T[];
  }
  return Array.isArray(result) ? (result as T[]) : [];
}
