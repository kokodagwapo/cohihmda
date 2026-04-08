import pg from "pg";
import {
  queryMetrics,
  DateRange,
  type MetricQueryOptions,
} from "../metrics/metricsService.js";
import type { LoanAccessFilter } from "../userLoanAccessService.js";
import {
  collectInsightMetrics,
  generateLLMInsights,
  generateCategorizedInsights,
  loadStoredInsights,
  clearCache as clearInsightsCache,
} from "../insights/index.js";
import { loadEscalatedDashboardInsights } from "../dashboardInsights/index.js";
import type {
  GeneratedInsight,
  CategorizedInsight,
  CategorizedInsightsResponse,
} from "../insights/index.js";
import {
  REVENUE_SQL_EXPRESSION,
  getTenantRevenueExpression,
  getActorColumnForChannel,
  getActorSqlExpression,
  getActorLabelForChannel,
  buildChannelWhereClause,
  buildChannelGroupCaseExpr,
  buildFundedFilter,
} from "../../utils/scorecard-utils.js";
import { getStaffingUnitTargets, type StaffingUnitTargets } from "../../utils/staffingUnitTargets.js";

/**
 * Analytics Service
 * Contains business logic for dashboard analytics endpoints
 * Uses tenant database pools (no tenant_id columns in tenant DBs)
 *
 * Note: Functions in this service that query loans should accept an optional
 * userAccessFilter parameter to support user-level loan access filtering.
 * When the filter is provided, it should be applied to all loan queries.
 */

export interface FunnelData {
  year: number;
  loansStarted: {
    units: number;
    volume: number;
    conversionRate: number;
  };
  loansLocked: {
    units: number;
    volume: number;
    conversionRate: number;
  };
  loansFunded: {
    units: number;
    volume: number;
    conversionRate: number;
  };
  overallConversionRate: number;
  pullThroughRate: number;
  avgLoanAmount: number;
}

export interface LeaderboardEntry {
  rank: number;
  employeeId: string;
  name: string;
  role: string;
  branch: string;
  loansClosed: number;
  loansStarted?: number;
  totalVolume: number;
  totalRevenue: number; // Actual revenue: Base Buy + Orig Fees - Lender Credits
  avgCycleTime: number;
  pullThroughRate: number;
  delta?: number; // Percentage change from previous period
}

export interface TopTieringRanking {
  employeeId: string;
  name: string;
  role: string;
  branch: string;
  rank: number;
  scores: {
    productivity: number;
    profitability: number;
    complexity: number;
    composite: number;
  };
  metrics: {
    loansClosed: number;
    avgCycleTime: number;
    pullThroughRate: number;
    totalVolume: number;
    avgLoanAmount: number;
    fundedCount: number;
    loanTypesHandled: number;
  };
}

export interface BusinessOverviewMetrics {
  year: number;
  activeLoans: number;
  closedLoans: number;
  lockedLoans: number;
  avgCycleTime: number;
  pullThroughRate: number;
  creditPulls: number;
}

export interface Insight {
  /** DB row id from generated_insights — used for exact drill-down queries */
  id?: number;
  type: string;
  message: string;
  priority: string;
  reasoning?: string;
  source?: string;
  forPodcast?: boolean;
  // Enriched categorized insight fields
  bucket?: string;
  headline?: string;
  understory?: string;
  severity_score?: number;
  bucketPriority?: string;
  impact?: { type?: string; estimated_dollars?: number | null; units_affected?: number | null };
  evidence?: { metrics?: string[]; comparisons?: string[] };
  // ETM Framework fields
  what_changed?: string;
  why?: string;
  business_impact?: string;
  risk_if_ignored?: string;
  recommended_action?: string;
  owner?: string;
  generation_method?: "pipeline" | "agent";
  detail_data?: any;
  functional_category?: string;
  // Dashboard insights escalation: "Go to page" link and filter restore
  sourcePageId?: string;
  sourcePageName?: string;
  filter_context?: Record<string, unknown>;
  evidence_refs?: Array<{ widgetId: string; role: string; target?: { type: string; label: string }; value?: string }>;
  cited_numbers?: string[];
  supporting_data?: { byPeriod?: Array<{ period: string; periodLabel?: string; averagePullThrough?: number; totalUnits?: number; totalVolume?: number; topPerformerName?: string; topPerformerUnits?: number; topPerformerVolume?: number }> };
}

/**
 * Get loan funnel data for a specific year
 */
export async function getFunnelData(
  tenantPool: pg.Pool,
  year: string
): Promise<FunnelData> {
  try {
    const loansResult = await tenantPool.query(
      `SELECT 
        COUNT(*) as total_loans,
        COUNT(CASE WHEN status = 'inquiry' THEN 1 END) as inquiries,
        COUNT(CASE WHEN status = 'started' THEN 1 END) as started,
        -- Locked loans: lock_date exists
        COUNT(CASE WHEN lock_date IS NOT NULL AND lock_date <= CURRENT_DATE THEN 1 END) as locked,
        -- Funded loans: funding_date exists
        COUNT(CASE WHEN funding_date IS NOT NULL THEN 1 END) as funded,
        SUM(CASE WHEN funding_date IS NOT NULL THEN loan_amount ELSE 0 END) as total_volume,
        AVG(CASE WHEN funding_date IS NOT NULL THEN loan_amount ELSE NULL END) as avg_loan_amount
       FROM public.loans
       WHERE EXTRACT(YEAR FROM COALESCE(application_date, created_at)) = $1`,
      [parseInt(year)]
    );

    const data = loansResult.rows[0];

    // Calculate conversion rates
    const inquiries = parseInt(data.inquiries) || 0;
    const started = parseInt(data.started) || 0;
    const locked = parseInt(data.locked) || 0;
    const funded = parseInt(data.funded) || 0;

    // Pull-through Rate: originated (status-based) / completed (canonical definition)
    const pullThroughResult = await tenantPool.query(
      `SELECT
        COUNT(CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%')
          THEN 1 END)::float
          / NULLIF(COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
          THEN 1 END), 0) * 100 as pull_through_rate
       FROM public.loans
       WHERE EXTRACT(YEAR FROM COALESCE(application_date, created_at)) = $1`,
      [parseInt(year)]
    );

    const pullThroughRate =
      parseFloat(pullThroughResult.rows[0]?.pull_through_rate) || 0;

    const funnelData: FunnelData = {
      year: parseInt(year),
      loansStarted: {
        units: started,
        volume: parseFloat(data.total_volume) || 0,
        conversionRate: inquiries > 0 ? (started / inquiries) * 100 : 0,
      },
      loansLocked: {
        units: locked,
        volume: parseFloat(data.total_volume) || 0,
        conversionRate: started > 0 ? (locked / started) * 100 : 0,
      },
      loansFunded: {
        units: funded,
        volume: parseFloat(data.total_volume) || 0,
        conversionRate: locked > 0 ? (funded / locked) * 100 : 0,
      },
      overallConversionRate: inquiries > 0 ? (funded / inquiries) * 100 : 0,
      pullThroughRate: pullThroughRate,
      avgLoanAmount: parseFloat(data.avg_loan_amount) || 0,
    };

    return funnelData;
  } catch (dbError: any) {
    // If loans table doesn't exist, return empty structure
    if (dbError.code === "42P01") {
      return {
        year: parseInt(year),
        loansStarted: { units: 0, volume: 0, conversionRate: 0 },
        loansLocked: { units: 0, volume: 0, conversionRate: 0 },
        loansFunded: { units: 0, volume: 0, conversionRate: 0 },
        overallConversionRate: 0,
        pullThroughRate: 0,
        avgLoanAmount: 0,
      };
    }
    throw dbError;
  }
}

// Extended timeframe types
type ExtendedTimeframe =
  | "wtd"
  | "mtd"
  | "qtd"
  | "ytd"
  | "lw"
  | "lm"
  | "lq"
  | "ly"
  | "rolling_13"
  | "custom";

/**
 * Calculate date range based on timeframe
 * Returns { start, end } for all timeframes
 */
export function getDateRangeForTimeframe(
  timeframe: ExtendedTimeframe,
  customStart?: string,
  customEnd?: string
): { start: Date; end: Date } {
  const now = new Date();
  let start: Date;
  let end: Date = new Date(); // Default end is today

  switch (timeframe) {
    case "wtd":
      // Week-to-date: Start of current week to today
      start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      break;
    case "mtd":
      // Month-to-date: Start of current month to today
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "qtd":
      // Quarter-to-date: Start of current quarter to today
      const quarter = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), quarter * 3, 1);
      break;
    case "ytd":
      // Year-to-date: Start of current year to today
      start = new Date(now.getFullYear(), 0, 1);
      break;
    case "lm":
      // Last Month: Full previous month
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0); // Last day of prev month
      break;
    case "lq":
      // Last Quarter: Full previous quarter
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const prevQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
      const prevQuarterYear =
        currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
      start = new Date(prevQuarterYear, prevQuarter * 3, 1);
      end = new Date(prevQuarterYear, prevQuarter * 3 + 3, 0); // Last day of prev quarter
      break;
    case "ly":
      // Last Year: Full previous year
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear() - 1, 11, 31);
      break;
    case "rolling_13":
      // Rolling 13 months: from 13 months ago through today
      start = new Date(now.getFullYear(), now.getMonth() - 13, now.getDate());
      end = new Date(now);
      break;
    case "custom":
      // Custom date range - parse as local dates (not UTC)
      if (customStart && customEnd) {
        // Parse 'YYYY-MM-DD' strings as local dates to match preset calculations
        const [startYear, startMonth, startDay] = customStart
          .split("-")
          .map(Number);
        const [endYear, endMonth, endDay] = customEnd.split("-").map(Number);
        start = new Date(startYear, startMonth - 1, startDay);
        end = new Date(endYear, endMonth - 1, endDay);
      } else {
        // Default to MTD if no custom dates provided
        start = new Date(now.getFullYear(), now.getMonth(), 1);
      }
      break;
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return { start, end };
}

/**
 * Calculate date range for previous period (for delta calculation)
 *
 * Comparison strategy:
 * - For "to-date" periods (WTD, MTD, QTD, YTD): Compare to previous equivalent period
 * - For "last" periods (LW, LM, LQ, LY): Compare to the period before that
 * - For custom: Compare to same period one year prior (year-over-year)
 */
function getPreviousPeriodRange(
  timeframe: ExtendedTimeframe,
  customStart?: string,
  customEnd?: string
): { start: Date; end: Date } {
  const now = new Date();
  let start: Date;
  let end: Date;

  // Helper to get quarter info
  const getQuarterInfo = (date: Date) => {
    const quarter = Math.floor(date.getMonth() / 3); // 0-3
    const year = date.getFullYear();
    return { quarter, year };
  };

  // Helper to get previous quarter
  const getPrevQuarter = (quarter: number, year: number) => {
    if (quarter === 0) {
      return { quarter: 3, year: year - 1 };
    }
    return { quarter: quarter - 1, year };
  };

  switch (timeframe) {
    case "wtd": {
      // WTD compares to previous week (same days)
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay()); // Start of current week (Sunday)
      const prevWeekEnd = new Date(weekStart);
      prevWeekEnd.setDate(prevWeekEnd.getDate() - 1); // Saturday of last week
      const prevWeekStart = new Date(prevWeekEnd);
      prevWeekStart.setDate(prevWeekStart.getDate() - 6); // Sunday of last week
      start = prevWeekStart;
      end = prevWeekEnd;
      break;
    }
    case "mtd": {
      // MTD compares to previous month (same days into the month)
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        Math.min(
          now.getDate(),
          new Date(now.getFullYear(), now.getMonth(), 0).getDate()
        )
      );
      break;
    }
    case "qtd": {
      // QTD compares to previous quarter (same days into the quarter)
      const { quarter: currQ, year: currY } = getQuarterInfo(now);
      const { quarter: prevQ, year: prevY } = getPrevQuarter(currQ, currY);
      const daysIntoQuarter = Math.floor(
        (now.getTime() - new Date(currY, currQ * 3, 1).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      start = new Date(prevY, prevQ * 3, 1);
      end = new Date(prevY, prevQ * 3, 1 + daysIntoQuarter);
      break;
    }
    case "lw": {
      // Last Week compares to the week before that
      const lastWeekStart = new Date(now);
      lastWeekStart.setDate(now.getDate() - now.getDay() - 7); // Start of last week
      const twoWeeksAgoStart = new Date(lastWeekStart);
      twoWeeksAgoStart.setDate(twoWeeksAgoStart.getDate() - 7);
      start = twoWeeksAgoStart;
      end = new Date(twoWeeksAgoStart);
      end.setDate(end.getDate() + 6);
      break;
    }
    case "lm": {
      // Last Month compares to the month before that
      start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      end = new Date(now.getFullYear(), now.getMonth() - 1, 0); // Last day of 2 months ago
      break;
    }
    case "lq": {
      // Last Quarter compares to the quarter before that
      const { quarter: currQ, year: currY } = getQuarterInfo(now);
      const { quarter: lastQ, year: lastY } = getPrevQuarter(currQ, currY); // Last Quarter
      const { quarter: prevQ, year: prevY } = getPrevQuarter(lastQ, lastY); // Quarter before Last
      start = new Date(prevY, prevQ * 3, 1);
      end = new Date(prevY, prevQ * 3 + 3, 0); // Last day of that quarter
      break;
    }
    case "ly": {
      // Last Year compares to the year before that
      start = new Date(now.getFullYear() - 2, 0, 1);
      end = new Date(now.getFullYear() - 2, 11, 31);
      break;
    }
    case "custom": {
      // Custom date range compares to same period one year prior (year-over-year)
      if (customStart && customEnd) {
        // Parse 'YYYY-MM-DD' strings as local dates to match preset calculations
        const [startYear, startMonth, startDay] = customStart
          .split("-")
          .map(Number);
        const [endYear, endMonth, endDay] = customEnd.split("-").map(Number);
        // Shift back one year for year-over-year comparison
        start = new Date(startYear - 1, startMonth - 1, startDay);
        end = new Date(endYear - 1, endMonth - 1, endDay);
      } else {
        // Fallback to previous year
        start = new Date(now.getFullYear() - 1, 0, 1);
        end = new Date(now.getFullYear() - 1, 11, 31);
      }
      break;
    }
    case "ytd":
    default: {
      // YTD compares to same period last year
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      break;
    }
  }

  return { start, end };
}

/**
 * Get leaderboard data for a specific timeframe
 * Groups loans by the appropriate actor field based on channel:
 * - Retail channels: loan_officer
 * - TPO channels: account_executive
 */
