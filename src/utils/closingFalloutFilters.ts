export type InferredLoanStatus = 'Active' | 'Locked' | 'Closed' | 'Withdrawn' | 'Denied';

function safeUpper(v: unknown): string {
  return (v ?? '').toString().toUpperCase();
}

export function inferLoanStatus(loan: any): InferredLoanStatus {
  if (loan?.closing_date) return 'Closed';
  if (loan?.lock_date) return 'Locked';

  const rawStatus = safeUpper(loan?.status);

  if (['WITHDRAWN', 'CANCELLED'].includes(rawStatus)) return 'Withdrawn';
  if (['DENIED', 'DECLINED', 'REJECTED'].includes(rawStatus)) return 'Denied';
  if (['ORIGINATED', 'FUNDED', 'CLOSED', 'COMPLETE', 'COMPLETED'].includes(rawStatus)) return 'Closed';
  if (['LOCKED'].includes(rawStatus)) return 'Locked';

  // LOS imports sometimes store state codes as status; treat as active if not closed.
  if (/^[A-Z]{2}$/.test(rawStatus)) return 'Active';

  return 'Active';
}

export function getLoanAmountNumber(loan: any): number {
  const amount = loan?.loan_amount ?? loan?.amount ?? 0;
  if (typeof amount === 'number') return amount;
  const parsed = parseFloat(String(amount).replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getLoanBorrowerName(loan: any): string {
  return loan?.borrower_name ?? loan?.borrower ?? 'Unknown';
}

export function getLoanOfficerName(loan: any): string {
  return loan?.loan_officer_name ?? loan?.officer ?? loan?.loName ?? 'Unassigned';
}

export function daysSince(dateIso: string | null | undefined, now: Date = new Date()): number | null {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export type DateFilter = 'today' | 'mtd' | 'ytd' | 'custom';
export type PeriodValue = DateFilter | 'all' | 'last_month' | 'last_year' | string; // supports numeric year strings too

function isYearString(v: string): boolean {
  return /^\d{4}$/.test(v);
}

export function getPeriodRange(period: PeriodValue, now: Date = new Date(), year?: number): { start: Date | null; end: Date | null } {
  if (period === 'all' || period === 'custom') return { start: null, end: null };

  // Use provided year, or parse from period string, or use current year
  const targetYear = year || (typeof period === 'string' && isYearString(period) ? parseInt(period, 10) : now.getFullYear());

  if (typeof period === 'string' && isYearString(period)) {
    const year = parseInt(period, 10);
    return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
  }

  if (period === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { start, end };
  }

  if (period === 'mtd') {
    const start = new Date(targetYear, now.getMonth(), 1);
    const end = new Date(targetYear, now.getMonth(), now.getDate() + 1);
    return { start, end };
  }

  if (period === 'last_month') {
    const start = new Date(targetYear, now.getMonth() - 1, 1);
    const end = new Date(targetYear, now.getMonth(), 1);
    return { start, end };
  }

  if (period === 'ytd') {
    const start = new Date(targetYear, 0, 1);
    // For YTD, end should be today if targetYear is current year, or end of year if past year
    const end = targetYear === now.getFullYear() 
      ? new Date(targetYear, now.getMonth(), now.getDate() + 1)
      : new Date(targetYear + 1, 0, 1);
    return { start, end };
  }

  if (period === 'last_year') {
    const start = new Date(targetYear - 1, 0, 1);
    const end = new Date(targetYear, 0, 1);
    return { start, end };
  }

  // Unknown period string: default to all-time.
  return { start: null, end: null };
}

export function isDateInPeriod(dateIso: string | null | undefined, period: PeriodValue, now: Date = new Date()): boolean {
  if (!dateIso) return false;
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return false;

  const { start, end } = getPeriodRange(period, now);
  if (!start && !end) return true;
  if (start && date < start) return false;
  if (end && date >= end) return false;
  return true;
}

export function isFundedInPeriod(loan: any, period: PeriodValue, now: Date = new Date()): boolean {
  const closeDateIso = loan?.closing_date;
  return isDateInPeriod(closeDateIso, period, now);
}

export function isLikelyCloseLate(loan: any, thresholdDays: number = 30, now: Date = new Date()): boolean {
  const inferred = inferLoanStatus(loan);
  if (!['Active', 'Locked'].includes(inferred)) return false;
  const days = daysSince(loan?.application_date, now);
  return days !== null && days > thresholdDays;
}

