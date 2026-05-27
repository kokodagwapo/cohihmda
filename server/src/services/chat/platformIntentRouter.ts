/**
 * Platform-aware intent routing for Normal Chat — maps questions to dashboards,
 * scorecard surfaces, and metric semantics beyond generic SQL ranking.
 */

import { getNavigationTargetById } from "./navigationTargetCatalog.js";

export type PlatformIntentKind =
  | "sales_scorecard_tier"
  | "operations_scorecard"
  | "top_tiering_comparison"
  | "company_scorecard"
  | "pipeline_health"
  | "conversion_performance"
  | "ambiguous_tier_vs_ranking";

export interface PlatformIntent {
  kind: PlatformIntentKind;
  confidence: "high" | "medium" | "low";
  /** When true, do not run generic top-N ranking heuristics. */
  suppressRankingGuard: boolean;
  navigationTargetId?: string;
  /** Extra steering text appended to platform business context. */
  promptSteering?: string;
  /** Short clarifying question when intent is ambiguous. */
  clarificationQuestion?: string;
}

const TIER_PHRASE =
  /\b(top[\s-]?tier|second[\s-]?tier|bottom[\s-]?tier|tier(?:ed)?\s+(?:lo|loan officer|los|processor|underwriter|personnel)|tts\b|top[\s-]?tiering\s+score)\b/i;
const SCORECARD_PHRASE =
  /\b(scorecard|sales scorecard|operations scorecard|company scorecard)\b/i;
const TOP_N_PHRASE = /\b(?:top|best|highest)\s+\d{1,2}\b/i;
const PIPELINE_HEALTH =
  /\b(pipeline health|active pipeline|pipeline performance|stale active)\b/i;
const CONVERSION_PERF =
  /\b(conversion performance|pull[\s-]?through|fallout rate|workflow conversion|funnel conversion)\b/i;

const ROUTE_DEFAULTS: Record<string, PlatformIntentKind> = {
  "/sales-scorecard": "sales_scorecard_tier",
  "/sales-scorecard-overview": "sales_scorecard_tier",
  "/operations-scorecard": "operations_scorecard",
  "/performance/toptiering-comparison": "top_tiering_comparison",
  "/top-tiering-comparison": "top_tiering_comparison",
  "/company-scorecard": "company_scorecard",
  "/pipeline-analysis": "pipeline_health",
  "/workflow-conversion": "conversion_performance",
};

function navPath(targetId: string): string | undefined {
  return getNavigationTargetById(targetId)?.path;
}

function baseIntent(
  kind: PlatformIntentKind,
  confidence: PlatformIntent["confidence"],
  overrides: Partial<PlatformIntent> = {},
): PlatformIntent {
  return {
    kind,
    confidence,
    suppressRankingGuard: overrides.suppressRankingGuard ?? false,
    ...overrides,
  };
}

/**
 * Resolve platform intent from question text and optional client page route.
 */
