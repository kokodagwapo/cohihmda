/**
 * LLM Insight Generator — 3-Pass Pipeline
 *
 * Generates executive insights via a multi-pass pipeline:
 *   Pass 1: Generator (gpt-5.2)    — 25-30 candidates with reasoning chains
 *   Pass 2: Validator (code+judge) — programmatic fact-check + LLM scoring
 *   Pass 3: Curator (gpt-5.2)      — rank, deduplicate, polish final 15-20
 *
 * Buckets (working/attention/critical/context) are derived post-hoc from
 * sentiment, not used during generation.
 *
 * Results are persisted to the tenant `generated_insights` table.
 */

import pg from "pg";
import crypto from "crypto";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import { pool as managementPool } from "../../config/managementDatabase.js";
import { decryptAPIKeys } from "../encryption.js";
import { logLLMUsage } from "../llmUsageTracker.js";
import {
  InsightMetricsPayload,
  PeriodSnapshot,
  Signal,
  computeSignals,
  formatSignalsForPrompt,
  filterSignalsByDomain,
  fetchHistoricalPatternContext,
  fetchKnowledgeContextForInsights,
} from "./insightMetricsCollector.js";
import { hydrateInsightDetails } from "./insightDetailHydrator.js";
import { getPromptConfig, buildPrompt } from "../promptConfigService.js";
import { getSchemaForTenant } from "../ai/schemaContextService.js";
import { getTenantRevenueExpression } from "../../utils/scorecard-utils.js";
import { getStandardDateRanges } from "../metrics/canonicalMetrics.js";
import {
  insightLog, insightLogWarn, insightLogError,
  insightLogStart, insightLogEnd, getInsightLogPath,
} from "./insightLogger.js";
import { VIZ_STANDARDS_MEDIUM } from "../../config/visualizationStandards.js";

// ============================================================================
// Types
// ============================================================================

/** Column definition for self-describing evidence tables. */
export interface EvidenceColumnDef {
  key: string;
  label: string;
  format: "text" | "currency" | "percent" | "number" | "date" | "rate" | "days" | "mono" | "badge" | "bps";
  align: "left" | "right" | "center";
}

/** Summary metric definition for self-describing evidence tables. */
export interface EvidenceSummaryDef {
  key: string;
  label: string;
  value: number | string;
  format: "number" | "currency" | "percent" | "days" | "bps";
  color: "blue" | "green" | "red" | "amber" | "purple";
}

/** Pipeline-level context shared across all insights in a generation batch. */
export interface PipelineContext {
  generationBatch: string;
  dateFilter: string;
  channelGroup?: string;
  metricsPrompt: string;
  signalsText: string;
  signalCount: number;
  generatorModel: string;
  generatorCandidateCount: number;
  judgeModel?: string;
  curatorModel?: string;
  domains?: Array<{ id: string; candidateCount: number; promptLength: number }>;
  stepTimings: {
    signals: number;
    rag: number;
    generator: number;
    factCheck: number;
    judge: number;
    curator: number;
    evidence: number;
    total: number;
  };
}

/** Per-insight journey tracking how a single insight progressed through the pipeline. */
export interface InsightJourney {
  generatorIndex: number;
  headline: string;
  reasoningChain?: string;
  citedNumbers?: string[];
  sourceDomain?: InsightDomainId;
  factCheck: {
    score: number;
    issues: string[];
  };
  judgeScore: number;
  judgeIssues?: string[];
  curatorBucket: string;
  curatorPriority: string;
}

/** Audit trail capturing how evidence data was gathered and transformed. */
export interface EvidenceAudit {
  pipelineContext?: PipelineContext;
  insightJourney?: InsightJourney;
  generatedSql: string;
  rowCount: number;
  rawSummary: EvidenceSummaryDef[];
  resolvedSummary: EvidenceSummaryDef[];
  finalSummary: EvidenceSummaryDef[];
  corrections: Array<{ key: string; label: string; from: number; to: number; reason: string }>;
  comparisonSql?: string;
  comparisonRowCount?: number;
  sqlExecutionMs?: number;
  totalMs?: number;
  evidenceQualityScore?: number;
  qualityIssues?: string[];
}

/** LLM-generated evidence table that proves an insight's claim. */
export interface EvidenceTable {
  title: string;
  columns: EvidenceColumnDef[];
  rows: Array<Record<string, any>>;
  summary: EvidenceSummaryDef[];
  loan_ids?: string[] | null;
  /** Comparison period data (only for period-comparison insights). */
  comparison?: {
    label: string;
    currentLabel: string;
    rows: Array<Record<string, any>>;
    summary: EvidenceSummaryDef[];
  } | null;
  /** Data provenance audit trail (admin-only). */
  audit?: EvidenceAudit;
}

/** Pre-hydrated detail snapshot stored at generation time. */
export interface InsightDetailSnapshot {
  title: string;
  summary: Record<string, any>;
  rows: Array<Record<string, any>>;
  displayConfig: {
    columns: string[];
    summaryMetrics: string[];
    column_defs?: EvidenceColumnDef[];
    summary_defs?: EvidenceSummaryDef[];
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
    rows: Array<Record<string, any>>;
    summary: Record<string, any>;
    summary_defs?: EvidenceSummaryDef[];
  };
  /** Data provenance audit trail (admin-only). */
  audit?: EvidenceAudit;
}

/** A single categorized insight (the enriched object stored in the DB). */
export interface CategorizedInsight {
  bucket: "working" | "attention" | "critical" | "context";
  priority: "BLUE" | "YELLOW" | "RED" | "GRAY";
  headline: string;
  understory: string;
  insight_type: "success" | "warning" | "critical" | "info";
  source: string;
  severity_score: number;
  impact: {
    type?: string;
    estimated_dollars?: number | null;
    units_affected?: number | null;
  };
  evidence: {
    metrics?: string[];
    comparisons?: string[];
  };
  for_podcast: boolean;
  // ETM Framework fields (Executive Thinking Model)
  what_changed?: string;
  why?: string;
  business_impact?: string;
  risk_if_ignored?: string;
  recommended_action?: string;
  owner?: string;
  // LLM-generated evidence table for the detail drill-down
  evidence_table?: EvidenceTable | null;
  /** Legacy: LLM-chosen columns for the detail drill-down table. */
  detail_columns?: string[];
  /** Legacy: LLM-chosen summary metrics for the detail drill-down cards. */
  summary_metrics?: string[];
  /** Exact filter params for replaying the detail query at drill-down time. */
  detail_query?: Record<string, any> | null;
  /** Pre-hydrated detail snapshot — rendered directly by the frontend. */
  detail_data?: InsightDetailSnapshot | null;
  /** 'pipeline' (old 3-pass) or 'agent' (new agent-driven engine) */
  generation_method?: "pipeline" | "agent";
  /** Functional category this insight belongs to */
  functional_category?: string | null;
}

/** Full response from a generation run. */
export interface CategorizedInsightsResponse {
  insights: CategorizedInsight[];
  generationBatch: string;
  generatedAt: string;
  summaryForPodcast: string;
}

// Legacy types kept for backward compatibility
export interface GeneratedInsight {
  type: "success" | "warning" | "info" | "critical";
  message: string;
  priority: "critical" | "high" | "medium" | "low";
  reasoning: string;
  source: string;
  forPodcast: boolean;
}

export interface LLMInsightsResponse {
  insights: GeneratedInsight[];
  insightCount: number;
  summaryForPodcast: string;
}

// ============================================================================
// Insight Domain Configuration — 4 parallel generator domains
// ============================================================================

export type InsightDomainId = "product_pipeline" | "personnel" | "risk_compliance" | "volume_trends";

export interface InsightDomain {
  id: InsightDomainId;
  label: string;
  signalAreas: Signal["area"][];
  candidateTarget: number;
}

export const INSIGHT_DOMAINS: InsightDomain[] = [
  {
    id: "product_pipeline",
    label: "Product & Pipeline Performance",
    signalAreas: ["product", "pipeline", "risk_cross_tab", "funnel"],
    candidateTarget: 8,
  },
  {
    id: "personnel",
    label: "Personnel & Tiering",
    signalAreas: ["personnel", "personnel_aggregate"],
    candidateTarget: 8,
  },
  {
    id: "risk_compliance",
    label: "Risk & Compliance",
    signalAreas: ["risk", "compliance", "predictions"],
    candidateTarget: 8,
  },
  {
    id: "volume_trends",
    label: "Volume, Trends & Market",
    signalAreas: ["performance", "comparisons", "structural", "revenue", "margin"],
    candidateTarget: 8,
  },
];

// ============================================================================
// Sentiment → Bucket mapping (post-hoc, deterministic)
// ============================================================================

const SENTIMENT_TO_BUCKET: Record<string, { bucket: CategorizedInsight["bucket"]; priority: CategorizedInsight["priority"] }> = {
  positive: { bucket: "working", priority: "BLUE" },
  warning:  { bucket: "attention", priority: "YELLOW" },
  critical: { bucket: "critical", priority: "RED" },
  neutral:  { bucket: "context", priority: "GRAY" },
};

// ============================================================================
// Fact-checker — programmatic validation of insight candidates
// ============================================================================

interface FactCheckResult {
  insightIndex: number;
  score: number;     // 0-1, higher = more accurate
  issues: string[];  // description of each issue found
}

/**
 * Programmatic fact-checker: extracts cited numbers from insight candidates
 * and cross-references them against the actual metrics payload.
 * Returns a score (0-1) and list of issues for each candidate.
 */
function factCheckInsights(
  candidates: Array<{ headline: string; understory: string; cited_numbers?: string[]; source?: string; sentiment?: string }>,
  metrics: InsightMetricsPayload,
  signals: Signal[]
): FactCheckResult[] {
  // Build a set of "known numbers" from the metrics payload for fuzzy matching
  const knownNumbers = new Set<string>();
  const addNum = (v: number, prefix = "") => {
    if (v === 0 || isNaN(v)) return;
    knownNumbers.add(`${prefix}${v}`);
    knownNumbers.add(`${prefix}${v.toFixed(0)}`);
    knownNumbers.add(`${prefix}${v.toFixed(1)}`);
    if (v >= 1_000_000) {
      knownNumbers.add(`${prefix}$${(v / 1_000_000).toFixed(1)}M`);
      knownNumbers.add(`${prefix}$${(v / 1_000_000).toFixed(2)}M`);
    }
    if (v >= 1_000) {
      knownNumbers.add(`${prefix}$${(v / 1_000).toFixed(0)}K`);
      knownNumbers.add(`${prefix}$${Math.round(v / 1_000)}K`);
    }
    knownNumbers.add(`${prefix}$${v.toFixed(0)}`);
    knownNumbers.add(`${prefix}${v.toFixed(1)}%`);
  };

  // Pipeline
  addNum(metrics.pipeline.activeLoans);
  addNum(metrics.pipeline.activeVolume);
  addNum(metrics.pipeline.lockedLoans);
  // Predictions
  addNum(metrics.predictions.likelyWithdraw);
  addNum(metrics.predictions.likelyDeny);
  addNum(metrics.predictions.likelyOriginate);
  addNum(metrics.predictions.allAtRiskLoanIds.length);
  addNum(metrics.predictions.allAtRiskVolume);
  addNum(metrics.predictions.highRiskLoans.length);
  addNum(metrics.predictions.highRiskVolume);
  // Performance
  addNum(metrics.performance.pullThroughRolling90D);
  addNum(metrics.performance.avgCycleTime);
  addNum(metrics.performance.revenueYTD);
  addNum(metrics.performance.volumeYTD);
  // Snapshots
  const snaps = metrics.periodSnapshots;
  for (const snap of Object.values(snaps)) {
    addNum(snap.pullThroughRate);
    addNum(snap.falloutRate);
    addNum(snap.fundedVolume);
    addNum(snap.avgCycleTime);
    addNum(snap.funded);
  }
  // Closing risk, lock, TRID
  addNum(metrics.closingRisk.atRiskCount);
  addNum(metrics.closingRisk.atRiskVolume);
  addNum(metrics.lockExpiration.expiringCount);
  addNum(metrics.lockExpiration.expiringVolume);
  addNum(metrics.tridExposure.atRiskCount);
  // Margin
  addNum(metrics.marginData.currentMonthBps);
  addNum(metrics.marginData.deltaBps);
  // Lost opportunity
  addNum(metrics.lostOpportunity.withdrawnUnits);
  addNum(metrics.lostOpportunity.withdrawnVolume);
  addNum(metrics.lostOpportunity.deniedUnits);
  addNum(metrics.lostOpportunity.deniedVolume);
  // Credit
  addNum(metrics.creditRisk.waFico);
  addNum(metrics.creditRisk.highRiskLoanCount);
  // Product breakdown (per-product fallout, pull-through, volume)
  for (const p of metrics.productBreakdown) {
    addNum(p.funded);
    addNum(p.withdrawn);
    addNum(p.denied);
    addNum(p.fallenOut);
    addNum(p.completed);
    addNum(p.falloutRate);
    addNum(p.pullThroughRate);
    addNum(p.fundedVolume);
  }
  // Officers
  const knownOfficers = new Set<string>();
  for (const group of metrics.tiering.byActorType) {
    for (const p of [...group.topPerformers, ...group.bottomPerformers]) {
      knownOfficers.add(p.name.toLowerCase());
      addNum(p.units);
      addNum(p.revenue);
      addNum(p.volume);
      addNum(p.pullThrough);
    }
  }

  // Build signal direction lookup
  const signalDirectionMap = new Map<string, Signal["direction"]>();
  for (const sig of signals) {
    signalDirectionMap.set(sig.metric.toLowerCase(), sig.direction);
  }

  return candidates.map((cand, idx) => {
    const issues: string[] = [];
    let penalty = 0;

    // Check cited numbers exist in known set (fuzzy)
    if (cand.cited_numbers && cand.cited_numbers.length > 0) {
      for (const num of cand.cited_numbers) {
        const normalized = num.replace(/,/g, "").trim();
        // Skip very short or generic numbers
        if (normalized.length <= 1 || normalized === "0") continue;
        // Check if any known number contains or matches this
        const found = [...knownNumbers].some(k =>
          k.includes(normalized) || normalized.includes(k)
        );
        if (!found) {
          // Not necessarily wrong — could be a derived calculation
          // Only flag as minor issue
          issues.push(`UNVERIFIED: "${num}" not directly found in metrics`);
          penalty += 0.05;
        }
      }
    }

    // Check named officers exist
    const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
    const text = `${cand.headline} ${cand.understory}`;
    let nameMatch;
    while ((nameMatch = namePattern.exec(text)) !== null) {
      const name = nameMatch[1].toLowerCase();
      // Skip common non-name phrases
      const skipWords = ["Pull Through", "Cycle Time", "Active Loan", "Risk Score", "High Risk", "Low Risk", "Funded Volume", "Credit Risk"];
      if (skipWords.some(s => s.toLowerCase() === name)) continue;
      if (knownOfficers.size > 0 && knownOfficers.has(name)) continue;
      // Could be a non-officer name phrase, only minor flag
    }

    // Check sentiment alignment with signals — entity-specific matching
    // Only flag a mismatch if the insight text mentions the SAME entity as a signal
    if (cand.sentiment) {
      const sentimentIsPositive = cand.sentiment === "positive";
      const sentimentIsNegative = cand.sentiment === "warning" || cand.sentiment === "critical";
      const textLower = text.toLowerCase();

      // For personnel insights, only match signals that mention the same person
      // For aggregate personnel signals, match on tier/aggregate keywords
      // For non-personnel, match signals whose metric name appears in the text
      const relevantSignals = signals.filter(sig => {
        // Aggregate personnel signals — match on tier/aggregate keywords
        if (sig.area === "personnel_aggregate") {
          const metricLower = sig.metric.toLowerCase();
          return (metricLower.includes("top tier") && textLower.includes("top tier")) ||
            (metricLower.includes("second tier") && textLower.includes("second tier")) ||
            (metricLower.includes("bottom tier") && textLower.includes("bottom tier")) ||
            (metricLower.includes("concentration") && textLower.includes("concentrat")) ||
            (metricLower.includes("headcount") && textLower.includes("headcount")) ||
            (metricLower.includes("migration") && (textLower.includes("promot") || textLower.includes("demot") || textLower.includes("migrat"))) ||
            (metricLower.includes("key-person") && textLower.includes("key")) ||
            (metricLower.includes("gini") && textLower.includes("gini"));
        }
        // Extract entity name from the signal metric (e.g., "Top Performer: John Doe" → "john doe")
        const colonIdx = sig.metric.indexOf(":");
        if (colonIdx >= 0) {
          const entityName = sig.metric.substring(colonIdx + 1).trim().toLowerCase();
          return textLower.includes(entityName);
        }
        // For non-entity signals (e.g., "Pull-Through Rate"), match if the metric concept appears
        const metricLower = sig.metric.toLowerCase();
        return textLower.includes(metricLower) ||
          (metricLower.includes("fallout") && textLower.includes("fallout")) ||
          (metricLower.includes("pull-through") && textLower.includes("pull-through")) ||
          (metricLower.includes("cycle time") && textLower.includes("cycle")) ||
          (metricLower.includes("volume") && textLower.includes("volume"));
      });

      for (const sig of relevantSignals) {
        if (sentimentIsPositive && (sig.direction === "critical" || sig.direction === "negative")) {
          issues.push(`SENTIMENT MISMATCH: insight says "positive" but signal "${sig.metric}" is "${sig.direction}"`);
          penalty += 0.25;
        }
        if (sentimentIsNegative && sig.direction === "positive") {
          issues.push(`SENTIMENT MISMATCH: insight says "${cand.sentiment}" but signal "${sig.metric}" is "positive"`);
          penalty += 0.2;
        }
      }
    }

    // Check if insight references fields with low population
    const fp = metrics.fieldPopulation || {};
    const FIELD_POP_WARN = 40;
    const combinedTextLower = text.toLowerCase();
    const lowPopFieldChecks: Array<{ pattern: RegExp; field: string; label: string }> = [
      { pattern: /\bctc\b|clear.?to.?close|clearing.?to.?close/i, field: "ctc_date", label: "CTC date" },
      { pattern: /\bclosing.?disclosure\b|\bcd.?sent\b|\btrid\b/i, field: "cd_sent_date", label: "CD Sent date" },
      { pattern: /\block.?expir/i, field: "lock_expiration_date", label: "Lock Expiration date" },
    ];
    for (const check of lowPopFieldChecks) {
      if (check.pattern.test(combinedTextLower)) {
        const pop = fp[check.field];
        if (pop !== undefined && pop < FIELD_POP_WARN) {
          issues.push(`LOW FIELD POPULATION: insight references ${check.label} but it is only ${pop}% populated — insight may be misleading`);
          penalty += 0.35;
        }
      }
    }

    // Penalize speculative/unverifiable subjective claims not backed by data
    const speculativePattern = /\b(morale|team culture|uncertainty|confidence|dynamics|sentiment|frustrat|motivat|satisfaction|team spirit|work.?life|burnout|engagement)\b/i;
    if (speculativePattern.test(combinedTextLower)) {
      issues.push("SPECULATIVE: headline/understory contains unverifiable subjective claims not backed by data");
      penalty += 0.3;
    }

    // Suppress misleading MTD pull-through / fallout / conversion insights.
    // MTD windows are too short — active loans haven't had time to close,
    // so PT ≈ 0% and fallout ≈ 100%, which is misleading, not actionable.
    const isMTD = /\bMTD\b|month.?to.?date/i.test(combinedTextLower);
    const isPTorFallout = /pull.?through|fallout|conversion.?rate|funded.?rate/i.test(combinedTextLower);
    if (isMTD && isPTorFallout) {
      issues.push("MTD_CONVERSION: MTD pull-through/fallout/conversion metrics are misleading — active loans haven't had time to close");
      penalty += 0.5;
    }

    // Suppress insights about "unclassified" risk drivers — not actionable.
    // These come from predictions where no signal dimension scored >= 4, so the
    // model predicts withdrawal but can't attribute it to a clear driver.
    const unclassifiedPattern = /\b(other\s*\/?\s*unclassified|unclassified\s*(risk|driver|factor|reason|for|bucket))\b/i;
    if (unclassifiedPattern.test(combinedTextLower)) {
      issues.push("UNCLASSIFIED_RISK: Insight cites 'unclassified' risk drivers — not actionable for the user");
      penalty += 0.35;
    }

    // Detect volatile single-period comparisons (trailing 30D / last 30 days).
    // If the insight cites a massive % change (>= 100%) in a short window, cross-check
    // against 60D/90D aggregate snapshots. If the longer window doesn't corroborate, it's a blip.
    const trailing30DPattern = /trailing\s*30\s*d|past\s*30\s*days?|last\s*30\s*days?|30.?day/i;
    const largeChangePattern = /(\d{3,})%/;
    if (trailing30DPattern.test(combinedTextLower)) {
      const changeMatch = combinedTextLower.match(largeChangePattern);
      if (changeMatch) {
        const snaps = metrics.periodSnapshots;
        const vol30 = snaps.rolling30d?.fundedVolume ?? 0;
        const vol60 = snaps.rolling60d?.fundedVolume ?? 0;
        const volPrior30 = snaps.prior30d?.fundedVolume ?? 0;
        const volPrior60 = snaps.prior60d?.fundedVolume ?? 0;
        const delta30 = volPrior30 > 0 ? ((vol30 - volPrior30) / volPrior30) * 100 : 0;
        const delta60 = volPrior60 > 0 ? ((vol60 - volPrior60) / volPrior60) * 100 : 0;
        if (Math.abs(delta30) > 200 && Math.abs(delta60) < 50) {
          issues.push("VOLATILE_BLIP: Extreme short-period change (30D) not corroborated by 60D/90D trends — likely a blip, not a real trend");
          penalty += 0.25;
        }
      }
    }

    const score = Math.max(0, Math.min(1, 1.0 - penalty));
    return { insightIndex: idx, score, issues };
  });
}

// ============================================================================
// OpenAI Key
// ============================================================================