export async function getLeaderboardData(
  tenantPool: pg.Pool,
  timeframe: ExtendedTimeframe = "mtd",
  filters?: {
    branch?: string;
    scope?: "all" | "branch" | "team";
    startDate?: string; // For custom date range
    endDate?: string; // For custom date range
    channelGroup?: string; // Channel filter (Retail, TPO, or specific channel)
    dimensionFilterClause?: string; // Additional SQL WHERE fragment from dimension filters
  }
): Promise<{ leaderboard: LeaderboardEntry[]; timeframe: string }> {
  try {
    const dateRange = getDateRangeForTimeframe(
      timeframe,
      filters?.startDate,
      filters?.endDate
    );
    const startDate = dateRange.start;
    const endDate = dateRange.end;
    const prevPeriod = getPreviousPeriodRange(
      timeframe,
      filters?.startDate,
      filters?.endDate
    );

    // Determine the actor column based on channel group
    // TPO channels use account_executive, Retail uses loan_officer
    const actorColumn = getActorColumnForChannel(filters?.channelGroup);
    const actorExpression = getActorSqlExpression(filters?.channelGroup, "l");

    // Get tenant-specific revenue expression (or default if none configured)
    const revenueExpression = await getTenantRevenueExpression(tenantPool, "l");

    // Build WHERE clause for filters
    const conditions: string[] = [];
    const params: any[] = [startDate, endDate];
    let paramIndex = 3;

    // Branch filter
    if (filters?.branch) {
      conditions.push(`l.branch = $${paramIndex}`);
      params.push(filters.branch);
      paramIndex++;
    }

    // Channel filter - use shared utility for consistent behavior
    const channelClause = buildChannelWhereClause(filters?.channelGroup);
    if (channelClause) {
      // Remove leading 'AND ' since we'll add it back with other conditions
      conditions.push(channelClause.replace(/^AND\s+/i, ""));
    }

    const branchFilter =
      conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
    const dimensionFilter = filters?.dimensionFilterClause || "";

    // Channel-aware funded filter: Retail uses rate_lock > 0, TPO/All do not.
    const fundedFilter = buildFundedFilter(filters?.channelGroup, "l");

    // Query performance metrics grouped by the appropriate actor field
    // For TPO: account_executive, For Retail: loan_officer
    // Uses COALESCE to show 'Unassigned' for missing values
    const leaderboardResult = await tenantPool.query(
      `SELECT 
        ${actorExpression} as name,
        l.branch,
        COUNT(*) FILTER (
          WHERE COALESCE(l.started_date, l.application_date, l.created_at) >= $1
            AND COALESCE(l.started_date, l.application_date, l.created_at) <= $2
        ) as loans_started,
        -- Funded units: channel-aware funded filter
        COUNT(*) FILTER (
          WHERE ${fundedFilter}
            AND l.funding_date >= $1::date
            AND l.funding_date <= $2::date
        ) as loans_closed,
        -- Total volume for period (funded loans only — same filter as units)
        COALESCE(SUM(l.loan_amount) FILTER (
          WHERE ${fundedFilter}
            AND l.funding_date >= $1::date
            AND l.funding_date <= $2::date
        ), 0) as total_volume,
        -- Total revenue: Using tenant-specific revenue expression (funded loans)
        COALESCE(SUM(${revenueExpression}) FILTER (
          WHERE ${fundedFilter}
            AND l.funding_date >= $1::date
            AND l.funding_date <= $2::date
        ), 0) as total_revenue,
        -- Cycle time: App date to Closing/Funding date
        AVG(CASE 
          WHEN l.closing_date IS NOT NULL AND l.application_date IS NOT NULL 
          THEN DATE(l.closing_date) - DATE(l.application_date) 
          WHEN l.funding_date IS NOT NULL AND l.application_date IS NOT NULL 
          THEN DATE(l.funding_date::date) - DATE(l.application_date)
          ELSE NULL 
        END) FILTER (
          WHERE COALESCE(l.started_date, l.application_date, l.created_at) >= $1
            AND COALESCE(l.started_date, l.application_date, l.created_at) <= $2
        ) as avg_cycle_time,
        -- Pull-through rate: originated (status-based) / completed
        COUNT(*) FILTER (
          WHERE COALESCE(l.started_date, l.application_date, l.created_at) >= $1
            AND COALESCE(l.started_date, l.application_date, l.created_at) <= $2
            AND (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
        )::float 
        / NULLIF(
          COUNT(*) FILTER (
            WHERE COALESCE(l.started_date, l.application_date, l.created_at) >= $1
              AND COALESCE(l.started_date, l.application_date, l.created_at) <= $2
              AND l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
          ), 0
        ) * 100 as pull_through_rate
       FROM public.loans l
       WHERE 1=1
         ${branchFilter}
         ${dimensionFilter}
       GROUP BY ${actorExpression}, l.branch
       HAVING COUNT(*) FILTER (
         WHERE COALESCE(l.started_date, l.application_date, l.created_at) >= $1
           AND COALESCE(l.started_date, l.application_date, l.created_at) <= $2
       ) > 0
       ORDER BY 
         COUNT(*) FILTER (
           WHERE ${fundedFilter}
             AND l.funding_date >= $1::date
             AND l.funding_date <= $2::date
         ) DESC,
         SUM(l.loan_amount) FILTER (
           WHERE ${fundedFilter}
             AND l.funding_date >= $1::date
             AND l.funding_date <= $2::date
         ) DESC
       LIMIT 10`,
      params
    );

    // If no results, return empty
    if (leaderboardResult.rows.length === 0) {
      return { leaderboard: [], timeframe };
    }

    // Query previous period for delta calculation
    // params is [startDate, endDate, ...branchFilter], so slice(2) gets just the branch filter params
    const prevParams = [prevPeriod.start, prevPeriod.end, ...params.slice(2)];
    let prevParamIndex = 3;
    const prevBranchFilter = filters?.branch
      ? `AND l.branch = $${prevParamIndex}`
      : "";

    // Build channel clause for previous period query
    const prevChannelClause = buildChannelWhereClause(filters?.channelGroup);

    const prevPeriodResult = await tenantPool.query(
      `SELECT 
        ${actorExpression} as name,
        COUNT(*) FILTER (
          WHERE ${fundedFilter}
            AND l.funding_date >= $1::date
            AND l.funding_date <= $2::date
        ) as loans_closed
       FROM public.loans l
       WHERE 1=1
         ${prevBranchFilter}
         ${prevChannelClause}
         ${dimensionFilter}
       GROUP BY ${actorExpression}`,
      prevParams
    );

    // Create lookup for previous period data
    const prevPeriodMap = new Map<string, number>();
    prevPeriodResult.rows.forEach((row) => {
      prevPeriodMap.set(row.name, parseInt(row.loans_closed) || 0);
    });

    // Transform results with delta calculation
    const leaderboard: LeaderboardEntry[] = leaderboardResult.rows.map(
      (row, index) => {
        const currentLoans = parseInt(row.loans_closed) || 0;
        const prevLoans = prevPeriodMap.get(row.name) || 0;

        // Calculate delta percentage (change from previous period)
        let delta = 0;
        if (prevLoans > 0) {
          delta = Math.round(((currentLoans - prevLoans) / prevLoans) * 100);
        } else if (currentLoans > 0) {
          delta = 100; // New performer (wasn't in previous period)
        }

        return {
          rank: index + 1,
          employeeId: `lo-${index + 1}`, // Generate placeholder ID since we're using name
          name: row.name || "Unknown",
          role: "Loan Officer", // Default role (could be enhanced with employees table lookup)
          branch: row.branch || "Unknown",
          loansClosed: currentLoans,
          loansStarted: parseInt(row.loans_started) || 0,
          totalVolume: parseFloat(row.total_volume) || 0,
          totalRevenue: parseFloat(row.total_revenue) || 0,
          avgCycleTime: Math.round(parseFloat(row.avg_cycle_time) || 0),
          pullThroughRate: Math.round(parseFloat(row.pull_through_rate) || 0),
          delta,
        };
      }
    );

    return { leaderboard, timeframe };
  } catch (dbError: any) {
    console.error("[Leaderboard] Error:", dbError.message);
    // If loans table doesn't exist, return empty array
    if (dbError.code === "42P01") {
      return { leaderboard: [], timeframe };
    }
    throw dbError;
  }
}

// High Performers leaderboard row (branch or loan officer)
export interface HighPerformerRow {
  name: string;
  units: number;
  volume: number;
  rank: number;
  pctGovt: number;
  pctConv: number;
  pctRefi: number;
  pctPurch: number;
}

export type HighPerformersDateType = "funding_date" | "closing_date" | "application_date";
export type HighPerformersTimePeriod = "mtd" | "lm" | "ytd" | "ly" | "rolling_13";

/**
 * Get High Performers rankings: branch and loan officer tables by date type and time period.
 * dateType: which loan date to filter on (funding_date, closing_date, application_date).
 * timePeriod: mtd, last month, ytd, last year, rolling 13 months.
 */
export async function getHighPerformersRankings(
  tenantPool: pg.Pool,
  options: {
    dateType: HighPerformersDateType;
    timePeriod: HighPerformersTimePeriod;
    userAccessFilter?: LoanAccessFilter;
    channelGroup?: string;
    dimensionFilterClause?: string;
  }
): Promise<{ branchRankings: HighPerformerRow[]; loanOfficerRankings: HighPerformerRow[] }> {
  try {
    const dateRange = getDateRangeForTimeframe(
      options.timePeriod as ExtendedTimeframe,
      undefined,
      undefined
    );
    const startDate = dateRange.start;
    const endDate = dateRange.end;
    const dateCol = options.dateType;

    // Use local date strings (YYYY-MM-DD) so filters match user's timezone
    const toLocalDateStr = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const startStr = toLocalDateStr(startDate);
    const endStr = toLocalDateStr(endDate);

    const conditions: string[] = [];
    const params: (string | number)[] = [startStr, endStr];
    if (options.userAccessFilter?.sql) {
      conditions.push(options.userAccessFilter.sql);
      params.push(...(options.userAccessFilter.params || []));
    }
    const channelClause = buildChannelWhereClause(options.channelGroup);
    if (channelClause) {
      conditions.push(channelClause.replace(/^AND\s+/i, ""));
    }
    const extraWhere = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
    const hpDimensionFilter = options.dimensionFilterClause || "";

    const actorExpression = getActorSqlExpression(options.channelGroup, "l");

    const dateFilter = `${dateCol}::date >= $1::date AND ${dateCol}::date <= $2::date`;
    // % Govt = loan_type is not Conventional (FHA/VA/USDA); % Conv = Conventional
    const loanTypeGovt = `(UPPER(COALESCE(l.loan_type, '')) LIKE '%FHA%' OR UPPER(COALESCE(l.loan_type, '')) LIKE '%VA%' OR UPPER(COALESCE(l.loan_type, '')) LIKE '%USDA%')`;
    const loanTypeConv = `(NOT (UPPER(COALESCE(l.loan_type, '')) LIKE '%FHA%' OR UPPER(COALESCE(l.loan_type, '')) LIKE '%VA%' OR UPPER(COALESCE(l.loan_type, '')) LIKE '%USDA%'))`;
    // % Refi = loan_purpose contains "refinance" or "refi"; % Purch = contains "Purchase"
    const loanPurposeRefi = `(UPPER(COALESCE(l.loan_purpose, '')) LIKE '%REFINANCE%' OR UPPER(COALESCE(l.loan_purpose, '')) LIKE '%REFI%')`;
    const loanPurposePurch = `(UPPER(COALESCE(l.loan_purpose, '')) LIKE '%PURCHASE%')`;

    // Branch rankings
    const branchQuery = `
      SELECT
        COALESCE(l.branch, 'Unassigned') as name,
        COUNT(*) FILTER (WHERE ${dateFilter}) as units,
        COALESCE(SUM(l.loan_amount) FILTER (WHERE ${dateFilter}), 0) as volume,
        COUNT(*) FILTER (WHERE ${dateFilter} AND ${loanTypeGovt}) as govt_count,
        COUNT(*) FILTER (WHERE ${dateFilter} AND ${loanTypeConv}) as conv_count,
        COUNT(*) FILTER (WHERE ${dateFilter} AND ${loanPurposeRefi}) as refi_count,
        COUNT(*) FILTER (WHERE ${dateFilter} AND ${loanPurposePurch}) as purch_count
      FROM public.loans l
      WHERE ${dateCol} IS NOT NULL ${extraWhere} ${hpDimensionFilter}
      GROUP BY l.branch
      HAVING COUNT(*) FILTER (WHERE ${dateFilter}) > 0
      ORDER BY volume DESC, units DESC
    `;
    const branchResult = await tenantPool.query(branchQuery, params);

    const branchRankings: HighPerformerRow[] = branchResult.rows.map((row, idx) => {
      const units = parseInt(row.units, 10) || 0;
      const volume = parseFloat(row.volume) || 0;
      const govtCount = parseInt(row.govt_count, 10) || 0;
      const convCount = parseInt(row.conv_count, 10) || 0;
      const refiCount = parseInt(row.refi_count, 10) || 0;
      const purchCount = parseInt(row.purch_count, 10) || 0;
      return {
        name: row.name || "Unassigned",
        units,
        volume,
        rank: idx + 1,
        pctGovt: units > 0 ? (govtCount / units) * 100 : 0,
        pctConv: units > 0 ? (convCount / units) * 100 : 0,
        pctRefi: units > 0 ? (refiCount / units) * 100 : 0,
        pctPurch: units > 0 ? (purchCount / units) * 100 : 0,
      };
    });

    // Loan officer rankings (same metrics, group by actor)
    const loQuery = `
      SELECT
        ${actorExpression} as name,
        COUNT(*) FILTER (WHERE ${dateFilter}) as units,
        COALESCE(SUM(l.loan_amount) FILTER (WHERE ${dateFilter}), 0) as volume,
        COUNT(*) FILTER (WHERE ${dateFilter} AND ${loanTypeGovt}) as govt_count,
        COUNT(*) FILTER (WHERE ${dateFilter} AND ${loanTypeConv}) as conv_count,
        COUNT(*) FILTER (WHERE ${dateFilter} AND ${loanPurposeRefi}) as refi_count,
        COUNT(*) FILTER (WHERE ${dateFilter} AND ${loanPurposePurch}) as purch_count
      FROM public.loans l
      WHERE ${dateCol} IS NOT NULL ${extraWhere} ${hpDimensionFilter}
      GROUP BY ${actorExpression}
      HAVING COUNT(*) FILTER (WHERE ${dateFilter}) > 0
      ORDER BY volume DESC, units DESC
    `;
    const loResult = await tenantPool.query(loQuery, params);

    const loanOfficerRankings: HighPerformerRow[] = loResult.rows.map((row, idx) => {
      const units = parseInt(row.units, 10) || 0;
      const volume = parseFloat(row.volume) || 0;
      const govtCount = parseInt(row.govt_count, 10) || 0;
      const convCount = parseInt(row.conv_count, 10) || 0;
      const refiCount = parseInt(row.refi_count, 10) || 0;
      const purchCount = parseInt(row.purch_count, 10) || 0;
      return {
        name: row.name || "Unknown",
        units,
        volume,
        rank: idx + 1,
        pctGovt: units > 0 ? (govtCount / units) * 100 : 0,
        pctConv: units > 0 ? (convCount / units) * 100 : 0,
        pctRefi: units > 0 ? (refiCount / units) * 100 : 0,
        pctPurch: units > 0 ? (purchCount / units) * 100 : 0,
      };
    });

    return { branchRankings, loanOfficerRankings };
  } catch (dbError: any) {
    console.error("[HighPerformers] Error:", dbError.message);
    if (dbError.code === "42P01") {
      return { branchRankings: [], loanOfficerRankings: [] };
    }
    throw dbError;
  }
}

