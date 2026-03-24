export type InferredLoanStatus =
  | "Active"
  | "Locked"
  | "Closed"
  | "Withdrawn"
  | "Denied";

function safeUpper(v: unknown): string {
  return (v ?? "").toString().toUpperCase();
}

export function inferLoanStatus(loan: any): InferredLoanStatus {
  if (loan?.closing_date || loan?.funding_date) return "Closed";
  if (loan?.lock_date) return "Locked";

  // Check both status and current_loan_status (API returns current_loan_status)
  const rawStatus = safeUpper(loan?.current_loan_status ?? loan?.status ?? "");

  if (
    [
      "WITHDRAWN",
      "CANCELLED",
      "APPLICATION WITHDRAWN",
      "FILE CLOSED FOR INCOMPLETENESS",
    ].some((x) => rawStatus.includes(x))
  )
    return "Withdrawn";
  if (["DENIED", "DECLINED", "REJECTED"].some((x) => rawStatus.includes(x)))
    return "Denied";
  if (
    [
      "ORIGINATED",
      "FUNDED",
      "CLOSED",
      "COMPLETE",
      "COMPLETED",
      "LOAN ORIGINATED",
    ].some((x) => rawStatus.includes(x))
  )
    return "Closed";
  if (["LOCKED"].includes(rawStatus)) return "Locked";

  // LOS imports sometimes store state codes as status; treat as active if not closed.
  if (/^[A-Z]{2}$/.test(rawStatus)) return "Active";

  // Active Loan and other in-pipeline statuses
  if (
    ["ACTIVE LOAN", "ACTIVE"].some((x) => rawStatus.includes(x)) ||
    !rawStatus
  )
    return "Active";

  return "Active";
}

export function getLoanAmountNumber(loan: any): number {
  const amount = loan?.loan_amount ?? loan?.amount ?? 0;
  if (typeof amount === "number") return amount;
  const parsed = parseFloat(String(amount).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getLoanBorrowerName(loan: any): string {
  return loan?.borrower_name ?? loan?.borrower ?? "Unknown";
}

export function getLoanOfficerName(loan: any): string {
  return (
    loan?.loan_officer_name ?? loan?.officer ?? loan?.loName ?? "Unassigned"
  );
}

export function daysSince(
  dateIso: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export type DateFilter = "today" | "mtd" | "ytd" | "custom";
export type PeriodValue =
  | DateFilter
  | "all"
  | "last_month"
  | "last_year"
  | string; // supports numeric year strings too

function isYearString(v: string): boolean {
  return /^\d{4}$/.test(v);
}

export function getPeriodRange(
  period: PeriodValue,
  now: Date = new Date(),
  year?: number
): { start: Date | null; end: Date | null } {
  if (period === "all" || period === "custom")
    return { start: null, end: null };

  // Use provided year, or parse from period string, or use current year
  const targetYear =
    year ||
    (typeof period === "string" && isYearString(period)
      ? parseInt(period, 10)
      : now.getFullYear());

  if (typeof period === "string" && isYearString(period)) {
    const year = parseInt(period, 10);
    return { start: new Date(year, 0, 1), end: new Date(year, 11, 31) };
  }

  if (period === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { start, end };
  }

  if (period === "mtd") {
    const start = new Date(targetYear, now.getMonth(), 1);
    const end = new Date(targetYear, now.getMonth(), now.getDate());
    return { start, end };
  }

  if (period === "last_month") {
    const start = new Date(targetYear, now.getMonth() - 1, 1);
    const end = new Date(targetYear, now.getMonth(), 0);
    return { start, end };
  }

  if (period === "ytd") {
    const start = new Date(targetYear, 0, 1);
    const end =
      targetYear === now.getFullYear()
        ? new Date(targetYear, now.getMonth(), now.getDate())
        : new Date(targetYear, 11, 31);
    return { start, end };
  }

  if (period === "last_year") {
    const start = new Date(targetYear - 1, 0, 1);
    const end = new Date(targetYear - 1, 11, 31);
    return { start, end };
  }

  // Rolling 90 days: for operational pull-through metrics
  // More appropriate than MTD for metrics where loans take 30-45+ days to close
  if (period === "rolling_90_days") {
    const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return { start, end: now };
  }

  // Rolling 13 months: matches Qlik TTS scorecard timeframe
  // Formula from Qlik: MonthEnd(maxDate) - 13 months (inclusive of current month)
  if (period === "rolling_13_months") {
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month
    const start = new Date(monthEnd.getFullYear(), monthEnd.getMonth() - 12, 1); // First day of month 13 months ago
    return { start, end: monthEnd };
  }

  // Rolling N months for fallout filtering
  if (period === "rolling_3_months") {
    const start = new Date(
      now.getFullYear(),
      now.getMonth() - 3,
      now.getDate()
    );
    return { start, end: now };
  }
  if (period === "rolling_6_months") {
    const start = new Date(
      now.getFullYear(),
      now.getMonth() - 6,
      now.getDate()
    );
    return { start, end: now };
  }
  if (period === "rolling_12_months") {
    const start = new Date(
      now.getFullYear(),
      now.getMonth() - 12,
      now.getDate()
    );
    return { start, end: now };
  }
  if (period === "rolling_18_months") {
    const start = new Date(
      now.getFullYear(),
      now.getMonth() - 18,
      now.getDate()
    );
    return { start, end: now };
  }

  // Unknown period string: default to all-time.
  return { start: null, end: null };
}

/**
 * Parse a date string that may be in various formats:
 * - ISO: "2025-12-15" or "2025-12-15T00:00:00.000Z"
 * - US format: "12/15/2025" or "12-15-2025"
 * - Epoch timestamp (number or string)
 */
function parseDate(dateValue: string | number): Date | null {
  if (!dateValue) return null;

  // Handle numeric timestamps
  if (typeof dateValue === "number") {
    const d = new Date(dateValue);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const str = String(dateValue).trim();
  if (!str) return null;

  // Try direct parsing first (works for ISO and many formats)
  let d = new Date(str);
  if (!Number.isNaN(d.getTime())) return d;

  // Try US format MM/DD/YYYY or MM-DD-YYYY
  const usMatch = str.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    d = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10)
    );
    if (!Number.isNaN(d.getTime())) return d;
  }

  // Try YYYY/MM/DD format
  const isoSlashMatch = str.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/);
  if (isoSlashMatch) {
    const [, year, month, day] = isoSlashMatch;
    d = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10)
    );
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

