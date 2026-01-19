/**
 * CSV Template Service
 * 
 * Generates CSV templates for different dashboard sections.
 * These templates are used for data import and provide example data structures.
 */

/**
 * Helper function to escape CSV cells
 */
function escapeCsvCell(cell: string | number): string {
  const cellStr = String(cell);
  if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
    return `"${cellStr.replace(/"/g, '""')}"`;
  }
  return cellStr;
}

/**
 * Helper function to convert rows to CSV format
 */
function rowsToCsv(rows: (string | number)[][]): string {
  return rows
    .map(row => row.map(cell => escapeCsvCell(cell)).join(','))
    .join('\n');
}

/**
 * Generate unified loan template
 * This is the default template that includes all loan fields
 */
export function generateUnifiedTemplate(): string {
  const headers = [
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
    'branch',
    'loan_purpose',
    'property_address',
    'property_type',
    'fico_score',
    'ltv',
    'credit_pull_date',
    'fund_date',
    'cycle_time_days',
    'revenue',
    'complexity_score',
    'fallout_reason',
  ];
  
  const exampleRow = [
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
    'Downtown',
    'Purchase',
    '123 Main St, City, ST 12345',
    'Single Family',
    '750',
    '80',
    '2025-01-16',
    '',
    '45',
    '3500',
    '3',
    '',
  ];
  
  return rowsToCsv([headers, exampleRow]);
}

/**
 * Generate business overview template
 * Includes fields needed for Business Overview dashboard:
 * - Active loans (inquiry/started/locked)
 * - Closed loans (funded)
 * - Locked loans
 * - Cycle time
 * - Pull-through rate
 * - Credit pulls
 */
export function generateBusinessOverviewTemplate(): string {
  const headers = [
    'loan_id',
    'borrower_name',
    'loan_amount',
    'loan_type',
    'status', // inquiry, started, locked, funded, denied, withdrawn
    'application_date',
    'closing_date',
    'lock_date',
    'fund_date',
    'credit_pull_date',
    'interest_rate',
    'loan_officer_name',
    'branch',
    'loan_purpose',
    'cycle_time_days',
    'fico_score',
    'ltv',
  ];
  
  const exampleRows = [
    [
      'LOAN-001',
      'John Doe',
      '350000',
      'Conventional',
      'started', // Active loan
      '2025-01-15',
      '',
      '2025-02-10',
      '',
      '2025-01-16',
      '6.5',
      'Sarah Chen',
      'Downtown',
      'Purchase',
      '45',
      '750',
      '80',
    ],
    [
      'LOAN-002',
      'Jane Smith',
      '425000',
      'FHA',
      'funded', // Closed loan
      '2024-12-01',
      '2024-12-28',
      '2024-12-15',
      '2024-12-28',
      '2024-12-02',
      '6.25',
      'Michael Rodriguez',
      'Westside',
      'Refinance',
      '27',
      '720',
      '75',
    ],
    [
      'LOAN-003',
      'Robert Johnson',
      '280000',
      'Conventional',
      'locked', // Locked loan
      '2025-01-10',
      '',
      '2025-02-05',
      '',
      '2025-01-11',
      '6.75',
      'Emily Johnson',
      'North Branch',
      'Purchase',
      '26',
      '680',
      '85',
    ],
    [
      'LOAN-004',
      'Maria Garcia',
      '550000',
      'VA',
      'inquiry', // Active loan
      '2025-01-20',
      '',
      '',
      '',
      '2025-01-21',
      '6.0',
      'David Kim',
      'Eastside',
      'Purchase',
      '',
      '740',
      '90',
    ],
  ];
  
  return rowsToCsv([headers, ...exampleRows]);
}

/**
 * Generate top tiering template
 * Includes fields needed for Top Tiering dashboard:
 * - Productivity (loans closed, cycle time, pull-through)
 * - Profitability (volume, revenue)
 * - Complexity (fico, ltv, loan types)
 */
export function generateTopTieringTemplate(): string {
  const headers = [
    'loan_id',
    'loan_amount',
    'loan_type',
    'status', // inquiry, started, locked, funded, denied, withdrawn
    'application_date',
    'closing_date',
    'lock_date',
    'fund_date',
    'cycle_time_days',
    'loan_officer_name',
    'branch',
    'fico_score',
    'ltv',
    'complexity_score', // Store in metadata JSONB
    'revenue',
    'lost_revenue', // For denied/withdrawn loans
  ];
  
  const exampleRows = [
    [
      'LOAN-001',
      '350000',
      'Conventional',
      'funded',
      '2025-01-15',
      '2025-02-28',
      '2025-02-10',
      '2025-02-28',
      '44',
      'Sarah Chen',
      'Downtown',
      '750',
      '80',
      '3',
      '3500',
      '',
    ],
    [
      'LOAN-002',
      '425000',
      'FHA',
      'withdrawn',
      '2025-01-10',
      '',
      '',
      '',
      '',
      'Michael Rodriguez',
      'Westside',
      '680',
      '95',
      '5',
      '',
      '4250',
    ],
    [
      'LOAN-003',
      '280000',
      'Conventional',
      'denied',
      '2025-01-05',
      '',
      '',
      '',
      '',
      'Emily Johnson',
      'North Branch',
      '620',
      '85',
      '4',
      '',
      '2800',
    ],
    [
      'LOAN-004',
      '550000',
      'VA',
      'funded',
      '2024-12-20',
      '2025-01-15',
      '2025-01-05',
      '2025-01-15',
      '26',
      'David Kim',
      'Eastside',
      '740',
      '90',
      '2',
      '5500',
      '',
    ],
  ];
  
  return rowsToCsv([headers, ...exampleRows]);
}

