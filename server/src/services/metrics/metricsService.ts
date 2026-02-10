/**
 * Metrics Service
 * Centralized metrics library for dashboard analytics
 * Provides a catalog of metrics that can be queried individually or in groups
 *
 * LOAN ACCESS FILTERING:
 * All query functions support user-level loan access filtering via the
 * `userAccessFilter` option. This ensures users only see metrics for
 * loans they have access to (based on Encompass permissions).
 *
 * @example
 * import { getLoanAccessContext } from '../userLoanAccessService';
 *
 * const ctx = await getLoanAccessContext(req, tenantPool);
 * const metrics = await queryMetrics(tenantPool, ['active_loans'], {
 *   userAccessFilter: ctx.getFilter('l'),
 * });
 */

import pg from "pg";
import type { LoanAccessFilter } from "../userLoanAccessService.js";
import { getActorColumnForChannel } from "../../utils/scorecard-utils.js";

// Date range interface
export interface DateRange {
  start: string | null; // YYYY-MM-DD format string, null = no start limit
  end: string | null; // YYYY-MM-DD format string, null = no end limit
}

// Metric definition interface
export interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  category:
    | "status"
    | "turn_time"
    | "revenue"
    | "pull_through"
    | "volume"
    | "count";
  formula: string; // Reference formula for documentation
  sqlQuery: string;
  dependencies: string[]; // Other metric IDs this depends on
  defaultDateField?: string; // Which date field to filter on by default (e.g., 'application_date')
  ignoreDateFilter?: boolean; // If true, don't apply date filtering (for current state metrics like active_loans)
  notes?: string; // Additional notes about the metric (e.g., estimation methodology, caveats)
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
  /**
   * User-level loan access filter
   * Obtained from getLoanAccessContext(req, pool).getFilter('l')
   * - null = full access (no filter applied)
   * - { sql: 'FALSE', ... } = no access (returns 0/empty)
   * - { sql: 'l.guid IN (...)', ... } = filtered access
   */
  userAccessFilter?: LoanAccessFilter | null;
}