async function getOpenAIKey(tenantId?: string): Promise<string> {
  if (tenantId) {
    try {
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);
      const tableCheck = await tenantPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'rag_settings'
        ) as exists
      `);
      if (tableCheck.rows[0]?.exists) {
        const result = await tenantPool.query(
          `SELECT openai_api_key FROM public.rag_settings LIMIT 1`
        );
        if (result.rows[0]?.openai_api_key) {
          const decrypted = await decryptAPIKeys({
            openai_api_key: result.rows[0].openai_api_key,
          });
          if (decrypted.openai_api_key) return decrypted.openai_api_key;
        }
      }
    } catch {
      console.log(
        "[LLMInsights] Error fetching tenant API key, falling back to env"
      );
    }
  }
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;
  throw new Error("OpenAI API key not configured");
}

// ============================================================================
// Metrics formatting (shared user prompt builder)
// ============================================================================

// --- Shared formatting helpers (module-scope for all prompt builders) ---

const promptFmt$ = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};
const promptFmtPct = (v: number) => `${v.toFixed(1)}%`;

function promptFmtSnap(label: string, cur: PeriodSnapshot, prior?: PeriodSnapshot): string {
  const parts = [
    `${label} (Application Cohort): ${cur.totalApplications} apps, ${cur.completed} completed, ${cur.funded} originated`,
    `  PT: ${promptFmtPct(cur.pullThroughRate)}  |  Fallout: ${promptFmtPct(cur.falloutRate)}`,
    `${label} (Funding Cohort): ${cur.fundedCount} loans funded in period`,
    `  Volume: ${promptFmt$(cur.fundedVolume)}  |  GOS Revenue: ${promptFmt$(cur.fundedRevenue)}  |  Cycle: ${cur.avgCycleTime}d`,
  ];
  if (prior && (prior.completed > 0 || prior.fundedCount > 0)) {
    const volDelta = prior.fundedVolume > 0 ? ((cur.fundedVolume - prior.fundedVolume) / prior.fundedVolume * 100) : 0;
    const ptDelta = cur.pullThroughRate - prior.pullThroughRate;
    const cycleDelta = cur.avgCycleTime - prior.avgCycleTime;
    const fundedCountDelta = prior.fundedCount > 0 ? ((cur.fundedCount - prior.fundedCount) / prior.fundedCount * 100) : 0;
    parts.push(
      `  vs Prior: Vol ${promptFmt$(prior.fundedVolume)}→${promptFmt$(cur.fundedVolume)} (${volDelta > 0 ? "+" : ""}${promptFmtPct(volDelta)})` +
      ` | Units ${prior.fundedCount}→${cur.fundedCount} (${fundedCountDelta > 0 ? "+" : ""}${promptFmtPct(fundedCountDelta)})` +
      ` | PT ${promptFmtPct(prior.pullThroughRate)}→${promptFmtPct(cur.pullThroughRate)} (${ptDelta > 0 ? "+" : ""}${ptDelta.toFixed(1)}pp)` +
      ` | Cycle ${prior.avgCycleTime}d→${cur.avgCycleTime}d (${cycleDelta > 0 ? "+" : ""}${cycleDelta}d)`
    );
  }
  return parts.join("\n");
}

// --- Domain-specific section builders ---

let _cachedMarketContext = "";
export function setMarketContextForLegacyPipeline(ctx: string) {
  _cachedMarketContext = ctx;
}

function buildSharedContext(metrics: InsightMetricsPayload, channelGroup?: string): string {
  const snaps = metrics.periodSnapshots;
  const channelLabel = channelGroup
    ? `${channelGroup} (data filtered to ${channelGroup} channel only)`
    : "All (combined Retail + TPO data)";
  const personnelLabel = channelGroup === "TPO" ? "Account Executives" : "Loan Officers";

  return `=== PERIOD ===
All period snapshots below are computed independently. Lead with whichever timeframe reveals the most significant or actionable change.
Reference Range: ${metrics.period.start || "N/A"} to ${metrics.period.end || "N/A"}

=== CHANNEL ===
Channel: ${channelLabel}
Personnel Label: ${personnelLabel}
IMPORTANT: All data below is scoped to the "${channelGroup || "All"}" channel. When generating insights, frame them in terms of this channel. ${channelGroup ? `Do NOT reference the other channel (${channelGroup === "Retail" ? "TPO" : "Retail"}) since that data is not included here.` : "This includes both Retail and TPO data combined."}

=== PIPELINE (Current Active Loans) ===
- Active Loans: ${metrics.pipeline.activeLoans}
- Active Volume: ${promptFmt$(metrics.pipeline.activeVolume)}
- Locked Loans: ${metrics.pipeline.lockedLoans}
- Closed Loans: ${metrics.pipeline.closedLoans}
- Closed Volume: ${promptFmt$(metrics.pipeline.closedVolume)}

=== CONVERSION METRICS — Unified (Pull-Through + Fallout = 100% in every row) ===
IMPORTANT: These metrics are computed from the SAME population in each row.
Pull-Through = funded loans / completed loans. Fallout = non-funded completed / completed loans.
They ALWAYS sum to 100%. When citing a rate, ALWAYS include its timeframe.

${promptFmtSnap("YTD", snaps.ytd, snaps.priorYtd)}

${promptFmtSnap("Rolling 90D", snaps.rolling90d, snaps.prior90d)}

${promptFmtSnap("Rolling 60D", snaps.rolling60d, snaps.prior60d)}

${promptFmtSnap("Rolling 30D", snaps.rolling30d, snaps.prior30d)}

${promptFmtSnap("MTD", snaps.mtd, snaps.priorMtd)}

RULES FOR CONVERSION METRICS:
1. ALWAYS state the timeframe when citing PT or Fallout (e.g. "PT 56.7% YTD", not just "PT 56.7%")
2. NEVER mix timeframes (e.g. "PT is 56.7% but Fallout is 43.3%" must come from the SAME row)
3. Use the "vs Prior" deltas above — do NOT compute your own from rounded numbers
4. When comparing trends, look at 30D vs 60D vs 90D to identify acceleration/deceleration
5. SHORT-WINDOW RELIABILITY: Mortgage cycle times (application to funding) often exceed 30 days. A 30D application cohort will still have many loans in-process, making 30D PT artificially low and 30D fallout artificially high. The 90D and YTD windows are the most reliable for pull-through and fallout analysis. If you cite 30D conversion metrics, acknowledge that they are provisional due to cycle time. Do NOT build an insight headline around 30D PT or fallout unless the 90D/YTD trend corroborates it.${_cachedMarketContext ? `

=== MARKET RATE CONTEXT (OBMMIC30YF — 30-Year Fixed Conforming) ===
${_cachedMarketContext}
IMPORTANT: Use this market rate data to contextualize pipeline insights. Rising rates increase withdrawal risk and reduce refinance demand. Falling rates may boost refi activity. Generate at least 1 insight that connects market rate trends to pipeline behavior (e.g., lock expiration risk, withdrawal patterns, refi vs purchase mix shifts).` : ""}`;
}

function buildProductPipelineSections(metrics: InsightMetricsPayload, _channelGroup?: string): string {
  const snaps = metrics.periodSnapshots;
  return `=== LONG-TERM BASELINES ===
${promptFmtSnap("Trailing 12M", snaps.trailing12m, snaps.prior12m)}

${promptFmtSnap("Trailing 36M (full baseline)", snaps.trailing36m)}

IMPORTANT: Use 36M baselines to determine whether current metrics represent structural shifts or normal cyclical fluctuation.

=== PRODUCT BREAKDOWN (YTD by loan_type) ===
${metrics.productBreakdown.length > 0
  ? metrics.productBreakdown.map(p =>
      `${p.productType}: ${p.active} active, ${p.completed} completed, ${p.funded} funded, ${p.fallenOut} fallen out (${p.withdrawn} withdrawn, ${p.denied} denied)\n` +
      `  PT: ${promptFmtPct(p.pullThroughRate)}  |  Fallout: ${promptFmtPct(p.falloutRate)}  |  Funded Vol: ${promptFmt$(p.fundedVolume)}\n` +
      `  High-risk credit loans: ${p.highRiskCreditCount}`
    ).join("\n\n")
  : "No product breakdown data available."
}

IMPORTANT: Use this data to identify which product types are underperforming. Compare pull-through rates across products. If a specific product (e.g. FHA, VA) has notably higher fallout or denial rates, call it out specifically. When citing the number of fallen-out loans, use the "fallen out" count (not just withdrawn + denied, as some loans have other terminal statuses).

=== RISK POCKET ANALYSIS (Product x FICO x DTI) ===
${metrics.riskCrossTab.deteriorating.length > 0
  ? `Top deteriorating risk pockets vs 36-month baseline:
${metrics.riskCrossTab.deteriorating.map(d =>
    `- ${d.product} / FICO ${d.ficoBand} / DTI ${d.dtiBand}: Fallout ${promptFmtPct(d.baselineFalloutRate)} -> ${promptFmtPct(d.currentFalloutRate)} (+${d.deltaPercent}pp), ${d.affectedLoans} loans affected`
  ).join("\n")}

IMPORTANT: These are the specific risk pockets where performance has worsened most vs the long-term baseline. Use these to generate precise diagnostic insights.`
  : "No significant deteriorating risk pockets detected vs 36-month baseline."
}

=== CONDITION BACKLOG (D2) ===
- Avg conditions per active loan: ${metrics.conditionBacklog.avgConditions}
- Loans with >10 outstanding conditions: ${metrics.conditionBacklog.highConditionCount}

=== BASELINES (for threshold comparison) ===
- Pull-Through YTD: ${promptFmtPct(snaps.ytd.pullThroughRate)}
- Pull-Through 90D Rolling: ${promptFmtPct(snaps.rolling90d.pullThroughRate)}
- Fallout YTD: ${promptFmtPct(snaps.ytd.falloutRate)}
- Cycle Time YTD: ${snaps.ytd.avgCycleTime} days
- Active Pipeline Size: ${metrics.pipeline.activeLoans} loans

DATA QUALITY AWARENESS:
- Active pipeline metrics above are based on current_loan_status = 'Active Loan' AND application_date IS NOT NULL. Loans without application_date are pre-excluded data artifacts — do not investigate or report on them.
- Even within this filtered set, many loans may be stale (application_date > 6 months old). When analyzing pipeline metrics (lock expirations, missing fields, exposure), consider whether the issue is a genuine pipeline risk or stale records that should be closed out in Encompass.
- If critical fields (lock dates, closing dates) are missing on a large % of genuinely active loans, consider whether those loans were ever truly locked or are early-stage applications that never progressed.`;
}

function buildPersonnelSections(metrics: InsightMetricsPayload, channelGroup?: string): string {
  const personnelLabel = channelGroup === "TPO" ? "Account Executives" : "Loan Officers";
  const fmt$ = promptFmt$;
  const fmtPct = promptFmtPct;

  const tieringBlock = metrics.tiering.byActorType.length > 0
    ? metrics.tiering.byActorType.map(t => {
        const topPct = t.totalActors > 0 ? Math.round((t.tierDistribution.top / t.totalActors) * 100) : 0;
        const bottomPct = t.totalActors > 0 ? Math.round((t.tierDistribution.bottom / t.totalActors) * 100) : 0;
        const fmtRev = (v: number) => `GOS ${fmt$(v)}`;
        const fmtVol = (v: number) => `Vol ${fmt$(v)}`;
        const metricLabel = (m: string): string => {
          switch (m) {
            case "revenue": return "GOS Rev";
            case "volume": return "Funded Vol";
            case "pullThrough": return "PT";
            case "revenueBps": return "BPS";
            case "cycleTime": return "Cycle";
            case "units": return "Units";
            default: return m;
          }
        };
        const fmtVal = (m: string, v: number) => {
          switch (m) {
            case "revenue": return fmtRev(v);
            case "volume": return fmtVol(v);
            case "pullThrough": return `${v}%`;
            case "revenueBps": return `${v} bps`;
            case "cycleTime": return `${v}d`;
            default: return String(v);
          }
        };

        const periodByName = new Map<string, typeof t.periodChanges>();
        if (t.periodChanges) {
          for (const c of t.periodChanges) {
            const existing = periodByName.get(c.name) || [];
            existing.push(c);
            periodByName.set(c.name, existing);
          }
        }

        const fmtOfficerFull = (p: typeof t.topPerformers[0]) => {
          const stats: string[] = [];
          if (p.revenue > 0) stats.push(fmtRev(p.revenue));
          if (p.units > 0) stats.push(`${p.units} units`);
          if (p.volume > 0) stats.push(fmtVol(p.volume));
          if (p.revenueBps > 0) stats.push(`${p.revenueBps} bps`);
          if (p.pullThrough > 0) stats.push(`PT ${p.pullThrough}%`);
          if (p.avgCycleTime > 0) stats.push(`${p.avgCycleTime}d cycle`);
          if (p.lostOpportunityUnits > 0) stats.push(`${p.lostOpportunityUnits} lost`);
          if (p.deniedUnits > 0) stats.push(`${p.deniedUnits} denied`);
          let line = `  - ${p.name} (YTD): ${stats.join(", ")}`;
          const changes = periodByName.get(p.name);
          if (changes && changes.length > 0) {
            const byWindow = new Map<string, typeof changes>();
            for (const c of changes) {
              const w = c.window || "60d";
              const arr = byWindow.get(w) || [];
              arr.push(c);
              byWindow.set(w, arr);
            }
            const windowParts: string[] = [];
            for (const [w, wc] of byWindow) {
              const wLabel = w === "30d" ? "30D" : w === "60d" ? "60D" : "90D";
              const parts = wc.map(c => `${metricLabel(c.metric)} ${fmtVal(c.metric, c.prior)}→${fmtVal(c.metric, c.current)} (${c.direction})`);
              windowParts.push(`${wLabel}: ${parts.join("; ")}`);
            }
            line += `\n    Period changes: ${windowParts.join(" | ")}`;
          } else {
            line += `\n    Period changes: (no notable changes across 30D/60D/90D windows)`;
          }
          return line;
        };

        const fmtTierAvg = (ta: typeof t.tierAverages.top) => {
          const parts: string[] = [];
          if (ta.avgRevenue > 0) parts.push(`avg GOS ${fmt$(ta.avgRevenue)}`);
          if (ta.avgUnits > 0) parts.push(`${ta.avgUnits} avg units`);
          if (ta.avgBps > 0) parts.push(`${ta.avgBps} avg bps`);
          if (ta.avgPullThrough > 0) parts.push(`${ta.avgPullThrough}% avg PT`);
          if (ta.avgCycleTime > 0) parts.push(`${ta.avgCycleTime}d avg cycle`);
          return parts.join(", ") || "(no data)";
        };

        const allOfficers = [...t.topPerformers, ...t.bottomPerformers];
        const byUnits = [...allOfficers].sort((a, b) => b.units - a.units).slice(0, 5);
        const byVolume = [...allOfficers].sort((a, b) => b.volume - a.volume).slice(0, 5);
        const byPT = [...allOfficers].filter(o => o.pullThrough > 0).sort((a, b) => b.pullThrough - a.pullThrough).slice(0, 5);

        let block = `--- ${t.actorLabel} (${t.totalActors} total) ---
Tier Distribution: Top: ${t.tierDistribution.top}, Second: ${t.tierDistribution.second}, Bottom: ${t.tierDistribution.bottom}

PRE-COMPUTED RANKINGS (use these — do NOT re-sort):
  BY GOS REVENUE (YTD): ${t.topPerformers.slice(0, 5).map((p, i) => `${i+1}. ${p.name} (${fmtRev(p.revenue)}, ${p.units} units)`).join(", ")}
  BY UNITS (YTD): ${byUnits.map((p, i) => `${i+1}. ${p.name} (${p.units} units, ${fmtRev(p.revenue)})`).join(", ")}
  BY FUNDED VOLUME (YTD): ${byVolume.map((p, i) => `${i+1}. ${p.name} (${fmtVol(p.volume)}, ${p.units} units)`).join(", ")}
  BY PULL-THROUGH (YTD): ${byPT.map((p, i) => `${i+1}. ${p.name} (${p.pullThrough}%, ${p.units} units)`).join(", ")}

Top Tier (${topPct}% of headcount, ≤50% cumulative revenue) — with inline period changes:
${t.topPerformers.map(fmtOfficerFull).join("\n")}

Bottom Tier (${bottomPct}% of headcount) — with inline period changes:
${t.bottomPerformers.map(fmtOfficerFull).join("\n")}

Tier Averages:
  Top: ${fmtTierAvg(t.tierAverages.top)}
  Second: ${fmtTierAvg(t.tierAverages.second)}
  Bottom: ${fmtTierAvg(t.tierAverages.bottom)}`;

        if (t.periodChanges && t.periodChanges.length > 0) {
          block += `

TREND ANALYSIS GUIDE: Compare each officer's period changes across 30D, 60D, 90D windows:
- ACCELERATING: Larger % change in shorter window (30D > 60D > 90D)
- SUSTAINED: Consistent direction across windows
- DECELERATING: Larger change only in longer window
- BLIP: Change in one window only
When prior-period base is small (revenue < $25K, units ≤ 2), report ABSOLUTE change — do NOT lead with percentage.`;
        }
        return block;
      }).join("\n\n")
    : "No tiering data available.";

  const aggregateBlock = metrics.tiering.byActorType.length > 0
    ? metrics.tiering.byActorType.filter(t => t.aggregateTrends).map(t => {
        const agg = t.aggregateTrends!;
        const parts: string[] = [];
        const ca = agg.companyAverages;
        parts.push(`Company-Wide Averages (${t.actorLabel}): avg GOS ${fmt$(ca.avgRevenue)}, ${ca.avgUnits} avg units, ${ca.avgBps} avg bps, ${ca.avgPullThrough}% avg PT, ${ca.avgCycleTime}d avg cycle`);
        parts.push(`Revenue Concentration: Top 3 ${personnelLabel} = ${agg.concentration.top3RevenueShare}% of total, Top 5 = ${agg.concentration.top5RevenueShare}%, Gini = ${agg.concentration.giniCoefficient}`);
        if (agg.headcountProductionGap.length > 0) {
          parts.push("Headcount vs Production Gap:");
          for (const gap of agg.headcountProductionGap) {
            const tierLabel = gap.tier === "top" ? "Top" : gap.tier === "second" ? "Second" : "Bottom";
            parts.push(`  ${tierLabel} tier: ${gap.headcountPct}% of headcount, ${gap.revenuePct}% of revenue, ${gap.unitsPct}% of units (gap: ${gap.gap > 0 ? "+" : ""}${gap.gap}pp)`);
          }
        }
        if (agg.tierTrends.length > 0) {
          parts.push("Tier-Level Trends (avg metrics by tier over time):");
          const byTier = new Map<string, typeof agg.tierTrends>();
          for (const trend of agg.tierTrends) {
            const arr = byTier.get(trend.tier) || [];
            arr.push(trend);
            byTier.set(trend.tier, arr);
          }
          for (const [tier, trends] of byTier) {
            const tierLabel = tier === "top" ? "Top" : tier === "second" ? "Second" : "Bottom";
            const trendStrs = trends.map(t => {
              const mLabel: Record<string, string> = { revenue: "GOS Rev", units: "Units", volume: "Vol", pullThrough: "PT", revenueBps: "BPS", cycleTime: "Cycle" };
              return `${mLabel[t.metric] || t.metric} ${t.priorAvg}→${t.currentAvg} (${t.direction} ${Math.abs(t.deltaPct)}%, ${t.window})`;
            });
            parts.push(`  ${tierLabel} tier: ${trendStrs.join("; ")}`);
          }
        } else {
          parts.push("Tier-Level Trends: No significant tier-level metric changes detected across 30D/60D/90D windows.");
        }
        if (agg.tierMigration && agg.tierMigration.length > 0) {
          const promoted = agg.tierMigration.filter(m => m.direction === "promoted");
          const demoted = agg.tierMigration.filter(m => m.direction === "demoted");
          parts.push(`Tier Migration (rolling 90D vs prior 90D): ${promoted.length} promoted, ${demoted.length} demoted`);
          if (promoted.length > 0) parts.push(`  Promoted: ${promoted.map(m => `${m.name} (${m.fromTier}→${m.toTier})`).join(", ")}`);
          if (demoted.length > 0) parts.push(`  Demoted: ${demoted.map(m => `${m.name} (${m.fromTier}→${m.toTier})`).join(", ")}`);
        } else {
          parts.push("Tier Migration: No tier changes detected (rolling 90D vs prior 90D).");
        }
        return parts.join("\n");
      }).join("\n\n")
    : "No aggregate personnel data available.";

  return `=== PERSONNEL TIERING (YTD, Revenue-Based Pareto Tiers: Top ≤50% cumulative rev, Second 50-80%, Bottom >80%) ===
CRITICAL: "GOS" = Gain-On-Sale revenue (fees + margin, typically $2K-$20K per loan). "Vol" = Total funded loan amounts (typically $200K-$800K per loan). GOS revenue is ~1-3% of volume. NEVER label a value in the millions as "revenue" for an individual officer — that is almost certainly "volume".
${tieringBlock}

=== AGGREGATE PERSONNEL TRENDS ===
${aggregateBlock}

IMPORTANT: Generate at least 2-3 AGGREGATE personnel insights (tier-level trends, concentration risk, headcount gap, migration patterns) in addition to individual-level personnel insights. Aggregate insights should NOT name specific officers — they describe patterns across tiers or the entire workforce.`;
}

function buildRiskComplianceSections(metrics: InsightMetricsPayload, _channelGroup?: string): string {
  return `=== FALLOUT PREDICTIONS (AI Model) ===
${(metrics.predictions.likelyWithdraw + metrics.predictions.likelyDeny + metrics.predictions.likelyOriginate) > 0
  ? `ALL predicted withdraw/deny (any confidence):
- Predicted Withdraw: ${metrics.predictions.likelyWithdraw} loans
- Predicted Deny: ${metrics.predictions.likelyDeny} loans
- Total at-risk loans: ${metrics.predictions.allAtRiskLoanIds.length}
- Total at-risk volume (all withdraw + deny): ${promptFmt$(metrics.predictions.allAtRiskVolume)}

HIGH-CONFIDENCE subset (>= 70% fallout probability only):
- High-confidence at-risk loans: ${metrics.predictions.highRiskLoans.length} loans
- High-confidence at-risk volume: ${promptFmt$(metrics.predictions.highRiskVolume)}
${metrics.predictions.highRiskLoans.length > 0
    ? `- Top Risk Factors: ${[...new Set(metrics.predictions.highRiskLoans.flatMap((l) => l.riskFactors))].slice(0, 5).join(", ")}`
    : ""}
- Predicted Originate: ${metrics.predictions.likelyOriginate} loans

IMPORTANT: Do NOT mix these two groups. If you cite the number of all withdraw/deny loans, use the "all" volume. If you cite the >70% subset, use the "high-confidence" volume.`
  : `NO PREDICTION DATA AVAILABLE — the prediction model has not generated predictions for the current active pipeline. Skip all prediction-related insights.`
}

=== PREDICTION SIGNAL ANALYSIS ===
${(metrics.predictions.likelyWithdraw + metrics.predictions.likelyDeny) > 0
  ? `${metrics.predictionSignals.withdrawalDrivers.length > 0
    ? `Withdrawal Risk Driver Distribution (${metrics.predictions.likelyWithdraw} loans):
${metrics.predictionSignals.withdrawalDrivers.map(d => `- ${d.driver}: ${d.count} loans, ${promptFmt$(d.volume)}`).join("\n")}`
    : "No withdrawal driver breakdown available."
  }

${metrics.predictionSignals.denialDrivers.length > 0
    ? `Denial Risk Driver Distribution (${metrics.predictions.likelyDeny} loans):
${metrics.predictionSignals.denialDrivers.map(d => `- ${d.driver}: ${d.count} loans, ${promptFmt$(d.volume)}`).join("\n")}`
    : "No denial driver breakdown available."
  }

Risk Score Distribution (all predicted loans):
- High risk (score >= 75): ${metrics.predictionSignals.riskScoreDistribution.high} loans
- Medium risk (score 50-74): ${metrics.predictionSignals.riskScoreDistribution.medium} loans
- Low risk (score < 50): ${metrics.predictionSignals.riskScoreDistribution.low} loans
- Avg Credit Risk Score: ${metrics.predictionSignals.avgCreditRiskScore}/100
- Avg Process Risk Score: ${metrics.predictionSignals.avgProcessRiskScore}/100
${metrics.predictionSignals.topRiskFactors.length > 0
    ? `\nMost Common Risk Factors (across all at-risk loans):
${metrics.predictionSignals.topRiskFactors.map(f => `- ${f.factor} (${f.count} loans)`).join("\n")}`
    : ""
  }

IMPORTANT: Use the driver distribution to explain WHY loans are at risk, not just how many.`
  : "No prediction signal data available — skip prediction-related insights."
}

=== CREDIT RISK PROFILE ===
- Weighted Avg FICO: ${Math.round(metrics.creditRisk.waFico)}
- Weighted Avg LTV: ${promptFmtPct(metrics.creditRisk.waLtv)}
- Weighted Avg DTI: ${promptFmtPct(metrics.creditRisk.waDti)}
- Loans meeting high-risk criteria (FICO<620 OR LTV>95% OR DTI>50%): ${metrics.creditRisk.highRiskLoanCount}
- High-risk credit loan volume: ${promptFmt$(metrics.creditRisk.highRiskVolume)}

=== CLOSING RISK (B3) ===
- Loans closing within 10 days without CTC: ${metrics.closingRisk.atRiskCount}
- At-risk closing volume: ${promptFmt$(metrics.closingRisk.atRiskVolume)}
- Avg days to close: ${metrics.closingRisk.avgDaysToClose}

${(metrics.closingRisk.closeLate.highProbCount > 0 || metrics.closingRisk.closeLate.mediumProbCount > 0)
  ? `Close-Late Probability (active loans with ECD):
- High probability (>70% likely late): ${metrics.closingRisk.closeLate.highProbCount} loans, ${promptFmt$(metrics.closingRisk.closeLate.highProbVolume)}
- Medium probability (40-70% likely late): ${metrics.closingRisk.closeLate.mediumProbCount} loans, ${promptFmt$(metrics.closingRisk.closeLate.mediumProbVolume)}
- Low probability (<40% likely late): ${metrics.closingRisk.closeLate.lowProbCount} loans, ${promptFmt$(metrics.closingRisk.closeLate.lowProbVolume)}
${metrics.closingRisk.closeLate.byStage.length > 0
  ? `\nBy Pipeline Stage (high-probability close-late subset):\n${metrics.closingRisk.closeLate.byStage.map(s =>
      `- ${s.stage}: ${s.count} loans, ${promptFmt$(s.volume)}, avg ${s.avgDaysToEcd} days to ECD`
    ).join("\n")}`
  : ""
}

IMPORTANT: Close-late probability data is more predictive than the simple "10 days without CTC" trigger above.`
  : "No close-late probability data available from prediction service."
}

=== LOCK EXPIRATION (C1) ===
- Locked loans expiring within 7 days without CTC: ${metrics.lockExpiration.expiringCount}
- Expiring volume: ${promptFmt$(metrics.lockExpiration.expiringVolume)}
- Avg days to expiry: ${metrics.lockExpiration.avgDaysToExpiry}

=== TRID EXPOSURE (G1) ===
- Loans closing within 5 days without CD sent: ${metrics.tridExposure.atRiskCount}
- Avg days to close: ${metrics.tridExposure.avgDaysToClose}

${buildFieldPopulationWarnings(metrics)}`;
}

/** Build field population warnings for the LLM prompt */
function buildFieldPopulationWarnings(metrics: InsightMetricsPayload): string {
  const fp = metrics.fieldPopulation;
  if (!fp || Object.keys(fp).length === 0) return "";

  const WARN_THRESHOLD = 40;
  const lowPopFields: Array<{ field: string; pct: number }> = [];
  const fieldLabels: Record<string, string> = {
    ctc_date: "CTC/Clear-to-Close Date",
    cd_sent_date: "Closing Disclosure Sent Date",
    estimated_closing_date: "Estimated Closing Date",
    lock_expiration_date: "Lock Expiration Date",
    closing_date: "Closing Date",
    underwriter: "Underwriter",
    processor: "Processor",
    conditional_approval_date: "Conditional Approval Date",
    uw_approval_date: "UW Approval Date",
  };

  for (const [field, pct] of Object.entries(fp)) {
    if (pct < WARN_THRESHOLD) {
      lowPopFields.push({ field, pct });
    }
  }

  if (lowPopFields.length === 0) return "";

  const warnings = lowPopFields
    .sort((a, b) => a.pct - b.pct)
    .map(({ field, pct }) => `- ${fieldLabels[field] || field}: ${pct}% populated`)
    .join("\n");

  return `=== FIELD POPULATION WARNINGS ===
The following fields have LOW population rates (<${WARN_THRESHOLD}%) for this lender:
${warnings}

CRITICAL RULES for low-population fields:
- DO NOT generate insights about CTC, closing risk, or lock expiration if ctc_date is below ${WARN_THRESHOLD}% populated — the data is unreliable.
- DO NOT generate insights about TRID compliance if cd_sent_date is below ${WARN_THRESHOLD}% populated.
- If a field is below ${WARN_THRESHOLD}%, it likely means this lender does not track that milestone. Insights referencing it are MISLEADING.
- You MAY generate ONE data-quality insight noting the low population itself (e.g., "CTC date only tracked for 22% of loans — closing risk monitoring is incomplete").`;
}

function buildVolumeTrendsSections(metrics: InsightMetricsPayload, _channelGroup?: string): string {
  const snaps = metrics.periodSnapshots;
  return `=== LONG-TERM BASELINES ===
${promptFmtSnap("Trailing 12M", snaps.trailing12m, snaps.prior12m)}

${promptFmtSnap("Trailing 36M (full baseline)", snaps.trailing36m)}

IMPORTANT: Use 36M baselines to determine whether current metrics represent structural shifts or normal cyclical fluctuation.

=== LOST OPPORTUNITY (YTD) ===
- Withdrawn Loans: ${metrics.lostOpportunity.withdrawnUnits}
- Withdrawn Volume: ${promptFmt$(metrics.lostOpportunity.withdrawnVolume)}
- Lost Proforma Revenue: ${promptFmt$(metrics.lostOpportunity.withdrawnProformaRevenue)}
- Denied Loans: ${metrics.lostOpportunity.deniedUnits}
- Denied Volume: ${promptFmt$(metrics.lostOpportunity.deniedVolume)}

=== MARGIN (C2) ===
- Current month avg gain-on-sale margin: ${metrics.marginData.currentMonthBps} bps
- Prior month avg gain-on-sale margin: ${metrics.marginData.priorMonthBps} bps
- Delta: ${metrics.marginData.deltaBps > 0 ? "+" : ""}${metrics.marginData.deltaBps} bps

=== BASELINES (for threshold comparison) ===
- Pull-Through YTD: ${promptFmtPct(snaps.ytd.pullThroughRate)}
- Pull-Through 90D Rolling: ${promptFmtPct(snaps.rolling90d.pullThroughRate)}
- Fallout YTD: ${promptFmtPct(snaps.ytd.falloutRate)}
- Cycle Time YTD: ${snaps.ytd.avgCycleTime} days
- Active Pipeline Size: ${metrics.pipeline.activeLoans} loans

DATA QUALITY AWARENESS:
- Active pipeline metrics above are based on current_loan_status = 'Active Loan' AND application_date IS NOT NULL. Loans without application_date are pre-excluded data artifacts — do not investigate or report on them.
- Even within this filtered set, many loans may be stale (application_date > 6 months old). Consider whether pipeline risk findings are driven by genuinely active loans or by stale records that should be withdrawn in Encompass.`;
}

/** Build a domain-specific prompt: shared context + domain sections. */
function buildDomainPrompt(domainId: InsightDomainId, metrics: InsightMetricsPayload, channelGroup?: string): string {
  const domainConfig = INSIGHT_DOMAINS.find(d => d.id === domainId)!;
  const shared = buildSharedContext(metrics, channelGroup);

  let domainSections: string;
  switch (domainId) {
    case "product_pipeline":
      domainSections = buildProductPipelineSections(metrics, channelGroup);
      break;
    case "personnel":
      domainSections = buildPersonnelSections(metrics, channelGroup);
      break;
    case "risk_compliance":
      domainSections = buildRiskComplianceSections(metrics, channelGroup);
      break;
    case "volume_trends":
      domainSections = buildVolumeTrendsSections(metrics, channelGroup);
      break;
  }

  return `Analyze these mortgage business metrics. Your focus domain is: ${domainConfig.label}.
Generate ${domainConfig.candidateTarget} high-quality insights specifically about ${domainConfig.label}.
Only output insights supported by the data below. If a metric is 0 or N/A, do not generate an insight about it.

${shared}

${domainSections}`;
}

/** Full metrics prompt (all domains combined). Used for audit logging and backward compat. */
function buildMetricsUserPrompt(metrics: InsightMetricsPayload, channelGroup?: string): string {
  const shared = buildSharedContext(metrics, channelGroup);
  const sections = [
    buildProductPipelineSections(metrics, channelGroup),
    buildPersonnelSections(metrics, channelGroup),
    buildRiskComplianceSections(metrics, channelGroup),
    buildVolumeTrendsSections(metrics, channelGroup),
  ].join("\n\n");

  return `Analyze these mortgage business metrics for your designated insight category.

${shared}

${sections}

Generate insights for your designated category now. Only output insights supported by this data. If a metric is 0 or N/A, do not generate an insight about it.`;
}

// ============================================================================
// OpenAI call
// ============================================================================

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    /** If provided, token usage is persisted to cost_events in the tenant DB. */
    tenantPool?: pg.Pool;
    tenantId?: string;
    requestedBy?: string;
  } = {}
): Promise<string> {
  const {
    model = process.env.INSIGHTS_MODEL || "gpt-5.4",
    temperature = 0.5,
    maxTokens = 4500,
    tenantPool,
    tenantId,
    requestedBy,
  } = options;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_completion_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as {
      error?: { message?: string };
    };
    throw new Error(
      `OpenAI API error: ${error.error?.message || response.statusText}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  // Fire-and-forget token tracking when tenant context is provided
  if (tenantPool && tenantId) {
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    if (promptTokens > 0 || completionTokens > 0) {
      logLLMUsage({
        tenantPool,
        tenantId,
        model,
        promptTokens,
        completionTokens,
        totalTokens: data.usage?.total_tokens,
        requestedBy,
      });
    }
  }

  return data.choices?.[0]?.message?.content || "";
}

