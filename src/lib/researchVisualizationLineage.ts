/**
 * COHI-365: resolve Research Lab evidence to a canonical product dashboard
 * (or, when unambiguous, a specific registry widget) so findings can deep-link
 * users back to the source experience.
 *
 * Strategy: rather than keyword/substring matching (which can't tell a Sales
 * Scorecard "TTS / tier" question from an Operations Scorecard one), we score
 * each candidate dashboard against:
 *   1. Subject entities extracted from the question/SQL (loan officer vs.
 *      processor vs. branch vs. company, etc.)
 *   2. Metric families (TTS, tier distribution, cycle time, pull-through, …)
 *   3. Synonym phrases that uniquely name the dashboard
 * with a hard penalty for primary-subject mismatches and a clear-winner
 * threshold. When no candidate clearly wins, we return null — better no link
 * than a misleading one.
 */

import type { DataSourceId, WidgetDefinition } from "@/components/widgets/registry/types";
import { getAllWidgets } from "@/components/widgets/registry";
import type {
  ResearchVisualizationMatchConfidence,
  ResearchVisualizationSource,
} from "@/types/researchWorkbench";

export type { ResearchVisualizationSource } from "@/types/researchWorkbench";

// ---------------------------------------------------------------------------
// Dashboard home routes — single source of truth shared with the UI.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Subject + metric ontology
// ---------------------------------------------------------------------------

type SubjectId =
  | "loan_officer"
  | "processor"
  | "underwriter"
  | "closer"
  | "branch"
  | "company"
  | "loan"
  | "borrower"
  | "channel"
  | "lock"
  | "pricing"
  | "investor"
  | "industry"
  | "pipeline";

type MetricId =
  | "tts_score"
  | "tier_distribution"
  | "pull_through"
  | "volume"
  | "units"
  | "revenue"
  | "fico"
  | "ltv"
  | "dti"
  | "wac"
  | "cycle_time"
  | "approval_rate"
  | "denial_rate"
  | "complexity"
  | "stage_funnel"
  | "lock_status"
  | "pricing_margin"
  | "forecast"
  | "workflow"
  | "performance_outlier"
  | "ranking";

interface DashboardProfile {
  dataSource: DataSourceId;
  /** Primary subjects — full subject score on match. */
  subjects: SubjectId[];
  /** Secondary subjects (filters/dimensions, not the focus) — partial score. */
  compatibleSubjects?: SubjectId[];
  metrics: MetricId[];
  /** Phrases that uniquely name this dashboard family. Lowercase, dash-free. */
  synonyms: string[];
}

