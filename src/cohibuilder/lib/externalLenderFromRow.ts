import type { BuilderImportRow } from '../data/builderImportFields';

/**
 * Third-party lender name for external capture rows.
 * Prefer explicit `External_Lender` on the import; otherwise parse Toll-style
 * `Capture_Lost_Comment` ("Borrower selected …"). Optional `loanLenderFallback`
 * uses portfolio `lender` when the row has no bank hint.
 */
export function externalLenderFromImportRow(
  row: BuilderImportRow | undefined,
  loanLenderFallback?: string,
): string {
  if (row) {
    const direct =
      row.External_Lender?.trim() ||
      row['External Lender']?.trim() ||
      row.Selected_Lender?.trim() ||
      row.Lender_Name?.trim();
    if (direct) return direct;
    const c = row.Capture_Lost_Comment?.trim() || '';
    const m = c.match(/borrower\s+selected\s+(.+)/i);
    if (m?.[1]) return m[1].trim();
  }
  const fb = loanLenderFallback?.trim();
  if (fb && !/^external lender\s*\(/i.test(fb)) {
    return fb.split('(')[0].trim() || '—';
  }
  return '—';
}