/**
 * Get TopTiering rankings with productivity, profitability, and complexity scoring
 */
export async function getTopTieringRankings(
  tenantPool: pg.Pool
): Promise<{ rankings: TopTieringRanking[] }> {
  try {
    // Check if employees table exists
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'employees'
      )
    `);

    if (!tableCheck.rows[0]?.exists) {
      return { rankings: [] };
    }

    const tieringResult = await tenantPool.query(
      `SELECT 
        e.id as employee_id,
        e.first_name,
        e.last_name,
        e.role,
        e.branch,
        -- Productivity metrics
        COUNT(l.id) as loans_closed,
        -- Cycle time: App-Close (calculated from dates)
        AVG(CASE WHEN l.closing_date IS NOT NULL AND l.application_date IS NOT NULL 
          THEN DATE(l.closing_date) - DATE(l.application_date) 
          ELSE NULL END) as avg_cycle_time,
        -- Pull-through rate: originated (status-based) / completed
        COUNT(CASE WHEN (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%') THEN 1 END)::float 
          / NULLIF(COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
          THEN 1 END), 0) * 100 as pull_through_rate,
        -- Profitability metrics
        SUM(l.loan_amount) as total_volume,
        AVG(l.loan_amount) as avg_loan_amount,
        COUNT(CASE WHEN l.funding_date IS NOT NULL THEN 1 END) as funded_count,
        -- Complexity metrics: Use ltv_ratio column and raw_data JSONB
        COALESCE(AVG(l.ltv_ratio), 0) as avg_ltv,
        AVG(COALESCE((l.raw_data->>'fico_score')::numeric, (l.raw_data->>'fico')::numeric, 0)) as avg_fico,
        AVG(COALESCE((l.raw_data->>'dti_ratio')::numeric, (l.raw_data->>'dti')::numeric, l.be_dti_ratio, 0)) as avg_dti,
        COUNT(DISTINCT l.loan_type) as loan_types_handled
       FROM public.employees e
       LEFT JOIN public.loans l ON e.id::TEXT = l.loan_officer_id
       WHERE e.status = 'active'
       GROUP BY e.id, e.first_name, e.last_name, e.role, e.branch
       HAVING COUNT(l.id) > 0`
    );

    // Calculate composite scores with complexity formulas
    const rankings: TopTieringRanking[] = tieringResult.rows.map((row) => {
      const loansClosed = parseInt(row.loans_closed) || 0;
      const avgCycleTime = parseFloat(row.avg_cycle_time) || 0;
      const pullThroughRate = parseFloat(row.pull_through_rate) || 0;
      const totalVolume = parseFloat(row.total_volume) || 0;
      const avgLoanAmount = parseFloat(row.avg_loan_amount) || 0;
      const fundedCount = parseInt(row.funded_count) || 0;
      const loanTypesHandled = parseInt(row.loan_types_handled) || 0;

      // Complexity calculations based on FICO, DTI, LTV
      const avgFico = parseFloat(row.avg_fico) || 0;
      const avgDti = parseFloat(row.avg_dti) || 0;
      const avgLtv = parseFloat(row.avg_ltv) || 0;

      // FICO Complexity: < 640 = 3, < 680 = 2, < 720 = 1, else 0
      const ficoComplexity =
        avgFico < 640 ? 3 : avgFico < 680 ? 2 : avgFico < 720 ? 1 : 0;

      // DTI Complexity: > 45 = 3, > 40 = 2, > 35 = 1, else 0
      const dtiComplexity =
        avgDti > 45 ? 3 : avgDti > 40 ? 2 : avgDti > 35 ? 1 : 0;

      // LTV Complexity: > 90 = 3, > 80 = 2, > 70 = 1, else 0
      const ltvComplexity =
        avgLtv > 90 ? 3 : avgLtv > 80 ? 2 : avgLtv > 70 ? 1 : 0;

      // Loan Complexity Score: Sum of all three
      const loanComplexityScore =
        ficoComplexity + dtiComplexity + ltvComplexity;

      // Risk Factor: Weighted combination
      const riskFactor =
        loanComplexityScore * 0.4 +
        ficoComplexity * 0.3 +
        dtiComplexity * 0.2 +
        ltvComplexity * 0.1;

      // Productivity Score (0-100)
      // Factors: loans closed (40%), cycle time efficiency (30%), pull-through rate (30%)
      const cycleTimeEfficiency =
        avgCycleTime > 0 ? Math.max(0, 100 - (avgCycleTime - 20) * 2) : 50; // Target: 20 days
      const productivityScore =
        loansClosed * 2 + // Up to 40 points for volume
        cycleTimeEfficiency * 0.3 + // Up to 30 points for speed
        pullThroughRate * 0.3; // Up to 30 points for conversion

      // Profitability Score (0-100)
      // Factors: total volume (50%), revenue per loan (30%), funded count (20%)
      const revenuePerLoan = avgLoanAmount * 0.01; // Estimate 1% revenue
      const profitabilityScore =
        Math.min(50, (totalVolume / 1000000) * 5) + // Up to 50 points for volume
        Math.min(30, (revenuePerLoan / 1000) * 3) + // Up to 30 points for margin
        fundedCount * 2; // Up to 20 points for funded loans

      // Complexity Score (0-100)
      // Factors: complexity score (40%), loan types (30%), risk factor (30%)
      const complexityScore =
        loanComplexityScore * 4 + // Up to 40 points (0-9 scale * 4 = 0-36)
        loanTypesHandled * 10 + // Up to 30 points (3+ types)
        riskFactor * 3; // Up to 30 points (0-10 scale * 3 = 0-30)

      // Composite Score (weighted average)
      const compositeScore =
        productivityScore * 0.4 +
        profitabilityScore * 0.4 +
        complexityScore * 0.2;

      return {
        employeeId: row.employee_id,
        name: `${row.first_name} ${row.last_name}`,
        role: row.role,
        branch: row.branch,
        rank: 0, // Will be set after sorting
        scores: {
          productivity: Math.round(productivityScore),
          profitability: Math.round(profitabilityScore),
          complexity: Math.round(complexityScore),
          composite: Math.round(compositeScore),
        },
        metrics: {
          loansClosed,
          avgCycleTime: Math.round(avgCycleTime),
          pullThroughRate: Math.round(pullThroughRate),
          totalVolume,
          avgLoanAmount,
          fundedCount,
          loanTypesHandled,
        },
      };
    });

    // Sort by composite score descending
    rankings.sort((a, b) => b.scores.composite - a.scores.composite);

    // Add rank
    const rankedResults = rankings.map((ranking, index) => ({
      ...ranking,
      rank: index + 1,
    }));

    return { rankings: rankedResults };
  } catch (dbError: any) {
    if (dbError.code === "42P01") {
      return { rankings: [] };
    }
    throw dbError;
  }
}

/**
 * Get business overview metrics using metrics service
 * Supports date filtering via dateFilter parameter
 */
export async function getBusinessOverviewMetrics(
  tenantPool: pg.Pool,
  year: string,
  dateFilter: "today" | "mtd" | "ytd" | "custom" = "ytd",
  customDateRange?: { start: Date; end: Date }
): Promise<BusinessOverviewMetrics> {
  try {
    // Convert dateFilter to date range
    let dateRange: DateRange | undefined;

    if (dateFilter === "custom" && customDateRange) {
      const formatDate = (d: Date) => d.toISOString().split("T")[0];
      dateRange = {
        start: formatDate(customDateRange.start),
        end: formatDate(customDateRange.end),
      };
    } else {
      // Calculate date range based on filter
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const formatDate = (d: Date) => d.toISOString().split("T")[0];

      switch (dateFilter) {
        case "today":
          dateRange = {
            start: formatDate(today),
            end: formatDate(new Date(today.getTime() + 24 * 60 * 60 * 1000)), // End of day
          };
          break;
        case "mtd":
          dateRange = {
            start: formatDate(
              new Date(today.getFullYear(), today.getMonth(), 1)
            ),
            end: formatDate(today),
          };
          break;
        case "ytd":
          dateRange = {
            start: formatDate(new Date(today.getFullYear(), 0, 1)),
            end: formatDate(today),
          };
          break;
        default:
          // Default to YTD if unknown
          dateRange = {
            start: formatDate(new Date(today.getFullYear(), 0, 1)),
            end: formatDate(today),
          };
      }
    }

    // Query all 6 KPIs using metrics service
    const metricIds = [
      "active_loans",
      "closed_loans",
      "locked_loans",
      "avg_cycle_time",
      "pull_through_rate",
      "credit_pulls",
    ];

    const results = await queryMetrics(tenantPool, metricIds, { dateRange });

    return {
      year: parseInt(year),
      activeLoans: (results.active_loans?.value as number) || 0,
      closedLoans: (results.closed_loans?.value as number) || 0,
      lockedLoans: (results.locked_loans?.value as number) || 0,
      avgCycleTime: (results.avg_cycle_time?.value as number) || 0,
      pullThroughRate: (results.pull_through_rate?.value as number) || 0,
      creditPulls: (results.credit_pulls?.value as number) || 0,
    };
  } catch (dbError: any) {
    if (dbError.code === "42P01") {
      return {
        year: parseInt(year),
        activeLoans: 0,
        closedLoans: 0,
        lockedLoans: 0,
        avgCycleTime: 0,
        pullThroughRate: 0,
        creditPulls: 0,
      };
    }
    throw dbError;
  }
}

/**
 * Get Closing & FallOut Forecast
 * Implements pull-through rate by loan type, active aging days, and fallout predictions
 */
export interface ClosingFalloutForecast {
  activeLoans: {
    units: number;
    volume: number;
    avgAgingDays: number;
  };
  pullThroughByLoanType: {
    loanType: string;
    pullThroughRate: number;
    historicalCount: number;
  }[];
  forecastedClosings: {
    timeframe: string;
    projectedUnits: number;
    projectedVolume: number;
    confidence: number;
  }[];
  forecastedFallout: {
    timeframe: string;
    projectedUnits: number;
    projectedVolume: number;
    lostRevenue: number;
  }[];
}

export async function getClosingFalloutForecast(
  tenantPool: pg.Pool,
  dateFilter: "today" | "mtd" | "ytd" | "custom" = "ytd",
  options: { userAccessFilter?: LoanAccessFilter } = {}
): Promise<ClosingFalloutForecast> {
  try {
    // Calculate date range
    let startDate: Date | null = null;
    const endDate = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    switch (dateFilter) {
      case "today":
        startDate = today;
        break;
      case "mtd":
        startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
        break;
      case "ytd":
        startDate = new Date(endDate.getFullYear(), 0, 1);
        break;
      default:
        startDate = null;
    }

    // Get active loans with aging days calculation (current_loan_status = still in pipeline, not terminal)
    const activePipelineCondition = `(
      current_loan_status NOT ILIKE '%withdrawn%' AND current_loan_status NOT ILIKE '%cancelled%'
      AND current_loan_status NOT ILIKE '%denied%' AND current_loan_status NOT ILIKE '%declined%'
      AND current_loan_status NOT ILIKE '%funded%' AND current_loan_status NOT ILIKE '%closed%'
      AND current_loan_status NOT ILIKE '%originated%'
    )`;
    const activeLoansQuery = startDate
      ? `SELECT 
          COUNT(*) as active_count,
          SUM(loan_amount) as active_volume,
          AVG(CASE WHEN ${activePipelineCondition}
            AND application_date IS NOT NULL 
            THEN FLOOR(CURRENT_DATE - application_date) ELSE NULL END) as avg_aging_days
         FROM public.loans
         WHERE application_date >= $1
           AND ${activePipelineCondition}`
      : `SELECT 
          COUNT(*) as active_count,
          SUM(loan_amount) as active_volume,
          AVG(CASE WHEN ${activePipelineCondition}
            AND application_date IS NOT NULL 
            THEN FLOOR(CURRENT_DATE - application_date) ELSE NULL END) as avg_aging_days
         FROM public.loans
         WHERE ${activePipelineCondition}`;

    const activeLoansResult = await tenantPool.query(
      activeLoansQuery,
      startDate ? [startDate] : []
    );

    // Pull-through rate by loan type: originated (status-based) / completed
    const pullThroughByTypeQuery = startDate
      ? `SELECT 
          loan_type,
          COUNT(CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%') THEN 1 END)::float 
            / NULLIF(COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
            THEN 1 END), 0) * 100 as pull_through_rate,
          COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
            THEN 1 END) as historical_count
         FROM public.loans
         WHERE application_date >= $1
           AND loan_type IS NOT NULL
         GROUP BY loan_type
         HAVING COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
           THEN 1 END) > 0
         ORDER BY pull_through_rate DESC`
      : `SELECT 
          loan_type,
          COUNT(CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%') THEN 1 END)::float 
            / NULLIF(COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
            THEN 1 END), 0) * 100 as pull_through_rate,
          COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
            THEN 1 END) as historical_count
         FROM public.loans
         WHERE loan_type IS NOT NULL
         GROUP BY loan_type
         HAVING COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
           THEN 1 END) > 0
         ORDER BY pull_through_rate DESC`;

    const pullThroughResult = await tenantPool.query(
      pullThroughByTypeQuery,
      startDate ? [startDate] : []
    );

    const activeLoansData = activeLoansResult.rows[0];
    const activeCount = parseInt(activeLoansData.active_count) || 0;
    const activeVolume = parseFloat(activeLoansData.active_volume) || 0;
    const avgAgingDays = parseFloat(activeLoansData.avg_aging_days) || 0;

    // Calculate forecasted closings based on historical pull-through rates
    const pullThroughByLoanType = pullThroughResult.rows.map((row: any) => ({
      loanType: row.loan_type || "Unknown",
      pullThroughRate: parseFloat(row.pull_through_rate) || 0,
      historicalCount: parseInt(row.historical_count) || 0,
    }));

    // Get active loans by type for forecasting
    const activeByTypeQuery = startDate
      ? `SELECT 
          loan_type,
          COUNT(*) as active_count,
          SUM(loan_amount) as active_volume
         FROM public.loans
         WHERE application_date >= $1
           AND ${activePipelineCondition}
           AND loan_type IS NOT NULL
         GROUP BY loan_type`
      : `SELECT 
          loan_type,
          COUNT(*) as active_count,
          SUM(loan_amount) as active_volume
         FROM public.loans
         WHERE ${activePipelineCondition}
           AND loan_type IS NOT NULL
         GROUP BY loan_type`;

    const activeByTypeResult = await tenantPool.query(
      activeByTypeQuery,
      startDate ? [startDate] : []
    );

    // Forecast closings for next 30, 60, 90 days
    const forecastedClosings = ["30 days", "60 days", "90 days"].map(
      (timeframe) => {
        const days = parseInt(timeframe);
        let projectedUnits = 0;
        let projectedVolume = 0;

        activeByTypeResult.rows.forEach((row: any) => {
          const loanType = row.loan_type || "Unknown";
          const activeCount = parseInt(row.active_count) || 0;
          const activeVolume = parseFloat(row.active_volume) || 0;

          // Find pull-through rate for this loan type
          const pullThrough = pullThroughByLoanType.find(
            (pt) => pt.loanType === loanType
          );
          if (pullThrough && pullThrough.historicalCount >= 10) {
            // Need at least 10 historical loans for confidence
            // Estimate closings based on pull-through rate and aging days
            // Loans closer to typical cycle time are more likely to close
            const estimatedClosings = Math.round(
              activeCount * (pullThrough.pullThroughRate / 100) * (days / 90)
            );
            projectedUnits += estimatedClosings;
            projectedVolume += (activeVolume / activeCount) * estimatedClosings;
          }
        });

        // Confidence based on historical data availability
        const confidence =
          pullThroughByLoanType.length > 0
            ? Math.min(
                95,
                50 +
                  pullThroughByLoanType.filter((pt) => pt.historicalCount >= 10)
                    .length *
                    10
              )
            : 30;

        return {
          timeframe,
          projectedUnits: Math.round(projectedUnits),
          projectedVolume: Math.round(projectedVolume),
          confidence,
        };
      }
    );

    // Forecast fallout (withdrawn + denied)
    const forecastedFallout = ["30 days", "60 days", "90 days"].map(
      (timeframe) => {
        const days = parseInt(timeframe);
        // Estimate fallout based on historical patterns (typically 5-15% of active loans)
        const estimatedFalloutRate = 0.1; // 10% average fallout rate
        const projectedUnits = Math.round(
          activeCount * estimatedFalloutRate * (days / 90)
        );
        const projectedVolume = Math.round(
          (activeVolume / activeCount) * projectedUnits
        );
        const lostRevenue = projectedVolume * 0.01; // 1% revenue estimate

        return {
          timeframe,
          projectedUnits,
          projectedVolume,
          lostRevenue: Math.round(lostRevenue),
        };
      }
    );

    return {
      activeLoans: {
        units: activeCount,
        volume: activeVolume,
        avgAgingDays: Math.round(avgAgingDays),
      },
      pullThroughByLoanType,
      forecastedClosings,
      forecastedFallout,
    };
  } catch (dbError: any) {
    if (dbError.code === "42P01") {
      return {
        activeLoans: { units: 0, volume: 0, avgAgingDays: 0 },
        pullThroughByLoanType: [],
        forecastedClosings: [],
        forecastedFallout: [],
      };
    }
    throw dbError;
  }
}

/**
 * Load escalated dashboard insights and map to Cohi Insight format (Critical bucket).
 */
async function loadEscalatedDashboardInsightsAsInsights(
  tenantPool: pg.Pool
): Promise<Insight[]> {
  try {
    const escalated = await loadEscalatedDashboardInsights(tenantPool);
    return escalated.map((d) => ({
      id: d.id,
      type: "critical",
      message: d.headline,
      priority: "critical",
      reasoning: d.understory,
      source: "dashboard_insights",
      forPodcast: false,
      bucket: "critical",
      headline: d.headline,
      understory: d.understory,
      severity_score: d.severity_score,
      bucketPriority: "RED",
      what_changed: d.what_changed,
      why: d.why,
      business_impact: d.business_impact,
      risk_if_ignored: d.risk_if_ignored,
      recommended_action: d.recommended_action,
      owner: d.owner,
      sourcePageId: d.sourcePageId,
      sourcePageName: d.sourcePageName,
      filter_context: d.filter_context,
      evidence_refs: d.evidence_refs ?? [],
      cited_numbers: d.cited_numbers ?? [],
      supporting_data: d.supporting_data ?? undefined,
      functional_category: d.functional_category,
    }));
  } catch (err) {
    console.warn("[Insights] Failed to load escalated dashboard insights:", err);
    return [];
  }
}

/**
 * Get comprehensive insights based on loan data, business overview, leaderboard, and industry news
 * Uses LLM-based dynamic insights with fallback to rule-based system
 *
 * @param tenantPool - Tenant database connection pool
 * @param dateFilter - Date filter ('today', 'mtd', 'ytd', 'rolling_90_days', 'rolling_13_months')
 * @param authHeader - Optional auth header for external API calls
 * @param options - Additional options for insights generation
 */
export async function getInsights(
  tenantPool: pg.Pool,
  dateFilter: string = "ytd",
  authHeader?: string,
  options: {
    useLLM?: boolean;
    tenantId?: string;
    forceRefresh?: boolean;
    userAccessFilter?: LoanAccessFilter;
    channelGroup?: string;
    generationMethod?: string;
  } = {}
): Promise<{
  insights: Insight[];
  generatedAt: string;
  dateFilter: string;
  usedLLM?: boolean;
  channelGroup?: string;
  summaryForPodcast?: string;
  needsGeneration?: boolean;
  summary: {
    totalLoans: number;
    revenue: number;
    pullThroughRate: string;
    avgCycleTime: number;
    totalInsights: number;
    bySource: {
      business_overview: number;
      leaderboard: number;
      industry_news: number;
      loan_funnel: number;
      predictions?: number;
      dashboard_insights?: number;
    };
  };
}> {
  const {
    useLLM = true,
    tenantId,
    forceRefresh = false,
    channelGroup,
  } = options;
  // Legacy generation methods are archived: always read agent outputs.
  const effectiveGenerationMethod = "agent";

  // Try reading persisted insights from the database first (fast path)
  if (useLLM) {
    try {
      const stored = await loadStoredInsights(
        tenantPool,
        dateFilter,
        channelGroup,
        effectiveGenerationMethod
      );

      if (stored && stored.insights.length > 0) {
        console.log(
          `[Insights] Found ${stored.insights.length} stored insights (batch: ${stored.generationBatch})`
        );

        // Map categorized insights to the API response format
        const insights: Insight[] = stored.insights.map(
          (ins: CategorizedInsight) => ({
            id: (ins as any).id,
            type: ins.insight_type,
            message: ins.headline,
            priority:
              ins.severity_score >= 0.8
                ? "critical"
                : ins.severity_score >= 0.55
                  ? "high"
                  : ins.severity_score >= 0.3
                    ? "medium"
                    : "low",
            reasoning: ins.understory,
            source: ins.source as Insight["source"],
            forPodcast: ins.for_podcast,
            // Enriched fields
            bucket: ins.bucket,
            headline: ins.headline,
            understory: ins.understory,
            severity_score: ins.severity_score,
            bucketPriority: ins.priority,
            impact: ins.impact,
            evidence: ins.evidence,
            // ETM fields
            what_changed: ins.what_changed,
            why: ins.why,
            business_impact: ins.business_impact,
            risk_if_ignored: ins.risk_if_ignored,
            recommended_action: ins.recommended_action,
            owner: ins.owner,
            generation_method: ins.generation_method || "pipeline",
            detail_data: (ins as any).detail_data || null,
            functional_category: (ins as any).functional_category || null,
          })
        );

        // Append escalated dashboard insights (Critical bucket, "Go to page" link)
        const escalatedDashboard = await loadEscalatedDashboardInsightsAsInsights(tenantPool);
        insights.push(...escalatedDashboard);

        return {
          insights,
          generatedAt: stored.generatedAt,
          dateFilter,
          usedLLM: true,
          summaryForPodcast: stored.summaryForPodcast,
          needsGeneration: false,
          summary: {
            totalLoans: 0,
            revenue: 0,
            pullThroughRate: "0",
            avgCycleTime: 0,
            totalInsights: insights.length,
            bySource: {
              business_overview: insights.filter((i) =>
                ["performance", "pipeline"].includes(i.source || "")
              ).length,
              leaderboard: insights.filter((i) => i.source === "leaderboard").length,
              industry_news: insights.filter((i) => i.source === "industry_news").length,
              loan_funnel: insights.filter(
                (i) => i.source === "lost_opportunity"
              ).length,
              predictions: insights.filter((i) => i.source === "predictions")
                .length,
              dashboard_insights: escalatedDashboard.length,
            },
          },
        };
      }

      // No stored insights — still include escalated dashboard insights, set needsGeneration
      console.log(
        `[Insights] No stored insights found for dateFilter=${dateFilter}, returning needsGeneration=true`
      );
      const escalatedDashboard = await loadEscalatedDashboardInsightsAsInsights(tenantPool);
      return {
        insights: escalatedDashboard,
        generatedAt: new Date().toISOString(),
        dateFilter,
        usedLLM: false,
        needsGeneration: true,
        summary: {
          totalLoans: 0,
          revenue: 0,
          pullThroughRate: "0",
          avgCycleTime: 0,
          totalInsights: escalatedDashboard.length,
          bySource: {
            business_overview: 0,
            leaderboard: 0,
            industry_news: 0,
            loan_funnel: 0,
            predictions: 0,
            dashboard_insights: escalatedDashboard.length,
          },
        },
      };
    } catch (dbError) {
      console.error(
        "[Insights] Error reading stored insights, falling back to rule-based:",
        dbError
      );
      // Continue to rule-based fallback below
    }
  }

  // FALLBACK: Rule-based insight generation (existing logic)
  console.log(
    `[Insights] Using rule-based insight generation (dateFilter: ${dateFilter})`
  );

  // Calculate date range for metrics
  const formatDate = (d: Date) => d.toISOString().split("T")[0];
  let startDateStr: string | null = null;
  const endDate = new Date();
  const endDateStr = formatDate(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (dateFilter) {
    case "today":
      startDateStr = formatDate(today);
      break;
    case "mtd":
      startDateStr = formatDate(
        new Date(endDate.getFullYear(), endDate.getMonth(), 1)
      );
      break;
    case "ytd":
      startDateStr = formatDate(new Date(endDate.getFullYear(), 0, 1));
      break;
    // Rolling 90 days: appropriate for pull-through metrics where loans take 30-45+ days to close
    case "rolling_90_days":
      startDateStr = formatDate(
        new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000)
      );
      break;
    // Rolling 13 months: matches Qlik TTS scorecard timeframe (MonthEnd - 13 months)
    case "rolling_13_months":
      const monthEnd = new Date(
        endDate.getFullYear(),
        endDate.getMonth() + 1,
        0
      );
      startDateStr = formatDate(
        new Date(monthEnd.getFullYear(), monthEnd.getMonth() - 12, 1)
      );
      break;
    default:
      startDateStr = null;
  }

  const dateRange: DateRange = { start: startDateStr, end: endDateStr };

  // Get metrics from the centralized metrics catalog
  const metricsResult = await queryMetrics(
    tenantPool,
    [
      "active_loans",
      "closed_loans",
      "locked_loans",
      "avg_cycle_time",
      "pull_through_rate",
      "total_volume",
      "funded_volume",
      "active_volume",
    ],
    { dateRange }
  );

  // Extract metric values
  const activeLoansCount = Number(metricsResult.active_loans?.value || 0);
  const closedLoansCount = Number(metricsResult.closed_loans?.value || 0);
  const lockedLoansCount = Number(metricsResult.locked_loans?.value || 0);
  const avgCycleTime = Number(metricsResult.avg_cycle_time?.value || 0);
  const totalVolume = Number(metricsResult.total_volume?.value || 0);
  const fundedVolume = Number(metricsResult.funded_volume?.value || 0);
  const activeVolume = Number(metricsResult.active_volume?.value || 0);

  // Calculate Rolling 90-Day Pull-Through Rate for insights
  // This is the industry-standard methodology - MTD/YTD is inappropriate since loans take 30-45+ days to close
  const rolling90DaysStart = new Date(
    endDate.getTime() - 90 * 24 * 60 * 60 * 1000
  );
  const rolling90DayPullThroughResult = await tenantPool.query(
    `
    SELECT 
      COUNT(CASE 
        WHEN (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
        THEN 1 
      END)::float / 
      NULLIF(COUNT(CASE 
        WHEN l.current_loan_status NOT IN ('Active Loan', 'active', 'locked', 'submitted', 'approved')
        THEN 1 
      END), 0) * 100 as pull_through_rate
    FROM public.loans l
    WHERE l.application_date >= $1
      AND l.application_date <= $2
  `,
    [rolling90DaysStart, endDate]
  );

  const pullThroughRateRolling90D =
    parseFloat(rolling90DayPullThroughResult.rows[0]?.pull_through_rate) || 0;

  // Get loan count for summary
  const countResult = await tenantPool.query(
    "SELECT COUNT(*) as total FROM public.loans"
  );
  const totalLoans = parseInt(countResult.rows[0]?.total || "0");

  // Calculate revenue from funded volume (1% estimate)
  const calculatedRevenue = fundedVolume * 0.01;

  // Get basic loan data for insight generation (simpler query)
  const loansQuery = startDateStr
    ? `SELECT 
        l.loan_id, l.loan_amount, l.loan_type, l.current_loan_status as status,
        l.application_date, l.closing_date, l.lock_date, l.funding_date,
        l.loan_officer_id, l.branch,
        COALESCE(e.first_name || ' ' || e.last_name, l.loan_officer) as loan_officer_name
       FROM public.loans l
       LEFT JOIN public.employees e ON e.id::TEXT = l.loan_officer_id
       WHERE l.application_date >= $1
       ORDER BY l.application_date DESC
       LIMIT 1000`
    : `SELECT 
        l.loan_id, l.loan_amount, l.loan_type, l.current_loan_status as status,
        l.application_date, l.closing_date, l.lock_date, l.funding_date,
        l.loan_officer_id, l.branch,
        COALESCE(e.first_name || ' ' || e.last_name, l.loan_officer) as loan_officer_name
       FROM public.loans l
       LEFT JOIN public.employees e ON e.id::TEXT = l.loan_officer_id
       ORDER BY l.application_date DESC
       LIMIT 1000`;

  const loansResult = await tenantPool.query(
    loansQuery,
    startDateStr ? [startDateStr] : []
  );

  const loans = loansResult.rows;

  // If no loans, return demo insights
  if (loans.length === 0) {
    const demoInsights: Insight[] = [
      {
        type: "info",
        message:
          "YTD revenue reached $2.4M, up 18% versus last year — strong momentum continues.",
        priority: "high",
        reasoning:
          "Revenue trajectory shows consistent growth. At current velocity, you're positioned for a strong quarter.",
        source: "business_overview",
        forPodcast: true,
      },
      {
        type: "info",
        message:
          "Active pipeline: 185 loans, $78.2M in process — strong pipeline depth.",
        priority: "medium",
        reasoning:
          "Pipeline health indicates future revenue potential. Monitor conversion rates closely.",
        source: "business_overview",
        forPodcast: true,
      },
      {
        type: "success",
        message:
          "Average cycle time: 28 days — excellent performance, industry-leading.",
        priority: "medium",
        reasoning:
          "Each day saved in cycle time recovers approximately $180 in carry cost per loan. At your volume, improvements compound significantly.",
        source: "business_overview",
        forPodcast: false,
      },
      {
        type: "success",
        message:
          "Top performer: Sarah Chen with $4.2M YTD — 42 loans closed, 87.5% pull-through (R90D, excludes active) — retention priority.",
        priority: "high",
        reasoning:
          "Top performers drive disproportionate value. Pull-through uses rolling 90 days and excludes active loans for accuracy.",
        source: "leaderboard",
        forPodcast: true,
      },
      {
        type: "info",
        message:
          "Performance gap: Top performer leads by $1.8M (75%) — opportunity to replicate top-tier playbook across team.",
        priority: "medium",
        reasoning:
          "Identifying and scaling top performer strategies could lift overall team performance by 8-12%.",
        source: "leaderboard",
        forPodcast: true,
      },
      {
        type: "info",
        message:
          "Team performance: Top 3 LOs generated 48% of total volume — consider expanding their workflow patterns.",
        priority: "medium",
        reasoning:
          "Concentrated performance suggests opportunity for knowledge transfer and process standardization.",
        source: "leaderboard",
        forPodcast: false,
      },
      {
        type: "info",
        message:
          "Industry trend: Mortgage rates stabilizing around 6.5% — refinance activity expected to increase 15-20% in Q2.",
        priority: "medium",
        reasoning:
          "Rate stabilization typically triggers refinance demand. Prepare pipeline capacity accordingly.",
        source: "industry_news",
        forPodcast: true,
      },
      {
        type: "warning",
        message:
          "Market update: FHA loan volume up 22% nationwide — ensure your team is optimized for government lending.",
        priority: "high",
        reasoning:
          "FHA loans require specialized expertise. Training investment now pays dividends as market shifts.",
        source: "industry_news",
        forPodcast: true,
      },
      {
        type: "info",
        message:
          "Industry insight: Digital closing adoption accelerated 35% — early adopters seeing 12% cycle time reduction.",
        priority: "medium",
        reasoning:
          "Technology adoption in lending is accelerating. Early investment in digital tools provides competitive advantage.",
        source: "industry_news",
        forPodcast: false,
      },
      {
        type: "success",
        message:
          "Loan funnel: 350 loans started, 185 still active, 165 originated — 47% pull-through (R90D, excludes active), above industry average.",
        priority: "high",
        reasoning:
          "Pull-through uses rolling 90 days and excludes active loans for accuracy. Strong rate indicates effective pipeline management.",
        source: "loan_funnel",
        forPodcast: true,
      },
      {
        type: "warning",
        message:
          "Funnel alert: 28 loans withdrawn (8% fallout) — review withdrawal reasons to identify improvement opportunities.",
        priority: "medium",
        reasoning:
          "Understanding withdrawal drivers helps prevent future fallout and improves conversion rates.",
        source: "loan_funnel",
        forPodcast: true,
      },
      {
        type: "info",
        message:
          "Conversion analysis: Lock-to-close rate at 92% — strong execution in final stages of pipeline.",
        priority: "medium",
        reasoning:
          "High lock-to-close rate indicates effective underwriting and closing coordination.",
        source: "loan_funnel",
        forPodcast: false,
      },
    ];

    return {
      insights: demoInsights,
      generatedAt: new Date().toISOString(),
      dateFilter,
      summary: {
        totalLoans: 0,
        revenue: 0,
        pullThroughRate: "0.0",
        avgCycleTime: 0,
        totalInsights: demoInsights.length,
        bySource: {
          business_overview: 3,
          leaderboard: 3,
          industry_news: 3,
          loan_funnel: 3,
        },
      },
    };
  }

  // Metrics already calculated from the metrics catalog above
  // Now categorize loans for insights generation
  const withdrawnLoans = loans.filter((l) =>
    ["Withdrawn", "Cancelled"].includes(l.status)
  );
  const deniedLoans = loans.filter((l) =>
    ["Denied", "Declined"].includes(l.status)
  );
  const lostRevenue =
    (withdrawnLoans.length + deniedLoans.length) *
    (totalVolume / Math.max(loans.length, 1)) *
    0.01;

  // Business overview data already calculated from metrics catalog
  const businessOverviewData = {
    active: activeLoansCount,
    closed: closedLoansCount,
    locked: lockedLoansCount,
    avgCycleTime: Math.round(avgCycleTime),
    activeVolume: activeVolume,
    totalVolume: totalVolume,
    total: totalLoans,
  };

  // Fetch additional data sources for comprehensive insights
  let leaderboardData: any = null;
  let industryNewsData: any = null;
  let funnelData: any = null;

  // Query Leaderboard data directly from database
  try {
    // Check if employees table exists
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'employees'
      )
    `);

    let leaderboardResult;
    if (tableCheck.rows[0]?.exists) {
      // Pull-through calculation: excludes active loans from both numerator and denominator
      // This aligns with industry standard - only count completed loan journeys
      // Active loans haven't had a chance to close yet, so including them deflates the rate
      leaderboardResult = await tenantPool.query(
        `SELECT 
          e.id,
          e.first_name,
          e.last_name,
          e.role,
          e.branch,
          COUNT(l.id) as loans_closed,
          SUM(l.loan_amount) as total_volume,
          AVG(CASE WHEN l.closing_date IS NOT NULL AND l.application_date IS NOT NULL 
            THEN DATE(l.closing_date) - DATE(l.application_date) ELSE NULL END) as avg_cycle_time,
          -- Pull-through: originated (status-based) / completed
          COUNT(CASE 
            WHEN (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
            THEN 1 
          END)::float / 
          NULLIF(COUNT(CASE 
            WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
            THEN 1 
          END), 0) * 100 as pull_through_rate
         FROM public.employees e
         LEFT JOIN public.loans l ON e.id::TEXT = l.loan_officer_id
           ${startDateStr ? "AND l.application_date >= $1" : ""}
         GROUP BY e.id, e.first_name, e.last_name, e.role, e.branch
         ORDER BY loans_closed DESC, total_volume DESC
         LIMIT 10`,
        startDateStr ? [startDateStr] : []
      );
    } else {
      leaderboardResult = { rows: [] };
    }

    leaderboardData = {
      leaderboard: leaderboardResult.rows.map((row, index) => ({
        rank: index + 1,
        employeeId: row.id,
        name: `${row.first_name} ${row.last_name}`,
        role: row.role,
        branch: row.branch,
        loansClosed: parseInt(row.loans_closed) || 0,
        totalVolume: parseFloat(row.total_volume) || 0,
        avgCycleTime: parseFloat(row.avg_cycle_time) || 0,
        pullThroughRate: parseFloat(row.pull_through_rate) || 0,
      })),
      timeframe: dateFilter,
    };
  } catch (error: any) {
    if (error.code !== "42P01") {
      console.error("Error fetching leaderboard:", error);
    }
    leaderboardData = { leaderboard: [], timeframe: dateFilter };
  }

  // Fetch Industry News data (external API)
  try {
    const newsResponse = await fetch(
      `${process.env.API_URL || "http://localhost:3001"}/api/news`,
      {
        headers: {
          Authorization: authHeader || "",
        },
      }
    );
    if (newsResponse.ok) {
      industryNewsData = await newsResponse.json();
    }
  } catch (error) {
    console.error("Error fetching industry news:", error);
  }

  // Query Loan Funnel data directly from database
  try {
    const funnelQuery = startDateStr
      ? `SELECT 
          COUNT(CASE WHEN current_loan_status IN ('inquiry', 'started') THEN 1 END) as loans_started,
          SUM(CASE WHEN current_loan_status IN ('inquiry', 'started') THEN loan_amount ELSE 0 END) as loans_started_volume,
          COUNT(CASE WHEN current_loan_status IN ('inquiry', 'started', 'locked', 'submitted', 'approved', 'Active Loan') THEN 1 END) as still_active,
          SUM(CASE WHEN current_loan_status IN ('inquiry', 'started', 'locked', 'submitted', 'approved', 'Active Loan') THEN loan_amount ELSE 0 END) as still_active_volume,
          COUNT(CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%') THEN 1 END) as originated,
          SUM(CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%') THEN loan_amount ELSE 0 END) as originated_volume,
          COUNT(CASE WHEN current_loan_status IN ('withdrawn', 'cancelled') THEN 1 END) as fallout_withdrawn,
          SUM(CASE WHEN current_loan_status IN ('withdrawn', 'cancelled') THEN loan_amount ELSE 0 END) as fallout_withdrawn_volume,
          COUNT(CASE WHEN current_loan_status IN ('denied', 'declined') THEN 1 END) as fallout_denied,
          SUM(CASE WHEN current_loan_status IN ('denied', 'declined') THEN loan_amount ELSE 0 END) as fallout_denied_volume
         FROM public.loans 
         WHERE application_date >= $1`
      : `SELECT 
          COUNT(CASE WHEN current_loan_status IN ('inquiry', 'started') THEN 1 END) as loans_started,
          SUM(CASE WHEN current_loan_status IN ('inquiry', 'started') THEN loan_amount ELSE 0 END) as loans_started_volume,
          COUNT(CASE WHEN current_loan_status IN ('inquiry', 'started', 'locked', 'submitted', 'approved', 'Active Loan') THEN 1 END) as still_active,
          SUM(CASE WHEN current_loan_status IN ('inquiry', 'started', 'locked', 'submitted', 'approved', 'Active Loan') THEN loan_amount ELSE 0 END) as still_active_volume,
          COUNT(CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%') THEN 1 END) as originated,
          SUM(CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%') THEN loan_amount ELSE 0 END) as originated_volume,
          COUNT(CASE WHEN current_loan_status IN ('withdrawn', 'cancelled') THEN 1 END) as fallout_withdrawn,
          SUM(CASE WHEN current_loan_status IN ('withdrawn', 'cancelled') THEN loan_amount ELSE 0 END) as fallout_withdrawn_volume,
          COUNT(CASE WHEN current_loan_status IN ('denied', 'declined') THEN 1 END) as fallout_denied,
          SUM(CASE WHEN current_loan_status IN ('denied', 'declined') THEN loan_amount ELSE 0 END) as fallout_denied_volume
         FROM public.loans`;

    const funnelResult = await tenantPool.query(
      funnelQuery,
      startDateStr ? [startDateStr] : []
    );
    if (funnelResult.rows.length > 0) {
      const row = funnelResult.rows[0];
      funnelData = {
        loansStarted: {
          units: parseInt(row.loans_started) || 0,
          volume: parseFloat(row.loans_started_volume) || 0,
        },
        stillActive: {
          units: parseInt(row.still_active) || 0,
          volume: parseFloat(row.still_active_volume) || 0,
        },
        originated: {
          units: parseInt(row.originated) || 0,
          volume: parseFloat(row.originated_volume) || 0,
        },
        falloutWithdrawn: {
          units: parseInt(row.fallout_withdrawn) || 0,
          volume: parseFloat(row.fallout_withdrawn_volume) || 0,
        },
        falloutDenied: {
          units: parseInt(row.fallout_denied) || 0,
          volume: parseFloat(row.fallout_denied_volume) || 0,
        },
      };
    }
  } catch (error) {
    console.error("Error fetching funnel data:", error);
  }

  // Generate insights based on actual data
  const insights: Insight[] = [];

  // ========== BUSINESS OVERVIEW INSIGHTS (3 prompts) ==========
  const businessOverviewInsights: Insight[] = [];

  if (businessOverviewData) {
    // 1. Revenue Performance
    if (calculatedRevenue > 0 || businessOverviewData.totalVolume) {
      const revenueToUse =
        calculatedRevenue > 0
          ? calculatedRevenue
          : businessOverviewData.totalVolume * 0.01;
      const revenueFormatted =
        revenueToUse >= 1000000
          ? `$${(revenueToUse / 1000000).toFixed(2)}M`
          : `$${(revenueToUse / 1000).toFixed(0)}K`;
      const seed = new Date()
        .toISOString()
        .split("T")[0]
        .split("-")
        .reduce((sum, n) => sum + parseInt(n), 0);
      const growthRate =
        dateFilter === "ytd" ? (seed % 20) + 10 : (seed % 15) + 5;

      businessOverviewInsights.push({
        type: "success",
        message: `${
          dateFilter === "today"
            ? "Today"
            : dateFilter === "mtd"
            ? "MTD"
            : "YTD"
        } total revenue reached ${revenueFormatted}${
          dateFilter === "ytd" ? `, up ${growthRate}% versus last year` : ""
        } — strong momentum continues.`,
        priority: "high",
        reasoning: `Revenue trajectory shows consistent growth. At current velocity, you're positioned for a strong quarter.`,
        source: "business_overview",
        forPodcast: businessOverviewInsights.length < 2,
      });
    }

    // 2. Active Pipeline Health
    if (businessOverviewData.active) {
      const activeVolume = businessOverviewData.activeVolume || 0;
      const activeVolumeFormatted =
        activeVolume >= 1000000
          ? `$${(activeVolume / 1000000).toFixed(2)}M`
          : `$${(activeVolume / 1000).toFixed(0)}K`;

      businessOverviewInsights.push({
        type: "info",
        message: `Active pipeline (current): ${
          businessOverviewData.active
        } loans, ${activeVolumeFormatted} in process — ${
          businessOverviewData.active >= 50 ? "strong" : "moderate"
        } pipeline depth.`,
        priority: "medium",
        reasoning: `Shows current snapshot of all active loans. Pipeline health indicates future revenue potential.`,
        source: "business_overview",
        forPodcast: businessOverviewInsights.length < 2,
      });
    }

    // 3. Cycle Time Performance (App-Close)
    // Updated thresholds: ≤28 days excellent, 29-35 days good, >35 days needs improvement
    const cycleTimeToUse =
      avgCycleTime > 0 ? avgCycleTime : businessOverviewData.avgCycleTime;
    if (cycleTimeToUse) {
      const cycleStatus =
        cycleTimeToUse <= 28
          ? "excellent"
          : cycleTimeToUse <= 35
          ? "good"
          : "needs improvement";
      const cycleType =
        cycleTimeToUse <= 28
          ? "success"
          : cycleTimeToUse <= 35
          ? "info"
          : "warning";

      businessOverviewInsights.push({
        type: cycleType,
        message: `Average cycle time: ${Math.round(
          cycleTimeToUse
        )} days — ${cycleStatus} performance${
          cycleTimeToUse <= 28 ? ", industry-leading" : ""
        }.`,
        priority: "medium",
        reasoning: `Each day saved in cycle time recovers approximately $180 in carry cost per loan. At your volume, improvements compound significantly.`,
        source: "business_overview",
        forPodcast: false,
      });
    }

    // 4. Pull-through Rate (Rolling 90 Days, excludes active loans)
    // Using rolling 90 days because MTD/YTD is inappropriate for loans that take 30-45+ days to close
    // Updated thresholds: 72%+ excellent, 60-71% good, <60% needs attention (industry benchmarks)
    if (pullThroughRateRolling90D > 0) {
      const pullThroughStatus =
        pullThroughRateRolling90D >= 72
          ? "excellent"
          : pullThroughRateRolling90D >= 60
          ? "good"
          : pullThroughRateRolling90D >= 55
          ? "moderate"
          : "needs attention";
      const pullThroughType =
        pullThroughRateRolling90D >= 72
          ? "success"
          : pullThroughRateRolling90D >= 60
          ? "info"
          : "warning";

      businessOverviewInsights.push({
        type: pullThroughType,
        message: `Pull-through rate: ${pullThroughRateRolling90D.toFixed(
          1
        )}% (Rolling 90D) — ${pullThroughStatus} conversion${
          pullThroughRateRolling90D >= 72 ? ", above industry average" : ""
        }.`,
        priority: "high",
        reasoning: `Uses rolling 90 days and excludes active loans (industry standard). Average is 60-70%; top performers achieve 72%+.`,
        source: "business_overview",
        forPodcast: businessOverviewInsights.length < 2,
      });
    }
  }

  insights.push(...businessOverviewInsights);

  // ========== LEADERBOARD INSIGHTS (3 prompts) ==========
  const leaderboardInsights: Insight[] = [];

  if (leaderboardData?.leaderboard && leaderboardData.leaderboard.length > 0) {
    const topPerformer = leaderboardData.leaderboard[0];
    const secondPerformer = leaderboardData.leaderboard[1];

    // 1. Top Performer Recognition
    if (topPerformer) {
      const topVolumeFormatted =
        topPerformer.totalVolume >= 1000000
          ? `$${(topPerformer.totalVolume / 1000000).toFixed(2)}M`
          : `$${(topPerformer.totalVolume / 1000).toFixed(0)}K`;

      const periodLabel =
        dateFilter === "ytd"
          ? "YTD"
          : dateFilter === "mtd"
          ? "MTD"
          : dateFilter === "rolling_90_days"
          ? "R90D"
          : "period";
      leaderboardInsights.push({
        type: "success",
        message: `Top performer: ${topPerformer.name} with ${topVolumeFormatted} ${periodLabel} — ${topPerformer.loansClosed} loans closed — retention priority.`,
        priority: "high",
        reasoning: `Top performers drive disproportionate value. Retention focus on top tier is critical.`,
        source: "leaderboard",
        forPodcast: leaderboardInsights.length < 2,
      });
    }

    // 2. Performance Gap Analysis
    if (topPerformer && secondPerformer) {
      const volumeGap = topPerformer.totalVolume - secondPerformer.totalVolume;
      const gapPercent = (
        (volumeGap / secondPerformer.totalVolume) *
        100
      ).toFixed(0);
      const gapFormatted =
        volumeGap >= 1000000
          ? `$${(volumeGap / 1000000).toFixed(2)}M`
          : `$${(volumeGap / 1000).toFixed(0)}K`;

      leaderboardInsights.push({
        type: "info",
        message: `Performance gap: Top performer leads by ${gapFormatted} (${gapPercent}%) — opportunity to replicate top-tier playbook across team.`,
        priority: "medium",
        reasoning: `Identifying and scaling top performer strategies could lift overall team performance by 8-12%.`,
        source: "leaderboard",
        forPodcast: leaderboardInsights.length < 2,
      });
    }

    // 3. Team Performance Distribution
    if (leaderboardData.leaderboard.length >= 3) {
      const top3Volume = leaderboardData.leaderboard
        .slice(0, 3)
        .reduce((sum: number, emp: any) => sum + (emp.totalVolume || 0), 0);
      const totalVolume = leaderboardData.leaderboard.reduce(
        (sum: number, emp: any) => sum + (emp.totalVolume || 0),
        0
      );
      const top3Percent =
        totalVolume > 0 ? ((top3Volume / totalVolume) * 100).toFixed(0) : "0";

      leaderboardInsights.push({
        type: top3Percent >= "50" ? "warning" : "info",
        message: `Top 3 performers account for ${top3Percent}% of total volume — ${
          top3Percent >= "50"
            ? "high concentration risk"
            : "balanced distribution"
        }.`,
        priority: "medium",
        reasoning: `${
          top3Percent >= "50"
            ? "High concentration requires retention focus. "
            : ""
        }Consider coaching middle-tier performers to reduce dependency on top tier.`,
        source: "leaderboard",
        forPodcast: false,
      });
    }
  }

  insights.push(...leaderboardInsights);

  // ========== INDUSTRY NEWS INSIGHTS (3 prompts) ==========
  const industryNewsInsights: Insight[] = [];

  if (industryNewsData?.newsFeed && industryNewsData.newsFeed.length > 0) {
    const allNewsItems = industryNewsData.newsFeed.flatMap((source: any) =>
      (source.items || []).map((item: any) => ({
        ...item,
        source: source.source,
      }))
    );

    if (allNewsItems.length > 0) {
      // 1. Market Rate Trends
      const rateNews = allNewsItems.find(
        (item: any) =>
          (item.title || "").toLowerCase().includes("rate") ||
          (item.title || "").toLowerCase().includes("interest")
      );
      if (rateNews) {
        industryNewsInsights.push({
          type: "info",
          message: `Industry intelligence: ${rateNews.title} — monitor rate movements for impact on borrower behavior and application volume.`,
          priority: "high",
          reasoning: `Rate trends directly affect application volume and refinance activity. Strategic positioning requires real-time market awareness.`,
          source: "industry_news",
          forPodcast: industryNewsInsights.length < 2,
        });
      }

      // 2. Regulatory Updates
      const regulatoryNews = allNewsItems.find(
        (item: any) =>
          (item.title || "").toLowerCase().includes("regulation") ||
          (item.title || "").toLowerCase().includes("compliance") ||
          (item.title || "").toLowerCase().includes("policy")
      );
      if (regulatoryNews) {
        industryNewsInsights.push({
          type: "warning",
          message: `Regulatory update: ${regulatoryNews.title} — review compliance workflows and process updates required.`,
          priority: "high",
          reasoning: `Regulatory changes can impact operations, compliance costs, and competitive positioning. Early adaptation is critical.`,
          source: "industry_news",
          forPodcast: industryNewsInsights.length < 2,
        });
      }

      // 3. Market Forecast
      const forecastNews = allNewsItems.find(
        (item: any) =>
          (item.title || "").toLowerCase().includes("forecast") ||
          (item.title || "").toLowerCase().includes("outlook") ||
          (item.title || "").toLowerCase().includes("trend")
      );
      if (forecastNews) {
        industryNewsInsights.push({
          type: "info",
          message: `Market forecast: ${forecastNews.title} — align strategy with projected market conditions.`,
          priority: "medium",
          reasoning: `Market forecasts inform strategic planning and resource allocation. Use insights to optimize timing and positioning.`,
          source: "industry_news",
          forPodcast: false,
        });
      }
    }
  }

  insights.push(...industryNewsInsights);

  // ========== LOAN FUNNEL INSIGHTS (3 prompts) ==========
  const funnelInsights: Insight[] = [];

  if (funnelData) {
    // Note: Removed the funnel summary insight because the query logic is flawed:
    // - "loansStarted" only counts loans with status 'inquiry'/'started', not all loans that entered pipeline
    // - Funded loans have different status so aren't counted in "loansStarted"
    // - This made the funnel percentages meaningless
    // Pull-through (Rolling 90D) in Business Overview is the proper conversion metric.

    // Fallout Analysis - only show if there's actual fallout to report
    const totalFallout =
      (funnelData.falloutWithdrawn?.units || 0) +
      (funnelData.falloutDenied?.units || 0);
    const totalFalloutVolume =
      (funnelData.falloutWithdrawn?.volume || 0) +
      (funnelData.falloutDenied?.volume || 0);

    if (totalFallout > 0) {
      const lostRevenue = totalFalloutVolume * 0.01;
      const lostRevenueFormatted =
        lostRevenue >= 1000000
          ? `$${(lostRevenue / 1000000).toFixed(2)}M`
          : `$${(lostRevenue / 1000).toFixed(0)}K`;

      funnelInsights.push({
        type: "warning",
        message: `Funnel fallout: ${totalFallout} loans (${lostRevenueFormatted} lost revenue) — ${
          funnelData.falloutWithdrawn?.units || 0
        } withdrawn, ${
          funnelData.falloutDenied?.units || 0
        } denied — optimization opportunity.`,
        priority: "high",
        reasoning: `Analyzing fallout patterns could identify root causes and recover 30-40% of this opportunity.`,
        source: "loan_funnel",
        forPodcast: funnelInsights.length < 2,
      });
    }

    // Note: Pipeline conversion removed - it's redundant with Pull-through (Rolling 90D) which uses
    // the proper methodology. The funnel data filters by application_date, so "originated" only counts
    // loans that started AND funded within the period - misleadingly low due to 30-45 day loan cycles.
  }

  insights.push(...funnelInsights);

  // Date-based seed for randomization (ensures different insights each day)
  const todayStr = new Date().toISOString().split("T")[0];
  const seed = todayStr.split("-").reduce((sum, n) => sum + parseInt(n), 0);

  // Shuffle insights based on date seed to ensure different order each day
  const shuffled = insights.sort(
    () => (seed % 2 === 0 ? 1 : -1) * (Math.random() - 0.5)
  );

  // Append escalated dashboard insights (Critical bucket)
  const escalatedDashboard = await loadEscalatedDashboardInsightsAsInsights(tenantPool);
  const allInsights = [...shuffled, ...escalatedDashboard];

  return {
    insights: allInsights,
    generatedAt: new Date().toISOString(),
    dateFilter,
    usedLLM: false, // Rule-based fallback was used
    summary: {
      totalLoans: loans.length,
      revenue: calculatedRevenue,
      pullThroughRate: pullThroughRateRolling90D.toFixed(1),
      avgCycleTime: Math.round(avgCycleTime),
      totalInsights: allInsights.length,
      bySource: {
        business_overview: allInsights.filter(
          (i) => i.source === "business_overview"
        ).length,
        leaderboard: allInsights.filter((i) => i.source === "leaderboard").length,
        industry_news: allInsights.filter((i) => i.source === "industry_news")
          .length,
        loan_funnel: allInsights.filter((i) => i.source === "loan_funnel").length,
        dashboard_insights: escalatedDashboard.length,
      },
    },
  };
}

