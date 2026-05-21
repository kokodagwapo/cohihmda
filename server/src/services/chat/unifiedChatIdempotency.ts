/**
 * In-process idempotency for clientMessageId (COHI-387).
 * Suitable for single-instance dev/staging; replace with Redis/DB for horizontal scale.
 */

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const seen = new Map<string, number>();

function gc(): void {
  const now = Date.now();
  for (const [k, t] of seen) {
    if (now - t > TTL_MS) seen.delete(k);
  }
}

/**
 * @returns true if this key was already seen (duplicate within TTL)
 */
export function isDuplicateClientMessage(
  tenantId: string,
  userId: string,
  clientMessageId: string | undefined,
): boolean {
  if (!clientMessageId) return false;
  gc();
  const key = `${tenantId}:${userId}:${clientMessageId}`;
  const now = Date.now();
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}
