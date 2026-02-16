/**
 * LLM Insight Generator — Categorized & Persisted
 *
 * Generates executive insights across 4 parallel bucket-specific prompts:
 *   - Working (Blue)    — what's performing well
 *   - Attention (Yellow) — what needs monitoring
 *   - Critical (Red)     — high-risk / high-loss items
 *   - Context (Gray)     — trends, comparisons, portfolio snapshot
 *
 * Results are persisted to the tenant `generated_insights` table.
 * In-memory caching has been removed — the database IS the cache.
 */

import pg from "pg";
import crypto from "crypto";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import { pool as managementPool } from "../../config/managementDatabase.js";
import { decryptAPIKeys } from "../encryption.js";
import { InsightMetricsPayload, PeriodSnapshot } from "./insightMetricsCollector.js";
import { getPromptConfig, buildPrompt } from "../promptConfigService.js";

// ============================================================================
// Types
// ============================================================================

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
  /** LLM-chosen columns for the detail drill-down table. */
  detail_columns?: string[];
  /** LLM-chosen summary metrics for the detail drill-down cards. */
  summary_metrics?: string[];
  /** Exact filter params for replaying the detail query at drill-down time. */
  detail_query?: Record<string, any> | null;
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
// Bucket definitions
// ============================================================================

const BUCKETS = [
  { id: "working", promptId: "insights.working", priority: "BLUE" as const },
  {
    id: "attention",
    promptId: "insights.attention",
    priority: "YELLOW" as const,
  },
  { id: "critical", promptId: "insights.critical", priority: "RED" as const },
  { id: "context", promptId: "insights.context", priority: "GRAY" as const },
] as const;

type BucketId = (typeof BUCKETS)[number]["id"];
type BucketPriority = (typeof BUCKETS)[number]["priority"];

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

