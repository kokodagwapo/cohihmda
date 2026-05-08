/**
 * Canonical navigation targets for Cohi chat routing.
 * Keep dashboard labels/paths/keywords in one place (no route aliases in resolver logic).
 */

export interface NavigationTarget {
  id: string;
  label: string;
  group: "Insights" | "Dashboards" | "TopTiering" | "Pages" | "Help";
  kind: "route" | "section";
  path?: string;
  sectionId?: string;
  keywords: string[];
}

export const NAVIGATION_TARGETS: readonly NavigationTarget[] = [
  {
    id: "company-scorecard",
    label: "Company Scorecard",
    group: "TopTiering",
    kind: "route",
    path: "/company-scorecard",
    keywords: [
      "company scorecard",
      "scorecard",
      "portfolio conversion",
      "branch pull through",
      "pull through",
      "pullthrough",
      "conversion",
    ],
  },
  {
    id: "business-overview",
    label: "Business Overview",
    group: "Dashboards",
    kind: "route",
    path: "/business-overview",
    keywords: [
      "business overview",
      "executive snapshot",
      "kpi",
      "overview",
      "company performance",
      "pipeline kpis",
    ],
  },
  {
    id: "lock-stratification",
    label: "Lock Stratification",
    group: "TopTiering",
    kind: "route",
    path: "/lock-stratification",
    keywords: [
      "lock stratification",
      "rate lock",
      "lock stage",
      "pipeline lock",
      "lock conversion",
      "pull through by stage",
    ],
  },
  {
    id: "pipeline-analysis",
    label: "Pipeline Analysis",
    group: "TopTiering",
    kind: "route",
    path: "/pipeline-analysis",
    keywords: [
      "pipeline analysis",
      "pipeline health",
      "pipeline stages",
      "milestone",
      "active pipeline",
    ],
  },
  {
    id: "workflow-conversion",
    label: "Workflow Conversion",
    group: "TopTiering",
    kind: "route",
    path: "/workflow-conversion",
    keywords: [
      "workflow conversion",
      "conversion funnel",
      "workflow stages",
      "stage conversion",
      "funnel",
    ],
  },
  {
    id: "fallout-forecast",
    label: "Closing & Fallout Forecast",
    group: "Dashboards",
    kind: "route",
    path: "/fallout-forecast",
    keywords: [
      "fallout",
      "closing fallout",
      "withdrawn",
      "withdrawal",
      "closing risk",
      "fallout forecast",
    ],
  },
  {
    id: "leaderboard",
    label: "Leaderboard",
    group: "Dashboards",
    kind: "route",
    path: "/leaderboard",
    keywords: ["leaderboard", "ranking", "rankings", "top performers"],
  },
  {
    id: "production-trends",
    label: "Production Trends",
    group: "TopTiering",
    kind: "route",
    path: "/production-trends",
    keywords: ["production trends", "production trend", "volume trend", "trend"],
  },
  {
    id: "insights",
    label: "Insights hub",
    group: "Pages",
    kind: "route",
    path: "/insights",
    keywords: ["insights", "dashboards", "dashboard home", "insights hub"],
  },
  {
    id: "section:CohiInsights",
    label: "Cohi Insights",
    group: "Insights",
    kind: "section",
    sectionId: "CohiInsights",
    keywords: ["insights", "dashboard", "cohi insights"],
  },
  {
    id: "section:industryNews",
    label: "Cohi Mortgage News",
    group: "Insights",
    kind: "section",
    sectionId: "industryNews",
    keywords: ["industry news", "mortgage news", "insights", "dashboard"],
  },
  {
    id: "workbench",
    label: "Workbench",
    group: "Pages",
    kind: "route",
    path: "/workbench",
    keywords: ["workbench", "canvas", "custom dashboard", "custom report"],
  },
  {
    id: "research",
    label: "Research Lab",
    group: "Pages",
    kind: "route",
    path: "/research",
    keywords: ["research", "deeper analysis", "diagnose drivers", "root cause"],
  },
  {
    id: "help-what-you-can-ask",
    label: "What you can ask",
    group: "Help",
    kind: "route",
    path: "/help/cohi-chat/what-you-can-ask",
    keywords: ["what can i ask", "cohi help", "help"],
  },
  {
    id: "help-example-queries",
    label: "Example queries",
    group: "Help",
    kind: "route",
    path: "/help/cohi-chat/example-queries",
    keywords: ["example queries", "sample prompts", "prompt examples"],
  },
  {
    id: "help-chat-workbench",
    label: "Cohi in Workbench",
    group: "Help",
    kind: "route",
    path: "/help/cohi-chat/chat-in-workbench",
    keywords: ["chat in workbench", "workbench help"],
  },
] as const;

export function getNavigationTargetById(
  id: string,
): NavigationTarget | undefined {
  return NAVIGATION_TARGETS.find((t) => t.id === id);
}

