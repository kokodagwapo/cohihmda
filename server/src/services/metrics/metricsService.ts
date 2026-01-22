/**
 * Metrics Service
 * Centralized metrics library for dashboard analytics
 * Provides a catalog of metrics that can be queried individually or in groups
 */

import pg from 'pg';

// Date range interface
export interface DateRange {
  start: Date | null; // null = no start limit
  end: Date | null;   // null = no end limit
}

// Metric definition interface
export interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  category: 'status' | 'turn_time' | 'revenue' | 'pull_through' | 'volume' | 'count';
  formula: string; // Reference formula for documentation
  sqlQuery: string;
  dependencies: string[]; // Other metric IDs this depends on
  defaultDateField?: string; // Which date field to filter on by default (e.g., 'application_date')
  ignoreDateFilter?: boolean; // If true, don't apply date filtering (for current state metrics like active_loans)
}

// Metric result interface
export interface MetricResult {
  metricId: string;
  value: number | string;
  unit?: string;
  metadata?: Record<string, any>;
}

// Query options
export interface MetricQueryOptions {
  dateRange?: DateRange;
  dateField?: string; // Override default date field for this metric
  additionalFilters?: Record<string, any>;
  groupBy?: string[];
}

// Metrics catalog - all available metrics with SQL implementations
export const METRICS_CATALOG: Record<string, MetricDefinition> = {
  // Status Metrics
  'active_loans': {
    id: 'active_loans',
    name: 'Active Loans',
    description: 'Count of loans with Active Loan Flag = Yes (current state, not filtered by date)',
    category: 'status',
    formula: 'Count({<[Active Loan Flag]={Yes}>}[Loan Number])',
    sqlQuery: `COUNT(CASE 
      WHEN l.current_loan_status = 'Active Loan' 
      AND l.application_date IS NOT NULL 
      AND l.application_date::text != ''
      THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: 'application_date',
    ignoreDateFilter: true // Active loans are current state, not historical
  },
  'closed_loans': {
    id: 'closed_loans',
    name: 'Closed Loans',
    description: 'Count of loans with Funded Flag = Yes',
    category: 'status',
    formula: 'Count({<[Funded Flag]={Yes}>}[Loan Number])',
    sqlQuery: `COUNT(CASE WHEN l.funding_date IS NOT NULL AND l.funding_date <= CURRENT_DATE THEN 1 END)`,
    dependencies: [],
    defaultDateField: 'funding_date'
  },
  'locked_loans': {
    id: 'locked_loans',
    name: 'Locked Loans',
    description: 'Count of loans locked within the selected date range',
    category: 'status',
    formula: 'Count({<[Locked Flag]={Yes}>}[Loan Number])',
    sqlQuery: `COUNT(CASE 
      WHEN l.lock_date IS NOT NULL 
      THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: 'lock_date'
    // Date filter applied via lock_date
  },
  
  // Turn Time Metrics
  'avg_cycle_time': {
    id: 'avg_cycle_time',
    name: 'Average Cycle Time',
    description: 'Average App-Close turn time (days from Application to Closing), falls back to App-Fund. Filtered by closing/funding date.',
    category: 'turn_time',
    formula: 'Avg([App-Close])',
    sqlQuery: `AVG(COALESCE(
      CASE WHEN l.closing_date IS NOT NULL AND l.application_date IS NOT NULL 
        THEN DATE(l.closing_date) - DATE(l.application_date) 
        ELSE NULL 
      END,
      CASE WHEN l.funding_date IS NOT NULL AND l.application_date IS NOT NULL 
        THEN DATE(l.funding_date) - DATE(l.application_date) 
        ELSE NULL 
      END
    ))`,
    dependencies: [],
    defaultDateField: 'closing_date' // Filter by closing date, not application date
  },
  'avg_app_fund_days': {
    id: 'avg_app_fund_days',
    name: 'Average App to Fund',
    description: 'Average days from Application to Funding',
    category: 'turn_time',
    formula: 'Avg([App-Fund])',
    sqlQuery: `AVG(CASE 
      WHEN l.funding_date IS NOT NULL AND l.application_date IS NOT NULL 
      THEN DATE(l.funding_date) - DATE(l.application_date) 
      ELSE NULL 
    END)`,
    dependencies: [],
    defaultDateField: 'application_date'
  },
  'avg_app_close_days': {
    id: 'avg_app_close_days',
    name: 'Average App to Close',
    description: 'Average days from Application to Closing',
    category: 'turn_time',
    formula: 'Avg([App-Close])',
    sqlQuery: `AVG(CASE 
      WHEN l.closing_date IS NOT NULL AND l.application_date IS NOT NULL 
      THEN DATE(l.closing_date) - DATE(l.application_date) 
      ELSE NULL 
    END)`,
    dependencies: [],
    defaultDateField: 'application_date'
  },
  
  // Pull-Through Metrics
  'pull_through_rate': {
    id: 'pull_through_rate',
    name: 'Pull-Through Rate',
    description: 'Percentage of applications that funded/closed (excludes active loans)',
    category: 'pull_through',
    formula: 'Count({<[Active Loan Flag]={No},[Pull Through Originated Flag]={Yes}>}[Investor Purchase Date]) / Count({<[Active Loan Flag]={No}>}[Application Date]) * 100',
    sqlQuery: `
      COUNT(CASE 
        WHEN l.current_loan_status IS DISTINCT FROM 'Active Loan'
        AND l.application_date IS NOT NULL
        AND (l.funding_date IS NOT NULL OR l.investor_purchase_date IS NOT NULL)
        THEN 1 
      END)::float / NULLIF(COUNT(CASE 
        WHEN l.current_loan_status IS DISTINCT FROM 'Active Loan'
        AND l.application_date IS NOT NULL
        THEN 1 
      END), 0) * 100
    `,
    dependencies: [],
    defaultDateField: 'application_date'
  },
  
  // Volume Metrics
  'total_volume': {
    id: 'total_volume',
    name: 'Total Volume',
    description: 'Sum of loan amounts',
    category: 'volume',
    formula: 'Sum([Loan Amount])',
    sqlQuery: `SUM(l.loan_amount)`,
    dependencies: [],
    defaultDateField: 'application_date'
  },
  'funded_volume': {
    id: 'funded_volume',
    name: 'Funded Volume',
    description: 'Sum of loan amounts for funded loans',
    category: 'volume',
    formula: 'Sum({<[Funded Flag]={Yes}>}[Loan Amount])',
    sqlQuery: `SUM(CASE WHEN l.funding_date IS NOT NULL AND l.funding_date <= CURRENT_DATE THEN l.loan_amount ELSE 0 END)`,
    dependencies: [],
    defaultDateField: 'funding_date'
  },
  'active_volume': {
    id: 'active_volume',
    name: 'Active Loans Volume',
    description: 'Sum of loan amounts for active loans (current state, not filtered by date)',
    category: 'volume',
    formula: 'Sum({<[Active Loan Flag]={Yes}>}[Loan Amount])',
    sqlQuery: `SUM(CASE 
      WHEN l.current_loan_status = 'Active Loan' 
      AND l.application_date IS NOT NULL 
      AND l.application_date::text != ''
      THEN COALESCE(l.loan_amount, 0) 
      ELSE 0
    END)`,
    dependencies: [],
    defaultDateField: 'application_date',
    ignoreDateFilter: true // Active loans are current state, not historical
  },
  'closed_volume': {
    id: 'closed_volume',
    name: 'Closed Loans Volume',
    description: 'Sum of loan amounts for closed/funded loans',
    category: 'volume',
    formula: 'Sum({<[Funded Flag]={Yes}>}[Loan Amount])',
    sqlQuery: `SUM(CASE WHEN l.funding_date IS NOT NULL AND l.funding_date <= CURRENT_DATE THEN COALESCE(l.loan_amount, 0) ELSE 0 END)`,
    dependencies: [],
    defaultDateField: 'funding_date'
  },
  'locked_volume': {
    id: 'locked_volume',
    name: 'Locked Loans Volume',
    description: 'Sum of loan amounts for loans locked within the selected date range',
    category: 'volume',
    formula: 'Sum({<[Locked Flag]={Yes}>}[Loan Amount])',
    sqlQuery: `SUM(CASE 
      WHEN l.lock_date IS NOT NULL 
      THEN COALESCE(l.loan_amount, 0) 
      ELSE 0
    END)`,
    dependencies: [],
    defaultDateField: 'lock_date'
    // Date filter applied via lock_date
  },
  
  // Count Metrics
  'credit_pulls': {
    id: 'credit_pulls',
    name: 'Credit Pulls',
    description: 'Count of loans with credit pull date',
    category: 'count',
    formula: 'Count([Credit Pull Date])',
    sqlQuery: `COUNT(CASE WHEN l.credit_pull_date IS NOT NULL THEN 1 END)`,
    dependencies: [],
    defaultDateField: 'credit_pull_date'
  }
};

// Helper to build date range WHERE clause
function buildDateRangeClause(dateRange: DateRange | undefined, dateField: string, paramOffset: number = 0): { clause: string; params: any[] } {
  if (!dateRange || (!dateRange.start && !dateRange.end)) {
    return { clause: '', params: [] }; // No date filtering
  }
  
  const clauses: string[] = [];
  const params: any[] = [];
  const field = `COALESCE(l.${dateField}, l.created_at)`;
  
  if (dateRange.start) {
    clauses.push(`${field} >= $${paramOffset + params.length + 1}`);
    params.push(dateRange.start);
  }
  if (dateRange.end) {
    clauses.push(`${field} <= $${paramOffset + params.length + 1}`);
    params.push(dateRange.end);
  }
  
  return {
    clause: clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '',
    params
  };
}

// Special date range clause for avg_cycle_time: filter by closing_date OR funding_date
function buildDateRangeClauseForCycleTime(dateRange: DateRange | undefined, paramOffset: number = 0): { clause: string; params: any[] } {
  if (!dateRange || (!dateRange.start && !dateRange.end)) {
    return { clause: '', params: [] }; // No date filtering
  }
  
  const clauses: string[] = [];
  const params: any[] = [];
  
  // Filter by closing_date OR funding_date (whichever exists) being in the date range
  if (dateRange.start && dateRange.end) {
    clauses.push(`(l.closing_date >= $${paramOffset + params.length + 1} AND l.closing_date <= $${paramOffset + params.length + 2}) OR (l.closing_date IS NULL AND l.funding_date >= $${paramOffset + params.length + 1} AND l.funding_date <= $${paramOffset + params.length + 2})`);
    params.push(dateRange.start, dateRange.end);
  } else if (dateRange.start) {
    clauses.push(`(l.closing_date >= $${paramOffset + params.length + 1}) OR (l.closing_date IS NULL AND l.funding_date >= $${paramOffset + params.length + 1})`);
    params.push(dateRange.start);
  } else if (dateRange.end) {
    clauses.push(`(l.closing_date <= $${paramOffset + params.length + 1}) OR (l.closing_date IS NULL AND l.funding_date <= $${paramOffset + params.length + 1})`);
    params.push(dateRange.end);
  }
  
  return {
    clause: clauses.length > 0 ? `AND (${clauses.join(' OR ')})` : '',
    params
  };
}

// Helper to build WHERE clause from additional filters
function buildWhereClause(filters: Record<string, any>, paramOffset: number = 0): { clause: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];
  
  if (filters.loan_type) {
    clauses.push(`l.loan_type = $${paramOffset + params.length + 1}`);
    params.push(filters.loan_type);
  }
  
  if (filters.branch) {
    clauses.push(`l.branch = $${paramOffset + params.length + 1}`);
    params.push(filters.branch);
  }
  
  if (filters.loan_officer_id) {
    clauses.push(`l.loan_officer_id = $${paramOffset + params.length + 1}`);
    params.push(filters.loan_officer_id);
  }
  
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      clauses.push(`l.current_loan_status = ANY($${paramOffset + params.length + 1}::text[])`);
      params.push(filters.status);
    } else {
      clauses.push(`l.current_loan_status = $${paramOffset + params.length + 1}`);
      params.push(filters.status);
    }
  }
  
  return {
    clause: clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '',
    params
  };
}

