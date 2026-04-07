/**
 * Dashboard Insights — TypeScript types
 *
 * Page context (input to the pipeline) and pipeline output (per insight)
 * as defined in docs/DASHBOARD_INSIGHTS_IMPLEMENTATION_PLAN.md.
 */

// ---------------------------------------------------------------------------
// Page context (input to the pipeline)
// ---------------------------------------------------------------------------

export interface DashboardDimension {
  id: string;
  label: string;
  type: "filter" | "structural";
  values: string[];
}

export interface WidgetCatalogEntry {
  id: string;
  type: "kpi" | "table" | "chart" | "other";
  label: string;
  description?: string;
  dimension?: string;
  columns_or_series?: string[];
}

export interface DashboardPageContext {
  pageId: string;
  pageName: string;
  pageDescription?: string;
  /** Page-specific instructions for the generator (e.g. cross-period comparisons, high-performer trends). */
  pageGuidance?: string[];
  filters: Record<string, unknown>;
  dimensions: DashboardDimension[];
  data: {
    summary: Record<string, unknown>;
    by_dimension: Record<string, Array<Record<string, unknown>>>;
    /** When present, one entry per time period (e.g. MTD, QTD, LQ) for cross-period insights */
    by_time_period?: Record<string, unknown>;
  };
  widget_catalog: WidgetCatalogEntry[];
}

// ---------------------------------------------------------------------------
// Pipeline output (per insight) — DB shape and API
// ---------------------------------------------------------------------------

export interface EvidenceRefTarget {
  type: "row" | "series" | "cell";
  label: string;
}

export interface EvidenceRef {
  widgetId: string;
  role: "primary" | "supporting";
  target?: EvidenceRefTarget;
  /** Optional display value from the widget at generation time (e.g. "12 units", "47%") */
  value?: string;
}

export interface DashboardInsightFilterContext {
  datePeriod?: string;
  channelGroup?: string;
  [key: string]: unknown;
}

/** One row of supporting data by time period (for evidence table in the UI). */
export interface SupportingDataByPeriodRow {
  period: string;
  periodLabel?: string;
  /** Optional cohort/segment label (e.g. '>50.00', 'FHA') when rows are insight-scoped */
  bucketLabel?: string;
  /** Optional cohort dimension for insight-scoped evidence (e.g. dti, fico, ltv, loan_type) */
  cohortDimension?: string;
  /** Optional selected application type for insight-scoped evidence */
  applicationType?: string;
  averagePullThrough?: number;
  totalUnits?: number;
  unitsPercent?: number;
  totalVolume?: number;
  volumePercent?: number;
  topPerformerName?: string;
  topPerformerUnits?: number;
  topPerformerVolume?: number;
  /** Loan complexity: portfolio WA complexity for the period */
  portfolioWaComplexity?: number;
  /** Loan complexity: portfolio pull-through % (application-date cohort); also mirrored into averagePullThrough for evidence UI */
  portfolioPullThrough?: number;

  // Company Scorecard (tier + entity metrics)
  wac?: number;
  originatedUnits?: number;
  originatedUnitsPct?: number;
  withdrawnUnits?: number;
  withdrawnUnitsPct?: number;
  deniedUnits?: number;
  deniedUnitsPct?: number;
  waFico?: number;
  waLtv?: number;
  waDti?: number;
  conventionalQualifiedPercent?: number;
  governmentQualifiedPercent?: number;
  originatedPercent?: number;
  deniedPercent?: number;
  withdrawnPercent?: number;
  activePercent?: number;
  /** Workflow conversion: compact per-period summary of all default segments */
  workflowBrief?: string;
  [key: string]: unknown;
}

export interface SupportingData {
  /** Generic profile chosen by evidence selector. */
  profile?: string;
  /** Optional cohort target metadata for dynamic evidence rendering. */
  target?: { type?: string; label?: string };
  byPeriod?: SupportingDataByPeriodRow[];
  /** Optional detail rows (e.g. loan-level cohort evidence). */
  detailRows?: Array<Record<string, unknown>>;
  /** Optional KPI summary for the selected evidence profile. */
  summary?: Record<string, number | string>;
}

