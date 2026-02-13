import { describe, it, expect } from 'vitest';
import {
  inferLoanStatus,
  getLoanAmountNumber,
  getLoanBorrowerName,
  getLoanOfficerName,
  daysSince,
  getPeriodRange,
  isDateInPeriod,
  isFundedLoan,
  isFundedInPeriod,
  isLikelyCloseLate,
} from './closingFalloutFilters';

// ============================================================================
// inferLoanStatus
// ============================================================================
describe('inferLoanStatus', () => {
  it('should return "Closed" for loans with closing_date', () => {
    expect(inferLoanStatus({ closing_date: '2026-01-15' })).toBe('Closed');
  });

  it('should return "Closed" for loans with funding_date', () => {
    expect(inferLoanStatus({ funding_date: '2026-01-15' })).toBe('Closed');
  });

  it('should return "Locked" for loans with lock_date and no closing', () => {
    expect(inferLoanStatus({ lock_date: '2026-01-10' })).toBe('Locked');
  });

  it('should detect withdrawn statuses', () => {
    expect(inferLoanStatus({ current_loan_status: 'Withdrawn' })).toBe('Withdrawn');
    expect(inferLoanStatus({ current_loan_status: 'Application Withdrawn' })).toBe('Withdrawn');
    expect(inferLoanStatus({ current_loan_status: 'Cancelled' })).toBe('Withdrawn');
    expect(inferLoanStatus({ current_loan_status: 'File Closed for Incompleteness' })).toBe('Withdrawn');
  });

  it('should detect denied statuses', () => {
    expect(inferLoanStatus({ current_loan_status: 'Denied' })).toBe('Denied');
    expect(inferLoanStatus({ current_loan_status: 'Declined' })).toBe('Denied');
    expect(inferLoanStatus({ current_loan_status: 'Rejected' })).toBe('Denied');
  });

  it('should detect closed statuses by status text', () => {
    expect(inferLoanStatus({ current_loan_status: 'Loan Originated' })).toBe('Closed');
    expect(inferLoanStatus({ current_loan_status: 'Funded' })).toBe('Closed');
    expect(inferLoanStatus({ current_loan_status: 'Completed' })).toBe('Closed');
  });

  it('should return "Active" for active or unknown statuses', () => {
    expect(inferLoanStatus({ current_loan_status: 'Active Loan' })).toBe('Active');
    expect(inferLoanStatus({ current_loan_status: '' })).toBe('Active');
    expect(inferLoanStatus({})).toBe('Active');
  });

  it('should treat state codes as Active', () => {
    expect(inferLoanStatus({ current_loan_status: 'CA' })).toBe('Active');
    expect(inferLoanStatus({ current_loan_status: 'NY' })).toBe('Active');
  });
});

// ============================================================================
// getLoanAmountNumber
// ============================================================================
describe('getLoanAmountNumber', () => {
  it('should return numeric loan_amount directly', () => {
    expect(getLoanAmountNumber({ loan_amount: 300000 })).toBe(300000);
  });

  it('should parse string amounts', () => {
    expect(getLoanAmountNumber({ loan_amount: '$300,000' })).toBe(300000);
    expect(getLoanAmountNumber({ loan_amount: '250000.50' })).toBe(250000.50);
  });

  it('should fallback to amount field', () => {
    expect(getLoanAmountNumber({ amount: 200000 })).toBe(200000);
  });

  it('should return 0 for missing data', () => {
    expect(getLoanAmountNumber({})).toBe(0);
    expect(getLoanAmountNumber({ loan_amount: 'invalid' })).toBe(0);
  });
});

// ============================================================================
// getLoanBorrowerName / getLoanOfficerName
// ============================================================================
describe('getLoanBorrowerName', () => {
  it('should return borrower_name', () => {
    expect(getLoanBorrowerName({ borrower_name: 'John Doe' })).toBe('John Doe');
  });

  it('should fallback to borrower field', () => {
    expect(getLoanBorrowerName({ borrower: 'Jane Doe' })).toBe('Jane Doe');
  });

  it('should return "Unknown" for missing data', () => {
    expect(getLoanBorrowerName({})).toBe('Unknown');
  });
});

describe('getLoanOfficerName', () => {
  it('should return loan_officer_name', () => {
    expect(getLoanOfficerName({ loan_officer_name: 'Mike Smith' })).toBe('Mike Smith');
  });

  it('should return "Unassigned" for missing data', () => {
    expect(getLoanOfficerName({})).toBe('Unassigned');
  });
});

// ============================================================================
// daysSince
// ============================================================================
describe('daysSince', () => {
  it('should calculate days since a date', () => {
    const now = new Date('2026-02-12');
    expect(daysSince('2026-02-10', now)).toBe(2);
    expect(daysSince('2026-02-12', now)).toBe(0);
  });

  it('should return null for null/undefined input', () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince(undefined)).toBeNull();
  });

  it('should return null for invalid date strings', () => {
    expect(daysSince('not-a-date')).toBeNull();
  });
});