// ============================================================================
// [REMOVED] buildDetailFilters, normalizeSource, VALID_SOURCES, SOURCE_ALIASES
// Replaced by Pass 4 evidence generation in the evidence redesign.
// ============================================================================

// (Legacy code removed: buildDetailFilters, buildDetailFiltersForRiskCrossTab,
//  VALID_SOURCES, SOURCE_ALIASES, normalizeSource — ~370 lines)
// Replaced by LLM-generated evidence_table in Pass 4.

// ============================================================================
// Topic fingerprint for fuzzy deduplication
// ============================================================================

/**
 * Extract a topic fingerprint from a headline for fuzzy dedup.
 * Returns a set of key tokens: numbers, tier names, metric types, timeframes.
 * Two headlines with >70% fingerprint overlap are considered near-duplicates.
 */
function getTopicFingerprint(headline: string): Set<string> {
  const tokens = new Set<string>();
  // Extract all numbers (amounts, percentages, counts)
  for (const m of headline.matchAll(/\$?[\d,.]+[MKBmkb%]?/g)) tokens.add(m[0]);
  // Extract key entities (tier names)
  for (const m of headline.matchAll(/\b(top|second|bottom)\s+tier\b/gi)) tokens.add(m[0].toLowerCase());
  // Extract metric/topic keywords
  for (const m of headline.matchAll(
    /\b(pull-through|fallout|funded|pipeline|migration|demotion|promotion|revenue|volume|active|headcount|composition)\b/gi
  )) tokens.add(m[0].toLowerCase());
  // Extract timeframe references
  for (const m of headline.matchAll(/\b(YTD|MTD|30D|60D|90D|12M|trailing|rolling)\b/gi)) tokens.add(m[0].toLowerCase());
  return tokens;
}

// ============================================================================
// Parse LLM responses for each pipeline stage
// ============================================================================

interface GeneratorCandidate {
  headline: string;
  understory: string;
  reasoning_chain: string;
  sentiment: "positive" | "warning" | "critical" | "neutral";
  insight_type: string;
  source: string;
  severity_score: number;
  cited_numbers: string[];
  domains_covered: string[];
  impact: { type: string | null; estimated_dollars: number | null; units_affected: number | null };
  evidence: { metrics: string[]; comparisons: string[] };
  for_podcast: boolean;
  detail_columns?: string[];
  summary_metrics?: string[];
  sourceDomain?: InsightDomainId;
  // ETM fields
  what_changed?: string;
  why?: string;
  business_impact?: string;
  risk_if_ignored?: string;
  recommended_action?: string;
  owner?: string;
}

interface JudgeEvaluation {
  insight_index: number;
  factual_grounding: number;
  actionability: number;
  non_obviousness: number;
  sentiment_accuracy: number;
  overall_score: number;
  issues: string[];
  keep: boolean;
}

function parseGeneratorResponse(responseText: string): GeneratorCandidate[] {
  try {
    const parsed = JSON.parse(responseText);
    if (!parsed.insights || !Array.isArray(parsed.insights)) {
      console.error("[Pipeline] Generator response missing insights array");
      return [];
    }
    const validSentiments = ["positive", "warning", "critical", "neutral"];
    return parsed.insights.map((ins: any) => ({
      headline: String(ins.headline || ""),
      understory: String(ins.understory || ""),
      reasoning_chain: String(ins.reasoning_chain || ""),
      sentiment: validSentiments.includes(ins.sentiment) ? ins.sentiment : "neutral",
      insight_type: String(ins.insight_type || ins.type || "info"),
      source: String(ins.source || "performance"),
      severity_score: Math.min(1, Math.max(0, parseFloat(ins.severity_score) || 0.5)),
      cited_numbers: Array.isArray(ins.cited_numbers) ? ins.cited_numbers : [],
      domains_covered: Array.isArray(ins.domains_covered) ? ins.domains_covered : [],
      impact: {
        type: ins.impact?.type || null,
        estimated_dollars: ins.impact?.estimated_dollars ?? null,
        units_affected: ins.impact?.units_affected ?? null,
      },
      evidence: {
        metrics: Array.isArray(ins.evidence?.metrics) ? ins.evidence.metrics : [],
        comparisons: Array.isArray(ins.evidence?.comparisons) ? ins.evidence.comparisons : [],
      },
      for_podcast: ins.for_podcast !== false,
      detail_columns: Array.isArray(ins.detail_columns) ? ins.detail_columns : undefined,
      summary_metrics: Array.isArray(ins.summary_metrics) ? ins.summary_metrics : undefined,
      // ETM fields
      what_changed: ins.what_changed || undefined,
      why: ins.why || undefined,
      business_impact: ins.business_impact || undefined,
      risk_if_ignored: ins.risk_if_ignored || undefined,
      recommended_action: ins.recommended_action || undefined,
      owner: ins.owner || undefined,
    }));
  } catch (error) {
    console.error("[Pipeline] Failed to parse generator response:", error);
    return [];
  }
}

function parseJudgeResponse(responseText: string): JudgeEvaluation[] {
  try {
    const parsed = JSON.parse(responseText);
    if (!parsed.evaluations || !Array.isArray(parsed.evaluations)) {
      console.error("[Pipeline] Judge response missing evaluations array");
      return [];
    }
    return parsed.evaluations.map((ev: any) => ({
      insight_index: ev.insight_index ?? 0,
      factual_grounding: ev.factual_grounding ?? 5,
      actionability: ev.actionability ?? 5,
      non_obviousness: ev.non_obviousness ?? 5,
      sentiment_accuracy: ev.sentiment_accuracy ?? 5,
      overall_score: ev.overall_score ?? 5,
      issues: Array.isArray(ev.issues) ? ev.issues : [],
      keep: ev.keep !== false,
    }));
  } catch (error) {
    console.error("[Pipeline] Failed to parse judge response:", error);
    return [];
  }
}

function parseCuratorResponse(responseText: string): CategorizedInsight[] {
  try {
    const parsed = JSON.parse(responseText);
    if (!parsed.insights || !Array.isArray(parsed.insights)) {
      console.error("[Pipeline] Curator response missing insights array");
      return [];
    }
    return parsed.insights.map((ins: any) => {
      const sentiment = ins.sentiment || "neutral";
      const mapping = SENTIMENT_TO_BUCKET[sentiment] || SENTIMENT_TO_BUCKET["neutral"];
      return {
        bucket: mapping.bucket,
        priority: mapping.priority,
        headline: String(ins.headline || ""),
        understory: String(ins.understory || ""),
        insight_type: String(ins.insight_type || ins.type || "info"),
        source: String(ins.source || "performance"),
        severity_score: Math.min(1, Math.max(0, parseFloat(ins.severity_score) || 0.5)),
        impact: {
          type: ins.impact?.type || null,
          estimated_dollars: ins.impact?.estimated_dollars ?? null,
          units_affected: ins.impact?.units_affected ?? null,
        },
        evidence: {
          metrics: Array.isArray(ins.evidence?.metrics) ? ins.evidence.metrics : [],
          comparisons: Array.isArray(ins.evidence?.comparisons) ? ins.evidence.comparisons : [],
        },
        for_podcast: ins.for_podcast !== false,
        // ETM fields
        what_changed: ins.what_changed || undefined,
        why: ins.why || undefined,
        business_impact: ins.business_impact || undefined,
        risk_if_ignored: ins.risk_if_ignored || undefined,
        recommended_action: ins.recommended_action || undefined,
        owner: ins.owner || undefined,
      };
    });
  } catch (error) {
    console.error("[Pipeline] Failed to parse curator response:", error);
    return [];
  }
}

// ============================================================================
// Parse Pass 4: Evidence Response
// ============================================================================

interface ParsedEvidence {
  insight_index: number;
  title: string;
  columns: EvidenceColumnDef[];
  rows: Array<Record<string, any>>;
  summary: EvidenceSummaryDef[];
  loan_ids?: string[] | null;
}

function parseEvidenceResponse(responseText: string): ParsedEvidence[] {
  try {
    const parsed = JSON.parse(responseText);
    const evidenceArray = parsed.evidence || parsed.evidences || [];
    if (!Array.isArray(evidenceArray)) {
      console.error("[Pipeline] Evidence response missing evidence array");
      return [];
    }
    const validFormats = ["text", "currency", "percent", "number", "date", "rate", "days", "mono", "badge", "bps"];
    const validAligns = ["left", "right", "center"];
    const validColors = ["blue", "green", "red", "amber", "purple"];
    const validSummaryFormats = ["number", "currency", "percent", "days", "bps"];

    return evidenceArray.map((ev: any) => ({
      insight_index: ev.insight_index ?? 0,
      title: String(ev.title || "Evidence"),
      columns: Array.isArray(ev.columns) ? ev.columns.map((col: any) => ({
        key: String(col.key || ""),
        label: String(col.label || col.key || ""),
        format: validFormats.includes(col.format) ? col.format : "text",
        align: validAligns.includes(col.align) ? col.align : "left",
      })) : [],
      rows: Array.isArray(ev.rows) ? ev.rows : [],
      summary: Array.isArray(ev.summary) ? ev.summary.map((s: any) => ({
        key: String(s.key || ""),
        label: String(s.label || s.key || ""),
        value: s.value ?? 0,
        format: validSummaryFormats.includes(s.format) ? s.format : "number",
        color: validColors.includes(s.color) ? s.color : "blue",
      })) : [],
      loan_ids: Array.isArray(ev.loan_ids) ? ev.loan_ids.map(String) : null,
    }));
  } catch (error) {
    console.error("[Pipeline] Failed to parse evidence response:", error);
    return [];
  }
}

// ============================================================================
// Evidence Agent — SQL-backed evidence (1 agent per insight, full parallel)
// ============================================================================

/** Sanitize LLM-generated SQL: fix common Postgres pitfalls. */
function sanitizeEvidenceSQL(sql: string): string {
  let s = sql.trim();
  // Fix INTERVAL 'N quarters' → 'N*3 months'
  s = s.replace(/INTERVAL\s*'(\d+)\s*quarters?'/gi, (_, num) => `INTERVAL '${parseInt(num) * 3} months'`);
  s = s.replace(/INTERVAL\s*'1\s*quarter'/gi, `INTERVAL '3 months'`);
  // Fix double-quoted intervals → single-quoted
  s = s.replace(/INTERVAL\s*"([^"]+)"/gi, `INTERVAL '$1'`);
  // Fix ROUND(::float, n) → ROUND(::numeric, n)
  s = s.replace(/::float\b/gi, "::numeric");
  s = s.replace(/::double precision\b/gi, "::numeric");
  // Collapse whitespace
  s = s.replace(/\s{2,}/g, " ");
  return s.trim();
}

