/**
 * Dashboard Insights — Workflow Conversion page adapter
 *
 * Default milestone chain (workflow grouping): cohort = started_date in window with prior milestone dates;
 * six segments match the UI defaults. Data for MTD, LM, QTD, LQ, YTD, LY for cross-period comparisons.
 */

import type { Pool } from "pg";
import { getDateRangeForTimeframe } from "../../dashboard/analyticsService.js";
import {
  getWorkflowConversionData,
  getWorkflowConversionMilestones,
  type WorkflowMilestoneOption,
} from "../../dashboard/workflowConversionService.js";
import type { DashboardAdapter } from "./baseDashboardAdapter.js";
import type { DashboardDimension, DashboardPageContext, WidgetCatalogEntry } from "../types.js";

const INSIGHT_TIMEFRAMES = ["mtd", "qtd", "ytd", "lq", "lm", "ly"] as const;
type InsightTimeframe = (typeof INSIGHT_TIMEFRAMES)[number];

/** Same milestone pairs as frontend DEFAULT_WORKFLOW_SEGMENTS (`src/lib/workflowConversionMilestones.ts`). */
const DEFAULT_WORKFLOW_SEGMENTS: { from: string; to: string }[] = [
  { from: "started_date", to: "application_date" },
  { from: "application_date", to: "processing_date" },
  { from: "processing_date", to: "submitted_to_underwriting_date" },
  { from: "submitted_to_underwriting_date", to: "uw_final_approval_date" },
  { from: "uw_final_approval_date", to: "ctc_date" },
  { from: "ctc_date", to: "funding_date" },
];

const PERIOD_LABELS: Record<string, string> = {
  mtd: "Month-to-Date",
  qtd: "Quarter-to-Date",
  ytd: "Year-to-Date",
  lq: "Last Quarter",
  lm: "Last Month",
  ly: "Last Calendar Year",
};

