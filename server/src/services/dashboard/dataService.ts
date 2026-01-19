import { pool } from '../../config/database.js';
import { logInfo, logError } from '../logger.js';

/**
 * Data Service
 * Contains business logic for sample data generation and data management operations
 */

export interface SampleDataResult {
  success: boolean;
  employees_inserted: number;
  loans_inserted: number;
  message: string;
  summary?: {
    total: number;
    funded: number;
    active: number;
    withdrawn: number;
    denied: number;
    totalVolume: string;
  };
}

export interface EmployeeData {
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  branch: string;
  hire_date: string;
  nmls_id?: string;
}

export interface LoanData {
  loan_id: string;
  borrower_name: string;
  loan_amount: number;
  loan_type: string;
  status: string;
  application_date: Date;
  respa_date?: Date | null;
  closing_date?: Date | null;
  lock_date?: Date | null;
  fund_date?: Date | null;
  credit_pull_date?: Date | null;
  interest_rate?: number | null;
  loan_purpose: string;
  cycle_time_days?: number | null;
  loan_officer_id: string;
  branch: string;
  fico_score?: number | null;
  ltv?: number | null;
  complexity_score?: number | null;
  property_state?: string;
  dti?: number;
  monthly_income?: number;
}

/**
 * Ensure loans table exists with proper schema and constraints
 */
