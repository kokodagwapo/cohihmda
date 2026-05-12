/**
 * Stable page_key values for cohi_dashboard_filters (My Insights profile).
 * Use these strings with useDashboardFilterAnalytics(pageKey, filters).
 */
export const DASHBOARD_PAGE_KEYS = {
  lock_stratification: "lock_stratification",
  workflow_conversion: "workflow_conversion",
  pipeline_analysis: "pipeline_analysis",
  loan_funnel: "loan_funnel",
  loan_funnel_legacy: "loan_funnel_legacy",
  loan_complexity: "loan_complexity",
  operations_scorecard: "operations_scorecard",
  operation_scorecard_trends: "operation_scorecard_trends",
  sales_scorecard_overview: "sales_scorecard_overview",
  actors: "actors",
  estimated_closings_risk: "estimated_closings_risk",
  pricing_dashboard: "pricing_dashboard",
  active_workload: "active_workload",
  toptiering_comparison: "toptiering_comparison",
  financial_modeling_sandbox: "financial_modeling_sandbox",
  ops_view: "ops_view",
  sales_view: "sales_view",
  company_detail: "company_detail",
  loan_detail: "loan_detail",
  top_tiering: "top_tiering",
  /** Standalone pages from top-nav dashboard directory */
  sales_company_overview: "sales_company_overview",
  fallout_forecast: "fallout_forecast",
  business_overview: "business_overview",
  leaderboard: "leaderboard",
  high_performers: "high_performers",
  company_scorecard: "company_scorecard",
  credit_risk_management: "credit_risk_management",
  capture_analysis: "capture_analysis",
  sales_trends: "sales_trends",
  production_trends: "production_trends",
  production_summary_by_week: "production_summary_by_week",
  /** Main sales scorecard (distinct from sales_scorecard_overview widget/page) */
  sales_scorecard: "sales_scorecard",
  data_quality: "data_quality",
} as const;