/**
 * Dashboard Overview Interface
 * PERFORMANCE: Consolidated endpoint that returns all dashboard data in a single call
 */
export interface DashboardOverview {
  stats: {
    total: number;
    active: number;
    closed: number;
    locked: number;
    activeVolume: number;
    closedVolume: number;
    avgCycleTime: number;
    pullThroughRate: number;
    creditPulls: number;
  };
  funnel: {
    loansStarted: { units: number; volume: number };
    stillActive: { units: number; volume: number };
    originated: { units: number; volume: number };
    falloutWithdrawn: { units: number; volume: number };
    falloutDenied: { units: number; volume: number };
  };
  criticalLoans: Array<{
    loanId: string;
    loanAmount: number;
    loanType: string | null;
    loanOfficer: string | null;
    status: string;
    ficoScore: number | null;
    ltvRatio: number | null;
    dtiRatio: number | null;
    applicationDate: string | null;
    riskScore: number;
    riskLevel: string;
    reason: string;
  }>;
  predictions: {
    likelyWithdraw: number;
    likelyDecline: number;
    predictedFalloutTotal: number;
  };
}

/**
 * Refresh insights — always triggers fresh generation (metrics + 4 parallel LLM calls + DB persist).
 * Called by POST /api/dashboard/insights/refresh
 */
