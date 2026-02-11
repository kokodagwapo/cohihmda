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
import { decryptAPIKeys } from "../encryption.js";
import { InsightMetricsPayload } from "./insightMetricsCollector.js";
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

  return `Analyze these mortgage business metrics for your designated insight category.

=== PERIOD ===
Date Filter: ${metrics.period.dateFilter.toUpperCase()}
Range: ${metrics.period.start || "N/A"} to ${metrics.period.end || "N/A"}

=== PIPELINE ===
- Active Loans: ${metrics.pipeline.activeLoans}
- Active Volume: ${fmt$(metrics.pipeline.activeVolume)}
- Locked Loans: ${metrics.pipeline.lockedLoans}
- Closed Loans: ${metrics.pipeline.closedLoans}
- Closed Volume: ${fmt$(metrics.pipeline.closedVolume)}

=== FALLOUT PREDICTIONS ===
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

=== PERFORMANCE ===
- Pull-Through Rate (Rolling 90D): ${fmtPct(metrics.performance.pullThroughRolling90D)}
- Average Cycle Time: ${Math.round(metrics.performance.avgCycleTime)} days
- Revenue YTD: ${fmt$(metrics.performance.revenueYTD)}
- Revenue MTD: ${fmt$(metrics.performance.revenueMTD)}
- Volume YTD: ${fmt$(metrics.performance.volumeYTD)}
- Volume MTD: ${fmt$(metrics.performance.volumeMTD)}

=== CREDIT RISK PROFILE ===
- Weighted Avg FICO: ${Math.round(metrics.creditRisk.waFico)}
- Weighted Avg LTV: ${fmtPct(metrics.creditRisk.waLtv)}
- Weighted Avg DTI: ${fmtPct(metrics.creditRisk.waDti)}
- Loans meeting high-risk criteria (FICO<620 OR LTV>95% OR DTI>50%): ${metrics.creditRisk.highRiskLoanCount}
- High-risk credit loan volume: ${fmt$(metrics.creditRisk.highRiskVolume)}

=== LOST OPPORTUNITY ===
- Withdrawn Loans: ${metrics.lostOpportunity.withdrawnUnits}
- Withdrawn Volume: ${fmt$(metrics.lostOpportunity.withdrawnVolume)}
- Lost Proforma Revenue: ${fmt$(metrics.lostOpportunity.withdrawnProformaRevenue)}
- Denied Loans: ${metrics.lostOpportunity.deniedUnits}
- Denied Volume: ${fmt$(metrics.lostOpportunity.deniedVolume)}

=== FUNNEL ===
- Loans Started: ${metrics.funnel.loansStarted}
- Loans Locked: ${metrics.funnel.loansLocked}
- Loans Originated: ${metrics.funnel.loansOriginated}
- Fallout Rate: ${fmtPct(metrics.funnel.falloutRate)}

=== TRENDS (Trailing 30-Day Windows — Apples-to-Apples) ===
Volume (Trailing 30D vs Prior 30D):
- Trailing 30-day funded volume: ${fmt$(metrics.comparisons.currentMtdVolume)}
- Prior 30-day funded volume: ${fmt$(metrics.comparisons.lastMonthVolume)}
- Change: ${metrics.comparisons.volumeVsLastMonth > 0 ? "+" : ""}${fmtPct(metrics.comparisons.volumeVsLastMonth)}

Volume YoY:
- Current YTD funded volume: ${fmt$(metrics.comparisons.currentYtdVolume)}
- Last year same period funded volume: ${fmt$(metrics.comparisons.lastYearVolume)}
- Change: ${metrics.comparisons.volumeVsLastYear > 0 ? "+" : ""}${fmtPct(metrics.comparisons.volumeVsLastYear)}

Cycle Time (Trailing 30D vs Prior 30D):
- Trailing 30-day cycle time: ${Math.round(metrics.comparisons.currentCycleTime)} days
- Prior 30-day cycle time: ${Math.round(metrics.comparisons.lastMonthCycleTime)} days
- Change: ${metrics.comparisons.cycleTimeVsLastMonth > 0 ? "+" : ""}${fmtPct(metrics.comparisons.cycleTimeVsLastMonth)}

IMPORTANT: These comparisons use equal-length 30-day rolling windows, NOT partial-month vs full-month.
When citing volume changes, use the EXACT dollar amounts above. Do not reverse-calculate from percentages. Say "funded volume moved from {prior30D} to {trailing30D}" with the actual numbers. Do NOT say "MoM" — say "trailing 30D" or "vs prior 30 days".

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

=== BASELINES (for threshold comparison) ===
- Pull-Through 90D Rolling: ${fmtPct(metrics.performance.pullThroughRolling90D)}
- Cycle Time Current: ${Math.round(metrics.performance.avgCycleTime)} days
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
    maxTokens = 2500,
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
      return { type: "performance" };
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

async function generateBucket(
  bucketId: BucketId,
  promptId: string,
  bucketPriority: BucketPriority,
  metricsPayload: InsightMetricsPayload,
  apiKey: string
): Promise<CategorizedInsight[]> {
  let systemPrompt: string;
  let model = "gpt-4o-mini";
  let temperature = 0.5;
  let maxTokens = 2500;

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

  const userPrompt = buildMetricsUserPrompt(metricsPayload);
  const responseText = await callOpenAI(systemPrompt, userPrompt, apiKey, {
    model,
    temperature,
    maxTokens,
  });

  const insights = parseBucketResponse(responseText, bucketId, bucketPriority);

  // Attach detail filters based on the metrics payload so drill-down
  // queries exactly match the data the insight was generated from.
  for (const insight of insights) {
    insight.detail_query = buildDetailFilters(insight, metricsPayload);
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
  channelGroup?: string
): Promise<void> {
  if (insights.length === 0) return;

  // Delete previous insights for this date_filter + channel_group
  await tenantPool.query(
    `DELETE FROM generated_insights WHERE date_filter = $1 AND COALESCE(channel_group, '') = COALESCE($2, '')`,
    [dateFilter, channelGroup || null]
  );

  // Batch insert
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

  // Call all 4 buckets in parallel
  const results = await Promise.allSettled(
    BUCKETS.map((bucket) =>
      generateBucket(
        bucket.id as BucketId,
        bucket.promptId,
        bucket.priority,
        metricsPayload,
        apiKey
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

  // Persist to tenant DB
  try {
    await persistInsights(
      tenantPool,
      allInsights,
      generationBatch,
      dateFilter,
      channelGroup
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

export default {
  generateLLMInsights,
  generateCategorizedInsights,
  loadStoredInsights,
  clearCache,
  getFromCache,
  setCache,
};
