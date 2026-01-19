/**
 * Data Transformation Service
 * Transforms loan data from Coheus format to vendor-specific formats
 */

export interface LoanData {
  loan_id: string;
  borrower_name?: string;
  loan_amount?: number;
  loan_type?: string;
  status?: string;
  application_date?: Date;
  closing_date?: Date;
  interest_rate?: number;
  loan_officer_id?: string;
  branch?: string;
  loan_purpose?: string;
  cycle_time_days?: number;
  credit_pull_date?: Date;
  lock_date?: Date;
  fund_date?: Date;
  raw_data?: any;
  [key: string]: any;
}

export interface FieldMapping {
  [loanField: string]: string; // Maps loan field to vendor field
}

/**
 * Transform loan data for accounting systems
 * Converts loans to invoices, transactions, or GL entries
 */
export function transformForAccounting(
  loanData: LoanData,
  mapping?: FieldMapping
): any {
  const defaultMapping: FieldMapping = {
    loan_id: 'transaction_id',
    loan_amount: 'amount',
    borrower_name: 'customer_name',
    closing_date: 'transaction_date',
    status: 'status',
    loan_type: 'product_type',
    application_date: 'invoice_date',
    ...mapping,
  };

  const transformed: any = {};

  // Apply field mapping
  for (const [loanField, vendorField] of Object.entries(defaultMapping)) {
    if (loanData[loanField] !== undefined && loanData[loanField] !== null) {
      transformed[vendorField] = loanData[loanField];
    }
  }

  // Add accounting-specific fields
  transformed.type = 'loan_origination';
  transformed.category = 'Revenue';
  
  if (loanData.closing_date) {
    transformed.accounting_period = new Date(loanData.closing_date).toISOString().slice(0, 7); // YYYY-MM
  }

  // Add metadata
  transformed.metadata = {
    source: 'coheus',
    loan_id: loanData.loan_id,
    synced_at: new Date().toISOString(),
  };

  return transformed;
}

/**
 * Transform loan data for capital markets platforms
 * Converts loans to loan pools, securitization data, or trading information
 */
export function transformForCapitalMarkets(
  loanData: LoanData,
  mapping?: FieldMapping
): any {
  const defaultMapping: FieldMapping = {
    loan_id: 'loan_number',
    loan_amount: 'principal_balance',
    borrower_name: 'borrower',
    interest_rate: 'coupon_rate',
    closing_date: 'origination_date',
    status: 'loan_status',
    loan_type: 'product_type',
    application_date: 'application_date',
    ...mapping,
  };

  const transformed: any = {};

  // Apply field mapping
  for (const [loanField, vendorField] of Object.entries(defaultMapping)) {
    if (loanData[loanField] !== undefined && loanData[loanField] !== null) {
      transformed[vendorField] = loanData[loanField];
    }
  }

  // Add capital markets-specific fields
  transformed.product_type = loanData.loan_type || 'Unknown';
  transformed.origination_channel = 'retail';
  
  if (loanData.loan_amount && loanData.interest_rate) {
    transformed.monthly_payment = calculateMonthlyPayment(
      loanData.loan_amount,
      loanData.interest_rate
    );
  }

  // Add metadata
  transformed.metadata = {
    source: 'coheus',
    loan_id: loanData.loan_id,
    synced_at: new Date().toISOString(),
  };

  return transformed;
}

/**
 * Transform loan data for servicing applications
 * Converts loans to payment schedules, escrow information, or collection data
 */
export function transformForServicing(
  loanData: LoanData,
  mapping?: FieldMapping
): any {
  const defaultMapping: FieldMapping = {
    loan_id: 'loan_number',
    borrower_name: 'borrower_name',
    loan_amount: 'principal_balance',
    interest_rate: 'interest_rate',
    closing_date: 'funding_date',
    status: 'loan_status',
    loan_type: 'product_type',
    application_date: 'application_date',
    ...mapping,
  };

  const transformed: any = {};

  // Apply field mapping
  for (const [loanField, vendorField] of Object.entries(defaultMapping)) {
    if (loanData[loanField] !== undefined && loanData[loanField] !== null) {
      transformed[vendorField] = loanData[loanField];
    }
  }

  // Add servicing-specific fields
  transformed.servicing_status = mapLoanStatusToServicing(loanData.status);
  transformed.current_balance = loanData.loan_amount;
  
  if (loanData.closing_date) {
    transformed.servicing_start_date = loanData.closing_date;
  }

  // Add metadata
  transformed.metadata = {
    source: 'coheus',
    loan_id: loanData.loan_id,
    synced_at: new Date().toISOString(),
  };

  return transformed;
}

/**
 * Validate transformed data before sending to vendor
 */
export function validateTransformedData(
  transformedData: any,
  category: 'accounting' | 'capital_markets' | 'servicing'
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Common validations
  if (!transformedData.metadata || !transformedData.metadata.loan_id) {
    errors.push('Missing loan_id in metadata');
  }

  // Category-specific validations
  switch (category) {
    case 'accounting':
      if (!transformedData.amount && !transformedData.transaction_id) {
        errors.push('Missing required accounting fields: amount or transaction_id');
      }
      break;
    case 'capital_markets':
      if (!transformedData.loan_number && !transformedData.principal_balance) {
        errors.push('Missing required capital markets fields: loan_number or principal_balance');
      }
      break;
    case 'servicing':
      if (!transformedData.loan_number && !transformedData.borrower_name) {
        errors.push('Missing required servicing fields: loan_number or borrower_name');
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Helper function to calculate monthly payment
 */
function calculateMonthlyPayment(principal: number, annualRate: number, termMonths: number = 360): number {
  if (annualRate === 0) return principal / termMonths;
  const monthlyRate = annualRate / 100 / 12;
  return principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / (Math.pow(1 + monthlyRate, termMonths) - 1);
}

/**
 * Map loan status to servicing status
 */
function mapLoanStatusToServicing(loanStatus?: string): string {
  if (!loanStatus) return 'unknown';
  
  const statusMap: Record<string, string> = {
    'closed': 'active',
    'funded': 'active',
    'in_progress': 'pending',
    'approved': 'pending',
    'denied': 'inactive',
    'cancelled': 'inactive',
  };

  return statusMap[loanStatus.toLowerCase()] || loanStatus.toLowerCase();
}