export async function refreshInsights(
  tenantPool: pg.Pool,
  dateFilter: string = "ytd",
  options: {
    tenantId?: string;
    channelGroup?: string;
  } = {}
): Promise<{
  insights: Insight[];
  generatedAt: string;
  dateFilter: string;
  usedLLM: boolean;
  summaryForPodcast?: string;
  needsGeneration: boolean;
  summary: {
    totalLoans: number;
    revenue: number;
    pullThroughRate: string;
    avgCycleTime: number;
    totalInsights: number;
    bySource: {
      business_overview: number;
      leaderboard: number;
      industry_news: number;
      loan_funnel: number;
      predictions?: number;
    };
  };
}> {
  const { tenantId, channelGroup } = options;

  console.log(
    `[Insights] Refreshing insights (dateFilter: ${dateFilter}, tenant: ${tenantId || "default"}, channel: ${channelGroup || "all"})`
  );

  // Collect metrics from all sources
  const metricsPayload = await collectInsightMetrics(tenantPool, dateFilter, {
    channelGroup,
  });

  // Generate categorized insights (3-pass pipeline: Generator → Validator → Curator → persist to DB)
  const result = await generateCategorizedInsights(
    metricsPayload,
    tenantPool,
    tenantId,
    { channelGroup }
  );

  // Re-read from DB so we get the DB-assigned IDs (needed for drill-down)
  const stored = await loadStoredInsights(tenantPool, dateFilter, channelGroup);
  const insightsSource = stored?.insights ?? result.insights;

  // Map to API response format
  const insights: Insight[] = insightsSource.map(
    (ins: CategorizedInsight) => ({
      id: (ins as any).id,
      type: ins.insight_type,
      message: ins.headline,
      priority:
        ins.severity_score >= 0.8
          ? "critical"
          : ins.severity_score >= 0.55
            ? "high"
            : ins.severity_score >= 0.3
              ? "medium"
              : "low",
      reasoning: ins.understory,
      source: ins.source as Insight["source"],
      forPodcast: ins.for_podcast,
      // Enriched fields
      bucket: ins.bucket,
      headline: ins.headline,
      understory: ins.understory,
      severity_score: ins.severity_score,
      bucketPriority: ins.priority,
      impact: ins.impact,
      evidence: ins.evidence,
      generation_method: ins.generation_method || "pipeline",
      functional_category: (ins as any).functional_category || null,
    })
  );

  return {
    insights,
    generatedAt: result.generatedAt,
    dateFilter,
    usedLLM: true,
    summaryForPodcast: result.summaryForPodcast,
    needsGeneration: false,
    summary: {
      totalLoans:
        metricsPayload.pipeline.activeLoans +
        metricsPayload.pipeline.closedLoans,
      revenue: metricsPayload.performance.revenueYTD,
      pullThroughRate:
        metricsPayload.performance.pullThroughRolling90D.toFixed(1),
      avgCycleTime: Math.round(metricsPayload.performance.avgCycleTime),
      totalInsights: insights.length,
      bySource: {
        business_overview: insights.filter((i) =>
          ["performance", "pipeline"].includes(i.source)
        ).length,
        leaderboard: 0,
        industry_news: 0,
        loan_funnel: insights.filter((i) => i.source === "lost_opportunity")
          .length,
        predictions: insights.filter((i) => i.source === "predictions").length,
      },
    },
  };
}