export async function ensureLoansTable(): Promise<void> {
  try {
    await pool.query('SELECT 1 FROM public.loans LIMIT 1');
    // Table exists, ensure unique constraint exists for upsert to work
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'loans_tenant_id_loan_id_key'
        ) THEN
          ALTER TABLE public.loans ADD CONSTRAINT loans_tenant_id_loan_id_key UNIQUE (tenant_id, loan_id);
        END IF;
      EXCEPTION WHEN duplicate_table THEN
        -- Constraint already exists, ignore
      END $$;
    `);
  } catch (tableError: any) {
    if (tableError.code === '42P01') {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.loans (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          loan_id TEXT,
          loan_amount DECIMAL(15,2),
          status TEXT,
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
      await pool.query('CREATE INDEX IF NOT EXISTS idx_loans_tenant ON public.loans(tenant_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_loans_status ON public.loans(status)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_loans_created_at ON public.loans(created_at)');
    }
  }
  
  // Ensure metadata column exists (for legacy databases)
  await pool.query(`ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`);
}

/**
 * Ensure employees table exists with proper schema
 */
export async function ensureEmployeesTable(): Promise<void> {
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
}

/**
 * Generate sample employee data
 */
export function generateSampleEmployees(includeNmls: boolean = false): EmployeeData[] {
  const baseEmployees: EmployeeData[] = [
    { employee_id: 'EMP-001', first_name: 'Sarah', last_name: 'Chen', email: 'sarah.chen@example.com', role: 'Senior Loan Officer', branch: 'Downtown', hire_date: '2020-01-15' },
    { employee_id: 'EMP-002', first_name: 'Michael', last_name: 'Rodriguez', email: 'michael.rodriguez@example.com', role: 'Branch Manager', branch: 'Westside', hire_date: '2018-06-01' },
    { employee_id: 'EMP-003', first_name: 'Emily', last_name: 'Johnson', email: 'emily.johnson@example.com', role: 'Senior Loan Officer', branch: 'North Branch', hire_date: '2019-03-10' },
    { employee_id: 'EMP-004', first_name: 'David', last_name: 'Kim', email: 'david.kim@example.com', role: 'Loan Officer', branch: 'Eastside', hire_date: '2021-09-20' },
    { employee_id: 'EMP-005', first_name: 'Jennifer', last_name: 'Martinez', email: 'jennifer.martinez@example.com', role: 'Loan Officer', branch: 'Downtown', hire_date: '2022-04-12' },
    { employee_id: 'EMP-006', first_name: 'Robert', last_name: 'Williams', email: 'robert.williams@example.com', role: 'Senior Loan Officer', branch: 'Westside', hire_date: '2019-11-05' },
  ];

  if (includeNmls) {
    // Extended employee list with NMLS IDs for reset-sample-data
    const extendedEmployees: EmployeeData[] = [
      { employee_id: 'EMP-001', first_name: 'Sarah', last_name: 'Chen', email: 'sarah.chen@coheus.com', role: 'Senior Loan Officer', branch: 'Downtown', hire_date: '2020-01-15', nmls_id: 'NMLS100001' },
      { employee_id: 'EMP-002', first_name: 'Michael', last_name: 'Rodriguez', email: 'michael.rodriguez@coheus.com', role: 'Branch Manager', branch: 'Westside', hire_date: '2018-06-01', nmls_id: 'NMLS100002' },
      { employee_id: 'EMP-003', first_name: 'Emily', last_name: 'Johnson', email: 'emily.johnson@coheus.com', role: 'Senior Loan Officer', branch: 'North Branch', hire_date: '2019-03-10', nmls_id: 'NMLS100003' },
      { employee_id: 'EMP-004', first_name: 'David', last_name: 'Kim', email: 'david.kim@coheus.com', role: 'Loan Officer', branch: 'Eastside', hire_date: '2021-09-20', nmls_id: 'NMLS100004' },
      { employee_id: 'EMP-005', first_name: 'Jennifer', last_name: 'Martinez', email: 'jennifer.martinez@coheus.com', role: 'Loan Officer', branch: 'Downtown', hire_date: '2022-04-12', nmls_id: 'NMLS100005' },
      { employee_id: 'EMP-006', first_name: 'Robert', last_name: 'Williams', email: 'robert.williams@coheus.com', role: 'Senior Loan Officer', branch: 'Westside', hire_date: '2019-11-05', nmls_id: 'NMLS100006' },
      { employee_id: 'EMP-007', first_name: 'Amanda', last_name: 'Taylor', email: 'amanda.taylor@coheus.com', role: 'Loan Officer', branch: 'North Branch', hire_date: '2021-02-28', nmls_id: 'NMLS100007' },
      { employee_id: 'EMP-008', first_name: 'James', last_name: 'Brown', email: 'james.brown@coheus.com', role: 'Senior Loan Officer', branch: 'Eastside', hire_date: '2018-09-15', nmls_id: 'NMLS100008' },
      { employee_id: 'EMP-009', first_name: 'Lisa', last_name: 'Davis', email: 'lisa.davis@coheus.com', role: 'Loan Officer', branch: 'Downtown', hire_date: '2022-08-01', nmls_id: 'NMLS100009' },
      { employee_id: 'EMP-010', first_name: 'Christopher', last_name: 'Wilson', email: 'chris.wilson@coheus.com', role: 'Branch Manager', branch: 'North Branch', hire_date: '2017-05-20', nmls_id: 'NMLS100010' },
      { employee_id: 'EMP-011', first_name: 'Michelle', last_name: 'Garcia', email: 'michelle.garcia@coheus.com', role: 'Loan Officer', branch: 'Westside', hire_date: '2023-01-10', nmls_id: 'NMLS100011' },
      { employee_id: 'EMP-012', first_name: 'Daniel', last_name: 'Anderson', email: 'daniel.anderson@coheus.com', role: 'Senior Loan Officer', branch: 'Eastside', hire_date: '2020-07-15', nmls_id: 'NMLS100012' },
    ];
    return extendedEmployees;
  }

  return baseEmployees;
}

/**
 * Insert employees into database and return employee map (employee_id -> UUID)
 */
export async function insertEmployees(
  tenantId: string,
  employees: EmployeeData[]
): Promise<Record<string, string>> {
  const employeeMap: Record<string, string> = {};

  for (const emp of employees) {
    const metadata = emp.nmls_id ? { nmls_id: emp.nmls_id } : {};
    
    const result = await pool.query(
      `INSERT INTO public.employees 
       (tenant_id, first_name, last_name, email, role, branch, employee_id, hire_date, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id, employee_id) DO UPDATE
       SET first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           email = EXCLUDED.email,
           role = EXCLUDED.role,
           branch = EXCLUDED.branch,
           updated_at = NOW()
       RETURNING id, employee_id`,
      [
        tenantId,
        emp.first_name,
        emp.last_name,
        emp.email,
        emp.role,
        emp.branch,
        emp.employee_id,
        emp.hire_date,
        'active',
        JSON.stringify(metadata),
      ]
    );
    employeeMap[emp.employee_id] = result.rows[0].id;
  }

  return employeeMap;
}

/**
 * Generate sample loan data for /sample-data endpoint
 * Creates loans across multiple years (2022-2025) with realistic distributions
 */
export function generateSampleLoansForPeriod(
  employeeMap: Record<string, string>,
  options: {
    currentYear: number;
    currentMonth: number;
    currentDay: number;
    currentDayOfWeek: number;
    now: Date;
  }
): LoanData[] {
  const { currentYear, currentMonth, currentDay, currentDayOfWeek, now } = options;
  
  const loanTypes = ['Conventional', 'FHA', 'VA', 'Jumbo', 'USDA'];
  const loanPurposes = ['Purchase', 'Refinance', 'Cash-Out Refinance'];
  const branches = ['Downtown', 'Westside', 'North Branch', 'Eastside'];
  
  // Employee performance tiers (for realistic leaderboard)
  const employeePerformance: Record<string, { tier: string; multiplier: number }> = {
    'EMP-001': { tier: 'top', multiplier: 1.5 },
    'EMP-002': { tier: 'high', multiplier: 1.2 },
    'EMP-003': { tier: 'high', multiplier: 1.2 },
    'EMP-004': { tier: 'medium', multiplier: 1.0 },
    'EMP-005': { tier: 'medium', multiplier: 1.0 },
    'EMP-006': { tier: 'low', multiplier: 0.7 },
  };

  const getDate = (year: number, month: number, day: number) => {
    return new Date(year, month, day);
  };

  const getWeekStart = () => {
    const date = new Date(now);
    date.setDate(date.getDate() - currentDayOfWeek);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const sampleLoans: LoanData[] = [];
  let loanCounter = 1;

  // Helper function to generate loans for a specific period
  const generateLoansForPeriod = (
    year: number,
    monthStart: number,
    monthEnd: number,
    count: number,
    statusDistribution: Record<string, number>
  ) => {
    for (let i = 0; i < count; i++) {
      const month = Math.floor(Math.random() * (monthEnd - monthStart + 1)) + monthStart;
      const day = Math.floor(Math.random() * 28) + 1;

      // Determine status based on distribution
      const rand = Math.random();
      let status = 'inquiry';
      let cumulative = 0;
      for (const [stat, prob] of Object.entries(statusDistribution)) {
        cumulative += prob;
        if (rand <= cumulative) {
          status = stat;
          break;
        }
      }

      // Select random employee (weighted by performance)
      const empIds = Object.keys(employeeMap);
      const empId = empIds[Math.floor(Math.random() * empIds.length)];
      const empKey = Object.entries(employeeMap).find(([_, id]) => id === empId)?.[0] || 'EMP-001';
      const performance = employeePerformance[empKey as keyof typeof employeePerformance] || employeePerformance['EMP-001'];

      // Loan amount based on type and performance
      const loanType = loanTypes[Math.floor(Math.random() * loanTypes.length)];
      let baseAmount = 300000;
      if (loanType === 'Jumbo') baseAmount = 650000;
      else if (loanType === 'VA' || loanType === 'FHA') baseAmount = 350000;

      const loanAmount = Math.round(baseAmount * (0.8 + Math.random() * 0.4) * performance.multiplier);

      // Dates based on status
      const applicationDate = getDate(year, month, day);
      let respaDate: Date | null = null;
      let lockDate: Date | null = null;
      let fundDate: Date | null = null;
      let closingDate: Date | null = null;
      let creditPullDate: Date | null = null;
      let cycleTimeDays: number | null = null;

      if (status !== 'inquiry') {
        creditPullDate = new Date(applicationDate);
        creditPullDate.setDate(creditPullDate.getDate() + Math.floor(Math.random() * 3) + 1);

        respaDate = new Date(applicationDate);
        respaDate.setDate(respaDate.getDate() + Math.floor(Math.random() * 5) + 3);
      }

      if (['locked', 'funded'].includes(status)) {
        lockDate = new Date(applicationDate);
        lockDate.setDate(lockDate.getDate() + Math.floor(Math.random() * 10) + 10);

        if (respaDate && lockDate && lockDate < respaDate) {
          lockDate = new Date(respaDate);
          lockDate.setDate(lockDate.getDate() + Math.floor(Math.random() * 5) + 3);
        }
      }

      if (status === 'funded') {
        fundDate = new Date(applicationDate);
        fundDate.setDate(fundDate.getDate() + Math.floor(Math.random() * 15) + 30);
        closingDate = fundDate;

        if (lockDate && closingDate && closingDate < lockDate) {
          closingDate = new Date(lockDate);
          closingDate.setDate(closingDate.getDate() + Math.floor(Math.random() * 10) + 10);
          fundDate = closingDate;
        }

        cycleTimeDays = Math.floor((closingDate.getTime() - applicationDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      // FICO and LTV based on loan type
      let ficoScore: number | null = null;
      let ltv: number | null = null;
      if (status !== 'inquiry') {
        if (loanType === 'Jumbo') {
          ficoScore = Math.floor(Math.random() * 50) + 750;
          ltv = Math.floor(Math.random() * 20) + 60;
        } else if (loanType === 'VA') {
          ficoScore = Math.floor(Math.random() * 80) + 680;
          ltv = 100;
        } else if (loanType === 'FHA') {
          ficoScore = Math.floor(Math.random() * 100) + 640;
          ltv = Math.floor(Math.random() * 15) + 85;
        } else {
          ficoScore = Math.floor(Math.random() * 100) + 680;
          ltv = Math.floor(Math.random() * 25) + 70;
        }
      }

      const interestRate = status !== 'inquiry' ? parseFloat((6.0 + Math.random() * 1.0).toFixed(3)) : null;
      const complexityScore = status !== 'inquiry' ? Math.floor(Math.random() * 5) + 1 : null;
      const branch = branches[Math.floor(Math.random() * branches.length)];
      const loanPurpose = loanPurposes[Math.floor(Math.random() * loanPurposes.length)];

      sampleLoans.push({
        loan_id: `LOAN-${year}-${String(month + 1).padStart(2, '0')}-${String(loanCounter++).padStart(5, '0')}`,
        borrower_name: `Borrower ${sampleLoans.length + 1}`,
        loan_amount: loanAmount,
        loan_type: loanType,
        status: status,
        application_date: applicationDate,
        respa_date: respaDate,
        closing_date: closingDate,
        lock_date: lockDate,
        fund_date: fundDate,
        credit_pull_date: creditPullDate,
        interest_rate: interestRate,
        loan_purpose: loanPurpose,
        cycle_time_days: cycleTimeDays,
        loan_officer_id: empId,
        branch: branch,
        fico_score: ficoScore,
        ltv: ltv,
        complexity_score: complexityScore,
      });
    }
  };

  // Generate loans for 2025 (current year)
  generateLoansForPeriod(currentYear, currentMonth, currentMonth, 25, {
    funded: 0.35,
    locked: 0.20,
    started: 0.25,
    inquiry: 0.15,
    withdrawn: 0.03,
    denied: 0.02,
  });

  // Previous months in 2025
  for (let month = 0; month < currentMonth; month++) {
    const monthCount = month === currentMonth - 1 ? 30 : 35;
    generateLoansForPeriod(currentYear, month, month, monthCount, {
      funded: 0.40,
      locked: 0.15,
      started: 0.20,
      inquiry: 0.10,
      withdrawn: 0.10,
      denied: 0.05,
    });
  }

  // Generate loans for 2024
  for (let month = 0; month < 12; month++) {
    generateLoansForPeriod(2024, month, month, 30, {
      funded: 0.38,
      locked: 0.12,
      started: 0.22,
      inquiry: 0.12,
      withdrawn: 0.10,
      denied: 0.06,
    });
  }

  // Generate loans for 2023
  for (let month = 0; month < 12; month++) {
    generateLoansForPeriod(2023, month, month, 25, {
      funded: 0.35,
      locked: 0.10,
      started: 0.25,
      inquiry: 0.15,
      withdrawn: 0.10,
      denied: 0.05,
    });
  }

  // Generate loans for 2022
  for (let month = 0; month < 12; month++) {
    generateLoansForPeriod(2022, month, month, 20, {
      funded: 0.32,
      locked: 0.08,
      started: 0.28,
      inquiry: 0.18,
      withdrawn: 0.10,
      denied: 0.04,
    });
  }

  // Add WTD loans
  const weekStart = getWeekStart();
  for (let i = 0; i < 8; i++) {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + i);
    if (day > now) break;

    const empIds = Object.keys(employeeMap);
    const empId = empIds[Math.floor(Math.random() * empIds.length)];
    const branch = branches[Math.floor(Math.random() * branches.length)];
    const loanType = loanTypes[Math.floor(Math.random() * loanTypes.length)];
    const baseAmount = loanType === 'Jumbo' ? 650000 : 350000;
    const loanAmount = Math.round(baseAmount * (0.8 + Math.random() * 0.4));

    const appDate = day;
    const respaDate = new Date(appDate.getTime() + (3 + Math.floor(Math.random() * 5)) * 24 * 60 * 60 * 1000);
    const lockDate = i < 5 ? new Date(appDate.getTime() + (10 + Math.floor(Math.random() * 10)) * 24 * 60 * 60 * 1000) : null;
    const closingDate = i < 3 ? new Date(appDate.getTime() + (30 + Math.floor(Math.random() * 15)) * 24 * 60 * 60 * 1000) : null;
    const fundDate = closingDate;

    sampleLoans.push({
      loan_id: `LOAN-WTD-${String(i + 1).padStart(3, '0')}`,
      borrower_name: `WTD Borrower ${i + 1}`,
      loan_amount: loanAmount,
      loan_type: loanType,
      status: i < 3 ? 'funded' : i < 5 ? 'locked' : 'started',
      application_date: appDate,
      respa_date: respaDate,
      closing_date: closingDate,
      lock_date: lockDate,
      fund_date: fundDate,
      credit_pull_date: new Date(appDate.getTime() + 1 * 24 * 60 * 60 * 1000),
      interest_rate: parseFloat((6.0 + Math.random() * 1.0).toFixed(3)),
      loan_purpose: loanPurposes[Math.floor(Math.random() * loanPurposes.length)],
      cycle_time_days: i < 3 && closingDate ? Math.floor((closingDate.getTime() - appDate.getTime()) / (1000 * 60 * 60 * 24)) : null,
      loan_officer_id: empId,
      branch: branch,
      fico_score: Math.floor(Math.random() * 100) + 680,
      ltv: Math.floor(Math.random() * 25) + 70,
      complexity_score: Math.floor(Math.random() * 5) + 1,
    });
  }

  return sampleLoans;
}

/**
 * Generate comprehensive sample loan data for /reset-sample-data endpoint
 * Creates more realistic data with better distributions
 */
export function generateComprehensiveSampleLoans(
  employeeMap: Record<string, string>,
  options: {
    currentYear: number;
    currentMonth: number;
    now: Date;
    batchId: string;
  }
): LoanData[] {
  const { currentYear, currentMonth, now, batchId } = options;
  
  const loanTypes = ['Conventional', 'FHA', 'VA', 'Jumbo', 'USDA'];
  const loanPurposes = ['Purchase', 'Refinance', 'Cash-Out Refinance'];
  const branches = ['Downtown', 'Westside', 'North Branch', 'Eastside'];
  const states = ['CA', 'TX', 'FL', 'NY', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI', 'NJ', 'VA', 'WA', 'AZ', 'MA'];

  // Employee performance weights
  const employeeWeights: Record<string, number> = {
    'EMP-001': 1.8, 'EMP-002': 1.5, 'EMP-003': 1.4, 'EMP-008': 1.3,
    'EMP-010': 1.2, 'EMP-006': 1.1, 'EMP-012': 1.0, 'EMP-004': 0.9,
    'EMP-007': 0.85, 'EMP-005': 0.8, 'EMP-009': 0.7, 'EMP-011': 0.6,
  };

  const borrowerFirstNames = ['John', 'Jane', 'Robert', 'Mary', 'William', 'Patricia', 'James', 'Linda', 'Michael', 'Barbara', 'David', 'Elizabeth', 'Richard', 'Jennifer', 'Joseph', 'Maria', 'Thomas', 'Susan', 'Charles', 'Jessica', 'Christopher', 'Sarah', 'Daniel', 'Karen', 'Matthew', 'Nancy', 'Anthony', 'Lisa', 'Mark', 'Betty'];
  const borrowerLastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson'];

  const sampleLoans: LoanData[] = [];
  let loanCounter = 1;

  // Current month
  for (let i = 0; i < 185; i++) {
    const empKeys = Object.keys(employeeWeights);
    const weightedEmp = empKeys[Math.floor(Math.random() * empKeys.length)];
    const empId = employeeMap[weightedEmp];
    const weight = employeeWeights[weightedEmp];

    const loanType = loanTypes[Math.floor(Math.random() * loanTypes.length)];
    let baseAmount = loanType === 'Jumbo' ? 850000 : loanType === 'VA' ? 380000 : loanType === 'FHA' ? 320000 : 420000;
    const loanAmount = Math.round(baseAmount * (0.7 + Math.random() * 0.6) * weight);

    const day = Math.floor(Math.random() * Math.min(28, now.getDate())) + 1;
    const applicationDate = new Date(currentYear, currentMonth, day);

    const statusRand = Math.random();
    let status = 'started';
    let lockDate: Date | null = null;
    let closingDate: Date | null = null;
    let cycleTimeDays: number | null = null;

    if (statusRand < 0.60) {
      status = 'started';
    } else if (statusRand < 0.85) {
      status = 'locked';
      lockDate = new Date(applicationDate);
      lockDate.setDate(lockDate.getDate() + Math.floor(Math.random() * 10) + 5);
    } else if (statusRand < 0.95) {
      status = 'funded';
      lockDate = new Date(applicationDate);
      lockDate.setDate(lockDate.getDate() + Math.floor(Math.random() * 8) + 3);
      closingDate = new Date(applicationDate);
      closingDate.setDate(closingDate.getDate() + Math.floor(Math.random() * 15) + 20);
      cycleTimeDays = Math.floor((closingDate.getTime() - applicationDate.getTime()) / (1000 * 60 * 60 * 24));
    } else {
      status = 'withdrawn';
    }

    const ficoScore = loanType === 'Jumbo' ? Math.floor(Math.random() * 40) + 760 : Math.floor(Math.random() * 100) + 680;
    const ltv = loanType === 'VA' ? 100 : loanType === 'FHA' ? Math.floor(Math.random() * 10) + 90 : Math.floor(Math.random() * 25) + 70;
    const interestRate = parseFloat((6.0 + Math.random() * 1.5).toFixed(3));
    const dti = parseFloat((28 + Math.random() * 12).toFixed(2));
    const monthlyIncome = Math.floor(loanAmount / (ltv / 100) / 12 / 0.35);

    sampleLoans.push({
      loan_id: `LOAN-${batchId}-12-${String(loanCounter++).padStart(5, '0')}`,
      borrower_name: `${borrowerFirstNames[Math.floor(Math.random() * borrowerFirstNames.length)]} ${borrowerLastNames[Math.floor(Math.random() * borrowerLastNames.length)]}`,
      loan_amount: loanAmount,
      loan_type: loanType,
      status,
      application_date: applicationDate,
      closing_date: closingDate,
      lock_date: lockDate,
      credit_pull_date: new Date(applicationDate.getTime() + 24 * 60 * 60 * 1000),
      interest_rate: interestRate,
      loan_purpose: loanPurposes[Math.floor(Math.random() * loanPurposes.length)],
      cycle_time_days: cycleTimeDays,
      loan_officer_id: empId,
      branch: branches[Math.floor(Math.random() * branches.length)],
      fico_score: ficoScore,
      ltv,
      property_state: states[Math.floor(Math.random() * states.length)],
      dti,
      monthly_income: monthlyIncome,
    });
  }

  // Previous month
  const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const prevMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
  for (let i = 0; i < 165; i++) {
    const empKeys = Object.keys(employeeWeights);
    const weightedEmp = empKeys[Math.floor(Math.random() * empKeys.length)];
    const empId = employeeMap[weightedEmp];
    const weight = employeeWeights[weightedEmp];

    const loanType = loanTypes[Math.floor(Math.random() * loanTypes.length)];
    let baseAmount = loanType === 'Jumbo' ? 850000 : loanType === 'VA' ? 380000 : loanType === 'FHA' ? 320000 : 420000;
    const loanAmount = Math.round(baseAmount * (0.7 + Math.random() * 0.6) * weight);

    const day = Math.floor(Math.random() * 28) + 1;
    const applicationDate = new Date(prevMonthYear, prevMonth, day);

    const statusRand = Math.random();
    let status = 'funded';
    let lockDate: Date | null = new Date(applicationDate);
    lockDate.setDate(lockDate.getDate() + Math.floor(Math.random() * 12) + 8);
    let closingDate: Date | null = null;
    let cycleTimeDays: number | null = null;

    if (statusRand < 0.75) {
      status = 'funded';
      closingDate = new Date(applicationDate);
      closingDate.setDate(closingDate.getDate() + Math.floor(Math.random() * 20) + 25);
      cycleTimeDays = Math.floor((closingDate.getTime() - applicationDate.getTime()) / (1000 * 60 * 60 * 24));
    } else if (statusRand < 0.90) {
      status = 'locked';
      closingDate = null;
    } else if (statusRand < 0.97) {
      status = 'withdrawn';
      lockDate = null;
    } else {
      status = 'denied';
      lockDate = null;
    }

    const ficoScore = loanType === 'Jumbo' ? Math.floor(Math.random() * 40) + 760 : Math.floor(Math.random() * 100) + 680;
    const ltv = loanType === 'VA' ? 100 : loanType === 'FHA' ? Math.floor(Math.random() * 10) + 90 : Math.floor(Math.random() * 25) + 70;
    const interestRate = parseFloat((6.0 + Math.random() * 1.5).toFixed(3));
    const dti = parseFloat((28 + Math.random() * 12).toFixed(2));
    const monthlyIncome = Math.floor(loanAmount / (ltv / 100) / 12 / 0.35);

    sampleLoans.push({
      loan_id: `LOAN-${batchId}-11-${String(loanCounter++).padStart(5, '0')}`,
      borrower_name: `${borrowerFirstNames[Math.floor(Math.random() * borrowerFirstNames.length)]} ${borrowerLastNames[Math.floor(Math.random() * borrowerLastNames.length)]}`,
      loan_amount: loanAmount,
      loan_type: loanType,
      status,
      application_date: applicationDate,
      closing_date: closingDate,
      lock_date: lockDate,
      credit_pull_date: new Date(applicationDate.getTime() + 24 * 60 * 60 * 1000),
      interest_rate: interestRate,
      loan_purpose: loanPurposes[Math.floor(Math.random() * loanPurposes.length)],
      cycle_time_days: cycleTimeDays,
      loan_officer_id: empId,
      branch: branches[Math.floor(Math.random() * branches.length)],
      fico_score: ficoScore,
      ltv,
      property_state: states[Math.floor(Math.random() * states.length)],
      dti,
      monthly_income: monthlyIncome,
    });
  }

  // Earlier months of the year
  const monthsToGenerate = Math.max(0, currentMonth - 1);
  for (let monthOffset = 0; monthOffset < monthsToGenerate; monthOffset++) {
    const month = monthOffset;
    const monthLoans = Math.floor(140 + Math.random() * 30);

    for (let i = 0; i < monthLoans; i++) {
      const empKeys = Object.keys(employeeWeights);
      const weightedEmp = empKeys[Math.floor(Math.random() * empKeys.length)];
      const empId = employeeMap[weightedEmp];
      const weight = employeeWeights[weightedEmp];

      const loanType = loanTypes[Math.floor(Math.random() * loanTypes.length)];
      let baseAmount = loanType === 'Jumbo' ? 850000 : loanType === 'VA' ? 380000 : loanType === 'FHA' ? 320000 : 420000;
      const loanAmount = Math.round(baseAmount * (0.7 + Math.random() * 0.6) * weight);

      const day = Math.floor(Math.random() * 28) + 1;
      const applicationDate = new Date(currentYear, month, day);

      const statusRand = Math.random();
      let status = 'funded';
      let lockDate: Date | null = new Date(applicationDate);
      lockDate.setDate(lockDate.getDate() + Math.floor(Math.random() * 12) + 8);
      let closingDate: Date | null = null;
      let cycleTimeDays: number | null = null;

      if (statusRand < 0.82) {
        status = 'funded';
        closingDate = new Date(applicationDate);
        closingDate.setDate(closingDate.getDate() + Math.floor(Math.random() * 20) + 25);
        cycleTimeDays = Math.floor((closingDate.getTime() - applicationDate.getTime()) / (1000 * 60 * 60 * 24));
      } else if (statusRand < 0.90) {
        status = 'withdrawn';
        lockDate = Math.random() > 0.5 ? lockDate : null;
        closingDate = null;
      } else if (statusRand < 0.95) {
        status = 'denied';
        lockDate = Math.random() > 0.7 ? lockDate : null;
        closingDate = null;
      } else {
        status = 'locked';
        closingDate = null;
      }

      const ficoScore = loanType === 'Jumbo' ? Math.floor(Math.random() * 40) + 760 : Math.floor(Math.random() * 100) + 680;
      const ltv = loanType === 'VA' ? 100 : loanType === 'FHA' ? Math.floor(Math.random() * 10) + 90 : Math.floor(Math.random() * 25) + 70;
      const interestRate = parseFloat((5.5 + Math.random() * 2.0).toFixed(3));
      const dti = parseFloat((28 + Math.random() * 12).toFixed(2));
      const monthlyIncome = Math.floor(loanAmount / (ltv / 100) / 12 / 0.35);

      sampleLoans.push({
        loan_id: `LOAN-${batchId}-${String(month + 1).padStart(2, '0')}-${String(loanCounter++).padStart(5, '0')}`,
        borrower_name: `${borrowerFirstNames[Math.floor(Math.random() * borrowerFirstNames.length)]} ${borrowerLastNames[Math.floor(Math.random() * borrowerLastNames.length)]}`,
        loan_amount: loanAmount,
        loan_type: loanType,
        status,
        application_date: applicationDate,
        closing_date: closingDate,
        lock_date: lockDate,
        credit_pull_date: new Date(applicationDate.getTime() + 24 * 60 * 60 * 1000),
        interest_rate: interestRate,
        loan_purpose: loanPurposes[Math.floor(Math.random() * loanPurposes.length)],
        cycle_time_days: cycleTimeDays,
        loan_officer_id: empId,
        branch: branches[Math.floor(Math.random() * branches.length)],
        fico_score: ficoScore,
        ltv,
        property_state: states[Math.floor(Math.random() * states.length)],
        dti,
        monthly_income: monthlyIncome,
      });
    }
  }

  return sampleLoans;
}

/**
 * Insert loans into database
 */
export async function insertLoans(
  tenantId: string,
  userId: string,
  loans: LoanData[]
): Promise<any[]> {
  const insertedLoans: any[] = [];

  for (const loan of loans) {
    // Calculate complexity score
    let complexityScore = 1;
    if (loan.loan_type === 'Jumbo') complexityScore += 3;
    else if (loan.loan_type === 'FHA') complexityScore += 2;
    else if (loan.loan_type === 'VA') complexityScore += 1.5;
    else if (loan.loan_type === 'USDA') complexityScore += 2;
    if (loan.fico_score && loan.fico_score < 680) complexityScore += 2;
    else if (loan.fico_score && loan.fico_score < 720) complexityScore += 1;
    if (loan.ltv && loan.ltv > 90) complexityScore += 1.5;
    else if (loan.ltv && loan.ltv > 80) complexityScore += 0.5;
    if (loan.loan_purpose.includes('Refinance')) complexityScore += 0.5;
    complexityScore = Math.min(10, Math.round(complexityScore * 10) / 10);

    // Calculate revenue
    const revenue = loan.status === 'funded' ? Math.round(loan.loan_amount * 0.01) : 0;
    const lostRevenue = ['withdrawn', 'denied'].includes(loan.status) ? Math.round(loan.loan_amount * 0.01) : 0;

    const metadata: any = {};
    if (loan.fico_score) metadata.fico_score = loan.fico_score;
    if (loan.ltv) metadata.ltv = loan.ltv;
    if (loan.complexity_score !== undefined) metadata.complexity_score = complexityScore;
    if (loan.respa_date) metadata.respa_date = loan.respa_date;
    if (loan.property_state) metadata.property_state = loan.property_state;
    if (loan.dti) {
      metadata.dti = loan.dti;
      metadata.debt_to_income = loan.dti;
    }
    if (loan.monthly_income) metadata.monthly_income = loan.monthly_income;
    metadata.revenue = revenue;
    metadata.lost_revenue = lostRevenue;

    const now = new Date();
    const result = await pool.query(
      `INSERT INTO public.loans 
       (tenant_id, loan_id, loan_amount, status, loan_officer_id, branch, loan_type, loan_purpose,
        borrower_name, interest_rate, cycle_time_days, credit_pull_date, lock_date, fund_date,
        application_date, closing_date, created_at, created_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
           updated_at = NOW()
       RETURNING id, loan_id`,
      [
        tenantId,
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
        loan.status === 'funded' ? loan.closing_date : null,
        loan.application_date,
        loan.closing_date,
        loan.application_date || now,
        userId,
        JSON.stringify(metadata),
      ]
    );
    insertedLoans.push(result.rows[0]);
  }

  return insertedLoans;
}

/**
 * Generate and insert sample data (for /sample-data endpoint)
 */
export async function generateSampleData(
  tenantId: string,
  userId: string
): Promise<SampleDataResult> {
  // Ensure tables exist
  await ensureLoansTable();
  await ensureEmployeesTable();

  // Generate and insert employees
  const sampleEmployees = generateSampleEmployees(false);
  const employeeMap = await insertEmployees(tenantId, sampleEmployees);

  // Generate sample loans
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDay = now.getDate();
  const currentDayOfWeek = now.getDay();

  const sampleLoans = generateSampleLoansForPeriod(employeeMap, {
    currentYear,
    currentMonth,
    currentDay,
    currentDayOfWeek,
    now,
  });

  logInfo(`Generated ${sampleLoans.length} sample loans across multiple years`, {
    userId,
    tenantId,
    count: sampleLoans.length,
  });

  // Insert loans
  const insertedLoans = await insertLoans(tenantId, userId, sampleLoans);

  return {
    success: true,
    employees_inserted: sampleEmployees.length,
    loans_inserted: insertedLoans.length,
    message: `Successfully inserted ${sampleEmployees.length} employees and ${insertedLoans.length} loans`,
  };
}

/**
 * Reset and regenerate comprehensive sample data (for /reset-sample-data endpoint)
 */
export async function resetSampleData(
  tenantId: string,
  userId: string
): Promise<SampleDataResult> {
  // Ensure tables exist
  await ensureEmployeesTable();
  await ensureLoansTable();

  // Delete existing data
  await pool.query('DELETE FROM public.loans WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM public.employees WHERE tenant_id = $1', [tenantId]);

  // Generate and insert employees (with NMLS IDs)
  const sampleEmployees = generateSampleEmployees(true);
  const employeeMap = await insertEmployees(tenantId, sampleEmployees);

  // Generate comprehensive loan data
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const batchId = Date.now().toString(36);

  const sampleLoans = generateComprehensiveSampleLoans(employeeMap, {
    currentYear,
    currentMonth,
    now,
    batchId,
  });

  logInfo(`Generated ${sampleLoans.length} realistic sample loans`, {
    userId,
    tenantId,
    count: sampleLoans.length,
  });

  // Insert loans
  const insertedLoans = await insertLoans(tenantId, userId, sampleLoans);

  // Calculate summary statistics
  const funded = sampleLoans.filter((l) => l.status === 'funded').length;
  const active = sampleLoans.filter((l) => ['started', 'locked'].includes(l.status)).length;
  const withdrawn = sampleLoans.filter((l) => l.status === 'withdrawn').length;
  const denied = sampleLoans.filter((l) => l.status === 'denied').length;
  const totalVolume = sampleLoans.reduce((sum, l) => sum + l.loan_amount, 0);

  return {
    success: true,
    employees_inserted: sampleEmployees.length,
    loans_inserted: insertedLoans.length,
    message: `Reset complete! Inserted ${sampleEmployees.length} employees and ${insertedLoans.length} loans. Funded: ${funded}, Active: ${active}, Withdrawn: ${withdrawn}, Denied: ${denied}`,
    summary: {
      total: insertedLoans.length,
      funded,
      active,
      withdrawn,
      denied,
      totalVolume: `$${(totalVolume / 1000000).toFixed(1)}M`,
    },
  };
}

/**
 * Clear all data for a tenant (for /reset-data endpoint)
 */
export async function clearTenantData(tenantId: string): Promise<void> {
  await pool.query('DELETE FROM public.loans WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM public.employees WHERE tenant_id = $1', [tenantId]);
}