function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${fmt(start)} to ${fmt(end)}`;
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildSegmentLabel(fromId: string, toId: string, milestones: WorkflowMilestoneOption[]): string {
  const fromM = milestones.find((m) => m.id === fromId || m.column === fromId);
  const toM = milestones.find((m) => m.id === toId || m.column === toId);
  const a = fromM?.label ?? fromId;
  const b = toM?.label ?? toId;
  return `${a} → ${b}`;
}

/** Static fallback when Milestones API is not used (widget catalog only); matches columnNameToLabel-style titles. */
const STATIC_CATALOG_MILESTONES: WorkflowMilestoneOption[] = [
  { id: "started_date", label: "Started", column: "started_date" },
  { id: "application_date", label: "Application", column: "application_date" },
  { id: "processing_date", label: "Processing", column: "processing_date" },
  { id: "submitted_to_underwriting_date", label: "Submitted To Underwriting", column: "submitted_to_underwriting_date" },
  { id: "uw_final_approval_date", label: "Uw Final Approval", column: "uw_final_approval_date" },
  { id: "ctc_date", label: "CTC", column: "ctc_date" },
  { id: "funding_date", label: "Funding", column: "funding_date" },
];

function buildWidgetCatalog(segmentLabels: string[]): WidgetCatalogEntry[] {
  return segmentLabels.map((label, index) => ({
    id: `workflow-conversion-segment-${index}`,
    type: "chart" as const,
    label: `Workflow segment — ${label}`,
    description:
      "Milestone card: starting count, ending count, conversion %, avg turn time (days), and time-bucket chart for the selected period",
    dimension: "workflow_segment",
    columns_or_series: ["leftCount", "rightCount", "conversionPercent", "avgTurnTimeDays"],
  }));
}

const PAGE_DESCRIPTION =
  "Workflow Conversion measures how loans move between milestone dates using the default six-step funnel " +
  "(Started → Application → Processing → Submitted to Underwriting → UW Final Approval → CTC → Funding). " +
  "With Workflow grouping, the cohort is loans whose started_date falls in the selected window and who have " +
  "reached prior milestones in the chain (strict funnel). For each segment, data includes leftCount (files at the from-milestone), " +
  "rightCount (files at the to-milestone), conversionPercent (rightCount/leftCount as a percentage), and avgTurnTimeDays " +
  "(mean calendar days between the two milestone dates among loans that have both). " +
  "The in-app chart buckets by from-milestone date (daily if the window is ≤31 days, else monthly). " +
  "The user can toggle Conversion % vs Turn Time on the page; both metrics appear in context for every canonical period. " +
  "Insight narratives may take two complementary shapes. (1) Temporal: compare the same segment across windows—e.g. MTD vs LM, QTD vs LQ, or YTD vs LY—to describe improvement or deterioration in conversion or turn time. " +
  "(2) Bottleneck within one window: fix on a single period (e.g. LY or QTD) and compare all six default segments side by side. Rank or contrast segments by conversion % and/or avg turn time to identify the weakest link—e.g. " +
  "Processing → Submitted to Underwriting had the lowest conversion in that window, concentrating fallout and acting as the funnel bottleneck—using the per-segment counts and rates from that period only, not a multi-period table. " +
  "For bottleneck-style insights, set filter_context.datePeriod to that one window, and cite evidence_refs on the segment widget(s) that embody the claim; evidence values should reflect leftCount, rightCount, conversionPercent, and avgTurnTimeDays for the cited milestone pair(s) drawn from summary.defaultSegments for that period.";

export const workflowConversionAdapter: DashboardAdapter = {
  pageId: "workflow-conversion",
  pageName: "Workflow Conversion",
  pageDescription: PAGE_DESCRIPTION,

  async getFilterCombinations(_tenantPool: Pool): Promise<Record<string, unknown>[]> {
    return [{}];
  },

  getWidgetCatalog(): WidgetCatalogEntry[] {
    const staticLabels = DEFAULT_WORKFLOW_SEGMENTS.map((s) => buildSegmentLabel(s.from, s.to, STATIC_CATALOG_MILESTONES));
    return buildWidgetCatalog(staticLabels);
  },

  async buildContext(
    tenantPool: Pool,
    filters: Record<string, unknown>,
    _accessClause?: string
  ): Promise<DashboardPageContext> {
    const channelGroup = filters.channelGroup as string | undefined;
    const milestones = await getWorkflowConversionMilestones(tenantPool);
    const segmentLabels = DEFAULT_WORKFLOW_SEGMENTS.map((s) => buildSegmentLabel(s.from, s.to, milestones));

    const WIDGET_CATALOG = buildWidgetCatalog(segmentLabels);

    const byTimePeriod: Record<string, unknown> = {};

    for (const tf of INSIGHT_TIMEFRAMES) {
      const range = getDateRangeForTimeframe(tf as InsightTimeframe);
      const startDate = toYmd(range.start);
      const endDate = toYmd(range.end);

      const result = await getWorkflowConversionData(tenantPool, {
        startDate,
        endDate,
        segments: DEFAULT_WORKFLOW_SEGMENTS,
        metric: "conversion",
        grouping: "workflow",
        channelGroup: channelGroup || undefined,
        accessClause: _accessClause,
      });

      const defaultSegments = (result.segments ?? []).map((seg, index) => ({
        label: segmentLabels[index] ?? buildSegmentLabel(seg.from, seg.to, milestones),
        from: seg.from,
        to: seg.to,
        leftCount: seg.leftCount,
        rightCount: seg.rightCount,
        conversionPercent: seg.conversionPercent,
        avgTurnTimeDays: seg.avgTurnTimeDays,
      }));

      byTimePeriod[tf.toUpperCase()] = {
        periodLabel: PERIOD_LABELS[tf] || tf.toUpperCase(),
        dateRange: formatDateRange(range.start, range.end),
        summary: {
          groupingMode: "workflow",
          defaultSegments,
        },
      };
    }

    const dimensions: DashboardDimension[] = [
      {
        id: "time_period",
        label: "Time period",
        type: "filter",
        values: INSIGHT_TIMEFRAMES.map((p) => p.toUpperCase()),
      },
      {
        id: "workflow_segment",
        label: "Workflow segment (default funnel)",
        type: "structural",
        values: [...segmentLabels],
      },
    ];

    return {
      pageId: "workflow-conversion",
      pageName: "Workflow Conversion",
      pageDescription: PAGE_DESCRIPTION,
      pageGuidance: [
        "by_time_period keys are uppercase: MTD, QTD, YTD, LQ, LM, LY. Each period includes periodLabel, dateRange, and summary.defaultSegments[] (one row per default segment, in funnel order).",
        "Each defaultSegments[] row has label (exact UI string), leftCount, rightCount, conversionPercent, and avgTurnTimeDays as defined in pageDescription.",
        "Two valid insight patterns: (A) Temporal — same segment across multiple periods to show trend or period-vs-period change. (B) Single-period bottleneck — pick one datePeriod, read all six rows in summary.defaultSegments for that period only, and identify which segment is the weakest link (e.g. lowest conversion %, or unusually high avg turn time vs siblings). Frame the story around that window; avoid mixing period labels when the insight is purely intra-period ranking.",
        "For bottleneck insights: set filter_context.datePeriod to the single window analyzed (e.g. ly). Primary evidence should be workflow-conversion-segment-{i} for the bottleneck segment (and optionally supporting refs for adjacent segments). Supporting numeric narrative should use counts, conversion %, and avg days per milestone from that period’s defaultSegments — not a column-per-time-period layout.",
        "Chronology: when comparing periods (pattern A), infer earlier vs later from dateRange/periodLabel — never from JSON key order.",
        "Good vs bad: higher conversion % is better; lower avg turn time is better (faster).",
        "Scope insights to the default six segments only (ignore Individual grouping). Do not claim custom milestone pairs the user might select in the UI.",
        "evidence_refs.widgetId must be one of: workflow-conversion-segment-0 … workflow-conversion-segment-5 (0=Started→Application … 5=CTC→Funding).",
        "When citing a segment, set evidence_refs.target.label to the exact defaultSegments[].label from context for that index and period.",
        "filter_context.datePeriod must be lowercase mtd|qtd|ytd|lq|lm|ly. When the narrative focuses on turn time, set filter_context.calculationType to 'turn_time'; when focused on conversion %, set 'conversion'. Optional filter_context.segmentIndex (0–5) and/or filter_context.segmentLabel (exact label) should match the cited segment(s).",
        "Optional filter_context.channelGroup when channel-scoped; omit when not relevant.",
      ],
      filters: channelGroup ? { channelGroup } : {},
      dimensions,
      data: {
        summary: {
          note: "Workflow conversion default funnel; by_time_period contains per-period defaultSegments metrics.",
          periodsIncluded: INSIGHT_TIMEFRAMES.map((p) => p.toUpperCase()),
          milestoneChain: segmentLabels,
        },
        by_dimension: {},
        by_time_period: byTimePeriod,
      },
      widget_catalog: WIDGET_CATALOG,
    };
  },
};