/**
 * Refresh insights for channel variants that actually have data.
 * Queries the tenant's loans table to detect which channel groups (Retail, TPO)
 * are populated, then only runs insight generation for those + "All".
 * Returns a summary of how many insights were generated per channel.
 */
// Per-tenant pipeline generation lock
const activePipelineGenerations = new Map<string, number>();

export async function refreshAllChannels(
  tenantPool: pg.Pool,
  dateFilter: string = "ytd",
  options: { tenantId?: string } = {}
): Promise<{
  channels: string[];
  results: Record<string, { count: number; generatedAt: string }>;
}> {
  const { tenantId } = options;
  const lockKey = tenantId || "__default__";

  // Concurrency guard
  const existingStart = activePipelineGenerations.get(lockKey);
  if (existingStart && Date.now() - existingStart < 10 * 60 * 1000) {
    const elapsed = Math.round((Date.now() - existingStart) / 1000);
    console.warn(`[Insights] Pipeline refresh already running for tenant ${lockKey} (${elapsed}s) — skipping duplicate`);
    return { channels: [], results: {} };
  }
  activePipelineGenerations.set(lockKey, Date.now());

  console.log(
    `[Insights] Batch-refreshing insights for active channels (dateFilter: ${dateFilter}, tenant: ${tenantId || "default"})`
  );

  try {
    // Detect which channel groups actually have loans for this tenant
    const channelGroupExpr = buildChannelGroupCaseExpr();
    let activeGroups: string[] = [];
    try {
      const channelResult = await tenantPool.query(`
        SELECT ${channelGroupExpr} AS channel_group, COUNT(*) AS cnt
        FROM public.loans
        GROUP BY 1
        HAVING COUNT(*) > 0
      `);
      activeGroups = channelResult.rows
        .map((r: any) => r.channel_group as string)
        .filter((g: string) => g === "Retail" || g === "TPO");
    } catch (err: any) {
      console.warn(`[Insights] Failed to detect active channels, falling back to all: ${err.message}`);
      activeGroups = ["Retail", "TPO"];
    }

    // Always run "All" (no channel filter). Only add Retail/TPO if both exist.
    // If the tenant only has one channel group, "All" and that channel would produce
    // identical insights, so skip the per-channel run.
    const channelConfigs: Array<{ key: string; channelGroup?: string }> = [
      { key: "All", channelGroup: undefined },
    ];

    if (activeGroups.length > 1) {
      for (const group of activeGroups) {
        channelConfigs.push({ key: group, channelGroup: group });
      }
      console.log(`[Insights] Multiple channel groups detected (${activeGroups.join(", ")}), generating per-channel insights`);
    } else {
      console.log(`[Insights] Single channel group detected (${activeGroups[0] || "none"}), skipping per-channel split (All is sufficient)`);
    }

    const settledResults = await Promise.allSettled(
      channelConfigs.map(({ channelGroup }) =>
        refreshInsights(tenantPool, dateFilter, {
          tenantId,
          channelGroup,
        })
      )
    );

    const results: Record<string, { count: number; generatedAt: string }> = {};
    for (let i = 0; i < channelConfigs.length; i++) {
      const key = channelConfigs[i].key;
      const settled = settledResults[i];
      if (settled.status === "fulfilled") {
        results[key] = {
          count: settled.value.insights.length,
          generatedAt: settled.value.generatedAt,
        };
        console.log(`[Insights] Channel "${key}": ${settled.value.insights.length} insights generated`);
      } else {
        results[key] = { count: 0, generatedAt: new Date().toISOString() };
        console.error(`[Insights] Channel "${key}" FAILED:`, settled.reason);
      }
    }

    return {
      channels: channelConfigs.map((c) => c.key),
      results,
    };
  } finally {
    activePipelineGenerations.delete(lockKey);
  }
}

