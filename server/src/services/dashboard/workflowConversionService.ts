/**
 * Workflow Conversion Service
 *
 * Individual: each segment's cohort = loans whose "from" milestone date is in range.
 *
 * Workflow (strict funnel): each segment's cohort = loans with started_date in range
 * AND who have passed all previous segments (have segment0.to, segment1.to, ..., segment[i-1].to).
 * So segment N's left count = segment N-1's right count (trickle-down).
 * - Left count = size of cohort (everyone in cohort has the "from" milestone by construction).
 * - Right count = cohort members who also have the "to" milestone date.
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
  const isIndividual = grouping === "individual";

  // For workflow strict funnel: precompute "to" expressions for previous segments (used in cohort filter)
  const segmentToExpressions: string[] = segments.map((s) => getDateExpression(s.to, "l"));

  for (let segIndex = 0; segIndex < segments.length; segIndex++) {
    const seg = segments[segIndex];
    const fromExpr = getDateExpression(seg.from, "l");
    const toExpr = getDateExpression(seg.to, "l");
    const bucketSql = getBucketSql(byDay, isIndividual, fromExpr);
    // Graph only: always bucket by from-milestone date so x-axis is "when they hit from" (workflow cohort logic unchanged)
    const seriesBucketSql = getBucketSql(byDay, true, fromExpr);

    let cohortWhere: string;
    if (isIndividual) {
      cohortWhere = `${fromExpr} IS NOT NULL AND DATE(${fromExpr}) >= $1::date AND DATE(${fromExpr}) <= $2::date`;
    } else {
      // Workflow strict funnel: cohort = started_date in range AND passed all previous segments
      const base = "l.started_date IS NOT NULL AND DATE(l.started_date) >= $1::date AND DATE(l.started_date) <= $2::date";
      const passedPrevious =
        segIndex === 0
          ? ""
          : segmentToExpressions
              .slice(0, segIndex)
              .map((expr) => `${expr} IS NOT NULL`)
              .join(" AND ");
      cohortWhere = passedPrevious ? `${base} AND ${passedPrevious}` : base;
    }

    // In workflow strict funnel, everyone in cohort has "from" (it's the previous segment's "to"), so left_count = cohort size
    const countQuery = `
      WITH cohort AS (
        SELECT l.started_date,
               ${fromExpr} AS from_d,
               ${toExpr} AS to_d,
               ${bucketSql} AS bucket
        FROM public.loans l
        WHERE ${cohortWhere}
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
               ${seriesBucketSql} AS bucket
        FROM public.loans l
        WHERE ${cohortWhere}
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

export type WorkflowSegmentLoanFilter = "initial" | "fallout" | "pull-through";

export interface WorkflowConversionSegmentLoansOptions {
  startDate: string;
  endDate: string;
  segments: WorkflowSegmentInput[];
  grouping?: WorkflowGrouping;
  channelGroup?: string;
  accessClause?: string;
  accessParams?: unknown[];
  segmentIndex: number;
  filter: WorkflowSegmentLoanFilter;
}

export interface WorkflowSegmentLoanRow {
  loan_id: string;
  loan_number: string | null;
  loan_amount: number | null;
  fico_score: number | null;
  ltv_ratio: number | null;
  be_dti_ratio: number | null;
  branch: string | null;
  loan_officer: string | null;
  loan_type: string | null;
  loan_purpose: string | null;
  occupancy_type: string | null;
  channel: string | null;
  current_loan_status: string | null;
  from_date: string | null;
  to_date: string | null;
}

export async function getWorkflowConversionSegmentLoans(
  tenantPool: pg.Pool,
  options: WorkflowConversionSegmentLoansOptions
): Promise<{ loans: WorkflowSegmentLoanRow[] }> {
  const {
    startDate,
    endDate,
    segments,
    grouping = "workflow",
    channelGroup,
    accessClause: accessClauseOpt,
    accessParams: accessParamsOpt,
    segmentIndex,
    filter,
  } = options;

  if (segmentIndex < 0 || segmentIndex >= segments.length) {
    return { loans: [] };
  }

  const params: unknown[] = [startDate, endDate];
  const accessClause = accessClauseOpt ? " " + accessClauseOpt.trim() : "";
  if (accessParamsOpt && accessParamsOpt.length > 0) {
    params.push(...accessParamsOpt);
  }
  if (accessClauseOpt?.trim() === "AND FALSE") {
    return { loans: [] };
  }

  const channelClause = buildChannelWhereClause(channelGroup, "l");
  const isIndividual = grouping === "individual";
  const segmentToExpressions: string[] = segments.map((s) => getDateExpression(s.to, "l"));
  const seg = segments[segmentIndex];
  const fromExpr = getDateExpression(seg.from, "l");
  const toExpr = getDateExpression(seg.to, "l");

  let cohortWhere: string;
  if (isIndividual) {
    cohortWhere = `${fromExpr} IS NOT NULL AND DATE(${fromExpr}) >= $1::date AND DATE(${fromExpr}) <= $2::date`;
  } else {
    const base =
      "l.started_date IS NOT NULL AND DATE(l.started_date) >= $1::date AND DATE(l.started_date) <= $2::date";
    const passedPrevious =
      segmentIndex === 0
        ? ""
        : segmentToExpressions
            .slice(0, segmentIndex)
            .map((expr) => `${expr} IS NOT NULL`)
            .join(" AND ");
    cohortWhere = passedPrevious ? `${base} AND ${passedPrevious}` : base;
  }

  let filterWhere: string;
  switch (filter) {
    case "initial":
      filterWhere = `${fromExpr} IS NOT NULL`;
      break;
    case "fallout":
      filterWhere = `${fromExpr} IS NOT NULL AND ${toExpr} IS NULL`;
      break;
    case "pull-through":
      filterWhere = `${fromExpr} IS NOT NULL AND ${toExpr} IS NOT NULL`;
      break;
    default:
      filterWhere = "1=0";
  }

  const sql = `
    SELECT
      l.loan_id,
      l.loan_number,
      l.loan_amount,
      l.fico_score,
      l.ltv_ratio,
      l.be_dti_ratio,
      l.branch,
      l.loan_officer,
      l.loan_type,
      l.loan_purpose,
      l.occupancy_type,
      l.channel,
      l.current_loan_status,
      (${fromExpr})::date::text AS from_date,
      (${toExpr})::date::text AS to_date
    FROM public.loans l
    WHERE ${cohortWhere}
      AND ${filterWhere}
      ${channelClause}
      ${accessClause}
    ORDER BY l.loan_id
  `;

  const result = await tenantPool.query(sql, params);
  const loans: WorkflowSegmentLoanRow[] = (result.rows || []).map((r: any) => ({
    loan_id: String(r.loan_id),
    loan_number: r.loan_number != null ? String(r.loan_number) : null,
    loan_amount: r.loan_amount != null ? Number(r.loan_amount) : null,
    fico_score: r.fico_score != null ? Number(r.fico_score) : null,
    ltv_ratio: r.ltv_ratio != null ? Number(r.ltv_ratio) : null,
    be_dti_ratio: r.be_dti_ratio != null ? Number(r.be_dti_ratio) : null,
    branch: r.branch != null ? String(r.branch) : null,
    loan_officer: r.loan_officer != null ? String(r.loan_officer) : null,
    loan_type: r.loan_type != null ? String(r.loan_type) : null,
    loan_purpose: r.loan_purpose != null ? String(r.loan_purpose) : null,
    occupancy_type: r.occupancy_type != null ? String(r.occupancy_type) : null,
    channel: r.channel != null ? String(r.channel) : null,
    current_loan_status: r.current_loan_status != null ? String(r.current_loan_status) : null,
    from_date: r.from_date != null ? String(r.from_date) : null,
    to_date: r.to_date != null ? String(r.to_date) : null,
  }));

  return { loans };
}
