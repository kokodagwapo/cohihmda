/**
 * COHI orchestration types (server).
 * Response plan shape matches frontend src/types/cohiResponsePlan.ts.
 */

export type LayoutType = "bullets" | "table" | "kpi_cards" | "chart" | "mixed";
export type ConfidenceLevel = "high" | "medium" | "low";

export type SectionType =
  | "header_summary"
  | "kpi_cards"
  | "ranked_table"
  | "grouped_table"
  | "bullet_insights"
  | "chart"
  | "anomalies_and_risks"
  | "forecast_and_scenarios"
  | "recommended_actions"
  | "data_notes";

export interface HeaderSummaryProps {
  whatYouAsked: string;
  whatIFound: string;
  whyItMatters?: string;
}

export interface KpiCardItem {
  label: string;
  value: number | string;
  delta?: number;
  trend?: "up" | "down" | "neutral";
  format?: "number" | "currency" | "percent";
}

export interface RankedTableColumn {
  key: string;
  label: string;
  format?: "number" | "currency" | "percent" | "text";
}

export interface ChartSectionProps {
  chartType: "line" | "bar" | "area" | "pie" | "scatter";
  title: string;
  xKey: string;
  yKeys: string[];
  seriesLabels?: string[];
  dataRef: string;
  options?: { stacked?: boolean; showLegend?: boolean; showGrid?: boolean };
}

export interface RecommendedActionItem {
  title: string;
  reason?: string;
  impact?: string;
  nextStep?: string;
}

export interface DataSourceItem {
  type: "db" | "upload";
  name: string;
  id?: string;
}

export interface ResponsePlanSection {
  type: SectionType;
  props: Record<string, unknown>;
}

export interface ResponsePlan {
  layout_type: LayoutType;
  title: string;
  subtitle?: string;
  confidence_level: ConfidenceLevel;
  sections: ResponsePlanSection[];
  missing_data_requests?: { question: string; options?: string[] }[];
}

export interface CohiQueryAudit {
  queriesExecuted?: string[];
  datasetsUsed?: string[];
  uploadsUsed?: string[];
  generatedAt: string;
  latencyMs?: number;
}

export type IntentType =
  | "toptiering_top"
  | "toptiering_bottom"
  | "toptiering_mid_trend"
  | "toptiering_compare"
  | "exec_summary"
  | "compare_tiers"
  | "upload_ranking"
  | "generic_data";

export interface IntentResult {
  intent: IntentType;
  params: {
    actor?: "branch" | "loan_officer";
    startDate?: string;
    endDate?: string;
    tier?: "top" | "mid" | "bottom";
    metric?: string;
  };
}

export interface SelectedSource {
  type: "toptiering" | "dashboard" | "upload";
  id?: string;
  params?: Record<string, unknown>;
}

export interface CohiQueryContext {
  tenantId: string;
  userId: string;
  question: string;
  context?: {
    currentPage?: string;
    dashboardId?: string;
    sheetId?: string;
    activeFilters?: Record<string, unknown>;
    selectedDatasetIds?: string[];
    referencedUploadIds?: string[];
  };
}
