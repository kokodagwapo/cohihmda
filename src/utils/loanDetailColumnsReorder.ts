/**
 * Pure helpers for reordering Loan Detail column definitions in the columns modal.
 */

/** Move item from `from` to final index `to` (0-based) in the result array. */
export function arrayMoveToFinalIndex<T>(list: readonly T[], from: number, to: number): T[] {
  const n = list.length;
  if (n === 0 || from < 0 || from >= n) return [...list];
  const clamped = Math.min(Math.max(to, 0), n - 1);
  if (from === clamped) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return next;
}

/**
 * Move the item at `fromIndex` so its 1-based position becomes `oneBased` (clamped to [1, n]).
 */
export function moveRowToOneBasedPosition<T>(list: readonly T[], fromIndex: number, oneBased: number): T[] {
  const n = list.length;
  if (n === 0 || fromIndex < 0 || fromIndex >= n) return [...list];
  const targetOneBased = Math.min(Math.max(Math.trunc(oneBased), 1), n);
  const targetZero = targetOneBased - 1;
  return arrayMoveToFinalIndex(list, fromIndex, targetZero);
}

/** Move item at `fromIndex` to the end of the list. */
export function moveRowToEndByIndex<T>(list: readonly T[], fromIndex: number): T[] {
  const n = list.length;
  if (n === 0 || fromIndex < 0 || fromIndex >= n) return [...list];
  const next = [...list];
  const [item] = next.splice(fromIndex, 1);
  next.push(item);
  return next;
}