export function isDateInPeriod(
  dateIso: string | null | undefined,
  period: PeriodValue,
  now: Date = new Date()
): boolean {
  if (!dateIso) return false;

  const date = parseDate(dateIso);
  if (!date) return false;

  const { start, end } = getPeriodRange(period, now);
  if (!start && !end) return true;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

/**
 * Helper to get funded/closing date from multiple possible field names
 */
export function getFundedDate(loan: any): string | null | undefined {
  return (
    loan?.closing_date ??
    loan?.funding_date ??
    loan?.fund_date ??
    loan?.["Closing Date"] ??
    loan?.["Fund Date"] ??
    loan?.["Funding Date"]
  );
}

/**
 * Check if loan is funded (has status "Loan Originated" OR has a closing/funding date)
 */
export function isFundedLoan(loan: any): boolean {
  // Check status first
  const status = safeUpper(
    loan?.current_loan_status ?? loan?.["Current Loan Status"] ?? loan?.status
  );
  if (status === "LOAN ORIGINATED") return true;

  // Also check if closing/funding date exists
  const fundedDate = getFundedDate(loan);
  return !!fundedDate && fundedDate.toString().trim().length > 0;
}

export function isFundedInPeriod(
  loan: any,
  period: PeriodValue,
  now: Date = new Date()
): boolean {
  // First check if loan is actually funded
  if (!isFundedLoan(loan)) return false;

  // For 'all' period, if the loan is funded, include it
  if (period === "all") return true;

  // For other periods, check if closing/funding date is within the period
  const closeDateIso = getFundedDate(loan);

  // If no date but loan is funded, we can't filter by date - include in 'all' only
  if (!closeDateIso) return false;

  return isDateInPeriod(closeDateIso, period, now);
}

export function isLikelyCloseLate(
  loan: any,
  thresholdDays: number = 30,
  now: Date = new Date()
): boolean {
  const inferred = inferLoanStatus(loan);
  if (!["Active", "Locked"].includes(inferred)) return false;

  // Primary: server-computed close-late risk (from prediction API)
  if (loan?.closeLateRisk != null) {
    return loan.closeLateRisk === true;
  }

  // Fallback: check estimated_closing_date (the correct DB field name)
  const estClose =
    loan?.estimated_closing_date ||
    loan?.estimatedClosingDate ||
    loan?.expected_close_date;

  if (estClose) {
    const d = new Date(estClose);
    if (!Number.isNaN(d.getTime())) {
      const daysPast = Math.floor(
        (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
      );
      return daysPast > 3; // More than 3 days past estimated close
    }
  }

  // Last resort: loan age exceeds threshold
  const days = daysSince(loan?.application_date, now);
  return days !== null && days > thresholdDays;
}