/** Validate that a SQL string is a safe SELECT query (WITH CTEs are allowed). */
function validateEvidenceSQL(sql: string): void {
  const upper = sql.trim().toUpperCase();
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    throw new Error("Evidence SQL must be a SELECT or WITH...SELECT query");
  }
  const forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE", "ALTER", "CREATE", "GRANT", "REVOKE"];
  for (const kw of forbidden) {
    if (upper.includes(kw + " ") || upper.includes(kw + "\n") || upper.includes(kw + "\t")) {
      throw new Error(`Evidence SQL contains forbidden keyword: ${kw}`);
    }
  }
}

/** Parse the single-insight evidence agent response. */
function parseAgentEvidenceResponse(responseText: string): {
  title: string;
  sql: string;
  columns: EvidenceColumnDef[];
  summary: EvidenceSummaryDef[];
  comparisonSql?: string;
  comparisonSummary?: EvidenceSummaryDef[];
  comparisonLabel?: string;
  currentLabel?: string;
} | null {
  try {
    const parsed = JSON.parse(responseText);
    if (!parsed.sql || !parsed.columns) {
      console.warn("[EvidenceAgent] Response missing sql or columns");
      return null;
    }
    const validFormats = ["text", "currency", "percent", "number", "date", "rate", "days", "mono", "badge", "bps"];
    const validAligns = ["left", "right", "center"];
    const validColors = ["blue", "green", "red", "amber", "purple"];
    const validSummaryFormats = ["number", "currency", "percent", "days", "bps"];

    const parseSummary = (arr: any[]) => arr.map((s: any) => {
      let value: number | string = s.value ?? 0;
      if (typeof value === "string") {
        // Preserve COMPUTE_* directives as strings — they'll be resolved after SQL execution
        if (value.startsWith("COMPUTE_")) {
          // keep as-is
        } else {
          value = parseFloat(value) || 0;
        }
      }
      return {
        key: String(s.key || ""),
        label: String(s.label || s.key || ""),
        value,
        format: validSummaryFormats.includes(s.format) ? s.format : "number" as const,
        color: validColors.includes(s.color) ? s.color : "blue" as const,
      };
    });

    const result: ReturnType<typeof parseAgentEvidenceResponse> = {
      title: String(parsed.title || "Evidence"),
      sql: String(parsed.sql),
      columns: Array.isArray(parsed.columns) ? parsed.columns.map((col: any) => ({
        key: String(col.key || ""),
        label: String(col.label || col.key || ""),
        format: validFormats.includes(col.format) ? col.format : "text",
        align: validAligns.includes(col.align) ? col.align : "left",
      })) : [],
      summary: Array.isArray(parsed.summary) ? parseSummary(parsed.summary) : [],
    };

    if (parsed.is_comparison && parsed.comparison_sql) {
      result.comparisonSql = String(parsed.comparison_sql);
      result.comparisonLabel = String(parsed.comparison_label || "Prior Period");
      result.currentLabel = String(parsed.current_label || "Current Period");
      result.comparisonSummary = Array.isArray(parsed.comparison_summary)
        ? parseSummary(parsed.comparison_summary)
        : [];
    }

    return result;
  } catch (err) {
    console.error("[EvidenceAgent] Failed to parse response:", err);
    return null;
  }
}


/**
 * Resolve COMPUTE_* directives in summary defs using actual SQL result rows.
 * Literal numeric values pass through unchanged.
 */
function resolveSummaryValues(
  summaryDefs: EvidenceSummaryDef[],
  rows: Array<Record<string, any>>,
): EvidenceSummaryDef[] {
  if (rows.length === 0) return summaryDefs;
  return summaryDefs.map(sd => {
    if (typeof sd.value !== "string" || !sd.value.startsWith("COMPUTE_")) return sd;

    const [directive, column] = sd.value.split(":");
    const vals = column ? rows.map(r => parseFloat(r[column]) || 0) : [];
    let computed = 0;

    switch (directive) {
      case "COMPUTE_SUM":
        computed = vals.reduce((a, b) => a + b, 0);
        break;
      case "COMPUTE_AVG":
        computed = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        break;
      case "COMPUTE_COUNT":
        computed = column ? vals.filter(v => v !== 0).length : rows.length;
        break;
      case "COMPUTE_MAX":
        computed = vals.length ? Math.max(...vals) : 0;
        break;
      case "COMPUTE_MIN":
        computed = vals.length ? Math.min(...vals) : 0;
        break;
      default:
        computed = rows.length;
    }

    return { ...sd, value: Math.round(computed * 100) / 100 };
  });
}

/**
 * Post-resolution validation: fix KPIs whose values should match the actual row count.
 *
 * The LLM sometimes outputs a literal number that comes from the metrics payload rather
 * than the SQL results. When the evidence SQL returns a different number of rows, the
 * KPI and detail table are visually inconsistent, destroying trust.
 *
 * IMPORTANT: We intentionally avoid matching broad patterns like "total.?loans" because
 * the evidence SQL often returns a SUBSET of loans (e.g. only fallen-out loans). A KPI
 * like "Total FHA Loans" refers to ALL FHA loans in the population, not just the rows
 * returned by the query. Overwriting it with rows.length would be incorrect.
 *
 * We only correct KPIs that unambiguously represent a count of the rows in the table:
 * - Generic row-count labels (total_count, loan_count, rows)
 * - Subset-specific labels that match the evidence table's purpose (fallen out, withdrawn, denied, at risk, etc.)
 *
 * Returns { corrected, corrections } so callers can capture audit data.
 */
function validateSummaryAgainstRows(
  summaryDefs: EvidenceSummaryDef[],
  rows: Array<Record<string, any>>,
): { corrected: EvidenceSummaryDef[]; corrections: Array<{ key: string; label: string; from: number; to: number; reason: string }> } {
  const corrections: Array<{ key: string; label: string; from: number; to: number; reason: string }> = [];

  if (rows.length === 0) return { corrected: summaryDefs, corrections };

  // Narrow patterns: only KPIs that unambiguously equal the total row count
  const genericRowCountPatterns = /^(total.?count|loan.?count|total.?applications|total.?loans|total.?high.?risk.?loans|total.?officers|rows|total$)/i;

  // Subset-specific patterns: KPIs that count the specific subset the evidence table lists
  const subsetCountPatterns = /loans?.?fallen.?out|fall.?out.?count|fallen.?out|withdrawn.?count|withdrawn.?loans|denied.?count|denied.?loans|at.?risk.?count|at.?risk.?loans|expiring.?count|expiring.?loans|close.?late.?count|flagged.?count|flagged.?loans|trid.?exposure|cd.?not.?sent/i;

  const corrected = summaryDefs.map(sd => {
    const matchesGeneric = genericRowCountPatterns.test(sd.key) || genericRowCountPatterns.test(sd.label);
    const matchesSubset = subsetCountPatterns.test(sd.key) || subsetCountPatterns.test(sd.label);

    if (!matchesGeneric && !matchesSubset) return sd;

    const numVal = typeof sd.value === "number" ? sd.value : parseFloat(String(sd.value));
    if (isNaN(numVal)) return sd;

    if (numVal !== rows.length) {
      const reason = matchesGeneric ? "generic row count mismatch" : "subset count mismatch with evidence rows";
      console.log(
        `[EvidenceAgent] Correcting summary KPI "${sd.label}" (key=${sd.key}): ${numVal} → ${rows.length} (${reason})`,
      );
      corrections.push({ key: sd.key, label: sd.label, from: numVal, to: rows.length, reason });
      return { ...sd, value: rows.length };
    }
    return sd;
  });

  return { corrected, corrections };
}

// ============================================================================
// Evidence Coherence Validator — deterministic post-hoc KPI correction
// ============================================================================

type LoanStatusClass = "funded" | "withdrawn" | "denied" | "active" | "other_terminal";

/** Classify a current_loan_status string into a canonical category. */
function classifyLoanStatus(status: string): LoanStatusClass {
  const s = (status || "").toLowerCase().trim();
  if (/originat|purchased/.test(s)) return "funded";
  if (/withdraw|cancel|not accepted|incomplete/.test(s)) return "withdrawn";
  if (/denied|declined/.test(s)) return "denied";
  if (/^active loan$|^active$|^locked$|^submitted$|^approved$/.test(s)) return "active";
  return "other_terminal";
}

/**
 * Semantic coherence validator: inspects actual row data (loan statuses, amounts)
 * and corrects KPIs that contradict what the rows actually contain.
 *
 * Catches cases like:
 *  - "Originated Loans: 200" when the table contains 0 originated loans
 *  - "Pull-Through Rate: 62.3%" when the table only shows withdrawn loans
 *  - "Total Volume: $47M" when it should be the sum of loan_amount in the rows
 */
function validateEvidenceCoherence(
  summaryDefs: EvidenceSummaryDef[],
  rows: Array<Record<string, any>>,
): { corrected: EvidenceSummaryDef[]; corrections: Array<{ key: string; label: string; from: number; to: number; reason: string }> } {
  const corrections: Array<{ key: string; label: string; from: number; to: number; reason: string }> = [];
  if (rows.length === 0) return { corrected: summaryDefs, corrections };

  // Find the status column — evidence agents use various names
  const statusCol = Object.keys(rows[0]).find(k =>
    /^(current_loan_status|loan_status|status)$/i.test(k)
  );
  const amountCol = Object.keys(rows[0]).find(k =>
    /^(loan_amount|amount|total_amount)$/i.test(k)
  );

  // If no status column, we can't do semantic validation
  if (!statusCol) return { corrected: summaryDefs, corrections };

  // Classify every row
  const counts: Record<LoanStatusClass, number> = { funded: 0, withdrawn: 0, denied: 0, active: 0, other_terminal: 0 };
  let totalAmount = 0;
  let fundedAmount = 0;
  const falloutClasses: LoanStatusClass[] = ["withdrawn", "denied", "other_terminal"];

  for (const row of rows) {
    const cls = classifyLoanStatus(String(row[statusCol] || ""));
    counts[cls]++;
    const amt = amountCol ? (parseFloat(row[amountCol]) || 0) : 0;
    totalAmount += amt;
    if (cls === "funded") fundedAmount += amt;
  }

  const totalRows = rows.length;
  const fundedCount = counts.funded;
  const falloutCount = counts.withdrawn + counts.denied + counts.other_terminal;
  const isFalloutTable = falloutCount > totalRows * 0.8 && fundedCount < totalRows * 0.2;
  const isFundedTable = fundedCount > totalRows * 0.8;

  // Regex patterns for KPI label/key matching
  const originatedPattern = /originat|funded.?loan|funded.?count/i;
  const completedPattern = /complet/i;
  const withdrawnPattern = /withdraw/i;
  const deniedPattern = /denied|declined/i;
  const fallenOutPattern = /fall.?out|fallen.?out/i;
  const ptRatePattern = /pull.?through/i;
  const falloutRatePattern = /fall.?out.?rate/i;
  const totalVolumePattern = /total.?volume|loan.?volume/i;
  const fundedVolumePattern = /funded.?volume|originat.?volume/i;

  const corrected = summaryDefs.map(sd => {
    const label = (sd.label || "").toLowerCase();
    const key = (sd.key || "").toLowerCase();
    const combined = `${key} ${label}`;
    const numVal = typeof sd.value === "number" ? sd.value : parseFloat(String(sd.value));
    if (isNaN(numVal)) return sd;

    // --- Originated/Funded Loans count ---
    if (originatedPattern.test(combined)) {
      if (numVal !== fundedCount) {
        corrections.push({ key: sd.key, label: sd.label, from: numVal, to: fundedCount, reason: `originated count: ${fundedCount} rows have Originated/Purchased status` });
        return { ...sd, value: fundedCount };
      }
      return sd;
    }

    // --- Completed Loans count ---
    if (completedPattern.test(combined) && !ptRatePattern.test(combined) && !falloutRatePattern.test(combined)) {
      // "Completed" = funded + all fallout (non-active terminal)
      const completedInRows = fundedCount + falloutCount;
      if (numVal !== completedInRows && completedInRows > 0) {
        corrections.push({ key: sd.key, label: sd.label, from: numVal, to: completedInRows, reason: `completed count recomputed from row statuses (${fundedCount} funded + ${falloutCount} fallout)` });
        return { ...sd, value: completedInRows };
      }
      return sd;
    }

    // --- Withdrawn Loans count ---
    if (withdrawnPattern.test(combined) && !fallenOutPattern.test(combined) && sd.format === "number") {
      if (numVal !== counts.withdrawn) {
        corrections.push({ key: sd.key, label: sd.label, from: numVal, to: counts.withdrawn, reason: `withdrawn count: ${counts.withdrawn} rows have withdrawn status` });
        return { ...sd, value: counts.withdrawn };
      }
      return sd;
    }

    // --- Denied Loans count ---
    if (deniedPattern.test(combined) && sd.format === "number") {
      if (numVal !== counts.denied) {
        corrections.push({ key: sd.key, label: sd.label, from: numVal, to: counts.denied, reason: `denied count: ${counts.denied} rows have denied status` });
        return { ...sd, value: counts.denied };
      }
      return sd;
    }

    // --- Fallen Out count ---
    if (fallenOutPattern.test(combined) && sd.format === "number") {
      if (numVal !== falloutCount) {
        corrections.push({ key: sd.key, label: sd.label, from: numVal, to: falloutCount, reason: `fallen out count: ${falloutCount} non-funded terminal rows` });
        return { ...sd, value: falloutCount };
      }
      return sd;
    }

    // --- Pull-Through Rate ---
    if (ptRatePattern.test(combined) && sd.format === "percent") {
      // If the evidence table is a subset (only funded or only fallout loans),
      // the LLM-provided rate is population-level — don't overwrite it from the subset
      if (isFalloutTable || isFundedTable) return sd;

      const completedInRows = fundedCount + falloutCount;
      if (completedInRows > 0) {
        const correctPT = Math.round((fundedCount / completedInRows) * 1000) / 10;
        if (Math.abs(numVal - correctPT) > 0.5) {
          corrections.push({ key: sd.key, label: sd.label, from: numVal, to: correctPT, reason: `PT recomputed: ${fundedCount}/${completedInRows} from row statuses` });
          return { ...sd, value: correctPT };
        }
      }
      return sd;
    }

    // --- Fallout Rate ---
    if (falloutRatePattern.test(combined) && sd.format === "percent") {
      // If the evidence table is a subset (only fallout or only funded loans),
      // the LLM-provided rate is population-level — don't overwrite it from the subset
      if (isFalloutTable || isFundedTable) return sd;

      const completedInRows = fundedCount + falloutCount;
      if (completedInRows > 0) {
        const correctFallout = Math.round((falloutCount / completedInRows) * 1000) / 10;
        if (Math.abs(numVal - correctFallout) > 0.5) {
          corrections.push({ key: sd.key, label: sd.label, from: numVal, to: correctFallout, reason: `fallout rate recomputed: ${falloutCount}/${completedInRows} from row statuses` });
          return { ...sd, value: correctFallout };
        }
      }
      return sd;
    }

    // --- Total Volume (sum of loan_amount from all rows) ---
    if (totalVolumePattern.test(combined) && sd.format === "currency" && amountCol) {
      const rounded = Math.round(totalAmount * 100) / 100;
      if (Math.abs(numVal - rounded) > 1) {
        corrections.push({ key: sd.key, label: sd.label, from: numVal, to: rounded, reason: `total volume re-summed from ${totalRows} rows` });
        return { ...sd, value: rounded };
      }
      return sd;
    }

    // --- Funded Volume (sum of loan_amount from funded rows only) ---
    if (fundedVolumePattern.test(combined) && sd.format === "currency" && amountCol) {
      const rounded = Math.round(fundedAmount * 100) / 100;
      if (Math.abs(numVal - rounded) > 1) {
        corrections.push({ key: sd.key, label: sd.label, from: numVal, to: rounded, reason: `funded volume re-summed from ${fundedCount} funded rows` });
        return { ...sd, value: rounded };
      }
      return sd;
    }

    return sd;
  });

  if (corrections.length > 0) {
    insightLog(`[EvidenceCoherence] Fixed ${corrections.length} KPI(s): ${corrections.map(c => `"${c.label}" ${c.from}→${c.to}`).join(", ")}`);
  }

  return { corrected, corrections };
}

// ============================================================================
// Post-Evidence Quality Gate
// ============================================================================

/** Normalize a key/label to a canonical form for fuzzy matching: lowercase, strip non-alpha, collapse whitespace. */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Fuzzy-find the best matching column in `rowKeys` for a KPI key/label.
 * Tries: exact match → normalized match → token-overlap match → substring containment.
 */
function fuzzyMatchColumn(kpiKey: string, kpiLabel: string, rowKeys: string[]): string | null {
  const nKey = normalizeForMatch(kpiKey);
  const nLabel = normalizeForMatch(kpiLabel);

  // 1. Exact case-insensitive
  const exact = rowKeys.find(k => k.toLowerCase() === kpiKey.toLowerCase());
  if (exact) return exact;

  // 2. Normalized match (strips underscores, camelCase → words)
  for (const col of rowKeys) {
    const nCol = normalizeForMatch(col);
    if (nCol === nKey || nCol === nLabel) return col;
  }

  // 3. Token overlap — if the KPI label and column share 2+ meaningful tokens
  const labelTokens = nLabel.split(" ").filter(t => t.length > 2);
  if (labelTokens.length >= 2) {
    let bestCol: string | null = null;
    let bestOverlap = 0;
    for (const col of rowKeys) {
      const colTokens = normalizeForMatch(col).split(" ").filter(t => t.length > 2);
      const overlap = labelTokens.filter(t => colTokens.includes(t)).length;
      if (overlap > bestOverlap && overlap >= 2) {
        bestOverlap = overlap;
        bestCol = col;
      }
    }
    if (bestCol) return bestCol;
  }

  // 4. Substring containment — column name fully contains KPI key or vice versa
  for (const col of rowKeys) {
    const nCol = normalizeForMatch(col);
    if (nCol.length >= 3 && (nKey.includes(nCol) || nCol.includes(nKey))) return col;
    if (nCol.length >= 3 && (nLabel.includes(nCol) || nCol.includes(nLabel))) return col;
  }

  return null;
}

/** Check if a KPI value is null/zero/NaN/empty. */
function isNullKpiValue(val: number | string | null | undefined): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "string" && (val === "-" || val === "" || val === "NaN")) return true;
  if (typeof val === "number" && (isNaN(val) || val === 0)) return true;
  return false;
}

/**
 * Post-evidence quality gate: fixes null/zero KPIs via fuzzy column matching,
 * detects thin detail tables, and computes an overall evidence quality score.
 *
 * Called after each evidence agent returns, before audit merge.
 */