function buildMetricsUserPrompt(metrics: InsightMetricsPayload): string {
  const fmt$ = (v: number) => {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  };
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  // Helper: format a snapshot row with period-over-period comparison
  const fmtSnap = (label: string, cur: PeriodSnapshot, prior?: PeriodSnapshot): string => {
    const parts = [
      `${label}: ${cur.totalApplications} apps, ${cur.completed} completed, ${cur.funded} funded`,
      `  PT: ${fmtPct(cur.pullThroughRate)}  |  Fallout: ${fmtPct(cur.falloutRate)}  |  Cycle: ${cur.avgCycleTime}d`,
      `  Volume: ${fmt$(cur.fundedVolume)}  |  GOS Revenue: ${fmt$(cur.fundedRevenue)}`,
    ];
    if (prior && prior.completed > 0) {
      const volDelta = prior.fundedVolume > 0 ? ((cur.fundedVolume - prior.fundedVolume) / prior.fundedVolume * 100) : 0;
      const ptDelta = cur.pullThroughRate - prior.pullThroughRate;
      const cycleDelta = cur.avgCycleTime - prior.avgCycleTime;
      parts.push(
        `  vs Prior: Vol ${fmt$(prior.fundedVolume)}→${fmt$(cur.fundedVolume)} (${volDelta > 0 ? "+" : ""}${fmtPct(volDelta)})` +
        ` | PT ${fmtPct(prior.pullThroughRate)}→${fmtPct(cur.pullThroughRate)} (${ptDelta > 0 ? "+" : ""}${ptDelta.toFixed(1)}pp)` +
        ` | Cycle ${prior.avgCycleTime}d→${cur.avgCycleTime}d (${cycleDelta > 0 ? "+" : ""}${cycleDelta}d)`
      );
    }
    return parts.join("\n");
  };

  const snaps = metrics.periodSnapshots;

  return `Analyze these mortgage business metrics for your designated insight category.

=== PERIOD ===
Date Filter: ${metrics.period.dateFilter.toUpperCase()}
Range: ${metrics.period.start || "N/A"} to ${metrics.period.end || "N/A"}

=== PIPELINE (Current Active Loans) ===
- Active Loans: ${metrics.pipeline.activeLoans}
- Active Volume: ${fmt$(metrics.pipeline.activeVolume)}
- Locked Loans: ${metrics.pipeline.lockedLoans}
- Closed Loans: ${metrics.pipeline.closedLoans}
- Closed Volume: ${fmt$(metrics.pipeline.closedVolume)}

=== CONVERSION METRICS — Unified (Pull-Through + Fallout = 100% in every row) ===
IMPORTANT: These metrics are computed from the SAME population in each row.
Pull-Through = funded loans / completed loans. Fallout = non-funded completed / completed loans.
They ALWAYS sum to 100%. When citing a rate, ALWAYS include its timeframe.

${fmtSnap("YTD", snaps.ytd, snaps.priorYtd)}

${fmtSnap("Rolling 90D", snaps.rolling90d, snaps.prior90d)}

${fmtSnap("Rolling 60D", snaps.rolling60d, snaps.prior60d)}

${fmtSnap("Rolling 30D", snaps.rolling30d, snaps.prior30d)}

${fmtSnap("MTD", snaps.mtd, snaps.priorMtd)}

RULES FOR CONVERSION METRICS:
1. ALWAYS state the timeframe when citing PT or Fallout (e.g. "PT 56.7% YTD", not just "PT 56.7%")
2. NEVER mix timeframes (e.g. "PT is 56.7% but Fallout is 43.3%" must come from the SAME row)
3. Use the "vs Prior" deltas above — do NOT compute your own from rounded numbers
4. When comparing trends, look at 30D vs 60D vs 90D to identify acceleration/deceleration

=== FALLOUT PREDICTIONS (AI Model) ===
ALL predicted withdraw/deny (any confidence):
- Predicted Withdraw: ${metrics.predictions.likelyWithdraw} loans
- Predicted Deny: ${metrics.predictions.likelyDeny} loans
- Total at-risk loans: ${metrics.predictions.allAtRiskLoanIds.length}
- Total at-risk volume (all withdraw + deny): ${fmt$(metrics.predictions.allAtRiskVolume)}

HIGH-CONFIDENCE subset (>= 70% fallout probability only):
- High-confidence at-risk loans: ${metrics.predictions.highRiskLoans.length} loans
- High-confidence at-risk volume: ${fmt$(metrics.predictions.highRiskVolume)}
${
  metrics.predictions.highRiskLoans.length > 0
    ? `- Top Risk Factors: ${[
        ...new Set(
          metrics.predictions.highRiskLoans.flatMap((l) => l.riskFactors)
        ),
      ]
        .slice(0, 5)
        .join(", ")}`
    : ""
}
- Predicted Originate: ${metrics.predictions.likelyOriginate} loans

IMPORTANT: Do NOT mix these two groups. If you cite the number of all withdraw/deny loans, use the "all" volume. If you cite the >70% subset, use the "high-confidence" volume. Never pair one group's count with the other group's volume.

=== CREDIT RISK PROFILE ===
- Weighted Avg FICO: ${Math.round(metrics.creditRisk.waFico)}
- Weighted Avg LTV: ${fmtPct(metrics.creditRisk.waLtv)}
- Weighted Avg DTI: ${fmtPct(metrics.creditRisk.waDti)}
- Loans meeting high-risk criteria (FICO<620 OR LTV>95% OR DTI>50%): ${metrics.creditRisk.highRiskLoanCount}
- High-risk credit loan volume: ${fmt$(metrics.creditRisk.highRiskVolume)}

=== LOST OPPORTUNITY (YTD) ===
- Withdrawn Loans: ${metrics.lostOpportunity.withdrawnUnits}
- Withdrawn Volume: ${fmt$(metrics.lostOpportunity.withdrawnVolume)}
- Lost Proforma Revenue: ${fmt$(metrics.lostOpportunity.withdrawnProformaRevenue)}
- Denied Loans: ${metrics.lostOpportunity.deniedUnits}
- Denied Volume: ${fmt$(metrics.lostOpportunity.deniedVolume)}

=== CLOSING RISK (B3) ===
- Loans closing within 10 days without CTC: ${metrics.closingRisk.atRiskCount}
- At-risk closing volume: ${fmt$(metrics.closingRisk.atRiskVolume)}
- Avg days to close: ${metrics.closingRisk.avgDaysToClose}

=== LOCK EXPIRATION (C1) ===
- Locked loans expiring within 7 days without CTC: ${metrics.lockExpiration.expiringCount}
- Expiring volume: ${fmt$(metrics.lockExpiration.expiringVolume)}
- Avg days to expiry: ${metrics.lockExpiration.avgDaysToExpiry}

=== TRID EXPOSURE (G1) ===
- Loans closing within 5 days without CD sent: ${metrics.tridExposure.atRiskCount}
- Avg days to close: ${metrics.tridExposure.avgDaysToClose}

=== MARGIN (C2) ===
- Current month avg gain-on-sale margin: ${metrics.marginData.currentMonthBps} bps
- Prior month avg gain-on-sale margin: ${metrics.marginData.priorMonthBps} bps
- Delta: ${metrics.marginData.deltaBps > 0 ? "+" : ""}${metrics.marginData.deltaBps} bps

=== CONDITION BACKLOG (D2) ===
- Avg conditions per active loan: ${metrics.conditionBacklog.avgConditions}
- Loans with >10 outstanding conditions: ${metrics.conditionBacklog.highConditionCount}

=== PERSONNEL TIERING (YTD, Revenue-Based Pareto Tiers: Top ≤50% cumulative rev, Second 50-80%, Bottom >80%) ===
CRITICAL: "GOS" = Gain-On-Sale revenue (fees + margin, typically $2K-$20K per loan). "Vol" = Total funded loan amounts (typically $200K-$800K per loan). GOS revenue is ~1-3% of volume. NEVER label a value in the millions as "revenue" for an individual officer — that is almost certainly "volume".
${metrics.tiering.byActorType.length > 0
    ? metrics.tiering.byActorType.map(t => {
        const topPct = t.totalActors > 0 ? Math.round((t.tierDistribution.top / t.totalActors) * 100) : 0;
        const bottomPct = t.totalActors > 0 ? Math.round((t.tierDistribution.bottom / t.totalActors) * 100) : 0;
        // Distinct label+format helpers so the LLM NEVER confuses gain-on-sale revenue with funded volume
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

        // Build per-officer period change lookup: name → changes[]
        const periodByName = new Map<string, typeof t.periodChanges>();
        if (t.periodChanges) {
          for (const c of t.periodChanges) {
            const existing = periodByName.get(c.name) || [];
            existing.push(c);
            periodByName.set(c.name, existing);
          }
        }

        // Format an officer with inline period data
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
    : "No tiering data available."}

=== BASELINES (for threshold comparison) ===
- Pull-Through YTD: ${fmtPct(snaps.ytd.pullThroughRate)}
- Pull-Through 90D Rolling: ${fmtPct(snaps.rolling90d.pullThroughRate)}
- Fallout YTD: ${fmtPct(snaps.ytd.falloutRate)}
- Cycle Time YTD: ${snaps.ytd.avgCycleTime} days
- Active Pipeline Size: ${metrics.pipeline.activeLoans} loans

Generate insights for your designated category now. Only output insights supported by this data. If a metric is 0 or N/A, do not generate an insight about it.`;
}

