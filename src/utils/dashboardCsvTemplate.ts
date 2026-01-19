/**
 * Unified CSV Template Generator
 * Creates a comprehensive CSV template for loan data import
 */

export interface UnifiedCsvRow {
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
  loan_officer_id?: string;
  loan_officer_role?: string;
  branch?: string;
  loan_purpose?: string;
  property_address?: string;
  property_city?: string;
  property_state?: string;
  property_zip?: string;
  property_type?: string;
  fico_score?: number;
  ltv?: number;
  credit_pull_date?: string;
  fund_date?: string;
  respa_date?: string;
  cycle_time_days?: number;
  revenue?: number;
  complexity_score?: number;
  fallout_reason?: string;
  nmls_id?: string;
}

/**
 * Generate unified CSV template headers
 */
export function getUnifiedCsvHeaders(): string[] {
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
    'loan_officer_id',
    'loan_officer_role',
    'branch',
    'loan_purpose',
    'property_address',
    'property_city',
    'property_state',
    'property_zip',
    'property_type',
    'fico_score',
    'ltv',
    'credit_pull_date',
    'fund_date',
    'respa_date',
    'cycle_time_days',
    'revenue',
    'complexity_score',
    'fallout_reason',
    'nmls_id',
  ];
}

/**
 * Generate unified CSV template as CSV string
 */
export function generateUnifiedCsvTemplate(): string {
  const headers = getUnifiedCsvHeaders();
  const rows: string[][] = [headers];
  
  // Add example rows showing different scenarios for Business Overview, Leaderboard, and Loan Funnel
  const exampleRows: string[][] = [
    // Active loan - for Business Overview Active Loans card
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
      '',
      'Loan Officer',
      'Downtown',
      'Purchase',
      '123 Main St',
      'Anytown',
      'NY',
      '12345',
      'Single Family',
      '750',
      '80',
      '2025-01-16',
      '',
      '2025-01-20',
      '',
      '3500',
      '3',
      '',
      'NMLS100001',
    ],
    // Closed loan with full Ops data - for Ops metrics (cycle time, turn time by stage)
    [
      'LOAN-006',
      'Mary OpsComplete',
      '450000',
      'Conventional',
      'Closed',
      '2025-01-10',
      '2025-02-28',
      '2025-02-05',
      '6.50',
      'Sarah Chen',
      '',
      'Loan Officer',
      'Downtown',
      'Purchase',
      '123 Main St',
      'Anytown',
      'NY',
      '12345',
      'Single Family',
      '740',
      '75',
      '2025-01-12',
      '2025-02-28',
      '2025-01-15',
      '49',
      '4500',
      '2',
      '',
      'NMLS100001',
    ],
    // Closed loan - for Business Overview Closed Loans card and Leaderboard
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
      '',
      'Loan Officer',
      'Westside',
      'Refinance',
      '456 Oak Ave',
      'Anytown',
      'TX',
      '54321',
      'Condo',
      '680',
      '80',
      '2024-11-28',
      '2024-12-28',
      '2024-12-05',
      '27',
      '4250',
      '4',
      '',
      'NMLS100002',
    ],
    // Locked loan - for Business Overview Locked Loans card
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
      '',
      'Loan Officer',
      'Eastside',
      'Purchase',
      '789 Pine Rd',
      'Anytown',
      'IL',
      '67890',
      'Single Family',
      '740',
      '65',
      '2025-10-28',
      '',
      '2025-11-05',
      '',
      '5500',
      '2',
      '',
      'NMLS100003',
    ],
    // Withdrawn loan - for Loan Funnel fallout and Business Overview Pull-Through
    [
      'LOAN-004',
      'Mary Withdrawn',
      '400000',
      'Conventional',
      'Withdrawn',
      '2025-10-01',
      '',
      '',
      '6.50',
      'Sarah Chen',
      '',
      'Loan Officer',
      'Downtown',
      'Purchase',
      '321 Elm St',
      'Anytown',
      'NY',
      '11111',
      'Single Family',
      '700',
      '75',
      '2025-09-28',
      '',
      '',
      '',
      '',
      '3',
      'withdrawn',
      'NMLS100004',
    ],
    // Denied loan - for Loan Funnel fallout and Business Overview Pull-Through
    [
      'LOAN-005',
      'Tom Denied',
      '380000',
      'FHA',
      'Denied',
      '2025-10-05',
      '',
      '',
      '6.40',
      'Michael Rodriguez',
      '',
      'Loan Officer',
      'Westside',
      'Refinance',
      '654 Maple Dr',
      'Anytown',
      'TX',
      '22222',
      'Condo',
      '650',
      '90',
      '2025-10-02',
      '',
      '',
      '',
      '',
      '5',
      'denied',
      'NMLS100005',
    ],
  ];
  rows.push(...exampleRows);
  
  // Convert to CSV string
  return rows.map(row => 
    row.map(cell => {
      // Escape cells that contain commas, quotes, or newlines
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(',')
  ).join('\n');
}

/**
 * Validate unified CSV row
 */
export function validateUnifiedCsvRow(row: any): { valid: boolean; errors: string[] } {
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
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
