/**
 * Sales Scorecard Overview Service
 * Aggregates loans by pipeline stage (started, application, locked, closed, funded) per time period.
 * Used by the Sales Scorecard Overview page.
 * When milestone_columns are provided, uses those date columns dynamically; otherwise uses the default five.
 */

import pg from "pg";
import { getVMaxDate } from "../../utils/scorecard-utils.js";
import { buildDimensionFilterWhereClause } from "../../utils/scorecard-utils.js";
import { getWorkflowConversionMilestones } from "./workflowConversionService.js";

export type SalesScorecardOverviewMeasure = "volume" | "units";
export type SalesScorecardOverviewTimePeriod =
  | "monthly-ytd"
  | "quarterly-ytd"
  | "monthly-last-year"
  | "monthly-rolling-12"
  | "quarterly-last-year"
  | "weekly-mtd"
  | "weekly-last-3"
  | "daily-mtd"
  | "daily-last-month"
  | "weekly-scoped"
  | "daily-scoped";

export interface SalesScorecardOverviewRow {
  periodLabel: string;
  /** Dynamic keys: column names (e.g. started_date, application_date). Values are measure aggregates. */
  [key: string]: string | number;
}

export interface SalesScorecardOverviewFilters {
  branch?: string[];
  loan_officer?: string[];
}

interface PeriodBounds {
  start: string;
  end: string;
  periodExpr: string;
  periodSort: string;
}

