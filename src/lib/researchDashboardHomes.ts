/**
 * Maps widget data sources to canonical in-app dashboard routes (COHI-365 / COHI-366).
 */

import type { DataSourceId } from "@/components/widgets/registry/types";

export const DATA_SOURCE_DASHBOARD_HOME: Partial<
  Record<DataSourceId, { path: string; label: string; sectionId?: string }>
> = {
  "company-scorecard": { path: "/company-scorecard", label: "Company Scorecard", sectionId: "companyScorecard" },
  "credit-risk": { path: "/credit-risk-management", label: "Credit Risk Management", sectionId: "creditRiskManagement" },
  "sales-scorecard": { path: "/sales-scorecard", label: "Sales Scorecard", sectionId: "salesScorecard" },
  "operations-scorecard": {
    path: "/performance/operation-scorecard",
    label: "Operations Scorecard",
    sectionId: "operationsScorecard",
  },
  "operations-trends": {
    path: "/performance/operation-scorecard-trends",
    label: "Operations Trends",
    sectionId: "operationsTrends",
  },
  "sales-trends": { path: "/sales-trends", label: "Sales Trends", sectionId: "salesTrends" },
  funnel: { path: "/insights", label: "Loan Funnel", sectionId: "loanFunnel" },
  "top-tiering-comparison": {
    path: "/performance/toptiering-comparison",
    label: "TopTiering Comparison",
    sectionId: "topTieringComparison",
  },
  "dashboard-insights": { path: "/insights", label: "Insights" },
  "dashboard-metrics": { path: "/insights", label: "Insights" },
  "executive-dashboard": { path: "/business-overview", label: "Business Overview", sectionId: "executiveDashboard" },
  "closing-forecast": { path: "/fallout-forecast", label: "Closing & Fallout Forecast", sectionId: "closingFalloutForecast" },
  "financial-modeling": {
    path: "/performance/financial-modeling-sandbox",
    label: "Financial Modeling",
    sectionId: "financialModeling",
  },
  "Cohi-insights": { path: "/data-chat", label: "Cohi Chat" },
  "industry-news": { path: "/insights", label: "Industry News" },
  "loan-detail": { path: "/loan-detail", label: "Loan Detail", sectionId: "loanDetail" },
  "workflow-conversion": { path: "/workflow-conversion", label: "Workflow Conversion", sectionId: "workflowConversion" },
  "high-performers": { path: "/high-performers", label: "High Performers", sectionId: "highPerformers" },
  actors: { path: "/actors", label: "Actors", sectionId: "actors" },
  "pricing-dashboard": { path: "/pricing-dashboard", label: "Pricing Dashboard", sectionId: "pricingDashboard" },
  "pipeline-analysis": { path: "/pipeline-analysis", label: "Pipeline Analysis", sectionId: "pipelineAnalysis" },
  "sales-scorecard-overview": {
    path: "/sales-scorecard-overview",
    label: "Sales Scorecard Overview",
    sectionId: "salesScorecardOverview",
  },
  "lock-stratification": { path: "/lock-stratification", label: "Lock Stratification", sectionId: "lockStratification" },
  "loan-complexity": { path: "/loan-complexity", label: "Loan Complexity", sectionId: "loanComplexity" },
  "estimated-closings-risk": {
    path: "/performance/estimated-closings-risk",
    label: "Estimated Closings & Risk",
    sectionId: "estimatedClosingsRisk",
  },
};