/**
 * Generate leaderboard template
 * Includes employee data + loan performance metrics:
 * - Loans closed
 * - Total volume
 * - Average cycle time
 * - Pull-through rate
 * 
 * Format: Employees table + Loans table (linked via loan_officer_id)
 */
export function generateLeaderboardTemplate(): string {
  const headers = [
    'employee_id',
    'first_name',
    'last_name',
    'email',
    'role',
    'branch',
    'hire_date',
    'status', // active, inactive
    // Loan data (for linking to employees)
    'loan_id',
    'loan_amount',
    'loan_status', // inquiry, started, locked, funded, denied, withdrawn
    'closing_date',
    'cycle_time_days',
  ];
  
  const exampleRows = [
    [
      'EMP-001',
      'Sarah',
      'Chen',
      'sarah.chen@example.com',
      'Senior Loan Officer',
      'Downtown',
      '2020-01-15',
      'active',
      'LOAN-001',
      '350000',
      'funded',
      '2025-02-28',
      '44',
    ],
    [
      'EMP-002',
      'Michael',
      'Rodriguez',
      'michael.rodriguez@example.com',
      'Branch Manager',
      'Westside',
      '2018-06-01',
      'active',
      'LOAN-002',
      '425000',
      'funded',
      '2025-02-25',
      '46',
    ],
    [
      'EMP-003',
      'Emily',
      'Johnson',
      'emily.johnson@example.com',
      'Senior Loan Officer',
      'North Branch',
      '2019-03-10',
      'active',
      'LOAN-003',
      '280000',
      'funded',
      '2025-02-20',
      '41',
    ],
  ];
  
  return rowsToCsv([headers, ...exampleRows]);
}

/**
 * Generate combined template
 * Includes all fields needed for Business Overview, Top Tiering, and Leaderboard
 * This is the most comprehensive template
 */
export function generateCombinedTemplate(): string {
  const headers = [
    // Loan fields
    'loan_id',
    'borrower_name',
    'loan_amount',
    'loan_type',
    'status', // inquiry, started, locked, funded, denied, withdrawn
    'application_date',
    'closing_date',
    'lock_date',
    'fund_date',
    'credit_pull_date',
    'interest_rate',
    'loan_purpose',
    'cycle_time_days',
    'fico_score',
    'ltv',
    'complexity_score',
    'revenue',
    'lost_revenue',
    // Employee/Loan Officer fields
    'loan_officer_name',
    'employee_id',
    'first_name',
    'last_name',
    'email',
    'role',
    'branch',
    'hire_date',
    'employee_status', // active, inactive
  ];
  
  const exampleRows = [
    [
      'LOAN-001',
      'John Doe',
      '350000',
      'Conventional',
      'funded',
      '2025-01-15',
      '2025-02-28',
      '2025-02-10',
      '2025-02-28',
      '2025-01-16',
      '6.5',
      'Purchase',
      '44',
      '750',
      '80',
      '3',
      '3500',
      '',
      'Sarah Chen',
      'EMP-001',
      'Sarah',
      'Chen',
      'sarah.chen@example.com',
      'Senior Loan Officer',
      'Downtown',
      '2020-01-15',
      'active',
    ],
    [
      'LOAN-002',
      'Jane Smith',
      '425000',
      'FHA',
      'funded',
      '2024-12-01',
      '2024-12-28',
      '2024-12-15',
      '2024-12-28',
      '2024-12-02',
      '6.25',
      'Refinance',
      '27',
      '720',
      '75',
      '2',
      '4250',
      '',
      'Michael Rodriguez',
      'EMP-002',
      'Michael',
      'Rodriguez',
      'michael.rodriguez@example.com',
      'Branch Manager',
      'Westside',
      '2018-06-01',
      'active',
    ],
    [
      'LOAN-003',
      'Robert Johnson',
      '280000',
      'Conventional',
      'locked',
      '2025-01-10',
      '',
      '2025-02-05',
      '',
      '2025-01-11',
      '6.75',
      'Purchase',
      '26',
      '680',
      '85',
      '4',
      '',
      '',
      'Emily Johnson',
      'EMP-003',
      'Emily',
      'Johnson',
      'emily.johnson@example.com',
      'Senior Loan Officer',
      'North Branch',
      '2019-03-10',
      'active',
    ],
  ];
  
  return rowsToCsv([headers, ...exampleRows]);
}

