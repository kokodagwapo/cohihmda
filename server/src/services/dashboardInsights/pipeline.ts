/**
 * Dashboard Insights — 4-pass pipeline
 *
 * Pass 1: Generator → 3-5 candidates
 * Pass 2a: Fact-check (programmatic)
 * Pass 2b: Judge (LLM) → filter overall_score >= 5.5
 * Pass 3: Curator → 1-3 final insights, set escalate for critical
 * Pass 4: Evidence Agent → refine evidence_refs
 * Persistence: saveDashboardInsights
 */

import type { Pool } from "pg";
import { randomUUID } from "crypto";
import { getPromptConfig } from "../promptConfigService.js";
import { callLLM, getOpenAIKey } from "../research/tools.js";
import type { LLMMessage } from "../research/tools.js";
import { buildDetailFromSupportingData } from "./dashboardInsightDetailHydrator.js";
import { saveDashboardInsights } from "./storage.js";
import type {
  DashboardPageContext,
  DashboardInsight,
  EvidenceRef,
  SupportingData,
  SupportingDataByPeriodRow,
  WidgetCatalogEntry,
} from "./types.js";

// ---------------------------------------------------------------------------
// Generator candidate (pre-curator shape)
// ---------------------------------------------------------------------------

export interface GeneratorCandidate {
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
  filter_context: Record<string, unknown>;
  evidence_refs: EvidenceRef[];
}

interface FactCheckResult {
  score: number;
  issues: string[];
}

interface JudgeEvaluation {
  insight_index: number;
  overall_score: number;
  keep: boolean;
  issues?: string[];
}

// ---------------------------------------------------------------------------
// Pass 1: Generator
// ---------------------------------------------------------------------------

function buildGeneratorUserMessage(context: DashboardPageContext): string {
  return JSON.stringify(
    {
      pageId: context.pageId,
      pageName: context.pageName,
      pageDescription: context.pageDescription,
      pageGuidance: context.pageGuidance,
      filters: context.filters,
      dimensions: context.dimensions,
      data: context.data,
      widget_catalog: context.widget_catalog,
    },
    null,
    2
  );
}

function parseGeneratorResponse(raw: string): GeneratorCandidate[] {
  try {
    const parsed = JSON.parse(raw) as { insights?: unknown[] };
    const list = Array.isArray(parsed?.insights) ? parsed.insights : [];
    const candidates: GeneratorCandidate[] = [];
    for (const item of list) {
      const o = item as Record<string, unknown>;
      const refs = Array.isArray(o.evidence_refs)
        ? (o.evidence_refs as EvidenceRef[])
        : [];
      candidates.push({
        headline: String(o.headline ?? ""),
        understory: String(o.understory ?? ""),
        sentiment: validSentiment(o.sentiment),
        severity_score: Number(o.severity_score) || 0,
        cited_numbers: Array.isArray(o.cited_numbers) ? (o.cited_numbers as string[]) : [],
        what_changed: String(o.what_changed ?? ""),
        why: String(o.why ?? ""),
        business_impact: String(o.business_impact ?? ""),
        risk_if_ignored: String(o.risk_if_ignored ?? ""),
        recommended_action: String(o.recommended_action ?? ""),
        owner: String(o.owner ?? ""),
        scope: o.scope === "widget" ? "widget" : "page",
        filter_context: (o.filter_context as Record<string, unknown>) || {},
        evidence_refs: refs,
      });
    }
    return candidates;
  } catch {
    return [];
  }
}

function validSentiment(v: unknown): GeneratorCandidate["sentiment"] {
  if (v === "positive" || v === "warning" || v === "critical" || v === "neutral") return v;
  return "neutral";
}

// ---------------------------------------------------------------------------
// Pass 2a: Fact-check
// ---------------------------------------------------------------------------

