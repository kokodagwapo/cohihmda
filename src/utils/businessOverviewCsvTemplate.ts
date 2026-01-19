/**
 * Business Overview CSV Template Generator
 * Optimized for Business Overview metrics (active loans, closed loans, cycle time, pull-through)
 */

export interface BusinessOverviewCsvRow {
  loan_id: string;
  borrower_name: string;
  loan_amount: number;
  loan_type: string;
  status: string;
  application_date: string;
  closing_date?: string;
  lock_date?: string;
  interest_rate?: number;
  loan_officer_name?: string;
  loan_officer_role?: string;
  branch?: string;
  fico_score?: number;
  ltv?: number;
  loan_purpose?: string;
  credit_pull_date?: string;
  respa_date?: string;
  fallout_reason?: string; // 'withdrawn', 'denied', 'no-respa'
  cycle_time_days?: number;
}

/**
 * Generate Business Overview CSV template headers
 */
export function getBusinessOverviewCsvHeaders(): string[] {
  return [
    'loan_id',
    'borrower_name',
    'loan_amount',
    'loan_type',
    'status',
    'application_date',
    'closing_date',
    'lock_date',
    'interest_rate',
    'loan_officer_name',
    'loan_officer_role',
    'branch',
    'fico_score',
    'ltv',
    'loan_purpose',
    'credit_pull_date',
    'respa_date',
    'fallout_reason',
    'cycle_time_days',
  ];
}

/**
 * Generate Business Overview CSV template as CSV string
 */
export function generateBusinessOverviewCsvTemplate(): string {
  const headers = getBusinessOverviewCsvHeaders();
  const rows: string[][] = [headers];
  
  // Add example rows for different statuses - covering all Business Overview modal breakdowns
  const exampleRows: string[][] = [
    // Active loan - Conventional, Purchase - for "By Loan Type" and "By Loan Purpose" breakdowns
    [
      'LOAN-001',
      'John Doe',
      '350000',
      'Conventional',
      'Active',
      '2025-01-15',
      '',
      '2025-02-10',
      '6.5',
      'Sarah Chen',
      'Loan Officer',
      'Downtown',
      '720',
      '75',
      'Purchase',
      '2025-01-10',
      '2025-01-20',
      '',
      '45',
    ],
    // Closed loan - FHA, Refinance - for Closed Loans modal
    [
      'LOAN-002',
      'Jane Smith',
      '425000',
      'FHA',
      'Closed',
      '2024-12-01',
      '2024-12-28',
      '2024-12-15',
      '6.25',
      'Michael Rodriguez',
      'Loan Officer',
      'Westside',
      '680',
      '80',
      'Refinance',
      '2024-11-28',
      '2024-12-05',
      '',
      '27',
    ],
    // Locked loan - Jumbo, Purchase - for Locked Loans modal
    [
      'LOAN-003',
      'Robert Johnson',
      '550000',
      'Jumbo',
      'Locked',
      '2025-11-01',
      '',
      '2025-11-20',
      '6.75',
      'David Kim',
      'Loan Officer',
      'Eastside',
      '740',
      '65',
      'Purchase',
      '2025-10-28',
      '2025-11-05',
      '',
      '',
    ],
    // VA loan - for loan type distribution
    [
      'LOAN-004',
      'Mary Williams',
      '280000',
      'VA',
      'Active',
      '2025-10-25',
      '',
      '',
      '6.00',
      'Emily Johnson',
      'Loan Officer',
      'North Branch',
      '750',
      '70',
      'Purchase',
      '2025-10-22',
      '',
      '',
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
 * Validate Business Overview CSV row
 */
export function validateBusinessOverviewCsvRow(row: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!row.loan_id) errors.push('loan_id is required');
  if (!row.borrower_name) errors.push('borrower_name is required');
  if (!row.loan_amount || isNaN(parseFloat(row.loan_amount))) {
    errors.push('loan_amount must be a valid number');
  }
  if (!row.loan_type) errors.push('loan_type is required');
  if (!row.status) errors.push('status is required');
  if (!row.application_date) errors.push('application_date is required');
  
  // Validate date formats
  if (row.application_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.application_date)) {
    errors.push('application_date must be in YYYY-MM-DD format');
  }
  if (row.closing_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.closing_date)) {
    errors.push('closing_date must be in YYYY-MM-DD format');
  }
  if (row.lock_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.lock_date)) {
    errors.push('lock_date must be in YYYY-MM-DD format');
  }
  
  // Validate pull_through_status if provided
  if (row.pull_through_status && !['originated', 'active', 'withdrawn', 'denied'].includes(row.pull_through_status)) {
    errors.push('pull_through_status must be one of: originated, active, withdrawn, denied');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