// ============================================================================
// OpenAI call
// ============================================================================

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  options: { model?: string; temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const {
    model = "gpt-4o-mini",
    temperature = 0.5,
    maxTokens = 4500,
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
      max_tokens: maxTokens,
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
  };
  return data.choices?.[0]?.message?.content || "";
}

// ============================================================================
// Build detail_query filters for each insight based on source + metrics payload
// ============================================================================

/**
 * Given a parsed insight and the original metrics data, compute the exact
 * filter parameters that the detail endpoint should use to pull the rows
 * backing this insight.  This means the drill-down will show EXACTLY the
 * loans/officers/months the insight describes — no more, no less.
 */
function buildDetailFilters(
  insight: CategorizedInsight,
  metrics: InsightMetricsPayload
): Record<string, any> | null {
  const src = insight.source;

  switch (src) {
    case "predictions": {
      const hl = insight.headline.toLowerCase();

      // Determine narrower outcome filter from the headline
      let outcomes = ["withdraw", "deny"];
      if (hl.includes("withdraw") && !hl.includes("deny")) {
        outcomes = ["withdraw"];
      } else if (hl.includes("deny") && !hl.includes("withdraw")) {
        outcomes = ["deny"];
      }

      // Decide which set of loan IDs to use based on the headline:
      //  - If it mentions ">70%" or "high confidence" → use the highRiskLoans subset
      //  - Otherwise (general "predicted to withdraw") → use ALL at-risk loan IDs
      const mentionsHighConf = />(60|70|80|90)%/.test(hl) || hl.includes("high-confidence") || hl.includes("high confidence");

      if (mentionsHighConf) {
        const highRiskIds = metrics.predictions.highRiskLoans.map((l) => l.loanId);
        if (highRiskIds.length === 0) return null;
        return {
          type: "predictions",
          loan_ids: highRiskIds,
          confidence_min: 70,
          outcomes,
        };
      } else {
        // All withdraw/deny predictions (any confidence)
        const allIds = metrics.predictions.allAtRiskLoanIds;
        if (!allIds || allIds.length === 0) return null;
        return {
          type: "predictions",
          loan_ids: allIds,
          confidence_min: 0,
          outcomes,
        };
      }
    }

    case "credit_risk": {
      // Store the EXACT loan IDs from the metrics collector
      const creditIds = metrics.creditRisk.highRiskLoanIds;
      if (!creditIds || creditIds.length === 0) return null;

      return {
        type: "credit_risk",
        loan_ids: creditIds,
      };
    }

    case "lost_opportunity": {
      // Store the EXACT loan IDs from the metrics collector
      const hl = insight.headline.toLowerCase();
      const mentionsWithdrawn = hl.includes("withdrawn") || hl.includes("withdraw");
      const mentionsDenied = hl.includes("denied") || hl.includes("deny");

      let loanIds: string[];
      if (mentionsWithdrawn && !mentionsDenied) {
        loanIds = metrics.lostOpportunity.withdrawnLoanIds || [];
      } else if (mentionsDenied && !mentionsWithdrawn) {
        loanIds = metrics.lostOpportunity.deniedLoanIds || [];
      } else {
        loanIds = [
          ...(metrics.lostOpportunity.withdrawnLoanIds || []),
          ...(metrics.lostOpportunity.deniedLoanIds || []),
        ];
      }
      if (loanIds.length === 0) return null;

      return {
        type: "lost_opportunity",
        loan_ids: loanIds,
      };
    }

    case "pipeline": {
      const hl = insight.headline.toLowerCase();
      const daysMatch = hl.match(/(?:over|>|exceeding|beyond)\s*(\d+)\s*days?/i);
      const minDays = daysMatch ? parseInt(daysMatch[1]) : null;
      let lockFilter: string | null = null;
      if (hl.includes("unlocked") && !hl.includes("locked")) {
        lockFilter = "unlocked";
      } else if (hl.includes("locked") && !hl.includes("unlocked")) {
        lockFilter = "locked";
      }
      return {
        type: "pipeline",
        min_days: minDays,
        lock_filter: lockFilter,
      };
    }

    case "performance": {
      // Extract officer names mentioned in the insight so the detail drilldown
      // can filter to just those officers (same approach as tiering).
      const perfHl = insight.headline.toLowerCase();

      // Gather all known actor names from tiering data
      const tieringActors = metrics.tiering?.byActorType?.flatMap(t =>
        [...(t.topPerformers || []), ...(t.bottomPerformers || [])].map(p => p.name)
      ) || [];
      const periodActors = metrics.tiering?.byActorType?.flatMap(t =>
        (t.periodChanges || []).map(c => c.name)
      ) || [];
      const knownPerfNames = [...new Set([...tieringActors, ...periodActors])];

      // Match names from headline + understory
      const perfText = `${insight.headline} ${insight.understory}`;
      const mentionedPerfNames = knownPerfNames.filter(name =>
        perfText.toLowerCase().includes(name.toLowerCase())
      );

      // Store per-officer snapshot values from tiering data for consistency
      const allTierActors = metrics.tiering?.byActorType?.flatMap(t =>
        [...(t.topPerformers || []), ...(t.bottomPerformers || [])]
      ) || [];
      const perfSnapshots: Record<string, { units: number; revenue: number; volume: number; pullThrough: number }> = {};
      for (const name of mentionedPerfNames) {
        const actor = allTierActors.find(a => a.name.toLowerCase() === name.toLowerCase());
        if (actor) {
          perfSnapshots[actor.name] = {
            units: actor.units,
            revenue: actor.revenue,
            volume: actor.volume,
            pullThrough: actor.pullThrough,
          };
        }
      }

      return {
        type: "performance",
        ...(mentionedPerfNames.length > 0 ? { actorNames: mentionedPerfNames } : {}),
        ...(Object.keys(perfSnapshots).length > 0 ? { actorSnapshots: perfSnapshots } : {}),
      };
    }

    case "comparisons": {
      return { type: "comparisons" };
    }

    case "closing_risk": {
      const ids = metrics.closingRisk.loanIds;
      if (!ids || ids.length === 0) return null;
      return { type: "closing_risk", loan_ids: ids };
    }

    case "lock_expiration": {
      const ids = metrics.lockExpiration.loanIds;
      if (!ids || ids.length === 0) return null;
      return { type: "lock_expiration", loan_ids: ids };
    }

    case "trid": {
      const ids = metrics.tridExposure.loanIds;
      if (!ids || ids.length === 0) return null;
      return { type: "trid", loan_ids: ids };
    }

    case "margin": {
      return {
        type: "margin",
        currentMonthBps: metrics.marginData.currentMonthBps,
        priorMonthBps: metrics.marginData.priorMonthBps,
        deltaBps: metrics.marginData.deltaBps,
      };
    }

    case "condition_backlog": {
      const ids = metrics.conditionBacklog.highConditionLoanIds;
      return {
        type: "condition_backlog",
        loan_ids: ids,
        avgConditions: metrics.conditionBacklog.avgConditions,
      };
    }

    case "tiering": {
      // Determine which actor type(s) the insight covers
      const hl = insight.headline.toLowerCase();
      let actorType: "loan_officer" | "branch" = "loan_officer";
      if (hl.includes("branch")) {
        actorType = "branch";
      }

      // Extract officer names mentioned in the insight so the detail drilldown
      // can filter to just those officers instead of showing all 39
      const allTieringActors = metrics.tiering.byActorType.flatMap(t =>
        [...t.topPerformers, ...t.bottomPerformers].map(p => p.name)
      );
      // Also include all actors from periodChanges
      const periodActors = metrics.tiering.byActorType.flatMap(t =>
        (t.periodChanges || []).map(c => c.name)
      );
      const allKnownNames = [...new Set([...allTieringActors, ...periodActors])];
      // Match names that appear in headline or understory (case-insensitive)
      const text = `${insight.headline} ${insight.understory}`;
      const mentionedNames = allKnownNames.filter(name =>
        text.toLowerCase().includes(name.toLowerCase())
      );

      // Store per-officer snapshot values at generation time so the detail modal
      // can display them exactly as the headline references them (consistency).
      const allActors = metrics.tiering.byActorType.flatMap(t =>
        [...t.topPerformers, ...t.bottomPerformers]
      );
      const actorSnapshots: Record<string, { units: number; revenue: number; volume: number; pullThrough: number }> = {};
      for (const name of mentionedNames) {
        const actor = allActors.find(a => a.name.toLowerCase() === name.toLowerCase());
        if (actor) {
          actorSnapshots[actor.name] = {
            units: actor.units,
            revenue: actor.revenue,
            volume: actor.volume,
            pullThrough: actor.pullThrough,
          };
        }
      }

      return {
        type: "tiering",
        actorType,
        // If specific officers are mentioned, pass their names for filtering
        ...(mentionedNames.length > 0 ? { actorNames: mentionedNames } : {}),
        // Snapshot of each officer's metrics at generation time for detail consistency
        ...(Object.keys(actorSnapshots).length > 0 ? { actorSnapshots } : {}),
      };
    }

    default:
      return null;
  }
}