// Metrics catalog - all available metrics with SQL implementations
export const METRICS_CATALOG: Record<string, MetricDefinition> = {
  // Status Metrics
  active_loans: {
    id: "active_loans",
    name: "Active Loans",
    description:
      "Count of loans where current_loan_status = 'Active Loan' and application_date is not empty. This is the current snapshot, not filtered by date range.",
    category: "status",
    formula:
      "current_loan_status = 'Active Loan' AND application_date IS NOT NULL",
    sqlQuery: `COUNT(CASE 
      WHEN l.current_loan_status = 'Active Loan' 
      AND l.application_date IS NOT NULL 
      AND l.application_date::text != ''
      THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
    ignoreDateFilter: true, // Active loans are current state, not historical
  },
  closed_loans: {
    id: "closed_loans",
    name: "Closed Loans",
    description:
      "Count of loans where funding_date is not empty (funded loans).",
    category: "status",
    formula: "funding_date IS NOT NULL AND funding_date <= today",
    sqlQuery: `COUNT(CASE WHEN l.funding_date IS NOT NULL AND l.funding_date <= CURRENT_DATE THEN 1 END)`,
    dependencies: [],
    defaultDateField: "funding_date",
  },
  locked_loans: {
    id: "locked_loans",
    name: "Locked Loans",
    description:
      "Count of loans where lock_date is not empty within the selected date range.",
    category: "status",
    formula: "lock_date IS NOT NULL",
    sqlQuery: `COUNT(CASE 
      WHEN l.lock_date IS NOT NULL 
      THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: "lock_date",
    // Date filter applied via lock_date
  },

  // Turn Time Metrics
  avg_cycle_time: {
    id: "avg_cycle_time",
    name: "Average Cycle Time",
    description:
      "Average number of days from application_date to closing_date (or funding_date if closing is not available).",
    category: "turn_time",
    formula: "AVG(closing_date - application_date) in days",
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
    defaultDateField: "closing_date", // Filter by closing date, not application date
  },
  avg_app_fund_days: {
    id: "avg_app_fund_days",
    name: "Average App to Fund",
    description:
      "Average number of days from application_date to funding_date.",
    category: "turn_time",
    formula: "AVG(funding_date - application_date) in days",
    sqlQuery: `AVG(CASE 
      WHEN l.funding_date IS NOT NULL AND l.application_date IS NOT NULL 
      THEN DATE(l.funding_date) - DATE(l.application_date) 
      ELSE NULL 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  avg_app_close_days: {
    id: "avg_app_close_days",
    name: "Average App to Close",
    description:
      "Average number of days from application_date to closing_date.",
    category: "turn_time",
    formula: "AVG(closing_date - application_date) in days",
    sqlQuery: `AVG(CASE 
      WHEN l.closing_date IS NOT NULL AND l.application_date IS NOT NULL 
      THEN DATE(l.closing_date) - DATE(l.application_date) 
      ELSE NULL 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },

  // Pull-Through Metrics
  pull_through_rate: {
    id: "pull_through_rate",
    name: "Pull-Through Rate",
    description:
      "Percentage of non-active applications that funded or closed. Calculated as: (funded loans / total applications) * 100",
    category: "pull_through",
    formula:
      "(funded_loans / total_applications) * 100, excluding active loans",
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
    defaultDateField: "application_date",
  },

  // Volume Metrics
  total_volume: {
    id: "total_volume",
    name: "Total Volume",
    description: "Sum of all loan_amount values within the date range.",
    category: "volume",
    formula: "SUM(loan_amount)",
    sqlQuery: `SUM(l.loan_amount)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  total_units: {
    id: "total_units",
    name: "Total Units",
    description: "Count of all loans (with loan_number) within the date range.",
    category: "count",
    formula: "COUNT(loan_number)",
    sqlQuery: `COUNT(l.loan_number)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  funded_volume: {
    id: "funded_volume",
    name: "Funded Volume",
    description:
      "Sum of loan_amount for loans where funding_date is not empty.",
    category: "volume",
    formula: "SUM(loan_amount) WHERE funding_date IS NOT NULL",
    sqlQuery: `SUM(CASE WHEN l.funding_date IS NOT NULL AND l.funding_date <= CURRENT_DATE THEN l.loan_amount ELSE 0 END)`,
    dependencies: [],
    defaultDateField: "funding_date",
  },
  originated_volume: {
    id: "originated_volume",
    name: "Originated Volume",
    description:
      "Sum of loan_amount for loans with status containing 'Originated' or 'purchased'.",
    category: "volume",
    formula: "SUM(loan_amount) WHERE status LIKE 'Originated' OR 'purchased'",
    sqlQuery: `SUM(CASE 
      WHEN l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%' THEN l.loan_amount 
      ELSE 0 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  active_volume: {
    id: "active_volume",
    name: "Active Loans Volume",
    description:
      "Sum of loan amounts for active loans (current state, not filtered by date)",
    category: "volume",
    formula: "Sum({<[Active Loan Flag]={Yes}>}[Loan Amount])",
    sqlQuery: `SUM(CASE 
      WHEN l.current_loan_status = 'Active Loan' 
      AND l.application_date IS NOT NULL 
      AND l.application_date::text != ''
      THEN COALESCE(l.loan_amount, 0) 
      ELSE 0
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
    ignoreDateFilter: true, // Active loans are current state, not historical
  },
  closed_volume: {
    id: "closed_volume",
    name: "Closed Loans Volume",
    description: "Sum of loan amounts for closed/funded loans",
    category: "volume",
    formula: "Sum({<[Funded Flag]={Yes}>}[Loan Amount])",
    sqlQuery: `SUM(CASE WHEN l.funding_date IS NOT NULL AND l.funding_date <= CURRENT_DATE THEN COALESCE(l.loan_amount, 0) ELSE 0 END)`,
    dependencies: [],
    defaultDateField: "funding_date",
  },
  locked_volume: {
    id: "locked_volume",
    name: "Locked Loans Volume",
    description:
      "Sum of loan amounts for loans locked within the selected date range",
    category: "volume",
    formula: "Sum({<[Locked Flag]={Yes}>}[Loan Amount])",
    sqlQuery: `SUM(CASE 
      WHEN l.lock_date IS NOT NULL 
      THEN COALESCE(l.loan_amount, 0) 
      ELSE 0
    END)`,
    dependencies: [],
    defaultDateField: "lock_date",
    // Date filter applied via lock_date
  },

  // Count Metrics
  credit_pulls: {
    id: "credit_pulls",
    name: "Credit Pulls",
    description:
      "Count of loans where credit_pull_date is not empty within the selected date range.",
    category: "count",
    formula: "COUNT WHERE credit_pull_date IS NOT NULL",
    sqlQuery: `COUNT(CASE WHEN l.credit_pull_date IS NOT NULL THEN 1 END)`,
    dependencies: [],
    defaultDateField: "credit_pull_date",
  },

  // Company Scorecard Total Loans - matches Qlik expression:
  // Num(count({$<DateType={'Application'},[$(vToDate)]={'Yes'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number]),'#,##0')
  // This counts loans where:
  // - DateType = 'Application' (application_date exists and is being used for filtering)
  // - The date is within the selected period (YTD, MTD, or full year based on vToDate)
  // - Channel matches the selection
  scorecard_total_loans: {
    id: "scorecard_total_loans",
    name: "Scorecard Total Loans",
    description:
      "Total loans for Company Scorecard. Filtered by application_date with DateType=Application perspective (matches Qlik Company Scorecard).",
    category: "count",
    formula:
      "Count({$<DateType={'Application'},[$(vToDate)]={'Yes'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number])",
    sqlQuery: `COUNT(CASE WHEN l.application_date IS NOT NULL THEN 1 END)`,
    dependencies: [],
    defaultDateField: "application_date", // Filter by application_date to match Qlik's DateType={'Application'}
  },

  // HMDA metrics - exclude Active loans to match Qlik:
  // Sum/Count({$<DateType={'Application'},[$(vToDate)]={'Yes'}, [Current Loan Status]-={"*Active*"}, ...>}...)
  hmda_volume: {
    id: "hmda_volume",
    name: "Volume All Final HMDA Status",
    description:
      "Sum of loan_amount excluding Active loans. Matches Qlik Volume All Final HMDA Status which uses [Current Loan Status]-={\"*Active*\"}.",
    category: "volume",
    formula:
      "Sum({$<DateType={'Application'},[$(vToDate)]={'Yes'},[Current Loan Status]-={\"*Active*\"},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Amount])",
    sqlQuery: `SUM(CASE 
      WHEN l.application_date IS NOT NULL 
        AND NOT (l.current_loan_status ILIKE '%Active%') 
      THEN COALESCE(l.loan_amount, 0) 
      ELSE 0 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  hmda_units: {
    id: "hmda_units",
    name: "Units All Final HMDA Status",
    description:
      "Count of loans excluding Active loans. Matches Qlik Units All Final HMDA Status which uses [Current Loan Status]-={\"*Active*\"}.",
    category: "count",
    formula:
      "Count({$<DateType={'Application'},[$(vToDate)]={'Yes'},[Current Loan Status]-={\"*Active*\"},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number])",
    sqlQuery: `COUNT(CASE 
      WHEN l.application_date IS NOT NULL 
        AND NOT (l.current_loan_status ILIKE '%Active%') 
      THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },

  // Funnel Metrics (based on Qlik Logic Dictionary)
  // IMPORTANT: Date filtering should be on started_date (Started Year), NOT application_date
  // RESPA App Status is then calculated based on whether application_date exists
  loans_started: {
    id: "loans_started",
    name: "Loans Started",
    description:
      "Total count of loans started. Filtered by Started Year (started_date) in Qlik.",
    category: "count",
    formula: "Count({<[Started Year]*={$(vYear)}>}[Loan Number])",
    sqlQuery: `COUNT(l.loan_id)`,
    dependencies: [],
    defaultDateField: "started_date", // Filter by started_date, NOT application_date
  },
  loans_with_respa_app: {
    id: "loans_with_respa_app",
    name: "Loans with RESPA Applications",
    description:
      'Loans (filtered by Started Year) where RESPA App Status = Yes (application_date exists). Qlik: if(Len(Trim([Application Date]))>0,"Yes","No")',
    category: "count",
    formula:
      "Count({<[Started Year]*={$(vYear)}, [RESPA App Status]*={Yes}>}[Loan Number])",
    sqlQuery: `COUNT(CASE WHEN l.application_date IS NOT NULL AND TRIM(l.application_date::text) != '' THEN 1 END)`,
    dependencies: [],
    defaultDateField: "started_date", // Filter by started_date first, then check application_date
  },
  loans_no_respa_app: {
    id: "loans_no_respa_app",
    name: "Loans with No RESPA Applications",
    description:
      'Loans (filtered by Started Year) where RESPA App Status = No (application_date is null). Qlik: if(Len(Trim([Application Date]))>0,"Yes","No")',
    category: "count",
    formula:
      "Count({<[Started Year]*={$(vYear)}, [RESPA App Status]*={No}>}[Loan Number])",
    sqlQuery: `COUNT(CASE WHEN l.application_date IS NULL OR TRIM(l.application_date::text) = '' THEN 1 END)`,
    dependencies: [],
    defaultDateField: "started_date", // Filter by started_date first, then check application_date
  },
  originated_loans: {
    id: "originated_loans",
    name: "Originated Loans",
    description:
      'Loans with Pull Through Originated Flag = Yes. From Qlik: If(WildMatch([Current Loan Status],"*Originated*","*purchased*")>0,"Yes","No")',
    category: "count",
    formula:
      "Count({<[Started Year]*={$(vYear)}, [Pull Through Originated Flag]*={Yes}>}[Loan Number])",
    sqlQuery: `COUNT(CASE 
      WHEN l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%' THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: "funding_date",
  },
  // Company Scorecard Originated - uses application_date filter (DateType={'Application'})
  // Different from originated_loans which uses funding_date
  scorecard_originated_loans: {
    id: "scorecard_originated_loans",
    name: "Scorecard Originated Loans",
    description:
      "Originated loans filtered by application_date for Company Scorecard. Qlik: Count({$<DateType={Application},[Pull Through Originated Flag]*={Yes}>}[Loan Number])",
    category: "count",
    formula:
      "Count({$<DateType={'Application'},[$(vToDate)]={'Yes'}, [Pull Through Originated Flag]*={'Yes'}>}[Loan Number])",
    sqlQuery: `COUNT(CASE 
      WHEN l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%' THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: "application_date", // Company Scorecard uses application_date filter
  },
  fallout_withdrawn: {
    id: "fallout_withdrawn",
    name: "Fallout - Withdrawn",
    description:
      'Loans withdrawn/cancelled. From Qlik: WildMatch([Current Loan Status],"*withdraw*","*not accepted*","*incomp*")>0 AND Pull Through Originated Flag = No',
    category: "count",
    formula:
      'Count({<[Started Year]*={$(vYear)}, [Current Loan Status]={"*withdraw*","*not accepted*","*incomp*"}, [Pull Through Originated Flag]*={No}>}[Loan Number])',
    sqlQuery: `COUNT(CASE 
      WHEN (l.current_loan_status ILIKE '%withdraw%' OR l.current_loan_status ILIKE '%not accepted%' OR l.current_loan_status ILIKE '%incomp%')
      AND NOT (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
      THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  fallout_denied: {
    id: "fallout_denied",
    name: "Fallout - Denied",
    description:
      'Loans denied. From Qlik: WildMatch([Current Loan Status],"*denied*")>0 AND Pull Through Originated Flag = No',
    category: "count",
    formula:
      'Count({<[Started Year]*={$(vYear)}, [Current Loan Status]={"*denied*"}, [Pull Through Originated Flag]*={No}>}[Loan Number])',
    sqlQuery: `COUNT(CASE 
      WHEN l.current_loan_status ILIKE '%denied%'
      AND NOT (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
      THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },

  // Funnel Volume Metrics
  // IMPORTANT: Date filtering should be on started_date (Started Year), NOT application_date
  loans_started_volume: {
    id: "loans_started_volume",
    name: "Loans Started Volume",
    description:
      "Total loan amount for all loans started (filtered by Started Year)",
    category: "volume",
    formula: "Sum({<[Started Year]*={$(vYear)}>}[Loan Amount])",
    sqlQuery: `SUM(COALESCE(l.loan_amount, 0))`,
    dependencies: [],
    defaultDateField: "started_date", // Filter by started_date
  },
  loans_with_respa_app_volume: {
    id: "loans_with_respa_app_volume",
    name: "Loans with RESPA Applications Volume",
    description:
      "Total loan amount for loans (filtered by Started Year) with RESPA applications (application_date exists)",
    category: "volume",
    formula:
      "Sum({<[Started Year]*={$(vYear)}, [RESPA App Status]*={Yes}>}[Loan Amount])",
    sqlQuery: `SUM(CASE WHEN l.application_date IS NOT NULL AND TRIM(l.application_date::text) != '' THEN COALESCE(l.loan_amount, 0) ELSE 0 END)`,
    dependencies: [],
    defaultDateField: "started_date", // Filter by started_date first
  },
  loans_no_respa_app_volume: {
    id: "loans_no_respa_app_volume",
    name: "Loans with No RESPA Applications Volume",
    description:
      "Total loan amount for loans (filtered by Started Year) without RESPA applications (application_date is null)",
    category: "volume",
    formula:
      "Sum({<[Started Year]*={$(vYear)}, [RESPA App Status]*={No}>}[Loan Amount])",
    sqlQuery: `SUM(CASE WHEN l.application_date IS NULL OR TRIM(l.application_date::text) = '' THEN COALESCE(l.loan_amount, 0) ELSE 0 END)`,
    dependencies: [],
    defaultDateField: "started_date", // Filter by started_date first
  },

  // Personnel Metrics - for use with groupBy and personnel filters
  // These can be filtered by loan_officer, processor, underwriter, branch, etc.
  lo_loan_count: {
    id: "lo_loan_count",
    name: "Loan Officer Loan Count",
    description:
      'Number of loans originated by loan officer. Use with loan_officer filter or groupBy: ["loan_officer"].',
    category: "count",
    formula: "Count({<[Loan Officer]>}[Loan Number])",
    sqlQuery: `COUNT(*)`,
    dependencies: [],
    defaultDateField: "funding_date",
  },
  lo_volume: {
    id: "lo_volume",
    name: "Loan Officer Volume",
    description:
      'Total loan volume originated by loan officer. Use with loan_officer filter or groupBy: ["loan_officer"].',
    category: "volume",
    formula: "Sum({<[Loan Officer]>}[Loan Amount])",
    sqlQuery: `SUM(COALESCE(l.loan_amount, 0))`,
    dependencies: [],
    defaultDateField: "funding_date",
  },
  lo_avg_cycle_time: {
    id: "lo_avg_cycle_time",
    name: "Loan Officer Avg Cycle Time",
    description:
      'Average cycle time (App to Close) for loan officer. Use with loan_officer filter or groupBy: ["loan_officer"].',
    category: "turn_time",
    formula: "Avg({<[Loan Officer]>}[App-Close])",
    sqlQuery: `AVG(CASE 
      WHEN l.closing_date IS NOT NULL AND l.application_date IS NOT NULL 
      THEN DATE(l.closing_date) - DATE(l.application_date) 
      ELSE NULL 
    END)`,
    dependencies: [],
    defaultDateField: "funding_date",
  },
  lo_pull_through: {
    id: "lo_pull_through",
    name: "Loan Officer Pull Through Rate",
    description:
      "Pull through rate for loan officer (originated / total applications). Use with loan_officer filter.",
    category: "pull_through",
    formula:
      "Count({<[Loan Officer], [Pull Through Originated Flag]={Yes}>}[Loan Number]) / Count({<[Loan Officer], [RESPA App Status]={Yes}>}[Loan Number])",
    sqlQuery: `ROUND(
      COUNT(CASE WHEN l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%' THEN 1 END)::float 
      / NULLIF(COUNT(CASE WHEN l.application_date IS NOT NULL AND l.current_loan_status NOT ILIKE '%active%' THEN 1 END), 0) * 100
    , 1)`,
    dependencies: [],
    defaultDateField: "started_date",
  },

  // Branch Metrics
  branch_loan_count: {
    id: "branch_loan_count",
    name: "Branch Loan Count",
    description:
      'Number of loans by branch. Use with branch filter or groupBy: ["branch"].',
    category: "count",
    formula: "Count({<[Branch]>}[Loan Number])",
    sqlQuery: `COUNT(*)`,
    dependencies: [],
    defaultDateField: "funding_date",
  },
  branch_volume: {
    id: "branch_volume",
    name: "Branch Volume",
    description:
      'Total loan volume by branch. Use with branch filter or groupBy: ["branch"].',
    category: "volume",
    formula: "Sum({<[Branch]>}[Loan Amount])",
    sqlQuery: `SUM(COALESCE(l.loan_amount, 0))`,
    dependencies: [],
    defaultDateField: "funding_date",
  },

  // Weighted Average Metrics for Scorecard
  // Qlik filters out-of-range values: [FICO Out of Range Flag]={No}, etc.
  // Typical out-of-range: FICO < 300 or > 850, LTV > 150, DTI > 100, Rate <= 0 or > 15
  // WA metrics - Qlik out-of-range values (from Script Additions Ranges.qvs Lines 125-132, 388-391):
  // FICO: Min = 350, Max = 900
  // LTV: Min = 0, Max = 110
  // DTI: Min = 0, Max = 70
  // Interest Rate: typically 0 < rate <= 15
  wa_fico: {
    id: "wa_fico",
    name: "Originated Weighted Average FICO",
    description:
      "Volume-weighted average FICO score for ORIGINATED loans only. Excludes out-of-range values (< 350 or > 900). Matches Qlik Originated WA FICO which uses [Pull Through Originated Flag]*={'Yes'} and [FICO Out of Range Flag]={No}.",
    category: "count",
    formula:
      "Sum({<[FICO Out of Range Flag]={No}, [Pull Through Originated Flag]*={'Yes'}>}[FICO Score] * [Loan Amount]) / Sum({<[FICO Out of Range Flag]={No}, [Pull Through Originated Flag]*={'Yes'}>}[Loan Amount])",
    sqlQuery: `ROUND(
      SUM(CASE WHEN l.fico_score >= 350 AND l.fico_score <= 900
        AND (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
        THEN l.fico_score * l.loan_amount ELSE 0 END) / 
      NULLIF(SUM(CASE WHEN l.fico_score >= 350 AND l.fico_score <= 900
        AND (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
        THEN l.loan_amount ELSE 0 END), 0)
    , 0)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  wa_ltv: {
    id: "wa_ltv",
    name: "Originated Weighted Average LTV",
    description:
      "Volume-weighted average LTV ratio for ORIGINATED loans only. Excludes out-of-range values (< 0 or > 110). Matches Qlik Originated WA LTV which uses [Pull Through Originated Flag]*={'Yes'} and [LTV Out of Range Flag]={No}.",
    category: "count",
    formula:
      "Sum({<[LTV Out of Range Flag]={No}, [Pull Through Originated Flag]*={'Yes'}>}[LTV Ratio] * [Loan Amount]) / Sum({<[LTV Out of Range Flag]={No}, [Pull Through Originated Flag]*={'Yes'}>}[Loan Amount])",
    sqlQuery: `ROUND(
      SUM(CASE WHEN l.ltv_ratio >= 0 AND l.ltv_ratio <= 110
        AND (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
        THEN l.ltv_ratio * l.loan_amount ELSE 0 END) / 
      NULLIF(SUM(CASE WHEN l.ltv_ratio >= 0 AND l.ltv_ratio <= 110
        AND (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
        THEN l.loan_amount ELSE 0 END), 0)
    , 1)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  wa_dti: {
    id: "wa_dti",
    name: "Originated Weighted Average DTI",
    description:
      "Volume-weighted average DTI ratio for ORIGINATED loans only. Excludes out-of-range values (< 0 or > 70). Matches Qlik Originated WA DTI which uses [Pull Through Originated Flag]*={'Yes'} and [DTI Out of Range Flag]={No}.",
    category: "count",
    formula:
      "Sum({<[DTI Out of Range Flag]={No}, [Pull Through Originated Flag]*={'Yes'}>}[BE DTI Ratio] * [Loan Amount]) / Sum({<[DTI Out of Range Flag]={No}, [Pull Through Originated Flag]*={'Yes'}>}[Loan Amount])",
    sqlQuery: `ROUND(
      SUM(CASE WHEN l.be_dti_ratio >= 0 AND l.be_dti_ratio <= 70
        AND (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
        THEN l.be_dti_ratio * l.loan_amount ELSE 0 END) / 
      NULLIF(SUM(CASE WHEN l.be_dti_ratio >= 0 AND l.be_dti_ratio <= 70
        AND (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
        THEN l.loan_amount ELSE 0 END), 0)
    , 1)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  wac: {
    id: "wac",
    name: "Weighted Average Coupon (WAC)",
    description:
      "Volume-weighted average interest rate. Excludes out-of-range values (<= 0 or > 15).",
    category: "count",
    formula:
      "Sum({<[Interest Rate Out of Range Flag]={No}>}[Interest Rate] * [Loan Amount]) / Sum([Loan Amount])",
    sqlQuery: `ROUND(
      SUM(CASE WHEN l.interest_rate > 0 AND l.interest_rate <= 15 THEN l.interest_rate * l.loan_amount ELSE 0 END) / 
      NULLIF(SUM(CASE WHEN l.interest_rate > 0 AND l.interest_rate <= 15 THEN l.loan_amount ELSE 0 END), 0)
    , 3)`,
    dependencies: [],
    defaultDateField: "application_date",
  },

  // Loan Type Breakdowns for Scorecard
  // NOTE: For Company Scorecard, Qlik uses Gov't Originated Units and Purchase Originated Units
  // which REQUIRE [Pull Through Originated Flag]*={'Yes'} (originated loans only)
  // These are the NON-originated versions for other contexts
  govt_units: {
    id: "govt_units",
    name: "Government Loan Units",
    description:
      "Count of ALL government loans (FHA, VA, FarmersHomeA, FarmersHomeAdministration). For originated only, use govt_originated_units.",
    category: "count",
    formula: "Count({<[Loan Type Group]={Government}>}[Loan Number])",
    sqlQuery: `COUNT(CASE WHEN l.loan_type IN ('FHA', 'VA', 'FarmersHomeA', 'FarmersHomeAdministration') THEN 1 END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  purchase_units: {
    id: "purchase_units",
    name: "Purchase Loan Units",
    description:
      "Count of ALL purchase loans. For originated only, use purchase_originated_units.",
    category: "count",
    formula: "Count({<[Loan Purpose Group]={Purchase}>}[Loan Number])",
    sqlQuery: `COUNT(CASE WHEN l.loan_purpose = 'Purchase' THEN 1 END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  // Company Scorecard ORIGINATED versions - THESE are what Company Scorecard uses
  // Qlik Expression (Line 22471): Count({$<DateType={'Application'},[$(vToDate)]={'Yes'}, [Pull Through Originated Flag]*={'Yes'},[Loan Type Group] = {'Government'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number])
  govt_originated_units: {
    id: "govt_originated_units",
    name: "Gov't Originated Units",
    description:
      "Count of ORIGINATED government loans (FHA, VA, FarmersHomeA, FarmersHomeAdministration). Matches Qlik Company Scorecard Gov't Originated Units.",
    category: "count",
    formula:
      "Count({$<[Pull Through Originated Flag]*={'Yes'},[Loan Type Group]={'Government'}>}[Loan Number])",
    sqlQuery: `COUNT(CASE 
      WHEN (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
        AND l.loan_type IN ('FHA', 'VA', 'FarmersHomeA', 'FarmersHomeAdministration') 
      THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  // Qlik Expression (Line 22475): Count({$<DateType={'Application'},[$(vToDate)]={'Yes'}, [Pull Through Originated Flag]*={'Yes'},[Loan Purpose Group] = {'Purchase'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number])
  purchase_originated_units: {
    id: "purchase_originated_units",
    name: "Purchase Originated Units",
    description:
      "Count of ORIGINATED purchase loans. Matches Qlik Company Scorecard Purchase Originated Units.",
    category: "count",
    formula:
      "Count({$<[Pull Through Originated Flag]*={'Yes'},[Loan Purpose Group]={'Purchase'}>}[Loan Number])",
    sqlQuery: `COUNT(CASE 
      WHEN (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
        AND l.loan_purpose = 'Purchase' 
      THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },

  // ============ Withdrawn Totals Metrics ============
  // Qlik Expression (Line 22497): Sum({$<DateType={'Application'},[$(vToDate)]={'Yes'}, [Withdrawn Flag]*={1}>}[Loan Amount])
  // IMPORTANT: Withdrawn Flag is defined in Script Additions Ranges.qvs Line 433 as:
  // If(WildMatch([Current Loan Status],'*withdraw*','*not accepted*','*incomp*')>0,1,0)
  // This includes: withdrawn, not accepted, AND incomplete loans!
  withdrawn_volume: {
    id: "withdrawn_volume",
    name: "Withdrawn Volume",
    description:
      "Sum of loan amounts for withdrawn loans (Withdrawn $). Includes withdrawn, not accepted, and incomplete per Qlik Withdrawn Flag definition.",
    category: "volume",
    formula: "Sum({$<[Withdrawn Flag]*={1}>}[Loan Amount])",
    sqlQuery: `SUM(CASE 
      WHEN l.current_loan_status ILIKE '%withdraw%' 
        OR l.current_loan_status ILIKE '%not accepted%'
        OR l.current_loan_status ILIKE '%incomp%'
      THEN l.loan_amount 
      ELSE 0 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },
  // Qlik Expression (Lines 22498-22502): W/D ProForma Revenue
  // NOTE: This uses [Current Loan Status] directly with only '*withdrawn*' and '*not accepted*' - NOT the Withdrawn Flag!
  // So incomplete loans are NOT included in this calculation.
  // Formula: Sum(Revenue for withdrawn with Revenue > 0) + Sum(Loan Amount * vFundedRevMargin for withdrawn with Revenue <= 0)
  // vFundedRevMargin = Sum(Revenue for funded loans with Revenue > 0) / Sum(Loan Amount for funded loans with Revenue > 0)
  // This is a DYNAMIC margin calculated from actual funded loan data, NOT a fixed 2%
  withdrawn_proforma_revenue: {
    id: "withdrawn_proforma_revenue",
    name: "W/D ProForma Revenue",
    description:
      "ProForma revenue for withdrawn/not accepted loans (NOT incomplete). Uses actual revenue if > 0, otherwise estimates using dynamic funded margin (vFundedRevMargin).",
    category: "revenue",
    formula:
      "Sum({$<[Current Loan Status]*={'*withdrawn*','*not accepted*'},Revenue={'>0'}>}Revenue) + Sum({$<...,Revenue={'<=0'}>}[Loan Amount]*vFundedRevMargin)",
    sqlQuery: `SUM(
      CASE 
        WHEN l.current_loan_status ILIKE '%withdraw%' OR l.current_loan_status ILIKE '%not accepted%' THEN
          CASE 
            -- Calculate Revenue: Base Buy ($) + Orig Fee Borr Pd + Orig Fees Seller - CD Lender Credits
            WHEN (
              COALESCE(
                CASE 
                  WHEN l.rate_lock_buy_side_base_price_rate IS NOT NULL AND l.rate_lock_buy_side_base_price_rate != 0 
                  THEN ROUND(((l.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * l.loan_amount, 2)
                  ELSE 0 
                END, 0) +
              COALESCE(l.orig_fee_borr_pd, 0) + 
              COALESCE(l.orig_fees_seller, 0) - 
              COALESCE(l.cd_lender_credits, 0)
            ) > 0 THEN (
              -- If loan has actual revenue > 0, use it
              COALESCE(
                CASE 
                  WHEN l.rate_lock_buy_side_base_price_rate IS NOT NULL AND l.rate_lock_buy_side_base_price_rate != 0 
                  THEN ROUND(((l.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * l.loan_amount, 2)
                  ELSE 0 
                END, 0) +
              COALESCE(l.orig_fee_borr_pd, 0) + 
              COALESCE(l.orig_fees_seller, 0) - 
              COALESCE(l.cd_lender_credits, 0)
            )
            -- Otherwise use dynamic vFundedRevMargin: Total Revenue / Total Loan Amount for funded loans with positive revenue
            ELSE l.loan_amount * COALESCE(
              (SELECT 
                SUM(
                  COALESCE(
                    CASE 
                      WHEN f.rate_lock_buy_side_base_price_rate IS NOT NULL AND f.rate_lock_buy_side_base_price_rate != 0 
                      THEN ROUND(((f.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * f.loan_amount, 2)
                      ELSE 0 
                    END, 0) +
                  COALESCE(f.orig_fee_borr_pd, 0) + 
                  COALESCE(f.orig_fees_seller, 0) - 
                  COALESCE(f.cd_lender_credits, 0)
                ) / NULLIF(SUM(f.loan_amount), 0)
              FROM public.loans f
              WHERE (f.current_loan_status ILIKE '%funded%' OR f.current_loan_status ILIKE '%originated%' OR f.current_loan_status ILIKE '%purchased%')
                AND (
                  COALESCE(
                    CASE 
                      WHEN f.rate_lock_buy_side_base_price_rate IS NOT NULL AND f.rate_lock_buy_side_base_price_rate != 0 
                      THEN ROUND(((f.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * f.loan_amount, 2)
                      ELSE 0 
                    END, 0) +
                  COALESCE(f.orig_fee_borr_pd, 0) + 
                  COALESCE(f.orig_fees_seller, 0) - 
                  COALESCE(f.cd_lender_credits, 0)
                ) > 0
              ),
              0.02  -- Fallback to 2% if no funded loans with positive revenue exist
            )
          END
        ELSE 0
      END
    )`,
    dependencies: [],
    defaultDateField: "application_date",
  },

  // ============ Denied Totals Metrics ============
  // Qlik Expression (Line 23027): Sum({$<DateType={'Application'},[$(vToDate)]={'Yes'}, [Denied Flag]*={1}>}[Loan Amount])
  denied_volume: {
    id: "denied_volume",
    name: "Denied Volume",
    description:
      "Sum of loan amounts for denied loans (Denied $). Matches Qlik Company Scorecard Denied $.",
    category: "volume",
    formula: "Sum({$<[Denied Flag]*={1}>}[Loan Amount])",
    sqlQuery: `SUM(CASE 
      WHEN l.current_loan_status ILIKE '%denied%' 
      THEN l.loan_amount 
      ELSE 0 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },

  // Revenue Metric for Scorecard
  // Qlik Formula: [Base Buy ($)] + [Orig Fee Borr Pd] + [Orig Fees Seller] - [CD Lender Credits]
  // Where Base Buy ($) = ((rate_lock_buy_side_base_price_rate - 100) / 100) * loan_amount
  // Note: Qlik aliases "Rate Lock Buy Side Base Price Rate" as "Base Buy" (Transform.qvs line 313)
  // The rate is stored as basis points (100 = par/0%, 101 = 1% premium, 99 = 1% discount)
  total_revenue: {
    id: "total_revenue",
    name: "Total Revenue",
    description:
      "Revenue calculated as Base Buy ($) + Orig Fee Borr Pd + Orig Fees Seller - CD Lender Credits. Matches Qlik REVENUE.qvs formula.",
    category: "revenue",
    formula:
      "[Base Buy ($)] + [Orig Fee Borr Pd] + [Orig Fees Seller] - [CD Lender Credits]",
    sqlQuery: `SUM(
      COALESCE(
        CASE 
          WHEN l.rate_lock_buy_side_base_price_rate IS NOT NULL AND l.rate_lock_buy_side_base_price_rate != 0 
          THEN ROUND(((l.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * l.loan_amount, 2)
          ELSE 0 
        END, 0) +
      COALESCE(l.orig_fee_borr_pd, 0) + 
      COALESCE(l.orig_fees_seller, 0) - 
      COALESCE(l.cd_lender_credits, 0)
    )`,
    dependencies: [],
    defaultDateField: "funding_date",
  },
  // Originated Revenue - Revenue for originated loans only
  // Qlik: Sum({$<DateType={'Application'},[$(vToDate)]={'Yes'}, [Pull Through Originated Flag]*={'Yes'}>}[Revenue])
  // Uses rate_lock_buy_side_base_price_rate for Base Buy (Transform.qvs line 313)
  originated_revenue: {
    id: "originated_revenue",
    name: "Originated Revenue",
    description:
      "Revenue for originated loans only. Matches Qlik CompanyScorecard_Originated Revenue $ expression.",
    category: "revenue",
    formula: "Sum({$<[Pull Through Originated Flag]*={'Yes'}>}[Revenue])",
    sqlQuery: `SUM(
      CASE 
        WHEN l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%' THEN
          COALESCE(
            CASE 
              WHEN l.rate_lock_buy_side_base_price_rate IS NOT NULL AND l.rate_lock_buy_side_base_price_rate != 0 
              THEN ROUND(((l.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * l.loan_amount, 2)
              ELSE 0 
            END, 0) +
          COALESCE(l.orig_fee_borr_pd, 0) + 
          COALESCE(l.orig_fees_seller, 0) - 
          COALESCE(l.cd_lender_credits, 0)
        ELSE 0
      END
    )`,
    dependencies: [],
    defaultDateField: "application_date", // Company Scorecard uses application_date
  },

  // ==========================================================================
  // TopTiering Metrics - Used in TopTieringComparisonView
  // Source: server/src/routes/toptiering/index.ts (lines 466-763)
  // Tier Assignment: Top (cumulative revenue ≤50%), Second (50-80%), Bottom (>80%)
  // ==========================================================================
  //
  // NOTE: TTS (Top Tier Score) calculations are NOT in the metrics catalog.
  // TTS requires per-actor comparison to company averages, which cannot be
  // represented as a simple aggregate SQL query.
  //
  // TTS Score Formulas (computed in scorecard API endpoints):
  //
  // SALES SCORECARD (server/src/routes/scorecard/index.ts lines 394-402):
  //   TTS = (VolumeRating × 0.20 + MarginRating × 0.20 + UnitRating × 0.20 +
  //          TurnTimeRating × 0.20 + PullThroughRating × 0.20 + ConcessionRating × 0.20) / 10
  //
  //   Where each Rating = (actorValue / companyAverage) × 100
  //   TurnTimeRating and ConcessionRating are INVERTED (lower value = higher rating)
  //
  // OPERATIONS SCORECARD (server/src/routes/scorecard/index.ts lines 761-766):
  //   OPS_TTS = (UnitRating × 0.70 + TurnTimeRating × 0.15 + ComplexityRating × 0.15)
  //
  // TIER THRESHOLDS (server/src/utils/scorecard-utils.ts lines 330-347):
  //   Top Tier:    TTS ≥ 120 (20%+ above average)
  //   Second Tier: TTS ≥ 80 and < 120
  //   Bottom Tier: TTS < 80
  //
  // ==========================================================================

  // Revenue BPS - Revenue per loan amount in basis points
  // Source: toptiering/index.ts line 263, scorecard-utils.ts line 251
  revenue_bps: {
    id: "revenue_bps",
    name: "Revenue BPS",
    description:
      "Revenue per loan amount in basis points. Calculated as (Total Revenue / Total Volume) * 10000. Used in TopTiering analysis.",
    category: "revenue",
    formula: "(total_revenue / total_volume) * 10000",
    sqlQuery: `CASE 
      WHEN SUM(l.loan_amount) > 0 THEN 
        (SUM(
          COALESCE(
            CASE 
              WHEN l.rate_lock_buy_side_base_price_rate IS NOT NULL AND l.rate_lock_buy_side_base_price_rate != 0 
              THEN ROUND(((l.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * l.loan_amount, 2)
              ELSE 0 
            END, 0) +
          COALESCE(l.orig_fee_borr_pd, 0) + 
          COALESCE(l.orig_fees_seller, 0) - 
          COALESCE(l.cd_lender_credits, 0)
        ) / NULLIF(SUM(l.loan_amount), 0)) * 10000
      ELSE 0 
    END`,
    dependencies: ["total_revenue", "total_volume"],
    defaultDateField: "funding_date",
  },

  // Revenue Per Loan - Average revenue per funded loan
  // Source: toptiering/index.ts line 264
  revenue_per_loan: {
    id: "revenue_per_loan",
    name: "Revenue Per Loan",
    description:
      "Average revenue per funded loan. Calculated as Total Revenue / Count of Funded Loans. Used in TopTiering analysis.",
    category: "revenue",
    formula: "total_revenue / COUNT(DISTINCT loan_number)",
    sqlQuery: `CASE 
      WHEN COUNT(DISTINCT COALESCE(l.loan_number, l.loan_id::text)) > 0 THEN 
        SUM(
          COALESCE(
            CASE 
              WHEN l.rate_lock_buy_side_base_price_rate IS NOT NULL AND l.rate_lock_buy_side_base_price_rate != 0 
              THEN ROUND(((l.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * l.loan_amount, 2)
              ELSE 0 
            END, 0) +
          COALESCE(l.orig_fee_borr_pd, 0) + 
          COALESCE(l.orig_fees_seller, 0) - 
          COALESCE(l.cd_lender_credits, 0)
        ) / NULLIF(COUNT(DISTINCT COALESCE(l.loan_number, l.loan_id::text)), 0)
      ELSE 0 
    END`,
    dependencies: ["total_revenue"],
    defaultDateField: "funding_date",
  },

  // Lost Opportunity Units - Withdrawn/Cancelled/Not Accepted loans
  // Source: toptiering/index.ts lines 125-147, 306-309
  lost_opportunity_units: {
    id: "lost_opportunity_units",
    name: "Lost Opportunity Units",
    description:
      "Count of loans that were withdrawn, cancelled, not accepted, or incomplete. These represent potential revenue that was lost.",
    category: "count",
    formula:
      "COUNT where current_loan_status IN ('withdrawn', 'cancelled', 'not accepted', 'incomplete')",
    sqlQuery: `COUNT(CASE 
      WHEN LOWER(l.current_loan_status) LIKE '%withdraw%'
        OR LOWER(l.current_loan_status) LIKE '%cancelled%'
        OR LOWER(l.current_loan_status) LIKE '%not accepted%'
        OR LOWER(l.current_loan_status) LIKE '%incomplete%'
      THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },

  // Lost Opportunity Revenue - Revenue from lost opportunity loans
  // Source: toptiering/index.ts lines 396-397, scorecard/index.ts line 309
  lost_opportunity_revenue: {
    id: "lost_opportunity_revenue",
    name: "Lost Opportunity Revenue",
    description:
      "Estimated revenue that would have been earned from withdrawn/cancelled/not accepted loans, based on their loan amount and rate lock pricing.",
    category: "revenue",
    formula: "SUM(revenue) where status = lost opportunity",
    sqlQuery: `SUM(CASE 
      WHEN LOWER(l.current_loan_status) LIKE '%withdraw%'
        OR LOWER(l.current_loan_status) LIKE '%cancelled%'
        OR LOWER(l.current_loan_status) LIKE '%not accepted%'
        OR LOWER(l.current_loan_status) LIKE '%incomplete%'
      THEN 
        COALESCE(
          CASE 
            WHEN l.rate_lock_buy_side_base_price_rate IS NOT NULL AND l.rate_lock_buy_side_base_price_rate != 0 
            THEN ROUND(((l.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * l.loan_amount, 2)
            ELSE 0 
          END, 0) +
        COALESCE(l.orig_fee_borr_pd, 0) + 
        COALESCE(l.orig_fees_seller, 0) - 
        COALESCE(l.cd_lender_credits, 0)
      ELSE 0
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },

  // Denied Units - Denied/Declined loans count
  // Source: toptiering/index.ts lines 149-163, scorecard/index.ts lines 313-315
  denied_units: {
    id: "denied_units",
    name: "Denied Units",
    description: "Count of loans that were denied or declined.",
    category: "count",
    formula: "COUNT where current_loan_status IN ('denied', 'declined')",
    sqlQuery: `COUNT(CASE 
      WHEN LOWER(l.current_loan_status) LIKE '%denied%'
        OR LOWER(l.current_loan_status) LIKE '%declined%'
      THEN 1 
    END)`,
    dependencies: [],
    defaultDateField: "application_date",
  },

  // ==========================================================================
  // Sales Scorecard TTS Metrics
  // Source: server/src/routes/scorecard/index.ts (lines 63-511)
  // TTS Formula: (VolumeRating + MarginRating + UnitRating + TurnTimeRating +
  //               PullThroughRating + ConcessionRating) × weights / 10
  // Tier Thresholds: Top ≥120, Second ≥80, Bottom <80
  // ==========================================================================

  // Branch Price Concession - Average concession given
  // Source: scorecard/index.ts lines 254-255, 367-369
  avg_concession: {
    id: "avg_concession",
    name: "Average Concession",
    description:
      "Average branch price concession across funded loans. Lower is better. Used in Sales Scorecard TTS calculation.",
    category: "revenue",
    formula: "AVG(branch_price_concession)",
    sqlQuery: `AVG(CASE 
      WHEN l.branch_price_concession IS NOT NULL AND l.branch_price_concession != 0 
      THEN l.branch_price_concession 
    END)`,
    dependencies: [],
    defaultDateField: "funding_date",
    notes: "Inverted rating: lower concession = higher TTS rating",
  },

  // ==========================================================================
  // Operations Scorecard TTS Metrics
  // Source: server/src/routes/scorecard/index.ts (lines 532-869)
  // TTS Formula: (UnitRating × 0.70) + (TurnTimeRating × 0.15) + (ComplexityRating × 0.15)
  // ==========================================================================

  // Loan Complexity Score - Complexity based on loan characteristics
  // Source: scorecard-utils.ts lines 403-446
  loan_complexity_score: {
    id: "loan_complexity_score",
    name: "Loan Complexity Score",
    description:
      "Average loan complexity score. Baseline 100. Factors: Government loan (+10), Purchase (+5), Low FICO <680 (+10), High LTV >80 (+5), High DTI >43 (+5), Non-owner occupied (+5), Self-employed (+5).",
    category: "turn_time",
    formula:
      "100 + (govt_loan × 10) + (purchase × 5) + (low_fico × 10) + (high_ltv × 5) + (high_dti × 5) + (non_owner × 5) + (self_employed × 5)",
    sqlQuery: `AVG(
      100 +
      CASE WHEN UPPER(l.loan_type) IN ('FHA', 'VA', 'USDA', 'FARMERSHOMEA', 'FARMERSHOMEADMINISTRATION') THEN 10 ELSE 0 END +
      CASE WHEN UPPER(l.loan_purpose) = 'PURCHASE' THEN 5 ELSE 0 END +
      CASE WHEN l.fico_score IS NOT NULL AND l.fico_score < 680 THEN 10 ELSE 0 END +
      CASE WHEN l.ltv_ratio IS NOT NULL AND l.ltv_ratio > 80 THEN 5 ELSE 0 END +
      CASE WHEN l.be_dti_ratio IS NOT NULL AND l.be_dti_ratio > 43 THEN 5 ELSE 0 END +
      CASE WHEN l.occupancy_type IS NOT NULL AND UPPER(l.occupancy_type) NOT LIKE '%PRIMARY%' AND UPPER(l.occupancy_type) NOT LIKE '%OWNER%' THEN 5 ELSE 0 END +
      CASE WHEN l.borr_self_employed = true OR l.borr_self_employed = 'Y' OR l.borr_self_employed = 'Yes' OR l.borr_self_employed = '1' THEN 5 ELSE 0 END
    )`,
    dependencies: [],
    defaultDateField: "funding_date",
    notes:
      "Higher complexity = more difficult to process. Used in Operations Scorecard.",
  },

  // Processor Turn Time - Days from processing to approval
  // Source: scorecard-utils.ts lines 103-124 (OPERATIONS_ACTOR_CONFIGS)
  processor_turn_time: {
    id: "processor_turn_time",
    name: "Processor Turn Time",
    description:
      "Average days from processing_date to approval_date. Used in Operations Scorecard for Processor actors.",
    category: "turn_time",
    formula: "AVG(approval_date - processing_date)",
    sqlQuery: `AVG(
      CASE 
        WHEN l.processing_date IS NOT NULL AND l.approval_date IS NOT NULL 
          AND l.approval_date > l.processing_date
        THEN EXTRACT(EPOCH FROM (l.approval_date - l.processing_date)) / 86400
      END
    )`,
    dependencies: [],
    defaultDateField: "approval_date",
  },

  // Underwriter Turn Time - Days from approval to closing
  // Source: scorecard-utils.ts lines 103-124 (OPERATIONS_ACTOR_CONFIGS)
  underwriter_turn_time: {
    id: "underwriter_turn_time",
    name: "Underwriter Turn Time",
    description:
      "Average days from approval_date to closing_date. Used in Operations Scorecard for Underwriter actors.",
    category: "turn_time",
    formula: "AVG(closing_date - approval_date)",
    sqlQuery: `AVG(
      CASE 
        WHEN l.approval_date IS NOT NULL AND l.closing_date IS NOT NULL 
          AND l.closing_date > l.approval_date
        THEN EXTRACT(EPOCH FROM (l.closing_date - l.approval_date)) / 86400
      END
    )`,
    dependencies: [],
    defaultDateField: "closing_date",
  },

  // Closer Turn Time - Days from closing to disbursement
  // Source: scorecard-utils.ts lines 103-124 (OPERATIONS_ACTOR_CONFIGS)
  closer_turn_time: {
    id: "closer_turn_time",
    name: "Closer Turn Time",
    description:
      "Average days from closing_date to disbursement_date. Used in Operations Scorecard for Closer actors.",
    category: "turn_time",
    formula: "AVG(disbursement_date - closing_date)",
    sqlQuery: `AVG(
      CASE 
        WHEN l.closing_date IS NOT NULL AND l.disbursement_date IS NOT NULL 
          AND l.disbursement_date > l.closing_date
        THEN EXTRACT(EPOCH FROM (l.disbursement_date - l.closing_date)) / 86400
      END
    )`,
    dependencies: [],
    defaultDateField: "disbursement_date",
  },

  // Warehouse Days - Days from funding to investor purchase
  // Source: scorecard/index.ts lines 230-240 (waWhDays calculation)
  warehouse_days: {
    id: "warehouse_days",
    name: "Warehouse Days",
    description:
      "Weighted average days loans are held in warehouse (funding to investor purchase). If not yet purchased, uses current date.",
    category: "turn_time",
    formula:
      "WA(investor_purchase_date - funding_date) weighted by loan_amount",
    sqlQuery: `CASE 
      WHEN SUM(CASE WHEN l.funding_date IS NOT NULL THEN l.loan_amount END) > 0 THEN
        SUM(
          CASE 
            WHEN l.funding_date IS NOT NULL THEN
              l.loan_amount * 
              CASE 
                WHEN l.investor_purchase_date IS NOT NULL 
                THEN EXTRACT(EPOCH FROM (l.investor_purchase_date - l.funding_date)) / 86400
                ELSE EXTRACT(EPOCH FROM (CURRENT_DATE - l.funding_date)) / 86400
              END
          END
        ) / NULLIF(SUM(CASE WHEN l.funding_date IS NOT NULL THEN l.loan_amount END), 0)
      ELSE 0
    END`,
    dependencies: [],
    defaultDateField: "funding_date",
  },

  // Average Conditions - Average number of conditions per loan
  // Source: scorecard/index.ts lines 203-210
  avg_conditions: {
    id: "avg_conditions",
    name: "Average Conditions",
    description:
      "Average number of conditions (PTDs/PTCs) per loan. Higher number indicates more documentation requirements.",
    category: "count",
    formula: "AVG(number_of_conditions)",
    sqlQuery: `AVG(CASE WHEN l.number_of_conditions IS NOT NULL AND l.number_of_conditions > 0 THEN l.number_of_conditions END)`,
    dependencies: [],
    defaultDateField: "funding_date",
  },

  // ==========================================================================
  // Funnel Metrics - Used in LoanFunnelView
  // ==========================================================================

  // Conversion Rate - Originated loans as percentage of loans started
  conversion_rate: {
    id: "conversion_rate",
    name: "Conversion Rate",
    description:
      "Percentage of loans started that were originated. Calculated as (Originated Loans / Loans Started) * 100.",
    category: "pull_through",
    formula: "(originated_loans / loans_started) * 100",
    sqlQuery: `CASE 
      WHEN COUNT(CASE WHEN l.started_date IS NOT NULL THEN 1 END) > 0 THEN
        COUNT(CASE 
          WHEN (l.funding_date IS NOT NULL OR l.investor_purchase_date IS NOT NULL)
          THEN 1 
        END)::float / NULLIF(COUNT(CASE WHEN l.started_date IS NOT NULL THEN 1 END), 0) * 100
      ELSE 0
    END`,
    dependencies: ["loans_started", "originated_loans"],
    defaultDateField: "started_date",
  },

  // NOTE: estimated_inquiries was REMOVED from the catalog.
  // It was a fabricated metric (loansStarted * 1.5) with no actual data backing.
  // Fake/estimated data should NOT be in a queryable metrics catalog.
  // The LoanFunnelView still displays this estimate visually, clearly labeled as such.
};

// Helper to build date range WHERE clause
// Uses DATE() cast to ensure consistent comparison regardless of timestamp precision
// IMPORTANT: Does NOT fallback to created_at - loans missing the date field are excluded
function buildDateRangeClause(
  dateRange: DateRange | undefined,
  dateField: string,
  paramOffset: number = 0
): { clause: string; params: any[] } {
  if (!dateRange || (!dateRange.start && !dateRange.end)) {
    return { clause: "", params: [] }; // No date filtering
  }

  const clauses: string[] = [];
  const params: any[] = [];

  // Special case: 'any_date' means ANY of the loan's dates can be in range (Qlik associative model)
  // This is used for Lost Opportunities where Qlik doesn't specify a DateType
  // All DateTypes from Qlik's DateLink table (Calendar-Link.qvs):
  // Started, Application, Closing, Funding, Investor Purchase, Investor Lock,
  // Estimated Close, Estimated Closing, CTC, HMDA (Current Status)
  if (dateField === "any_date") {
    const dateFields = [
      "application_date", // Application
      "started_date", // Started
      "current_status_date", // HMDA
      "funding_date", // Funding
      "closing_date", // Closing
      "investor_purchase_date", // Investor Purchase
      "lock_date", // Investor Lock
      "estimated_closing_date", // Estimated Close / Estimated Closing
      "ctc_date", // CTC (Clear to Close)
    ];
    const dateConditions: string[] = [];

    for (const df of dateFields) {
      const fieldConditions: string[] = [];
      fieldConditions.push(`l.${df} IS NOT NULL`);
      if (dateRange.start) {
        fieldConditions.push(
          `DATE(l.${df}) >= $${paramOffset + params.length + 1}::date`
        );
        if (
          params.length === 0 ||
          params[params.length - 1] !== dateRange.start
        ) {
          params.push(dateRange.start);
        }
      }
      if (dateRange.end) {
        fieldConditions.push(
          `DATE(l.${df}) <= $${paramOffset + params.length + 1}::date`
        );
        if (
          params.length === 0 ||
          params[params.length - 1] !== dateRange.end
        ) {
          params.push(dateRange.end);
        }
      }
      dateConditions.push(`(${fieldConditions.join(" AND ")})`);
    }

    // Reset params and build properly with consistent parameter numbering
    params.length = 0;
    const orConditions: string[] = [];

    for (const df of dateFields) {
      if (dateRange.start && dateRange.end) {
        orConditions.push(
          `(l.${df} IS NOT NULL AND DATE(l.${df}) >= $${
            paramOffset + 1
          }::date AND DATE(l.${df}) <= $${paramOffset + 2}::date)`
        );
      } else if (dateRange.start) {
        orConditions.push(
          `(l.${df} IS NOT NULL AND DATE(l.${df}) >= $${paramOffset + 1}::date)`
        );
      } else if (dateRange.end) {
        orConditions.push(
          `(l.${df} IS NOT NULL AND DATE(l.${df}) <= $${paramOffset + 1}::date)`
        );
      }
    }

    if (dateRange.start) params.push(dateRange.start);
    if (dateRange.end) params.push(dateRange.end);

    return {
      clause:
        orConditions.length > 0 ? `AND (${orConditions.join(" OR ")})` : "",
      params,
    };
  }

  // Standard single date field filtering
  // Use the actual date field directly - don't fallback to created_at
  // Loans without this date field will be excluded (which is correct for date-filtered queries)
  const field = `DATE(l.${dateField})`;

  // First, ensure the date field is not null
  clauses.push(`l.${dateField} IS NOT NULL`);

  if (dateRange.start) {
    clauses.push(`${field} >= $${paramOffset + params.length + 1}::date`);
    params.push(dateRange.start);
  }
  if (dateRange.end) {
    clauses.push(`${field} <= $${paramOffset + params.length + 1}::date`);
    params.push(dateRange.end);
  }

  return {
    clause: clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "",
    params,
  };
}

// Special date range clause for avg_cycle_time: filter by closing_date OR funding_date
// Uses DATE() cast to ensure consistent comparison regardless of timestamp precision
function buildDateRangeClauseForCycleTime(
  dateRange: DateRange | undefined,
  paramOffset: number = 0
): { clause: string; params: any[] } {
  if (!dateRange || (!dateRange.start && !dateRange.end)) {
    return { clause: "", params: [] }; // No date filtering
  }

  const clauses: string[] = [];
  const params: any[] = [];

  // Filter by closing_date OR funding_date (whichever exists) being in the date range
  // Cast to DATE for consistent day-level comparison
  if (dateRange.start && dateRange.end) {
    clauses.push(
      `(DATE(l.closing_date) >= $${
        paramOffset + params.length + 1
      }::date AND DATE(l.closing_date) <= $${
        paramOffset + params.length + 2
      }::date) OR (l.closing_date IS NULL AND DATE(l.funding_date) >= $${
        paramOffset + params.length + 1
      }::date AND DATE(l.funding_date) <= $${
        paramOffset + params.length + 2
      }::date)`
    );
    params.push(dateRange.start, dateRange.end);
  } else if (dateRange.start) {
    clauses.push(
      `(DATE(l.closing_date) >= $${
        paramOffset + params.length + 1
      }::date) OR (l.closing_date IS NULL AND DATE(l.funding_date) >= $${
        paramOffset + params.length + 1
      }::date)`
    );
    params.push(dateRange.start);
  } else if (dateRange.end) {
    clauses.push(
      `(DATE(l.closing_date) <= $${
        paramOffset + params.length + 1
      }::date) OR (l.closing_date IS NULL AND DATE(l.funding_date) <= $${
        paramOffset + params.length + 1
      }::date)`
    );
    params.push(dateRange.end);
  }

  return {
    clause: clauses.length > 0 ? `AND (${clauses.join(" OR ")})` : "",
    params,
  };
}

// Helper to build WHERE clause from additional filters
function buildWhereClause(
  filters: Record<string, any>,
  paramOffset: number = 0
): { clause: string; params: any[] } {
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

  // Personnel filters - support both ID and name
  if (filters.loan_officer_id) {
    clauses.push(`l.loan_officer_id = $${paramOffset + params.length + 1}`);
    params.push(filters.loan_officer_id);
  }

  if (filters.loan_officer) {
    // Filter by loan officer name (case-insensitive partial match)
    clauses.push(
      `LOWER(l.loan_officer) LIKE LOWER($${paramOffset + params.length + 1})`
    );
    params.push(`%${filters.loan_officer}%`);
  }

  if (filters.processor) {
    clauses.push(
      `LOWER(l.processor) LIKE LOWER($${paramOffset + params.length + 1})`
    );
    params.push(`%${filters.processor}%`);
  }

  if (filters.underwriter) {
    clauses.push(
      `LOWER(l.underwriter) LIKE LOWER($${paramOffset + params.length + 1})`
    );
    params.push(`%${filters.underwriter}%`);
  }

  if (filters.closer) {
    clauses.push(
      `LOWER(l.closer) LIKE LOWER($${paramOffset + params.length + 1})`
    );
    params.push(`%${filters.closer}%`);
  }

  if (filters.channel) {
    clauses.push(`l.channel = $${paramOffset + params.length + 1}`);
    params.push(filters.channel);
  }

  // Consolidated Channel filter - matches channel groups or individual channel values
  // Channel grouping logic:
  // - Retail = Direct origination (channels containing "retail")
  // - TPO = Third Party Origination (brokers, wholesale, correspondent)
  // - Individual channel values matched exactly
  if (filters.consolidated_channel) {
    const cc = filters.consolidated_channel.toLowerCase();
    if (cc === "retail") {
      // Retail channels: Direct origination only
      // NOTE: "Brokered" is NOT Retail - it's TPO
      clauses.push(`(l.channel ILIKE '%retail%')`);
    } else if (cc === "tpo") {
      // TPO channels: Brokers, Wholesale, Correspondent
      clauses.push(
        `(l.channel ILIKE '%broker%' OR l.channel ILIKE '%brokered%' 
          OR l.channel ILIKE '%wholesale%' OR l.channel ILIKE '%correspondent%' 
          OR l.channel ILIKE '%corresp%' OR l.channel ILIKE '%tpo%')`
      );
    } else if (cc === "99-missing") {
      // Missing/null channels
      clauses.push(`(l.channel IS NULL OR TRIM(l.channel) = '')`);
    } else if (cc !== "all" && cc !== "*") {
      // Specific individual channel value (exact match, case-insensitive)
      clauses.push(
        `LOWER(TRIM(l.channel)) = LOWER($${paramOffset + params.length + 1})`
      );
      params.push(filters.consolidated_channel);
    }
    // 'all' or '*' means no filter
  }

  if (filters.investor) {
    clauses.push(`l.investor = $${paramOffset + params.length + 1}`);
    params.push(filters.investor);
  }

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      clauses.push(
        `l.current_loan_status = ANY($${
          paramOffset + params.length + 1
        }::text[])`
      );
      params.push(filters.status);
    } else {
      clauses.push(
        `l.current_loan_status = $${paramOffset + params.length + 1}`
      );
      params.push(filters.status);
    }
  }

  // Special filter for Lost Opportunities
  // Credit Risk Management uses [Withdrawn Flag]={1},[$(vToDate)]={'Yes'} in Qlik
  // [Withdrawn Flag]={1} means ONLY withdrawn status - NOT denied
  // Combined with any_date logic to check ALL dates (Qlik associative model)
  //
  // Qlik Withdrawn Flag: WildMatch([Current Loan Status],'*withdraw*','*not accepted*','*incomp*')>0
  if (filters.withdrawn_filter) {
    clauses.push(
      `(l.current_loan_status ILIKE '%withdraw%' OR l.current_loan_status ILIKE '%not accepted%' OR l.current_loan_status ILIKE '%incomp%')`
    );
  }

  // KPI-specific filters - match exact logic from METRICS_CATALOG
  // Active Loans: current_loan_status = 'Active Loan' AND application_date IS NOT NULL
  if (filters.active_loan_filter) {
    clauses.push(
      `(l.current_loan_status = 'Active Loan' AND l.application_date IS NOT NULL AND l.application_date::text != '')`
    );
  }

  // Closed Loans: funding_date IS NOT NULL AND funding_date <= CURRENT_DATE
  if (filters.closed_loan_filter) {
    clauses.push(
      `(l.funding_date IS NOT NULL AND l.funding_date <= CURRENT_DATE)`
    );
  }

  // Locked Loans: lock_date IS NOT NULL
  if (filters.locked_loan_filter) {
    clauses.push(`(l.lock_date IS NOT NULL)`);
  }

  // Loan purpose filter
  if (filters.loan_purpose) {
    clauses.push(`l.loan_purpose = $${paramOffset + params.length + 1}`);
    params.push(filters.loan_purpose);
  }

  // Occupancy type filter
  if (filters.occupancy_type) {
    clauses.push(`l.occupancy_type = $${paramOffset + params.length + 1}`);
    params.push(filters.occupancy_type);
  }

  return {
    clause: clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "",
    params,
  };
}

/**
 * Query a single metric
 *
 * @param tenantPool - Tenant database connection pool
 * @param metricId - ID of the metric to query from METRICS_CATALOG
 * @param options - Query options including date range, filters, and user access filter
 * @returns Metric result with value and metadata
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

  // Check for no-access filter (returns zero immediately)
  if (options.userAccessFilter?.sql === "FALSE") {
    return {
      metricId,
      value: 0,
      metadata: {
        dateRange: options.dateRange,
        accessFiltered: true,
        noAccess: true,
      },
    };
  }

  // Build user access clause (must be first to get correct param index)
  let currentParamIndex = 1;
  let userAccessClause = "";
  const userAccessParams: any[] = [];

  if (options.userAccessFilter && options.userAccessFilter.sql !== "FALSE") {
    // User has filtered access - apply the junction table filter
    userAccessClause = `AND ${options.userAccessFilter.sql}`;
    userAccessParams.push(...options.userAccessFilter.params);
    currentParamIndex += options.userAccessFilter.paramOffset;
  }
  // null userAccessFilter means full access - no clause needed

  const dateField =
    options.dateField || metric.defaultDateField || "application_date";
  // Skip date filtering for metrics that represent current state (e.g., active_loans, locked_loans)
  let dateRangeClause;
  if (metric.ignoreDateFilter) {
    dateRangeClause = { clause: "", params: [] };
  } else if (metric.id === "avg_cycle_time" && options.dateRange) {
    // Special handling for avg_cycle_time: filter by closing_date OR funding_date
    dateRangeClause = buildDateRangeClauseForCycleTime(
      options.dateRange,
      currentParamIndex - 1
    );
  } else {
    dateRangeClause = buildDateRangeClause(
      options.dateRange,
      dateField,
      currentParamIndex - 1
    );
  }
  currentParamIndex += dateRangeClause.params.length;

  const additionalFiltersClause = options.additionalFilters
    ? buildWhereClause(options.additionalFilters, currentParamIndex - 1)
    : { clause: "", params: [] };

  // Build parameters array in order: userAccess, dateRange, additionalFilters
  const params = [
    ...userAccessParams,
    ...dateRangeClause.params,
    ...additionalFiltersClause.params,
  ];

  // Build query with all filtering
  const query = `
    SELECT 
      ${metric.sqlQuery} as metric_value
    FROM public.loans l
    WHERE 1=1
      ${userAccessClause}
      ${dateRangeClause.clause}
      ${additionalFiltersClause.clause}
  `;

  // Debug logging
  if (process.env.NODE_ENV === "development") {
    console.log(`[MetricsService] Querying ${metricId}:`, {
      dateRange: options.dateRange,
      dateField,
      ignoreDateFilter: metric.ignoreDateFilter,
      dateClause: dateRangeClause.clause,
      additionalFiltersClause: additionalFiltersClause.clause,
      query: query,
      params: params,
    });
  }

  const result = await tenantPool.query(query, params);

  // Additional debug: Check sample values for specific metrics
  if (process.env.NODE_ENV === "development") {
    try {
      if (metricId === "active_loans") {
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
        console.log(
          `[MetricsService] Active loans debug info:`,
          sampleResult.rows[0]
        );
      } else if (metricId === "locked_loans") {
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
        console.log(
          `[MetricsService] Locked loans debug info:`,
          sampleResult.rows[0]
        );
        console.log(`[MetricsService] Full query executed:`, query);
        console.log(`[MetricsService] Query params:`, params);
        console.log(`[MetricsService] Query result:`, result.rows[0]);
      }

      // Debug loan access GUIDs if userAccessFilter is applied
      if (
        options.userAccessFilter &&
        options.userAccessFilter.params.length > 0
      ) {
        const userId = options.userAccessFilter.params[0];
        try {
          // Check loans.guid column
          const guidQuery = `SELECT 
            COUNT(*) as total_loans,
            COUNT(CASE WHEN guid IS NOT NULL THEN 1 END) as loans_with_guid,
            COUNT(CASE WHEN guid IS NULL THEN 1 END) as loans_without_guid,
            (SELECT guid FROM loans WHERE guid IS NOT NULL LIMIT 1) as sample_loan_guid,
            (SELECT loan_id FROM loans WHERE loan_id IS NOT NULL LIMIT 1) as sample_loan_id
          FROM loans`;
          const guidResult = await tenantPool.query(guidQuery);
          console.log(
            `[MetricsService] GUID DEBUG - loans table:`,
            guidResult.rows[0]
          );

          // Check user_loan_access
          const accessQuery = `SELECT 
            COUNT(*) as user_access_count,
            (SELECT loan_guid FROM user_loan_access WHERE user_id = $1 LIMIT 1) as sample_access_guid
          FROM user_loan_access WHERE user_id = $1`;
          const accessResult = await tenantPool.query(accessQuery, [userId]);
          console.log(
            `[MetricsService] GUID DEBUG - user_loan_access:`,
            accessResult.rows[0]
          );

          // Check matching
          const matchQuery = `SELECT COUNT(*) as matching_count
            FROM user_loan_access ula 
            INNER JOIN loans l ON l.guid = ula.loan_guid 
            WHERE ula.user_id = $1`;
          const matchResult = await tenantPool.query(matchQuery, [userId]);
          console.log(
            `[MetricsService] GUID DEBUG - matching loans:`,
            matchResult.rows[0]
          );

          // Check if loan_id matches instead
          const loanIdMatchQuery = `SELECT COUNT(*) as loan_id_matching_count
            FROM user_loan_access ula 
            INNER JOIN loans l ON l.loan_id = ula.loan_guid 
            WHERE ula.user_id = $1`;
          const loanIdMatchResult = await tenantPool.query(loanIdMatchQuery, [
            userId,
          ]);
          console.log(
            `[MetricsService] GUID DEBUG - loan_id matching:`,
            loanIdMatchResult.rows[0]
          );
        } catch (guidErr) {
          console.error(`[MetricsService] GUID DEBUG error:`, guidErr);
        }
      }
    } catch (e) {
      console.error(
        `[MetricsService] Error in debug query for ${metricId}:`,
        e
      );
    }
  }

  const metricValue = result.rows[0]?.metric_value;
  const parsedValue =
    metricValue !== null && metricValue !== undefined
      ? parseFloat(metricValue)
      : 0;

  return {
    metricId,
    value: parsedValue,
    metadata: {
      dateRange: options.dateRange,
      dateField,
      rawValue: metricValue,
      query: process.env.NODE_ENV === "development" ? query : undefined,
    },
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
        console.error(
          `[MetricsService] Error querying metric ${metricId}:`,
          error.message
        );
        // Return zero value on error
        results[metricId] = {
          metricId,
          value: 0,
          metadata: { error: error.message },
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
    .filter((m) => m.category === category)
    .map((m) => m.id);

  return queryMetrics(tenantPool, metricIds, options);
}

/**
 * Get metrics catalog
 */
export function getMetricsCatalog(): MetricDefinition[] {
  return Object.values(METRICS_CATALOG);
}

/**
 * Query a metric grouped by a field (e.g., loan_officer, branch)
 * Returns an array of results with the group key and metric value
 */
export interface GroupedMetricResult {
  groupKey: string;
  value: number | string;
  metadata?: Record<string, any>;
}

export async function queryMetricGroupedBy(
  tenantPool: pg.Pool,
  metricId: string,
  groupBy:
    | "loan_officer"
    | "branch"
    | "processor"
    | "underwriter"
    | "channel"
    | "investor"
    | "loan_type"
    | "loan_purpose"
    | "occupancy_type",
  options: MetricQueryOptions = {}
): Promise<GroupedMetricResult[]> {
  const metric = METRICS_CATALOG[metricId];
  if (!metric) {
    throw new Error(`Metric ${metricId} not found in catalog`);
  }

  // Check for no-access filter
  if (options.userAccessFilter?.sql === "FALSE") {
    return [];
  }

  // Build user access clause first
  let currentParamIndex = 1;
  let userAccessClause = "";
  const userAccessParams: any[] = [];

  if (options.userAccessFilter && options.userAccessFilter.sql !== "FALSE") {
    userAccessClause = `AND ${options.userAccessFilter.sql}`;
    userAccessParams.push(...options.userAccessFilter.params);
    currentParamIndex += options.userAccessFilter.paramOffset;
  }

  const dateField =
    options.dateField || metric.defaultDateField || "application_date";

  // Build date range clause
  let dateRangeClause;
  if (metric.ignoreDateFilter) {
    dateRangeClause = { clause: "", params: [] };
  } else {
    dateRangeClause = buildDateRangeClause(
      options.dateRange,
      dateField,
      currentParamIndex - 1
    );
  }
  currentParamIndex += dateRangeClause.params.length;

  const additionalFiltersClause = options.additionalFilters
    ? buildWhereClause(options.additionalFilters, currentParamIndex - 1)
    : { clause: "", params: [] };

  const params = [
    ...userAccessParams,
    ...dateRangeClause.params,
    ...additionalFiltersClause.params,
  ];

  // Validate groupBy field
  const allowedGroupByFields = [
    "loan_officer",
    "branch",
    "processor",
    "underwriter",
    "channel",
    "investor",
    "loan_type",
    "loan_purpose",
    "occupancy_type",
    "account_executive", // Added for TPO channel support
  ];
  if (!allowedGroupByFields.includes(groupBy)) {
    throw new Error(
      `Invalid groupBy field: ${groupBy}. Allowed: ${allowedGroupByFields.join(
        ", "
      )}`
    );
  }

  // Channel-aware actor column: for TPO channels, use account_executive instead of loan_officer
  const channelGroup = options.additionalFilters?.consolidated_channel as
    | string
    | undefined;
  let effectiveGroupBy = groupBy;
  if (groupBy === "loan_officer") {
    effectiveGroupBy = getActorColumnForChannel(channelGroup) as typeof groupBy;
  }

  // Build query with GROUP BY
  const query = `
    SELECT 
      l.${effectiveGroupBy} as group_key,
      ${metric.sqlQuery} as metric_value,
      COUNT(*) as count
    FROM public.loans l
    WHERE l.${effectiveGroupBy} IS NOT NULL 
      AND TRIM(l.${effectiveGroupBy}::text) != ''
      ${userAccessClause}
      ${dateRangeClause.clause}
      ${additionalFiltersClause.clause}
    GROUP BY l.${effectiveGroupBy}
    ORDER BY ${metric.sqlQuery} DESC NULLS LAST
  `;

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[MetricsService] Querying ${metricId} grouped by ${effectiveGroupBy}${
        effectiveGroupBy !== groupBy
          ? ` (requested: ${groupBy}, channel: ${channelGroup})`
          : ""
      }:`,
      {
        query,
        params,
      }
    );
  }

  const result = await tenantPool.query(query, params);

  return result.rows.map((row) => ({
    groupKey: row.group_key,
    value: parseFloat(row.metric_value) || 0,
    metadata: {
      count: parseInt(row.count) || 0,
    },
  }));
}

/**
 * Query multiple metrics grouped by a field
 * Returns metrics organized by metric ID, each containing array of grouped results
 */
export async function queryMetricsGroupedBy(
  tenantPool: pg.Pool,
  metricIds: string[],
  groupBy:
    | "loan_officer"
    | "branch"
    | "processor"
    | "underwriter"
    | "channel"
    | "investor"
    | "loan_type"
    | "loan_purpose"
    | "occupancy_type",
  options: MetricQueryOptions = {}
): Promise<Record<string, GroupedMetricResult[]>> {
  const results: Record<string, GroupedMetricResult[]> = {};

  // Query each metric in parallel
  await Promise.all(
    metricIds.map(async (metricId) => {
      try {
        results[metricId] = await queryMetricGroupedBy(
          tenantPool,
          metricId,
          groupBy,
          options
        );
      } catch (error: any) {
        console.error(
          `[MetricsService] Error querying grouped metric ${metricId}:`,
          error.message
        );
        results[metricId] = [];
      }
    })
  );

  return results;
}

/**
 * Get distinct values for a field (for filter dropdowns)
 */
export async function getDistinctFieldValues(
  tenantPool: pg.Pool,
  field:
    | "loan_officer"
    | "branch"
    | "processor"
    | "underwriter"
    | "channel"
    | "investor"
    | "loan_type"
    | "current_loan_status"
): Promise<string[]> {
  const allowedFields = [
    "loan_officer",
    "branch",
    "processor",
    "underwriter",
    "channel",
    "investor",
    "loan_type",
    "current_loan_status",
  ];

  if (!allowedFields.includes(field)) {
    throw new Error(
      `Invalid field: ${field}. Allowed: ${allowedFields.join(", ")}`
    );
  }

  const result = await tenantPool.query(`
    SELECT DISTINCT ${field}
    FROM public.loans
    WHERE ${field} IS NOT NULL AND TRIM(${field}::text) != ''
    ORDER BY ${field}
    LIMIT 100
  `);

  return result.rows.map((row) => row[field]);
}

// ============ Credit Risk Distribution Functions ============
// These functions return bucketed distributions for FICO, LTV, and DTI scores
// Matching Qlik Credit Risk Management sheet logic

export interface DistributionBucket {
  range: string;
  rangeLabel: string;
  units: number;
  volume: number;
  percentage: number;
  sortOrder: number;
}

// Helper to build all filter clauses with proper parameter ordering
function buildAllFilterClauses(
  options: MetricQueryOptions,
  dateField: string
): {
  userAccessClause: string;
  dateRangeClause: { clause: string; params: any[] };
  additionalFiltersClause: { clause: string; params: any[] };
  allParams: any[];
} {
  let currentParamIndex = 1;
  let userAccessClause = "";
  const userAccessParams: any[] = [];

  // Build user access clause first
  if (options.userAccessFilter && options.userAccessFilter.sql !== "FALSE") {
    userAccessClause = `AND ${options.userAccessFilter.sql}`;
    userAccessParams.push(...options.userAccessFilter.params);
    currentParamIndex += options.userAccessFilter.paramOffset;
  }

  // Build date range clause
  const dateRangeClause = buildDateRangeClause(
    options.dateRange,
    dateField,
    currentParamIndex - 1
  );
  currentParamIndex += dateRangeClause.params.length;

  // Build additional filters clause
  const additionalFiltersClause = options.additionalFilters
    ? buildWhereClause(options.additionalFilters, currentParamIndex - 1)
    : { clause: "", params: [] };

  return {
    userAccessClause,
    dateRangeClause,
    additionalFiltersClause,
    allParams: [
      ...userAccessParams,
      ...dateRangeClause.params,
      ...additionalFiltersClause.params,
    ],
  };
}

/**
 * Query FICO distribution with bucketed ranges
 * Matches reference app: 800-850, 750-799, 680-719, 620-679, 580-619, <580
 * Ordered from HIGH to LOW FICO (descending)
 */
export async function queryFicoDistribution(
  tenantPool: pg.Pool,
  options: MetricQueryOptions = {}
): Promise<DistributionBucket[]> {
  // Check for no-access filter
  if (options.userAccessFilter?.sql === "FALSE") {
    return [];
  }

  const dateField = options.dateField || "application_date";
  const {
    userAccessClause,
    dateRangeClause,
    additionalFiltersClause,
    allParams,
  } = buildAllFilterClauses(options, dateField);

  // FICO ranges ordered from HIGH to LOW (descending) to match reference app
  const query = `
    WITH fico_buckets AS (
      SELECT 
        CASE
          WHEN l.fico_score IS NULL OR l.fico_score < 350 THEN 'Missing/Invalid'
          WHEN l.fico_score >= 800 THEN '800-850'
          WHEN l.fico_score >= 750 THEN '750-799'
          WHEN l.fico_score >= 680 THEN '680-749'
          WHEN l.fico_score >= 620 THEN '620-679'
          WHEN l.fico_score >= 580 THEN '580-619'
          ELSE '<580'
        END as range,
        CASE
          WHEN l.fico_score IS NULL OR l.fico_score < 350 THEN 99
          WHEN l.fico_score >= 800 THEN 1
          WHEN l.fico_score >= 750 THEN 2
          WHEN l.fico_score >= 680 THEN 3
          WHEN l.fico_score >= 620 THEN 4
          WHEN l.fico_score >= 580 THEN 5
          ELSE 6
        END as sort_order,
        l.loan_amount
      FROM public.loans l
      WHERE 1=1 
        ${userAccessClause}
        ${dateRangeClause.clause}
        ${additionalFiltersClause.clause}
    ),
    totals AS (
      SELECT COUNT(*) as total_units FROM fico_buckets WHERE range != 'Missing/Invalid'
    )
    SELECT 
      fb.range,
      fb.range as range_label,
      COUNT(*) as units,
      COALESCE(SUM(fb.loan_amount), 0) as volume,
      ROUND(COUNT(*) * 100.0 / NULLIF((SELECT total_units FROM totals), 0), 1) as percentage,
      MIN(fb.sort_order) as sort_order
    FROM fico_buckets fb
    WHERE fb.range != 'Missing/Invalid'
    GROUP BY fb.range
    ORDER BY MIN(fb.sort_order)
  `;

  const result = await tenantPool.query(query, allParams);

  return result.rows.map((row) => ({
    range: row.range,
    rangeLabel: row.range_label,
    units: parseInt(row.units) || 0,
    volume: parseFloat(row.volume) || 0,
    percentage: parseFloat(row.percentage) || 0,
    sortOrder: parseInt(row.sort_order) || 0,
  }));
}

/**
 * Query LTV distribution with bucketed ranges
 * Qlik LTV buckets: 0-Values, 0.01-60, 60.01-75, 75.01-80, 80.01-90, 90.01-100, >100
 */
export async function queryLtvDistribution(
  tenantPool: pg.Pool,
  options: MetricQueryOptions = {}
): Promise<DistributionBucket[]> {
  // Check for no-access filter
  if (options.userAccessFilter?.sql === "FALSE") {
    return [];
  }

  const dateField = options.dateField || "application_date";
  const {
    userAccessClause,
    dateRangeClause,
    additionalFiltersClause,
    allParams,
  } = buildAllFilterClauses(options, dateField);

  const query = `
    WITH ltv_buckets AS (
      SELECT 
        CASE
          WHEN l.ltv_ratio IS NULL OR l.ltv_ratio <= 0 THEN '0-Values'
          WHEN l.ltv_ratio <= 60 THEN '0.01-60.00'
          WHEN l.ltv_ratio <= 75 THEN '60.01-75.00'
          WHEN l.ltv_ratio <= 80 THEN '75.01-80.00'
          WHEN l.ltv_ratio <= 90 THEN '80.01-90.00'
          WHEN l.ltv_ratio <= 100 THEN '90.01-100.00'
          ELSE '>100'
        END as range,
        CASE
          WHEN l.ltv_ratio IS NULL OR l.ltv_ratio <= 0 THEN 0
          WHEN l.ltv_ratio <= 60 THEN 1
          WHEN l.ltv_ratio <= 75 THEN 2
          WHEN l.ltv_ratio <= 80 THEN 3
          WHEN l.ltv_ratio <= 90 THEN 4
          WHEN l.ltv_ratio <= 100 THEN 5
          ELSE 6
        END as sort_order,
        l.loan_amount
      FROM public.loans l
      WHERE 1=1 
        ${userAccessClause}
        ${dateRangeClause.clause}
        ${additionalFiltersClause.clause}
    ),
    totals AS (
      SELECT COUNT(*) as total_units FROM ltv_buckets
    )
    SELECT 
      lb.range,
      lb.range as range_label,
      COUNT(*) as units,
      COALESCE(SUM(lb.loan_amount), 0) as volume,
      ROUND(COUNT(*) * 100.0 / NULLIF((SELECT total_units FROM totals), 0), 1) as percentage,
      MIN(lb.sort_order) as sort_order
    FROM ltv_buckets lb
    GROUP BY lb.range
    ORDER BY MIN(lb.sort_order)
  `;

  const result = await tenantPool.query(query, allParams);

  return result.rows.map((row) => ({
    range: row.range,
    rangeLabel: row.range_label,
    units: parseInt(row.units) || 0,
    volume: parseFloat(row.volume) || 0,
    percentage: parseFloat(row.percentage) || 0,
    sortOrder: parseInt(row.sort_order) || 0,
  }));
}

/**
 * Query DTI distribution with bucketed ranges
 * Qlik DTI buckets: <=0, 0.01-28, 28.01-36, 36.01-43, 43.01-50, >50
 */
export async function queryDtiDistribution(
  tenantPool: pg.Pool,
  options: MetricQueryOptions = {}
): Promise<DistributionBucket[]> {
  // Check for no-access filter
  if (options.userAccessFilter?.sql === "FALSE") {
    return [];
  }

  const dateField = options.dateField || "application_date";
  const {
    userAccessClause,
    dateRangeClause,
    additionalFiltersClause,
    allParams,
  } = buildAllFilterClauses(options, dateField);

  const query = `
    WITH dti_buckets AS (
      SELECT 
        CASE
          WHEN l.be_dti_ratio IS NULL OR l.be_dti_ratio <= 0 THEN 'Values<=0'
          WHEN l.be_dti_ratio <= 28 THEN '0.01-28.00'
          WHEN l.be_dti_ratio <= 36 THEN '28.01-36.00'
          WHEN l.be_dti_ratio <= 43 THEN '36.01-43.00'
          WHEN l.be_dti_ratio <= 50 THEN '43.01-50.00'
          ELSE '>50.00'
        END as range,
        CASE
          WHEN l.be_dti_ratio IS NULL OR l.be_dti_ratio <= 0 THEN 0
          WHEN l.be_dti_ratio <= 28 THEN 1
          WHEN l.be_dti_ratio <= 36 THEN 2
          WHEN l.be_dti_ratio <= 43 THEN 3
          WHEN l.be_dti_ratio <= 50 THEN 4
          ELSE 5
        END as sort_order,
        l.loan_amount
      FROM public.loans l
      WHERE 1=1 
        ${userAccessClause}
        ${dateRangeClause.clause}
        ${additionalFiltersClause.clause}
    ),
    totals AS (
      SELECT COUNT(*) as total_units FROM dti_buckets
    )
    SELECT 
      db.range,
      db.range as range_label,
      COUNT(*) as units,
      COALESCE(SUM(db.loan_amount), 0) as volume,
      ROUND(COUNT(*) * 100.0 / NULLIF((SELECT total_units FROM totals), 0), 1) as percentage,
      MIN(db.sort_order) as sort_order
    FROM dti_buckets db
    GROUP BY db.range
    ORDER BY MIN(db.sort_order)
  `;

  const result = await tenantPool.query(query, allParams);

  return result.rows.map((row) => ({
    range: row.range,
    rangeLabel: row.range_label,
    units: parseInt(row.units) || 0,
    volume: parseFloat(row.volume) || 0,
    percentage: parseFloat(row.percentage) || 0,
    sortOrder: parseInt(row.sort_order) || 0,
  }));
}

/**
 * Extended Distribution Bucket with weighted averages (for loan size, lock expiration)
 */
export interface ExtendedDistributionBucket extends DistributionBucket {
  wac: number;
  waFico: number;
  waLtv: number;
}

/**
 * Query Loan Size Distribution
 * Buckets: <$200K, $200K-$400K, $400K-$600K, $600K-$800K, $800K-$1M, >$1M
 * Includes weighted averages: WAC, WA FICO, WA LTV
 */
export async function queryLoanSizeDistribution(
  tenantPool: pg.Pool,
  options: MetricQueryOptions = {}
): Promise<ExtendedDistributionBucket[]> {
  // Check for no-access filter
  if (options.userAccessFilter?.sql === "FALSE") {
    return [];
  }

  const dateField = options.dateField || "application_date";
  const {
    userAccessClause,
    dateRangeClause,
    additionalFiltersClause,
    allParams,
  } = buildAllFilterClauses(options, dateField);

  const query = `
    WITH size_buckets AS (
      SELECT 
        CASE 
          WHEN l.loan_amount < 200000 THEN '<$200K'
          WHEN l.loan_amount < 400000 THEN '$200K-$400K'
          WHEN l.loan_amount < 600000 THEN '$400K-$600K'
          WHEN l.loan_amount < 800000 THEN '$600K-$800K'
          WHEN l.loan_amount < 1000000 THEN '$800K-$1M'
          ELSE '>$1M'
        END as range,
        CASE 
          WHEN l.loan_amount < 200000 THEN 1
          WHEN l.loan_amount < 400000 THEN 2
          WHEN l.loan_amount < 600000 THEN 3
          WHEN l.loan_amount < 800000 THEN 4
          WHEN l.loan_amount < 1000000 THEN 5
          ELSE 6
        END as sort_order,
        l.loan_amount,
        l.interest_rate,
        l.fico_score,
        l.ltv_ratio
      FROM public.loans l
      WHERE l.loan_amount IS NOT NULL AND l.loan_amount > 0
        ${userAccessClause}
        ${dateRangeClause.clause}
        ${additionalFiltersClause.clause}
    ),
    totals AS (
      SELECT COUNT(*) as total_units FROM size_buckets
    )
    SELECT 
      sb.range,
      sb.range as range_label,
      COUNT(*) as units,
      COALESCE(SUM(sb.loan_amount), 0) as volume,
      ROUND(COUNT(*) * 100.0 / NULLIF((SELECT total_units FROM totals), 0), 1) as percentage,
      MIN(sb.sort_order) as sort_order,
      -- WAC: weighted average interest rate (exclude out of range: <= 0 or > 15)
      ROUND(
        SUM(CASE WHEN sb.interest_rate > 0 AND sb.interest_rate <= 15 THEN sb.interest_rate * sb.loan_amount ELSE 0 END) /
        NULLIF(SUM(CASE WHEN sb.interest_rate > 0 AND sb.interest_rate <= 15 THEN sb.loan_amount ELSE 0 END), 0)
      , 3) as wac,
      -- WA FICO: weighted average FICO (exclude out of range: < 350 or > 900)
      ROUND(
        SUM(CASE WHEN sb.fico_score >= 350 AND sb.fico_score <= 900 THEN sb.fico_score * sb.loan_amount ELSE 0 END) /
        NULLIF(SUM(CASE WHEN sb.fico_score >= 350 AND sb.fico_score <= 900 THEN sb.loan_amount ELSE 0 END), 0)
      , 0) as wa_fico,
      -- WA LTV: weighted average LTV (exclude out of range: < 0 or > 110)
      ROUND(
        SUM(CASE WHEN sb.ltv_ratio >= 0 AND sb.ltv_ratio <= 110 THEN sb.ltv_ratio * sb.loan_amount ELSE 0 END) /
        NULLIF(SUM(CASE WHEN sb.ltv_ratio >= 0 AND sb.ltv_ratio <= 110 THEN sb.loan_amount ELSE 0 END), 0)
      , 1) as wa_ltv
    FROM size_buckets sb
    GROUP BY sb.range
    ORDER BY MIN(sb.sort_order)
  `;

  const result = await tenantPool.query(query, allParams);

  return result.rows.map((row) => ({
    range: row.range,
    rangeLabel: row.range_label,
    units: parseInt(row.units) || 0,
    volume: parseFloat(row.volume) || 0,
    percentage: parseFloat(row.percentage) || 0,
    sortOrder: parseInt(row.sort_order) || 0,
    wac: parseFloat(row.wac) || 0,
    waFico: parseFloat(row.wa_fico) || 0,
    waLtv: parseFloat(row.wa_ltv) || 0,
  }));
}

/**
 * Query Lock Expiration Days Distribution
 * Buckets: Expired, 0-7 days, 8-14 days, 15-30 days, >30 days
 * Only for locked loans (lock_date IS NOT NULL)
 * Includes weighted averages: WAC, WA FICO, WA LTV
 */
export async function queryLockExpirationDistribution(
  tenantPool: pg.Pool,
  options: MetricQueryOptions = {}
): Promise<ExtendedDistributionBucket[]> {
  // Check for no-access filter
  if (options.userAccessFilter?.sql === "FALSE") {
    return [];
  }

  const dateField = options.dateField || "lock_date";
  const {
    userAccessClause,
    dateRangeClause,
    additionalFiltersClause,
    allParams,
  } = buildAllFilterClauses(options, dateField);

  const query = `
    WITH expiration_buckets AS (
      SELECT 
        CASE 
          WHEN l.lock_expiration_date < CURRENT_DATE THEN 'Expired'
          WHEN l.lock_expiration_date <= CURRENT_DATE + INTERVAL '7 days' THEN '0-7 days'
          WHEN l.lock_expiration_date <= CURRENT_DATE + INTERVAL '14 days' THEN '8-14 days'
          WHEN l.lock_expiration_date <= CURRENT_DATE + INTERVAL '30 days' THEN '15-30 days'
          ELSE '>30 days'
        END as range,
        CASE 
          WHEN l.lock_expiration_date < CURRENT_DATE THEN 1
          WHEN l.lock_expiration_date <= CURRENT_DATE + INTERVAL '7 days' THEN 2
          WHEN l.lock_expiration_date <= CURRENT_DATE + INTERVAL '14 days' THEN 3
          WHEN l.lock_expiration_date <= CURRENT_DATE + INTERVAL '30 days' THEN 4
          ELSE 5
        END as sort_order,
        l.loan_amount,
        l.interest_rate,
        l.fico_score,
        l.ltv_ratio
      FROM public.loans l
      WHERE l.lock_date IS NOT NULL 
        AND l.lock_expiration_date IS NOT NULL
        ${userAccessClause}
        ${dateRangeClause.clause}
        ${additionalFiltersClause.clause}
    ),
    totals AS (
      SELECT COUNT(*) as total_units FROM expiration_buckets
    )
    SELECT 
      eb.range,
      eb.range as range_label,
      COUNT(*) as units,
      COALESCE(SUM(eb.loan_amount), 0) as volume,
      ROUND(COUNT(*) * 100.0 / NULLIF((SELECT total_units FROM totals), 0), 1) as percentage,
      MIN(eb.sort_order) as sort_order,
      -- WAC: weighted average interest rate (exclude out of range: <= 0 or > 15)
      ROUND(
        SUM(CASE WHEN eb.interest_rate > 0 AND eb.interest_rate <= 15 THEN eb.interest_rate * eb.loan_amount ELSE 0 END) /
        NULLIF(SUM(CASE WHEN eb.interest_rate > 0 AND eb.interest_rate <= 15 THEN eb.loan_amount ELSE 0 END), 0)
      , 3) as wac,
      -- WA FICO: weighted average FICO (exclude out of range: < 350 or > 900)
      ROUND(
        SUM(CASE WHEN eb.fico_score >= 350 AND eb.fico_score <= 900 THEN eb.fico_score * eb.loan_amount ELSE 0 END) /
        NULLIF(SUM(CASE WHEN eb.fico_score >= 350 AND eb.fico_score <= 900 THEN eb.loan_amount ELSE 0 END), 0)
      , 0) as wa_fico,
      -- WA LTV: weighted average LTV (exclude out of range: < 0 or > 110)
      ROUND(
        SUM(CASE WHEN eb.ltv_ratio >= 0 AND eb.ltv_ratio <= 110 THEN eb.ltv_ratio * eb.loan_amount ELSE 0 END) /
        NULLIF(SUM(CASE WHEN eb.ltv_ratio >= 0 AND eb.ltv_ratio <= 110 THEN eb.loan_amount ELSE 0 END), 0)
      , 1) as wa_ltv
    FROM expiration_buckets eb
    GROUP BY eb.range
    ORDER BY MIN(eb.sort_order)
  `;

  const result = await tenantPool.query(query, allParams);

  return result.rows.map((row) => ({
    range: row.range,
    rangeLabel: row.range_label,
    units: parseInt(row.units) || 0,
    volume: parseFloat(row.volume) || 0,
    percentage: parseFloat(row.percentage) || 0,
    sortOrder: parseInt(row.sort_order) || 0,
    wac: parseFloat(row.wac) || 0,
    waFico: parseFloat(row.wa_fico) || 0,
    waLtv: parseFloat(row.wa_ltv) || 0,
  }));
}

/**
 * Query Loan Mix data grouped by a dimension (loan_type, loan_purpose, or occupancy_type)
 * Returns units, volume, WAC, WA FICO, WA LTV, WA DTI for each category
 */
export interface LoanMixRow {
  category: string;
  units: number;
  unitsPercent: number;
  volume: number;
  volumePercent: number;
  wac: number;
  waFico: number;
  waLtv: number;
  waDti: number;
}

export async function queryLoanMix(
  tenantPool: pg.Pool,
  groupBy:
    | "loan_type"
    | "loan_purpose"
    | "occupancy_type"
    | "current_milestone",
  options: MetricQueryOptions = {}
): Promise<LoanMixRow[]> {
  // Check for no-access filter
  if (options.userAccessFilter?.sql === "FALSE") {
    return [];
  }

  const dateField = options.dateField || "application_date";
  const {
    userAccessClause,
    dateRangeClause,
    additionalFiltersClause,
    allParams,
  } = buildAllFilterClauses(options, dateField);

  // Validate groupBy field
  const allowedGroupByFields = [
    "loan_type",
    "loan_purpose",
    "occupancy_type",
    "current_milestone",
  ];
  if (!allowedGroupByFields.includes(groupBy)) {
    throw new Error(
      `Invalid groupBy field for Loan Mix: ${groupBy}. Allowed: ${allowedGroupByFields.join(
        ", "
      )}`
    );
  }

  // Qlik's total[Loan Amount] sums across all dimension values (excluding NULLs)
  // The denominator is the sum of all loans with non-NULL groupBy field
  const query = `
    WITH loan_data AS (
      SELECT 
        COALESCE(NULLIF(TRIM(l.${groupBy}::text), ''), 'Other') as category,
        l.loan_amount,
        l.interest_rate,
        l.fico_score,
        l.ltv_ratio,
        l.be_dti_ratio
      FROM public.loans l
      WHERE l.${groupBy} IS NOT NULL 
        ${userAccessClause}
        ${dateRangeClause.clause}
        ${additionalFiltersClause.clause}
    ),
    totals AS (
      SELECT 
        COUNT(*) as total_units,
        COALESCE(SUM(loan_amount), 0) as total_volume
      FROM loan_data
    )
    SELECT 
      ld.category,
      COUNT(*) as units,
      ROUND(COUNT(*) * 100.0 / NULLIF((SELECT total_units FROM totals), 0), 1) as units_percent,
      COALESCE(SUM(ld.loan_amount), 0) as volume,
      ROUND(COALESCE(SUM(ld.loan_amount), 0) * 100.0 / NULLIF((SELECT total_volume FROM totals), 0), 1) as volume_percent,
      -- WAC: weighted average interest rate (exclude out of range: <= 0 or > 15)
      ROUND(
        SUM(CASE WHEN ld.interest_rate > 0 AND ld.interest_rate <= 15 THEN ld.interest_rate * ld.loan_amount ELSE 0 END) / 
        NULLIF(SUM(CASE WHEN ld.interest_rate > 0 AND ld.interest_rate <= 15 THEN ld.loan_amount ELSE 0 END), 0)
      , 3) as wac,
      -- WA FICO: weighted average FICO (exclude out of range: < 350 or > 900)
      ROUND(
        SUM(CASE WHEN ld.fico_score >= 350 AND ld.fico_score <= 900 THEN ld.fico_score * ld.loan_amount ELSE 0 END) / 
        NULLIF(SUM(CASE WHEN ld.fico_score >= 350 AND ld.fico_score <= 900 THEN ld.loan_amount ELSE 0 END), 0)
      , 0) as wa_fico,
      -- WA LTV: weighted average LTV (exclude out of range: < 0 or > 110)
      ROUND(
        SUM(CASE WHEN ld.ltv_ratio >= 0 AND ld.ltv_ratio <= 110 THEN ld.ltv_ratio * ld.loan_amount ELSE 0 END) / 
        NULLIF(SUM(CASE WHEN ld.ltv_ratio >= 0 AND ld.ltv_ratio <= 110 THEN ld.loan_amount ELSE 0 END), 0)
      , 1) as wa_ltv,
      -- WA DTI: weighted average DTI (exclude out of range: < 0 or > 70)
      ROUND(
        SUM(CASE WHEN ld.be_dti_ratio >= 0 AND ld.be_dti_ratio <= 70 THEN ld.be_dti_ratio * ld.loan_amount ELSE 0 END) / 
        NULLIF(SUM(CASE WHEN ld.be_dti_ratio >= 0 AND ld.be_dti_ratio <= 70 THEN ld.loan_amount ELSE 0 END), 0)
      , 1) as wa_dti
    FROM loan_data ld
    GROUP BY ld.category
    ORDER BY SUM(ld.loan_amount) DESC NULLS LAST
  `;

  const result = await tenantPool.query(query, allParams);

  return result.rows.map((row) => ({
    category: row.category,
    units: parseInt(row.units) || 0,
    unitsPercent: parseFloat(row.units_percent) || 0,
    volume: parseFloat(row.volume) || 0,
    volumePercent: parseFloat(row.volume_percent) || 0,
    wac: parseFloat(row.wac) || 0,
    waFico: parseInt(row.wa_fico) || 0,
    waLtv: parseFloat(row.wa_ltv) || 0,
    waDti: parseFloat(row.wa_dti) || 0,
  }));
}

/**
 * Credit Risk Story Data
 * Calculates the story metrics for the Credit Risk Management page
 * Matches Qlik Performance app logic
 *
 * ⚠️ IMPORTANT: Qlik uses VOLUME (Sum of Loan Amount) NOT COUNT for all story percentages!
 * See CREDIT_RISK_MANAGEMENT_DATA_QUESTIONS.md Section 3 for details.
 */
export interface CreditRiskStoryData {
  // Largest categories - use volumePercent to match Qlik
  largestLoanType: { category: string; volumePercent: number };
  largestLoanPurpose: { category: string; volumePercent: number };
  largestOccupancy: { category: string; volumePercent: number };
  // Qualified loan percentages (volume-based)
  conventionalQualifiedPercent: number; // FICO > 680, DTI < 43, LTV < 80
  governmentQualifiedPercent: number; // FICO > 620, DTI < 50, LTV < 100
}

export async function queryCreditRiskStory(
  tenantPool: pg.Pool,
  options: MetricQueryOptions = {}
): Promise<CreditRiskStoryData> {
  // Check for no-access filter
  if (options.userAccessFilter?.sql === "FALSE") {
    return {
      largestLoanType: { category: "", volumePercent: 0 },
      largestLoanPurpose: { category: "", volumePercent: 0 },
      largestOccupancy: { category: "", volumePercent: 0 },
      conventionalQualifiedPercent: 0,
      governmentQualifiedPercent: 0,
    };
  }

  const dateField = options.dateField || "application_date";
  const {
    userAccessClause,
    dateRangeClause,
    additionalFiltersClause,
    allParams,
  } = buildAllFilterClauses(options, dateField);

  // Query for qualified loan percentages - VOLUME BASED (matches Qlik)
  // Qlik uses [Loan Type Group] with pattern matching: *Conv* for Conventional, *Gov* for Government
  // Conventional: FICO > 680, DTI < 43, LTV < 80
  // Government (FHA, VA, USDA): FICO > 620, DTI < 50, LTV < 100
  const qualifiedQuery = `
    WITH filtered_loans AS (
      SELECT 
        l.loan_type,
        l.fico_score,
        l.be_dti_ratio,
        l.ltv_ratio,
        l.loan_amount
      FROM public.loans l
      WHERE 1=1
        ${userAccessClause}
        ${dateRangeClause.clause}
        ${additionalFiltersClause.clause}
    ),
    conventional_stats AS (
      SELECT 
        COALESCE(SUM(loan_amount), 0) as total_conventional_volume,
        COALESCE(SUM(CASE 
          WHEN fico_score > 680 AND be_dti_ratio < 43 AND ltv_ratio < 80 
          THEN loan_amount 
        END), 0) as qualified_conventional_volume
      FROM filtered_loans
      WHERE UPPER(loan_type) LIKE '%CONV%' OR UPPER(loan_type) = 'CONVENTIONAL'
    ),
    government_stats AS (
      SELECT 
        COALESCE(SUM(loan_amount), 0) as total_government_volume,
        COALESCE(SUM(CASE 
          WHEN fico_score > 620 AND be_dti_ratio < 50 AND ltv_ratio < 100 
          THEN loan_amount 
        END), 0) as qualified_government_volume
      FROM filtered_loans
      WHERE UPPER(loan_type) IN ('FHA', 'VA', 'USDA')
        OR UPPER(loan_type) LIKE '%GOV%'
        OR UPPER(loan_type) LIKE '%FHA%'
        OR UPPER(loan_type) LIKE '%VA %'
        OR UPPER(loan_type) LIKE '%USDA%'
    )
    SELECT 
      ROUND(
        COALESCE(cs.qualified_conventional_volume * 100.0 / NULLIF(cs.total_conventional_volume, 0), 0), 
        0
      ) as conventional_qualified_pct,
      ROUND(
        COALESCE(gs.qualified_government_volume * 100.0 / NULLIF(gs.total_government_volume, 0), 0), 
        0
      ) as government_qualified_pct
    FROM conventional_stats cs, government_stats gs
  `;

  const result = await tenantPool.query(qualifiedQuery, allParams);

  const conventionalQualifiedPercent =
    parseFloat(result.rows[0]?.conventional_qualified_pct) || 0;
  const governmentQualifiedPercent =
    parseFloat(result.rows[0]?.government_qualified_pct) || 0;

  return {
    largestLoanType: { category: "", volumePercent: 0 }, // Will be populated from loan mix
    largestLoanPurpose: { category: "", volumePercent: 0 },
    largestOccupancy: { category: "", volumePercent: 0 },
    conventionalQualifiedPercent,
    governmentQualifiedPercent,
  };
}

// ============================================================================
// Scorecard Actor-Grouped Queries
// ============================================================================
// These functions provide optimized SQL-based aggregation for scorecard endpoints,
// replacing the pattern of fetching all loans and filtering in JavaScript.

import {
  buildChannelWhereClause,
  buildActorNotMissingClause,
  REVENUE_SQL_EXPRESSION,
  getTenantRevenueExpression,
  type ActorConfig,
} from "../../utils/scorecard-utils.js";

/**
 * Actor metrics result from grouped query.
 */
export interface ActorMetricsResult {
  actorName: string;
  units: number;
  volume: number;
  revenue: number;
  avgTurnTime: number | null;
  waFico: number | null;
  waLtv: number | null;
  waDti: number | null;
  governmentCount: number;
  purchaseCount: number;
  approvedCount: number;
  deniedCount: number;
}

/**
 * Options for actor metrics query.
 */
export interface ActorMetricsQueryOptions {
  dateRange: DateRange;
  channelGroup?: string;
  actorMissingMode?: "strict" | "extended";
  /** User-level loan access filter */
  userAccessFilter?: LoanAccessFilter | null;
}

/**
 * Query actor metrics with SQL-level aggregation.
 * This replaces the pattern of fetching all loans and filtering in JavaScript.
 *
 * @param tenantPool - Tenant database connection pool
 * @param actorConfig - Configuration for the actor type
 * @param options - Query options including date range and channel filter
 * @returns Array of actor metrics, one per actor
 */
export async function queryActorMetrics(
  tenantPool: pg.Pool,
  actorConfig: ActorConfig,
  options: ActorMetricsQueryOptions
): Promise<ActorMetricsResult[]> {
  // Check for no-access filter
  if (options.userAccessFilter?.sql === "FALSE") {
    return [];
  }

  const { actorColumn, outputDateField, turnTimeStartField, turnTimeEndField } =
    actorConfig;
  const { dateRange, channelGroup, actorMissingMode = "extended" } = options;

  const channelClause = buildChannelWhereClause(channelGroup);
  const actorNotMissingClause = buildActorNotMissingClause(
    actorColumn,
    actorMissingMode
  );

  // Get tenant-specific revenue expression (or default if none configured)
  const revenueExpression = await getTenantRevenueExpression(tenantPool);

  // Build params array with user access filter first
  const params: any[] = [];
  let paramIndex = 1;

  // User access clause
  let userAccessClause = "";
  if (options.userAccessFilter && options.userAccessFilter.sql !== "FALSE") {
    userAccessClause = `AND ${options.userAccessFilter.sql.replace(
      /\$1/g,
      `$${paramIndex}`
    )}`;
    params.push(...options.userAccessFilter.params);
    paramIndex += options.userAccessFilter.paramOffset;
  }

  // Build date range clause with correct param indices
  let dateClause = "";
  if (dateRange.start && dateRange.end) {
    dateClause = `AND ${outputDateField} >= $${paramIndex} AND ${outputDateField} < $${
      paramIndex + 1
    }`;
    params.push(dateRange.start, dateRange.end);
  } else if (dateRange.start) {
    dateClause = `AND ${outputDateField} >= $${paramIndex}`;
    params.push(dateRange.start);
  } else if (dateRange.end) {
    dateClause = `AND ${outputDateField} < $${paramIndex}`;
    params.push(dateRange.end);
  }

  const query = `
    SELECT 
      ${actorColumn} as actor_name,
      COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) as units,
      COALESCE(SUM(loan_amount), 0) as volume,
      COALESCE(SUM(${revenueExpression}), 0) as revenue,
      AVG(
        CASE 
          WHEN ${turnTimeEndField} IS NOT NULL AND ${turnTimeStartField} IS NOT NULL 
               AND DATE(${turnTimeEndField}) > DATE(${turnTimeStartField})
          THEN DATE(${turnTimeEndField}) - DATE(${turnTimeStartField})
          ELSE NULL
        END
      ) as avg_turn_time,
      -- Weighted averages (exclude out-of-range values)
      ROUND(
        SUM(CASE WHEN fico_score >= 350 AND fico_score <= 900 THEN fico_score * loan_amount ELSE 0 END) / 
        NULLIF(SUM(CASE WHEN fico_score >= 350 AND fico_score <= 900 THEN loan_amount ELSE 0 END), 0)
      , 0) as wa_fico,
      ROUND(
        SUM(CASE WHEN ltv_ratio >= 0 AND ltv_ratio <= 110 THEN ltv_ratio * loan_amount ELSE 0 END) / 
        NULLIF(SUM(CASE WHEN ltv_ratio >= 0 AND ltv_ratio <= 110 THEN loan_amount ELSE 0 END), 0)
      , 1) as wa_ltv,
      ROUND(
        SUM(CASE WHEN be_dti_ratio >= 0 AND be_dti_ratio <= 70 THEN be_dti_ratio * loan_amount ELSE 0 END) / 
        NULLIF(SUM(CASE WHEN be_dti_ratio >= 0 AND be_dti_ratio <= 70 THEN loan_amount ELSE 0 END), 0)
      , 1) as wa_dti,
      -- Loan type counts
      COUNT(CASE WHEN UPPER(loan_type) IN ('FHA', 'VA', 'USDA', 'FARMERSHOMEA') THEN 1 END) as government_count,
      COUNT(CASE WHEN UPPER(loan_purpose) = 'PURCHASE' THEN 1 END) as purchase_count,
      -- Status counts (for underwriter metrics)
      COUNT(CASE WHEN UPPER(current_loan_status) LIKE '%APPROVED%' OR UPPER(current_loan_status) LIKE '%ORIGINATED%' THEN 1 END) as approved_count,
      COUNT(CASE WHEN UPPER(current_loan_status) LIKE '%DENIED%' THEN 1 END) as denied_count
    FROM public.loans
    WHERE ${actorNotMissingClause}
      ${userAccessClause}
      ${dateClause}
      ${channelClause}
    GROUP BY ${actorColumn}
    ORDER BY units DESC
  `;

  const result = await tenantPool.query(query, params);

  return result.rows.map((row) => ({
    actorName: row.actor_name,
    units: parseInt(row.units) || 0,
    volume: parseFloat(row.volume) || 0,
    revenue: parseFloat(row.revenue) || 0,
    avgTurnTime: row.avg_turn_time ? parseFloat(row.avg_turn_time) : null,
    waFico: row.wa_fico ? parseInt(row.wa_fico) : null,
    waLtv: row.wa_ltv ? parseFloat(row.wa_ltv) : null,
    waDti: row.wa_dti ? parseFloat(row.wa_dti) : null,
    governmentCount: parseInt(row.government_count) || 0,
    purchaseCount: parseInt(row.purchase_count) || 0,
    approvedCount: parseInt(row.approved_count) || 0,
    deniedCount: parseInt(row.denied_count) || 0,
  }));
}

/**
 * Query total metrics for all actors (not grouped).
 * Useful for calculating company averages and totals.
 */
export interface TotalMetricsResult {
  totalUnits: number;
  totalVolume: number;
  totalRevenue: number;
  avgTurnTime: number | null;
  waFico: number | null;
  waLtv: number | null;
  waDti: number | null;
  governmentPercent: number;
  purchasePercent: number;
}

export async function queryTotalMetrics(
  tenantPool: pg.Pool,
  outputDateField: string,
  turnTimeStartField: string,
  turnTimeEndField: string,
  options: ActorMetricsQueryOptions
): Promise<TotalMetricsResult> {
  // Check for no-access filter
  if (options.userAccessFilter?.sql === "FALSE") {
    return {
      totalUnits: 0,
      totalVolume: 0,
      totalRevenue: 0,
      avgTurnTime: null,
      waFico: null,
      waLtv: null,
      waDti: null,
      governmentPercent: 0,
      purchasePercent: 0,
    };
  }

  const { dateRange, channelGroup } = options;
  const channelClause = buildChannelWhereClause(channelGroup);

  // Get tenant-specific revenue expression (or default if none configured)
  const revenueExpression = await getTenantRevenueExpression(tenantPool);

  // Build params array with user access filter first
  const params: any[] = [];
  let paramIndex = 1;

  // User access clause
  let userAccessClause = "";
  if (options.userAccessFilter && options.userAccessFilter.sql !== "FALSE") {
    userAccessClause = `AND ${options.userAccessFilter.sql.replace(
      /\$1/g,
      `$${paramIndex}`
    )}`;
    params.push(...options.userAccessFilter.params);
    paramIndex += options.userAccessFilter.paramOffset;
  }

  // Build date range clause
  let dateClause = "";
  if (dateRange.start && dateRange.end) {
    dateClause = `AND ${outputDateField} >= $${paramIndex} AND ${outputDateField} < $${
      paramIndex + 1
    }`;
    params.push(dateRange.start, dateRange.end);
  } else if (dateRange.start) {
    dateClause = `AND ${outputDateField} >= $${paramIndex}`;
    params.push(dateRange.start);
  } else if (dateRange.end) {
    dateClause = `AND ${outputDateField} < $${paramIndex}`;
    params.push(dateRange.end);
  }

  const query = `
    SELECT 
      COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) as total_units,
      COALESCE(SUM(loan_amount), 0) as total_volume,
      COALESCE(SUM(${revenueExpression}), 0) as total_revenue,
      AVG(
        CASE 
          WHEN ${turnTimeEndField} IS NOT NULL AND ${turnTimeStartField} IS NOT NULL 
               AND DATE(${turnTimeEndField}) > DATE(${turnTimeStartField})
          THEN DATE(${turnTimeEndField}) - DATE(${turnTimeStartField})
          ELSE NULL
        END
      ) as avg_turn_time,
      -- Weighted averages
      ROUND(
        SUM(CASE WHEN fico_score >= 350 AND fico_score <= 900 THEN fico_score * loan_amount ELSE 0 END) / 
        NULLIF(SUM(CASE WHEN fico_score >= 350 AND fico_score <= 900 THEN loan_amount ELSE 0 END), 0)
      , 0) as wa_fico,
      ROUND(
        SUM(CASE WHEN ltv_ratio >= 0 AND ltv_ratio <= 110 THEN ltv_ratio * loan_amount ELSE 0 END) / 
        NULLIF(SUM(CASE WHEN ltv_ratio >= 0 AND ltv_ratio <= 110 THEN loan_amount ELSE 0 END), 0)
      , 1) as wa_ltv,
      ROUND(
        SUM(CASE WHEN be_dti_ratio >= 0 AND be_dti_ratio <= 70 THEN be_dti_ratio * loan_amount ELSE 0 END) / 
        NULLIF(SUM(CASE WHEN be_dti_ratio >= 0 AND be_dti_ratio <= 70 THEN loan_amount ELSE 0 END), 0)
      , 1) as wa_dti,
      -- Percentages
      ROUND(
        COUNT(CASE WHEN UPPER(loan_type) IN ('FHA', 'VA', 'USDA', 'FARMERSHOMEA') THEN 1 END) * 100.0 / 
        NULLIF(COUNT(*), 0)
      , 1) as government_percent,
      ROUND(
        COUNT(CASE WHEN UPPER(loan_purpose) = 'PURCHASE' THEN 1 END) * 100.0 / 
        NULLIF(COUNT(*), 0)
      , 1) as purchase_percent
    FROM public.loans
    WHERE ${outputDateField} IS NOT NULL
      ${userAccessClause}
      ${dateClause}
      ${channelClause}
  `;

  const result = await tenantPool.query(query, params);
  const row = result.rows[0] || {};

  return {
    totalUnits: parseInt(row.total_units) || 0,
    totalVolume: parseFloat(row.total_volume) || 0,
    totalRevenue: parseFloat(row.total_revenue) || 0,
    avgTurnTime: row.avg_turn_time ? parseFloat(row.avg_turn_time) : null,
    waFico: row.wa_fico ? parseInt(row.wa_fico) : null,
    waLtv: row.wa_ltv ? parseFloat(row.wa_ltv) : null,
    waDti: row.wa_dti ? parseFloat(row.wa_dti) : null,
    governmentPercent: parseFloat(row.government_percent) || 0,
    purchasePercent: parseFloat(row.purchase_percent) || 0,
  };
}

/**
 * Query monthly metrics for trends charts.
 */
export interface MonthlyMetricsResult {
  month: string; // YYYY-MM format
  units: number;
  volume: number;
  avgTurnTime: number | null;
}

export async function queryMonthlyMetrics(
  tenantPool: pg.Pool,
  actorColumn: string,
  outputDateField: string,
  turnTimeStartField: string,
  turnTimeEndField: string,
  options: ActorMetricsQueryOptions
): Promise<Map<string, MonthlyMetricsResult[]>> {
  // Check for no-access filter
  if (options.userAccessFilter?.sql === "FALSE") {
    return new Map();
  }

  const { dateRange, channelGroup, actorMissingMode = "extended" } = options;

  const channelClause = buildChannelWhereClause(channelGroup);
  const actorNotMissingClause = buildActorNotMissingClause(
    actorColumn,
    actorMissingMode
  );

  // Build params array with user access filter first
  const params: any[] = [];
  let paramIndex = 1;

  // User access clause
  let userAccessClause = "";
  if (options.userAccessFilter && options.userAccessFilter.sql !== "FALSE") {
    userAccessClause = `AND ${options.userAccessFilter.sql.replace(
      /\$1/g,
      `$${paramIndex}`
    )}`;
    params.push(...options.userAccessFilter.params);
    paramIndex += options.userAccessFilter.paramOffset;
  }

  // Build date clause
  let dateClause = "";
  if (dateRange.start && dateRange.end) {
    dateClause = `AND ${outputDateField} >= $${paramIndex} AND ${outputDateField} < $${
      paramIndex + 1
    }`;
    params.push(dateRange.start, dateRange.end);
  }

  const query = `
    SELECT 
      ${actorColumn} as actor_name,
      TO_CHAR(${outputDateField}, 'YYYY-MM') as month,
      COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) as units,
      COALESCE(SUM(loan_amount), 0) as volume,
      AVG(
        CASE 
          WHEN ${turnTimeEndField} IS NOT NULL AND ${turnTimeStartField} IS NOT NULL 
               AND DATE(${turnTimeEndField}) > DATE(${turnTimeStartField})
          THEN DATE(${turnTimeEndField}) - DATE(${turnTimeStartField})
          ELSE NULL
        END
      ) as avg_turn_time
    FROM public.loans
    WHERE ${actorNotMissingClause}
      ${userAccessClause}
      ${dateClause}
      ${channelClause}
    GROUP BY ${actorColumn}, TO_CHAR(${outputDateField}, 'YYYY-MM')
    ORDER BY ${actorColumn}, month
  `;

  const result = await tenantPool.query(query, params);

  // Group results by actor
  const actorMonthlyData = new Map<string, MonthlyMetricsResult[]>();

  for (const row of result.rows) {
    const actorName = row.actor_name;
    if (!actorMonthlyData.has(actorName)) {
      actorMonthlyData.set(actorName, []);
    }
    actorMonthlyData.get(actorName)!.push({
      month: row.month,
      units: parseInt(row.units) || 0,
      volume: parseFloat(row.volume) || 0,
      avgTurnTime: row.avg_turn_time ? parseFloat(row.avg_turn_time) : null,
    });
  }

  return actorMonthlyData;
}

/**
 * Get vMaxDate (maximum date in loan data) for rolling date calculations.
 * Matches Qlik's Max("Last Modified Date") logic.
 */
export async function getVMaxDate(tenantPool: pg.Pool): Promise<Date> {
  const result = await tenantPool.query(`
    SELECT COALESCE(
      MAX(last_modified_date),
      MAX(funding_date),
      MAX(application_date),
      CURRENT_DATE
    ) as max_date
    FROM public.loans
    WHERE funding_date IS NOT NULL OR last_modified_date IS NOT NULL
  `);
  return result.rows[0]?.max_date
    ? new Date(result.rows[0].max_date)
    : new Date();
}
