/**
 * Workflow Conversion Service
 * Cohort = loans where started_date is in the selected date range (first box's left milestone).
 * All segments use this same cohort.
 *
 * Flow-down (funnel) logic:
 * - Left count = cohort members with the "from" milestone date.
 * - Right count = cohort members with BOTH "from" and "to" milestone dates (subset of left).
 * - Conversion % = right count / left count (always ≤ 100%).
 */

import pg from "pg";
import { buildChannelWhereClause } from "../../utils/scorecard-utils.js";

// Ordered milestones: id -> DB date column (use COALESCE/expression where needed)
const MILESTONE_DATE_COLUMNS: Record<string, string> = {
  started: "started_date",
  application: "application_date",
  lock: "lock_date", // TIMESTAMPTZ -> use DATE(l.lock_date) in SQL
  processing: "processing_date",
  submittal: "submittal_date",
  submitted_to_underwriting: "submitted_to_underwriting_date",
  conditional_approval: "conditional_approval_date",
  resubmittal: "resubmittal_date",
  uw_final_approval: "uw_final_approval_date",
  ctc: "ctc_date",
  closing: "closing_date",
  funding: "funding_date",
  shipped: "shipped_date",
};

function getDateExpression(milestoneId: string, alias: string): string {
  const col = MILESTONE_DATE_COLUMNS[milestoneId];
  if (!col) return "NULL";
  if (col.startsWith("COALESCE")) return col.replace(/\bl\./g, `${alias}.`);
  if (milestoneId === "lock") return `DATE(${alias}.lock_date)`;
  return `${alias}.${col}`;
}

export interface WorkflowSegmentInput {
  from: string;
  to: string;
}

export type WorkflowGrouping = "workflow" | "individual";

export interface WorkflowConversionOptions {
  startDate: string;
  endDate: string;
  segments: WorkflowSegmentInput[];
  metric: "conversion" | "turn_time";
  /** workflow = one cohort (started_date in range); individual = per-card cohort (from-milestone date in range) */
  grouping?: WorkflowGrouping;
  channelGroup?: string;
  /** Pre-built clause with $3, $4... and corresponding params to append after $1,$2 (startDate, endDate) */
  accessClause?: string;
  accessParams?: unknown[];
}

export interface SeriesPoint {
  period: string;
  leftCount: number;
  rightCount: number;
  conversionPercent: number | null;
  avgTurnTimeDays: number | null;
}

export interface SegmentResult {
  from: string;
  to: string;
  leftCount: number;
  rightCount: number;
  conversionPercent: number | null;
  avgTurnTimeDays: number | null;
  series: SeriesPoint[];
}

export interface WorkflowConversionResult {
  segments: SegmentResult[];
}

function getBucketSql(byDay: boolean, useFromDate: boolean, fromExpr: string): string {
  const base = useFromDate ? fromExpr : "l.started_date";
  return byDay
    ? `date_trunc('day', ${base})::date`
    : `date_trunc('month', ${base})::date`;
}