const PROFILES: DashboardProfile[] = [
  {
    dataSource: "company-scorecard",
    subjects: ["company", "branch"],
    metrics: ["volume", "units", "revenue", "fico", "ltv", "dti", "wac", "pull_through"],
    synonyms: ["company scorecard"],
  },
  {
    dataSource: "credit-risk",
    subjects: ["loan", "borrower"],
    compatibleSubjects: ["company"],
    metrics: ["fico", "ltv", "dti"],
    synonyms: ["credit risk", "credit risk management"],
  },
  {
    dataSource: "sales-scorecard",
    subjects: ["loan_officer"],
    compatibleSubjects: ["branch"],
    metrics: [
      "tts_score",
      "tier_distribution",
      "pull_through",
      "volume",
      "units",
      "revenue",
      "fico",
      "ltv",
      "dti",
      "cycle_time",
      "complexity",
      "performance_outlier",
    ],
    synonyms: ["sales scorecard", "lo scorecard", "loan officer scorecard", "originator scorecard"],
  },
  {
    dataSource: "operations-scorecard",
    subjects: ["processor", "underwriter", "closer"],
    compatibleSubjects: ["branch"],
    metrics: [
      "tts_score",
      "tier_distribution",
      "cycle_time",
      "approval_rate",
      "denial_rate",
      "complexity",
      "units",
      "fico",
      "ltv",
      "performance_outlier",
    ],
    synonyms: ["operations scorecard", "ops scorecard", "processor scorecard", "underwriter scorecard"],
  },
  {
    dataSource: "operations-trends",
    subjects: ["processor", "underwriter", "closer"],
    metrics: ["cycle_time"],
    synonyms: ["operations trends", "ops trends"],
  },
  {
    dataSource: "sales-trends",
    subjects: ["loan_officer"],
    compatibleSubjects: ["branch"],
    metrics: ["volume", "units"],
    synonyms: ["sales trends"],
  },
  {
    dataSource: "funnel",
    subjects: ["pipeline", "loan"],
    compatibleSubjects: ["branch", "loan_officer"],
    metrics: ["stage_funnel", "pull_through"],
    synonyms: ["loan funnel", "conversion funnel"],
  },
  {
    dataSource: "top-tiering-comparison",
    subjects: ["loan_officer", "branch"],
    metrics: ["tier_distribution", "tts_score"],
    synonyms: ["top tiering", "tiering comparison", "toptiering"],
  },
  {
    dataSource: "executive-dashboard",
    subjects: ["company"],
    compatibleSubjects: ["branch"],
    metrics: ["volume", "revenue"],
    synonyms: ["business overview", "executive dashboard"],
  },
  {
    dataSource: "closing-forecast",
    subjects: ["loan", "pipeline"],
    metrics: ["forecast"],
    synonyms: ["closing forecast", "fallout forecast", "fallout"],
  },
  {
    dataSource: "financial-modeling",
    subjects: ["company"],
    metrics: ["forecast", "revenue"],
    synonyms: ["financial modeling", "modeling sandbox"],
  },
  {
    dataSource: "loan-detail",
    subjects: ["loan"],
    metrics: [],
    synonyms: ["loan detail"],
  },
  {
    dataSource: "workflow-conversion",
    subjects: ["loan", "pipeline"],
    metrics: ["workflow", "stage_funnel"],
    synonyms: ["workflow conversion", "milestone conversion"],
  },
  {
    dataSource: "high-performers",
    subjects: ["loan_officer", "branch"],
    metrics: ["ranking", "volume", "units"],
    synonyms: ["high performers", "lo leaderboard", "branch leaderboard"],
  },
  {
    dataSource: "actors",
    subjects: ["loan_officer", "processor", "underwriter", "closer"],
    metrics: ["volume", "units"],
    synonyms: ["actors dashboard"],
  },
  {
    dataSource: "pricing-dashboard",
    subjects: ["loan", "channel"],
    metrics: ["pricing_margin"],
    synonyms: ["pricing dashboard"],
  },
  {
    dataSource: "pipeline-analysis",
    subjects: ["pipeline", "loan"],
    metrics: ["stage_funnel"],
    synonyms: ["pipeline analysis"],
  },
  {
    dataSource: "sales-scorecard-overview",
    subjects: ["loan_officer", "pipeline"],
    metrics: ["stage_funnel", "volume"],
    synonyms: ["sales scorecard overview"],
  },
  {
    dataSource: "production-trends",
    subjects: ["company", "branch"],
    metrics: ["volume", "units"],
    synonyms: ["production trends"],
  },
  {
    dataSource: "production-summary-by-week",
    subjects: ["company", "branch"],
    metrics: ["volume", "units"],
    synonyms: ["production summary"],
  },
  {
    dataSource: "lock-stratification",
    subjects: ["lock", "loan"],
    metrics: ["lock_status"],
    synonyms: ["lock stratification", "rate lock"],
  },
  {
    dataSource: "loan-complexity",
    subjects: ["loan"],
    metrics: ["complexity"],
    synonyms: ["loan complexity"],
  },
  {
    dataSource: "estimated-closings-risk",
    subjects: ["loan", "pipeline"],
    metrics: ["forecast"],
    synonyms: ["estimated closings", "closings risk"],
  },
  {
    dataSource: "sales-company-overview",
    subjects: ["loan_officer", "branch", "company"],
    metrics: ["volume"],
    synonyms: ["sales company overview"],
  },
];

// ---------------------------------------------------------------------------
// Subject + metric extraction
// ---------------------------------------------------------------------------