function getPeriodConfig(
  timePeriod: SalesScorecardOverviewTimePeriod,
  vMaxDate: Date
): PeriodBounds {
  const y = vMaxDate.getFullYear();
  const m = vMaxDate.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");

  switch (timePeriod) {
    case "monthly-ytd":
      return {
        start: `${y}-01-01`,
        end: `${y}-${pad(m + 1)}-${String(
          new Date(y, m + 1, 0).getDate()
        ).padStart(2, "0")}`,
        periodExpr: "to_char(?::date, 'YYYY-MM')",
        periodSort: "1",
      };
    case "quarterly-ytd": {
      const q = Math.floor(m / 3) + 1;
      const endMonth = q * 3;
      const lastDay = new Date(y, endMonth, 0).getDate();
      return {
        start: `${y}-01-01`,
        end: `${y}-${pad(endMonth)}-${String(lastDay).padStart(2, "0")}`,
        periodExpr:
          "to_char(?::date, 'YYYY') || '-Q' || EXTRACT(QUARTER FROM ?::date)::text",
        periodSort: "1",
      };
    }
    case "monthly-last-year": {
      const prevY = y - 1;
      return {
        start: `${prevY}-01-01`,
        end: `${prevY}-12-31`,
        periodExpr: "to_char(?::date, 'YYYY-MM')",
        periodSort: "1",
      };
    }
    case "monthly-rolling-12": {
      const start = new Date(vMaxDate);
      start.setMonth(start.getMonth() - 12);
      start.setDate(1);
      const startY = start.getFullYear();
      const startM = start.getMonth() + 1;
      return {
        start: `${startY}-${pad(startM)}-01`,
        end: `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`,
        periodExpr: "to_char(?::date, 'YYYY-MM')",
        periodSort: "1",
      };
    }
    case "quarterly-last-year": {
      const prevY = y - 1;
      return {
        start: `${prevY}-01-01`,
        end: `${prevY}-12-31`,
        periodExpr:
          "to_char(?::date, 'YYYY') || '-Q' || EXTRACT(QUARTER FROM ?::date)::text",
        periodSort: "1",
      };
    }
    case "weekly-mtd": {
      const end = new Date(vMaxDate);
      return {
        start: `${y}-${pad(m + 1)}-01`,
        end: `${y}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
        periodExpr: "date_trunc('week', ?::date)::date::text",
        periodSort: "1",
      };
    }
    case "weekly-last-3": {
      const start = new Date(vMaxDate);
      start.setMonth(start.getMonth() - 3);
      return {
        start: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
        end: `${y}-${pad(m + 1)}-${pad(vMaxDate.getDate())}`,
        periodExpr: "date_trunc('week', ?::date)::date::text",
        periodSort: "1",
      };
    }
    case "daily-mtd": {
      return {
        start: `${y}-${pad(m + 1)}-01`,
        end: `${y}-${pad(m + 1)}-${pad(vMaxDate.getDate())}`,
        periodExpr: "?::date::text",
        periodSort: "1",
      };
    }
    case "daily-last-month": {
      const lastMonth = m === 0 ? 11 : m - 1;
      const lastMonthYear = m === 0 ? y - 1 : y;
      const lastDay = new Date(lastMonthYear, lastMonth + 1, 0).getDate();
      return {
        start: `${lastMonthYear}-${pad(lastMonth + 1)}-01`,
        end: `${lastMonthYear}-${pad(lastMonth + 1)}-${pad(lastDay)}`,
        periodExpr: "?::date::text",
        periodSort: "1",
      };
    }
    case "weekly-scoped":
    case "daily-scoped":
      // Handled in getSalesScorecardOverview via scope_start/scope_end
      return {
        start: "",
        end: "",
        periodExpr: "",
        periodSort: "1",
      };
    default:
      return getPeriodConfig("monthly-ytd", vMaxDate);
  }
}

function periodExprForColumn(periodExpr: string, dateCol: string): string {
  return periodExpr.replace(/\?/g, dateCol);
}

/** Default date columns used when milestone_columns is not provided (same as original fixed five). */
export const DEFAULT_SALES_SCORECARD_MILESTONE_COLUMNS = [
  "started_date",
  "application_date",
  "lock_date",
  "closing_date",
  "funding_date",
] as const;

export async function getSalesScorecardOverview(
  pool: pg.Pool,
  measure: SalesScorecardOverviewMeasure,
  timePeriod: SalesScorecardOverviewTimePeriod,
  filters: SalesScorecardOverviewFilters,
  queryParams: Record<string, unknown>
): Promise<SalesScorecardOverviewRow[]> {
  const vMaxDate = await getVMaxDate(pool);

  let config: PeriodBounds;
  if (timePeriod === "weekly-scoped" || timePeriod === "daily-scoped") {
    const scopeStart = queryParams.scope_start as string | undefined;
    const scopeEnd = queryParams.scope_end as string | undefined;
    if (!scopeStart || !scopeEnd) {
      return [];
    }
    config = {
      start: scopeStart,
      end: scopeEnd,
      periodExpr:
        timePeriod === "weekly-scoped"
          ? "date_trunc('week', ?::date)::date::text"
          : "?::date::text",
      periodSort: "1",
    };
  } else {
    const startDate = queryParams.start_date as string | undefined;
    const endDate = queryParams.end_date as string | undefined;
    const timeMeasure = queryParams.time_measure as string | undefined;
    if (
      startDate &&
      endDate &&
      timeMeasure &&
      ["quarterly", "monthly", "weekly", "daily"].includes(timeMeasure)
    ) {
      const periodExprByMeasure: Record<string, string> = {
        quarterly:
          "to_char(?::date, 'YYYY') || '-Q' || EXTRACT(QUARTER FROM ?::date)::text",
        monthly: "to_char(?::date, 'YYYY-MM')",
        weekly: "date_trunc('week', ?::date)::date::text",
        daily: "?::date::text",
      };
      config = {
        start: startDate,
        end: endDate,
        periodExpr: periodExprByMeasure[timeMeasure] ?? "to_char(?::date, 'YYYY-MM')",
        periodSort: "1",
      };
    } else {
      config = getPeriodConfig(timePeriod, vMaxDate);
    }
  }

  const dimensionClause = buildDimensionFilterWhereClause(
    queryParams,
    "",
    new Set([
      "measure",
      "time_period",
      "tenant_id",
      "scope_start",
      "scope_end",
      "start_date",
      "end_date",
      "time_measure",
      "milestone_columns",
    ])
  );

  const selectValue =
    measure === "volume"
      ? "COALESCE(SUM(loan_amount), 0)"
      : "COUNT(*)::numeric";

  const rawMilestoneParam = queryParams.milestone_columns;
  const requestedColumns: string[] =
    rawMilestoneParam == null
      ? []
      : Array.isArray(rawMilestoneParam)
        ? (rawMilestoneParam as string[]).filter(Boolean)
        : String(rawMilestoneParam)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);

  const allowedMilestones = await getWorkflowConversionMilestones(pool);
  const allowedColumnSet = new Set(allowedMilestones.map((m) => m.column));

  const dateColumns: { key: string; col: string }[] =
    requestedColumns.length > 0
      ? requestedColumns.filter((col) => allowedColumnSet.has(col)).map((col) => ({ key: col, col }))
      : DEFAULT_SALES_SCORECARD_MILESTONE_COLUMNS.map((col) => ({ key: col, col }));

  const allPeriods = new Map<string, SalesScorecardOverviewRow>();

  for (const { key, col } of dateColumns) {
    const periodExpr = periodExprForColumn(config.periodExpr, col);
    const dateFilter = col === "lock_date" || col === "funding_date" ? `${col}::date` : col;
    const sql = `
      SELECT ${periodExpr} AS period_label,
             ${selectValue} AS val
      FROM public.loans
      WHERE ${dateFilter} IS NOT NULL
        AND ${dateFilter} >= $1
        AND ${dateFilter} <= $2
        ${dimensionClause}
      GROUP BY 1
      ORDER BY 1
    `;
    const result = await pool.query(sql, [config.start, config.end]);
    for (const row of result.rows) {
      const label = String(row.period_label);
      let rec = allPeriods.get(label);
      if (!rec) {
        rec = {
          periodLabel: label,
          ...Object.fromEntries(dateColumns.map((d) => [d.col, 0])),
        } as SalesScorecardOverviewRow;
        allPeriods.set(label, rec);
      }
      rec[key] = parseFloat(row.val) || 0;
    }
  }

  const sorted = Array.from(allPeriods.values()).sort((a, b) =>
    a.periodLabel.localeCompare(b.periodLabel)
  );
  return sorted;
}

export async function getSalesScorecardOverviewBranches(
  pool: pg.Pool
): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT branch FROM public.loans WHERE branch IS NOT NULL AND TRIM(branch) != '' ORDER BY branch`
  );
  return result.rows.map((r) => String(r.branch).trim());
}

export async function getSalesScorecardOverviewLoanOfficers(
  pool: pg.Pool
): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT loan_officer FROM public.loans WHERE loan_officer IS NOT NULL AND TRIM(loan_officer) != '' ORDER BY loan_officer`
  );
  return result.rows.map((r) => String(r.loan_officer).trim());
}