/**
 * Query a single metric
 */
export async function queryMetric(
  tenantPool: pg.Pool,
  metricId: string,
  options: MetricQueryOptions = {}
): Promise<MetricResult> {
  const metric = METRICS_CATALOG[metricId];
  if (!metric) {
    throw new Error(`Metric ${metricId} not found in catalog`);
  }
  
  const dateField = options.dateField || metric.defaultDateField || 'application_date';
  // Skip date filtering for metrics that represent current state (e.g., active_loans, locked_loans)
  let dateRangeClause;
  if (metric.ignoreDateFilter) {
    dateRangeClause = { clause: '', params: [] };
  } else if (metric.id === 'avg_cycle_time' && options.dateRange) {
    // Special handling for avg_cycle_time: filter by closing_date OR funding_date
    dateRangeClause = buildDateRangeClauseForCycleTime(options.dateRange);
  } else {
    dateRangeClause = buildDateRangeClause(options.dateRange, dateField);
  }
  const additionalFiltersClause = options.additionalFilters 
    ? buildWhereClause(options.additionalFilters, dateRangeClause.params.length)
    : { clause: '', params: [] };
  
  // Build parameters array
  const params = [...dateRangeClause.params, ...additionalFiltersClause.params];
  
  // Build query with date filtering
  const query = `
    SELECT 
      ${metric.sqlQuery} as metric_value
    FROM public.loans l
    WHERE 1=1
      ${dateRangeClause.clause}
      ${additionalFiltersClause.clause}
  `;
  
  // Debug logging
  if (process.env.NODE_ENV === 'development') {
    console.log(`[MetricsService] Querying ${metricId}:`, {
      dateRange: options.dateRange,
      dateField,
      ignoreDateFilter: metric.ignoreDateFilter,
      dateClause: dateRangeClause.clause,
      additionalFiltersClause: additionalFiltersClause.clause,
      query: query,
      params: params
    });
  }
  
  const result = await tenantPool.query(query, params);
  
  // Additional debug: Check sample values for specific metrics
  if (process.env.NODE_ENV === 'development') {
    try {
      if (metricId === 'active_loans') {
        const sampleQuery = `SELECT 
          COUNT(*) as total_loans,
          COUNT(CASE WHEN current_loan_status IS NOT NULL THEN 1 END) as loans_with_current_status,
          COUNT(CASE WHEN current_loan_status = 'Active Loan' THEN 1 END) as loans_with_active_loan_status,
          COUNT(CASE WHEN application_date IS NOT NULL THEN 1 END) as loans_with_application_date,
          COUNT(CASE WHEN current_loan_status = 'Active Loan' AND application_date IS NOT NULL THEN 1 END) as active_loans_matching,
          COUNT(DISTINCT current_loan_status) as distinct_statuses,
          array_agg(DISTINCT current_loan_status) FILTER (WHERE current_loan_status IS NOT NULL) as all_status_values
          FROM public.loans`;
        const sampleResult = await tenantPool.query(sampleQuery);
        console.log(`[MetricsService] Active loans debug info:`, sampleResult.rows[0]);
      } else if (metricId === 'locked_loans') {
        const sampleQuery = `SELECT 
          COUNT(*) as total_loans,
          COUNT(CASE WHEN lock_date IS NOT NULL THEN 1 END) as loans_with_lock_date,
          COUNT(CASE WHEN lock_date::text != '' THEN 1 END) as loans_with_non_empty_lock_date,
          COUNT(CASE WHEN lock_date IS NOT NULL AND lock_date::text != '' THEN 1 END) as loans_matching_criteria,
          MIN(lock_date) as earliest_lock_date,
          MAX(lock_date) as latest_lock_date,
          COUNT(DISTINCT lock_date) as distinct_lock_dates
          FROM public.loans`;
        const sampleResult = await tenantPool.query(sampleQuery);
        console.log(`[MetricsService] Locked loans debug info:`, sampleResult.rows[0]);
        console.log(`[MetricsService] Full query executed:`, query);
        console.log(`[MetricsService] Query params:`, params);
        console.log(`[MetricsService] Query result:`, result.rows[0]);
      }
    } catch (e) {
      console.error(`[MetricsService] Error in debug query for ${metricId}:`, e);
    }
  }
  
  const metricValue = result.rows[0]?.metric_value;
  const parsedValue = metricValue !== null && metricValue !== undefined 
    ? parseFloat(metricValue) 
    : 0;
  
  return {
    metricId,
    value: parsedValue,
    metadata: { 
      dateRange: options.dateRange,
      dateField,
      rawValue: metricValue,
      query: process.env.NODE_ENV === 'development' ? query : undefined
    }
  };
}