const SUBJECT_PATTERNS: Record<SubjectId, RegExp[]> = {
  loan_officer: [
    /\bloan officer(s)?\b/,
    /\bloan officer id\b/,
    /\bloan officer name\b/,
    /\blo\b/,
    /\bmlo\b/,
    /\boriginator(s)?\b/,
    /\bsales rep(s)?\b/,
  ],
  processor: [/\bprocessor(s)?\b/, /\bprocessing time\b/, /\bprocessor queue\b/],
  underwriter: [/\bunderwriter(s)?\b/, /\bunderwriting\b/, /\buw\b/],
  closer: [/\bcloser(s)?\b/, /\bclosing officer/, /\bcloser id\b/],
  branch: [/\bbranch(es)?\b/, /\bbranch id\b/, /\bbranch name\b/],
  company: [/\bcompanywide\b/, /\bcompany wide\b/, /\benterprise\b/, /\bcompany scorecard\b/],
  loan: [/\bper loan\b/, /\bindividual loan(s)?\b/, /\bloan level\b/, /\bloan detail\b/, /\bloan id\b/, /\bloan number\b/],
  borrower: [/\bborrower(s)?\b/],
  channel: [/\bretail\b/, /\bwholesale\b/, /\bcorrespondent\b/, /\bchannel(s)?\b/],
  lock: [/\brate lock(s)?\b/, /\block(ed|ing|s)?\b/],
  pricing: [/\bpricing\b/, /\bmargin(s)?\b/, /\bprice point\b/],
  investor: [/\binvestor(s)?\b/],
  industry: [/\bindustry\b/, /\bmortgage news\b/],
  pipeline: [/\bpipeline\b/, /\bfunnel\b/, /\bstage(s)?\b/, /\bconversion\b/],
};

const METRIC_PATTERNS: Record<MetricId, RegExp[]> = {
  tts_score: [/\btts\b/, /\btts score\b/, /\bperformance score\b/],
  tier_distribution: [
    /\btier(s)?\b/,
    /\btop tier\b/,
    /\bsecond tier\b/,
    /\bbottom tier\b/,
    /\btier distribution\b/,
  ],
  pull_through: [/\bpull[\s]?through\b/, /\bpull through\b/],
  volume: [/\bvolume\b/, /\bdollar volume\b/, /\boriginations?\b/],
  units: [/\bunits\b/, /\bunit count\b/, /\bloan count\b/],
  revenue: [/\brevenue\b/, /\brevenue bps\b/, /\brevenue per\b/],
  fico: [/\bfico\b/, /\bcredit score\b/],
  ltv: [/\bltv\b/],
  dti: [/\bdti\b/],
  wac: [/\bwac\b/, /\bweighted avg coupon\b/, /\bweighted average coupon\b/],
  cycle_time: [
    /\bcycle time\b/,
    /\bturn time\b/,
    /\bdays to close\b/,
    /\baverage days\b/,
    /\bavg days\b/,
    /\btime to close\b/,
  ],
  approval_rate: [/\bapproval rate\b/, /\b% approved\b/, /\bapproved\b/],
  denial_rate: [/\bdenial rate\b/, /\bdenied\b/, /\bdeny\b/],
  complexity: [/\bcomplexity\b/, /\bloan complexity\b/],
  stage_funnel: [/\bfunnel\b/, /\bstage(s)?\b/, /\bconversion\b/, /\bdrop[\s]?off\b/],
  lock_status: [/\block(ed|ing|s)?\b/, /\brate lock\b/],
  pricing_margin: [/\bmargin(s)?\b/, /\bprice point\b/, /\bpricing\b/],
  forecast: [/\bforecast\b/, /\bestimated\b/, /\bestimation\b/, /\bproject(ed|ion)\b/],
  workflow: [/\bworkflow\b/, /\bmilestone(s)?\b/, /\bdisclosure\b/],
  performance_outlier: [/\boutlier(s)?\b/, /\banomal(y|ies|ous)\b/],
  ranking: [/\branking(s)?\b/, /\btop performers\b/, /\bleaderboard\b/, /\brank\b/],
};

/**
 * Lower-case and replace `_`/`-` with spaces so SQL identifiers and dashed
 * registry ids are matched the same way as natural-language phrases.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function extractSubjects(hay: string): Set<SubjectId> {
  const out = new Set<SubjectId>();
  for (const subject of Object.keys(SUBJECT_PATTERNS) as SubjectId[]) {
    for (const re of SUBJECT_PATTERNS[subject]) {
      if (re.test(hay)) {
        out.add(subject);
        break;
      }
    }
  }
  return out;
}

function extractMetrics(hay: string): Set<MetricId> {
  const out = new Set<MetricId>();
  for (const metric of Object.keys(METRIC_PATTERNS) as MetricId[]) {
    for (const re of METRIC_PATTERNS[metric]) {
      if (re.test(hay)) {
        out.add(metric);
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const W_SUBJECT_PRIMARY = 5;
const W_SUBJECT_SECONDARY = 1.5;
const W_METRIC = 2;
const W_MISMATCH_PENALTY = 3;

interface ScoredProfile {
  profile: DashboardProfile;
  score: number;
  subjectsMatched: SubjectId[];
  metricsMatched: MetricId[];
  synonymBonus: number;
}

/** Award a length-graded bonus for the longest synonym phrase that matches. */
function synonymBonus(profile: DashboardProfile, hay: string): number {
  let bestLen = 0;
  for (const syn of profile.synonyms) {
    if (syn.length >= 4 && hay.includes(syn) && syn.length > bestLen) bestLen = syn.length;
  }
  if (bestLen === 0) return 0;
  if (bestLen >= 12) return 4;
  if (bestLen >= 8) return 3;
  return 2;
}