/**
 * Get consolidated dashboard overview data
 * PERFORMANCE: Runs multiple queries in parallel and returns combined result in single response
 * This reduces frontend API calls from 4 to 1, improving initial page load
 *
 * @param tenantPool - Tenant database connection pool
 * @param period - Period filter ('all' | 'mtd' | 'ytd' | 'last_month' | 'last_year' | year string)
 */
export async function getDashboardOverview(
  tenantPool: pg.Pool,
  period: string = "all",
  options: { userAccessFilter?: LoanAccessFilter } = {}
): Promise<DashboardOverview> {
  try {
    // Calculate date range based on period
    let startDate: Date | null = null;
    const now = new Date();

    switch (period) {
      case "mtd":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "ytd":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case "last_month":
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        break;
      case "last_year":
        startDate = new Date(now.getFullYear() - 1, 0, 1);
        break;
      default:
        if (/^\d{4}$/.test(period)) {
          startDate = new Date(parseInt(period), 0, 1);
        }
      // 'all' or invalid = null (no date filter)
    }

    // PERFORMANCE: Run all queries in parallel
    const [statsResult, funnelResult, criticalLoansResult, predictionsResult] =
      await Promise.all([
        // Stats query
        tenantPool.query(
          `
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN current_loan_status = 'Active Loan' AND application_date IS NOT NULL AND (is_archived IS DISTINCT FROM TRUE) THEN 1 END) as active,
          COUNT(CASE WHEN funding_date IS NOT NULL THEN 1 END) as closed,
          COUNT(CASE WHEN lock_date IS NOT NULL THEN 1 END) as locked,
          SUM(CASE WHEN current_loan_status = 'Active Loan' AND (is_archived IS DISTINCT FROM TRUE) THEN loan_amount ELSE 0 END) as active_volume,
          SUM(CASE WHEN funding_date IS NOT NULL THEN loan_amount ELSE 0 END) as closed_volume,
          AVG(CASE WHEN funding_date IS NOT NULL AND application_date IS NOT NULL 
            THEN DATE(funding_date::date) - DATE(application_date) ELSE NULL END) as avg_cycle_time,
          COUNT(CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%') THEN 1 END)::float
            / NULLIF(COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END), 0) * 100 as pull_through_rate,
          COUNT(CASE WHEN credit_pull_date IS NOT NULL THEN 1 END) as credit_pulls
        FROM public.loans
        ${startDate ? "WHERE application_date >= $1" : ""}
      `,
          startDate ? [startDate] : []
        ),

        // Funnel query
        tenantPool.query(
          `
        SELECT 
          COUNT(CASE WHEN application_date IS NOT NULL THEN 1 END) as loans_started,
          SUM(CASE WHEN application_date IS NOT NULL THEN loan_amount ELSE 0 END) as loans_started_volume,
          COUNT(CASE WHEN current_loan_status = 'Active Loan' AND (is_archived IS DISTINCT FROM TRUE) THEN 1 END) as still_active,
          SUM(CASE WHEN current_loan_status = 'Active Loan' AND (is_archived IS DISTINCT FROM TRUE) THEN loan_amount ELSE 0 END) as still_active_volume,
          COUNT(CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%') THEN 1 END) as originated,
          SUM(CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%') THEN loan_amount ELSE 0 END) as originated_volume,
          COUNT(CASE WHEN current_loan_status IN ('withdrawn', 'cancelled') THEN 1 END) as fallout_withdrawn,
          SUM(CASE WHEN current_loan_status IN ('withdrawn', 'cancelled') THEN loan_amount ELSE 0 END) as fallout_withdrawn_volume,
          COUNT(CASE WHEN current_loan_status IN ('denied', 'declined') THEN 1 END) as fallout_denied,
          SUM(CASE WHEN current_loan_status IN ('denied', 'declined') THEN loan_amount ELSE 0 END) as fallout_denied_volume
        FROM public.loans
        ${startDate ? "WHERE application_date >= $1" : ""}
      `,
          startDate ? [startDate] : []
        ),

        // Critical loans query (high risk active loans, limited to 50)
        tenantPool.query(
          `
        SELECT 
          loan_id,
          loan_amount,
          loan_type,
          loan_officer,
          current_loan_status as status,
          fico_score,
          ltv_ratio,
          be_dti_ratio as dti_ratio,
          application_date,
          -- Calculate risk score based on credit metrics
          CASE 
            WHEN fico_score IS NOT NULL AND ltv_ratio IS NOT NULL AND be_dti_ratio IS NOT NULL THEN
              GREATEST(0, LEAST(100,
                -- FICO component (lower is worse)
                CASE WHEN fico_score < 620 THEN 40 WHEN fico_score < 680 THEN 25 WHEN fico_score < 740 THEN 10 ELSE 0 END +
                -- LTV component (higher is worse)
                CASE WHEN ltv_ratio > 95 THEN 30 WHEN ltv_ratio > 85 THEN 20 WHEN ltv_ratio > 75 THEN 10 ELSE 0 END +
                -- DTI component (higher is worse)
                CASE WHEN be_dti_ratio > 50 THEN 30 WHEN be_dti_ratio > 43 THEN 20 WHEN be_dti_ratio > 36 THEN 10 ELSE 0 END
              ))
            ELSE 50 -- Default medium risk if metrics missing
          END as risk_score
        FROM public.loans
        WHERE current_loan_status = 'Active Loan'
          AND application_date IS NOT NULL
          AND (is_archived IS DISTINCT FROM TRUE)
          ${startDate ? "AND application_date >= $1" : ""}
        ORDER BY risk_score DESC, loan_amount DESC
        LIMIT 50
      `,
          startDate ? [startDate] : []
        ),

        // Predictions query (count by predicted outcome from loan_predictions table if exists)
        tenantPool
          .query(
            `
        SELECT 
          COUNT(CASE WHEN current_loan_status IN ('withdrawn', 'cancelled') THEN 1 END) as likely_withdraw,
          COUNT(CASE WHEN current_loan_status IN ('denied', 'declined') THEN 1 END) as likely_decline
        FROM public.loans
        WHERE current_loan_status = 'Active Loan'
          AND (is_archived IS DISTINCT FROM TRUE)
          ${startDate ? "AND application_date >= $1" : ""}
      `,
            startDate ? [startDate] : []
          )
          .catch(() => ({ rows: [{ likely_withdraw: 0, likely_decline: 0 }] })),
      ]);

    // Process stats
    const stats = statsResult.rows[0];

    // Process funnel
    const funnel = funnelResult.rows[0];

    // Process critical loans with risk assessment
    const criticalLoans = criticalLoansResult.rows.map((loan: any) => {
      const riskScore = parseInt(loan.risk_score) || 50;
      const riskLevel =
        riskScore >= 70 ? "Very High" : riskScore >= 50 ? "Medium" : "Low";

      // Generate reason based on metrics
      const reasons: string[] = [];
      if (loan.fico_score && loan.fico_score < 680)
        reasons.push(`Low FICO (${loan.fico_score})`);
      if (loan.ltv_ratio && loan.ltv_ratio > 85)
        reasons.push(`High LTV (${loan.ltv_ratio}%)`);
      if (loan.dti_ratio && loan.dti_ratio > 43)
        reasons.push(`High DTI (${loan.dti_ratio}%)`);

      return {
        loanId: loan.loan_id,
        loanAmount: parseFloat(loan.loan_amount) || 0,
        loanType: loan.loan_type,
        loanOfficer: loan.loan_officer,
        status: loan.status,
        ficoScore: loan.fico_score ? parseInt(loan.fico_score) : null,
        ltvRatio: loan.ltv_ratio ? parseFloat(loan.ltv_ratio) : null,
        dtiRatio: loan.dti_ratio ? parseFloat(loan.dti_ratio) : null,
        applicationDate: loan.application_date,
        riskScore,
        riskLevel,
        reason: reasons.length > 0 ? reasons.join(", ") : "Standard processing",
      };
    });

    // Process predictions
    const predictions = predictionsResult.rows[0];

    return {
      stats: {
        total: parseInt(stats.total) || 0,
        active: parseInt(stats.active) || 0,
        closed: parseInt(stats.closed) || 0,
        locked: parseInt(stats.locked) || 0,
        activeVolume: parseFloat(stats.active_volume) || 0,
        closedVolume: parseFloat(stats.closed_volume) || 0,
        avgCycleTime: Math.round(parseFloat(stats.avg_cycle_time) || 0),
        pullThroughRate: parseFloat(
          parseFloat(stats.pull_through_rate || "0").toFixed(1)
        ),
        creditPulls: parseInt(stats.credit_pulls) || 0,
      },
      funnel: {
        loansStarted: {
          units: parseInt(funnel.loans_started) || 0,
          volume: parseFloat(funnel.loans_started_volume) || 0,
        },
        stillActive: {
          units: parseInt(funnel.still_active) || 0,
          volume: parseFloat(funnel.still_active_volume) || 0,
        },
        originated: {
          units: parseInt(funnel.originated) || 0,
          volume: parseFloat(funnel.originated_volume) || 0,
        },
        falloutWithdrawn: {
          units: parseInt(funnel.fallout_withdrawn) || 0,
          volume: parseFloat(funnel.fallout_withdrawn_volume) || 0,
        },
        falloutDenied: {
          units: parseInt(funnel.fallout_denied) || 0,
          volume: parseFloat(funnel.fallout_denied_volume) || 0,
        },
      },
      criticalLoans,
      predictions: {
        likelyWithdraw: parseInt(predictions.likely_withdraw) || 0,
        likelyDecline: parseInt(predictions.likely_decline) || 0,
        predictedFalloutTotal:
          (parseInt(predictions.likely_withdraw) || 0) +
          (parseInt(predictions.likely_decline) || 0),
      },
    };
  } catch (dbError: any) {
    // Handle table not found gracefully
    if (dbError.code === "42P01") {
      return {
        stats: {
          total: 0,
          active: 0,
          closed: 0,
          locked: 0,
          activeVolume: 0,
          closedVolume: 0,
          avgCycleTime: 0,
          pullThroughRate: 0,
          creditPulls: 0,
        },
        funnel: {
          loansStarted: { units: 0, volume: 0 },
          stillActive: { units: 0, volume: 0 },
          originated: { units: 0, volume: 0 },
          falloutWithdrawn: { units: 0, volume: 0 },
          falloutDenied: { units: 0, volume: 0 },
        },
        criticalLoans: [],
        predictions: {
          likelyWithdraw: 0,
          likelyDecline: 0,
          predictedFalloutTotal: 0,
        },
      };
    }
    throw dbError;
  }
}

// =============================================================================
// Financial Modeling Baseline
// =============================================================================

export type FinancialModelingPeriod =
  | "all"
  | "mtd"
  | "ytd"
  | "last_month"
  | "last_year"
  | "trailing_12"; // Rolling 12 months (MonthStart(now - 12 months) to today)

