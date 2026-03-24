import type { DashboardInsight } from "./types.js";

export type EvidenceProfile =
  | "aggregate_context"
  | "cohort_period_trend"
  | "cohort_kpis"
  | "cohort_detail";

export interface EvidenceIntent {
  profile: EvidenceProfile;
  widgetId?: string;
  targetType?: "row" | "series" | "cell";
  targetLabel?: string;
  applicationType?: string;
  datePeriod?: string;
  loanMixDimension?: string;
}

export interface EvidenceSelectionInput {
  pageId: string;
  insight: DashboardInsight;
}
