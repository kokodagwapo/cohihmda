/**
 * COHI-365: infer links from Research Lab evidence text/SQL to canonical product dashboards
 * and registry widgets so findings can deep-link users back to the source experience.
 */

import type { DataSourceId, WidgetDefinition } from "@/components/widgets/registry/types";
import { getAllWidgets } from "@/components/widgets/registry";
import type { ResearchVisualizationMatchConfidence, ResearchVisualizationSource } from "@/types/researchWorkbench";

export type { ResearchVisualizationSource } from "@/types/researchWorkbench";

/** Primary standalone route + label for each widget data source (App.tsx). */
export const DATA_SOURCE_DASHBOARD_HOME: Partial<
  Record<DataSourceId, { path: string; label: string; sectionId?: string }>
> = {
  "company-scorecard": { path: "/company-scorecard", label: "Company Scorecard", sectionId: "companyScorecard" },
  "credit-risk": { path: "/credit-risk-management", label: "Credit Risk Management", sectionId: "creditRiskManagement" },
  "sales-scorecard": { path: "/sales-scorecard", label: "Sales Scorecard", sectionId: "salesScorecard" },
  "operations-scorecard": { path: "/performance/operation-scorecard", label: "Operations Scorecard", sectionId: "operationsScorecard" },
  "operations-trends": { path: "/performance/operation-scorecard-trends", label: "Operations Trends", sectionId: "operationsTrends" },
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
  "production-trends": { path: "/production-trends", label: "Production Trends", sectionId: "productionTrends" },
  "production-summary-by-week": {
    path: "/production-summary-by-week",
    label: "Production Summary by Week",
    sectionId: "productionSummaryByWeek",
  },
  "lock-stratification": { path: "/lock-stratification", label: "Lock Stratification", sectionId: "lockStratification" },
  "loan-complexity": { path: "/loan-complexity", label: "Loan Complexity", sectionId: "loanComplexity" },
  "estimated-closings-risk": {
    path: "/performance/estimated-closings-risk",
    label: "Estimated Closings & Risk",
    sectionId: "estimatedClosingsRisk",
  },
  "sales-company-overview": { path: "/sales-company-overview", label: "Sales Company Overview", sectionId: "salesCompanyOverview" },
};

const DATA_SOURCE_KEYWORDS: Partial<Record<DataSourceId, string[]>> = {
  "company-scorecard": ["company scorecard", "scorecard"],
  "credit-risk": ["credit risk", "underwriting", "dti", "fico"],
  "sales-scorecard": ["sales scorecard", "lo volume", "loan officer"],
  "operations-scorecard": ["operations scorecard", "cycle time", "disclosure"],
  "operations-trends": ["operations trends"],
  "sales-trends": ["sales trends"],
  funnel: ["loan funnel", "funnel", "conversion funnel"],
  "top-tiering-comparison": ["toptiering", "top tiering", "tiering comparison"],
  "executive-dashboard": ["business overview", "executive dashboard"],
  "closing-forecast": ["fallout", "closing forecast", "forecast"],
  "financial-modeling": ["financial modeling", "modeling sandbox"],
  "workflow-conversion": ["workflow conversion", "milestone"],
  "high-performers": ["high performers", "leaderboard lo"],
  actors: ["actors", "branch manager"],
  "pricing-dashboard": ["pricing dashboard", "margin"],
  "pipeline-analysis": ["pipeline analysis"],
  "lock-stratification": ["lock stratification", "days to expiration"],
  "loan-complexity": ["loan complexity", "complexity"],
  "estimated-closings-risk": ["estimated closing", "closings risk"],
  "production-trends": ["production trends"],
  "production-summary-by-week": ["production summary"],
  "sales-company-overview": ["sales company overview"],
  "sales-scorecard-overview": ["sales scorecard overview"],
};

function buildNavigateState(
  meta: { path: string; sectionId?: string } | undefined,
): Record<string, unknown> | undefined {
  if (!meta?.sectionId) return undefined;
  if (meta.path !== "/insights") return undefined;
  return { scrollToSection: meta.sectionId };
}

function fromRegistryWidget(def: WidgetDefinition): ResearchVisualizationSource {
  const home = DATA_SOURCE_DASHBOARD_HOME[def.dataSource];
  const path = home?.path ?? "/insights";
  const label = home?.label ?? def.group;
  const navigateState = home ? buildNavigateState(home) : undefined;
  return {
    kind: "registry_widget",
    dashboardPath: path,
    dashboardLabel: label,
    sectionId: home?.sectionId,
    definitionId: def.id,
    widgetName: def.name,
    matchConfidence: "high",
    ...(navigateState && Object.keys(navigateState).length > 0 ? { navigateState } : {}),
  };
}

function fromDataSource(ds: DataSourceId, confidence: ResearchVisualizationMatchConfidence): ResearchVisualizationSource | null {
  const home = DATA_SOURCE_DASHBOARD_HOME[ds];
  if (!home) return null;
  const navigateState = buildNavigateState(home);
  return {
    kind: "dashboard",
    dashboardPath: home.path,
    dashboardLabel: home.label,
    sectionId: home.sectionId,
    matchConfidence: confidence,
    ...(navigateState && Object.keys(navigateState).length > 0 ? { navigateState } : {}),
  };
}

/**
 * Best-effort resolver: explicit widget id mention wins; else keyword → data source home route.
 */
export function resolveResearchVisualizationLineage(input: {
  sql: string;
  explanation: string;
  findingTitle?: string;
}): ResearchVisualizationSource | null {
  const hay = `${input.findingTitle || ""}\n${input.explanation}\n${input.sql}`.toLowerCase();

  let best: { def: WidgetDefinition; score: number } | null = null;
  for (const def of getAllWidgets()) {
    const id = def.id.toLowerCase();
    if (id.length < 8) continue;
    // Use substring match — \b word boundaries break on hyphens inside registry ids
    // (e.g. company-scorecard-units is three "words" to \b).
    if (hay.includes(id)) {
      const score = id.length * 3;
      if (!best || score > best.score) best = { def, score };
    }
  }
  if (best) return fromRegistryWidget(best.def);

  let bestDs: { ds: DataSourceId; score: number } | null = null;
  for (const ds of Object.keys(DATA_SOURCE_KEYWORDS) as DataSourceId[]) {
    const kws = DATA_SOURCE_KEYWORDS[ds];
    if (!kws?.length) continue;
    let score = 0;
    for (const kw of kws) {
      if (kw.length >= 4 && hay.includes(kw)) score += kw.length;
    }
    if (score > 0 && (!bestDs || score > bestDs.score)) bestDs = { ds, score };
  }
  if (bestDs && bestDs.score >= 10) {
    const src = fromDataSource(bestDs.ds, "medium");
    if (src) return src;
  }

  return null;
}
