/**
 * Leaderboard CSV Template Generator
 * Optimized for leaderboard rankings (employee performance, loans closed, revenue contribution)
 */

export interface LeaderboardCsvRow {
  employee_id: string;
  employee_name: string;
  role?: string;
  branch?: string;
  loan_id?: string;
  borrower_name?: string;
  loan_amount?: number;
  loan_type?: string;
  status?: string;
  application_date?: string;
  closing_date?: string;
  lock_date?: string;
  interest_rate?: number;
  cycle_time_days?: number;
  pull_through_status?: string;
  revenue_contribution?: number;
  loans_closed_count?: number;
  fico_score?: number;
  ltv?: number;
  loan_purpose?: string;
}

/**
 * Generate Leaderboard CSV template headers
 */
export function getLeaderboardCsvHeaders(): string[] {
  return [
    'employee_id',
    'employee_name',
    'role',
    'branch',
    'loan_id',
    'borrower_name',
    'loan_amount',
    'loan_type',
    'status',
    'application_date',
    'closing_date',
    'lock_date',
    'interest_rate',
    'cycle_time_days',
    'pull_through_status',
    'revenue_contribution',
    'loans_closed_count',
    'fico_score',
    'ltv',
    'loan_purpose',
  ];
}

/**
 * Generate Leaderboard CSV template as CSV string
 */
export function generateLeaderboardCsvTemplate(): string {
  const headers = getLeaderboardCsvHeaders();
  const rows: string[][] = [headers];
  
  // Add example rows showing employee performance data - multiple loans per employee for aggregation
  const exampleRows: string[][] = [
    [
      'EMP-001',
      'Sarah Chen',
      'Senior LO',
      'Downtown',
      'LOAN-001',
      'John Doe',
      '350000',
      'Conventional',
      'Closed',
      '2024-12-01',
      '2025-02-28',
      '2025-02-10',
      '6.5',
      '24',
      'originated',
      '3500',
      '47',
      '720',
      '75',
      'Purchase',
    ],
    [
      'EMP-001',
      'Sarah Chen',
      'Senior LO',
      'Downtown',
      'LOAN-004',
      'Jane Smith',
      '500000',
      'Jumbo',
      'Closed',
      '2024-12-05',
      '2025-02-15',
      '2025-02-12',
      '6.75',
      '24',
      'originated',
      '5000',
      '47',
      '740',
      '70',
      'Purchase',
    ],
    [
      'EMP-002',
      'Michael Rodriguez',
      'Branch Manager',
      'Westside',
      'LOAN-002',
      'Robert Johnson',
      '425000',
      'FHA',
      'Closed',
      '2024-12-01',
      '2025-02-25',
      '2025-02-15',
      '6.25',
      '26',
      'originated',
      '4250',
      '42',
      '680',
      '80',
      'Refinance',
    ],
    [
      'EMP-003',
      'Emily Johnson',
      'Senior LO',
      'North Branch',
      'LOAN-003',
      'Mary Williams',
      '280000',
      'VA',
      'Closed',
      '2024-12-01',
      '2025-02-20',
      '2025-02-10',
      '6.00',
      '25',
      'originated',
      '2800',
      '38',
      '750',
      '70',
      'Purchase',
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
 * Validate Leaderboard CSV row
 */
export function validateLeaderboardCsvRow(row: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!row.employee_id) errors.push('employee_id is required');
  if (!row.employee_name) errors.push('employee_name is required');
  
  // If loan data is provided, validate it
  if (row.loan_id) {
    if (row.loan_amount && isNaN(parseFloat(row.loan_amount))) {
      errors.push('loan_amount must be a valid number');
    }
    if (row.closing_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.closing_date)) {
      errors.push('closing_date must be in YYYY-MM-DD format');
    }
    if (row.cycle_time_days && isNaN(parseInt(row.cycle_time_days))) {
      errors.push('cycle_time_days must be a valid integer');
    }
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