export function detectPlatformIntent(
  question: string,
  pageRoute?: string | null,
): PlatformIntent | null {
  const q = question.toLowerCase().trim();
  if (!q) return null;

  const routeKind = pageRoute ? ROUTE_DEFAULTS[pageRoute] : undefined;

  const hasTier = TIER_PHRASE.test(q);
  const hasTopN = TOP_N_PHRASE.test(q);
  const hasScorecard = SCORECARD_PHRASE.test(q);
  const hasLoPersonnel =
    /\b(loan officers?|los?|processors?|underwriters?|personnel|branches?)\b/.test(
      q,
    );

  if (hasTier && hasTopN && !hasScorecard) {
    return baseIntent("ambiguous_tier_vs_ranking", "medium", {
      suppressRankingGuard: true,
      clarificationQuestion:
        "Do you mean **platform tier bands** (Top / Second / Bottom tier from the Sales Scorecard) or a **top-N ranking** by volume or pull-through (e.g. top 10 loan officers)?",
      promptSteering:
        "User may mean platform tier semantics OR a numeric top-N ranking. Ask one clarifying question before running ranking SQL.",
    });
  }

  if (hasTier || (hasScorecard && hasLoPersonnel)) {
    const salesOps =
      /\b(operations?|processor|underwriter|uw)\b/.test(q) &&
      !/\b(sales|lo|loan officer)\b/.test(q);
    const kind: PlatformIntentKind = salesOps
      ? "operations_scorecard"
      : "sales_scorecard_tier";

    return baseIntent(kind, "high", {
      suppressRankingGuard: true,
      navigationTargetId: salesOps
        ? "operations-scorecard"
        : "sales-scorecard",
      promptSteering: [
        "PLATFORM TIER INTENT: User is asking about personnel **tiers** (Top / Second / Bottom), not a generic top-N leaderboard.",
        "TTS and tier bands are computed in the **Sales Scorecard** (or Operations Scorecard for processors/underwriters), not as a stored loans-table column.",
        "Do NOT rank loan officers by raw application count unless the user explicitly asked for volume ranking.",
        "Prefer citing scorecard tier logic; suggest opening the Sales Scorecard for named tier lists.",
      ].join(" "),
    });
  }

  if (/\b(top[\s-]?tiering|pareto|revenue tier)\b/.test(q)) {
    return baseIntent("top_tiering_comparison", "high", {
      suppressRankingGuard: true,
      navigationTargetId: "top-tiering-comparison",
      promptSteering:
        "User is asking about **Top Tiering Comparison** (revenue Pareto tiers), not loan-officer application counts.",
    });
  }

  if (PIPELINE_HEALTH.test(q)) {
    return baseIntent("pipeline_health", "medium", {
      navigationTargetId: "pipeline-analysis",
      promptSteering:
        "Pipeline health mixes **windowed conversion** (pull-through, fallout by cohort) with **snapshot active pipeline** (active loans as of today). Do not repeat snapshot active counts on every timeframe row.",
    });
  }

  if (CONVERSION_PERF.test(q)) {
    return baseIntent("conversion_performance", "medium", {
      navigationTargetId: routeKind === "company_scorecard"
        ? "company-scorecard"
        : "workflow-conversion",
      promptSteering:
        "Conversion metrics are cohort-based; prefer 90D or YTD over 30D when cycle time exceeds ~30 days. Caveat immature cohorts.",
    });
  }

  if (hasScorecard) {
    const company = /\bcompany\b/.test(q);
    return baseIntent(
      company ? "company_scorecard" : "sales_scorecard_tier",
      "medium",
      {
        navigationTargetId: company
          ? "company-scorecard"
          : "sales-scorecard",
        suppressRankingGuard: true,
      },
    );
  }

  if (routeKind) {
    const targetMap: Partial<Record<PlatformIntentKind, string>> = {
      sales_scorecard_tier: "sales-scorecard",
      operations_scorecard: "operations-scorecard",
      top_tiering_comparison: "top-tiering-comparison",
      company_scorecard: "company-scorecard",
      pipeline_health: "pipeline-analysis",
      conversion_performance: "workflow-conversion",
    };
    return baseIntent(routeKind, "low", {
      navigationTargetId: targetMap[routeKind],
      promptSteering: `User is on ${pageRoute}; prefer metrics and navigation aligned with that dashboard.`,
    });
  }

  return null;
}

export function platformIntentNavigationHints(
  intent: PlatformIntent | null,
): { label: string; path: string }[] {
  if (!intent?.navigationTargetId) return [];
  const target = getNavigationTargetById(intent.navigationTargetId);
  if (!target?.path) return [];
  return [{ label: target.label, path: target.path }];
}

export function buildPlatformIntentSteeringBlock(
  intent: PlatformIntent | null,
): string | undefined {
  if (!intent?.promptSteering) return undefined;
  const nav = platformIntentNavigationHints(intent);
  const navLine =
    nav.length > 0
      ? `\nRecommended dashboard: **${nav[0].label}** (${nav[0].path}).`
      : "";
  return `## Platform intent routing\n${intent.promptSteering}${navLine}`;
}