function factCheckCandidates(
  candidates: GeneratorCandidate[],
  context: DashboardPageContext
): FactCheckResult[] {
  const catalogIds = new Set(context.widget_catalog.map((w) => w.id));
  const dimensionValues = new Map<string, Set<string>>();
  for (const d of context.dimensions) {
    dimensionValues.set(d.id, new Set(d.values));
  }

  const results: FactCheckResult[] = [];
  for (const c of candidates) {
    const issues: string[] = [];

    for (const ref of c.evidence_refs) {
      if (!catalogIds.has(ref.widgetId)) {
        issues.push(`widgetId "${ref.widgetId}" not in widget_catalog`);
      }
      if (ref.target?.label) {
        const dim = context.widget_catalog.find((w) => w.id === ref.widgetId)?.dimension;
        if (dim) {
          const allowed = dimensionValues.get(dim);
          if (allowed && !allowed.has(ref.target.label)) {
            issues.push(`target label "${ref.target.label}" not in dimension "${dim}"`);
          }
        }
      }
    }

    const filterKeys = Object.keys(c.filter_context || {});
    const isPageLevel = Object.keys(context.filters || {}).length === 0;
    if (filterKeys.length === 0 && !isPageLevel) {
      issues.push("filter_context is empty");
    }

    const score = issues.length === 0 ? 1 : Math.max(0, 1 - issues.length * 0.25);
    results.push({ score, issues });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Pass 2b: Judge
// ---------------------------------------------------------------------------

function buildJudgeUserMessage(
  candidates: GeneratorCandidate[],
  factCheckResults: FactCheckResult[]
): string {
  return JSON.stringify(
    {
      candidates: candidates.map((c, i) => ({
        index: i,
        headline: c.headline,
        understory: c.understory,
        sentiment: c.sentiment,
        scope: c.scope,
        filter_context: c.filter_context,
        evidence_refs: c.evidence_refs,
        fact_check: factCheckResults[i],
      })),
    },
    null,
    2
  );
}

function parseJudgeResponse(raw: string): JudgeEvaluation[] {
  try {
    const parsed = JSON.parse(raw) as { evaluations?: unknown[] };
    const list = Array.isArray(parsed?.evaluations) ? parsed.evaluations : [];
    return list.map((e: Record<string, unknown>) => {
      const idxRaw = Number(e.insight_index);
      const scoreRaw = Number(e.overall_score);

      return {
        insight_index: Number.isFinite(idxRaw) ? idxRaw : 0,
        overall_score: Number.isFinite(scoreRaw) ? scoreRaw : 0,
        keep: Boolean(e.keep),
        issues: Array.isArray(e.issues) ? (e.issues as string[]) : undefined,
      };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pass 3: Curator
// ---------------------------------------------------------------------------

function buildCuratorUserMessage(
  candidates: GeneratorCandidate[],
  scores: JudgeEvaluation[]
): string {
  return JSON.stringify(
    {
      candidates: candidates.map((c, i) => ({
        ...c,
        judge_score: scores[i]?.overall_score,
        judge_keep: scores[i]?.keep,
      })),
    },
    null,
    2
  );
}

/** Curator output insight with optional judge_score for deduplication. */
type CuratorInsight = DashboardInsight & { judge_score?: number };

function parseCuratorResponse(
  raw: string,
  pageId: string,
  pageName: string
): CuratorInsight[] {
  try {
    const parsed = JSON.parse(raw) as { insights?: unknown[] };
    const list = Array.isArray(parsed?.insights) ? parsed.insights : [];
    const out: CuratorInsight[] = [];
    for (const item of list) {
      const o = item as Record<string, unknown>;
      const refs = Array.isArray(o.evidence_refs) ? (o.evidence_refs as EvidenceRef[]) : [];
      const judge_score =
        typeof o.judge_score === "number" && Number.isFinite(o.judge_score)
          ? o.judge_score
          : undefined;
      out.push({
        headline: String(o.headline ?? ""),
        understory: String(o.understory ?? ""),
        sentiment: validSentiment(o.sentiment),
        severity_score: Number(o.severity_score) || 0,
        cited_numbers: Array.isArray(o.cited_numbers) ? (o.cited_numbers as string[]) : [],
        what_changed: String(o.what_changed ?? ""),
        why: String(o.why ?? ""),
        business_impact: String(o.business_impact ?? ""),
        risk_if_ignored: String(o.risk_if_ignored ?? ""),
        recommended_action: String(o.recommended_action ?? ""),
        owner: String(o.owner ?? ""),
        scope: o.scope === "widget" ? "widget" : "page",
        filter_context: (o.filter_context as DashboardInsight["filter_context"]) || {},
        evidence_refs: refs,
        escalate:
          Boolean(o.escalate) ||
          o.sentiment === "critical" ||
          o.sentiment === "warning",
        sourcePageId: pageId,
        sourcePageName: pageName,
        ...(judge_score !== undefined && { judge_score }),
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pass 4: Evidence Agent
// ---------------------------------------------------------------------------

function buildEvidenceAgentUserMessage(insight: DashboardInsight, catalog: WidgetCatalogEntry[]): string {
  return JSON.stringify(
    {
      insight: {
        headline: insight.headline,
        understory: insight.understory,
        scope: insight.scope,
        filter_context: insight.filter_context,
        evidence_refs: insight.evidence_refs,
        what_changed: insight.what_changed,
        why: insight.why,
        business_impact: insight.business_impact,
      },
      widget_catalog: catalog.map((w) => ({
        id: w.id,
        type: w.type,
        label: w.label,
        dimension: w.dimension,
      })),
      instruction:
        "If the insight is about a specific loan officer (name appears in headline/understory), choose widgets with dimension \"leader\" and set target.label to that exact name. Same for branch or other segment dimensions.",
    },
    null,
    2
  );
}

function parseEvidenceAgentResponse(raw: string): EvidenceRef[] | null {
  try {
    const parsed = JSON.parse(raw) as { evidence_refs?: unknown[] };
    const list = Array.isArray(parsed?.evidence_refs) ? parsed.evidence_refs : [];
    return list.map((r: Record<string, unknown>) => ({
      widgetId: String(r.widgetId ?? ""),
      role: r.role === "supporting" ? "supporting" : "primary",
      target: r.target
        ? {
            type: (r.target as Record<string, unknown>).type === "series" ? "series" : "row",
            label: String((r.target as Record<string, unknown>).label ?? ""),
          }
        : undefined,
    }));
  } catch {
    return null;
  }
}

const METRIC_LABELS = ["pullThroughRate", "pull-through", "pull through", "units", "volume"];

function isAggregateMetricLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return METRIC_LABELS.some((m) => lower.includes(m)) || /^\d+%$/.test(label) || lower === "leaderboard";
}

/** Pivot widget id → pivotSlices key in loan-complexity adapter context */
const LOAN_COMPLEXITY_PIVOT_WIDGET_DIM: Record<string, string> = {
  "loan-complexity-pivot-loan-officer": "loan_officer",
  "loan-complexity-pivot-processor": "processor",
  "loan-complexity-pivot-underwriter": "underwriter",
  "loan-complexity-pivot-closer": "closer",
  "loan-complexity-pivot-branch": "branch",
  "loan-complexity-pivot-current-loan-status": "current_loan_status",
};

type LoanComplexityPeriodData = {
  periodLabel?: string;
  /** Loan-complexity + optional leaderboard summary fields (same `by_time_period` shape is reused for enrichment). */
  summary?: {
    portfolioWaComplexity?: number | null;
    totalUnits?: number | null;
    portfolioPullThrough?: number | null;
    topPerformerName?: string;
    topPerformerUnits?: number;
    topPerformerVolume?: number;
    averagePullThrough?: number;
    totalVolume?: number;
  };
  barLoanOfficer?: Array<{ groupName?: string; avgComplexity?: number; loanCount?: number }>;
  pivotSlices?: Record<string, Array<{ groupName?: string; units?: number; waComplexity?: number | null }>>;
  leaderboard?: Array<{
    name?: string;
    loansClosed?: number;
    totalVolume?: number;
    pullThroughRate?: number;
  }>;
};

type CompanyScorecardTierAggregate = {
  applicationsTakenUnits: number;
  applicationsTakenDollar: number;
  wac: number;
  originatedUnits: number;
  originatedUnitsPct: number;
  withdrawnUnits: number;
  withdrawnUnitsPct: number;
  deniedUnits: number;
  deniedUnitsPct: number;
  waFico: number;
  waLtv: number;
  waDti: number;
};

type CompanyScorecardEntityForContext = {
  name: string;
  tier: string;
  applicationsTakenUnits: number;
  applicationsTakenDollar: number;
  wac: number;
  originatedUnits: number;
  originatedUnitsPct: number;
  withdrawnUnits: number;
  withdrawnUnitsPct: number;
  deniedUnits: number;
  deniedUnitsPct: number;
  waFico: number;
  waLtv: number;
  waDti: number;
};

type CompanyScorecardPeriodData = {
  periodLabel?: string;
  summary?: {
    totalUnits?: number;
    totalVolume?: number;
    wac?: number;
    averagePullThrough?: number;
    originatedUnits?: number;
    originatedUnitsPct?: number;
    withdrawnUnits?: number;
    withdrawnUnitsPct?: number;
    deniedUnits?: number;
    deniedUnitsPct?: number;
    waFico?: number;
    waLtv?: number;
    waDti?: number;
  };
  tierAggregates?: Record<string, CompanyScorecardTierAggregate>;
  branchesWithTier?: CompanyScorecardEntityForContext[];
  loanOfficersWithTier?: CompanyScorecardEntityForContext[];
};

type CreditRiskPeriodApplicationData = {
  kpis?: {
    units?: number;
    volume?: number;
    wac?: number;
    waFico?: number;
    waLtv?: number;
    waDti?: number;
  };
  creditRiskStory?: {
    conventionalQualifiedPercent?: number;
    governmentQualifiedPercent?: number;
  };
  distributions?: {
    fico?: Array<{ range?: string; units?: number; percentage?: number; volume?: number }>;
    ltv?: Array<{ range?: string; units?: number; percentage?: number; volume?: number }>;
    dti?: Array<{ range?: string; units?: number; percentage?: number; volume?: number }>;
  };
  loanMix?: {
    byType?: Array<{ category?: string; units?: number; unitsPercent?: number; volume?: number; volumePercent?: number }>;
    byPurpose?: Array<{ category?: string; units?: number; unitsPercent?: number; volume?: number; volumePercent?: number }>;
    byOccupancy?: Array<{ category?: string; units?: number; unitsPercent?: number; volume?: number; volumePercent?: number }>;
  };
};

type CreditRiskPeriodData = {
  periodLabel?: string;
  byApplicationType?: Record<string, CreditRiskPeriodApplicationData>;
};

/**
 * Enrich evidence refs with display values from page context (e.g. leaderboard KPIs and aggregate metrics).
 */
function enrichEvidenceRefsWithValues(
  context: DashboardPageContext,
  refs: EvidenceRef[]
): EvidenceRef[] {
  const byPeriod = context.data?.by_time_period as
    | Record<string, LoanComplexityPeriodData>
    | Record<string, CompanyScorecardPeriodData>
    | undefined;

  if (!byPeriod || typeof byPeriod !== "object") return refs;

  const currencyFmt = (v: number) =>
    v >= 1e9
      ? `$${(v / 1e9).toFixed(2)}B`
      : v >= 1e6
        ? `$${(v / 1e6).toFixed(2)}M`
        : v >= 1e3
          ? `$${(v / 1e3).toFixed(1)}K`
          : `$${v}`;

  return refs.map((ref) => {
    const label = ref.target?.label?.trim();
    const parts: string[] = [];

    // Loan complexity — bar chart (mean complexity by loan officer group)
    if (ref.widgetId === "loan-complexity-bar-chart") {
      if (label) {
        for (const [period, data] of Object.entries(byPeriod)) {
          const bars = data.barLoanOfficer;
          if (!Array.isArray(bars)) continue;
          const row = bars.find((b) => b.groupName === label);
          if (row && row.avgComplexity != null && row.loanCount != null) {
            parts.push(`${period}: mean complexity ${row.avgComplexity}, ${row.loanCount} loans`);
          }
        }
      } else {
        for (const [period, data] of Object.entries(byPeriod)) {
          const summary = data.summary;
          const segs: string[] = [];
          if (summary?.portfolioWaComplexity != null) segs.push(`WA ${summary.portfolioWaComplexity}`);
          if (summary?.portfolioPullThrough != null) segs.push(`${summary.portfolioPullThrough}% pull-through`);
          if (summary?.totalUnits != null) segs.push(`${summary.totalUnits} units`);
          if (segs.length) parts.push(`${period}: ${segs.join(", ")}`);
        }
      }
    }

    // Loan complexity — pivot sections
    const pivotDim = LOAN_COMPLEXITY_PIVOT_WIDGET_DIM[ref.widgetId];
    if (pivotDim) {
      if (label) {
        for (const [period, data] of Object.entries(byPeriod)) {
          const slice = data.pivotSlices?.[pivotDim];
          if (!Array.isArray(slice)) continue;
          const row = slice.find((r) => r.groupName === label);
          if (row) {
            const wa = row.waComplexity != null ? `WA ${row.waComplexity}` : "";
            const u = row.units != null ? `${row.units} units` : "";
            const seg = [wa, u].filter(Boolean).join(", ");
            if (seg) parts.push(`${period}: ${seg}`);
          }
        }
      } else {
        for (const [period, data] of Object.entries(byPeriod)) {
          const summary = data.summary;
          const segs: string[] = [];
          if (summary?.portfolioWaComplexity != null) segs.push(`portfolio WA ${summary.portfolioWaComplexity}`);
          if (summary?.portfolioPullThrough != null) segs.push(`${summary.portfolioPullThrough}% pull-through`);
          if (segs.length) parts.push(`${period}: ${segs.join(", ")}`);
        }
      }
    }

    // Company Scorecard — tier summary table
    if (ref.widgetId === "company-scorecard-summary-tier-table" && label) {
      for (const [period, data] of Object.entries(byPeriod)) {
        const tierAgg = (data as CompanyScorecardPeriodData)?.tierAggregates?.[label];
        if (!tierAgg) continue;
        parts.push(
          `${period}: ${tierAgg.applicationsTakenUnits} units, ${currencyFmt(
            tierAgg.applicationsTakenDollar
          )} apps $, WAC ${tierAgg.wac.toFixed(3)}, ${tierAgg.originatedUnits} originated (${tierAgg.originatedUnitsPct.toFixed(
            1
          )}%)`
        );
      }
    }

    // Credit Risk Management — story + KPI + distribution + loan mix widgets
    if (ref.widgetId.startsWith("credit-risk-")) {
      const appTypeFromCtx =
        typeof (context as { filters?: { applicationType?: unknown } }).filters?.applicationType === "string"
          ? String((context as { filters?: { applicationType?: unknown } }).filters?.applicationType)
          : "Applications Taken";
      const insightDatePeriodRaw =
        typeof (context as { filters?: { datePeriod?: unknown } }).filters?.datePeriod === "string"
          ? String((context as { filters?: { datePeriod?: unknown } }).filters?.datePeriod).toUpperCase()
          : null;

      for (const [period, data] of Object.entries(byPeriod as Record<string, CreditRiskPeriodData>)) {
        if (insightDatePeriodRaw && period !== insightDatePeriodRaw) continue;
        const appData = data?.byApplicationType?.[appTypeFromCtx] ??
          data?.byApplicationType?.["Applications Taken"];
        if (!appData) continue;

        if (ref.widgetId === "credit-risk-kpi-cards") {
          const k = appData.kpis;
          if (!k) continue;
          parts.push(
            `${period}: ${k.units ?? 0} units, ${currencyFmt(k.volume ?? 0)} volume, WAC ${(k.wac ?? 0).toFixed(3)}, WA FICO ${Math.round(k.waFico ?? 0)}, WA LTV ${(k.waLtv ?? 0).toFixed(1)}%, WA DTI ${(k.waDti ?? 0).toFixed(1)}%`
          );
        } else if (ref.widgetId === "credit-risk-story-panel") {
          const s = appData.creditRiskStory;
          if (!s) continue;
          parts.push(
            `${period}: Conventional qualified ${(s.conventionalQualifiedPercent ?? 0).toFixed(0)}%, Government qualified ${(s.governmentQualifiedPercent ?? 0).toFixed(0)}%`
          );
        } else if (ref.widgetId === "credit-risk-fico-distribution" && label) {
          const row = appData.distributions?.fico?.find((r) => r.range === label);
          if (!row) continue;
          parts.push(`${period}: ${row.units ?? 0} units (${(row.percentage ?? 0).toFixed(1)}%), ${currencyFmt(row.volume ?? 0)}`);
        } else if (ref.widgetId === "credit-risk-ltv-distribution" && label) {
          const row = appData.distributions?.ltv?.find((r) => r.range === label);
          if (!row) continue;
          parts.push(`${period}: ${row.units ?? 0} units (${(row.percentage ?? 0).toFixed(1)}%), ${currencyFmt(row.volume ?? 0)}`);
        } else if (ref.widgetId === "credit-risk-dti-distribution" && label) {
          const row = appData.distributions?.dti?.find((r) => r.range === label);
          if (!row) continue;
          parts.push(`${period}: ${row.units ?? 0} units (${(row.percentage ?? 0).toFixed(1)}%), ${currencyFmt(row.volume ?? 0)}`);
        } else if (ref.widgetId === "credit-risk-loan-mix-table" && label) {
          const row =
            appData.loanMix?.byType?.find((r) => r.category === label) ??
            appData.loanMix?.byPurpose?.find((r) => r.category === label) ??
            appData.loanMix?.byOccupancy?.find((r) => r.category === label);
          if (!row) continue;
          parts.push(
            `${period}: ${row.units ?? 0} units (${(row.unitsPercent ?? 0).toFixed(1)}%), ${currencyFmt(row.volume ?? 0)} (${(row.volumePercent ?? 0).toFixed(1)}%)`
          );
        }
      }
    }

    // Company Scorecard — tiered detail tables (branch / loan officer)
    if (
      ref.widgetId === "company-scorecard-detail-branch-table" ||
      ref.widgetId === "company-scorecard-detail-loan-officer-table"
    ) {
      const isBranch = ref.widgetId === "company-scorecard-detail-branch-table";
      if (label) {
        for (const [period, data] of Object.entries(byPeriod)) {
          const list = isBranch
            ? (data as CompanyScorecardPeriodData)?.branchesWithTier
            : (data as CompanyScorecardPeriodData)?.loanOfficersWithTier;
          const found = list?.find((e) => String(e.name).trim() === label);
          if (!found) continue;
          parts.push(
            `${period}: ${found.applicationsTakenUnits} units, ${currencyFmt(
              found.applicationsTakenDollar
            )} apps $, WAC ${found.wac.toFixed(3)}, ${found.originatedUnits} originated (${found.originatedUnitsPct.toFixed(
              1
            )}%)`
          );
        }
      }
    }

    if (ref.widgetId === "kpi-top-performer-units" && label) {
      for (const [period, data] of Object.entries(byPeriod)) {
        const summary = data?.summary;
        if (summary?.topPerformerName === label && summary.topPerformerUnits != null) {
          parts.push(`${period}: ${summary.topPerformerUnits} units`);
        }
      }
    } else if (ref.widgetId === "kpi-top-performer-volume" && label) {
      for (const [period, data] of Object.entries(byPeriod)) {
        const summary = data?.summary;
        if (summary?.topPerformerName === label && summary.topPerformerVolume != null) {
          const v = summary.topPerformerVolume;
          const fmt = v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(v);
          parts.push(`${period}: $${fmt}`);
        }
      }
    } else if (ref.widgetId === "leaderboard-main-table") {
      if (label && isAggregateMetricLabel(label)) {
        // Aggregate metric (e.g. pull-through rate across all LOs): use summary per period
        for (const [period, data] of Object.entries(byPeriod)) {
          const summary = data?.summary;
          const segs: string[] = [];
          if (summary?.averagePullThrough != null) segs.push(`${summary.averagePullThrough}% pull-through`);
          if (summary?.totalUnits != null) segs.push(`${summary.totalUnits} units`);
          if (summary?.totalVolume != null) {
            const v = summary.totalVolume;
            segs.push(`$${v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v}`);
          }
          if (segs.length) parts.push(`${period}: ${segs.join(", ")}`);
        }
      } else if (label) {
        // Row = specific person
        for (const [period, data] of Object.entries(byPeriod)) {
          const row = data?.leaderboard?.find((r) => r.name === label);
          if (row) {
            const u = row.loansClosed != null ? `${row.loansClosed} units` : "";
            const vol = row.totalVolume != null ? `$${row.totalVolume >= 1e6 ? (row.totalVolume / 1e6).toFixed(2) + "M" : row.totalVolume >= 1e3 ? (row.totalVolume / 1e3).toFixed(1) + "K" : row.totalVolume}` : "";
            const pt = row.pullThroughRate != null ? `${row.pullThroughRate}% pull-through` : "";
            const seg = [u, vol, pt].filter(Boolean).join(", ");
            if (seg) parts.push(`${period}: ${seg}`);
          }
        }
      }
    }

    // Ref with no target (e.g. generic leaderboard): still show period summary
    if (parts.length === 0 && ref.widgetId === "leaderboard-main-table" && !label) {
      for (const [period, data] of Object.entries(byPeriod)) {
        const summary = data?.summary;
        const segs: string[] = [];
        if (summary?.averagePullThrough != null) segs.push(`${summary.averagePullThrough}% pull-through`);
        if (summary?.totalUnits != null) segs.push(`${summary.totalUnits} units`);
        if (summary?.totalVolume != null) {
          const v = summary.totalVolume;
          segs.push(`$${v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v}`);
        }
        if (segs.length) parts.push(`${period}: ${segs.join(", ")}`);
      }
    }

    const value = parts.length > 0 ? parts.join(" · ") : undefined;
    return value ? { ...ref, value } : ref;
  });
}

/**
 * Subject key for deduplication: "leader:Name" or "branch:Name".
 * Returns null if the insight is not about a specific loan officer or branch.
 */
function getSubjectKey(
  insight: { evidence_refs?: EvidenceRef[]; filter_context?: Record<string, unknown> },
  context: DashboardPageContext
): string | null {
  for (const ref of insight.evidence_refs ?? []) {
    const label = ref.target?.label?.trim();
    if (!label) continue;
    const widget = context.widget_catalog.find((w) => w.id === ref.widgetId);
    const dim = widget?.dimension;
    if (dim === "leader") return `leader:${label}`;
    if (dim === "branch") return `branch:${label}`;
    if (dim === "complexity_loan_officer") return `leader:${label}`;
    if (dim === "complexity_branch") return `branch:${label}`;
    if (dim === "complexity_processor") return `processor:${label}`;
    if (dim === "complexity_underwriter") return `underwriter:${label}`;
    if (dim === "complexity_closer") return `closer:${label}`;
    if (dim === "complexity_current_loan_status") return `status:${label}`;

    if (dim === "company_scorecard_branch") return `company_scorecard_branch:${label}`;
    if (dim === "company_scorecard_loan_officer")
      return `company_scorecard_loan_officer:${label}`;
  }
  const ctx = insight.filter_context as Record<string, unknown> | undefined;
  if (ctx?.leaderName != null && typeof ctx.leaderName === "string")
    return `leader:${String(ctx.leaderName).trim()}`;
  if (ctx?.leader != null && typeof ctx.leader === "string")
    return `leader:${String(ctx.leader).trim()}`;
  if (ctx?.branch != null && typeof ctx.branch === "string")
    return `branch:${String(ctx.branch).trim()}`;

  if (ctx?.loanOfficer != null && typeof ctx.loanOfficer === "string")
    return `company_scorecard_loan_officer:${String(ctx.loanOfficer).trim()}`;

  if (ctx?.loan_officer != null && typeof ctx.loan_officer === "string")
    return `company_scorecard_loan_officer:${String(ctx.loan_officer).trim()}`;
  if (ctx?.applicationType != null && typeof ctx.applicationType === "string")
    return `credit_risk_application_type:${String(ctx.applicationType).trim()}`;

  return null;
}

/**
 * Deduplicate insights by subject (loan officer or branch). When multiple insights
 * feature the same LO or branch, keep only the one with the highest judge_score.
 * Insights with no subject key are left as-is.
 */
function deduplicateBySubject(
  insights: Array<DashboardInsight & { judge_score?: number }>,
  context: DashboardPageContext
): DashboardInsight[] {
  const noSubject: DashboardInsight[] = [];
  const byKey = new Map<string, DashboardInsight & { judge_score?: number }>();

  for (const insight of insights) {
    const key = getSubjectKey(insight, context);
    const score = insight.judge_score ?? 0;
    if (key == null) {
      noSubject.push(insight);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing || (existing.judge_score ?? 0) < score) {
      byKey.set(key, insight);
    }
  }

  const deduped: DashboardInsight[] = [];
  for (const ins of noSubject) {
    const { judge_score: _s, ...rest } = ins as DashboardInsight & { judge_score?: number };
    deduped.push(rest);
  }
  for (const ins of byKey.values()) {
    const { judge_score: _s, ...rest } = ins as DashboardInsight & { judge_score?: number };
    deduped.push(rest);
  }
  return deduped;
}

/**
 * Derive the subject name (e.g. loan officer) for person-focused evidence when the insight
 * is about a specific entity. Used to build subject-focused detail tables.
 */
function getSubjectNameFromInsight(
  insight: DashboardInsight,
  context: DashboardPageContext
): string | undefined {
  // Prefer: primary evidence_ref with dimension "leader" and target.label
  const primaryRef = insight.evidence_refs?.find((r) => r.role === "primary");
  if (primaryRef?.target?.label) {
    const widget = context.widget_catalog.find((w) => w.id === primaryRef.widgetId);
    const d = widget?.dimension;
    if (d === "leader" || d === "complexity_loan_officer") return primaryRef.target.label.trim();
    if (d === "company_scorecard_loan_officer") return primaryRef.target.label.trim();
    if (d === "company_scorecard_branch") return primaryRef.target.label.trim();
    if (d?.startsWith("complexity_")) return primaryRef.target.label.trim();
  }
  // Any evidence_ref with dimension leader and target
  for (const ref of insight.evidence_refs ?? []) {
    if (ref.target?.label) {
      const widget = context.widget_catalog.find((w) => w.id === ref.widgetId);
      const d = widget?.dimension;
      if (d === "leader" || d === "complexity_loan_officer") return ref.target.label.trim();
      if (d === "company_scorecard_loan_officer") return ref.target.label.trim();
      if (d === "company_scorecard_branch") return ref.target.label.trim();
      if (d?.startsWith("complexity_")) return ref.target.label.trim();
    }
  }
  // Fallback: filter_context
  const ctx = insight.filter_context as Record<string, unknown> | undefined;
  if (ctx?.leaderName != null && typeof ctx.leaderName === "string") return ctx.leaderName.trim();
  if (ctx?.leader != null && typeof ctx.leader === "string") return ctx.leader.trim();
  if (ctx?.branch != null && typeof ctx.branch === "string") return ctx.branch.trim();
  if (ctx?.loanOfficer != null && typeof ctx.loanOfficer === "string") return ctx.loanOfficer.trim();
  if (ctx?.loan_officer != null && typeof ctx.loan_officer === "string") return ctx.loan_officer.trim();
  return undefined;
}

/**
 * Build by-period supporting data from page context for the evidence table in the UI.
 */
function buildSupportingDataFromContext(context: DashboardPageContext): SupportingData | undefined {
  const byPeriod = context.data?.by_time_period as
    | Record<string, LoanComplexityPeriodData>
    | Record<string, CompanyScorecardPeriodData>
    | undefined;

  if (!byPeriod || typeof byPeriod !== "object") return undefined;

  const byPeriodRows: SupportingDataByPeriodRow[] = [];
  for (const [period, data] of Object.entries(byPeriod)) {
    const summary = data?.summary;
    const row: SupportingDataByPeriodRow = {
      period,
      periodLabel: data.periodLabel ?? period,
    };

    if (context.pageId === "loan-complexity") {
      const s = summary as LoanComplexityPeriodData["summary"];
      if (s?.portfolioWaComplexity != null) row.portfolioWaComplexity = Number(s.portfolioWaComplexity);
      if (s?.totalUnits != null) row.totalUnits = Number(s.totalUnits);
      if (s?.portfolioPullThrough != null) {
        const pt = Number(s.portfolioPullThrough);
        row.portfolioPullThrough = pt;
        row.averagePullThrough = pt;
      }
      byPeriodRows.push(row);
      continue;
    }

    if (context.pageId === "company-scorecard") {
      const s = summary as CompanyScorecardPeriodData["summary"];
      if (s?.totalUnits != null) row.totalUnits = Number(s.totalUnits);
      if (s?.totalVolume != null) row.totalVolume = Number(s.totalVolume);
      if (s?.wac != null) row.wac = Number(s.wac);
      if (s?.averagePullThrough != null) row.averagePullThrough = Number(s.averagePullThrough);
      if (s?.originatedUnits != null) row.originatedUnits = Number(s.originatedUnits);
      if (s?.originatedUnitsPct != null) row.originatedUnitsPct = Number(s.originatedUnitsPct);
      if (s?.withdrawnUnits != null) row.withdrawnUnits = Number(s.withdrawnUnits);
      if (s?.withdrawnUnitsPct != null) row.withdrawnUnitsPct = Number(s.withdrawnUnitsPct);
      if (s?.deniedUnits != null) row.deniedUnits = Number(s.deniedUnits);
      if (s?.deniedUnitsPct != null) row.deniedUnitsPct = Number(s.deniedUnitsPct);
      byPeriodRows.push(row);
      continue;
    }

    if (context.pageId === "credit-risk-management") {
      const periodData = data as CreditRiskPeriodData;
      const appType = "Applications Taken";
      const appData = periodData.byApplicationType?.[appType];
      const k = appData?.kpis;
      const s = appData?.creditRiskStory;
      if (!k && !s) continue;
      if (k?.units != null) row.totalUnits = Number(k.units);
      if (k?.volume != null) row.totalVolume = Number(k.volume);
      if (k?.wac != null) row.wac = Number(k.wac);
      if (k?.waFico != null) row.waFico = Number(k.waFico);
      if (k?.waLtv != null) row.waLtv = Number(k.waLtv);
      if (k?.waDti != null) row.waDti = Number(k.waDti);
      if (s?.conventionalQualifiedPercent != null) {
        row.conventionalQualifiedPercent = Number(s.conventionalQualifiedPercent);
      }
      if (s?.governmentQualifiedPercent != null) {
        row.governmentQualifiedPercent = Number(s.governmentQualifiedPercent);
      }
      byPeriodRows.push(row);
      continue;
    }

    if (!summary) continue;

    const lbSummary = summary as {
      topPerformerName?: string;
      topPerformerUnits?: number;
      topPerformerVolume?: number;
      averagePullThrough?: number;
      totalUnits?: number;
      totalVolume?: number;
    };
    if (lbSummary.averagePullThrough != null) row.averagePullThrough = lbSummary.averagePullThrough;
    if (lbSummary.totalUnits != null) row.totalUnits = lbSummary.totalUnits;
    if (lbSummary.totalVolume != null) row.totalVolume = lbSummary.totalVolume;
    if (lbSummary.topPerformerName) row.topPerformerName = lbSummary.topPerformerName;
    if (lbSummary.topPerformerUnits != null) row.topPerformerUnits = lbSummary.topPerformerUnits;
    if (lbSummary.topPerformerVolume != null) row.topPerformerVolume = lbSummary.topPerformerVolume;
    byPeriodRows.push(row);
  }
  if (byPeriodRows.length === 0) return undefined;
  return { byPeriod: byPeriodRows };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export interface RunPipelineResult {
  count: number;
  pageId: string;
  pageName: string;
  generationBatch: string;
}

export async function runDashboardInsightsPipeline(
  context: DashboardPageContext,
  tenantPool: Pool,
  tenantId: string,
  options?: { skipPersistence?: boolean }
): Promise<RunPipelineResult> {
  const generationBatch = randomUUID();
  const apiKey = await getOpenAIKey(tenantId);

  // Pass 1: Generator
  const genConfig = await getPromptConfig("dashboard_insights.generator");
  const genUser = buildGeneratorUserMessage(context);
  const genMessages: LLMMessage[] = [
    { role: "system", content: genConfig.system_prompt },
    { role: "user", content: genUser },
  ];
  const genRaw = await callLLM(genMessages, apiKey, {
    model: genConfig.model,
    temperature: genConfig.temperature,
    maxTokens: genConfig.max_tokens,
    jsonMode: genConfig.json_mode,
    tag: "dashboard_insights.generator",
  });
  let candidates = parseGeneratorResponse(genRaw);
  if (candidates.length === 0) {
    return { count: 0, pageId: context.pageId, pageName: context.pageName, generationBatch };
  }

  // Pass 2a: Fact-check
  const factCheckResults = factCheckCandidates(candidates, context);
  const afterFactCheck: { candidate: GeneratorCandidate; factCheck: FactCheckResult }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (factCheckResults[i].score >= 0.5) {
      afterFactCheck.push({ candidate: candidates[i], factCheck: factCheckResults[i] });
    }
  }
  if (afterFactCheck.length === 0) {
    return { count: 0, pageId: context.pageId, pageName: context.pageName, generationBatch };
  }
  candidates = afterFactCheck.map((x) => x.candidate);
  const factChecks = afterFactCheck.map((x) => x.factCheck);

  // Pass 2b: Judge
  const judgeConfig = await getPromptConfig("dashboard_insights.judge");
  const judgeUser = buildJudgeUserMessage(candidates, factChecks);
  const judgeMessages: LLMMessage[] = [
    { role: "system", content: judgeConfig.system_prompt },
    { role: "user", content: judgeUser },
  ];
  const judgeRaw = await callLLM(judgeMessages, apiKey, {
    model: judgeConfig.model,
    temperature: judgeConfig.temperature,
    maxTokens: judgeConfig.max_tokens,
    jsonMode: judgeConfig.json_mode,
    tag: "dashboard_insights.judge",
  });
  const evaluations = parseJudgeResponse(judgeRaw);
  const afterJudge: GeneratorCandidate[] = [];
  const afterJudgeEvals: JudgeEvaluation[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const ev = evaluations.find((e) => e.insight_index === i) ?? evaluations[i];
    if (ev && ev.keep && ev.overall_score >= 5.5) {
      afterJudge.push(candidates[i]);
      afterJudgeEvals.push(ev);
    }
  }
  if (afterJudge.length === 0) {
    return { count: 0, pageId: context.pageId, pageName: context.pageName, generationBatch };
  }

  // Pass 3: Curator
  const curatorConfig = await getPromptConfig("dashboard_insights.curator");
  const curatorUser = buildCuratorUserMessage(afterJudge, afterJudgeEvals);
  const curatorMessages: LLMMessage[] = [
    { role: "system", content: curatorConfig.system_prompt },
    { role: "user", content: curatorUser },
  ];
  const curatorRaw = await callLLM(curatorMessages, apiKey, {
    model: curatorConfig.model,
    temperature: curatorConfig.temperature,
    maxTokens: curatorConfig.max_tokens,
    jsonMode: curatorConfig.json_mode,
    tag: "dashboard_insights.curator",
  });
  const curatorInsights = parseCuratorResponse(
    curatorRaw,
    context.pageId,
    context.pageName
  );
  if (curatorInsights.length === 0) {
    return { count: 0, pageId: context.pageId, pageName: context.pageName, generationBatch };
  }

  // Deduplicate by subject (loan officer or branch): keep only the highest-scoring insight per subject
  const insights = deduplicateBySubject(curatorInsights, context);

  // Pass 4: Evidence Agent (refine evidence_refs per insight)
  const evidenceConfig = await getPromptConfig("dashboard_insights.evidence_agent");
  for (let i = 0; i < insights.length; i++) {
    const insight = insights[i];
    const evUser = buildEvidenceAgentUserMessage(insight, context.widget_catalog);
    const evMessages: LLMMessage[] = [
      { role: "system", content: evidenceConfig.system_prompt },
      { role: "user", content: evUser },
    ];
    try {
      const evRaw = await callLLM(evMessages, apiKey, {
        model: evidenceConfig.model,
        temperature: evidenceConfig.temperature,
        maxTokens: evidenceConfig.max_tokens,
        jsonMode: evidenceConfig.json_mode,
        tag: "dashboard_insights.evidence_agent",
      });
      const refs = parseEvidenceAgentResponse(evRaw);
      if (refs && refs.length > 0) {
        const enriched = enrichEvidenceRefsWithValues(context, refs);
        insights[i] = { ...insight, evidence_refs: enriched };
      }
    } catch {
      // keep existing evidence_refs on failure
    }
  }

  const supportingData = buildSupportingDataFromContext(context);
  for (let i = 0; i < insights.length; i++) {
    const insight = insights[i];
    const subjectName = getSubjectNameFromInsight(insight, context);
    const detail_data = buildDetailFromSupportingData(insight, supportingData, {
      generationBatch,
      dateFilter: (insight.filter_context?.datePeriod as string) || undefined,
      subjectName: subjectName || undefined,
      context,
    });
    insights[i] = { ...insight, supporting_data: supportingData, detail_data: detail_data ?? undefined };
  }

  if (!options?.skipPersistence) {
    await saveDashboardInsights(
      tenantPool,
      context.pageId,
      context.pageName,
      insights,
      generationBatch
    );
  }

  return {
    count: insights.length,
    pageId: context.pageId,
    pageName: context.pageName,
    generationBatch,
  };
}