/**
 * Detail snapshot shape matching InsightDetailSnapshot / DetailData so the same
 * details API and InsightDetailModal can consume dashboard insights.
 */
export interface DashboardDetailSnapshotColumnDef {
  key: string;
  label: string;
  format: "text" | "currency" | "percent" | "number" | "date" | "rate" | "days" | "mono" | "badge" | "bps";
  align: "left" | "right" | "center";
}

export interface DashboardDetailSnapshotSummaryDef {
  key: string;
  label: string;
  value: number | string;
  format: "number" | "currency" | "percent" | "days" | "bps";
  color: "blue" | "green" | "red" | "amber" | "purple";
}

export interface DashboardDetailSnapshotAudit {
  pipelineContext?: {
    generationBatch?: string;
    dateFilter?: string;
    stepTimings?: { evidence?: number; total?: number };
  };
  generatedSql?: string;
  rowCount: number;
  rawSummary: DashboardDetailSnapshotSummaryDef[];
  resolvedSummary: DashboardDetailSnapshotSummaryDef[];
  finalSummary: DashboardDetailSnapshotSummaryDef[];
  corrections: Array<{ key: string; label: string; from: number; to: number; reason: string }>;
}

export interface DashboardDetailSnapshot {
  title: string;
  summary: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  displayConfig: {
    columns: string[];
    summaryMetrics: string[];
    column_defs?: DashboardDetailSnapshotColumnDef[];
    summary_defs?: DashboardDetailSnapshotSummaryDef[];
  };
  etm?: {
    what_changed?: string;
    why?: string;
    business_impact?: string;
    risk_if_ignored?: string;
    recommended_action?: string;
    owner?: string;
  };
  comparison?: {
    label: string;
    currentLabel: string;
    rows: Array<Record<string, unknown>>;
    summary: Record<string, unknown>;
    summary_defs?: DashboardDetailSnapshotSummaryDef[];
  };
  audit?: DashboardDetailSnapshotAudit;
}

export interface DashboardInsight {
  id?: number;
  headline: string;
  understory: string;
  sentiment: "positive" | "warning" | "critical" | "neutral";
  severity_score: number;
  cited_numbers: string[];
  what_changed: string;
  why: string;
  business_impact: string;
  risk_if_ignored: string;
  recommended_action: string;
  owner: string;
  scope: "page" | "widget";
  filter_context: DashboardInsightFilterContext;
  evidence_refs: EvidenceRef[];
  escalate: boolean;
  sourcePageId: string;
  sourcePageName: string;
  functional_category?: string;
  /** Optional snapshot of by-period metrics for evidence table (e.g. leaderboard MTD/LM/QTD). */
  supporting_data?: SupportingData;
  /** Pre-hydrated detail snapshot for details API (same shape as original pipeline detail_data). */
  detail_data?: DashboardDetailSnapshot | null;
}

/**
 * Map dashboard pageId → functional_category for the Cohi tabbed view.
 */
export const DASHBOARD_PAGE_CATEGORY_MAP: Record<string, string> = {
  "leaderboard": "sales",
  "loan-complexity": "operations",
  "company-scorecard": "finance",
  "credit-risk-management": "compliance",
  "top-tiering-comparison": "sales",
};

// ---------------------------------------------------------------------------
// DB row shape (dashboard_generated_insights table)
// ---------------------------------------------------------------------------

export interface DashboardGeneratedInsightRow {
  id: number;
  page_id: string;
  page_name: string;
  headline: string;
  understory: string | null;
  sentiment: string;
  severity_score: number | null;
  scope: string;
  escalate: boolean;
  what_changed: string | null;
  why: string | null;
  business_impact: string | null;
  risk_if_ignored: string | null;
  recommended_action: string | null;
  owner: string | null;
  filter_context: Record<string, unknown>;
  evidence_refs: EvidenceRef[];
  cited_numbers: string[];
  generation_batch: string;
  generated_at: Date;
  created_at: Date | null;
}