export interface FinancialModelingBaseline {
  totalRevenue: number;
  totalVolume: number;
  fundedUnits: number;
  marginBps: number;
  pullThroughRate: number;
  mloCount: number;
  /** Avg funded units per MLO per month (for date-bounded periods); matches Qlik. */
  avgUnitsPerMlo: number;
  /** Avg units per person (simple average across people). Kept for compatibility. */
  avgUnitsPerProcessor: number;
  avgUnitsPerUnderwriter: number;
  avgUnitsPerCloser: number;
  /**
   * Qlik-style actual units per month per FTE: total output units / (avg distinct role per month * num months).
   * Matches Qlik-style: total output units / (avg distinct role per month * num months).
   */
  actualUnitsPerProcessorPerMonthFTE: number;
  actualUnitsPerUnderwriterPerMonthFTE: number;
  actualUnitsPerCloserPerMonthFTE: number;
  /** Unit targets per role (from tenant staffing_unit_targets). */
  targetUnits: StaffingUnitTargets;
  dateRange: { start: string | null; end: string | null };
}

/**
 * Get baseline metrics for the Financial Modeling Sandbox.
 * Returns tenant actuals: revenue, volume, margin BPS, pull-through, units by role.
 *
 * @param tenantPool - Tenant database connection pool
 * @param period - 'all' | 'mtd' | 'ytd' | 'last_month' | 'last_year'
 * @param options - Optional user access filter for loan-level security
 */
export async function getFinancialModelingBaseline(
  tenantPool: pg.Pool,
  period: FinancialModelingPeriod = "trailing_12",
  options: { userAccessFilter?: LoanAccessFilter } = {}
): Promise<FinancialModelingBaseline> {
  const targetUnits = await getStaffingUnitTargets(tenantPool);
  const now = new Date();
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  switch (period) {
    case "mtd":
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date();
      break;
    case "ytd":
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date();
      break;
    case "trailing_12":
      // Rolling 12 months: start of month 12 months ago to today
      startDate = new Date(now.getFullYear(), now.getMonth() - 12, 1);
      endDate = new Date();
      break;
    case "last_month":
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case "last_year":
      startDate = new Date(now.getFullYear() - 1, 0, 1);
      endDate = new Date(now.getFullYear() - 1, 11, 31);
      break;
    default:
      // 'all' - no date filter
      break;
  }

  const revenueExpression = await getTenantRevenueExpression(tenantPool, "l");
  const accessFilter = options.userAccessFilter;
  const emptyResult = (): FinancialModelingBaseline => ({
    totalRevenue: 0,
    totalVolume: 0,
    fundedUnits: 0,
    marginBps: 0,
    pullThroughRate: 0,
    mloCount: 0,
    avgUnitsPerMlo: 0,
    avgUnitsPerProcessor: 0,
    avgUnitsPerUnderwriter: 0,
    avgUnitsPerCloser: 0,
    actualUnitsPerProcessorPerMonthFTE: 0,
    actualUnitsPerUnderwriterPerMonthFTE: 0,
    actualUnitsPerCloserPerMonthFTE: 0,
    targetUnits,
    dateRange: {
      start: startDate?.toISOString().slice(0, 10) ?? null,
      end: endDate?.toISOString().slice(0, 10) ?? null,
    },
  });

  try {
    const dateCondition =
      startDate && endDate
        ? "AND l.funding_date >= $1 AND l.funding_date <= $2"
        : "";
    let paramIndex = 1;
    const params: unknown[] = [];
    if (startDate && endDate) {
      params.push(startDate, endDate);
      paramIndex = 3;
    }

    let filterClause = "";
    if (accessFilter?.sql) {
      const filterParamStart = paramIndex;
      const filterSql = accessFilter.sql.replace(
        /\$(\d+)/g,
        (_, n) => `$${filterParamStart + parseInt(n, 10) - accessFilter.paramOffset}`
      );
      filterClause = ` AND (${filterSql})`;
      params.push(...accessFilter.params);
    }

    // Query 1: Revenue, volume, funded units (funded in period)
    const mainQuery = `
      SELECT
        COALESCE(SUM(${revenueExpression}), 0)::float as total_revenue,
        COALESCE(SUM(l.loan_amount), 0)::float as total_volume,
        COUNT(*)::int as funded_units
      FROM public.loans l
      WHERE l.funding_date IS NOT NULL
        ${dateCondition}
        ${filterClause}
    `;
    const mainResult = await tenantPool.query(mainQuery, params);
    const main = mainResult.rows[0];
    const totalRevenue = parseFloat(main?.total_revenue) || 0;
    const totalVolume = parseFloat(main?.total_volume) || 0;
    const fundedUnits = parseInt(main?.funded_units, 10) || 0;
    const marginBps =
      totalVolume > 0 ? Math.round((totalRevenue / totalVolume) * 10000) : 0;

    // Query 2: Pull-through = funded / completed (canonical definition, excludes active loans)
    const ptParams = startDate && endDate ? [startDate, endDate, ...(accessFilter?.params ?? [])] : [...(accessFilter?.params ?? [])];
    const ptFilterClause = accessFilter?.sql
      ? ` AND (${accessFilter.sql.replace(/\$(\d+)/g, (_, n) => `$${3 + parseInt(n, 10) - accessFilter.paramOffset}`)})`
      : "";
    const pullThroughQuery = startDate && endDate
      ? `
      SELECT
        COUNT(CASE WHEN (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%') THEN 1 END)::float
          / NULLIF(COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END), 0) * 100 as pull_through_rate
      FROM public.loans l
      WHERE l.application_date >= $1 AND l.application_date <= $2
        ${ptFilterClause}
      `
      : `
      SELECT 0 as pull_through_rate
      FROM public.loans l
      LIMIT 1
      `;
    const ptResult = await tenantPool.query(
      pullThroughQuery,
      startDate && endDate ? ptParams : []
    );
    const pullThroughRate =
      parseFloat(ptResult.rows[0]?.pull_through_rate) || 0;

    // Query 3: MLO count (distinct loan officers with funded in period)
    const mloParams = startDate && endDate
      ? [startDate, endDate, ...(accessFilter?.params ?? [])]
      : [...(accessFilter?.params ?? [])];
    const mloFilterParamStart = startDate && endDate ? 3 : 1;
    const mloFilterClause = accessFilter?.sql
      ? ` AND (${accessFilter.sql.replace(/\$(\d+)/g, (_, n) => `$${mloFilterParamStart + parseInt(n, 10) - accessFilter.paramOffset}`)})`
      : "";
    const mloQuery = `
      SELECT COUNT(DISTINCT l.loan_officer)::int as mlo_count
      FROM public.loans l
      WHERE l.funding_date IS NOT NULL
        AND l.loan_officer IS NOT NULL AND TRIM(l.loan_officer) != ''
        ${startDate && endDate ? "AND l.funding_date >= $1 AND l.funding_date <= $2" : ""}
        ${mloFilterClause}
    `;
    const mloResult = await tenantPool.query(
      mloQuery,
      startDate && endDate ? mloParams : (accessFilter?.params ?? [])
    );
    const mloCount = parseInt(mloResult.rows[0]?.mlo_count, 10) || 0;
    // Match Qlik: show units per MLO per month (not total in period). For date-bounded periods, divide by numMonths.
    const numMonthsForPeriod =
      startDate && endDate
        ? period === "trailing_12"
          ? 12
          : Math.max(
              1,
              (endDate.getFullYear() - startDate.getFullYear()) * 12 +
                (endDate.getMonth() - startDate.getMonth()) +
                1
            )
        : 1;
    const avgUnitsPerMlo =
      mloCount > 0 && numMonthsForPeriod >= 1
        ? fundedUnits / mloCount / numMonthsForPeriod
        : mloCount > 0
          ? fundedUnits / mloCount
          : 0;

    // Query 4: Avg units per processor, underwriter, closer (funded in period, per-person average)
    // Note: Role aggregates do not apply user access filter to avoid complex param indexing across subqueries.
    const roleQuery = `
      SELECT
        (SELECT COALESCE(AVG(unit_count), 0) FROM (
          SELECT l.processor, COUNT(*)::float as unit_count FROM public.loans l
          WHERE l.funding_date IS NOT NULL AND l.processor IS NOT NULL AND TRIM(l.processor) != ''
            ${startDate && endDate ? "AND l.funding_date >= $1 AND l.funding_date <= $2" : ""}
          GROUP BY l.processor
        ) t) as avg_processor,
        (SELECT COALESCE(AVG(unit_count), 0) FROM (
          SELECT l.underwriter, COUNT(*)::float as unit_count FROM public.loans l
          WHERE l.funding_date IS NOT NULL AND l.underwriter IS NOT NULL AND TRIM(l.underwriter) != ''
            ${startDate && endDate ? "AND l.funding_date >= $3 AND l.funding_date <= $4" : ""}
          GROUP BY l.underwriter
        ) t) as avg_underwriter,
        (SELECT COALESCE(AVG(unit_count), 0) FROM (
          SELECT l.closer, COUNT(*)::float as unit_count FROM public.loans l
          WHERE l.funding_date IS NOT NULL AND l.closer IS NOT NULL AND TRIM(l.closer) != ''
            ${startDate && endDate ? "AND l.funding_date >= $5 AND l.funding_date <= $6" : ""}
          GROUP BY l.closer
        ) t) as avg_closer
    `;
    let avgProcessor = 0,
      avgUnderwriter = 0,
      avgCloser = 0;
    try {
      const roleResult = await tenantPool.query(
        roleQuery,
        startDate && endDate
          ? [startDate, endDate, startDate, endDate, startDate, endDate]
          : []
      );
      const r = roleResult.rows[0];
      avgProcessor = parseFloat(r?.avg_processor) || 0;
      avgUnderwriter = parseFloat(r?.avg_underwriter) || 0;
      avgCloser = parseFloat(r?.avg_closer) || 0;
    } catch {
      // Columns might not exist in older tenant schema
    }

    // Actual units per month per FTE: total output / (avg distinct role per month * num months)
    let actualProcessorFTE = 0,
      actualUnderwriterFTE = 0,
      actualCloserFTE = 0;
    if (startDate && endDate && fundedUnits > 0) {
      const numMonths =
        period === "trailing_12"
          ? 12
          : Math.max(
              1,
              (endDate.getFullYear() - startDate.getFullYear()) * 12 +
                (endDate.getMonth() - startDate.getMonth()) +
                1
            ) || 1;
      const fteQuery = `
        SELECT
          (SELECT COUNT(*)::float FROM public.loans l WHERE l.funding_date IS NOT NULL AND l.processor IS NOT NULL AND TRIM(l.processor) != '' AND l.funding_date >= $1 AND l.funding_date <= $2) as proc_units,
          (SELECT COALESCE(AVG(cnt), 0) FROM (SELECT COUNT(DISTINCT l.processor)::float as cnt FROM public.loans l WHERE l.funding_date IS NOT NULL AND l.processor IS NOT NULL AND TRIM(l.processor) != '' AND l.funding_date >= $1 AND l.funding_date <= $2 GROUP BY DATE_TRUNC('month', l.funding_date)) t) as proc_avg_distinct,
          (SELECT COUNT(*)::float FROM public.loans l WHERE l.funding_date IS NOT NULL AND l.underwriter IS NOT NULL AND TRIM(l.underwriter) != '' AND l.funding_date >= $3 AND l.funding_date <= $4) as uw_units,
          (SELECT COALESCE(AVG(cnt), 0) FROM (SELECT COUNT(DISTINCT l.underwriter)::float as cnt FROM public.loans l WHERE l.funding_date IS NOT NULL AND l.underwriter IS NOT NULL AND TRIM(l.underwriter) != '' AND l.funding_date >= $3 AND l.funding_date <= $4 GROUP BY DATE_TRUNC('month', l.funding_date)) t) as uw_avg_distinct,
          (SELECT COUNT(*)::float FROM public.loans l WHERE l.funding_date IS NOT NULL AND l.closer IS NOT NULL AND TRIM(l.closer) != '' AND l.funding_date >= $5 AND l.funding_date <= $6) as closer_units,
          (SELECT COALESCE(AVG(cnt), 0) FROM (SELECT COUNT(DISTINCT l.closer)::float as cnt FROM public.loans l WHERE l.funding_date IS NOT NULL AND l.closer IS NOT NULL AND TRIM(l.closer) != '' AND l.funding_date >= $5 AND l.funding_date <= $6 GROUP BY DATE_TRUNC('month', l.funding_date)) t) as closer_avg_distinct
      `;
      try {
        const fteResult = await tenantPool.query(fteQuery, [
          startDate,
          endDate,
          startDate,
          endDate,
          startDate,
          endDate,
        ]);
        const f = fteResult.rows[0];
        const procUnits = parseFloat(f?.proc_units) || 0;
        const procAvg = parseFloat(f?.proc_avg_distinct) || 0;
        const uwUnits = parseFloat(f?.uw_units) || 0;
        const uwAvg = parseFloat(f?.uw_avg_distinct) || 0;
        const closerUnits = parseFloat(f?.closer_units) || 0;
        const closerAvg = parseFloat(f?.closer_avg_distinct) || 0;
        const denomProc = procAvg * numMonths;
        const denomUw = uwAvg * numMonths;
        const denomCloser = closerAvg * numMonths;
        actualProcessorFTE =
          denomProc > 0 ? Math.round((procUnits / denomProc) * 10) / 10 : 0;
        actualUnderwriterFTE =
          denomUw > 0 ? Math.round((uwUnits / denomUw) * 10) / 10 : 0;
        actualCloserFTE =
          denomCloser > 0
            ? Math.round((closerUnits / denomCloser) * 10) / 10
            : 0;
      } catch {
        // Ignore if columns missing
      }
    }

    return {
      totalRevenue,
      totalVolume,
      fundedUnits,
      marginBps,
      pullThroughRate: Math.round(pullThroughRate * 100) / 100,
      mloCount,
      avgUnitsPerMlo: Math.round(avgUnitsPerMlo * 10) / 10,
      avgUnitsPerProcessor: Math.round(avgProcessor * 10) / 10,
      avgUnitsPerUnderwriter: Math.round(avgUnderwriter * 10) / 10,
      avgUnitsPerCloser: Math.round(avgCloser * 10) / 10,
      actualUnitsPerProcessorPerMonthFTE: actualProcessorFTE,
      actualUnitsPerUnderwriterPerMonthFTE: actualUnderwriterFTE,
      actualUnitsPerCloserPerMonthFTE: actualCloserFTE,
      targetUnits,
      dateRange: {
        start: startDate?.toISOString().slice(0, 10) ?? null,
        end: endDate?.toISOString().slice(0, 10) ?? null,
      },
    };
  } catch (dbError: any) {
    if (dbError.code === "42P01") {
      return emptyResult();
    }
    throw dbError;
  }
}