// ============================================================================
// getPeriodRange
// ============================================================================
describe('getPeriodRange', () => {
  const now = new Date(2026, 1, 12); // Feb 12, 2026

  it('should return null range for "all" and "custom"', () => {
    const { start, end } = getPeriodRange('all', now);
    expect(start).toBeNull();
    expect(end).toBeNull();
  });

  it('should return today range', () => {
    const { start, end } = getPeriodRange('today', now);
    expect(start!.getDate()).toBe(12);
    expect(end!.getDate()).toBe(13);
  });

  it('should return month-to-date range', () => {
    const { start, end } = getPeriodRange('mtd', now);
    expect(start!.getDate()).toBe(1);
    expect(start!.getMonth()).toBe(1); // Feb
  });

  it('should return year-to-date range', () => {
    const { start, end } = getPeriodRange('ytd', now);
    expect(start!.getMonth()).toBe(0); // Jan
    expect(start!.getDate()).toBe(1);
  });

  it('should return last month range', () => {
    const { start, end } = getPeriodRange('last_month', now);
    expect(start!.getMonth()).toBe(0); // Jan
    expect(end!.getMonth()).toBe(1); // Feb 1
    expect(end!.getDate()).toBe(1);
  });

  it('should return last year range', () => {
    const { start, end } = getPeriodRange('last_year', now);
    expect(start!.getFullYear()).toBe(2025);
    expect(end!.getFullYear()).toBe(2026);
  });

  it('should parse year string as full year range', () => {
    const { start, end } = getPeriodRange('2025', now);
    expect(start!.getFullYear()).toBe(2025);
    expect(start!.getMonth()).toBe(0);
    expect(end!.getFullYear()).toBe(2026);
  });

  it('should handle rolling periods', () => {
    const { start, end } = getPeriodRange('rolling_90_days', now);
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();
    const dayDiff = Math.round((end!.getTime() - start!.getTime()) / (1000 * 60 * 60 * 24));
    expect(dayDiff).toBeCloseTo(90, 0);
  });
});

// ============================================================================
// isDateInPeriod
// ============================================================================
describe('isDateInPeriod', () => {
  const now = new Date(2026, 1, 12);

  it('should return false for null/undefined dates', () => {
    expect(isDateInPeriod(null, 'ytd', now)).toBe(false);
    expect(isDateInPeriod(undefined, 'ytd', now)).toBe(false);
  });

  it('should return true for dates within "all" period', () => {
    expect(isDateInPeriod('2020-01-01', 'all', now)).toBe(true);
  });

  it('should filter correctly for YTD', () => {
    expect(isDateInPeriod('2026-01-15', 'ytd', now)).toBe(true);
    expect(isDateInPeriod('2025-12-31', 'ytd', now)).toBe(false);
  });

  it('should filter correctly for MTD', () => {
    expect(isDateInPeriod('2026-02-05', 'mtd', now)).toBe(true);
    expect(isDateInPeriod('2026-01-31', 'mtd', now)).toBe(false);
  });
});

// ============================================================================
// isFundedLoan
// ============================================================================
describe('isFundedLoan', () => {
  it('should detect funded loans by status', () => {
    expect(isFundedLoan({ current_loan_status: 'Loan Originated' })).toBe(true);
  });

  it('should detect funded loans by closing date', () => {
    expect(isFundedLoan({ closing_date: '2026-01-15' })).toBe(true);
    expect(isFundedLoan({ funding_date: '2026-01-15' })).toBe(true);
  });

  it('should return false for active loans without close date', () => {
    expect(isFundedLoan({ current_loan_status: 'Active Loan' })).toBe(false);
    expect(isFundedLoan({})).toBe(false);
  });
});

// ============================================================================
// isFundedInPeriod
// ============================================================================
describe('isFundedInPeriod', () => {
  const now = new Date(2026, 1, 12);

  it('should return true for funded loans in period', () => {
    expect(isFundedInPeriod(
      { closing_date: '2026-01-15', current_loan_status: 'Loan Originated' },
      'ytd',
      now
    )).toBe(true);
  });

  it('should return false for unfunded loans', () => {
    expect(isFundedInPeriod(
      { current_loan_status: 'Active Loan' },
      'ytd',
      now
    )).toBe(false);
  });

  it('should return true for funded loans with "all" period', () => {
    expect(isFundedInPeriod(
      { closing_date: '2020-01-01' },
      'all',
      now
    )).toBe(true);
  });
});

// ============================================================================
// isLikelyCloseLate
// ============================================================================
describe('isLikelyCloseLate', () => {
  const now = new Date(2026, 1, 12);

  it('should return false for closed loans', () => {
    expect(isLikelyCloseLate(
      { closing_date: '2026-01-15', current_loan_status: 'Funded' },
      30,
      now
    )).toBe(false);
  });

  it('should detect close-late via server risk flag', () => {
    expect(isLikelyCloseLate(
      { current_loan_status: 'Active Loan', closeLateRisk: true },
      30,
      now
    )).toBe(true);
    expect(isLikelyCloseLate(
      { current_loan_status: 'Active Loan', closeLateRisk: false },
      30,
      now
    )).toBe(false);
  });

  it('should detect close-late via estimated closing date', () => {
    // Estimated close 10 days ago (> 3 days past)
    expect(isLikelyCloseLate(
      { current_loan_status: 'Active Loan', estimated_closing_date: '2026-01-30' },
      30,
      now
    )).toBe(true);
  });

  it('should detect close-late via loan age', () => {
    // Application 45 days ago, threshold 30
    expect(isLikelyCloseLate(
      { current_loan_status: 'Active Loan', application_date: '2025-12-29' },
      30,
      now
    )).toBe(true);
  });

  it('should return false for young active loans', () => {
    expect(isLikelyCloseLate(
      { current_loan_status: 'Active Loan', application_date: '2026-02-01' },
      30,
      now
    )).toBe(false);
  });
});
