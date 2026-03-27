import type { CohiPortfolioLoan } from '../data/portfolioFromBuilderImport';

/**
 * Deep links use `loanId` query for either the synthetic portfolio id (hash) or the
 * import LOS number (`loanNumber` / Loanno). Prefer internal id, then match loanNumber.
 */
export function findLoanForNavId(
  loans: CohiPortfolioLoan[],
  navId: number | null,
): CohiPortfolioLoan | undefined {
  if (navId == null || loans.length === 0) return undefined;
  const byInternal = loans.find((l) => l.id === navId);
  if (byInternal) return byInternal;
  const asStr = String(navId);
  return loans.find((l) => {
    const raw = l.loanNumber?.trim();
    if (!raw) return false;
    if (raw === asStr) return true;
    const normalized = raw.replace(/,/g, '');
    const num = Number(normalized);
    return Number.isFinite(num) && num === navId;
  });
}