export async function getWorkflowConversionData(
  tenantPool: pg.Pool,
  options: WorkflowConversionOptions
): Promise<WorkflowConversionResult> {
  const { startDate, endDate, segments, metric, grouping = "workflow", channelGroup, accessClause: accessClauseOpt, accessParams: accessParamsOpt } = options;
  const byDay =
    (() => {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return days <= 31;
    })();

  const channelClause = buildChannelWhereClause(channelGroup, "l");
  const params: unknown[] = [startDate, endDate];
  const accessClause = accessClauseOpt ? " " + accessClauseOpt.trim() : "";
  if (accessParamsOpt && accessParamsOpt.length > 0) {
    params.push(...accessParamsOpt);
  }
  if (accessClauseOpt?.trim() === "AND FALSE") {
    return {
      segments: segments.map((s) => ({
        from: s.from,
        to: s.to,
        leftCount: 0,
        rightCount: 0,
        conversionPercent: null,
        avgTurnTimeDays: null,
        series: [],
      })),
    };
  }

  const results: SegmentResult[] = [];

  for (const seg of segments) {
    const fromExpr = getDateExpression(seg.from, "l");
    const toExpr = getDateExpression(seg.to, "l");
    const isIndividual = grouping === "individual";
    const bucketSql = getBucketSql(byDay, isIndividual, fromExpr);

    const cohortWhereIndividual = isIndividual
      ? `${fromExpr} IS NOT NULL AND DATE(${fromExpr}) >= $1::date AND DATE(${fromExpr}) <= $2::date`
      : "l.started_date IS NOT NULL AND DATE(l.started_date) >= $1::date AND DATE(l.started_date) <= $2::date";

    const countQuery = `
      WITH cohort AS (
        SELECT l.started_date,
               ${fromExpr} AS from_d,
               ${toExpr} AS to_d,
               ${bucketSql} AS bucket
        FROM public.loans l
        WHERE ${cohortWhereIndividual}
          ${channelClause}
          ${accessClause}
      )
      SELECT
        COUNT(*) FILTER (WHERE from_d IS NOT NULL) AS left_count,
        COUNT(*) FILTER (WHERE from_d IS NOT NULL AND to_d IS NOT NULL) AS right_count,
        COUNT(*) FILTER (WHERE from_d IS NOT NULL AND to_d IS NOT NULL) AS both_count,
        CASE
          WHEN COUNT(*) FILTER (WHERE from_d IS NOT NULL AND to_d IS NOT NULL) > 0
          THEN AVG((to_d::date - from_d::date)) FILTER (WHERE from_d IS NOT NULL AND to_d IS NOT NULL)
          ELSE NULL
        END AS avg_days
      FROM cohort
    `;

    const countResult = await tenantPool.query(countQuery, params);
    const row = countResult.rows[0];
    const leftCount = parseInt(row?.left_count ?? "0", 10) || 0;
    const rightCount = parseInt(row?.right_count ?? "0", 10) || 0;
    const bothCount = parseInt(row?.both_count ?? "0", 10) || 0;
    const avgDaysRaw = row?.avg_days;
    const avgTurnTimeDays =
      avgDaysRaw != null && !Number.isNaN(Number(avgDaysRaw)) ? Math.round(Number(avgDaysRaw)) : null;
    const conversionPercent =
      leftCount > 0 ? Math.round((rightCount / leftCount) * 10000) / 100 : null;

    const seriesQuery = `
      WITH cohort AS (
        SELECT l.started_date,
               ${fromExpr} AS from_d,
               ${toExpr} AS to_d,
               ${bucketSql} AS bucket
        FROM public.loans l
        WHERE ${cohortWhereIndividual}
          ${channelClause}
          ${accessClause}
      )
      SELECT
        bucket AS period,
        COUNT(*) FILTER (WHERE from_d IS NOT NULL) AS left_count,
        COUNT(*) FILTER (WHERE from_d IS NOT NULL AND to_d IS NOT NULL) AS right_count,
        AVG((to_d::date - from_d::date)) FILTER (WHERE from_d IS NOT NULL AND to_d IS NOT NULL) AS avg_days
      FROM cohort
      GROUP BY bucket
      ORDER BY bucket
    `;

    const seriesResult = await tenantPool.query(seriesQuery, params);
    const series: SeriesPoint[] = (seriesResult.rows || []).map((r: any) => {
      const period =
        byDay && r.period
          ? (typeof r.period === "string" ? r.period : r.period?.toISOString?.()?.slice(0, 10) ?? String(r.period))
          : r.period
            ? (() => {
                const d = typeof r.period === "string" ? new Date(r.period) : r.period;
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
              })()
            : "";
      const left = parseInt(r.left_count ?? "0", 10) || 0;
      const right = parseInt(r.right_count ?? "0", 10) || 0;
      const conv = left > 0 ? Math.round((right / left) * 10000) / 100 : null;
      const avgD =
        r.avg_days != null && !Number.isNaN(Number(r.avg_days))
          ? Math.round(Number(r.avg_days))
          : null;
      return {
        period,
        leftCount: left,
        rightCount: right,
        conversionPercent: conv,
        avgTurnTimeDays: avgD,
      };
    });
    results.push({
      from: seg.from,
      to: seg.to,
      leftCount,
      rightCount,
      conversionPercent,
      avgTurnTimeDays,
      series,
    });
  }

  return { segments: results };
}
