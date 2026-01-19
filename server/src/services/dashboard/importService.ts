import { pool } from '../../config/database.js';
import Papa from 'papaparse';
import { logError, logWarn, logInfo, logDebug } from '../logger.js';
import { getTenantFieldMappings, applyFieldMapping } from '../fieldMapper.js';
import { createImportJob, updateImportProgress, completeImportJob } from '../importProgress.js';

/**
 * Import Service
 * Contains business logic for CSV import operations
 */

export interface ImportResult {
  success: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  total: number;
  employees_created?: number;
  verified_count?: number;
  tenant_id: string;
  details: {
    inserted: any[];
    updated: any[];
    skipped: any[];
    errors: any[];
  };
  message: string;
}

export interface LoanImportData {
  tenant_id: string;
  loan_id: string;
  loan_amount: number;
  status: string;
  loan_officer_id: string | null;
  branch: string | null;
  loan_type: string | null;
  loan_purpose: string | null;
  borrower_name: string | null;
  interest_rate: number | null;
  cycle_time_days: number | null;
  credit_pull_date: Date | null;
  lock_date: Date | null;
  fund_date: Date | null;
  application_date: Date;
  closing_date: Date | null;
  created_at: Date;
  created_by: string;
  metadata: any;
  raw_data: any; // Original CSV record for complete data preservation
}

export interface EmployeeImportData {
  tenant_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  role: string | null;
  branch: string | null;
  employee_id: string | null;
  hire_date: Date | null;
  status: string;
}

/**
 * Parse CSV text with error handling
 */
export function parseCSV(csvText: string): { data: any[]; errors: any[] } {
  const parseResult = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
    transform: (value: string) => {
      // Handle empty strings and whitespace
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? null : trimmed;
      }
      return value;
    },
  });

  // Filter out non-critical parsing errors (warnings about quotes/delimiters)
  const criticalErrors = parseResult.errors.filter((err: any) => 
    err.type !== 'Quotes' && 
    err.type !== 'Delimiter' &&
    err.code !== 'MissingQuotes'
  );

  return {
    data: parseResult.data,
    errors: criticalErrors,
  };
}

/**
 * Parse date safely
 */
