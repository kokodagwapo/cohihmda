/**
 * TopTiering CSV Template Generator
 * Optimized for funnel visualization and tiering calculations (conversion rates, fallout analysis, revenue impact)
 */

export interface TopTieringCsvRow {
  loan_id: string;
  borrower_name?: string;
  loan_amount: number;
  loan_type: string;
  application_date: string;
  respa_date?: string;
  lock_date?: string;
  closing_date?: string;
  status: string;
  fallout_reason?: string; // 'withdrawn', 'denied', 'no-respa'
  loan_officer_id?: string;
  loan_officer_name?: string;
  loan_officer_role?: string;
  branch?: string;
  fico_score?: number;
  ltv?: number;
  loan_purpose?: string;
  interest_rate?: number;
  credit_pull_date?: string;
  complexity_score?: number;
  revenue?: number;
  lost_revenue?: number; // For fallout loans
}

/**
 * Generate TopTiering CSV template headers
 */
export function getTopTieringCsvHeaders(): string[] {
  return [
    'loan_id',
    'borrower_name',
    'loan_amount',
    'loan_type',
    'application_date',
    'respa_date',
    'lock_date',
    'closing_date',
    'status',
    'fallout_reason',
    'loan_officer_id',
    'loan_officer_name',
    'loan_officer_role',
    'branch',
    'fico_score',
    'ltv',
    'loan_purpose',
    'interest_rate',
    'credit_pull_date',
    'complexity_score',
    'revenue',
    'lost_revenue',
  ];
}

/**
 * Generate TopTiering CSV template as CSV string
 */
export function generateTopTieringCsvTemplate(): string {
  const headers = getTopTieringCsvHeaders();
  const rows: string[][] = [headers];
  
  // Add example rows for different funnel stages and fallout - covering all funnel visualization needs
  const exampleRows: string[][] = [
    // Originated loan - successful completion through funnel
    [
      'LOAN-001',
      'John Doe',
      '350000',
      'Conventional',
      '2025-01-15',
      '2025-01-20',
      '2025-02-10',
      '2025-02-28',
      'Closed',
      '',
      '',
      'Sarah Chen',
      'Loan Officer',
      'Downtown',
      '750',
      '80',
      'Purchase',
      '6.5',
      '2025-01-10',
      '3',
      '3500',
      '',
    ],
    // Withdrawn loan - fallout for funnel visualization
    [
      'LOAN-002',
      'Jane Withdrawn',
      '425000',
      'FHA',
      '2025-01-10',
      '2025-01-15',
      '',
      '',
      'Withdrawn',
      'withdrawn',
      '',
      'Michael Rodriguez',
      'Loan Officer',
      'Westside',
      '680',
      '95',
      'Refinance',
      '6.25',
      '2025-01-08',
      '5',
      '',
      '4250',
    ],
    // Denied loan - fallout for funnel visualization
    [
      'LOAN-003',
      'Tom Denied',
      '280000',
      'Conventional',
      '2025-01-05',
      '',
      '',
      '',
      'Denied',
      'denied',
      '',
      'Emily Johnson',
      'Loan Officer',
      'North Branch',
      '620',
      '85',
      'Purchase',
      '6.00',
      '2025-01-03',
      '4',
      '',
      '2800',
    ],
    // Active loan without RESPA - for no-respa-app stage
    [
      'LOAN-004',
      'Mary NoRespa',
      '500000',
      'Jumbo',
      '2025-01-20',
      '',
      '',
      '',
      'Active',
      'no-respa',
      '',
      'David Kim',
      'Loan Officer',
      'Eastside',
      '780',
      '70',
      'Purchase',
      '6.75',
      '2025-01-18',
      '2',
      '',
      '5000',
    ],
    // Active loan with RESPA - for respa-app stage
    [
      'LOAN-005',
      'Robert Active',
      '480000',
      'Conventional',
      '2025-01-25',
      '2025-01-30',
      '2025-02-15',
      '',
      'Active',
      '',
      '',
      'Sarah Chen',
      'Loan Officer',
      'Downtown',
      '730',
      '72',
      'Purchase',
      '6.40',
      '2025-01-23',
      '3',
      '',
      '',
    ],
    // Closed loan with full Ops data - for Ops metrics and TopTiering
    [
      'LOAN-006',
      'Mary OpsComplete',
      '450000',
      'Conventional',
      '2025-01-10',
      '2025-01-15',
      '2025-02-05',
      '2025-02-28',
      'Closed',
      '',
      '',
      'Sarah Chen',
      'Loan Officer',
      'Downtown',
      '740',
      '75',
      'Purchase',
      '6.50',
      '2025-01-12',
      '2',
      '4500',
      '',
    ],
  ];
  rows.push(...exampleRows);
  
  // Convert to CSV string
  return rows.map(row => 
    row.map(cell => {
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(',')
  ).join('\n');
}

/**
 * Validate TopTiering CSV row
 */
export function validateTopTieringCsvRow(row: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!row.loan_id) errors.push('loan_id is required');
  if (!row.loan_amount || isNaN(parseFloat(row.loan_amount))) {
    errors.push('loan_amount must be a valid number');
  }
  if (!row.loan_type) errors.push('loan_type is required');
  if (!row.application_date) errors.push('application_date is required');
  if (!row.status) errors.push('status is required');
  
  // Validate date formats
  if (row.application_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.application_date)) {
    errors.push('application_date must be in YYYY-MM-DD format');
  }
  if (row.respa_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.respa_date)) {
    errors.push('respa_date must be in YYYY-MM-DD format');
  }
  if (row.lock_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.lock_date)) {
    errors.push('lock_date must be in YYYY-MM-DD format');
  }
  if (row.closing_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.closing_date)) {
    errors.push('closing_date must be in YYYY-MM-DD format');
  }
  
  // Validate fallout_reason if provided
  if (row.fallout_reason && !['withdrawn', 'denied', 'no-respa'].includes(row.fallout_reason)) {
    errors.push('fallout_reason must be one of: withdrawn, denied, no-respa');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