function validateEvidenceQuality(
  evidence: EvidenceTable,
  insight: CategorizedInsight,
): EvidenceTable {
  const issues: string[] = [];
  const rows = evidence.rows;
  const summary = [...evidence.summary];

  // ── A. Fix null/zero KPIs by computing from rows (fuzzy matching) ──
  if (rows.length > 0 && summary.length > 0) {
    const rowKeys = Object.keys(rows[0]);

    for (let i = 0; i < summary.length; i++) {
      const kpi = summary[i];
      if (!isNullKpiValue(kpi.value)) continue;

      // Fuzzy-find a matching column
      const matchingCol = fuzzyMatchColumn(kpi.key, kpi.label, rowKeys);
      if (!matchingCol) {
        // No column match — try a format-based fallback for count KPIs
        if (kpi.format === "number" && /count|total|officers?|loans/i.test(kpi.label)) {
          insightLog(`[EvidenceQuality] Fixed null KPI "${kpi.label}": set to row count ${rows.length}`);
          issues.push(`Fixed null KPI "${kpi.label}": set to row count ${rows.length}`);
          summary[i] = { ...kpi, value: rows.length };
        }
        continue;
      }

      const colValues = rows.map(r => parseFloat(r[matchingCol])).filter(v => !isNaN(v));
      if (colValues.length === 0) continue;

      let computed: number | null = null;
      const isAvg = /avg|average|mean/i.test(kpi.key) || /avg|average|mean/i.test(kpi.label);

      if (isAvg) {
        computed = colValues.reduce((a, b) => a + b, 0) / colValues.length;
      } else if (kpi.format === "currency" || /volume|revenue|amount/i.test(kpi.label)) {
        computed = colValues.reduce((a, b) => a + b, 0);
      } else if (kpi.format === "percent") {
        computed = colValues.reduce((a, b) => a + b, 0) / colValues.length;
      } else if (kpi.format === "number") {
        if (/count/i.test(kpi.label)) {
          computed = rows.length;
        } else {
          computed = colValues.reduce((a, b) => a + b, 0);
        }
      } else {
        computed = colValues.reduce((a, b) => a + b, 0);
      }

      if (computed !== null && !isNaN(computed)) {
        const rounded = Math.round(computed * 100) / 100;
        insightLog(`[EvidenceQuality] Fixed null KPI "${kpi.label}" (key=${kpi.key}→col=${matchingCol}): ${kpi.value} → ${rounded} (from ${colValues.length} rows)`);
        issues.push(`Fixed null KPI "${kpi.label}": computed ${rounded} from column "${matchingCol}" (${colValues.length} rows)`);
        summary[i] = { ...kpi, value: rounded };
      }
    }
  }

  // ── B. Detect thin detail tables for group/personnel insights ──
  const personnelPattern = /\b(tier|officers?|loan.?officers?|account.?executives?|performers?|personnel|workforce)\b/i;
  const isPersonnelInsight = personnelPattern.test(insight.headline) || personnelPattern.test(insight.understory || "");

  if (isPersonnelInsight && rows.length < 2) {
    const msg = `Thin detail: personnel insight "${insight.headline.substring(0, 50)}..." has only ${rows.length} row(s) — expected per-officer breakdown`;
    issues.push(msg);
    insightLogWarn(`[EvidenceQuality] ${msg}`);
  }

  if (rows.length === 0) {
    issues.push("Evidence table has 0 rows — SQL may have returned no data");
  }

  // ── B1b. Detect bogus 100% pull-through for all personnel rows ──
  // When PT is calculated from funding-cohort only, all values = 100%. Flag this.
  if (isPersonnelInsight && rows.length >= 2) {
    const ptColKey = Object.keys(rows[0]).find(k => /pull.?through/i.test(k));
    if (ptColKey) {
      const ptVals = rows.map(r => parseFloat(r[ptColKey])).filter(v => !isNaN(v));
      const allPT100 = ptVals.length > 0 && ptVals.every(v => v >= 99.9);
      if (allPT100) {
        const msg = `All ${ptVals.length} officers show ~100% pull-through — likely computed from funding cohort instead of application cohort. PT values are unreliable.`;
        issues.push(msg);
        insightLogWarn(`[EvidenceQuality] ${msg}`);
        // Remove the misleading PT from summary KPIs
        for (let i = summary.length - 1; i >= 0; i--) {
          if (/pull.?through/i.test(summary[i].key) || /pull.?through/i.test(summary[i].label)) {
            insightLog(`[EvidenceQuality] Removing misleading PT summary KPI: "${summary[i].label}"`);
            summary.splice(i, 1);
          }
        }
      }
    }
  }

  // ── B1c. Remove fabricated summary KPIs that have no basis in the evidence columns ──
  if (rows.length > 0 && summary.length > 0) {
    const rowKeys = new Set(Object.keys(rows[0]).map(k => k.toLowerCase()));
    const fabricatedKpiPattern = /\b(revenue.?impact|productivity.?loss|morale.?impact|estimated.?loss|potential.?loss|opportunity.?cost)\b/i;
    for (let i = summary.length - 1; i >= 0; i--) {
      const kpi = summary[i];
      const kpiText = `${kpi.key} ${kpi.label}`;
      if (fabricatedKpiPattern.test(kpiText)) {
        // Check if there's a matching column in the evidence rows
        const hasColumn = rowKeys.has(kpi.key.toLowerCase()) ||
          [...rowKeys].some(k => k.includes(kpi.key.toLowerCase().replace(/[^a-z0-9]/g, "_")));
        if (!hasColumn && typeof kpi.value === "number" && !String(kpi.value).startsWith("COMPUTE")) {
          insightLogWarn(`[EvidenceQuality] Removing fabricated KPI "${kpi.label}" (value=${kpi.value}) — not derivable from evidence columns`);
          issues.push(`Removed fabricated KPI "${kpi.label}" — not derivable from evidence`);
          summary.splice(i, 1);
        }
      }
    }
  }

  // ── B2. Outlier-aware KPI recalculation ──
  // If any summary KPI is an average of a known field (DTI, FICO, LTV) and the value
  // is clearly out of valid range, recalculate excluding outlier rows.
  if (rows.length > 0 && summary.length > 0) {
    const outlierRanges: Array<{ colPattern: RegExp; kpiPattern: RegExp; min: number; max: number; label: string }> = [
      { colPattern: /^(dti|dti_ratio|avg_dti|average_dti)$/i, kpiPattern: /dti/i, min: 0, max: 65, label: "DTI" },
      { colPattern: /^(fico|fico_score|avg_fico|average_fico|credit_score)$/i, kpiPattern: /fico|credit.?score/i, min: 300, max: 850, label: "FICO" },
      { colPattern: /^(ltv|ltv_ratio|avg_ltv|average_ltv|loan_to_value)$/i, kpiPattern: /ltv|loan.?to.?value/i, min: 0, max: 105, label: "LTV" },
    ];

    const rowKeys = Object.keys(rows[0]);

    for (const range of outlierRanges) {
      const matchingCol = rowKeys.find(k => range.colPattern.test(k));
      if (!matchingCol) continue;

      const allVals = rows.map(r => parseFloat(r[matchingCol])).filter(v => !isNaN(v));
      const validVals = allVals.filter(v => v >= range.min && v <= range.max);
      const outlierCount = allVals.length - validVals.length;

      if (outlierCount > 0 && validVals.length > 0) {
        const cleanAvg = Math.round((validVals.reduce((a, b) => a + b, 0) / validVals.length) * 100) / 100;
        const dirtyAvg = allVals.length > 0 ? allVals.reduce((a, b) => a + b, 0) / allVals.length : 0;

        // Fix any summary KPI referencing this field
        for (let i = 0; i < summary.length; i++) {
          const kpi = summary[i];
          const kpiCombined = `${kpi.key} ${kpi.label}`;
          if (!range.kpiPattern.test(kpiCombined)) continue;
          const kpiVal = typeof kpi.value === "number" ? kpi.value : parseFloat(String(kpi.value));
          if (isNaN(kpiVal)) continue;

          // If the KPI value looks like it includes outliers (close to dirty avg or obviously out of range)
          if (kpiVal > range.max || Math.abs(kpiVal - dirtyAvg) < Math.abs(kpiVal - cleanAvg)) {
            insightLog(`[EvidenceQuality] Outlier correction for "${kpi.label}": ${kpiVal} → ${cleanAvg} (excluded ${outlierCount} rows outside ${range.label} range [${range.min}-${range.max}])`);
            issues.push(`Outlier correction: "${kpi.label}" ${kpiVal} → ${cleanAvg} (${outlierCount} rows had ${range.label} outside [${range.min}-${range.max}])`);
            summary[i] = { ...kpi, value: cleanAvg };
          }
        }
      }
    }
  }

  // ── C. Compute quality score (0-100) ──
  let score = 100;

  const nullKpis = summary.filter(kpi => isNullKpiValue(kpi.value));
  score -= nullKpis.length * 15;

  if (rows.length === 0) score -= 40;
  else if (rows.length < 3) score -= 10;

  if (evidence.columns.length < 5) score -= 10;
  else if (evidence.columns.length < 8) score -= 5;

  if (isPersonnelInsight && rows.length < 2) score -= 20;

  // Penalize 100% PT (computed from funding cohort — always wrong). Heavy penalty to trigger retry.
  if (isPersonnelInsight && rows.length >= 2) {
    const ptColKey = Object.keys(rows[0]).find(k => /pull.?through/i.test(k));
    if (ptColKey) {
      const ptVals = rows.map(r => parseFloat(r[ptColKey])).filter(v => !isNaN(v));
      if (ptVals.length > 0 && ptVals.every(v => v >= 99.9)) {
        score -= 55;
      }
    }
  }

  if (summary.length < 3) score -= 10;

  score = Math.max(0, Math.min(100, score));

  if (issues.length > 0) {
    insightLog(`[EvidenceQuality] Score: ${score}/100 for "${insight.headline.substring(0, 50)}..." — ${issues.length} issue(s)`);
  }

  // Attach quality info to audit
  if (evidence.audit) {
    evidence.audit.evidenceQualityScore = score;
    evidence.audit.qualityIssues = issues;
  }

  return { ...evidence, summary };
}

/**
 * Build tier context for an insight that references tiers/headcount/composition.
 * Returns a string to inject into the evidence agent user prompt, or empty string if not relevant.
 */
function buildTierContextForInsight(
  insight: CategorizedInsight,
  metricsPayload?: InsightMetricsPayload,
): string {
  if (!metricsPayload) return "";

  const tierPattern = /\b(tier|headcount|composition|revenue.?contribut|production.?gap|demot|promot|migrat)\b/i;
  const headline = insight.headline || "";
  const understory = insight.understory || "";
  if (!tierPattern.test(headline) && !tierPattern.test(understory)) return "";

  const loGroup = metricsPayload.tiering.byActorType.find(t => t.actorType === "loan_officer");
  if (!loGroup?.tierOfficerNames) return "";

  const { top, second, bottom } = loGroup.tierOfficerNames;
  const parts: string[] = [
    `TIER OFFICER LISTS (Pareto revenue tiers — use these for filtering):`,
    `  Top Tier (${top.length} officers, <=50% cumulative revenue): ${top.join(", ")}`,
    `  Second Tier (${second.length} officers, 50-80% cumulative revenue): ${second.join(", ")}`,
    `  Bottom Tier (${bottom.length} officers, >80% cumulative revenue): ${bottom.join(", ")}`,
  ];

  // Detect which tier the insight is about
  const headlineLower = headline.toLowerCase();
  const understoryLower = understory.toLowerCase();
  const combinedLower = `${headlineLower} ${understoryLower}`;

  if (combinedLower.includes("demot")) {
    const migrations = loGroup.aggregateTrends?.tierMigration || [];
    const demoted = migrations.filter(m => m.direction === "demoted");
    if (demoted.length > 0) {
      parts.push(`\nThis insight is about DEMOTED officers. ${demoted.length} officer(s) were demoted (rolling 90D vs prior 90D):`);
      for (const m of demoted) {
        parts.push(`  - ${m.name}: ${m.fromTier} -> ${m.toTier}`);
      }
      const names = demoted.map(m => m.name);
      parts.push(`Filter to these officers: ${names.join(", ")}`);
      parts.push(`Use: WHERE officer_name IN (${names.map(n => `'${n.replace(/'/g, "''")}'`).join(", ")})`);
      parts.push(`Include columns: officer_name, tier (current), prior_tier, funded_units, revenue, volume, pull_through_rate, cycle_time`);
    }
  } else if (combinedLower.includes("promot")) {
    const migrations = loGroup.aggregateTrends?.tierMigration || [];
    const promoted = migrations.filter(m => m.direction === "promoted");
    if (promoted.length > 0) {
      parts.push(`\nThis insight is about PROMOTED officers. ${promoted.length} officer(s) were promoted (rolling 90D vs prior 90D):`);
      for (const m of promoted) {
        parts.push(`  - ${m.name}: ${m.fromTier} -> ${m.toTier}`);
      }
      const names = promoted.map(m => m.name);
      parts.push(`Filter to these officers: ${names.join(", ")}`);
      parts.push(`Use: WHERE officer_name IN (${names.map(n => `'${n.replace(/'/g, "''")}'`).join(", ")})`);
      parts.push(`Include columns: officer_name, tier (current), prior_tier, funded_units, revenue, volume, pull_through_rate, cycle_time`);
    }
  } else if (combinedLower.includes("migrat")) {
    const migrations = loGroup.aggregateTrends?.tierMigration || [];
    if (migrations.length > 0) {
      const promoted = migrations.filter(m => m.direction === "promoted");
      const demoted = migrations.filter(m => m.direction === "demoted");
      parts.push(`\nThis insight is about TIER MIGRATION. ${migrations.length} officer(s) changed tiers (rolling 90D vs prior 90D):`);
      if (promoted.length > 0) {
        parts.push(`  Promoted (${promoted.length}):`);
        for (const m of promoted) parts.push(`    - ${m.name}: ${m.fromTier} -> ${m.toTier}`);
      }
      if (demoted.length > 0) {
        parts.push(`  Demoted (${demoted.length}):`);
        for (const m of demoted) parts.push(`    - ${m.name}: ${m.fromTier} -> ${m.toTier}`);
      }
      const names = migrations.map(m => m.name);
      parts.push(`Filter to these officers: ${names.join(", ")}`);
      parts.push(`Use: WHERE officer_name IN (${names.map(n => `'${n.replace(/'/g, "''")}'`).join(", ")})`);
      parts.push(`Include columns: officer_name, tier (current), prior_tier, direction (promoted/demoted), funded_units, revenue, volume, pull_through_rate`);
    }
  } else if (headlineLower.includes("bottom tier")) {
    parts.push(`\nThis insight is about the BOTTOM TIER. Filter to these officers: ${bottom.join(", ")}`);
    parts.push(`Use: WHERE officer_name IN (${bottom.map(n => `'${n.replace(/'/g, "''")}'`).join(", ")})`);
  } else if (headlineLower.includes("top tier")) {
    parts.push(`\nThis insight is about the TOP TIER. Filter to these officers: ${top.join(", ")}`);
    parts.push(`Use: WHERE officer_name IN (${top.map(n => `'${n.replace(/'/g, "''")}'`).join(", ")})`);
  } else if (headlineLower.includes("second tier")) {
    parts.push(`\nThis insight is about the SECOND TIER. Filter to these officers: ${second.join(", ")}`);
    parts.push(`Use: WHERE officer_name IN (${second.map(n => `'${n.replace(/'/g, "''")}'`).join(", ")})`);
  }

  return parts.join("\n");
}

/**
 * Run a single evidence agent for ONE insight. Generates SQL, executes it, and returns the evidence table.
 */
async function runEvidenceAgentForInsight(
  insight: CategorizedInsight,
  insightIndex: number,
  schemaContext: string,
  tenantPool: pg.Pool,
  apiKey: string,
  agentConfig: { model: string; temperature: number; maxTokens: number; systemPrompt: string; tenantRevenueExpr: string; dateRangesContext: string; metricDefinitions: string },
  dateContext: string,
  tierContext?: string,
): Promise<EvidenceTable | null> {
  const t0Agent = Date.now();
  const { model, temperature, maxTokens, systemPrompt, tenantRevenueExpr, dateRangesContext, metricDefinitions } = agentConfig;

  const defaultRevenueExpr = "COALESCE(CASE WHEN l.rate_lock_buy_side_base_price_rate IS NOT NULL AND l.rate_lock_buy_side_base_price_rate != 0 THEN ROUND(((l.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * l.loan_amount, 2) ELSE 0 END, 0) + COALESCE(l.orig_fee_borr_pd, 0) + COALESCE(l.orig_fees_seller, 0) - COALESCE(l.cd_lender_credits, 0)";

  // Build the system prompt with schema context, revenue expression, and date ranges injected
  const system = systemPrompt
    .replace("{{LOAN_SCHEMA_CONTEXT}}", schemaContext)
    .replace(/\{\{TENANT_REVENUE_EXPRESSION\}\}/g, tenantRevenueExpr || defaultRevenueExpr)
    .replace("{{DATE_RANGES}}", dateRangesContext);

  // Build the user prompt with this one insight + canonical metric definitions
  const userPromptObj: Record<string, any> = {
    insight: {
      headline: insight.headline,
      understory: insight.understory,
      source: insight.source,
      sentiment: insight.insight_type,
      impact: insight.impact,
    },
    date_context: dateContext,
    metric_definitions: metricDefinitions,
  };
  if (tierContext) {
    userPromptObj.tier_officers = tierContext;
  }
  const userPrompt = JSON.stringify(userPromptObj);

  // First attempt
  let response: string;
  try {
    response = await callOpenAI(system, userPrompt, apiKey, { model, temperature, maxTokens });
  } catch (err: any) {
    insightLogWarn(`[EvidenceAgent] LLM call failed for insight ${insightIndex} ("${insight.headline.substring(0, 60)}"): ${err.message}`);
    return null;
  }

  const parsed = parseAgentEvidenceResponse(response);
  if (!parsed) {
    insightLogWarn(`[EvidenceAgent] Failed to parse response for insight ${insightIndex} ("${insight.headline.substring(0, 60)}")`);
    return null;
  }

  // Sanitize and validate the SQL
  let sql = sanitizeEvidenceSQL(parsed.sql);
  try {
    validateEvidenceSQL(sql);
  } catch (err: any) {
    insightLogWarn(`[EvidenceAgent] SQL validation failed for insight ${insightIndex} ("${insight.headline.substring(0, 60)}"): ${err.message}`);
    return null;
  }

  // Execute the SQL — with one retry on failure
  let rows: Array<Record<string, any>> = [];
  let sqlExecStart = Date.now();
  try {
    const result = await tenantPool.query(sql);
    rows = result.rows;
    if (rows.length === 0) {
      insightLogWarn(`[EvidenceAgent] SQL returned 0 rows for insight ${insightIndex} ("${insight.headline.substring(0, 60)}"). SQL:\n${sql}`);
    } else {
      insightLog(`[EvidenceAgent] SQL returned ${rows.length} rows for insight ${insightIndex} ("${insight.headline.substring(0, 60)}")`);
    }
  } catch (execErr: any) {
    insightLogWarn(`[EvidenceAgent] SQL execution FAILED for insight ${insightIndex} ("${insight.headline.substring(0, 60)}"): ${execErr.message}\nSQL:\n${sql}`);

    // Retry: send the error back to the LLM for correction
    const retryUserPrompt = JSON.stringify({
      insight: {
        headline: insight.headline,
        understory: insight.understory,
        source: insight.source,
        sentiment: insight.insight_type,
        impact: insight.impact,
      },
      date_context: dateContext,
      metric_definitions: metricDefinitions,
      previous_sql: sql,
      error: execErr.message,
      instruction: "The previous SQL query failed with the above error. Fix the SQL and return the corrected output.",
    });

    try {
      const retryResponse = await callOpenAI(system, retryUserPrompt, apiKey, { model, temperature, maxTokens });
      const retryParsed = parseAgentEvidenceResponse(retryResponse);
      if (!retryParsed) {
        insightLogWarn(`[EvidenceAgent] Retry parse failed for insight ${insightIndex} ("${insight.headline.substring(0, 60)}")`);
        return null;
      }

      sql = sanitizeEvidenceSQL(retryParsed.sql);
      validateEvidenceSQL(sql);
      const retryResult = await tenantPool.query(sql);
      rows = retryResult.rows;

      // Use retried columns/summary/comparison if they changed
      parsed.columns = retryParsed.columns;
      parsed.summary = retryParsed.summary;
      parsed.title = retryParsed.title;
      parsed.comparisonSql = retryParsed.comparisonSql;
      parsed.comparisonSummary = retryParsed.comparisonSummary;
      parsed.comparisonLabel = retryParsed.comparisonLabel;
      parsed.currentLabel = retryParsed.currentLabel;
    } catch (retryErr: any) {
      insightLogWarn(`[EvidenceAgent] Retry also failed for insight ${insightIndex} ("${insight.headline.substring(0, 60)}"): ${retryErr.message}`);
      return null;
    }
  }

  // Execute comparison SQL if this is a period-comparison insight
  let comparison: EvidenceTable["comparison"] = null;
  if (parsed.comparisonSql) {
    try {
      let compSql = sanitizeEvidenceSQL(parsed.comparisonSql);
      validateEvidenceSQL(compSql);
      const compResult = await tenantPool.query(compSql);
      comparison = {
        label: parsed.comparisonLabel || "Prior Period",
        currentLabel: parsed.currentLabel || "Current Period",
        rows: compResult.rows.slice(0, 200),
        summary: parsed.comparisonSummary || [],
      };
      insightLog(`[EvidenceAgent] Comparison query returned ${compResult.rows.length} rows for insight ${insightIndex}`);
    } catch (compErr: any) {
      insightLogWarn(`[EvidenceAgent] Comparison SQL failed for insight ${insightIndex}: ${compErr.message}`);
    }
  }

  // Resolve any COMPUTE_* directives in summary values using actual rows
  const rawSummary = JSON.parse(JSON.stringify(parsed.summary)) as EvidenceSummaryDef[];
  const afterResolve = resolveSummaryValues(parsed.summary, rows);
  const resolvedSummarySnapshot = JSON.parse(JSON.stringify(afterResolve)) as EvidenceSummaryDef[];
  const { corrected: rowCorrectedSummary, corrections } = validateSummaryAgainstRows(afterResolve, rows);

  // Coherence pass: deterministically recompute KPIs from actual row statuses/amounts
  const { corrected: finalSummary, corrections: coherenceCorrections } = validateEvidenceCoherence(rowCorrectedSummary, rows);
  const allCorrections = [...corrections, ...coherenceCorrections];

  const compResult = comparison?.summary
    ? (() => {
        const { corrected: compRowCorrected, corrections: compCorr } = validateSummaryAgainstRows(
          resolveSummaryValues(comparison.summary, comparison.rows),
          comparison.rows,
        );
        const { corrected: compFinal } = validateEvidenceCoherence(compRowCorrected, comparison.rows);
        return { corrected: compFinal, corrections: compCorr };
      })()
    : undefined;

  // Build audit trail for data provenance
  const audit: EvidenceAudit = {
    generatedSql: sql,
    rowCount: rows.length,
    rawSummary,
    resolvedSummary: resolvedSummarySnapshot,
    finalSummary: JSON.parse(JSON.stringify(finalSummary)) as EvidenceSummaryDef[],
    corrections: allCorrections,
    comparisonSql: parsed.comparisonSql || undefined,
    comparisonRowCount: comparison?.rows.length,
    sqlExecutionMs: Date.now() - sqlExecStart,
    totalMs: Date.now() - t0Agent,
  };

  return {
    title: parsed.title,
    columns: parsed.columns,
    rows: rows.slice(0, 200),
    summary: finalSummary,
    loan_ids: null,
    comparison: comparison ? {
      ...comparison,
      summary: compResult?.corrected || comparison.summary,
    } : null,
    audit,
  };
}

/**
 * Build a quality feedback string describing what went wrong with the previous evidence attempt,
 * so the LLM can correct it on retry.
 */