// ============================================================================
// Parse & validate a single bucket's LLM response
// ============================================================================

function parseBucketResponse(
  responseText: string,
  bucketId: BucketId,
  bucketPriority: BucketPriority
): CategorizedInsight[] {
  try {
    const parsed = JSON.parse(responseText);
    if (!parsed.insights || !Array.isArray(parsed.insights)) {
      return [];
    }

    const validTypes = ["success", "warning", "critical", "info"];
    const validSources = [
      "predictions",
      "performance",
      "pipeline",
      "credit_risk",
      "lost_opportunity",
      "comparisons",
      "closing_risk",
      "lock_expiration",
      "trid",
      "margin",
      "condition_backlog",
      "tiering",
    ];

    return parsed.insights.map((ins: any) => ({
      bucket: bucketId,
      priority: bucketPriority,
      headline: String(ins.headline || ins.message || ""),
      understory: String(ins.understory || ins.reasoning || ""),
      insight_type: validTypes.includes(ins.insight_type || ins.type)
        ? (ins.insight_type || ins.type)
        : "info",
      source: validSources.includes(ins.source) ? ins.source : "performance",
      severity_score: Math.min(
        1,
        Math.max(0, parseFloat(ins.severity_score) || 0.5)
      ),
      impact: {
        type: ins.impact?.type || null,
        estimated_dollars: ins.impact?.estimated_dollars ?? null,
        units_affected: ins.impact?.units_affected ?? null,
      },
      evidence: {
        metrics: Array.isArray(ins.evidence?.metrics)
          ? ins.evidence.metrics
          : [],
        comparisons: Array.isArray(ins.evidence?.comparisons)
          ? ins.evidence.comparisons
          : [],
      },
      for_podcast: ins.for_podcast !== false,
      detail_columns: Array.isArray(ins.detail_columns) ? ins.detail_columns : undefined,
      summary_metrics: Array.isArray(ins.summary_metrics) ? ins.summary_metrics : undefined,
    }));
  } catch (error) {
    console.error(
      `[LLMInsights] Failed to parse ${bucketId} bucket response:`,
      error
    );
    return [];
  }
}