export function parseDate(value: any): Date | null {
  if (!value || value === '' || value === 'null' || value === 'undefined') return null;
  try {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Parse number safely
 */
export function parseNumber(value: any): number | null {
  if (!value || value === '' || value === 'null' || value === 'undefined') return null;
  const num = parseFloat(String(value));
  return isNaN(num) ? null : num;
}

/**
 * Parse integer safely
 */
export function parseIntSafe(value: any): number | null {
  if (!value || value === '' || value === 'null' || value === 'undefined') return null;
  const num = parseInt(String(value), 10);
  return isNaN(num) ? null : num;
}

/**
 * Ensure loans table exists with required structure and optimized indexes
 */
export async function ensureLoansTable(tenantId: string, userId: string): Promise<{ hasUniqueConstraint: boolean; hasMetadataColumn: boolean }> {
  let hasUniqueConstraint = false;
  let hasMetadataColumn = false;

  try {
    await pool.query('SELECT 1 FROM public.loans LIMIT 1');
    
    // Check if unique constraint exists
    const constraintCheck = await pool.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_schema = 'public' 
      AND table_name = 'loans' 
      AND constraint_type = 'UNIQUE'
      AND constraint_name LIKE '%tenant_id%loan_id%'
    `);
    hasUniqueConstraint = constraintCheck.rows.length > 0;
    logDebug(`Unique constraint exists: ${hasUniqueConstraint}`, { userId, tenantId });
    
    // Check if metadata column exists
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'loans' 
      AND column_name = 'metadata'
    `);
    hasMetadataColumn = columnCheck.rows.length > 0;
    logDebug(`Metadata column exists: ${hasMetadataColumn}`, { userId, tenantId });
  } catch (tableError: any) {
    if (tableError.code === '42P01') {
      // Create loans table with unique constraint
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.loans (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          loan_id TEXT NOT NULL,
          loan_amount DECIMAL(15,2),
          status TEXT CHECK (status IN ('inquiry', 'started', 'locked', 'funded', 'denied', 'withdrawn')),
          loan_officer_id UUID,
          branch TEXT,
          loan_type TEXT,
          loan_purpose TEXT,
          borrower_name TEXT,
          interest_rate DECIMAL(5,3),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          cycle_time_days INTEGER,
          credit_pull_date TIMESTAMPTZ,
          lock_date TIMESTAMPTZ,
          fund_date TIMESTAMPTZ,
          application_date TIMESTAMPTZ,
          closing_date TIMESTAMPTZ,
          metadata JSONB DEFAULT '{}',
          created_by UUID REFERENCES public.users(id),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(tenant_id, loan_id)
        )
      `);
      hasUniqueConstraint = true;
      hasMetadataColumn = true;
      logInfo('Created loans table with unique constraint', { userId, tenantId });
    } else {
      throw tableError;
    }
  }

  // Create optimized indexes for import and query performance
  try {
    // Core indexes for lookups
    await pool.query('CREATE INDEX IF NOT EXISTS idx_loans_tenant ON public.loans(tenant_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_loans_status ON public.loans(status)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_loans_created_at ON public.loans(created_at DESC)');
    
    // Composite index for tenant + loan_id lookups (used in imports)
    await pool.query('CREATE INDEX IF NOT EXISTS idx_loans_tenant_loan_id ON public.loans(tenant_id, loan_id)');
    
    // Indexes for common query patterns
    await pool.query('CREATE INDEX IF NOT EXISTS idx_loans_loan_officer ON public.loans(loan_officer_id) WHERE loan_officer_id IS NOT NULL');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_loans_application_date ON public.loans(application_date DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_loans_closing_date ON public.loans(closing_date DESC) WHERE closing_date IS NOT NULL');
    
    // Composite index for tenant + status (common in dashboards)
    await pool.query('CREATE INDEX IF NOT EXISTS idx_loans_tenant_status ON public.loans(tenant_id, status)');
    
    logDebug('Ensured all performance indexes exist', { userId, tenantId });
  } catch (indexError: any) {
    logWarn('Error creating performance indexes', { userId, tenantId, error: indexError.message });
  }

  // If table exists but metadata column doesn't, add it
  if (!hasMetadataColumn) {
    try {
      await pool.query(`
        ALTER TABLE public.loans 
        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb
      `);
      hasMetadataColumn = true;
      logInfo('Added metadata column to loans table', { userId, tenantId });
    } catch (columnError: any) {
      logWarn('Could not add metadata column', { userId, tenantId, error: columnError.message });
    }
  }

  // Ensure raw_data column exists (for storing original CSV records)
  try {
    const rawDataColumnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'loans' 
      AND column_name = 'raw_data'
    `);
    if (rawDataColumnCheck.rows.length === 0) {
      await pool.query(`
        ALTER TABLE public.loans 
        ADD COLUMN IF NOT EXISTS raw_data JSONB
      `);
      logInfo('Added raw_data column to loans table', { userId, tenantId });
    }
  } catch (columnError: any) {
    logWarn('Could not add raw_data column', { userId, tenantId, error: columnError.message });
  }

  // If table exists but constraint doesn't, create it
  if (!hasUniqueConstraint) {
    try {
      await pool.query(`
        ALTER TABLE public.loans 
        ADD CONSTRAINT loans_tenant_id_loan_id_unique UNIQUE (tenant_id, loan_id)
      `);
      hasUniqueConstraint = true;
      logInfo('Created unique constraint on loans table', { userId, tenantId });
    } catch (constraintError: any) {
      if (constraintError.code !== '42P16') { // Not "duplicate constraint" error
        logWarn('Could not create unique constraint', { userId, tenantId, error: constraintError.message });
      }
    }
  }

  return { hasUniqueConstraint, hasMetadataColumn };
}

/**
 * Check if a string is a valid UUID
 */
function isValidUUID(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Transform CSV loan data to database format
 */
export function transformLoanData(loan: any, tenantId: string, userId: string): LoanImportData {
  // Map CSV columns to database columns - handle all fields including Ops data
  // IMPORTANT: loan_officer_id must be a UUID or null - if it's a name, store it in metadata
  let loanOfficerId: string | null = null;
  let loanOfficerName: string | null = null;
  
  if (loan.loan_officer_id) {
    if (isValidUUID(loan.loan_officer_id)) {
      loanOfficerId = loan.loan_officer_id;
    } else {
      // It's a name, not a UUID - store in metadata
      loanOfficerName = loan.loan_officer_id;
    }
  }
  
  // Also check for loan_officer_name field
  if (loan.loan_officer_name && !loanOfficerName) {
    loanOfficerName = loan.loan_officer_name;
  }
  
  const loanData: LoanImportData = {
    tenant_id: tenantId,
    loan_id: loan.loan_id || loan.loan_number || `AUTO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    loan_amount: parseFloat(loan.loan_amount || loan.amount || 0),
    status: (loan.status || 'inquiry').toLowerCase(),
    loan_officer_id: loanOfficerId,
    branch: loan.branch || null,
    loan_type: loan.loan_type || loan.product_type || null,
    loan_purpose: loan.loan_purpose || loan.purpose || null,
    borrower_name: loan.borrower_name || loan.borrower || null,
    interest_rate: parseNumber(loan.interest_rate),
    cycle_time_days: (() => {
      // Use provided value if available
      const provided = parseIntSafe(loan.cycle_time_days);
      if (provided !== null) return provided;
      // Auto-calculate if dates are available
      const appDate = parseDate(loan.application_date);
      const closeDate = parseDate(loan.closing_date);
      if (appDate && closeDate) {
        return Math.round((closeDate.getTime() - appDate.getTime()) / (1000 * 60 * 60 * 24));
      }
      return null;
    })(),
    credit_pull_date: parseDate(loan.credit_pull_date),
    lock_date: parseDate(loan.lock_date),
    fund_date: parseDate(loan.fund_date),
    application_date: parseDate(loan.application_date) || new Date(),
    closing_date: parseDate(loan.closing_date) || parseDate(loan.fund_date),
    created_at: parseDate(loan.created_at) || new Date(),
    created_by: userId,
    metadata: {},
  };

  // Build metadata with additional fields for Business Overview, Leaderboard, Loan Funnel, and Ops
  const metadata: any = {};
  const ficoScore = parseIntSafe(loan.fico_score);
  if (ficoScore !== null && ficoScore !== undefined) metadata.fico_score = ficoScore;
  const ltv = parseNumber(loan.ltv);
  if (ltv !== null && ltv !== undefined) metadata.ltv = ltv;
  const complexityScore = parseIntSafe(loan.complexity_score);
  if (complexityScore !== null && complexityScore !== undefined) metadata.complexity_score = complexityScore;
  const respaDate = parseDate(loan.respa_date);
  if (respaDate) metadata.respa_date = respaDate;
  if (loan.fallout_reason && loan.fallout_reason.trim() !== '') metadata.fallout_reason = loan.fallout_reason;
  
  // Store loan officer name in metadata (used for employee creation and display)
  if (loanOfficerName && loanOfficerName.trim() !== '') {
    metadata.loan_officer_name = loanOfficerName;
  }
  
  // Extract and store persona/actor fields (underwriter, closer, processor, account executive)
  // Check multiple field name variations based on LOS field library aliases
  const getPersonaField = (fieldName: string, aliases: string[]): string | null => {
    if (loan[fieldName] && loan[fieldName].trim() !== '') return loan[fieldName];
    for (const alias of aliases) {
      if (loan[alias] && loan[alias].trim() !== '') return loan[alias];
    }
    return null;
  };
  
  const underwriter = getPersonaField('underwriter_name', [
    'underwriter', 'underwriterName', 'uw_name', 'uwName', 
    'assigned_underwriter', 'assignedUnderwriter'
  ]);
  if (underwriter) metadata.underwriter_name = underwriter;
  
  const closer = getPersonaField('closer', [
    'closer_name', 'closerName', 'assigned_closer', 'assignedCloser'
  ]);
  if (closer) metadata.closer = closer;
  
  const processor = getPersonaField('processor', [
    'processor_name', 'processorName', 'assigned_processor', 'assignedProcessor'
  ]);
  if (processor) metadata.processor = processor;
  
  const accountExecutive = getPersonaField('account_executive', [
    'accountExecutive', 'ae', 'ae_name', 'aeName', 
    'sales_rep', 'salesRep', 'sales_rep_ae', 'salesRepAe'
  ]);
  if (accountExecutive) metadata.account_executive = accountExecutive;

  loanData.metadata = metadata;
  
  // Store original CSV record in raw_data for complete data preservation
  // This ensures all CSV fields are accessible even if not mapped to specific columns
  loanData.raw_data = loan;

  return loanData;
}

/**
 * Check if loan is duplicate
 */
export function isDuplicateLoan(existing: any, loanData: LoanImportData): boolean {
  // Helper to compare dates (handle nulls and convert strings to dates)
  const compareDates = (date1: any, date2: Date | null): boolean => {
    // Convert date1 to Date if it's a string
    let d1: Date | null = null;
    if (date1) {
      if (date1 instanceof Date) {
        d1 = date1;
      } else if (typeof date1 === 'string') {
        d1 = new Date(date1);
        if (isNaN(d1.getTime())) d1 = null;
      }
    }
    
    if (!d1 && !date2) return true;
    if (!d1 || !date2) return false;
    return d1.getTime() === date2.getTime();
  };

  // Compare key fields: loan_amount, status, borrower_name, and dates
  const borrowerNameMatch = 
    (!existing.borrower_name && !loanData.borrower_name) ||
    (existing.borrower_name && loanData.borrower_name && 
     existing.borrower_name.toLowerCase().trim() === loanData.borrower_name.toLowerCase().trim());

  return 
    Number(existing.loan_amount) === Number(loanData.loan_amount) &&
    existing.status === loanData.status &&
    borrowerNameMatch &&
    compareDates(existing.application_date, loanData.application_date) &&
    compareDates(existing.closing_date, loanData.closing_date) &&
    compareDates(existing.lock_date, loanData.lock_date) &&
    compareDates(existing.fund_date, loanData.fund_date);
}

/**
 * Insert or update loan in database
 */
export async function upsertLoan(
  loanData: LoanImportData,
  hasUniqueConstraint: boolean,
  tenantId: string,
  userId: string
): Promise<{ id: string; loan_id: string } | null> {
  const insertValues = [
    loanData.tenant_id,
    loanData.loan_id,
    loanData.loan_amount,
    loanData.status,
    loanData.loan_officer_id,
    loanData.branch,
    loanData.loan_type,
    loanData.loan_purpose,
    loanData.borrower_name,
    loanData.interest_rate,
    loanData.cycle_time_days,
    loanData.credit_pull_date,
    loanData.lock_date,
    loanData.fund_date,
    loanData.application_date,
    loanData.closing_date,
    loanData.created_at,
    loanData.created_by,
    JSON.stringify(loanData.metadata),
    JSON.stringify(loanData.raw_data),
  ];

  if (hasUniqueConstraint) {
    // Use ON CONFLICT if constraint exists
    try {
      const result = await pool.query(
        `INSERT INTO public.loans 
         (tenant_id, loan_id, loan_amount, status, loan_officer_id, branch, loan_type, loan_purpose,
          borrower_name, interest_rate, cycle_time_days, credit_pull_date, lock_date, fund_date,
          application_date, closing_date, created_at, created_by, metadata, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         ON CONFLICT (tenant_id, loan_id) DO UPDATE
         SET loan_amount = EXCLUDED.loan_amount,
             status = EXCLUDED.status,
             loan_officer_id = EXCLUDED.loan_officer_id,
             branch = EXCLUDED.branch,
             loan_type = EXCLUDED.loan_type,
             loan_purpose = EXCLUDED.loan_purpose,
             borrower_name = EXCLUDED.borrower_name,
             interest_rate = EXCLUDED.interest_rate,
             cycle_time_days = EXCLUDED.cycle_time_days,
             credit_pull_date = EXCLUDED.credit_pull_date,
             lock_date = EXCLUDED.lock_date,
             fund_date = EXCLUDED.fund_date,
             application_date = EXCLUDED.application_date,
             closing_date = EXCLUDED.closing_date,
             metadata = EXCLUDED.metadata,
             raw_data = EXCLUDED.raw_data,
             updated_at = NOW()
         RETURNING id, loan_id`,
        insertValues
      );
      return result.rows[0] || null;
    } catch (conflictError: any) {
      logWarn(`ON CONFLICT failed for loan ${loanData.loan_id}, trying fallback`, { userId, tenantId, loanId: loanData.loan_id, error: conflictError.message });
      throw conflictError;
    }
  } else {
    // Check if exists first, then insert or update
    const existingCheck = await pool.query(
      'SELECT id FROM public.loans WHERE tenant_id = $1 AND loan_id = $2',
      [loanData.tenant_id, loanData.loan_id]
    );
    
    if (existingCheck.rows.length > 0) {
      // Update existing
      const result = await pool.query(
        `UPDATE public.loans 
         SET loan_amount = $3, status = $4, loan_officer_id = $5, branch = $6, loan_type = $7,
             loan_purpose = $8, borrower_name = $9, interest_rate = $10, cycle_time_days = $11,
             credit_pull_date = $12, lock_date = $13, fund_date = $14, application_date = $15,
             closing_date = $16, metadata = $17, raw_data = $18, updated_at = NOW()
         WHERE tenant_id = $1 AND loan_id = $2
         RETURNING id, loan_id`,
        [
          loanData.tenant_id,
          loanData.loan_id,
          loanData.loan_amount,
          loanData.status,
          loanData.loan_officer_id,
          loanData.branch,
          loanData.loan_type,
          loanData.loan_purpose,
          loanData.borrower_name,
          loanData.interest_rate,
          loanData.cycle_time_days,
          loanData.credit_pull_date,
          loanData.lock_date,
          loanData.fund_date,
          loanData.application_date,
          loanData.closing_date,
          JSON.stringify(loanData.metadata),
          JSON.stringify(loanData.raw_data),
        ]
      );
      return result.rows[0] || null;
    } else {
      // Insert new
      const result = await pool.query(
        `INSERT INTO public.loans 
         (tenant_id, loan_id, loan_amount, status, loan_officer_id, branch, loan_type, loan_purpose,
          borrower_name, interest_rate, cycle_time_days, credit_pull_date, lock_date, fund_date,
          application_date, closing_date, created_at, created_by, metadata, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         RETURNING id, loan_id`,
        insertValues
      );
      return result.rows[0] || null;
    }
  }
}

/**
 * Extract and create employees from loan data
 */
export async function extractAndCreateEmployees(
  loans: any[],
  tenantId: string,
  userId: string
): Promise<{ employeeMap: Record<string, string>; employeesCreated: number }> {
  const employeeMap: Record<string, string> = {};
  const uniqueEmployees = new Map<string, { employee_id: string; first_name: string; last_name: string; branch: string; email?: string }>();

  // Extract unique employees from loan data
  for (const loan of loans) {
    const loanOfficerName = loan.loan_officer_name || loan.loan_officer || loan.originator_name;
    const branch = loan.branch || null;
    
    if (loanOfficerName && typeof loanOfficerName === 'string') {
      const nameParts = loanOfficerName.trim().split(/\s+/);
      const firstName = nameParts[0] || 'Unknown';
      const lastName = nameParts.slice(1).join(' ') || 'Employee';
      const employeeId = `EMP-${firstName.substring(0, 3).toUpperCase()}-${lastName.substring(0, 3).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
      
      if (!uniqueEmployees.has(employeeId)) {
        uniqueEmployees.set(employeeId, {
          employee_id: employeeId,
          first_name: firstName,
          last_name: lastName,
          branch: branch || 'Main Branch',
          email: loan.loan_officer_email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@coheus.com`,
        });
      }
    }
  }

  // Ensure employees table exists
  try {
    await pool.query('SELECT 1 FROM public.employees LIMIT 1');
  } catch (tableError: any) {
    if (tableError.code === '42P01') {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.employees (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          email TEXT,
          role TEXT,
          branch TEXT,
          employee_id TEXT,
          hire_date DATE,
          status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(tenant_id, employee_id)
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_employees_tenant ON public.employees(tenant_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_employees_status ON public.employees(status)');
    }
  }

  // Insert/update employees
  let employeesCreated = 0;
  for (const emp of uniqueEmployees.values()) {
    try {
      const result = await pool.query(
        `INSERT INTO public.employees 
         (tenant_id, first_name, last_name, email, role, branch, employee_id, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, employee_id) DO UPDATE
         SET first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             email = EXCLUDED.email,
             branch = EXCLUDED.branch,
             updated_at = NOW()
         RETURNING id, employee_id`,
        [
          tenantId,
          emp.first_name,
          emp.last_name,
          emp.email,
          'Loan Officer',
          emp.branch,
          emp.employee_id,
          'active',
          JSON.stringify({ source: 'csv_import' }),
        ]
      );
      if (result.rows.length > 0) {
        employeeMap[emp.employee_id] = result.rows[0].id;
        employeesCreated++;
      }
    } catch (empError: any) {
      logError(`Error inserting employee ${emp.employee_id}`, empError, { userId, tenantId, employeeId: emp.employee_id });
    }
  }

  // Update loans with employee IDs if we have loan_officer_name but no loan_officer_id
  if (Object.keys(employeeMap).length > 0) {
    for (const loan of loans) {
      const loanOfficerName = loan.loan_officer_name || loan.loan_officer;
      if (loanOfficerName && !loan.loan_officer_id) {
        // Try to find matching employee
        const nameParts = loanOfficerName.trim().split(/\s+/);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        
        // Find employee by name
        const empResult = await pool.query(
          `SELECT id FROM public.employees 
           WHERE tenant_id = $1 
           AND LOWER(first_name) = LOWER($2) 
           AND LOWER(last_name) = LOWER($3)
           LIMIT 1`,
          [tenantId, firstName, lastName]
        );
        
        if (empResult.rows.length > 0) {
          const employeeId = empResult.rows[0].id;
          const loanId = loan.loan_id || loan.loan_number;
          if (loanId) {
            await pool.query(
              `UPDATE public.loans 
               SET loan_officer_id = $1, updated_at = NOW()
               WHERE tenant_id = $2 AND loan_id = $3 AND loan_officer_id IS NULL`,
              [employeeId, tenantId, loanId]
            );
          }
        }
      }
    }
  }

  return { employeeMap, employeesCreated };
}

/**
 * Import loans from CSV
 */
export async function importLoansFromCSV(
  csvText: string,
  tenantId: string,
  userId: string,
  jobId?: string
): Promise<ImportResult> {
  // Parse CSV
  if (jobId) {
    updateImportProgress(jobId, { phase: 'parsing', message: 'Parsing CSV file...' });
  }
  
  const { data, errors: parseErrors } = parseCSV(csvText);

  if (parseErrors.length > 0) {
    throw new Error(`CSV parsing errors: ${JSON.stringify(parseErrors.slice(0, 10))}`);
  }

  // Filter out completely empty rows
  let loans = (data as any[]).filter(loan => {
    if (!loan) return false;
    // Check if row has any non-null values
    const hasData = Object.values(loan).some(val => val !== null && val !== undefined && val !== '');
    return hasData;
  });

  if (loans.length === 0) {
    // Get column names to help with debugging
    const columnNames = data.length > 0 ? Object.keys(data[0]) : [];
    throw new Error(`No valid loan records found in CSV. Found ${data.length} rows but all were empty. Columns detected: ${columnNames.join(', ') || 'none'}`);
  }

  // Log column info for debugging
  if (loans.length > 0) {
    const columns = Object.keys(loans[0]);
    logInfo(`CSV columns detected: ${columns.join(', ')}`, { userId, tenantId, columnCount: columns.length, rowCount: loans.length });
  }

  // Apply field mappings if they exist
  const fieldMappings = await getTenantFieldMappings(tenantId);
  if (fieldMappings && fieldMappings.field_mappings && Object.keys(fieldMappings.field_mappings).length > 0) {
    logInfo(`Applying tenant field mappings (${Object.keys(fieldMappings.field_mappings).length} mappings)`, { userId, tenantId });
    loans = loans.map(loan => applyFieldMapping(loan, fieldMappings.field_mappings));
  }

  // Ensure loans table exists
  const { hasUniqueConstraint } = await ensureLoansTable(tenantId, userId);

  const inserted: any[] = [];
  const updated: any[] = [];
  const skipped: any[] = [];
  const errors: any[] = [];

  // Transform all loans first
  if (jobId) {
    updateImportProgress(jobId, { 
      phase: 'transforming', 
      message: 'Transforming loan data...',
      totalRecords: loans.length 
    });
  }
  
  const transformedLoans: LoanImportData[] = [];
  for (const loan of loans) {
    try {
      const loanData = transformLoanData(loan, tenantId, userId);
      transformedLoans.push(loanData);
    } catch (error: any) {
      const loanId = loan.loan_id || loan.loan_number || 'unknown';
      logError(`Error transforming loan ${loanId}`, error, { userId, tenantId });
      errors.push({
        row: loanId,
        error: error.message || String(error),
      });
    }
  }

  if (transformedLoans.length === 0) {
    throw new Error('No valid loans to import after transformation');
  }

  logInfo(`Transformed ${transformedLoans.length} loans, checking for existing records`, { userId, tenantId });

  if (jobId) {
    updateImportProgress(jobId, { 
      phase: 'checking', 
      message: 'Checking for existing records...'
      // Don't set processedRecords here - we haven't processed anything yet!
    });
  }

  // Bulk check for existing loans (much faster than individual queries)
  const loanIds = transformedLoans.map(l => l.loan_id);
  const existingLoansResult = await pool.query(
    `SELECT loan_id, loan_amount, status, borrower_name, application_date, closing_date, lock_date, fund_date
     FROM public.loans 
     WHERE tenant_id = $1 AND loan_id = ANY($2)`,
    [tenantId, loanIds]
  );

  const existingLoansMap = new Map();
  for (const row of existingLoansResult.rows) {
    existingLoansMap.set(row.loan_id, row);
  }

  logInfo(`Found ${existingLoansMap.size} existing loans out of ${transformedLoans.length}`, { userId, tenantId });

  // Separate into new loans and updates
  const loansToInsert: LoanImportData[] = [];
  const loansToUpdate: LoanImportData[] = [];

  for (const loanData of transformedLoans) {
    const existing = existingLoansMap.get(loanData.loan_id);
    
    if (!existing) {
      loansToInsert.push(loanData);
    } else {
      // Check if it's a duplicate (identical data)
      const isDuplicate = isDuplicateLoan(existing, loanData);
      if (isDuplicate) {
        skipped.push({ loan_id: loanData.loan_id });
      } else {
        loansToUpdate.push(loanData);
      }
    }
  }

  const startTime = Date.now();
  
  logInfo(`📊 Import plan: ${loansToInsert.length} to insert, ${loansToUpdate.length} to update, ${skipped.length} to skip`, {
    userId,
    tenantId,
    totalLoans: transformedLoans.length,
    toInsert: loansToInsert.length,
    toUpdate: loansToUpdate.length,
    toSkip: skipped.length,
  });

  // Update progress with initial counts
  if (jobId) {
    updateImportProgress(jobId, {
      phase: 'inserting',
      skippedRecords: skipped.length,
      processedRecords: skipped.length, // Skipped records are already processed (determined to be duplicates)
      message: `Planning to insert ${loansToInsert.length} and update ${loansToUpdate.length} records...`,
    });
  }

  // Bulk insert new loans in batches
  if (loansToInsert.length > 0) {
    if (jobId) {
      updateImportProgress(jobId, { 
        phase: 'inserting', 
        message: `Inserting ${loansToInsert.length} new records...`,
        totalBatches: Math.ceil(loansToInsert.length / 100)
      });
    }
    
    const BULK_INSERT_SIZE = 100;
    const insertBatches = Math.ceil(loansToInsert.length / BULK_INSERT_SIZE);
    
    for (let batchIndex = 0; batchIndex < insertBatches; batchIndex++) {
      const batchStart = batchIndex * BULK_INSERT_SIZE;
      const batchEnd = Math.min(batchStart + BULK_INSERT_SIZE, loansToInsert.length);
      const batch = loansToInsert.slice(batchStart, batchEnd);
      
      try {
        // Build bulk insert query with multiple VALUES
        const values: any[] = [];
        const valuePlaceholders: string[] = [];
        let paramIndex = 1;
        
        for (const loan of batch) {
          const placeholder = `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11}, $${paramIndex + 12}, $${paramIndex + 13}, $${paramIndex + 14}, $${paramIndex + 15}, $${paramIndex + 16}, $${paramIndex + 17}, $${paramIndex + 18}, $${paramIndex + 19})`;
          valuePlaceholders.push(placeholder);
          
          values.push(
            loan.tenant_id,
            loan.loan_id,
            loan.loan_amount,
            loan.status,
            loan.loan_officer_id,
            loan.branch,
            loan.loan_type,
            loan.loan_purpose,
            loan.borrower_name,
            loan.interest_rate,
            loan.cycle_time_days,
            loan.credit_pull_date,
            loan.lock_date,
            loan.fund_date,
            loan.application_date,
            loan.closing_date,
            loan.created_at,
            loan.created_by,
            JSON.stringify(loan.metadata),
            JSON.stringify(loan.raw_data)
          );
          
          paramIndex += 20;
        }
        
        const bulkInsertQuery = `
          INSERT INTO public.loans 
          (tenant_id, loan_id, loan_amount, status, loan_officer_id, branch, loan_type, loan_purpose,
           borrower_name, interest_rate, cycle_time_days, credit_pull_date, lock_date, fund_date,
           application_date, closing_date, created_at, created_by, metadata, raw_data)
          VALUES ${valuePlaceholders.join(', ')}
          ${hasUniqueConstraint ? 'ON CONFLICT (tenant_id, loan_id) DO NOTHING' : ''}
          RETURNING id, loan_id
        `;
        
        const result = await pool.query(bulkInsertQuery, values);
        inserted.push(...result.rows);
        
        const progress = Math.round(((batchIndex + 1) / insertBatches) * 100);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const remaining = insertBatches - (batchIndex + 1);
        const estimatedTotal = remaining > 0 ? ((Date.now() - startTime) / (batchIndex + 1) * insertBatches / 1000).toFixed(1) : elapsed;
        
        if (jobId) {
          updateImportProgress(jobId, {
            currentBatch: batchIndex + 1,
            totalBatches: insertBatches,
            insertedRecords: inserted.length,
            skippedRecords: skipped.length,
            processedRecords: inserted.length + skipped.length, // Skipped records are already known
            message: `Inserting batch ${batchIndex + 1}/${insertBatches} (${progress}%)`,
          });
        }
        
        logInfo(`✅ Bulk insert progress: ${progress}% (${batchIndex + 1}/${insertBatches} batches) | ${result.rows.length} loans inserted | Elapsed: ${elapsed}s | Est. total: ${estimatedTotal}s`, {
          userId,
          tenantId,
          progress,
          batchIndex: batchIndex + 1,
          totalBatches: insertBatches,
          insertedInBatch: result.rows.length,
          totalInserted: inserted.length,
        });
      } catch (error: any) {
        logError(`Error in bulk insert batch ${batchIndex + 1}`, error, { userId, tenantId });
        // Fall back to individual inserts for this batch
        for (const loan of batch) {
          try {
            const result = await upsertLoan(loan, hasUniqueConstraint, tenantId, userId);
            if (result) inserted.push(result);
          } catch (individualError: any) {
            logError(`Error inserting individual loan ${loan.loan_id}`, individualError, { userId, tenantId });
            errors.push({
              row: loan.loan_id,
              error: individualError.message || String(individualError),
            });
          }
        }
      }
    }
  }

  // Update existing loans in batches (updates are harder to bulk, but we can batch transactions)
  if (loansToUpdate.length > 0) {
    if (jobId) {
      updateImportProgress(jobId, { 
        phase: 'updating', 
        message: `Updating ${loansToUpdate.length} existing records...`,
        totalBatches: Math.ceil(loansToUpdate.length / 50)
      });
    }
    
    const UPDATE_BATCH_SIZE = 50;
    const updateBatches = Math.ceil(loansToUpdate.length / UPDATE_BATCH_SIZE);
    
    for (let batchIndex = 0; batchIndex < updateBatches; batchIndex++) {
      const batchStart = batchIndex * UPDATE_BATCH_SIZE;
      const batchEnd = Math.min(batchStart + UPDATE_BATCH_SIZE, loansToUpdate.length);
      const batch = loansToUpdate.slice(batchStart, batchEnd);
      
      // Use a transaction for the batch
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        for (const loan of batch) {
          const result = await client.query(
            `UPDATE public.loans 
             SET loan_amount = $3, status = $4, loan_officer_id = $5, branch = $6, loan_type = $7,
                 loan_purpose = $8, borrower_name = $9, interest_rate = $10, cycle_time_days = $11,
                 credit_pull_date = $12, lock_date = $13, fund_date = $14, application_date = $15,
                 closing_date = $16, metadata = $17, raw_data = $18, updated_at = NOW()
             WHERE tenant_id = $1 AND loan_id = $2
             RETURNING id, loan_id`,
            [
              loan.tenant_id,
              loan.loan_id,
              loan.loan_amount,
              loan.status,
              loan.loan_officer_id,
              loan.branch,
              loan.loan_type,
              loan.loan_purpose,
              loan.borrower_name,
              loan.interest_rate,
              loan.cycle_time_days,
              loan.credit_pull_date,
              loan.lock_date,
              loan.fund_date,
              loan.application_date,
              loan.closing_date,
              JSON.stringify(loan.metadata),
              JSON.stringify(loan.raw_data),
            ]
          );
          if (result.rows.length > 0) {
            updated.push(result.rows[0]);
          }
        }
        
        await client.query('COMMIT');
        
        const progress = Math.round(((batchIndex + 1) / updateBatches) * 100);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        
        if (jobId) {
          updateImportProgress(jobId, {
            currentBatch: batchIndex + 1,
            totalBatches: updateBatches,
            insertedRecords: inserted.length,
            updatedRecords: updated.length,
            skippedRecords: skipped.length,
            processedRecords: inserted.length + updated.length + skipped.length,
            message: `Updating batch ${batchIndex + 1}/${updateBatches} (${progress}%)`,
          });
        }
        
        logInfo(`♻️ Update progress: ${progress}% (${batchIndex + 1}/${updateBatches} batches) | ${batch.length} loans updated | Total updated: ${updated.length} | Elapsed: ${elapsed}s`, {
          userId,
          tenantId,
          progress,
          batchIndex: batchIndex + 1,
          totalBatches: updateBatches,
          updatedInBatch: batch.length,
          totalUpdated: updated.length,
        });
      } catch (error: any) {
        await client.query('ROLLBACK');
        logError(`Error in update batch ${batchIndex + 1}, rolling back`, error, { userId, tenantId });
        // Fall back to individual updates
        for (const loan of batch) {
          try {
            const result = await upsertLoan(loan, hasUniqueConstraint, tenantId, userId);
            if (result) updated.push(result);
          } catch (individualError: any) {
            logError(`Error updating individual loan ${loan.loan_id}`, individualError, { userId, tenantId });
            errors.push({
              row: loan.loan_id,
              error: individualError.message || String(individualError),
            });
          }
        }
      } finally {
        client.release();
      }
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  const loansPerSecond = (transformedLoans.length / parseFloat(totalTime)).toFixed(1);
  
  logInfo(`🎉 Import Complete! Total time: ${totalTime}s (${loansPerSecond} loans/sec) | ✅ ${inserted.length} inserted | ♻️ ${updated.length} updated | ⏭️ ${skipped.length} skipped | ❌ ${errors.length} errors | Total: ${loans.length} loans`, {
    userId,
    tenantId,
    inserted: inserted.length,
    updated: updated.length,
    skipped: skipped.length,
    errors: errors.length,
    total: loans.length,
    totalTimeSeconds: totalTime,
    loansPerSecond,
    success: errors.length === 0,
  });

  // Extract and create employees from loan data
  if (jobId) {
    updateImportProgress(jobId, { 
      phase: 'finalizing', 
      message: 'Creating employee records...'
    });
  }
  
  const { employeesCreated } = await extractAndCreateEmployees(loans, tenantId, userId);

  // Verify data was actually saved by querying the database
  let verifiedCount = 0;
  try {
    const verifyResult = await pool.query(
      'SELECT COUNT(*) as count FROM public.loans WHERE tenant_id = $1',
      [tenantId]
    );
    verifiedCount = parseInt(verifyResult.rows[0]?.count || '0', 10);
    logInfo(`Verification: ${verifiedCount} total loans now in database for tenant ${tenantId}`, { userId, tenantId, verifiedCount });
  } catch (verifyError: any) {
    logWarn('Could not verify loan count', { userId, tenantId, error: verifyError });
  }

  // Build detailed success message
  const totalProcessed = inserted.length + updated.length;
  let messageParts: string[] = [];
  if (inserted.length > 0) {
    messageParts.push(`${inserted.length} new`);
  }
  if (updated.length > 0) {
    messageParts.push(`${updated.length} updated`);
  }
  const processedMessage = messageParts.length > 0 
    ? `Successfully imported ${totalProcessed} loans (${messageParts.join(', ')})`
    : `Successfully processed ${totalProcessed} loans`;
  
  const fullMessage = `${processedMessage}${skipped.length > 0 ? `. ${skipped.length} duplicate${skipped.length === 1 ? '' : 's'} skipped` : ''}${employeesCreated > 0 ? ` and created ${employeesCreated} employees` : ''}. Verified ${verifiedCount} total loans in database. Data is now available for Business Overview, Leaderboard, and Loan Funnel.`;

  const result = {
    success: true,
    inserted: inserted.length,
    updated: updated.length,
    skipped: skipped.length,
    errors: errors.length,
    total: loans.length,
    employees_created: employeesCreated,
    verified_count: verifiedCount,
    tenant_id: tenantId,
    details: {
      inserted: inserted.slice(0, 10), // Return first 10 inserted
      updated: updated.slice(0, 10), // Return first 10 updated
      skipped: skipped.slice(0, 10), // Return first 10 skipped
      errors: errors.slice(0, 10), // Return first 10 errors
    },
    message: fullMessage,
  };

  // Mark import as complete
  if (jobId) {
    completeImportJob(jobId, true);
    updateImportProgress(jobId, {
      phase: 'done',
      insertedRecords: inserted.length,
      updatedRecords: updated.length,
      skippedRecords: skipped.length,
      errorRecords: errors.length,
      processedRecords: loans.length,
      message: fullMessage,
    });
  }

  return result;
}

/**
 * Ensure employees table exists
 */
export async function ensureEmployeesTable(tenantId: string, userId: string): Promise<void> {
  try {
    await pool.query('SELECT 1 FROM public.employees LIMIT 1');
  } catch (tableError: any) {
    if (tableError.code === '42P01') {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.employees (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          email TEXT,
          role TEXT,
          branch TEXT,
          employee_id TEXT,
          hire_date DATE,
          status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(tenant_id, employee_id)
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_employees_tenant ON public.employees(tenant_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_employees_status ON public.employees(status)');
      logInfo('Created employees table', { userId, tenantId });
    } else {
      throw tableError;
    }
  }
}

/**
 * Transform CSV employee data to database format
 */
export function transformEmployeeData(emp: any, tenantId: string): EmployeeImportData {
  return {
    tenant_id: tenantId,
    first_name: emp.first_name || emp.firstname || '',
    last_name: emp.last_name || emp.lastname || '',
    email: emp.email || null,
    role: emp.role || emp.job_title || null,
    branch: emp.branch || null,
    employee_id: emp.employee_id || emp.id || null,
    hire_date: emp.hire_date ? new Date(emp.hire_date) : null,
    status: (emp.status || 'active').toLowerCase(),
  };
}

/**
 * Import employees from CSV
 */
export async function importEmployeesFromCSV(
  csvText: string,
  tenantId: string,
  userId: string
): Promise<ImportResult> {
  // Parse CSV
  const { data, errors: parseErrors } = parseCSV(csvText);

  if (parseErrors.length > 0) {
    throw new Error(`CSV parsing errors: ${JSON.stringify(parseErrors)}`);
  }

  // Ensure employees table exists
  await ensureEmployeesTable(tenantId, userId);

  const employees = data as any[];
  const inserted: any[] = [];
  const errors: any[] = [];

  for (const emp of employees) {
    try {
      const employeeData = transformEmployeeData(emp, tenantId);

      const result = await pool.query(
        `INSERT INTO public.employees 
         (tenant_id, first_name, last_name, email, role, branch, employee_id, hire_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, employee_id) DO UPDATE
         SET first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             email = EXCLUDED.email,
             role = EXCLUDED.role,
             branch = EXCLUDED.branch,
             updated_at = NOW()
         RETURNING id, first_name, last_name`,
        [
          employeeData.tenant_id,
          employeeData.first_name,
          employeeData.last_name,
          employeeData.email,
          employeeData.role,
          employeeData.branch,
          employeeData.employee_id,
          employeeData.hire_date,
          employeeData.status,
        ]
      );

      inserted.push(result.rows[0]);
    } catch (error: any) {
      errors.push({
        row: emp,
        error: error.message,
      });
    }
  }

  const message = `Successfully imported ${inserted.length} employees${errors.length > 0 ? ` with ${errors.length} errors` : ''}.`;

  return {
    success: true,
    inserted: inserted.length,
    updated: 0,
    skipped: 0,
    errors: errors.length,
    total: employees.length,
    tenant_id: tenantId,
    details: {
      inserted,
      updated: [],
      skipped: [],
      errors: errors.slice(0, 10),
    },
    message,
  };
}