function buildQualityFeedback(prev: EvidenceTable, insight: CategorizedInsight): string {
  const parts: string[] = [];
  const qi = prev.audit?.qualityIssues || [];

  if (prev.rows.length === 0) {
    parts.push("CRITICAL: Your previous SQL returned 0 rows. The query likely had overly restrictive filters or incorrect date ranges. Relax the WHERE clause and verify column names against the schema.");
  }

  const nullKpis = prev.summary.filter(kpi => isNullKpiValue(kpi.value));
  if (nullKpis.length > 0) {
    parts.push(`${nullKpis.length} summary KPIs have null/zero values: ${nullKpis.map(k => `"${k.label}" (key=${k.key})`).join(", ")}. Use COMPUTE_SUM, COMPUTE_AVG, or COMPUTE_COUNT directives referencing actual SQL column aliases so the system can calculate them from your query results.`);
  }

  const personnelPattern = /\b(tier|officers?|loan.?officers?|account.?executives?|performers?|personnel|workforce)\b/i;
  const tierCompositionPattern = /\b(tier.?composition|headcount|revenue.?contribut|production.?gap|bottom.?tier|top.?tier|second.?tier)\b/i;
  const tierMigrationPattern = /\b(demot|promot|migrat|tier.?change|tier.?movement)\b/i;
  const isPersonnel = personnelPattern.test(insight.headline) || personnelPattern.test(insight.understory || "");
  const isTierComposition = tierCompositionPattern.test(insight.headline) || tierCompositionPattern.test(insight.understory || "");
  const isTierMigration = tierMigrationPattern.test(insight.headline) || tierMigrationPattern.test(insight.understory || "");

  if (isTierMigration) {
    parts.push(
      "This is a TIER MIGRATION (demotion/promotion) insight. You MUST:\n" +
      "1. Use the tier_officers context to get the specific officer names who were demoted/promoted\n" +
      "2. Filter with WHERE officer_name IN (...) using those exact names\n" +
      "3. Join public.employees e ON e.id::TEXT = l.loan_officer_id to get officer_name\n" +
      "4. GROUP BY individual officer — return per-officer rows with their metrics\n" +
      "5. Include columns: officer_name, current_tier, prior_tier, funded_units, revenue, volume, pull_through_rate, cycle_time\n" +
      "6. Use the DUAL-CTE pattern: funded_stats (scoped by funding_date) for units/revenue/volume, pt_stats (scoped by application_date) for pull-through rate\n" +
      "7. Set is_comparison: true with comparison_sql for the prior period\n" +
      "8. NEVER include speculative KPIs like 'Revenue Impact' or 'Productivity Loss' — use COMPUTE_* directives only"
    );
  } else if (isTierComposition) {
    parts.push(
      "This is a TIER COMPOSITION / HEADCOUNT GAP insight. You MUST use the Pareto CTE pattern to assign tiers:\n" +
      "1. Use a CTE that computes per-officer revenue, then calculates cumulative_pct using SUM(...) OVER (ORDER BY total_revenue DESC)\n" +
      "2. Assign tiers: Top (<=50% cumulative), Second (50-80%), Bottom (>80%)\n" +
      "3. Filter to the relevant tier in the outer query\n" +
      "4. Include a 'tier' column in the output\n" +
      "5. GROUP BY individual officer — return per-officer rows with their metrics\n" +
      "6. If tier_officers context is provided, use the officer names directly with WHERE officer_name IN (...)"
    );
  } else if (isPersonnel && prev.rows.length < 3) {
    parts.push("This is a PERSONNEL/TIERING insight. You MUST GROUP BY individual officer and return per-officer rows (one row per loan officer). Join public.employees e ON e.id::TEXT = l.loan_officer_id. NEVER return a single aggregate row.");
  }

  if (prev.columns.length < 8) {
    parts.push(`Only ${prev.columns.length} columns were generated. Include at least 8-12 columns for a comprehensive view.`);
  }

  // Detect 100% PT issue — all officers showing ~100% pull-through means PT was computed from funding cohort only
  if (isPersonnel && prev.rows.length >= 2) {
    const ptColKey = Object.keys(prev.rows[0]).find(k => /pull.?through/i.test(k));
    if (ptColKey) {
      const ptVals = prev.rows.map(r => parseFloat(r[ptColKey])).filter(v => !isNaN(v));
      const allPT100 = ptVals.length > 0 && ptVals.every(v => v >= 99.9);
      if (allPT100) {
        parts.push(
          "CRITICAL BUG: All officers show ~100% pull-through rate. This means PT was calculated from the FUNDING cohort (WHERE funding_date ...) which only contains funded/originated loans — PT is ALWAYS 100% by definition.\n" +
          "FIX: Use the DUAL-CTE pattern from the instructions:\n" +
          "  1. funded_stats CTE: scoped by funding_date for units, revenue, volume, cycle_time\n" +
          "  2. pt_stats CTE: scoped by APPLICATION_DATE for pull_through_rate (originated / completed from the application cohort)\n" +
          "  3. LEFT JOIN pt_stats ON officer_name to get the correct PT rate per officer"
        );
      }
    }
  }

  if (qi.length > 0) {
    parts.push(`Quality issues from previous attempt: ${qi.join("; ")}`);
  }

  parts.push(`Previous SQL (DO NOT reuse if it failed): ${prev.audit?.generatedSql || "(not available)"}`);

  return parts.join("\n\n");
}

/**
 * Run an evidence agent retry for a single insight, injecting quality feedback from the prior attempt.
 */
async function runEvidenceAgentWithFeedback(
  insight: CategorizedInsight,
  insightIndex: number,
  schemaContext: string,
  tenantPool: pg.Pool,
  apiKey: string,
  agentConfig: { model: string; temperature: number; maxTokens: number; systemPrompt: string; tenantRevenueExpr: string; dateRangesContext: string; metricDefinitions: string },
  dateContext: string,
  qualityFeedback: string,
  tierContext?: string,
): Promise<EvidenceTable | null> {
  const t0 = Date.now();
  const { model, temperature, maxTokens, systemPrompt, tenantRevenueExpr, dateRangesContext, metricDefinitions } = agentConfig;
  const defaultRevenueExpr = "COALESCE(CASE WHEN l.rate_lock_buy_side_base_price_rate IS NOT NULL AND l.rate_lock_buy_side_base_price_rate != 0 THEN ROUND(((l.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * l.loan_amount, 2) ELSE 0 END, 0) + COALESCE(l.orig_fee_borr_pd, 0) + COALESCE(l.orig_fees_seller, 0) - COALESCE(l.cd_lender_credits, 0)";

  const system = systemPrompt
    .replace("{{LOAN_SCHEMA_CONTEXT}}", schemaContext)
    .replace(/\{\{TENANT_REVENUE_EXPRESSION\}\}/g, tenantRevenueExpr || defaultRevenueExpr)
    .replace("{{DATE_RANGES}}", dateRangesContext);

  const retryPromptObj: Record<string, any> = {
    insight: {
      headline: insight.headline,
      understory: insight.understory,
      source: insight.source,
      sentiment: insight.insight_type,
      impact: insight.impact,
    },
    date_context: dateContext,
    metric_definitions: metricDefinitions,
    quality_feedback: qualityFeedback,
    instruction: "Your previous evidence generation attempt had quality issues (described above). Fix ALL of the listed issues. Generate improved SQL, columns, and summary KPIs.",
  };
  if (tierContext) {
    retryPromptObj.tier_officers = tierContext;
  }
  const userPrompt = JSON.stringify(retryPromptObj);

  let response: string;
  try {
    response = await callOpenAI(system, userPrompt, apiKey, { model, temperature, maxTokens });
  } catch (err: any) {
    insightLogWarn(`[EvidenceAgent:Retry] LLM call failed for insight ${insightIndex}: ${err.message}`);
    return null;
  }

  const parsed = parseAgentEvidenceResponse(response);
  if (!parsed) {
    insightLogWarn(`[EvidenceAgent:Retry] Failed to parse retry response for insight ${insightIndex}`);
    return null;
  }

  let sql = sanitizeEvidenceSQL(parsed.sql);
  try { validateEvidenceSQL(sql); } catch { return null; }

  let rows: Array<Record<string, any>> = [];
  const sqlExecStart = Date.now();
  try {
    const result = await tenantPool.query(sql);
    rows = result.rows;
  } catch (err: any) {
    insightLogWarn(`[EvidenceAgent:Retry] SQL execution failed for insight ${insightIndex}: ${err.message}`);
    return null;
  }

  // Execute comparison SQL if present
  let comparison: EvidenceTable["comparison"] = null;
  if (parsed.comparisonSql) {
    try {
      let compSql = sanitizeEvidenceSQL(parsed.comparisonSql);
      validateEvidenceSQL(compSql);
      const compResult = await tenantPool.query(compSql);
      comparison = {
        label: parsed.comparisonLabel || "Prior Period",
        currentLabel: parsed.currentLabel || "Current Period",
        rows: compResult.rows.slice(0, 200),
        summary: parsed.comparisonSummary || [],
      };
    } catch {}
  }

  const rawSummary = JSON.parse(JSON.stringify(parsed.summary)) as EvidenceSummaryDef[];
  const afterResolve = resolveSummaryValues(parsed.summary, rows);
  const resolvedSummarySnapshot = JSON.parse(JSON.stringify(afterResolve)) as EvidenceSummaryDef[];
  const { corrected: rowCorrectedSummary, corrections } = validateSummaryAgainstRows(afterResolve, rows);
  const { corrected: finalSummary, corrections: coherenceCorrections } = validateEvidenceCoherence(rowCorrectedSummary, rows);
  const allCorrections = [...corrections, ...coherenceCorrections];

  const compResult = comparison?.summary
    ? (() => {
        const { corrected: compRowCorrected, corrections: compCorr } = validateSummaryAgainstRows(
          resolveSummaryValues(comparison.summary, comparison.rows),
          comparison.rows,
        );
        const { corrected: compFinal } = validateEvidenceCoherence(compRowCorrected, comparison.rows);
        return { corrected: compFinal, corrections: compCorr };
      })()
    : undefined;

  const audit: EvidenceAudit = {
    generatedSql: sql,
    rowCount: rows.length,
    rawSummary,
    resolvedSummary: resolvedSummarySnapshot,
    finalSummary: JSON.parse(JSON.stringify(finalSummary)) as EvidenceSummaryDef[],
    corrections: allCorrections,
    comparisonSql: parsed.comparisonSql || undefined,
    comparisonRowCount: comparison?.rows.length,
    sqlExecutionMs: Date.now() - sqlExecStart,
    totalMs: Date.now() - t0,
  };

  return {
    title: parsed.title,
    columns: parsed.columns,
    rows: rows.slice(0, 200),
    summary: finalSummary,
    loan_ids: null,
    comparison: comparison ? { ...comparison, summary: compResult?.corrected || comparison.summary } : null,
    audit,
  };
}

/**
 * Orchestrate evidence generation for all insights in full parallel.
 * Loads schema context once, then fans out 1 agent per insight via Promise.allSettled.
 * Includes a quality retry pass for failed or low-quality evidence.
 */
async function runAllEvidenceAgents(
  insights: CategorizedInsight[],
  tenantPool: pg.Pool,
  tenantId: string | undefined,
  apiKey: string,
  dateFilter: string,
  metricsPayload?: InsightMetricsPayload,
): Promise<void> {
  if (insights.length === 0) return;

  const t0 = Date.now();

  // Load schema context once (cached per tenant for 1 hour)
  let schemaContext = "";
  try {
    schemaContext = await getSchemaForTenant(tenantId || "default");
  } catch (err: any) {
    insightLogError(`[EvidenceAgent] Failed to load schema context: ${err.message}`);
    return;
  }

  // Load tenant revenue expression so the evidence agent uses the exact same formula as metrics
  let tenantRevenueExpr = "";
  try {
    tenantRevenueExpr = await getTenantRevenueExpression(tenantPool, "l");
    insightLog(`[EvidenceAgent] Revenue expression loaded (${tenantRevenueExpr.length} chars)`);
  } catch (err: any) {
    insightLogWarn(`[EvidenceAgent] Failed to load tenant revenue expression: ${err.message}`);
  }

  // Load prompt config once
  let systemPrompt = "";
  let model = process.env.INSIGHTS_MODEL || "gpt-5.4";
  let temperature = 0.1;
  let maxTokens = 4000;

  try {
    const config = await getPromptConfig("insights.evidence_agent");
    systemPrompt = config.system_prompt + VIZ_STANDARDS_MEDIUM;
    model = config.model || model;
    temperature = config.temperature ?? temperature;
    maxTokens = config.max_tokens || maxTokens;
  } catch {
    console.warn("[EvidenceAgent] Prompt config 'insights.evidence_agent' not found, skipping.");
    return;
  }

  if (!systemPrompt) {
    console.warn("[EvidenceAgent] Empty system prompt, skipping evidence generation.");
    return;
  }

  // Build exact date ranges so every evidence agent uses identical date boundaries
  // CRITICAL: Two date scoping approaches exist (matching Qlik DateType):
  //   - application_date: for pull-through, fallout, application cohort analysis
  //   - funding_date: for volume, revenue, units, cycle time, personnel performance
  const dr = getStandardDateRanges();
  const dateRangesContext = [
    `EXACT date boundaries for WHERE clauses:`,
    `- YTD: '${dr.ytd.start}' to '${dr.ytd.end}'`,
    `- MTD: '${dr.mtd.start}' to '${dr.mtd.end}'`,
    `- Trailing 30 Days: '${dr.trailing30.start}' to '${dr.trailing30.end}'`,
    `- Trailing 60 Days: '${dr.rolling60D.start}' to '${dr.rolling60D.end}'`,
    `- Trailing 90 Days: '${dr.rolling90D.start}' to '${dr.rolling90D.end}'`,
    `- Prior YTD (same day last year): '${dr.lastYear.start}' to '${dr.lastYear.end}'`,
    `- Prior Month: '${dr.lastMonth.start}' to '${dr.lastMonth.end}'`,
    `- Prior 30 Days: '${dr.prior30.start}' to '${dr.prior30.end}'`,
    `- Prior 60 Days: '${dr.prior60.start}' to '${dr.prior60.end}'`,
    `- Prior 90 Days: '${dr.prior90.start}' to '${dr.prior90.end}'`,
    ``,
    `DATE SCOPING RULES (critical for matching KPIs):`,
    `- For PULL-THROUGH, FALLOUT, application pipeline: scope by l.application_date`,
    `- For FUNDED VOLUME, REVENUE, UNITS, CYCLE TIME, personnel performance: scope by l.funding_date`,
    `- Personnel "Top Performer"/"Bottom Performer" insights: use WHERE l.funding_date >= ... AND l.funding_date <= ...`,
    `  because the KPI metrics (units, revenue, volume) are computed from the FUNDING cohort.`,
    `- Product fallout insights: use WHERE l.application_date >= ... because fallout is application-cohort based.`,
    `- When the insight context mentions "funding_date scoped", ALWAYS use funding_date in your WHERE clause.`,
    `- The summary KPIs MUST match the rows returned. If KPIs show "12 units funded YTD", the SQL must return those 12 funded loans.`,
  ].join("\n");

  // Canonical metric definitions — ensures evidence SQL matches the metrics collector exactly
  const metricDefinitions = [
    `CANONICAL METRIC DEFINITIONS (use these EXACT SQL patterns):`,
    ``,
    `FUNDED (Originated) loans:`,
    `  WHERE (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%')`,
    `  This is the definition of "funded" used for pull-through and product breakdown.`,
    ``,
    `COMPLETED loans (all terminal statuses):`,
    `  WHERE current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')`,
    `  AND application_date >= <start> AND application_date <= <end>`,
    ``,
    `FALLEN OUT loans = completed minus funded. NOT just withdrawn. Use:`,
    `  WHERE current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')`,
    `    AND NOT (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%')`,
    `    AND application_date >= <start> AND application_date <= <end>`,
    `  This captures withdrawn, denied, cancelled, incomplete, and ALL other non-funded terminal statuses.`,
    `  CRITICAL: "fallen out" != "withdrawn". Fallen out is the BROADER set. Always use the NOT IN + NOT funded filter.`,
    ``,
    `WITHDRAWN loans only:`,
    `  WHERE (current_loan_status ILIKE '%withdraw%' OR current_loan_status ILIKE '%cancelled%'`,
    `    OR current_loan_status ILIKE '%canceled%' OR current_loan_status ILIKE '%not accepted%'`,
    `    OR current_loan_status ILIKE '%incomplete%')`,
    ``,
    `DENIED loans only:`,
    `  WHERE (current_loan_status ILIKE '%denied%' OR current_loan_status ILIKE '%declined%')`,
    ``,
    `PULL-THROUGH RATE = funded / completed * 100 (application-cohort, scoped by application_date)`,
    `FALLOUT RATE = (completed - funded) / completed * 100 = 100 - pull_through_rate`,
    ``,
    `FUNDED VOLUME = SUM(loan_amount) for funded loans (use same Originated/Purchased status filter)`,
    ``,
    `When the insight mentions "fallen out", "fallout", or "fall out", ALWAYS use the broad fallen-out definition above.`,
    `When the insight mentions "withdrawn" specifically, use the withdrawn-only filter.`,
    `The detail table MUST contain ALL loans matching the insight's claim. If insight says "14 fallen out", the SQL must return 14 rows.`,
  ].join("\n");

  const agentConfig = { model, temperature, maxTokens, systemPrompt, tenantRevenueExpr, dateRangesContext, metricDefinitions };

  // Build date context string for the LLM
  const now = new Date();
  const dateContext = `Today: ${now.toISOString().split("T")[0]}. Current year: ${now.getFullYear()}.`;

  insightLog(`[EvidenceAgent] Starting ${insights.length} parallel evidence agents (model=${model})`);

  // Pre-compute tier context for each insight (only non-empty for tier/headcount insights)
  const tierContexts = insights.map(ins => buildTierContextForInsight(ins, metricsPayload));

  // Log which insights got tier context for debugging
  for (let i = 0; i < tierContexts.length; i++) {
    if (tierContexts[i]) {
      insightLog(`[EvidenceAgent] Insight ${i} ("${insights[i].headline.substring(0, 60)}...") received tier context (${tierContexts[i].length} chars)`);
    }
  }

  // Fan out: 1 agent per insight, all in parallel
  const results = await Promise.allSettled(
    insights.map((insight, idx) =>
      runEvidenceAgentForInsight(insight, idx, schemaContext, tenantPool, apiKey, agentConfig, dateContext, tierContexts[idx] || undefined)
    )
  );

  // Collect results from initial pass
  let succeeded = 0;
  let failed = 0;
  const QUALITY_RETRY_THRESHOLD = 50;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value) {
      insights[i].evidence_table = validateEvidenceQuality(result.value, insights[i]);
      succeeded++;
    } else {
      if (result.status === "rejected") {
        insightLogWarn(`[EvidenceAgent] Agent ${i} ("${insights[i].headline.substring(0, 60)}") rejected: ${result.reason}`);
      } else {
        insightLogWarn(`[EvidenceAgent] Agent ${i} ("${insights[i].headline.substring(0, 60)}") returned null`);
      }
      failed++;
    }
  }

  const elapsed1 = Date.now() - t0;
  insightLog(`[EvidenceAgent] Pass 1 complete: ${succeeded}/${insights.length} succeeded, ${failed} failed (${elapsed1}ms)`);

  // ── Quality retry pass: re-run evidence agents for failed or low-quality insights ──
  const retryIndices: number[] = [];
  for (let i = 0; i < insights.length; i++) {
    const ev = insights[i].evidence_table;
    if (!ev) {
      retryIndices.push(i);
    } else if (ev.audit?.evidenceQualityScore !== undefined && ev.audit.evidenceQualityScore < QUALITY_RETRY_THRESHOLD) {
      retryIndices.push(i);
    }
  }

  if (retryIndices.length > 0) {
    insightLog(`[EvidenceAgent] Retrying ${retryIndices.length} insights with quality feedback (threshold=${QUALITY_RETRY_THRESHOLD})`);

    const retryResults = await Promise.allSettled(
      retryIndices.map(idx => {
        const prev = insights[idx].evidence_table;
        const qualityFeedback = prev
          ? buildQualityFeedback(prev, insights[idx])
          : `Previous attempt failed entirely. Generate a complete evidence table with SQL, columns, summary KPIs. Personnel/tier insights MUST GROUP BY individual officer.`;
        return runEvidenceAgentWithFeedback(
          insights[idx], idx, schemaContext, tenantPool, apiKey, agentConfig, dateContext, qualityFeedback, tierContexts[idx] || undefined,
        );
      })
    );

    let retrySucceeded = 0;
    for (let r = 0; r < retryResults.length; r++) {
      const idx = retryIndices[r];
      const result = retryResults[r];
      if (result.status === "fulfilled" && result.value) {
        const validated = validateEvidenceQuality(result.value, insights[idx]);
        const prevScore = insights[idx].evidence_table?.audit?.evidenceQualityScore ?? 0;
        const newScore = validated.audit?.evidenceQualityScore ?? 0;
        if (newScore > prevScore) {
          insights[idx].evidence_table = validated;
          retrySucceeded++;
          insightLog(`[EvidenceAgent] Retry improved insight ${idx}: score ${prevScore}→${newScore}`);
        } else {
          insightLog(`[EvidenceAgent] Retry did not improve insight ${idx}: score ${prevScore}→${newScore}, keeping original`);
        }
      } else {
        insightLogWarn(`[EvidenceAgent] Retry failed for insight ${idx} ("${insights[idx].headline.substring(0, 60)}")`);
      }
    }

    insightLog(`[EvidenceAgent] Retry pass: ${retrySucceeded}/${retryIndices.length} improved`);
  }

  const elapsed = Date.now() - t0;
  const finalSucceeded = insights.filter(i => i.evidence_table != null).length;
  insightLog(`[EvidenceAgent] Complete: ${finalSucceeded}/${insights.length} have evidence (${elapsed}ms wall-clock)`);
}

// ============================================================================
// Training examples (kept for few-shot injection)
// ============================================================================

async function fetchTrainingExamples(promptId: string): Promise<{
  positive: Array<{ headline: string; admin_note?: string }>;
  negative: Array<{ headline: string; admin_note?: string }>;
}> {
  try {
    if (!managementPool) return { positive: [], negative: [] };

    const tableCheck = await managementPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'insight_training_examples'
      ) as exists
    `);
    if (!tableCheck.rows[0]?.exists) return { positive: [], negative: [] };

    const result = await managementPool.query(
      `SELECT example_type, headline, admin_note
       FROM insight_training_examples
       WHERE prompt_id = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [promptId]
    );

    const positive = result.rows
      .filter((r: any) => r.example_type === "positive")
      .slice(0, 3)
      .map((r: any) => ({ headline: r.headline, admin_note: r.admin_note }));

    const negative = result.rows
      .filter((r: any) => r.example_type === "negative")
      .slice(0, 2)
      .map((r: any) => ({ headline: r.headline, admin_note: r.admin_note }));

    return { positive, negative };
  } catch (error) {
    console.warn("[Pipeline] Failed to fetch training examples:", error);
    return { positive: [], negative: [] };
  }
}

// ============================================================================
// Persistence — save to / read from tenant DB
// ============================================================================