// ============================================================================
// Generate a single bucket
// ============================================================================

/**
 * Fetch active training examples for a given prompt from the management DB.
 * Returns up to 3 positive and 2 negative examples for few-shot injection.
 */
async function fetchTrainingExamples(promptId: string): Promise<{
  positive: Array<{ headline: string; admin_note?: string }>;
  negative: Array<{ headline: string; admin_note?: string }>;
}> {
  try {
    if (!managementPool) return { positive: [], negative: [] };

    // Check if the table exists (graceful handling for pre-migration environments)
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
    console.warn("[LLMInsights] Failed to fetch training examples:", error);
    return { positive: [], negative: [] };
  }
}

async function generateBucket(
  bucketId: BucketId,
  promptId: string,
  bucketPriority: BucketPriority,
  metricsPayload: InsightMetricsPayload,
  apiKey: string,
  existingHeadlines?: string[],
  experimentOverrides?: { systemPrompt?: string; model?: string; temperature?: number; maxTokens?: number; experimentId?: string }
): Promise<CategorizedInsight[]> {
  let systemPrompt: string;
  let model = "gpt-4o-mini";
  let temperature = 0.5;
  let maxTokens = 4500;

  // If experiment overrides are provided, use them instead of the default prompt config
  if (experimentOverrides?.systemPrompt) {
    systemPrompt = experimentOverrides.systemPrompt;
    model = experimentOverrides.model || model;
    temperature = experimentOverrides.temperature ?? temperature;
    maxTokens = experimentOverrides.maxTokens || maxTokens;
  } else {
    try {
      const config = await getPromptConfig(promptId);
      systemPrompt = config.system_prompt;
      model = config.model || model;
      temperature = config.temperature ?? temperature;
      maxTokens = config.max_tokens || maxTokens;
    } catch {
      console.warn(
        `[LLMInsights] Prompt config "${promptId}" not found in DB, skipping bucket "${bucketId}"`
      );
      return [];
    }
  }

  // Inject training examples (few-shot) from the management DB
  const trainingExamples = await fetchTrainingExamples(promptId);
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
    systemPrompt += trainingSection;
    console.log(`[LLMInsights] Bucket "${bucketId}" — injected ${trainingExamples.positive.length} positive + ${trainingExamples.negative.length} negative training examples`);
  }

  // When generating MORE insights, tell the LLM what already exists so it doesn't duplicate
  if (existingHeadlines && existingHeadlines.length > 0) {
    systemPrompt += `\n\nALREADY GENERATED — do NOT repeat or rephrase any of these insights. Generate DIFFERENT insights covering OTHER topics, officers, or metrics:\n${existingHeadlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}`;
  }

  const userPrompt = buildMetricsUserPrompt(metricsPayload);

  console.log(
    `[LLMInsights] Bucket "${bucketId}" — system prompt: ${systemPrompt.length} chars, user prompt: ${userPrompt.length} chars, model: ${model}, maxTokens: ${maxTokens}`
  );

  const responseText = await callOpenAI(systemPrompt, userPrompt, apiKey, {
    model,
    temperature,
    maxTokens,
  });

  console.log(
    `[LLMInsights] Bucket "${bucketId}" — raw LLM response (first 800 chars): ${responseText.substring(0, 800)}`
  );

  const insights = parseBucketResponse(responseText, bucketId, bucketPriority);

  // Log which sources are present
  const sources = insights.map(i => i.source);
  const hasTiering = sources.includes("tiering");
  console.log(
    `[LLMInsights] Bucket "${bucketId}" — ${insights.length} insights, sources: [${[...new Set(sources)].join(", ")}], hasTiering: ${hasTiering}`
  );

  // Attach detail filters based on the metrics payload so drill-down
  // queries exactly match the data the insight was generated from.
  // Also merge LLM-chosen display preferences (detail_columns, summary_metrics).
  for (const insight of insights) {
    const filters = buildDetailFilters(insight, metricsPayload);
    insight.detail_query = {
      ...(filters || {}),
      ...(insight.detail_columns ? { detail_columns: insight.detail_columns } : {}),
      ...(insight.summary_metrics ? { summary_metrics: insight.summary_metrics } : {}),
    };
    // If filters was null and we only have display config, still store it
    if (!filters && !insight.detail_columns && !insight.summary_metrics) {
      insight.detail_query = null;
    }
  }

  return insights;
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

  // Check if experiment_id column exists (graceful for pre-migration tenants)
  let hasExperimentCol = false;
  try {
    const colCheck = await tenantPool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'generated_insights' AND column_name = 'experiment_id'
    `);
    hasExperimentCol = colCheck.rows.length > 0;
  } catch { /* ignore */ }

  // Batch insert
  const values: any[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (const ins of insights) {
    const expId = experimentIdMap?.[ins.bucket] || null;
    if (hasExperimentCol) {
      placeholders.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
      );
      values.push(
        ins.bucket,
        ins.priority,
        ins.headline,
        ins.understory,
        ins.insight_type,
        ins.source,
        ins.severity_score,
        JSON.stringify(ins.impact),
        JSON.stringify(ins.evidence),
        ins.for_podcast,
        dateFilter,
        channelGroup || null,
        generationBatch,
        new Date().toISOString(),
        ins.detail_query ? JSON.stringify(ins.detail_query) : null,
        expId
      );
    } else {
      placeholders.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
      );
      values.push(
        ins.bucket,
        ins.priority,
        ins.headline,
        ins.understory,
        ins.insight_type,
        ins.source,
        ins.severity_score,
        JSON.stringify(ins.impact),
        JSON.stringify(ins.evidence),
        ins.for_podcast,
        dateFilter,
        channelGroup || null,
        generationBatch,
        new Date().toISOString(),
        ins.detail_query ? JSON.stringify(ins.detail_query) : null
      );
    }
  }

  const columns = hasExperimentCol
    ? `(bucket, priority, headline, understory, insight_type, source,
       severity_score, impact, evidence, for_podcast,
       date_filter, channel_group, generation_batch, generated_at, detail_query, experiment_id)`
    : `(bucket, priority, headline, understory, insight_type, source,
       severity_score, impact, evidence, for_podcast,
       date_filter, channel_group, generation_batch, generated_at, detail_query)`;

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
  channelGroup?: string
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

    const result = await tenantPool.query(
      `SELECT * FROM generated_insights
       WHERE date_filter = $1
         AND COALESCE(channel_group, '') = COALESCE($2, '')
       ORDER BY
         CASE bucket
           WHEN 'critical' THEN 0
           WHEN 'attention' THEN 1
           WHEN 'working' THEN 2
           WHEN 'context' THEN 3
         END,
         severity_score DESC`,
      [dateFilter, channelGroup || null]
    );

    if (result.rows.length === 0) return null;

    const insights: CategorizedInsight[] = result.rows.map((row: any) => ({
      id: row.id,
      bucket: row.bucket,
      priority: row.priority,
      headline: row.headline,
      understory: row.understory,
      insight_type: row.insight_type,
      source: row.source,
      severity_score: parseFloat(row.severity_score) || 0,
      impact: row.impact || {},
      evidence: row.evidence || {},
      for_podcast: row.for_podcast,
      detail_query: row.detail_query || null,
    }));

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
// Main entry point — generate categorized insights (4 parallel LLM calls)
// ============================================================================

export async function generateCategorizedInsights(
  metricsPayload: InsightMetricsPayload,
  tenantPool: pg.Pool,
  tenantId?: string,
  options: { channelGroup?: string } = {}
): Promise<CategorizedInsightsResponse> {
  const { channelGroup } = options;
  const dateFilter = metricsPayload.period.dateFilter;
  const generationBatch = crypto.randomUUID();

  console.log(
    `[LLMInsights] Generating categorized insights (batch: ${generationBatch}, tenant: ${tenantId || "default"}, dateFilter: ${dateFilter})`
  );

  const apiKey = await getOpenAIKey(tenantId);
  const startTime = Date.now();

  // Check for active experiments per bucket (parallel)
  const experimentSelections = await Promise.all(
    BUCKETS.map((bucket) => selectExperiment(bucket.promptId))
  );

  // Call all 4 buckets in parallel, passing experiment overrides if selected
  const results = await Promise.allSettled(
    BUCKETS.map((bucket, idx) =>
      generateBucket(
        bucket.id as BucketId,
        bucket.promptId,
        bucket.priority,
        metricsPayload,
        apiKey,
        undefined,
        experimentSelections[idx] || undefined
      )
    )
  );

  // Merge results, logging any failures
  const allInsights: CategorizedInsight[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const bucket = BUCKETS[i];
    if (r.status === "fulfilled") {
      console.log(
        `[LLMInsights] Bucket "${bucket.id}": ${r.value.length} insights`
      );
      allInsights.push(...r.value);
    } else {
      console.error(
        `[LLMInsights] Bucket "${bucket.id}" failed:`,
        r.reason?.message || r.reason
      );
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(
    `[LLMInsights] All buckets completed in ${elapsed}ms — ${allInsights.length} total insights`
  );

  // Build experiment ID map: bucket -> experimentId (if an experiment was used)
  const experimentIdMap: Record<string, string | undefined> = {};
  for (let i = 0; i < BUCKETS.length; i++) {
    const expSel = experimentSelections[i];
    if (expSel?.experimentId) {
      experimentIdMap[BUCKETS[i].id] = expSel.experimentId;
    }
  }

  // Persist to tenant DB
  try {
    await persistInsights(
      tenantPool,
      allInsights,
      generationBatch,
      dateFilter,
      channelGroup,
      Object.keys(experimentIdMap).length > 0 ? experimentIdMap : undefined
    );
  } catch (persistError: any) {
    console.error(
      "[LLMInsights] Failed to persist insights (returning anyway):",
      persistError.message
    );
  }

  // Build a brief podcast summary from the critical + working headlines
  const podcastParts: string[] = [];
  const criticals = allInsights.filter((i) => i.bucket === "critical");
  const working = allInsights.filter((i) => i.bucket === "working");
  if (criticals.length > 0) {
    podcastParts.push(
      `Critical: ${criticals.map((c) => c.headline).join(". ")}.`
    );
  }
  if (working.length > 0) {
    podcastParts.push(`Positive: ${working[0].headline}.`);
  }
  const summaryForPodcast =
    podcastParts.join(" ") || "No notable insights to report.";

  return {
    insights: allInsights,
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
// Single-bucket refresh — regenerates one bucket without touching others
// ============================================================================

export async function refreshSingleBucket(
  bucketId: string,
  metricsPayload: InsightMetricsPayload,
  tenantPool: pg.Pool,
  tenantId?: string,
  options: { channelGroup?: string } = {}
): Promise<CategorizedInsight[]> {
  const { channelGroup } = options;
  const dateFilter = metricsPayload.period.dateFilter;

  const bucket = BUCKETS.find((b) => b.id === bucketId);
  if (!bucket) throw new Error(`Unknown bucket: ${bucketId}`);

  const apiKey = await getOpenAIKey(tenantId);

  console.log(`[LLMInsights] Single-bucket refresh: "${bucketId}"`);

  const insights = await generateBucket(
    bucket.id as BucketId,
    bucket.promptId,
    bucket.priority,
    metricsPayload,
    apiKey
  );

  // Delete only this bucket's insights, keep the rest
  await tenantPool.query(
    `DELETE FROM generated_insights
     WHERE date_filter = $1
       AND COALESCE(channel_group, '') = COALESCE($2, '')
       AND bucket = $3`,
    [dateFilter, channelGroup || null, bucketId]
  );

  // Insert the new ones
  if (insights.length > 0) {
    const generationBatch = crypto.randomUUID();
    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const ins of insights) {
      placeholders.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
      );
      values.push(
        ins.bucket,
        ins.priority,
        ins.headline,
        ins.understory,
        ins.insight_type,
        ins.source,
        ins.severity_score,
        JSON.stringify(ins.impact),
        JSON.stringify(ins.evidence),
        ins.for_podcast,
        dateFilter,
        channelGroup || null,
        generationBatch,
        new Date().toISOString(),
        ins.detail_query ? JSON.stringify(ins.detail_query) : null
      );
    }

    await tenantPool.query(
      `INSERT INTO generated_insights
         (bucket, priority, headline, understory, insight_type, source,
          severity_score, impact, evidence, for_podcast,
          date_filter, channel_group, generation_batch, generated_at, detail_query)
       VALUES ${placeholders.join(", ")}`,
      values
    );
  }

  console.log(`[LLMInsights] Single-bucket "${bucketId}" done — ${insights.length} insights`);

  // Return ALL insights (from DB) so the frontend can replace its full list
  const stored = await loadStoredInsights(tenantPool, dateFilter, channelGroup);
  return stored?.insights ?? insights;
}

// ============================================================================
// Generate MORE insights for a bucket — appends without removing existing ones
// ============================================================================

export async function generateMoreForBucket(
  bucketId: string,
  metricsPayload: InsightMetricsPayload,
  tenantPool: pg.Pool,
  tenantId?: string,
  options: { channelGroup?: string } = {}
): Promise<CategorizedInsight[]> {
  const { channelGroup } = options;
  const dateFilter = metricsPayload.period.dateFilter;

  const bucket = BUCKETS.find((b) => b.id === bucketId);
  if (!bucket) throw new Error(`Unknown bucket: ${bucketId}`);

  const apiKey = await getOpenAIKey(tenantId);

  // Fetch existing headlines for this bucket so we can tell the LLM to avoid duplicates
  let existingHeadlines: string[] = [];
  try {
    const existing = await tenantPool.query(
      `SELECT headline FROM generated_insights
       WHERE date_filter = $1
         AND COALESCE(channel_group, '') = COALESCE($2, '')
         AND bucket = $3
       ORDER BY generated_at DESC`,
      [dateFilter, channelGroup || null, bucketId]
    );
    existingHeadlines = existing.rows.map((r: any) => r.headline).filter(Boolean);
  } catch (err) {
    console.warn(`[LLMInsights] Could not fetch existing headlines for dedup:`, err);
  }

  console.log(`[LLMInsights] Generate-more for bucket: "${bucketId}" (${existingHeadlines.length} existing headlines to avoid)`);

  const insights = await generateBucket(
    bucket.id as BucketId,
    bucket.promptId,
    bucket.priority,
    metricsPayload,
    apiKey,
    existingHeadlines
  );

  // APPEND only — no delete. Insert the new ones alongside existing.
  if (insights.length > 0) {
    const generationBatch = crypto.randomUUID();
    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const ins of insights) {
      placeholders.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
      );
      values.push(
        ins.bucket,
        ins.priority,
        ins.headline,
        ins.understory,
        ins.insight_type,
        ins.source,
        ins.severity_score,
        JSON.stringify(ins.impact),
        JSON.stringify(ins.evidence),
        ins.for_podcast,
        dateFilter,
        channelGroup || null,
        generationBatch,
        new Date().toISOString(),
        ins.detail_query ? JSON.stringify(ins.detail_query) : null
      );
    }

    await tenantPool.query(
      `INSERT INTO generated_insights
         (bucket, priority, headline, understory, insight_type, source,
          severity_score, impact, evidence, for_podcast,
          date_filter, channel_group, generation_batch, generated_at, detail_query)
       VALUES ${placeholders.join(", ")}`,
      values
    );
  }

  console.log(`[LLMInsights] Generate-more "${bucketId}" done — appended ${insights.length} insights`);

  // Return ALL insights (from DB) so the frontend gets the combined set
  const stored = await loadStoredInsights(tenantPool, dateFilter, channelGroup);
  return stored?.insights ?? insights;
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
