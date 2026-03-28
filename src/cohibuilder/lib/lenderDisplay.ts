import type { BuilderImportRow } from '../data/builderImportFields';
import { externalLenderFromImportRow } from './externalLenderFromRow';

/** Generic “we don’t know the bank yet” copy from older imports. */
export function isPlaceholderExternalLender(lender: string): boolean {
  return /external lender\s*\(see capture/i.test((lender || '').trim());
}

/**
 * Short, list-friendly lender label. TBI Mortgage preferred shows as “TB Mortgage”; captive keeps “TB Mortgage · Captive”.
 * Long third-party names truncate with an ellipsis (full string stays on `title`).
 */
export function primaryLenderLabel(lender: string, isPreferred: boolean, maxLen = 44): string {
  const s = (lender || '').trim();
  if (!s || s === '—') return '—';
  if (isPlaceholderExternalLender(s)) return 'Unknown lender';

  if (isPreferred) {
    if (/captive/i.test(s)) return 'TB Mortgage · Captive';
    if (/preferred/i.test(s) && /toll/i.test(s.toLowerCase())) return 'TB Mortgage';
  }

  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(8, maxLen - 1))}…`;
}

/**
 * Like `primaryLenderLabel`, but if `lender` is the legacy placeholder and an import row exists,
 * resolve the real third-party name from `External_Lender` / `Capture_Lost_Comment`.
 */
export function resolvedPrimaryLenderLabel(
  lender: string,
  isPreferred: boolean,
  row: BuilderImportRow | undefined,
  maxLen = 44,
): string {
  if (!isPreferred && isPlaceholderExternalLender(lender) && row) {
    const r = externalLenderFromImportRow(row, lender);
    if (r !== '—') return primaryLenderLabel(r, false, maxLen);
  }
  return primaryLenderLabel(lender, isPreferred, maxLen);
}

/** Full lender string for `title` tooltips (untruncated when resolvable from import). */
export function resolvedLenderTitle(
  lender: string,
  isPreferred: boolean,
  row: BuilderImportRow | undefined,
): string {
  if (!isPreferred && row) {
    const r = externalLenderFromImportRow(row, lender);
    if (r !== '—') return r;
  }
  if (isPreferred) return primaryLenderLabel(lender, isPreferred, 500);
  return lender;
}

/** Short name for inline copy (e.g. “confirm with …”). */
export function lenderMessagingName(lender: string, row: BuilderImportRow | undefined): string {
  if (row && isPlaceholderExternalLender(lender)) {
    const x = externalLenderFromImportRow(row, lender);
    if (x !== '—') return x;
  }
  return lender.split('(')[0].trim();
}