async function persistInsights(
  tenantPool: pg.Pool,
  insights: CategorizedInsight[],
  generationBatch: string,
  dateFilter: string,
  channelGroup?: string,
  experimentIdMap?: Record<string, string | undefined>
): Promise<void> {
  if (insights.length === 0) return;

  // Delete previous insights for this date_filter + channel_group
  await tenantPool.query(
    `DELETE FROM generated_insights WHERE date_filter = $1 AND COALESCE(channel_group, '') = COALESCE($2, '')`,
    [dateFilter, channelGroup || null]
  );

  // Check which optional columns exist (graceful for pre-migration tenants)
  let hasExperimentCol = false;
  let hasDetailDataCol = false;
  try {
    const colCheck = await tenantPool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'generated_insights' AND column_name IN ('experiment_id', 'detail_data')
    `);
    for (const row of colCheck.rows) {
      if (row.column_name === "experiment_id") hasExperimentCol = true;
      if (row.column_name === "detail_data") hasDetailDataCol = true;
    }
  } catch { /* ignore */ }

  // Batch insert — build column list and values dynamically
  const values: any[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (const ins of insights) {
    const expId = experimentIdMap?.[ins.bucket] || null;

    // Base 15 columns always present
    const baseCount = 15;
    const extraCount = (hasExperimentCol ? 1 : 0) + (hasDetailDataCol ? 1 : 0);
    const totalParams = baseCount + extraCount;
    const ph = Array.from({ length: totalParams }, () => `$${paramIdx++}`);
    placeholders.push(`(${ph.join(", ")})`);

    // Merge ETM fields into the evidence JSONB for persistence
    const evidenceWithEtm = {
      ...(ins.evidence || {}),
      ...(ins.what_changed ? { what_changed: ins.what_changed } : {}),
      ...(ins.why ? { why: ins.why } : {}),
      ...(ins.business_impact ? { business_impact: ins.business_impact } : {}),
      ...(ins.risk_if_ignored ? { risk_if_ignored: ins.risk_if_ignored } : {}),
      ...(ins.recommended_action ? { recommended_action: ins.recommended_action } : {}),
      ...(ins.owner ? { owner: ins.owner } : {}),
    };

    values.push(
      ins.bucket,
      ins.priority,
      ins.headline,
      ins.understory,
      ins.insight_type,
      ins.source,
      ins.severity_score,
      JSON.stringify(ins.impact),
      JSON.stringify(evidenceWithEtm),
      ins.for_podcast,
      dateFilter,
      channelGroup || null,
      generationBatch,
      new Date().toISOString(),
      ins.detail_query ? JSON.stringify(ins.detail_query) : null,
    );
    if (hasDetailDataCol) {
      values.push(ins.detail_data ? JSON.stringify(ins.detail_data) : null);
    }
    if (hasExperimentCol) {
      values.push(expId);
    }
  }

  // Build column list matching the values order
  let columnList = `bucket, priority, headline, understory, insight_type, source,
       severity_score, impact, evidence, for_podcast,
       date_filter, channel_group, generation_batch, generated_at, detail_query`;
  if (hasDetailDataCol) columnList += `, detail_data`;
  if (hasExperimentCol) columnList += `, experiment_id`;
  const columns = `(${columnList})`;

  await tenantPool.query(
    `INSERT INTO generated_insights ${columns}
     VALUES ${placeholders.join(", ")}`,
    values
  );

  console.log(
    `[LLMInsights] Persisted ${insights.length} insights (batch: ${generationBatch})`
  );
}

export async function loadStoredInsights(
  tenantPool: pg.Pool,
  dateFilter: string,
  channelGroup?: string,
  generationMethod?: string
): Promise<CategorizedInsightsResponse | null> {
  try {
    // Check if the table exists first
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'generated_insights'
      ) as exists
    `);

    if (!tableCheck.rows[0]?.exists) {
      return null;
    }

    // Build query with optional generation_method filter
    let sql = `SELECT * FROM generated_insights
       WHERE date_filter = $1
         AND COALESCE(channel_group, '') = COALESCE($2, '')`;
    const params: any[] = [dateFilter, channelGroup || null];

    if (generationMethod) {
      // Check if the column exists (pre-migration guard)
      try {
        const colCheck = await tenantPool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_name = 'generated_insights' AND column_name = 'generation_method'
          ) as exists
        `);
        if (colCheck.rows[0]?.exists) {
          sql += ` AND generation_method = $3`;
          params.push(generationMethod);
        }
      } catch { /* ignore */ }
    }

    sql += ` ORDER BY
         CASE bucket
           WHEN 'critical' THEN 0
           WHEN 'attention' THEN 1
           WHEN 'working' THEN 2
           WHEN 'context' THEN 3
         END,
         severity_score DESC`;

    const result = await tenantPool.query(sql, params);

    if (result.rows.length === 0) return null;

    const insights: CategorizedInsight[] = result.rows.map((row: any) => {
      const ev = row.evidence || {};
      return {
        id: row.id,
        bucket: row.bucket,
        priority: row.priority,
        headline: row.headline,
        understory: row.understory,
        insight_type: row.insight_type,
        source: row.source,
        severity_score: parseFloat(row.severity_score) || 0,
        impact: row.impact || {},
        evidence: ev,
        for_podcast: row.for_podcast,
        detail_query: row.detail_query || null,
        // ETM fields (stored in evidence JSONB)
        what_changed: ev.what_changed,
        why: ev.why,
        business_impact: ev.business_impact,
        risk_if_ignored: ev.risk_if_ignored,
        recommended_action: ev.recommended_action,
        owner: ev.owner,
        generation_method: row.generation_method || "pipeline",
        detail_data: row.detail_data || null,
        functional_category: row.functional_category || null,
      };
    });

    return {
      insights,
      generationBatch: result.rows[0].generation_batch,
      generatedAt: result.rows[0].generated_at,
      summaryForPodcast: "",
    };
  } catch (error) {
    console.warn("[LLMInsights] Could not load stored insights:", error);
    return null;
  }
}

// ============================================================================
// Experiment selection — check for active A/B experiments for a prompt
// ============================================================================

interface ExperimentOverrides {
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  experimentId?: string;
}

async function selectExperiment(promptId: string): Promise<ExperimentOverrides | null> {
  try {
    if (!managementPool) return null;

    // Check if the table exists
    const tableCheck = await managementPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'prompt_experiments'
      ) as exists
    `);
    if (!tableCheck.rows[0]?.exists) return null;

    const result = await managementPool.query(
      `SELECT id, variant_system_prompt, variant_model, variant_temperature, variant_max_tokens, traffic_pct
       FROM prompt_experiments
       WHERE prompt_id = $1 AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [promptId]
    );

    if (result.rows.length === 0) return null;

    const exp = result.rows[0];
    const trafficPct = parseInt(exp.traffic_pct, 10);

    // Weighted random: if random value is within the experiment's traffic %, use the variant
    const roll = Math.random() * 100;
    if (roll < trafficPct) {
      console.log(
        `[LLMInsights] Experiment "${exp.id}" selected for prompt "${promptId}" (roll: ${roll.toFixed(1)}, threshold: ${trafficPct}%)`
      );
      return {
        systemPrompt: exp.variant_system_prompt,
        model: exp.variant_model || undefined,
        temperature: exp.variant_temperature != null ? parseFloat(exp.variant_temperature) : undefined,
        maxTokens: exp.variant_max_tokens || undefined,
        experimentId: exp.id,
      };
    }

    return null;
  } catch (error) {
    console.warn("[LLMInsights] Failed to check experiments:", error);
    return null;
  }
}

// ============================================================================
// Main entry point — 3-pass insight pipeline (Generator → Validator → Curator)
// ============================================================================

export async function generateCategorizedInsights(
  metricsPayload: InsightMetricsPayload,
  tenantPool: pg.Pool,
  tenantId?: string,
  options: { channelGroup?: string; skipPersist?: boolean } = {}
): Promise<CategorizedInsightsResponse> {
  const { channelGroup, skipPersist } = options;
  const dateFilter = metricsPayload.period.dateFilter;
  const generationBatch = crypto.randomUUID();

  // Start file logger for this generation run
  insightLogStart(tenantId || "default", dateFilter, channelGroup);
  insightLog(`[Pipeline] Starting 4-pass insight pipeline (batch: ${generationBatch}, tenant: ${tenantId || "default"}, dateFilter: ${dateFilter})`);
  insightLog(`[Pipeline] Log file: ${getInsightLogPath()}`);

  const apiKey = await getOpenAIKey(tenantId);
  const startTime = Date.now();

  // Audit: step timings accumulator
  const _timings: Record<string, number> = {};

  // Audit: per-insight journey map (keyed by lowercase headline)
  const journeyMap = new Map<string, InsightJourney>();

  // ── Step 0: Compute deterministic signals ──
  const signals = computeSignals(metricsPayload);
  const signalsText = formatSignalsForPrompt(signals);
  _timings.signals = Date.now() - startTime;
  insightLog(`[Pipeline] Step 0 complete: ${signals.length} signals (${_timings.signals}ms)`);

  // ── Step 0b: RAG Enrichment (parallel, non-blocking) ──
  let historicalContext = "";
  let knowledgeContext = "";
  try {
    const ragStart = Date.now();
    const [histCtx, knowCtx] = await Promise.all([
      fetchHistoricalPatternContext(tenantPool, tenantId || "default", signals, metricsPayload),
      fetchKnowledgeContextForInsights(tenantPool, tenantId || "default", signals),
    ]);
    historicalContext = histCtx;
    knowledgeContext = knowCtx;
    console.log(
      `[Pipeline] Step 0b RAG enrichment complete (${Date.now() - ragStart}ms): ` +
      `historical=${historicalContext.length > 0 ? historicalContext.length + " chars" : "none"}, ` +
      `knowledge=${knowledgeContext.length > 0 ? knowledgeContext.length + " chars" : "none"}`
    );
    _timings.rag = Date.now() - ragStart;
  } catch (ragErr: any) {
    insightLogWarn(`[Pipeline] RAG enrichment failed (non-fatal, continuing): ${ragErr.message}`);
    _timings.rag = 0;
  }

  // ── Pass 1: Generator ──
  const pass1Start = Date.now();
  let generatorSystem: string;
  let generatorModel = process.env.INSIGHTS_MODEL || "gpt-5.4";
  let generatorTemp = 0.7;
  let generatorMaxTokens = 8000;

  try {
    const generatorConfig = await getPromptConfig("insights.generator");
    generatorSystem = generatorConfig.system_prompt;
    generatorModel = generatorConfig.model || generatorModel;
    generatorTemp = generatorConfig.temperature ?? generatorTemp;
    generatorMaxTokens = generatorConfig.max_tokens || generatorMaxTokens;
  } catch {
    console.error("[Pipeline] Failed to load insights.generator prompt config. Aborting.");
    return { insights: [], generationBatch, generatedAt: new Date().toISOString(), summaryForPodcast: "Insight generation failed." };
  }

  // Inject training examples
  const trainingExamples = await fetchTrainingExamples("insights.generator");
  if (trainingExamples.positive.length > 0 || trainingExamples.negative.length > 0) {
    let trainingSection = "\n\nLEARN FROM THESE EXAMPLES:";
    if (trainingExamples.positive.length > 0) {
      trainingSection += "\nGOOD (generate more like these):";
      for (const ex of trainingExamples.positive) {
        trainingSection += `\n- "${ex.headline}"`;
        if (ex.admin_note) trainingSection += ` — ${ex.admin_note}`;
      }
    }
    if (trainingExamples.negative.length > 0) {
      trainingSection += "\nBAD (avoid these patterns):";
      for (const ex of trainingExamples.negative) {
        trainingSection += `\n- "${ex.headline}"`;
        if (ex.admin_note) trainingSection += ` — ${ex.admin_note}`;
      }
    }
    generatorSystem += trainingSection;
  }

  // Build full metrics text for audit logging
  const metricsText = buildMetricsUserPrompt(metricsPayload, channelGroup);
  const ragSections = [historicalContext, knowledgeContext].filter(s => s.length > 0).join("\n\n");

  // ── Pass 1: Parallel domain-split Generator calls ──
  const domainStats: Array<{ id: InsightDomainId; candidateCount: number; promptLength: number }> = [];

  insightLog(`[Pipeline] Pass 1 (Generator): model=${generatorModel}, running ${INSIGHT_DOMAINS.length} parallel domain calls`);

  const domainResults = await Promise.all(
    INSIGHT_DOMAINS.map(async (domain) => {
      try {
        const domainPrompt = buildDomainPrompt(domain.id, metricsPayload, channelGroup);
        const domainSignals = filterSignalsByDomain(signals, domain.signalAreas);
        const domainSignalsText = formatSignalsForPrompt(domainSignals);
        const userPrompt = ragSections.length > 0
          ? `${domainPrompt}\n\n${domainSignalsText}\n\n${ragSections}`
          : `${domainPrompt}\n\n${domainSignalsText}`;

        insightLog(`[Pipeline] Pass 1 [${domain.id}]: ${userPrompt.length} chars, ${domainSignals.length} signals`);

        const response = await callOpenAI(generatorSystem, userPrompt, apiKey, {
          model: generatorModel, temperature: generatorTemp, maxTokens: generatorMaxTokens,
          tenantPool, tenantId, requestedBy: "insight-generator",
        });

        const domainCandidates = parseGeneratorResponse(response);
        // Tag each candidate with its source domain
        for (const c of domainCandidates) {
          c.sourceDomain = domain.id;
        }
        domainStats.push({ id: domain.id, candidateCount: domainCandidates.length, promptLength: userPrompt.length });
        insightLog(`[Pipeline] Pass 1 [${domain.id}]: ${domainCandidates.length} candidates`);
        return domainCandidates;
      } catch (domainErr: any) {
        insightLogWarn(`[Pipeline] Pass 1 [${domain.id}] failed (continuing): ${domainErr.message}`);
        domainStats.push({ id: domain.id, candidateCount: 0, promptLength: 0 });
        return [] as GeneratorCandidate[];
      }
    })
  );

  // Merge all domain candidates and deduplicate by exact headline match
  const allCandidates = domainResults.flat();
  const seenHeadlines = new Set<string>();
  const exactDeduped: GeneratorCandidate[] = [];
  for (const c of allCandidates) {
    const key = c.headline.toLowerCase().trim();
    if (!seenHeadlines.has(key)) {
      seenHeadlines.add(key);
      exactDeduped.push(c);
    }
  }

  // Fuzzy dedup: extract a "topic fingerprint" from each headline and reject
  // candidates whose fingerprint overlaps >70% with an already-seen candidate.
  // This catches near-duplicates like "Tier migration recorded 10 demotions..."
  // and "Loan Officer tier migration shows 10 demotions..." that differ in wording.
  const candidates: GeneratorCandidate[] = [];
  const fingerprints: Set<string>[] = [];
  for (const c of exactDeduped) {
    const fp = getTopicFingerprint(c.headline);
    const isDupe = fp.size > 0 && fingerprints.some(prev => {
      const overlap = [...fp].filter(t => prev.has(t)).length;
      return overlap / Math.max(fp.size, prev.size) > 0.7;
    });
    if (!isDupe) {
      candidates.push(c);
      fingerprints.push(fp);
    }
  }

  _timings.generator = Date.now() - pass1Start;
  insightLog(`[Pipeline] Pass 1 complete: ${allCandidates.length} raw → ${candidates.length} deduplicated candidates across ${INSIGHT_DOMAINS.length} domains (${_timings.generator}ms)`);

  // Audit: seed journey map with generator output
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    journeyMap.set(c.headline.toLowerCase(), {
      generatorIndex: i,
      headline: c.headline,
      reasoningChain: c.reasoning_chain,
      citedNumbers: c.cited_numbers,
      factCheck: { score: 0, issues: [] },
      judgeScore: 0,
      curatorBucket: "",
      curatorPriority: "",
      sourceDomain: c.sourceDomain,
    });
  }

  if (candidates.length === 0) {
    console.error("[Pipeline] Generator returned 0 candidates across all domains. Aborting.");
    return { insights: [], generationBatch, generatedAt: new Date().toISOString(), summaryForPodcast: "Insight generation produced no candidates." };
  }

  // ── Pass 2a: Programmatic Fact-Check ──
  const pass2Start = Date.now();
  const factChecks = factCheckInsights(candidates, metricsPayload, signals);

  // Auto-reject candidates with fact_check_score < 0.5
  const survivingAfterFactCheck: Array<{ candidate: GeneratorCandidate; factCheck: FactCheckResult; originalIndex: number }> = [];
  const rejectedByFactCheck: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const fc = factChecks[i];
    if (fc.score < 0.5) {
      rejectedByFactCheck.push(`#${i} "${candidates[i].headline.substring(0, 60)}..." (score: ${fc.score.toFixed(2)}, issues: ${fc.issues.join("; ")})`);
    } else {
      survivingAfterFactCheck.push({ candidate: candidates[i], factCheck: fc, originalIndex: i });
    }
  }

  // Audit: attach fact-check results to journey map
  for (let i = 0; i < candidates.length; i++) {
    const journey = journeyMap.get(candidates[i].headline.toLowerCase());
    if (journey) {
      journey.factCheck = { score: factChecks[i].score, issues: [...factChecks[i].issues] };
    }
  }

  if (rejectedByFactCheck.length > 0) {
    insightLog(`[Pipeline] Fact-check rejected ${rejectedByFactCheck.length} candidates:\n  ${rejectedByFactCheck.join("\n  ")}`);
  }
  _timings.factCheck = Date.now() - pass2Start;
  insightLog(`[Pipeline] Pass 2a (Fact-Check) complete: ${survivingAfterFactCheck.length} surviving (${_timings.factCheck}ms)`);

  // ── Pass 2b: Judge LLM ──
  const pass2bStart = Date.now();
  let judgeSystem: string;
  let judgeModel = process.env.INSIGHTS_MODEL || "gpt-5.4";
  let judgeTemp = 0.1;
  let judgeMaxTokens = 4000;

  try {
    const judgeConfig = await getPromptConfig("insights.judge");
    judgeSystem = judgeConfig.system_prompt;
    judgeModel = judgeConfig.model || judgeModel;
    judgeTemp = judgeConfig.temperature ?? judgeTemp;
    judgeMaxTokens = judgeConfig.max_tokens || judgeMaxTokens;
  } catch {
    console.warn("[Pipeline] Judge prompt config not found, skipping judge pass.");
    // Skip judge — all surviving candidates proceed
    judgeSystem = "";
  }

  let scoredCandidates: Array<{
    candidate: GeneratorCandidate;
    judgeScore: number;
    factCheckScore: number;
    issues: string[];
    originalIndex: number;
  }> = [];

  if (judgeSystem) {
    // Build judge user prompt: candidates + fact-check results + signals
    const judgeInput = {
      candidates: survivingAfterFactCheck.map(({ candidate, factCheck }, idx) => ({
        index: idx,
        headline: candidate.headline,
        understory: candidate.understory,
        reasoning_chain: candidate.reasoning_chain,
        sentiment: candidate.sentiment,
        source: candidate.source,
        cited_numbers: candidate.cited_numbers,
        fact_check_score: factCheck.score,
        fact_check_issues: factCheck.issues,
      })),
      signal_summary: signalsText,
    };

    const judgeUserPrompt = JSON.stringify(judgeInput, null, 2);
    insightLog(`[Pipeline] Pass 2b (Judge): model=${judgeModel}, ${survivingAfterFactCheck.length} candidates to evaluate`);

    const judgeResponse = await callOpenAI(judgeSystem, judgeUserPrompt, apiKey, {
      model: judgeModel, temperature: judgeTemp, maxTokens: judgeMaxTokens,
      tenantPool, tenantId, requestedBy: "insight-judge",
    });

    const evaluations = parseJudgeResponse(judgeResponse);

    // Merge judge scores with candidates
    for (let sIdx = 0; sIdx < survivingAfterFactCheck.length; sIdx++) {
      const { candidate, factCheck, originalIndex } = survivingAfterFactCheck[sIdx];
      const evaluation = evaluations.find(e => e.insight_index === sIdx);
      const judgeScore = evaluation?.overall_score ?? 5.0;
      // Use score threshold only — don't let LLM override with keep:false at high scores
      const keep = judgeScore >= 4.5;

      // Audit: attach judge score to journey
      const journey = journeyMap.get(candidate.headline.toLowerCase());
      if (journey) {
        journey.judgeScore = judgeScore;
        journey.judgeIssues = evaluation?.issues || [];
      }

      if (keep) {
        scoredCandidates.push({
          candidate,
          judgeScore,
          factCheckScore: factCheck.score,
          issues: [...factCheck.issues, ...(evaluation?.issues || [])],
          originalIndex,
        });
      } else {
        insightLog(`[Pipeline] Judge rejected: "${candidate.headline.substring(0, 60)}..." (score: ${judgeScore.toFixed(1)})`);
      }
    }
  } else {
    // No judge — pass all fact-check survivors through
    scoredCandidates = survivingAfterFactCheck.map(({ candidate, factCheck, originalIndex }) => ({
      candidate,
      judgeScore: 7.0,
      factCheckScore: factCheck.score,
      issues: factCheck.issues,
      originalIndex,
    }));
    // Audit: mark as no-judge pass-through
    for (const { candidate } of survivingAfterFactCheck) {
      const journey = journeyMap.get(candidate.headline.toLowerCase());
      if (journey) journey.judgeScore = 7.0;
    }
  }

  _timings.judge = Date.now() - pass2bStart;
  insightLog(`[Pipeline] Pass 2b complete: ${scoredCandidates.length} candidates after judging (${_timings.judge}ms)`);

  // ── Pass 3: Curator ──
  const pass3Start = Date.now();
  let curatorSystem: string;
  let curatorModel = process.env.INSIGHTS_MODEL || "gpt-5.4";
  let curatorTemp = 0.2;
  let curatorMaxTokens = 6000;

  try {
    const curatorConfig = await getPromptConfig("insights.curator");
    curatorSystem = curatorConfig.system_prompt;
    curatorModel = curatorConfig.model || curatorModel;
    curatorTemp = curatorConfig.temperature ?? curatorTemp;
    curatorMaxTokens = curatorConfig.max_tokens || curatorMaxTokens;
  } catch {
    console.warn("[Pipeline] Curator prompt config not found, using direct mapping.");
    curatorSystem = "";
  }

  let finalInsights: CategorizedInsight[];

  if (curatorSystem && scoredCandidates.length > 0) {
    const curatorInput = {
      domain_coverage_rule: "Ensure at least 2 insights from each source_domain are included in the final output for balanced coverage.",
      candidates: scoredCandidates.map(({ candidate, judgeScore, factCheckScore, issues }) => ({
        headline: candidate.headline,
        understory: candidate.understory,
        sentiment: candidate.sentiment,
        insight_type: candidate.insight_type,
        source: candidate.source,
        source_domain: candidate.sourceDomain || "unknown",
        severity_score: candidate.severity_score,
        judge_score: judgeScore,
        fact_check_score: factCheckScore,
        issues,
        impact: candidate.impact,
        evidence: candidate.evidence,
        for_podcast: candidate.for_podcast,
        // ETM fields
        what_changed: candidate.what_changed,
        why: candidate.why,
        business_impact: candidate.business_impact,
        risk_if_ignored: candidate.risk_if_ignored,
        recommended_action: candidate.recommended_action,
        owner: candidate.owner,
      })),
      signal_summary: signalsText,
    };

    const curatorUserPrompt = JSON.stringify(curatorInput, null, 2);
    insightLog(`[Pipeline] Pass 3 (Curator): model=${curatorModel}, ${scoredCandidates.length} candidates to curate`);

    const curatorResponse = await callOpenAI(curatorSystem, curatorUserPrompt, apiKey, {
      model: curatorModel, temperature: curatorTemp, maxTokens: curatorMaxTokens,
      tenantPool, tenantId, requestedBy: "insight-curator",
    });

    finalInsights = parseCuratorResponse(curatorResponse);
  } else {
    // Fallback: direct sentiment-to-bucket mapping without curator
    finalInsights = scoredCandidates
      .sort((a, b) => b.judgeScore - a.judgeScore)
      .slice(0, 20)
      .map(({ candidate }) => {
        const mapping = SENTIMENT_TO_BUCKET[candidate.sentiment] || SENTIMENT_TO_BUCKET["neutral"];
        return {
          bucket: mapping.bucket,
          priority: mapping.priority,
          headline: candidate.headline,
          understory: candidate.understory,
          insight_type: candidate.insight_type as CategorizedInsight["insight_type"],
          source: candidate.source,
          severity_score: candidate.severity_score,
          impact: candidate.impact,
          evidence: candidate.evidence,
          for_podcast: candidate.for_podcast,
          what_changed: candidate.what_changed,
          why: candidate.why,
          business_impact: candidate.business_impact,
          risk_if_ignored: candidate.risk_if_ignored,
          recommended_action: candidate.recommended_action,
          owner: candidate.owner,
        };
      });
  }

  _timings.curator = Date.now() - pass3Start;
  insightLog(`[Pipeline] Pass 3 complete: ${finalInsights.length} final insights (${_timings.curator}ms)`);

  // Audit: attach curator bucket/priority to journey map
  for (const ins of finalInsights) {
    const journey = journeyMap.get(ins.headline.toLowerCase());
    if (journey) {
      journey.curatorBucket = ins.bucket;
      journey.curatorPriority = ins.priority;
    }
  }

  // ── Post-Pass-3: Bucket balance check ──
  // If any bucket has 0 insights after curator, promote from scored candidates
  const bucketCounts: Record<string, number> = { working: 0, attention: 0, critical: 0, context: 0 };
  for (const ins of finalInsights) {
    if (bucketCounts[ins.bucket] !== undefined) bucketCounts[ins.bucket]++;
  }

  const emptyBuckets = Object.entries(bucketCounts).filter(([, count]) => count === 0).map(([bucket]) => bucket);

  if (emptyBuckets.length > 0 && scoredCandidates.length > 0) {
    insightLog(`[Pipeline] Bucket balance: empty buckets detected: ${emptyBuckets.join(", ")}. Promoting from dropped candidates.`);

    const BUCKET_TO_SENTIMENT: Record<string, string[]> = {
      working: ["positive"],
      attention: ["warning"],
      critical: ["critical"],
      context: ["neutral"],
    };

    // Get already-used headlines to avoid duplicates
    const usedHeadlines = new Set(finalInsights.map(i => i.headline.toLowerCase()));

    for (const emptyBucket of emptyBuckets) {
      const sentiments = BUCKET_TO_SENTIMENT[emptyBucket] || [];
      // Find scored candidates with matching sentiment that weren't selected
      const promotable = scoredCandidates
        .filter(({ candidate }) =>
          sentiments.includes(candidate.sentiment) &&
          !usedHeadlines.has(candidate.headline.toLowerCase())
        )
        .sort((a, b) => b.judgeScore - a.judgeScore)
        .slice(0, 3);

      for (const { candidate } of promotable) {
        const mapping = SENTIMENT_TO_BUCKET[candidate.sentiment] || SENTIMENT_TO_BUCKET["neutral"];
        finalInsights.push({
          bucket: mapping.bucket,
          priority: mapping.priority,
          headline: candidate.headline,
          understory: candidate.understory,
          insight_type: candidate.insight_type as CategorizedInsight["insight_type"],
          source: candidate.source,
          severity_score: candidate.severity_score,
          impact: candidate.impact,
          evidence: candidate.evidence,
          for_podcast: candidate.for_podcast,
          what_changed: candidate.what_changed,
          why: candidate.why,
          business_impact: candidate.business_impact,
          risk_if_ignored: candidate.risk_if_ignored,
          recommended_action: candidate.recommended_action,
          owner: candidate.owner,
        });
        usedHeadlines.add(candidate.headline.toLowerCase());
      }

      if (promotable.length > 0) {
        insightLog(`[Pipeline] Promoted ${promotable.length} candidates to "${emptyBucket}" bucket`);
      } else {
        insightLog(`[Pipeline] No candidates with matching sentiment for "${emptyBucket}" bucket`);
      }
    }
  }

  // ── Post-Pass-3b: Minimum count enforcement ──
  // If we have fewer than 12 insights after bucket balancing, backfill from scored candidates
  const MIN_INSIGHT_COUNT = 15;
  if (finalInsights.length < MIN_INSIGHT_COUNT && scoredCandidates.length > 0) {
    const usedHeadlinesForBackfill = new Set(finalInsights.map(i => i.headline.toLowerCase()));
    const backfillNeeded = MIN_INSIGHT_COUNT - finalInsights.length;

    // Get all unused scored candidates, sorted by judge score descending
    const backfillCandidates = scoredCandidates
      .filter(({ candidate }) => !usedHeadlinesForBackfill.has(candidate.headline.toLowerCase()))
      .sort((a, b) => b.judgeScore - a.judgeScore)
      .slice(0, backfillNeeded);

    for (const { candidate } of backfillCandidates) {
      const mapping = SENTIMENT_TO_BUCKET[candidate.sentiment] || SENTIMENT_TO_BUCKET["neutral"];
      finalInsights.push({
        bucket: mapping.bucket,
        priority: mapping.priority,
        headline: candidate.headline,
        understory: candidate.understory,
        insight_type: candidate.insight_type as CategorizedInsight["insight_type"],
        source: candidate.source,
        severity_score: candidate.severity_score,
        impact: candidate.impact,
        evidence: candidate.evidence,
        for_podcast: candidate.for_podcast,
        what_changed: candidate.what_changed,
        why: candidate.why,
        business_impact: candidate.business_impact,
        risk_if_ignored: candidate.risk_if_ignored,
        recommended_action: candidate.recommended_action,
        owner: candidate.owner,
      });
    }

    if (backfillCandidates.length > 0) {
      insightLog(`[Pipeline] Count enforcement: backfilled ${backfillCandidates.length} insights (${finalInsights.length} total, min ${MIN_INSIGHT_COUNT})`);
    }
  }

  // ── Post-Pass-3c: Domain balance enforcement ──
  // Ensure at least 2 insights from each source domain
  const MIN_PER_DOMAIN = 2;
  const domainInsightCounts: Record<string, number> = {};
  for (const domain of INSIGHT_DOMAINS) domainInsightCounts[domain.id] = 0;
  for (const ins of finalInsights) {
    const journey = journeyMap.get(ins.headline.toLowerCase());
    const domain = journey?.sourceDomain;
    if (domain && domainInsightCounts[domain] !== undefined) {
      domainInsightCounts[domain]++;
    }
  }

  const underrepresentedDomains = INSIGHT_DOMAINS.filter(d => (domainInsightCounts[d.id] || 0) < MIN_PER_DOMAIN);
  if (underrepresentedDomains.length > 0 && scoredCandidates.length > 0) {
    const usedHeadlinesForDomain = new Set(finalInsights.map(i => i.headline.toLowerCase()));
    for (const domain of underrepresentedDomains) {
      const needed = MIN_PER_DOMAIN - (domainInsightCounts[domain.id] || 0);
      const domainPromotable = scoredCandidates
        .filter(({ candidate }) =>
          candidate.sourceDomain === domain.id &&
          !usedHeadlinesForDomain.has(candidate.headline.toLowerCase())
        )
        .sort((a, b) => b.judgeScore - a.judgeScore)
        .slice(0, needed);

      for (const { candidate } of domainPromotable) {
        const mapping = SENTIMENT_TO_BUCKET[candidate.sentiment] || SENTIMENT_TO_BUCKET["neutral"];
        finalInsights.push({
          bucket: mapping.bucket,
          priority: mapping.priority,
          headline: candidate.headline,
          understory: candidate.understory,
          insight_type: candidate.insight_type as CategorizedInsight["insight_type"],
          source: candidate.source,
          severity_score: candidate.severity_score,
          impact: candidate.impact,
          evidence: candidate.evidence,
          for_podcast: candidate.for_podcast,
          what_changed: candidate.what_changed,
          why: candidate.why,
          business_impact: candidate.business_impact,
          risk_if_ignored: candidate.risk_if_ignored,
          recommended_action: candidate.recommended_action,
          owner: candidate.owner,
        });
        usedHeadlinesForDomain.add(candidate.headline.toLowerCase());
        // Update journey for promoted insight
        const journey = journeyMap.get(candidate.headline.toLowerCase());
        if (journey) {
          journey.curatorBucket = mapping.bucket;
          journey.curatorPriority = mapping.priority;
        }
      }

      if (domainPromotable.length > 0) {
        insightLog(`[Pipeline] Domain balance: promoted ${domainPromotable.length} insights for "${domain.id}" (had ${domainInsightCounts[domain.id] || 0}, min ${MIN_PER_DOMAIN})`);
      }
    }
  }

  // ── Pass 4: Evidence Agent (1 agent per insight, full parallel) ──
  const pass4Start = Date.now();
  try {
    await runAllEvidenceAgents(finalInsights, tenantPool, tenantId, apiKey, dateFilter, metricsPayload);
  } catch (evidenceError: any) {
    console.warn("[Pipeline] Evidence agent failed (continuing without evidence tables):", evidenceError.message);
  }
  _timings.evidence = Date.now() - pass4Start;
  _timings.total = Date.now() - startTime;
  insightLog(`[Pipeline] Pass 4 complete (${_timings.evidence}ms)`);

  // ── Audit: Merge pipeline context + journey into each insight's evidence_table.audit ──
  const pipelineCtx: PipelineContext = {
    generationBatch,
    dateFilter,
    channelGroup,
    metricsPrompt: metricsText,
    signalsText,
    signalCount: signals.length,
    generatorModel,
    generatorCandidateCount: candidates.length,
    judgeModel: judgeSystem ? judgeModel : undefined,
    curatorModel: curatorSystem ? curatorModel : undefined,
    domains: domainStats,
    stepTimings: {
      signals: _timings.signals || 0,
      rag: _timings.rag || 0,
      generator: _timings.generator || 0,
      factCheck: _timings.factCheck || 0,
      judge: _timings.judge || 0,
      curator: _timings.curator || 0,
      evidence: _timings.evidence || 0,
      total: _timings.total || 0,
    },
  };

  for (const ins of finalInsights) {
    const journey = journeyMap.get(ins.headline.toLowerCase());
    if (ins.evidence_table?.audit) {
      ins.evidence_table.audit.pipelineContext = pipelineCtx;
      ins.evidence_table.audit.insightJourney = journey || undefined;
    } else if (ins.evidence_table) {
      // Evidence table exists but has no audit (shouldn't happen, but be safe)
      ins.evidence_table.audit = {
        pipelineContext: pipelineCtx,
        insightJourney: journey || undefined,
        generatedSql: "",
        rowCount: ins.evidence_table.rows.length,
        rawSummary: [],
        resolvedSummary: [],
        finalSummary: [],
        corrections: [],
      };
    }
  }

  // ── Post-Processing: Hydrate detail snapshots from evidence tables ──
  try {
    await hydrateInsightDetails(finalInsights, metricsPayload, tenantPool, channelGroup);
  } catch (hydrateError: any) {
    console.warn("[Pipeline] Detail hydration failed (persisting without snapshots):", hydrateError.message);
  }

  // Diagnostic: log detail_data status for each insight
  const detailStats = { withDetail: 0, withoutDetail: 0, withEvidence: 0, withoutEvidence: 0 };
  for (const ins of finalInsights) {
    if (ins.evidence_table) detailStats.withEvidence++; else detailStats.withoutEvidence++;
    if (ins.detail_data) detailStats.withDetail++; else detailStats.withoutDetail++;
    if (!ins.detail_data) {
      const evStatus = ins.evidence_table
        ? `evidence exists (${ins.evidence_table.rows.length} rows, ${ins.evidence_table.columns.length} cols)`
        : "NO evidence_table";
      insightLogWarn(`[Pipeline] Missing detail_data: "${ins.headline.substring(0, 70)}" (source=${ins.source}) — ${evStatus}`);
    }
  }
  insightLog(`[Pipeline] Detail summary: ${detailStats.withDetail}/${finalInsights.length} have detail_data, ${detailStats.withEvidence}/${finalInsights.length} have evidence_table`);

  // Persist to tenant DB (unless caller requested skipPersist for append workflows)
  if (!skipPersist) {
    try {
      await persistInsights(tenantPool, finalInsights, generationBatch, dateFilter, channelGroup);
    } catch (persistError: any) {
      console.error("[Pipeline] Failed to persist insights (returning anyway):", persistError.message);
    }
  }

  // Build podcast summary
  const podcastParts: string[] = [];
  const criticals = finalInsights.filter((i) => i.bucket === "critical");
  const working = finalInsights.filter((i) => i.bucket === "working");
  if (criticals.length > 0) {
    podcastParts.push(`Critical: ${criticals.map((c) => c.headline).join(". ")}.`);
  }
  if (working.length > 0) {
    podcastParts.push(`Positive: ${working[0].headline}.`);
  }
  const summaryForPodcast = podcastParts.join(" ") || "No notable insights to report.";

  const totalElapsed = Date.now() - startTime;
  const summaryMsg = `[Pipeline] Full pipeline complete in ${totalElapsed}ms — ${finalInsights.length} insights (${criticals.length} critical, ${finalInsights.filter(i => i.bucket === "attention").length} attention, ${working.length} working, ${finalInsights.filter(i => i.bucket === "context").length} context)`;
  insightLogEnd(summaryMsg);

  return {
    insights: finalInsights,
    generationBatch,
    generatedAt: new Date().toISOString(),
    summaryForPodcast,
  };
}