/**
 * Query multiple metrics in a single call
 */
export async function queryMetrics(
  tenantPool: pg.Pool,
  metricIds: string[],
  options: MetricQueryOptions = {}
): Promise<Record<string, MetricResult>> {
  const results: Record<string, MetricResult> = {};
  
  // Query metrics in parallel
  await Promise.all(
    metricIds.map(async (metricId) => {
      try {
        results[metricId] = await queryMetric(tenantPool, metricId, options);
      } catch (error: any) {
        console.error(`[MetricsService] Error querying metric ${metricId}:`, error.message);
        // Return zero value on error
        results[metricId] = {
          metricId,
          value: 0,
          metadata: { error: error.message }
        };
      }
    })
  );
  
  return results;
}

/**
 * Query metrics by category
 */
export async function queryMetricsByCategory(
  tenantPool: pg.Pool,
  category: string,
  options: MetricQueryOptions = {}
): Promise<Record<string, MetricResult>> {
  const metricIds = Object.values(METRICS_CATALOG)
    .filter(m => m.category === category)
    .map(m => m.id);
  
  return queryMetrics(tenantPool, metricIds, options);
}

/**
 * Get metrics catalog
 */
export function getMetricsCatalog(): MetricDefinition[] {
  return Object.values(METRICS_CATALOG);
}