function scoreProfile(
  profile: DashboardProfile,
  subjects: Set<SubjectId>,
  metrics: Set<MetricId>,
  hay: string,
): ScoredProfile {
  const subjectsMatched: SubjectId[] = [];
  const metricsMatched: MetricId[] = [];
  let score = 0;

  const compatible = profile.compatibleSubjects ?? [];
  const profileAll = new Set<SubjectId>([...profile.subjects, ...compatible]);

  for (const subject of subjects) {
    if (profile.subjects.includes(subject)) {
      score += W_SUBJECT_PRIMARY;
      subjectsMatched.push(subject);
    } else if (compatible.includes(subject)) {
      score += W_SUBJECT_SECONDARY;
      subjectsMatched.push(subject);
    } else {
      // Primary subject of the question that this dashboard does not cover —
      // strong signal that we have the wrong dashboard family.
      score -= W_MISMATCH_PENALTY;
    }
  }

  // Don't double-penalize: if every extracted subject was unknown to *every*
  // candidate, downstream threshold/winner-ratio checks already handle it.
  for (const metric of metrics) {
    if (profile.metrics.includes(metric)) {
      score += W_METRIC;
      metricsMatched.push(metric);
    }
  }

  const synBonus = synonymBonus(profile, hay);
  score += synBonus;

  return { profile, score, subjectsMatched, metricsMatched, synonymBonus: synBonus };
}

// ---------------------------------------------------------------------------
// Result construction
// ---------------------------------------------------------------------------

function buildNavigateState(meta: { path: string; sectionId?: string } | undefined): Record<string, unknown> | undefined {
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

function fromDashboard(
  profile: DashboardProfile,
  confidence: ResearchVisualizationMatchConfidence,
): ResearchVisualizationSource | null {
  const home = DATA_SOURCE_DASHBOARD_HOME[profile.dataSource];
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
 * If the chosen dashboard has a registry widget whose id appears in the hay,
 * promote the lineage to that specific widget. Subject alignment is already
 * guaranteed by having picked the dashboard first.
 */
function pickRegistryWidgetWithin(profile: DashboardProfile, hay: string): WidgetDefinition | null {
  let best: { def: WidgetDefinition; score: number } | null = null;
  for (const def of getAllWidgets()) {
    if (def.dataSource !== profile.dataSource) continue;
    const idNorm = normalize(def.id);
    if (idNorm.length < 12) continue;
    if (hay.includes(idNorm)) {
      const score = idNorm.length;
      if (!best || score > best.score) best = { def, score };
    }
  }
  return best?.def ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function resolveResearchVisualizationLineage(input: {
  sql: string;
  explanation: string;
  findingTitle?: string;
}): ResearchVisualizationSource | null {
  const raw = `${input.findingTitle ?? ""} ${input.explanation ?? ""} ${input.sql ?? ""}`;
  const hay = normalize(raw);
  if (!hay) return null;

  const subjects = extractSubjects(hay);
  const metrics = extractMetrics(hay);

  const scored = PROFILES.map((p) => scoreProfile(p, subjects, metrics, hay))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const best = scored[0];
  const runnerUp = scored[1];

  // Minimum signal: with extracted subjects we expect a real subject match;
  // without them, allow strong synonym/metric-only matches like "loan funnel".
  const minScore = subjects.size > 0 ? 5 : 3;
  if (best.score < minScore) return null;

  // Require a clear winner — either ≥1.5× the runner-up or ≥2.5 points lead.
  if (runnerUp) {
    const ratioClear = best.score >= 1.5 * runnerUp.score;
    const absoluteClear = best.score - runnerUp.score >= 2.5;
    if (!ratioClear && !absoluteClear) return null;
  }

  const widget = pickRegistryWidgetWithin(best.profile, hay);
  if (widget) return fromRegistryWidget(widget);

  return fromDashboard(best.profile, "medium");
}