// ============================================================================
// Legacy wrapper — backward compatibility with the old API
// ============================================================================

export async function generateLLMInsights(
  metricsPayload: InsightMetricsPayload,
  tenantId?: string,
  options: {
    useCache?: boolean;
    cacheTtlSeconds?: number;
    tenantPool?: pg.Pool;
    channelGroup?: string;
  } = {}
): Promise<LLMInsightsResponse> {
  // If no tenant pool provided, get one from the manager
  let pool = options.tenantPool;
  if (!pool && tenantId) {
    pool = await tenantDbManager.getTenantPool(tenantId);
  }

  if (!pool) {
    throw new Error("No tenant pool available for insight generation");
  }

  const result = await generateCategorizedInsights(
    metricsPayload,
    pool,
    tenantId,
    { channelGroup: options.channelGroup }
  );

  // Map categorized insights to legacy format
  const legacyInsights: GeneratedInsight[] = result.insights.map((ins) => ({
    type: ins.insight_type === "critical" ? "critical" : ins.insight_type,
    message: ins.headline,
    priority:
      ins.severity_score >= 0.8
        ? "critical"
        : ins.severity_score >= 0.55
          ? "high"
          : ins.severity_score >= 0.3
            ? "medium"
            : "low",
    reasoning: ins.understory,
    source: ins.source,
    forPodcast: ins.for_podcast,
  }));

  return {
    insights: legacyInsights,
    insightCount: legacyInsights.length,
    summaryForPodcast: result.summaryForPodcast,
  };
}

// Legacy cache stubs (no-ops now — DB is the cache)
export function clearCache(_tenantId?: string): void {
  /* no-op — insights are persisted to DB */
}
export function getFromCache(_cacheKey: string): null {
  return null;
}
export function setCache(
  _cacheKey: string,
  _data: any,
  _ttlSeconds?: number
): void {
  /* no-op */
}

// ============================================================================
// Single-bucket refresh — regenerates ALL insights via the pipeline,
// then returns the full set. The bucketId is kept for API compatibility
// but the pipeline always generates all buckets together.
// ============================================================================

export async function refreshSingleBucket(
  bucketId: string,
  metricsPayload: InsightMetricsPayload,
  tenantPool: pg.Pool,
  tenantId?: string,
  options: { channelGroup?: string } = {}
): Promise<CategorizedInsight[]> {
  const validBuckets = ["working", "attention", "critical", "context"];
  if (!validBuckets.includes(bucketId)) throw new Error(`Unknown bucket: ${bucketId}`);

  insightLog(`[Pipeline] Single-bucket refresh requested for "${bucketId}" — running full pipeline`);

  const result = await generateCategorizedInsights(metricsPayload, tenantPool, tenantId, options);
  return result.insights;
}

// ============================================================================
// Generate MORE insights — runs the full pipeline with skipPersist,
// filters to requested bucket, APPENDS only new unique insights, returns full set.
// ============================================================================

export async function generateMoreForBucket(
  bucketId: string,
  metricsPayload: InsightMetricsPayload,
  tenantPool: pg.Pool,
  tenantId?: string,
  options: { channelGroup?: string } = {}
): Promise<CategorizedInsight[]> {
  const validBuckets = ["working", "attention", "critical", "context"];
  if (!validBuckets.includes(bucketId)) throw new Error(`Unknown bucket: ${bucketId}`);

  const { channelGroup } = options;
  const dateFilter = metricsPayload.period.dateFilter;

  // Load existing insights so we can dedup
  const existing = await loadStoredInsights(tenantPool, dateFilter, channelGroup);
  const existingInsights = existing?.insights || [];
  const existingHeadlines = new Set(existingInsights.map(i => i.headline.toLowerCase()));

  console.log(
    `[Pipeline] Generate-more for "${bucketId}": ${existingInsights.length} existing ` +
    `(${existingInsights.filter(i => i.bucket === bucketId).length} in bucket)`
  );

  // Run the full pipeline but SKIP persistence (we'll append manually)
  const result = await generateCategorizedInsights(
    metricsPayload, tenantPool, tenantId,
    { ...options, skipPersist: true }
  );

  // Filter to requested bucket only, and exclude duplicates of existing insights
  const newForBucket = result.insights.filter(
    ins => ins.bucket === bucketId && !existingHeadlines.has(ins.headline.toLowerCase())
  );

  if (newForBucket.length === 0) {
    insightLog(`[Pipeline] Generate-more: no new unique insights for "${bucketId}" — returning existing`);
    return existingInsights;
  }

  // Append only the new bucket insights to the DB (existing insights untouched)
  const generationBatch = crypto.randomUUID();
  await appendInsights(tenantPool, newForBucket, generationBatch, dateFilter, channelGroup);

  console.log(
    `[Pipeline] Generate-more: appended ${newForBucket.length} new insights for "${bucketId}"`
  );

  // Load and return the full set (existing + newly appended)
  const freshLoad = await loadStoredInsights(tenantPool, dateFilter, channelGroup);
  return freshLoad?.insights || [...existingInsights, ...newForBucket];
}

/**
 * Append insights to the DB WITHOUT deleting existing ones.
 * Used by generate-more to add new bucket insights alongside existing data.
 */
async function appendInsights(
  tenantPool: pg.Pool,
  insights: CategorizedInsight[],
  generationBatch: string,
  dateFilter: string,
  channelGroup?: string,
): Promise<void> {
  if (insights.length === 0) return;

  // Check which optional columns exist
  let hasExperimentCol = false;
  let hasDetailDataCol = false;
  try {
    const colCheck = await tenantPool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'generated_insights' AND column_name IN ('experiment_id', 'detail_data')
    `);
    for (const row of colCheck.rows) {
      if (row.column_name === "experiment_id") hasExperimentCol = true;
      if (row.column_name === "detail_data") hasDetailDataCol = true;
    }
  } catch { /* ignore */ }

  const values: any[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (const ins of insights) {
    const baseCount = 15;
    const extraCount = (hasExperimentCol ? 1 : 0) + (hasDetailDataCol ? 1 : 0);
    const totalParams = baseCount + extraCount;
    const ph = Array.from({ length: totalParams }, () => `$${paramIdx++}`);
    placeholders.push(`(${ph.join(", ")})`);

    const evidenceWithEtm = {
      ...(ins.evidence || {}),
      ...(ins.what_changed ? { what_changed: ins.what_changed } : {}),
      ...(ins.why ? { why: ins.why } : {}),
      ...(ins.business_impact ? { business_impact: ins.business_impact } : {}),
      ...(ins.risk_if_ignored ? { risk_if_ignored: ins.risk_if_ignored } : {}),
      ...(ins.recommended_action ? { recommended_action: ins.recommended_action } : {}),
      ...(ins.owner ? { owner: ins.owner } : {}),
    };

    values.push(
      ins.bucket,
      ins.priority,
      ins.headline,
      ins.understory,
      ins.insight_type,
      ins.source,
      ins.severity_score,
      JSON.stringify(ins.impact),
      JSON.stringify(evidenceWithEtm),
      ins.for_podcast,
      dateFilter,
      channelGroup || null,
      generationBatch,
      new Date().toISOString(),
      ins.detail_query ? JSON.stringify(ins.detail_query) : null,
    );
    if (hasDetailDataCol) {
      values.push(ins.detail_data ? JSON.stringify(ins.detail_data) : null);
    }
    if (hasExperimentCol) {
      values.push(null); // no experiment for generate-more
    }
  }

  let columnList = `bucket, priority, headline, understory, insight_type, source,
       severity_score, impact, evidence, for_podcast,
       date_filter, channel_group, generation_batch, generated_at, detail_query`;
  if (hasDetailDataCol) columnList += `, detail_data`;
  if (hasExperimentCol) columnList += `, experiment_id`;
  const columns = `(${columnList})`;

  await tenantPool.query(
    `INSERT INTO generated_insights ${columns}
     VALUES ${placeholders.join(", ")}`,
    values
  );

  insightLog(`[Pipeline] Appended ${insights.length} insights (batch: ${generationBatch})`);
}

// ============================================================================
// Delete a single insight by DB id
// ============================================================================

export async function deleteInsightById(
  tenantPool: pg.Pool,
  insightId: number
): Promise<boolean> {
  const result = await tenantPool.query(
    `DELETE FROM generated_insights WHERE id = $1`,
    [insightId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Legacy BUCKETS export for backward compatibility
const BUCKETS = [
  { id: "working", promptId: "insights.generator", priority: "BLUE" as const },
  { id: "attention", promptId: "insights.generator", priority: "YELLOW" as const },
  { id: "critical", promptId: "insights.generator", priority: "RED" as const },
  { id: "context", promptId: "insights.generator", priority: "GRAY" as const },
] as const;

export { BUCKETS };

export default {
  generateLLMInsights,
  generateCategorizedInsights,
  loadStoredInsights,
  refreshSingleBucket,
  generateMoreForBucket,
  deleteInsightById,
  clearCache,
  getFromCache,
  setCache,
};
